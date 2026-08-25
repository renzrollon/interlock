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
import {
  validateHandoff,
  auditHandoffEvidence,
  HANDOFF_SCHEMA,
  AUDIT_CONFIRMED,
  AUDIT_UNCONFIRMED,
  AUDIT_NOT_AUDITED
} from '../../lib/waves.mjs'
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

// --- auditing the evidence, not just its shape -----------------------------
//
// `validateHandoff` above proves an entry LOOKS like a locator. That is the
// half `lib/review-core.mjs` already documented as defeatable on its own: the
// string `lib/nowhere.mjs:1` has perfect shape and points nowhere. The audit
// adds the second, independent condition — the cited path is one that actually
// changed — and records the answer without ever gating on it.

const evidencePacket = (evidence, over = {}) =>
  packet({ evidence, ...over })

test('every locator naming a changed path is confirmed, and the source is named', () => {
  const got = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs:40-58']),
    ['lib/export.mjs', 'test/export.test.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_CONFIRMED)
  assert.equal(got.source, 'observed')
  assert.deepEqual(got.unmatched, [])
})

test('a locator naming an untouched path is unconfirmed and says which one failed', () => {
  const got = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs:40', 'lib/nowhere.mjs:1']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_UNCONFIRMED)
  assert.deepEqual(got.unmatched, ['lib/nowhere.mjs:1'])
  assert.match(got.reason, /lib\/nowhere\.mjs:1/)
})

test('no path set from either source is not-audited, never confirmed', () => {
  // "We could not check" and "we checked and it failed" are different facts. An
  // unavailable git binary must not read as a fabricating agent.
  for (const empty of [[], undefined, null]) {
    const got = auditHandoffEvidence(evidencePacket(['lib/export.mjs:40']), empty)
    assert.equal(got.verdict, AUDIT_NOT_AUDITED, `${JSON.stringify(empty)} must not be auditable`)
    assert.notEqual(got.verdict, AUDIT_CONFIRMED)
    assert.equal(got.source, null, 'a verdict that did not run must not name a source')
    assert.match(got.reason, /no changed-path set/)
  }
})

test('a packet citing nothing is not-audited rather than blamed', () => {
  const got = auditHandoffEvidence(evidencePacket([]), ['lib/export.mjs'], { source: 'observed' })
  assert.equal(got.verdict, AUDIT_NOT_AUDITED)
  assert.match(got.reason, /cites no evidence locators/)
})

test('a leading ./ is canonicalized away and the locator is confirmed', () => {
  const got = auditHandoffEvidence(
    evidencePacket(['./lib/export.mjs:12']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_CONFIRMED)
})

test('a case-differing locator is not confirmed by a differently-cased path', () => {
  const got = auditHandoffEvidence(
    evidencePacket(['lib/Export.mjs:12']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_UNCONFIRMED)
  assert.deepEqual(got.unmatched, ['lib/Export.mjs:12'])
})

test('an unlabelled path set is recorded as reported — the weaker claim is the default', () => {
  // Defaulting the other way would label a self-reported set as observed, which
  // is the exact misrepresentation the source field exists to prevent.
  const got = auditHandoffEvidence(evidencePacket(['lib/export.mjs:1']), ['lib/export.mjs'])
  assert.equal(got.verdict, AUDIT_CONFIRMED)
  assert.equal(got.source, 'reported')
})

test('the task\'s own reported-set match is recorded separately from the verdict', () => {
  // The observed set is run-scoped: a sibling task's path confirms membership.
  // The reported-set match is the narrower question, so both are kept.
  const sibling = auditHandoffEvidence(
    evidencePacket(['lib/sibling.mjs:3']),
    ['lib/export.mjs', 'lib/sibling.mjs'],
    { source: 'observed', reportedPaths: ['lib/export.mjs'] }
  )
  assert.equal(sibling.verdict, AUDIT_CONFIRMED, 'the run did change that path')
  assert.equal(sibling.reportedMatch, false, 'but this task never claimed it')

  const own = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs:3']),
    ['lib/export.mjs', 'lib/sibling.mjs'],
    { source: 'observed', reportedPaths: ['lib/export.mjs'] }
  )
  assert.equal(own.reportedMatch, true)

  const silent = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs:3']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(silent.reportedMatch, null, 'no reported set is not a failed match')
})

test('a shaped-but-unplaceable locator cannot match anything', () => {
  // An identity that could not be computed is not an identity that matches.
  const got = auditHandoffEvidence(
    evidencePacket(['../outside.mjs:1']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_UNCONFIRMED)
})

test('the audit reads a path with no line number as a locator too', () => {
  const got = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_CONFIRMED)
})

test('the audit never asks whether the cited line exists', () => {
  // A wave that moved or deleted the cited line has not invalidated the
  // citation, so a line far past the end of any real file still confirms.
  const got = auditHandoffEvidence(
    evidencePacket(['lib/export.mjs:99999-100000']),
    ['lib/export.mjs'],
    { source: 'observed' }
  )
  assert.equal(got.verdict, AUDIT_CONFIRMED)
})
