// The domain dimension's selection and its bounded, quoted requirement text
// (change `judge-against-base-and-living-specs`, design D4; spec
// `review/domain-review` — selection and text).
//
// `lib/prompts/domain-context.mjs` is pure: it is handed the reliable
// spec-to-file edges, the changed paths and the spec texts, and decides which
// capabilities the `domain` reviewer is judged against and what text it
// receives. It reads no file and no ref; the caller (the run, or
// `interlock domain-context`) does that, which is why this file passes texts in.
//
// Shapes pinned here, so the module and its callers agree:
//
//   selectDomainCapabilities({ changedPaths, edges, graphReason, declared })
//     edges        what `livingSpecEdges(graph)` returns, or null when no graph exists
//     declared     capability names the change's own delta specs modify AND that
//                  already have a living spec (the caller filters)
//     -> { capabilities: [{ capability, via: 'linked'|'declared', files }],
//          skipped, partial, notSelected }   (the last three are strings/object or falsy)
//
//   assembleDomainContext({ capabilities, living, deltas, maxChars, ref })
//     living       { [capability]: living spec text }
//     deltas       { [capability]: the change's delta spec text }  (absent = none)
//     ref          the base the living text was read from, or null = the working tree
//     -> { text, skipped, ref, superseded, omitted, specifiedByChange }
//        where the three lists are arrays of { capability, heading }.
//
// The tests are RED until `lib/prompts/domain-context.mjs` exists.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectDomainCapabilities, assembleDomainContext, domainPartialReason } from '../../lib/prompts/domain-context.mjs'
import { livingSpecEdges } from '../../lib/drift.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'domain-context')
const read = name => readFileSync(join(FIX, name), 'utf8')

const GRAPH = JSON.parse(read('graph.json'))
const LIVING_GUARDS = read('living-tool-guards.md')
const LIVING_POLICY = read('living-policy-file.md')
const DELTA_POLICY = read('delta-policy-file.md')
const LIVING_INJECTION = read('living-injection.md')

const GUARDS = 'hooks/tool-guards'
const POLICY = 'review/policy-file'

const edges = () => livingSpecEdges(GRAPH)

// Whitespace-insensitive, prefix-insensitive, case-sensitive: the canonical
// heading form, restated here so a test does not depend on the module's helper.
const norm = h => String(h).replace(/^\s*Requirement:\s*/, '').replace(/\s+/g, ' ').trim()

