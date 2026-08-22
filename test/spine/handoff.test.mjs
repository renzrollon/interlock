// The wave handoff is the one thing a fresh implementer is told about the wave
// before it. Everything else it knows, it reads for itself.
//
// So the tests here are about refusal. A packet that is missing, malformed,
// mislabelled or over budget must fail its task rather than reach the next wave
// as prose — the whole reason the schema exists is that the alternative (infer
// it from git and a mutable state file) cannot be refused. There is deliberately
// no truncation path to test: an over-budget packet is rejected, never trimmed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateHandoff, HANDOFF_SCHEMA } from '../../lib/waves.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const packet = (over = {}) => ({
  schema: HANDOFF_SCHEMA,
  taskId: '1.1',
  status: 'ok',
  summary: 'Added the sessions table and a unique index on email.',
  evidence: ['db/schema.sql:12-40', 'lib/sessions.mjs:1-80'],
  next: 'Wave 2 can assume sessions persist; wire login against this table.',
  blocker: null,
  ...over
})

test('a well-formed ok packet validates and comes back normalized', () => {
  const got = validateHandoff('1.1', packet())
  assert.equal(got.ok, true)
  assert.deepEqual(got.handoff, {
    schema: HANDOFF_SCHEMA,
    taskId: '1.1',
    status: 'ok',
    summary: 'Added the sessions table and a unique index on email.',
    evidence: ['db/schema.sql:12-40', 'lib/sessions.mjs:1-80'],
    next: 'Wave 2 can assume sessions persist; wire login against this table.',
    blocker: null
  })
})

test('a missing packet is invalid rather than an empty one', () => {
  for (const missing of [undefined, null, '', 'ok', 42, []]) {
    const got = validateHandoff('1.1', missing)
    assert.equal(got.ok, false, `${JSON.stringify(missing)} must not validate`)
    assert.match(got.error, /must be an object/)
  }
})

test('blocked without a blocker is refused, even though the shape is otherwise fine', () => {
  for (const blocker of [null, undefined, '', '   ']) {
    const got = validateHandoff('1.1', packet({ status: 'blocked', blocker }))
    assert.equal(got.ok, false, `blocker ${JSON.stringify(blocker)} must not validate`)
    assert.match(got.error, /non-empty blocker/)
  }
})

test('partial is a real status and it owes a blocker too', () => {
  assert.equal(validateHandoff('1.1', packet({ status: 'partial', blocker: null })).ok, false)
  const got = validateHandoff('1.1', packet({ status: 'partial', blocker: 'schema half migrated' }))
  assert.equal(got.ok, true)
  assert.equal(got.handoff.blocker, 'schema half migrated')
})

test('ok with a blocker is refused — the two fields must not disagree', () => {
  const got = validateHandoff('1.1', packet({ status: 'ok', blocker: 'but actually it broke' }))
  assert.equal(got.ok, false)
  assert.match(got.error, /null blocker/)
})

test('an unknown status is refused rather than coerced to a known one', () => {
  for (const status of ['done', 'OK', '', undefined, true]) {
    const got = validateHandoff('1.1', packet({ status }))
    assert.equal(got.ok, false, `status ${JSON.stringify(status)} must not validate`)
    assert.match(got.error, /status must be one of/)
  }
})

test('the packet must report on the task it was asked about', () => {
  const got = validateHandoff('2.3', packet({ taskId: '1.1' }))
  assert.equal(got.ok, false)
  assert.match(got.error, /taskId must be "2.3"/)
})

test('summary and next must both say something', () => {
  assert.match(validateHandoff('1.1', packet({ summary: '  ' })).error, /summary/)
  assert.match(validateHandoff('1.1', packet({ next: '' })).error, /next/)
})

test('evidence is capped at eight locators', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts:1-2`)
  assert.equal(validateHandoff('1.1', packet({ evidence: eight })).ok, true)
  const nine = [...eight, 'src/f8.ts']
  const got = validateHandoff('1.1', packet({ evidence: nine }))
  assert.equal(got.ok, false)
  assert.match(got.error, /at most 8/)
})

test('evidence entries are locators, not pasted file bodies', () => {
  for (const entry of [
    'export function login() { return null }',
    'src/auth.ts:12 and also the bit below',
    'src/auth.ts:not-a-line',
    42
  ]) {
    const got = validateHandoff('1.1', packet({ evidence: [entry] }))
    assert.equal(got.ok, false, `${JSON.stringify(entry)} must not pass as a locator`)
    assert.match(got.error, /not a locator/)
  }
  // A bare repo-relative path with no line span is still a locator.
  assert.equal(validateHandoff('1.1', packet({ evidence: ['lib/waves.mjs'] })).ok, true)
})

test('an over-budget packet fails and is never trimmed to fit', () => {
  const got = validateHandoff('1.1', packet({ summary: 'x'.repeat(LIMITS.maxHandoffChars + 1) }))
  assert.equal(got.ok, false)
  assert.match(got.error, /the cap is 2000/)
  assert.equal(got.handoff, undefined, 'a rejected packet must not come back truncated')
})

test('the budget counts summary, next, blocker and evidence together', () => {
  // Each field is comfortably legal alone; together they are not. A per-field
  // cap would let four of these through.
  const quarter = Math.floor(LIMITS.maxHandoffChars / 3)
  const got = validateHandoff(
    '1.1',
    packet({
      status: 'partial',
      summary: 'a'.repeat(quarter),
      next: 'b'.repeat(quarter),
      blocker: 'c'.repeat(quarter),
      evidence: ['src/' + 'd'.repeat(quarter) + '.ts']
    })
  )
  assert.equal(got.ok, false)
  assert.match(got.error, /characters; the cap is/)
})

test('extra keys are dropped, not stored and not a failure', () => {
  const got = validateHandoff('1.1', packet({ filesChanged: ['a.ts'], confidence: 0.9 }))
  assert.equal(got.ok, true)
  assert.deepEqual(Object.keys(got.handoff).sort(), [
    'blocker',
    'evidence',
    'next',
    'schema',
    'status',
    'summary',
    'taskId'
  ])
})

test('a dropped schema tag is defaulted, a wrong one is refused', () => {
  // Dropping a constant string the agent was shown verbatim says nothing about
  // its work; naming a different contract version does.
  const defaulted = validateHandoff('1.1', packet({ schema: undefined }))
  assert.equal(defaulted.ok, true)
  assert.equal(defaulted.handoff.schema, HANDOFF_SCHEMA)

  const wrong = validateHandoff('1.1', packet({ schema: 'interlock.wave-handoff/2' }))
  assert.equal(wrong.ok, false)
  assert.match(wrong.error, /unknown handoff schema/)
})

test('evidence is optional and normalizes to an empty array', () => {
  const got = validateHandoff('1.1', packet({ evidence: undefined }))
  assert.equal(got.ok, true)
  assert.deepEqual(got.handoff.evidence, [])
})

test('validateHandoff does not mutate or alias the packet it was given', () => {
  const input = packet()
  const before = JSON.stringify(input)
  const got = validateHandoff('1.1', input)
  assert.equal(JSON.stringify(input), before, 'validateHandoff mutated its input')
  got.handoff.evidence.push('src/leak.ts')
  assert.equal(input.evidence.length, 2, 'the stored packet aliases the caller\'s array')
})
