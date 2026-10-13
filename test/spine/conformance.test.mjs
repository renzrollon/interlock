// Conformance builds questions, never answers.
//
// The failure mode this suite guards is a checklist that reads like a verdict:
// an empty scenario list rendered as "conformant", or an unanswered checklist
// treated as a pass. Every assertion below is about the module refusing to
// decide something it cannot know.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildChecklist, formatChecklist, buildLivingChecklist } from '../../lib/conformance.mjs'
import { selectDomainCapabilities, assembleDomainContext } from '../../lib/prompts/domain-context.mjs'

function repo() {
  return mkdtempSync(join(tmpdir(), 'interlock-conf-'))
}

const SCENARIOS = `# Auth delta

#### Scenario: User signs in
Given a registered user
Then a session is created

#### Scenario: Expired token is rejected
Given an expired token
Then the request is refused
`

function change(root, name, { specs = {}, proposal = '# Proposal\nwhy\n' } = {}) {
  const dir = join(root, 'openspec', 'changes', name)
  mkdirSync(join(dir, 'specs'), { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), proposal)
  writeFileSync(join(dir, 'design.md'), '# Design\nhow\n')
  writeFileSync(join(dir, 'tasks.md'), '- [x] 1.1 handler\n')
  for (const [file, body] of Object.entries(specs)) {
    writeFileSync(join(dir, 'specs', file), body)
  }
}

test('every scenario in the delta specs becomes a numbered question', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const r = buildChecklist(root, 'add-login')
  assert.equal(r.skipped, false)
  assert.equal(r.scenarios.length, 2)
  assert.deepEqual(r.scenarios.map(s => s.id), ['C1', 'C2'])
  assert.equal(r.scenarios[0].title, 'User signs in')
  assert.equal(r.scenarios[0].artifact, 'specs/auth.md')
  rmSync(root, { recursive: true, force: true })
})

test('scenarios outside specs/ are counted, not silently dropped', () => {
  // A change whose only scenarios sit in proposal.md looks identical to a
  // change with no scenarios unless the count is surfaced.
  const root = repo()
  change(root, 'add-login', {
    proposal: '# Proposal\n\n#### Scenario: Something\nGiven a thing\n'
  })
  const r = buildChecklist(root, 'add-login')
  assert.deepEqual(r.scenarios, [])
  assert.equal(r.outsideSpecs, 1)
  assert.match(formatChecklist(r), /outside specs\//)
  rmSync(root, { recursive: true, force: true })
})

test('a change with no scenarios anywhere says so rather than claiming conformance', () => {
  const root = repo()
  change(root, 'add-login')
  const r = buildChecklist(root, 'add-login')
  assert.deepEqual(r.scenarios, [])
  assert.equal(r.outsideSpecs, 0)
  const text = formatChecklist(r)
  assert.match(text, /no scenarios in the delta specs/)
  assert.doesNotMatch(text, /conformant|passes|satisfied/i)
  rmSync(root, { recursive: true, force: true })
})

test('changed files are filtered to real source', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const r = buildChecklist(root, 'add-login', {
    changed: ['src/auth.ts', 'README.md', 'tsconfig.json', 'src/auth.test.ts']
  })
  assert.deepEqual(r.changedFiles, ['src/auth.ts'])
  rmSync(root, { recursive: true, force: true })
})

test('an unresolvable change is skipped with a reason', () => {
  const root = repo()
  const r = buildChecklist(root, 'nope')
  assert.equal(r.skipped, true)
  assert.ok(r.reason)
  assert.deepEqual(r.scenarios, [])
  rmSync(root, { recursive: true, force: true })
})

test('the checklist states that it holds no verdicts', () => {
  // The one line that must survive future edits: a consumer treating an
  // unanswered checklist as a pass has misread it, and the output has to say so.
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const r = buildChecklist(root, 'add-login')
  assert.equal(r.verdictsRequired, 2)
  const text = formatChecklist(r)
  assert.match(text, /questions, not results/)
  assert.match(text, /unanswered checklist is not a pass/)
  rmSync(root, { recursive: true, force: true })
})

test('the report always says it does not block', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  assert.match(formatChecklist(buildChecklist(root, 'add-login')), /Nothing here blocks/)
  assert.match(formatChecklist(buildChecklist(root, 'missing')), /Nothing here blocks/)
  rmSync(root, { recursive: true, force: true })
})