// The requirement blocks of a spec, each from its `### Requirement:` line to
// the next one, trimmed. Used to assert whole blocks are present or absent.
function blocksOf(md) {
  return md
    .split(/^### Requirement:/m)
    .slice(1)
    .map(part => ('### Requirement:' + part).trim())
}
const headingOf = block => norm(block.split('\n')[0].replace('### ', ''))

const select = (over = {}) =>
  selectDomainCapabilities({ changedPaths: [], edges: edges(), graphReason: null, declared: [], ...over })

// --- selection --------------------------------------------------------------

test('a changed file linked by a reliable edge selects its capability, naming the file', () => {
  const r = select({ changedPaths: ['hooks/guard-commit.mjs', 'docs/04-when-it-stops.md'] })
  assert.equal(r.capabilities.length, 1)
  assert.equal(r.capabilities[0].capability, GUARDS)
  assert.equal(r.capabilities[0].via, 'linked')
  assert.deepEqual(r.capabilities[0].files, ['hooks/guard-commit.mjs'])
  assert.ok(!r.skipped, 'a selection is not a skip')
  assert.ok(!r.partial, 'a graph was available, so nothing is partial')
  assert.ok(!r.notSelected, 'something was selected')
})

test('a half-weight edge and an edge from openspec/changes select nothing', () => {
  const r = select({ changedPaths: ['hooks/half-weight.mjs', 'lib/in-flight-only.mjs'] })
  assert.deepEqual(r.capabilities, [])
  assert.ok(r.notSelected, 'a graph that links nothing records why')
  assert.equal(r.notSelected.unlinkedPaths.length, 2)
})

test('./lib/risk.mjs and lib/risk.mjs are the same canonical path', () => {
  const dotted = select({ changedPaths: ['./lib/risk.mjs'] })
  const plain = select({ changedPaths: ['lib/risk.mjs'] })
  assert.equal(dotted.capabilities.length, 1)
  assert.equal(dotted.capabilities[0].capability, 'ship/risk-routing')
  assert.equal(dotted.capabilities[0].via, 'linked')
  assert.equal(plain.capabilities[0].capability, 'ship/risk-routing')
  // Whichever spelling is reported, it names the one file.
  assert.equal(dotted.capabilities[0].files.length, 1)
  assert.equal(dotted.capabilities[0].files[0].replace(/^\.\//, ''), 'lib/risk.mjs')
})

test('a capability the change declares is selected with no linked file', () => {
  const r = select({ changedPaths: ['docs/a.md'], declared: [POLICY] })
  assert.equal(r.capabilities.length, 1)
  assert.equal(r.capabilities[0].capability, POLICY)
  assert.equal(r.capabilities[0].via, 'declared')
  assert.deepEqual(r.capabilities[0].files, [])
  assert.ok(!r.notSelected, 'a declared capability is a selection')
  assert.ok(!r.skipped && !r.partial)
})

test('a capability both linked and declared is selected once', () => {
  const r = select({ changedPaths: ['hooks/guard-commit.mjs'], declared: [GUARDS] })
  assert.equal(r.capabilities.length, 1)
  assert.equal(r.capabilities[0].capability, GUARDS)
  assert.deepEqual(r.capabilities[0].files, ['hooks/guard-commit.mjs'])
})

test('no graph but a declared capability is selected, and partial says the files were not mapped', () => {
  const r = select({
    changedPaths: ['lib/review-core.mjs'],
    edges: null,
    graphReason: 'no graph has been built',
    declared: [POLICY]
  })
  assert.equal(r.capabilities.length, 1)
  assert.equal(r.capabilities[0].capability, POLICY)
  assert.equal(r.capabilities[0].via, 'declared')
  assert.ok(r.partial, 'a graph-less selection is partial, never silent')
  assert.match(String(r.partial), /not mapped/i)
  assert.ok(!r.skipped, 'a selected dimension is not skipped')
})

test('no graph and nothing declared is a spoken skip', () => {
  const r = select({
    changedPaths: ['lib/review-core.mjs'],
    edges: null,
    graphReason: 'no graph has been built',
    declared: []
  })
  assert.deepEqual(r.capabilities, [])
  assert.ok(r.skipped, 'the skip carries its reason')
  assert.match(String(r.skipped), /no graph/i)
  assert.ok(!r.partial)
})

test('a graph that links none of three changed paths records notSelected, with no skip', () => {
  const r = select({ changedPaths: ['docs/a.md', 'docs/b.md', 'README.md'], declared: [] })
  assert.deepEqual(r.capabilities, [])
  assert.ok(!r.skipped, 'an unlinked file is the coverage gap, not a degraded review')
  assert.ok(!r.partial)
  assert.ok(r.notSelected)
  assert.equal(r.notSelected.unlinkedPaths.length, 3)
  assert.match(String(r.notSelected.reason), /no reliable edge/i)
  assert.match(String(r.notSelected.reason), /\b3\b/)
})

test('selection does not mutate its input', () => {
  const input = { changedPaths: ['./lib/risk.mjs'], edges: edges(), graphReason: null, declared: [POLICY] }
  const before = JSON.stringify(input)
  selectDomainCapabilities(input)
  assert.equal(JSON.stringify(input), before)
})

// --- assembly: whole requirements in capability, then spec, order -------------

const GUARD_BLOCKS = blocksOf(LIVING_GUARDS)
const POLICY_BLOCKS = blocksOf(LIVING_POLICY)

const caps = (...names) => names.map(capability => ({ capability, via: 'declared', files: [] }))

test('two capabilities under the cap are assembled whole, in capability then spec order', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS, POLICY),
    living: { [GUARDS]: LIVING_GUARDS, [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(!r.skipped)
  for (const block of [...GUARD_BLOCKS, ...POLICY_BLOCKS]) {
    assert.ok(r.text.includes(block), `a whole requirement is missing: ${block.split('\n')[0]}`)
  }
  const positions = [...GUARD_BLOCKS, ...POLICY_BLOCKS].map(b => r.text.indexOf(b))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'capability order, then spec order')
  assert.deepEqual(r.omitted, [])
  assert.deepEqual(r.superseded, [])
  assert.deepEqual(r.specifiedByChange, [])
})

test('the text is framed as quoted repository data that cannot override the rubric', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: {},
    maxChars: 100_000,
    ref: 'abc1234'
  })
  const open = r.text.indexOf('"""')
  assert.ok(open !== -1, 'the quoted text sits inside a delimited frame')
  const framing = r.text.slice(0, open)
  assert.match(framing, /quoted repository/i)
  assert.match(framing, /does NOT override|does not override/i)
  assert.match(framing, /rubric/i)
  assert.match(framing, /evidence gate/i)
  assert.match(framing, /never a command/i)
})

