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
import { buildChecklist, formatChecklist } from '../../lib/conformance.mjs'

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