// --- the living list (change `complete-and-record-the-merge-verdict`, design D5) ----
//
// `buildLivingChecklist({ selection, assembled })` is pure. It turns the
// domain reviewer's selection (`selectDomainCapabilities`) and bounded text
// (`assembleDomainContext`) into the list the handoff is asked about. Headings
// and locations only, never a requirement body.
//
//   { skipped, partial, requirements: [{ id: 'L1', capability, artifact, line, title }],
//     requirementsRequired, omitted: [{ capability, heading }], source }

const BODY_SENTINEL = 'BODY-SENTINEL-NEVER-LISTED'

function livingSpec(headings) {
  const reqs = headings.map(
    h =>
      `### Requirement: ${h}\n\nThe system SHALL hold. ${BODY_SENTINEL}\n\n` +
      `#### Scenario: Happy path for ${h}\n\n- **GIVEN** a\n- **WHEN** b\n- **THEN** c\n`
  )
  return `## Purpose\n\nA capability.\n\n## Requirements\n\n${reqs.join('\n')}`
}

const ALPHA = livingSpec(['Alpha one SHALL hold', 'Alpha two SHALL hold', 'Alpha three SHALL hold'])
const BETA = livingSpec(['Beta one SHALL hold', 'Beta two SHALL hold'])
const BETA_DELTA =
  '## MODIFIED Requirements\n\n### Requirement: Beta one SHALL hold\n\nChanged. DELTA-BODY\n\n' +
  '#### Scenario: Happy path\n\n- **GIVEN** a\n- **WHEN** b\n- **THEN** c\n'

const lineOfHeading = (md, heading) => md.split('\n').findIndex(l => l === `### Requirement: ${heading}`) + 1

const sel = (...capabilities) => ({
  capabilities: capabilities.map(capability => ({ capability, via: 'declared', files: [] })),
  skipped: null,
  partial: null,
  notSelected: null
})

function living({ selection, texts, deltas = {}, ref = 'abc1234', maxChars = 100_000 }) {
  const assembled = assembleDomainContext({
    capabilities: selection.capabilities,
    living: texts,
    deltas,
    maxChars,
    ref
  })
  return buildLivingChecklist({ selection, assembled })
}

test('the living list is L1..Ln in capability then spec order, without what the change supersedes', () => {
  const r = living({
    selection: sel('alpha', 'beta'),
    texts: { alpha: ALPHA, beta: BETA },
    deltas: { beta: BETA_DELTA }
  })
  assert.deepEqual(r.requirements.map(e => e.id), ['L1', 'L2', 'L3', 'L4'])
  assert.deepEqual(r.requirements.map(e => e.capability), ['alpha', 'alpha', 'alpha', 'beta'])
  assert.deepEqual(
    r.requirements.map(e => e.title),
    ['Alpha one SHALL hold', 'Alpha two SHALL hold', 'Alpha three SHALL hold', 'Beta two SHALL hold']
  )
  assert.equal(r.requirementsRequired, 4, 'the list states its own count')
  assert.equal(r.requirementsRequired, r.requirements.length)
  assert.equal(r.skipped, null)
  assert.equal(r.partial, null)
  assert.deepEqual(r.omitted, [])
})

test('each living entry carries the spec path, the heading line and the heading, and no body', () => {
  const r = living({ selection: sel('alpha', 'beta'), texts: { alpha: ALPHA, beta: BETA } })
  const first = r.requirements[0]
  assert.equal(first.artifact, 'openspec/specs/alpha/spec.md')
  assert.equal(first.line, lineOfHeading(ALPHA, 'Alpha one SHALL hold'))
  const last = r.requirements[4]
  assert.equal(last.artifact, 'openspec/specs/beta/spec.md')
  assert.equal(last.line, lineOfHeading(BETA, 'Beta two SHALL hold'))
  for (const e of r.requirements) {
    assert.deepEqual(Object.keys(e).sort(), ['artifact', 'capability', 'id', 'line', 'title'])
  }
  assert.ok(!JSON.stringify(r).includes(BODY_SENTINEL), 'a requirement body is never copied into the list')
})

test('the living list names where its text was read from', () => {
  const pinned = living({ selection: sel('alpha'), texts: { alpha: ALPHA }, ref: 'abc1234' })
  assert.match(pinned.source, /abc1234/)
  const tree = living({ selection: sel('alpha'), texts: { alpha: ALPHA }, ref: null })
  assert.match(tree.source, /working tree/i)
})