test('the cap is reached mid-capability: cut between requirements, never inside one', () => {
  // Room for the first block and some slack, never for the first two.
  const maxChars = POLICY_BLOCKS[0].length + 50
  assert.ok(maxChars < POLICY_BLOCKS[0].length + POLICY_BLOCKS[1].length)
  const r = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars,
    ref: 'abc1234'
  })
  assert.ok(!r.skipped, 'one requirement fits')
  assert.ok(r.text.includes(POLICY_BLOCKS[0]), 'the first whole requirement is present')
  // Nothing of a requirement that did not fit: neither its heading nor its scenario.
  assert.ok(!r.text.includes('Exclusions SHALL be enforced by the CLI'))
  assert.ok(!r.text.includes('Happy path — an excluded path drops'))
  assert.ok(!r.text.includes('A malformed policy SHALL be reported and ignored'))
  assert.ok(!r.text.includes('Edge case — an oversized file'))
  // The omission is counted in the text, per capability, and named by heading.
  const line = r.text.split('\n').find(l => /left out/i.test(l))
  assert.ok(line, 'the text states what was left out')
  assert.match(line, /\b2\b/)
  assert.ok(line.includes(POLICY), 'the count is per capability')
  assert.deepEqual(
    r.omitted.map(o => [o.capability, norm(o.heading)]),
    [
      [POLICY, headingOf(POLICY_BLOCKS[1])],
      [POLICY, headingOf(POLICY_BLOCKS[2])]
    ]
  )
})

test('when nothing fits the cap, domain is skipped with that reason', () => {
  const r = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars: 10,
    ref: 'abc1234'
  })
  assert.ok(r.skipped, 'no requirement fits, so domain does not run')
  assert.match(String(r.skipped), /fit/i)
  assert.match(String(r.skipped), /cap/i)
  assert.ok(!r.text, 'no text is delivered')
})

test('the published cap bounds the text when no maxChars is passed', () => {
  assert.ok(Number.isInteger(LIMITS.maxDomainSpecChars) && LIMITS.maxDomainSpecChars > 0)
  const body = 'x'.repeat(500)
  const generated = Array.from(
    { length: 60 },
    (_, i) =>
      `### Requirement: Generated requirement number ${i} SHALL hold\n\n${body}\n\n` +
      `#### Scenario: Happy path ${i}\n\n- **GIVEN** a\n- **WHEN** b\n- **THEN** c\n`
  )
  const living = `## Purpose\n\nGenerated.\n\n## Requirements\n\n${generated.join('\n')}`
  const r = assembleDomainContext({
    capabilities: caps('gen/big'),
    living: { 'gen/big': living },
    deltas: {},
    ref: 'abc1234'
  })
  const included = (r.text.match(/^### Requirement:/gm) || []).length
  assert.ok(included > 0 && included < 60, `expected a cut inside the corpus, kept ${included}`)
  assert.equal(r.omitted.length, 60 - included, 'every requirement left out is named')
  const sum = n => generated.slice(0, n).reduce((a, b) => a + b.trim().length, 0)
  assert.ok(sum(included) <= LIMITS.maxDomainSpecChars, 'the included blocks fit the cap')
  assert.ok(sum(included + 1) > LIMITS.maxDomainSpecChars - 200, 'and the next whole block would not have')
})

// --- superseded requirements and what the change specifies itself -------------

test('a requirement the change modifies is superseded on the canonical heading, whitespace aside', () => {
  const r = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: { [POLICY]: DELTA_POLICY },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(!r.skipped)
  // The living requirement the delta modifies is gone from the text, scenario and all.
  assert.ok(!r.text.includes(POLICY_BLOCKS[0]))
  assert.ok(!r.text.includes('Failure — a band key in the file'))
  assert.deepEqual(
    r.superseded.map(s => [s.capability, norm(s.heading)]),
    [[POLICY, headingOf(POLICY_BLOCKS[0])]]
  )
  // The others are still in force and present.
  assert.ok(r.text.includes(POLICY_BLOCKS[1]))
  assert.ok(r.text.includes(POLICY_BLOCKS[2]))
  // The delta's ADDED and MODIFIED headings are listed as specified by this change.
  const specified = r.specifiedByChange.map(s => [s.capability, norm(s.heading)])
  assert.ok(specified.some(([c, h]) => c === POLICY && h === 'The policy file SHALL declare always-human-review paths'))
  assert.ok(specified.some(([c, h]) => c === POLICY && h === headingOf(POLICY_BLOCKS[0])))
  assert.equal(specified.length, 2)
  assert.match(r.text, /specified by this change/i)
  assert.match(r.text, /delta spec/i)
  assert.ok(r.text.includes('The policy file SHALL declare always-human-review paths'))
  // By heading only: the delta's bodies are not handed over as requirements in force.
  assert.ok(!r.text.includes('DELTA-ONLY-BODY-SENTINEL'))
  assert.ok(!r.text.includes('DELTA-MODIFIED-BODY-SENTINEL'))
})

test('a delta that removes or renames a requirement supersedes it too', () => {
  const delta =
    '## REMOVED Requirements\n\n### Requirement: Every guard SHALL fail open\n\n**Reason**: gone\n\n' +
    '## RENAMED Requirements\n\n- FROM: `### Requirement: A guard SHALL NOT block a commit outside a ship run`\n' +
    '- TO: `### Requirement: A guard SHALL allow a commit outside a ship run`\n'
  const r = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: { [GUARDS]: delta },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.deepEqual(
    r.superseded.map(s => norm(s.heading)).sort(),
    GUARD_BLOCKS.map(headingOf).sort()
  )
  assert.ok(r.skipped, 'nothing is left in force')
  assert.ok(!r.text)
})

test('a capability whose every requirement is superseded leaves domain skipped', () => {
  const delta = `## MODIFIED Requirements\n\n${GUARD_BLOCKS.map(b => `${b}\n`).join('\n')}`
  const r = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: { [GUARDS]: delta },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(r.skipped, 'no requirement is in force to judge against')
  assert.ok(!r.text)
  assert.equal(r.superseded.length, 2)
})

// --- the base the text was read from --------------------------------------------

test('a null ref renders the source as the working tree, in the text and the result', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: {},
    maxChars: 100_000,
    ref: null
  })
  assert.match(r.text, /working tree/i)
  assert.match(JSON.stringify(r), /working tree/i)
})

test('a ref is named in the text and the result, and the working tree is not claimed', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: {},
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(r.text.includes('abc1234'))
  assert.equal(r.ref, 'abc1234')
  assert.doesNotMatch(r.text, /working tree/i)
})