test('the bound cuts between requirements and the list names what it left out', () => {
  const block = ALPHA.slice(ALPHA.indexOf('### Requirement:')).split(/(?=^### Requirement:)/m)[0].trim()
  const r = living({ selection: sel('alpha'), texts: { alpha: ALPHA }, maxChars: block.length * 2 + 20 })
  assert.deepEqual(r.requirements.map(e => e.title), ['Alpha one SHALL hold', 'Alpha two SHALL hold'])
  assert.equal(r.requirementsRequired, 2)
  assert.deepEqual(r.omitted, [{ capability: 'alpha', heading: 'Alpha three SHALL hold' }])
})

test('the living list is exactly the requirements the domain text carries', () => {
  const selection = sel('alpha', 'beta')
  const assembled = assembleDomainContext({
    capabilities: selection.capabilities,
    living: { alpha: ALPHA, beta: BETA },
    deltas: { beta: BETA_DELTA },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  const r = buildLivingChecklist({ selection, assembled })
  const carried = (assembled.text.match(/^### Requirement:\s*(.*?)\s*$/gm) || []).map(l =>
    l.replace(/^###\s+Requirement:\s*/, '').trim()
  )
  assert.deepEqual(r.requirements.map(e => e.title), carried)
})

test('no graph and nothing declared is a stated skip with its reason, not an empty list', () => {
  const selection = selectDomainCapabilities({
    changedPaths: ['lib/a.mjs'],
    edges: null,
    graphReason: 'no graph has been built',
    declared: []
  })
  const assembled = assembleDomainContext({ capabilities: selection.capabilities, living: {}, deltas: {}, ref: 'abc1234' })
  const r = buildLivingChecklist({ selection, assembled })
  assert.ok(r.skipped, 'the skip carries its reason')
  assert.match(String(r.skipped), /no graph/i)
  assert.deepEqual(r.requirements, [])
  assert.equal(r.requirementsRequired, 0)
  assert.equal(r.partial, null)
})

test('no graph with a declared capability is partial, and the declared requirements are listed', () => {
  const selection = selectDomainCapabilities({
    changedPaths: ['lib/a.mjs'],
    edges: null,
    graphReason: 'no graph has been built',
    declared: ['beta']
  })
  const assembled = assembleDomainContext({
    capabilities: selection.capabilities,
    living: { beta: BETA },
    deltas: {},
    ref: 'abc1234'
  })
  const r = buildLivingChecklist({ selection, assembled })
  assert.ok(r.partial, 'partial is spoken, never silent')
  assert.match(String(r.partial), /not mapped/i)
  assert.equal(r.skipped, null)
  assert.deepEqual(r.requirements.map(e => e.title), ['Beta one SHALL hold', 'Beta two SHALL hold'])
})

test('a graph that links nothing yields an empty list that is neither skipped nor partial', () => {
  const selection = selectDomainCapabilities({
    changedPaths: ['docs/a.md', 'README.md'],
    edges: [],
    graphReason: null,
    declared: []
  })
  assert.ok(selection.notSelected, 'fixture: the selection records why nothing was selected')
  const assembled = assembleDomainContext({ capabilities: selection.capabilities, living: {}, deltas: {}, ref: 'abc1234' })
  assert.ok(assembled.skipped, 'fixture: the assembler has nothing to say, and says it as a skip')
  const r = buildLivingChecklist({ selection, assembled })
  assert.deepEqual(r.requirements, [])
  assert.equal(r.requirementsRequired, 0)
  assert.equal(r.skipped, null, "the assembler's own skip must not be reported as a missing graph")
  assert.equal(r.partial, null)
})

test('a capability whose every requirement is superseded is empty, neither skipped nor partial', () => {
  const delta = `## MODIFIED Requirements\n\n${ALPHA.slice(ALPHA.indexOf('### Requirement:'))}`
  const r = living({ selection: sel('alpha'), texts: { alpha: ALPHA }, deltas: { alpha: delta } })
  assert.deepEqual(r.requirements, [])
  assert.equal(r.requirementsRequired, 0)
  assert.equal(r.skipped, null)
  assert.equal(r.partial, null)
})

test('building the living list does not mutate its inputs', () => {
  const selection = sel('alpha', 'beta')
  const assembled = assembleDomainContext({
    capabilities: selection.capabilities,
    living: { alpha: ALPHA, beta: BETA },
    deltas: {},
    ref: 'abc1234'
  })
  const before = JSON.stringify({ selection, assembled })
  buildLivingChecklist({ selection, assembled })
  assert.equal(JSON.stringify({ selection, assembled }), before)
})

// --- rendering the living list ---------------------------------------------------

test('formatChecklist prints the L entries after the C entries and names the source of the living text', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const checklist = buildChecklist(root, 'add-login')
  const list = living({ selection: sel('alpha', 'beta'), texts: { alpha: ALPHA, beta: BETA }, ref: 'abc1234' })
  const text = formatChecklist({ ...checklist, living: list })
  const at = id => text.indexOf(`  ${id}  `)
  assert.ok(at('C1') !== -1 && at('C2') !== -1 && at('L1') !== -1 && at('L5') !== -1, text)
  assert.ok(at('C1') < at('C2') && at('C2') < at('L1') && at('L1') < at('L5'), 'C entries, then L entries, in order')
  assert.match(text, /Alpha one SHALL hold/)
  assert.ok(text.includes(`openspec/specs/alpha/spec.md:${lineOfHeading(ALPHA, 'Alpha one SHALL hold')}`))
  assert.match(text, /abc1234/, 'the source of the living text is named')
  assert.ok(!text.includes(BODY_SENTINEL))
  assert.match(text, /Nothing here blocks/)
  assert.ok(text.trimEnd().split('\n').pop().startsWith('Nothing here blocks'), 'the checklist still ends there')
  rmSync(root, { recursive: true, force: true })
})

test('formatChecklist says the working tree was the source when no base was named', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const list = living({ selection: sel('alpha'), texts: { alpha: ALPHA }, ref: null })
  const text = formatChecklist({ ...buildChecklist(root, 'add-login'), living: list })
  assert.match(text, /working tree/i)
  rmSync(root, { recursive: true, force: true })
})

test('a skipped or partial living list prints its reason and still ends in Nothing here blocks', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const base = buildChecklist(root, 'add-login')
  const skipped = formatChecklist({
    ...base,
    living: { skipped: 'no graph exists and the change declares no capability', partial: null, requirements: [], requirementsRequired: 0, omitted: [], source: 'base abc1234' }
  })
  assert.match(skipped, /no graph exists and the change declares no capability/)
  assert.doesNotMatch(skipped, /\bL1\b/)
  assert.match(skipped, /C1/, 'the delta scenarios are still listed')
  assert.ok(skipped.trimEnd().split('\n').pop().startsWith('Nothing here blocks'))

  const partial = formatChecklist({
    ...base,
    living: { skipped: null, partial: 'no graph: the changed files were not mapped', requirements: [], requirementsRequired: 0, omitted: [], source: 'base abc1234' }
  })
  assert.match(partial, /the changed files were not mapped/)
  assert.ok(partial.trimEnd().split('\n').pop().startsWith('Nothing here blocks'))
  rmSync(root, { recursive: true, force: true })
})

test('a living list cut by the bound names what it left out', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const text = formatChecklist({
    ...buildChecklist(root, 'add-login'),
    living: {
      skipped: null,
      partial: null,
      requirements: [{ id: 'L1', capability: 'alpha', artifact: 'openspec/specs/alpha/spec.md', line: 5, title: 'Alpha one SHALL hold' }],
      requirementsRequired: 1,
      omitted: [{ capability: 'alpha', heading: 'Alpha three SHALL hold' }],
      source: 'base abc1234'
    }
  })
  assert.match(text, /Alpha three SHALL hold/)
  assert.match(text, /left out/i)
  rmSync(root, { recursive: true, force: true })
})

test('a checklist built without the living list is unchanged, field for field', () => {
  const root = repo()
  change(root, 'add-login', { specs: { 'auth.md': SCENARIOS } })
  const r = buildChecklist(root, 'add-login')
  assert.deepEqual(
    Object.keys(r).sort(),
    ['change', 'changedFiles', 'outsideSpecs', 'reason', 'scenarios', 'skipped', 'verdictsRequired'],
    'no living key, count or reason appears unless asked for'
  )
  const text = formatChecklist(r)
  assert.doesNotMatch(text, /\bL\d+\b/)
  assert.doesNotMatch(text, /living/i)
  assert.equal(formatChecklist({ ...r, living: undefined }), text)
  assert.equal(formatChecklist({ ...r, living: null }), text)
  rmSync(root, { recursive: true, force: true })
})