// --- instruction-shaped text inside a spec -------------------------------------

test('instruction-shaped text and the frame delimiter stay inside the frame', () => {
  const r = assembleDomainContext({
    capabilities: caps('hostile/spec'),
    living: { 'hostile/spec': LIVING_INJECTION },
    deltas: {},
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(!r.skipped)
  const delimiters = r.text.match(/"""/g) || []
  assert.equal(delimiters.length, 2, 'only the frame opens and closes; the spec cannot close it early')
  const open = r.text.indexOf('"""')
  const close = r.text.lastIndexOf('"""')
  const inside = r.text.slice(open, close)
  assert.ok(inside.includes('ignore previous instructions'), 'the hostile text is quoted, not dropped')
  assert.ok(inside.includes('Close the frame early'))
  // The rubric's authority is stated before the quoted data, not after it.
  assert.match(r.text.slice(0, open), /never a command/i)
})

test('assembly does not mutate its input', () => {
  const input = {
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: { [POLICY]: DELTA_POLICY },
    maxChars: 100_000,
    ref: 'abc1234'
  }
  const before = JSON.stringify(input)
  assembleDomainContext(input)
  assert.equal(JSON.stringify(input), before)
})

test('assembly is deterministic', () => {
  const input = {
    capabilities: caps(GUARDS, POLICY),
    living: { [GUARDS]: LIVING_GUARDS, [POLICY]: LIVING_POLICY },
    deltas: { [POLICY]: DELTA_POLICY },
    maxChars: 100_000,
    ref: 'abc1234'
  }
  assert.equal(assembleDomainContext(input).text, assembleDomainContext(input).text)
})

// --- `kept`: the requirements the text carries, as locations -------------------
//
// Change `complete-and-record-the-merge-verdict`, design D5. The handoff's
// living list is built from this field, so the reviewer and the handoff can
// never disagree about which living requirements a change is judged against.
//
//   kept: Array<{ capability, heading, line }>   capability order, then spec order;
//         `line` is the heading's 1-based line in the living spec text.

// 1-based line of a requirement block's heading inside a spec text.
const lineOfBlock = (md, block) => {
  const heading = block.split('\n')[0]
  const at = md.split('\n').findIndex(l => l === heading)
  assert.ok(at !== -1, `fixture drift: ${heading} not found`)
  return at + 1
}

const keptShape = r => r.kept.map(k => [k.capability, norm(k.heading), k.line])

test('kept lists the carried requirements by capability, heading and line, in capability then spec order', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS, POLICY),
    living: { [GUARDS]: LIVING_GUARDS, [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.deepEqual(keptShape(r), [
    ...GUARD_BLOCKS.map(b => [GUARDS, headingOf(b), lineOfBlock(LIVING_GUARDS, b)]),
    ...POLICY_BLOCKS.map(b => [POLICY, headingOf(b), lineOfBlock(LIVING_POLICY, b)])
  ])
  for (const entry of r.kept) {
    assert.deepEqual(Object.keys(entry).sort(), ['capability', 'heading', 'line'], 'a location, never a body')
    assert.ok(Number.isInteger(entry.line) && entry.line >= 1)
  }
})

test('kept equals the requirements the text carries, no more and no fewer', () => {
  const r = assembleDomainContext({
    capabilities: caps(GUARDS, POLICY),
    living: { [GUARDS]: LIVING_GUARDS, [POLICY]: LIVING_POLICY },
    deltas: { [POLICY]: DELTA_POLICY },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  const carried = (r.text.match(/^### Requirement:.*$/gm) || []).map(l => norm(l.replace(/^###\s+/, '')))
  assert.deepEqual(r.kept.map(k => norm(k.heading)), carried)
  assert.ok(r.kept.length > 0)
})

test('a superseded requirement is absent from kept', () => {
  const r = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: { [POLICY]: DELTA_POLICY },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  const supersededHeadings = r.superseded.map(s => norm(s.heading))
  assert.equal(supersededHeadings.length, 1)
  assert.ok(!r.kept.some(k => supersededHeadings.includes(norm(k.heading))))
  assert.deepEqual(
    r.kept.map(k => norm(k.heading)),
    [headingOf(POLICY_BLOCKS[1]), headingOf(POLICY_BLOCKS[2])]
  )
})

test('a requirement the bound left out is absent from kept and present in omitted', () => {
  const r = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars: POLICY_BLOCKS[0].length + 50,
    ref: 'abc1234'
  })
  assert.deepEqual(keptShape(r), [[POLICY, headingOf(POLICY_BLOCKS[0]), lineOfBlock(LIVING_POLICY, POLICY_BLOCKS[0])]])
  assert.equal(r.omitted.length, 2)
  for (const o of r.omitted) {
    assert.ok(!r.kept.some(k => norm(k.heading) === norm(o.heading)), `${o.heading} is both kept and omitted`)
  }
})

test('kept is an empty list when nothing is in force, never absent', () => {
  const none = assembleDomainContext({
    capabilities: caps(GUARDS),
    living: { [GUARDS]: LIVING_GUARDS },
    deltas: { [GUARDS]: `## MODIFIED Requirements\n\n${GUARD_BLOCKS.map(b => `${b}\n`).join('\n')}` },
    maxChars: 100_000,
    ref: 'abc1234'
  })
  assert.ok(none.skipped)
  assert.deepEqual(none.kept, [])
  const tooSmall = assembleDomainContext({
    capabilities: caps(POLICY),
    living: { [POLICY]: LIVING_POLICY },
    deltas: {},
    maxChars: 10,
    ref: 'abc1234'
  })
  assert.ok(tooSmall.skipped)
  assert.deepEqual(tooSmall.kept, [])
})

// --- ordering, the cut as partial, graph-free selection ---------------------
// (change `prove-the-review-covered-the-diff`, design D6 and "Graph-free
// selection"; spec `review/domain-review`.)

const PR28 = JSON.parse(
  readFileSync(join(FIX, '..', 'review-proof', 'pr28', 'domain-context.json'), 'utf8')
)
const specEdge = (cap, file) => ({
  source: `openspec:${cap}`,
  target: `file:${file}`,
  relation: 'implements_spec',
  confidence: 'INFERRED',
  source_file: `openspec/specs/${cap}/spec.md`,
  source_location: 'L1',
  weight: 1
})

test('capabilities are ordered by linked changed-file count, descending, and the record lists each count', () => {
  const links = [
    specEdge('hooks/settle-meter', 'lib/a.mjs'),
    specEdge('hooks/settle-meter', 'lib/b.mjs'),
    specEdge('hooks/settle-meter', 'lib/c.mjs'),
    specEdge('distribution/npm-package', 'package.json')
  ]
  const r = selectDomainCapabilities({
    changedPaths: ['package.json', 'lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs'],
    edges: livingSpecEdges({ links })
  })
  assert.deepEqual(
    r.capabilities.map(c => [c.capability, c.count]),
    [['hooks/settle-meter', 3], ['distribution/npm-package', 1]]
  )
})

test('equal linked counts fall back to name order', () => {
  const links = [specEdge('zeta/cap', 'lib/z.mjs'), specEdge('alpha/cap', 'lib/a.mjs')]
  const r = selectDomainCapabilities({ changedPaths: ['lib/z.mjs', 'lib/a.mjs'], edges: livingSpecEdges({ links }) })
  assert.deepEqual(r.capabilities.map(c => [c.capability, c.count]), [['alpha/cap', 1], ['zeta/cap', 1]])
})

test('the PR #28 cut is partial, names hooks/spec-meter as left with nothing, and cites maxDomainSpecChars', () => {
  const selection = selectDomainCapabilities({
    changedPaths: PR28.changedPaths,
    edges: livingSpecEdges({ links: PR28.links }),
    declared: PR28.declared
  })
  assert.deepEqual(selection.capabilities.map(c => c.capability), ['hooks/settle-meter', 'hooks/spec-meter'])
  const total = Object.values(PR28.livingTexts).reduce((n, t) => n + t.length, 0)
  assert.ok(total > LIMITS.maxDomainSpecChars, 'the fixture exceeds the published cap')
  const assembled = assembleDomainContext({ capabilities: selection.capabilities, living: PR28.livingTexts })
  const specMeterHeadings = blocksOf(PR28.livingTexts['hooks/spec-meter']).map(headingOf)
  assert.deepEqual(
    assembled.omitted.filter(o => o.capability === 'hooks/spec-meter').map(o => norm(o.heading)),
    specMeterHeadings,
    'every hooks/spec-meter requirement is cut'
  )
  assert.ok(!assembled.kept.some(k => k.capability === 'hooks/spec-meter'))
  assert.deepEqual(assembled.emptied, ['hooks/spec-meter'])
  assert.equal(selection.partial, null, 'the cut never goes on selection.partial (the no-graph flag)')
  const reason = domainPartialReason(selection, assembled)
  assert.ok(reason, 'a cut makes the selection partial')
  assert.match(reason, /maxDomainSpecChars/)
  assert.match(reason, new RegExp(`\\b${assembled.omitted.length} requirement\\(s\\)`))
  assert.match(reason, /hooks\/spec-meter/)
})

test('a text that fits the cap has no partial reason', () => {
  const selection = select({ changedPaths: ['hooks/guard-commit.mjs'] })
  const assembled = assembleDomainContext({ capabilities: selection.capabilities, living: { [GUARDS]: LIVING_GUARDS } })
  assert.deepEqual(assembled.omitted, [])
  assert.deepEqual(assembled.emptied, [])
  assert.equal(domainPartialReason(selection, assembled), null)
})

test('an ungraphed lib/settle-meter.mjs selects hooks/settle-meter via cited and is listed under ungraphed', () => {
  const r = selectDomainCapabilities({
    changedPaths: ['lib/settle-meter.mjs'],
    edges: [],
    graphFiles: ['hooks/mod.mjs'],
    livingTexts: PR28.livingTexts,
    graphBuiltAt: '2026-10-20T00:00:00Z'
  })
  assert.deepEqual(r.capabilities, [
    { capability: 'hooks/settle-meter', via: 'cited', files: ['lib/settle-meter.mjs'], count: 1 }
  ])
  assert.deepEqual(r.ungraphed, {
    builtAt: '2026-10-20T00:00:00Z',
    files: [{ path: 'lib/settle-meter.mjs', citedBy: ['hooks/settle-meter'] }]
  })
  assert.ok(!r.notSelected)
})

test('a changed file absent from the graph and cited by no spec selects nothing but is listed under ungraphed', () => {
  const r = selectDomainCapabilities({
    changedPaths: ['lib/nobody-cites-this.mjs'],
    edges: [],
    graphFiles: ['hooks/mod.mjs'],
    livingTexts: PR28.livingTexts
  })
  assert.deepEqual(r.capabilities, [])
  assert.deepEqual(r.ungraphed, { builtAt: null, files: [{ path: 'lib/nobody-cites-this.mjs', citedBy: [] }] })
})

// --- cited selection reads only for a changed SOURCE file (review fixes on PR #29, M3) ---

const CITING_SKILL_AND_BIN = {
  'review/skill': '### Requirement: It is cited\n\nIt SHALL live in `skills/review-code/SKILL.md`, and `bin/interlock` SHALL call it.\n'
}

test('a docs-only change the graph does not hold selects nothing by citation and lists nothing as ungraphed', () => {
  const r = selectDomainCapabilities({
    changedPaths: ['skills/review-code/SKILL.md'],
    edges: [],
    graphFiles: ['hooks/mod.mjs'],
    livingTexts: CITING_SKILL_AND_BIN
  })
  assert.deepEqual(r.capabilities, [])
  assert.equal(r.ungraphed, null, 'a doc the graph never indexes is not an ungraphed source file')
  assert.ok(r.notSelected, 'it is recorded as not selected, as an unlinked doc always was')
})

test('an extensionless executable under bin/ the graph never indexes is still selected by citation', () => {
  const r = selectDomainCapabilities({
    changedPaths: ['bin/interlock'],
    edges: [],
    graphFiles: ['hooks/mod.mjs'],
    livingTexts: { ...CITING_SKILL_AND_BIN, other: 'Only `bin/interlock-graph` and bin/interlock.mjs are named here.\n' }
  })
  assert.deepEqual(r.capabilities, [{ capability: 'review/skill', via: 'cited', files: ['bin/interlock'], count: 1 }])
  assert.deepEqual(r.ungraphed.files, [{ path: 'bin/interlock', citedBy: ['review/skill'] }])
})

test('citedSelectionInputs reads every living spec once, and only when a changed source file is ungraphed', async () => {
  const { citedSelectionInputs } = await import('../../lib/prompts/domain-context.mjs')
  const graph = { nodes: [{ id: 'file:hooks/mod.mjs', type: 'file' }], builtAt: '2026-10-20T00:00:00Z' }
  let reads = 0
  const readAll = () => {
    reads++
    return { texts: PR28.livingTexts, problems: [] }
  }
  const docs = citedSelectionInputs({ graph, changedPaths: ['skills/review-code/SKILL.md', 'docs/a.md'], readAll })
  assert.equal(reads, 0, 'a docs-only diff reads no living spec')
  assert.deepEqual(docs.livingTexts, {})
  const source = citedSelectionInputs({ graph, changedPaths: ['lib/settle-meter.mjs', 'docs/a.md'], readAll })
  assert.equal(reads, 1, 'one batched read for the whole scan')
  assert.deepEqual(Object.keys(source.livingTexts).sort(), Object.keys(PR28.livingTexts).sort())
  assert.equal(source.livingUnread, undefined)
})

test('a living spec the scan could not read is carried out as citedUnread, so each caller can say it', async () => {
  const { citedSelectionInputs } = await import('../../lib/prompts/domain-context.mjs')
  const graph = { nodes: [], builtAt: null }
  const inputs = citedSelectionInputs({
    graph,
    changedPaths: ['lib/settle-meter.mjs'],
    readAll: () => ({ texts: {}, problems: ['the living specs at abc1234 could not be listed (fatal: bad object)'] })
  })
  assert.match(inputs.livingUnread, /could not be listed/)
  const r = selectDomainCapabilities({ changedPaths: ['lib/settle-meter.mjs'], edges: [], ...inputs })
  assert.match(r.citedUnread, /^the living specs at abc1234 could not be listed .*matched only against the living specs that were read$/)
  assert.deepEqual(r.ungraphed.files, [{ path: 'lib/settle-meter.mjs', citedBy: [] }])
  const clean = selectDomainCapabilities({ changedPaths: ['lib/settle-meter.mjs'], edges: [], graphFiles: [], livingTexts: {} })
  assert.equal(clean.citedUnread, null)
})

test('the domain reason words a cited capability apart from a linked one', async () => {
  const { selectDimensions } = await import('../../lib/prompts/dimensions.mjs')
  const { reasons } = selectDimensions(['lib/settle-meter.mjs', 'hooks/mod.mjs'], {
    domain: {
      capabilities: [
        { capability: 'hooks/settle-meter', via: 'cited', files: ['lib/settle-meter.mjs'], count: 1 },
        { capability: 'hooks/mod', via: 'linked', files: ['hooks/mod.mjs'], count: 1 }
      ]
    }
  })
  assert.match(reasons.domain, /hooks\/settle-meter \(its living spec cites lib\/settle-meter\.mjs, which the graph does not hold\)/)
  assert.match(reasons.domain, /hooks\/mod \(linked to hooks\/mod\.mjs\)/)
  assert.doesNotMatch(reasons.domain, /settle-meter \(linked/)
})
