import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  appendOutcome,
  observedFromReceipt,
  readOutcomes,
  formatOutcomes,
  outcomesPath,
  LEARNING_DIR,
  OUTCOMES_FILE,
  OUTCOME_SCHEMA,
  MODES,
  OBSERVED_FIELDS,
  REPORTED_FIELDS,
  SCORE_KEYS
} from '../../lib/outcomes.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-outcomes-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const base = { change: 'add-widget', mode: 'continue', riskClass: 'medium', ready: true }

const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean)

// --- appending -----------------------------------------------------------

test('one call appends exactly one parseable line', () => {
  const r = appendOutcome(tmp, base)
  assert.equal(r.written, true)
  assert.equal(r.reason, null)
  assert.equal(r.path, join(tmp, LEARNING_DIR, OUTCOMES_FILE))
  assert.equal(r.path, outcomesPath(tmp))

  const written = lines(r.path)
  assert.equal(written.length, 1)
  const record = JSON.parse(written[0])
  assert.equal(record.schema, OUTCOME_SCHEMA)
  assert.equal(record.change, 'add-widget')
  assert.equal(record.mode, 'continue')
  assert.equal(record.riskClass, 'medium')
  assert.equal(record.ready, true)
  assert.match(record.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('three calls append three lines, in order, and the file ends with a newline', () => {
  for (const change of ['one', 'two', 'three']) appendOutcome(tmp, { ...base, change })
  const raw = readFileSync(outcomesPath(tmp), 'utf8')
  assert.ok(raw.endsWith('\n'))
  assert.deepEqual(
    raw.split('\n').filter(Boolean).map(l => JSON.parse(l).change),
    ['one', 'two', 'three']
  )
})

test('both modes are recorded — the checkpoint runs are the control group', () => {
  for (const mode of MODES) {
    const r = appendOutcome(tmp, { ...base, mode })
    assert.equal(r.written, true, `mode ${mode} must be recorded`)
  }
  const read = readOutcomes(tmp)
  assert.deepEqual(read.records.map(r => r.mode), ['checkpoint', 'continue'])
})

test('an unrecognised mode is refused rather than guessed', () => {
  for (const mode of [undefined, null, '', 'auto', 'CONTINUE', true, 1]) {
    const r = appendOutcome(tmp, { ...base, mode })
    assert.equal(r.written, false, `mode=${String(mode)} should be refused`)
    assert.match(r.reason, /mode must be one of checkpoint, continue/)
  }
  assert.equal(existsSync(outcomesPath(tmp)), false)
})

test('the record carries §F4\'s fields and nothing else', () => {
  const r = appendOutcome(tmp, {
    ...base,
    decisionsHuman: 0,
    reviewArtifacts: { blockers: 0, warnings: 1 },
    observed: observedFromReceipt({
      type: 'run-receipt',
      halted: false,
      remediationRounds: 1,
      reviewBlockers: 0,
      waves: [],
      commit: 'deadbee'
    }),
    reported: { unitGreen: true },
    human: { intervened: false, wouldRejectSpec: null, notes: 'looked fine' },
    scores: { implementability: 4, specFidelity: 5, postShipChurn: 1 },
    feedback: 'no complaints'
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record).sort(), [
    'change',
    'decisionsHuman',
    'feedback',
    'human',
    'mode',
    'observed',
    'ready',
    'reported',
    'reviewArtifacts',
    'riskClass',
    'schema',
    'scores',
    'ts'
  ].sort())
  assert.deepEqual(record.reviewArtifacts, { blockers: 0, warnings: 1 })
  assert.deepEqual(record.observed, {
    receipt: true,
    ok: true,
    haltReason: null,
    remediationRounds: 1,
    codeBlockersSurviving: 0,
    waves: [],
    commit: 'deadbee'
  })
  assert.equal(record.reported.unitGreen, true)
  assert.deepEqual(record.human, { intervened: false, wouldRejectSpec: null, notes: 'looked fine' })
  assert.deepEqual(Object.keys(record.scores).sort(), [...SCORE_KEYS].sort())
  assert.equal(record.feedback, 'no complaints')
})

test('missing sub-objects become the fixed shape, with unknowns as null not false', () => {
  const r = appendOutcome(tmp, { change: 'sparse', mode: 'checkpoint' })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.ready, false)
  assert.equal(record.riskClass, null)
  assert.equal(record.decisionsHuman, 0)
  assert.deepEqual(record.reviewArtifacts, { blockers: 0, warnings: 0 })
  // Both provenance groups read unknown rather than clean — a sparse record
  // must not describe a run that halted as one that sailed through.
  assert.deepEqual(record.observed, {
    receipt: false,
    ok: null,
    haltReason: null,
    remediationRounds: null,
    codeBlockersSurviving: null,
    waves: null,
    commit: null
  })
  assert.deepEqual(record.reported, {
    unitGreen: null,
    skippedVerificationReasons: null,
    capExhaustedVerifications: null,
    unresolvedErrors: null
  })
  assert.deepEqual(record.human, { intervened: null, wouldRejectSpec: null, notes: '' })
  assert.deepEqual(record.scores, { implementability: null, specFidelity: null, postShipChurn: null })
  assert.equal(record.feedback, '')
})

test('ready is only true when it is literally true', () => {
  for (const ready of ['true', 1, {}, [1], 'yes']) {
    const r = appendOutcome(tmp, { ...base, ready })
    assert.equal(JSON.parse(lines(r.path).pop()).ready, false, `ready=${JSON.stringify(ready)}`)
  }
})

test('counts and scores are coerced rather than trusted', () => {
  const r = appendOutcome(tmp, {
    ...base,
    decisionsHuman: '3',
    reviewArtifacts: { blockers: -4, warnings: 2.7 },
    observed: { receipt: true, remediationRounds: 'lots', codeBlockersSurviving: 2.9 },
    reported: { capExhaustedVerifications: -1, unresolvedErrors: '4' },
    scores: { implementability: 9, specFidelity: -2, postShipChurn: 'x' }
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.decisionsHuman, 3)
  assert.deepEqual(record.reviewArtifacts, { blockers: 0, warnings: 2 })
  // Uncoercible reads as unknown here, not as zero: the two groups distinguish
  // "measured none" from "never found out".
  assert.equal(record.observed.remediationRounds, null)
  assert.equal(record.observed.codeBlockersSurviving, 2)
  assert.equal(record.reported.capExhaustedVerifications, null)
  assert.equal(record.reported.unresolvedErrors, 4)
  assert.deepEqual(record.scores, { implementability: 5, specFidelity: 0, postShipChurn: null })
})

test('a fat input cannot leak artifact, finding or diff text into the corpus', () => {
  const r = appendOutcome(tmp, {
    ...base,
    // Exactly the mistake this shape exists to prevent: handing the writer a
    // whole readiness result.
    blockers: [{ code: 'X', message: 'SECRET-BLOCKER', evidence: ['SECRET-EVIDENCE'] }],
    warnings: [{ code: 'W', message: 'SECRET-WARNING' }],
    checks: [{ id: 'c', status: 'fail', detail: 'SECRET-DETAIL' }],
    artifacts: { 'proposal.md': 'SECRET-PROPOSAL' },
    surviving: [{ title: 'SECRET-FINDING', description: 'SECRET-BODY' }],
    diff: 'SECRET-DIFF',
    transcript: 'SECRET-TRANSCRIPT',
    reviewArtifacts: { blockers: 1, warnings: 0, findings: ['SECRET-NESTED'] },
    observed: { receipt: true, waves: [{ wave: 1, ok: 1, failedIds: ['SECRET-LANE'], log: 'SECRET-WAVE' }] },
    reported: { unitGreen: false, suiteOutput: 'SECRET-SUITE' },
    ship: { log: 'SECRET-LOG' },
    human: { intervened: true, notes: 'kept', secret: 'SECRET-HUMAN' },
    scores: { implementability: 3, raw: 'SECRET-SCORE' }
  })
  const raw = readFileSync(r.path, 'utf8')
  for (const secret of [
    'SECRET-BLOCKER',
    'SECRET-EVIDENCE',
    'SECRET-WARNING',
    'SECRET-DETAIL',
    'SECRET-PROPOSAL',
    'SECRET-FINDING',
    'SECRET-BODY',
    'SECRET-DIFF',
    'SECRET-TRANSCRIPT',
    'SECRET-NESTED',
    'SECRET-LANE',
    'SECRET-WAVE',
    'SECRET-SUITE',
    'SECRET-LOG',
    'SECRET-HUMAN',
    'SECRET-SCORE'
  ]) {
    assert.doesNotMatch(raw, new RegExp(secret), `${secret} reached the corpus`)
  }
  const record = JSON.parse(raw.trim())
  assert.equal(record.human.notes, 'kept')
  assert.equal(record.scores.implementability, 3)
})

test('free text is bounded and never breaks the one-record-per-line invariant', () => {
  const r = appendOutcome(tmp, {
    ...base,
    change: 'x'.repeat(400),
    feedback: `line one\nline two\n${'y'.repeat(5000)}`,
    human: { notes: 'a\nb' }
  })
  const raw = readFileSync(r.path, 'utf8')
  assert.equal(raw.split('\n').filter(Boolean).length, 1)
  const record = JSON.parse(raw)
  assert.ok(record.change.length <= 120)
  assert.ok(record.feedback.length <= 500)
  assert.equal(record.human.notes, 'a b')
})

test('the timestamp can be injected for deterministic runs', () => {
  const r = appendOutcome(tmp, { ...base, now: '2026-08-12T10:00:00.000Z' })
  assert.equal(JSON.parse(lines(r.path)[0]).ts, '2026-08-12T10:00:00.000Z')
  const bad = appendOutcome(tmp, { ...base, now: 'not-a-date' })
  assert.match(JSON.parse(lines(bad.path).pop()).ts, /^\d{4}-\d{2}-\d{2}T/)
})

// --- provenance: observed is never agent-writable -------------------------
//
// The corpus exists to answer "should we have skipped the human that time?".
// A measurement the assessed party was invited to rewrite is not a measurement,
// so the writer — not the prompt — is what refuses one.

/** A receipt as `lib/run-log.mjs` stores it, for the observed half to derive from. */
const receiptOf = (extra = {}) => ({
  type: 'run-receipt',
  waves: [{ wave: 1, ok: 2, failed: 0, notAttempted: [] }],
  remediationRounds: 1,
  reviewBlockers: 0,
  halted: false,
  commit: 'deadbee',
  ...extra
})

test('an agent-supplied halt state is refused and the observed one is recorded', () => {
  const r = appendOutcome(tmp, {
    ...base,
    observed: observedFromReceipt(receiptOf({ halted: true, haltReason: 'verification failed' })),
    // Exactly what a closing agent invited to "correct any field" would send.
    ship: { ok: true }
  })
  assert.equal(r.written, true, 'a refused field must not cost the whole line')
  assert.match(r.reason, /ship\.ok/, 'a rejection is reported, never silently dropped')

  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.observed.ok, false, 'the run halted, whatever the agent said')
  assert.equal(record.observed.haltReason, 'verification failed')
  assert.equal(record.ok, undefined, 'and the agent value reaches no other key either')
})

test('an agent-supplied remediation round count is rejected rather than recorded', () => {
  const r = appendOutcome(tmp, {
    ...base,
    observed: observedFromReceipt(receiptOf({ remediationRounds: 2 })),
    reported: { remediationRounds: 0, unitGreen: true },
    ship: { remediationRounds: 9 }
  })
  assert.equal(r.written, true)
  assert.match(r.reason, /remediationRounds/)

  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.observed.remediationRounds, 2)
  assert.equal(record.reported.remediationRounds, undefined, 'observed values have one home')
  assert.equal(record.reported.unitGreen, true, 'the rest of the reported group still lands')
})

test('the groups are named in the record, so a reader needs no source access', () => {
  const r = appendOutcome(tmp, {
    ...base,
    observed: observedFromReceipt(receiptOf()),
    reported: {
      unitGreen: true,
      skippedVerificationReasons: [],
      capExhaustedVerifications: 0,
      unresolvedErrors: 0
    }
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.schema, 'interlock.outcome/2')
  assert.deepEqual(Object.keys(record.observed).sort(), [...OBSERVED_FIELDS].sort())
  assert.deepEqual(Object.keys(record.reported).sort(), [...REPORTED_FIELDS].sort())
  assert.equal(record.observed.receipt, true)
  assert.equal(record.observed.ok, true)
  assert.equal(record.observed.remediationRounds, 1)
  assert.equal(record.observed.commit, 'deadbee')
  assert.deepEqual(record.observed.waves, [{ wave: 1, ok: 2, failed: 0, notAttempted: [] }])
  assert.deepEqual(record.reported, {
    unitGreen: true,
    skippedVerificationReasons: [],
    capExhaustedVerifications: 0,
    unresolvedErrors: 0
  })
  assert.equal(record.ship, undefined, 'the flat group is gone, not shadowed')
})

test('a reported value the agent could not read stays unknown, never clean', () => {
  const r = appendOutcome(tmp, { ...base, observed: observedFromReceipt(receiptOf()) })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(record.reported, {
    unitGreen: null,
    skippedVerificationReasons: null,
    capExhaustedVerifications: null,
    unresolvedErrors: null
  })
  assert.notDeepEqual(record.reported.skippedVerificationReasons, [], 'an empty list is a claim')
  assert.notEqual(record.reported.unresolvedErrors, 0)
  assert.notEqual(record.reported.unitGreen, true)
})

test('an observed value with no receipt reads as not-observed, never as clean', () => {
  const r = appendOutcome(tmp, { ...base, observed: observedFromReceipt(null) })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.observed.receipt, false, 'the absence is itself recorded')
  assert.equal(record.observed.ok, null, 'not "the run was fine"')
  assert.equal(record.observed.remediationRounds, null, 'not "it used none"')
  assert.equal(record.observed.codeBlockersSurviving, null, 'not "zero blockers"')
  assert.equal(record.observed.waves, null)
  assert.equal(record.observed.commit, null)
})

test('a receipt whose review was never observed reports unknown, not zero blockers', () => {
  const observed = observedFromReceipt(receiptOf({ reviewBlockers: null, halted: true, haltReason: 'died early' }))
  const record = JSON.parse(lines(appendOutcome(tmp, { ...base, observed }).path)[0])
  assert.equal(record.observed.receipt, true)
  assert.equal(record.observed.codeBlockersSurviving, null)
  assert.equal(record.observed.ok, false)
})

test('the receipt and the outcome line cannot disagree — one is derived from the other', () => {
  const receipt = receiptOf({ remediationRounds: 2, halted: true, haltReason: 'unit suite red' })
  const record = JSON.parse(
    lines(appendOutcome(tmp, { ...base, observed: observedFromReceipt(receipt) }).path)[0]
  )
  assert.equal(record.observed.remediationRounds, receipt.remediationRounds)
  assert.equal(record.observed.ok, !receipt.halted)
  assert.equal(record.observed.haltReason, receipt.haltReason)
})

test('an observed group handed straight from an agent-composed record is still bounded', () => {
  // The CLI refuses `observed` from a record file outright; this is the second
  // layer, for a caller that assembles one in process.
  const r = appendOutcome(tmp, {
    ...base,
    observed: { ...observedFromReceipt(receiptOf()), haltReason: 'x'.repeat(5000), secret: 'SECRET-OBSERVED' }
  })
  const raw = readFileSync(r.path, 'utf8')
  assert.doesNotMatch(raw, /SECRET-OBSERVED/)
  assert.ok(JSON.parse(raw.trim()).observed.haltReason.length <= 500)
})

test('observedFromReceipt refuses anything that is not a receipt object', () => {
  for (const input of [null, undefined, 'a receipt', 42, ['run-receipt']]) {
    assert.equal(observedFromReceipt(input).receipt, false, `input ${JSON.stringify(input)}`)
  }
})

// --- the README ----------------------------------------------------------

test('the README is written once, explains the corpus, and is never clobbered', () => {
  appendOutcome(tmp, base)
  const readme = join(tmp, LEARNING_DIR, 'README.md')
  const first = readFileSync(readme, 'utf8')
  assert.match(first, /outcomes\.jsonl/)
  assert.match(first, /Nothing gates on this file/i)
  assert.match(first, /4\.15\(a\)|4\.15a/)
  // New repositories get the partitioned description; the two groups and the
  // rule that keeps an absence from reading as a clean value.
  assert.match(first, /`observed`/)
  assert.match(first, /`reported`/)
  assert.match(first, /Absence stays absence/i)
  assert.match(first, /interlock\.outcome\/2/)

  // Never clobbered — the file may have been hand-edited, and a repository
  // whose corpus predates the partition keeps the older description. The
  // records are self-describing through `schema`, so nothing is lost by it.
  writeFileSync(readme, 'HAND-EDITED BY A HUMAN\n')
  appendOutcome(tmp, base)
  assert.equal(readFileSync(readme, 'utf8'), 'HAND-EDITED BY A HUMAN\n')
})

test('no SCORECARD or eligibility file is created', () => {
  appendOutcome(tmp, base)
  assert.equal(existsSync(join(tmp, LEARNING_DIR, 'SCORECARD.md')), false)
})

// --- failure is always a report, never an exception ----------------------

test('an unwritable directory degrades to a reported no-op', () => {
  const blocked = join(tmp, 'blocked')
  mkdirSync(blocked, { recursive: true })
  writeFileSync(join(blocked, '.claude'), 'not a directory')
  const r = appendOutcome(blocked, base)
  assert.equal(r.written, false)
  assert.equal(r.path, null)
  assert.ok(r.reason)
})

test('a read-only learning directory degrades to a reported no-op', { skip: isRoot() }, () => {
  const dir = join(tmp, LEARNING_DIR)
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o500)
  try {
    const r = appendOutcome(tmp, base)
    assert.equal(r.written, false)
    assert.equal(r.path, null)
    assert.match(r.reason, /permission|EACCES/i)
  } finally {
    chmodSync(dir, 0o700)
  }
})

test('a missing or absent root is a no-op with a reason', () => {
  for (const root of [undefined, null, '', '   ', 42, join(tmp, 'nope')]) {
    const r = appendOutcome(root, base)
    assert.equal(r.written, false)
    assert.equal(r.path, null)
    assert.ok(r.reason)
  }
})

test('a non-object input is refused without throwing', () => {
  for (const input of ['everything', 7, [base]]) {
    const r = appendOutcome(tmp, input)
    assert.equal(r.written, false)
    assert.ok(r.reason)
  }
})

// --- reading back --------------------------------------------------------

test('reading an absent corpus is empty, not an error', () => {
  const r = readOutcomes(tmp)
  assert.equal(r.exists, false)
  assert.deepEqual(r.records, [])
  assert.deepEqual(r.skipped, [])
  assert.equal(r.reason, null)
  assert.equal(r.path, outcomesPath(tmp))
})

test('a truncated final line costs one record, never the ones before it', () => {
  appendOutcome(tmp, { ...base, change: 'first' })
  appendOutcome(tmp, { ...base, change: 'second' })
  // A crash mid-append: half a JSON object, no trailing newline.
  appendFileSync(outcomesPath(tmp), '{"schema":"interlock.outcome/1","change":"tor')

  const r = readOutcomes(tmp)
  assert.deepEqual(r.records.map(x => x.change), ['first', 'second'])
  assert.equal(r.skipped.length, 1)
  assert.equal(r.skipped[0].line, 3)
  assert.ok(r.skipped[0].reason)
})

test('a torn line is healed at the seam rather than fused to the next record', () => {
  appendOutcome(tmp, { ...base, change: 'first' })
  appendFileSync(outcomesPath(tmp), '{"change":"torn')
  const after = appendOutcome(tmp, { ...base, change: 'third' })
  assert.equal(after.written, true)

  const r = readOutcomes(tmp)
  assert.deepEqual(r.records.map(x => x.change), ['first', 'third'])
  assert.equal(r.skipped.length, 1)
})

test('garbage lines anywhere in the log are skipped, not fatal', () => {
  const path = join(tmp, LEARNING_DIR, OUTCOMES_FILE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, ['{"change":"a","mode":"continue"}', 'not json at all', '', '[1,2,3]', '"a string"', '{"change":"b","mode":"checkpoint"}'].join('\n') + '\n')
  const r = readOutcomes(tmp)
  assert.deepEqual(r.records.map(x => x.change), ['a', 'b'])
  assert.deepEqual(r.skipped.map(s => s.line), [2, 4, 5])
})

test('both schema versions read back, and the reader branches on the identifier', () => {
  // The corpus is append-only and pre-partition lines are never rewritten, so
  // a reader meets both shapes. Reading `interlock.outcome/1` as if it were /2
  // would show every old run as having observed nothing — the identifier is
  // what tells them apart, not the presence of a key.
  const old = {
    schema: 'interlock.outcome/1',
    ts: '2026-01-01T00:00:00.000Z',
    change: 'pre-partition',
    mode: 'continue',
    ship: { ok: true, remediationRounds: 1, unitGreen: true, codeBlockersSurviving: 0 }
  }
  appendOutcome(tmp, { ...base, change: 'partitioned', observed: observedFromReceipt({ halted: false }) })
  appendFileSync(outcomesPath(tmp), `${JSON.stringify(old)}\n`)

  const read = readOutcomes(tmp)
  assert.equal(read.skipped.length, 0, 'an older line is readable, not a torn one')
  assert.deepEqual(read.records.map(r => r.schema), ['interlock.outcome/2', 'interlock.outcome/1'])

  const byVersion = Object.fromEntries(read.records.map(r => [r.schema, r]))
  assert.equal(byVersion['interlock.outcome/1'].ship.remediationRounds, 1)
  assert.equal(byVersion['interlock.outcome/1'].observed, undefined)
  assert.equal(byVersion['interlock.outcome/2'].observed.receipt, true)
  assert.equal(byVersion['interlock.outcome/2'].ship, undefined)

  // The one shipped consumer reads `mode`, which both schemas carry, so it
  // needs no branch and must not acquire one by sniffing.
  assert.match(formatOutcomes(read), /2 record\(s\): 1 continue, 1 continue|2 record\(s\): 2 continue/)
})

test('reading never throws on a hostile path', () => {
  mkdirSync(join(tmp, LEARNING_DIR, OUTCOMES_FILE), { recursive: true })
  const r = readOutcomes(tmp)
  assert.deepEqual(r.records, [])
  assert.ok(r.reason)
  assert.deepEqual(readOutcomes(null).records, [])
})

// --- formatting ----------------------------------------------------------

test('formatOutcomes counts by mode and states that nothing gates on it', () => {
  appendOutcome(tmp, { ...base, mode: 'continue' })
  appendOutcome(tmp, { ...base, mode: 'checkpoint' })
  appendOutcome(tmp, { ...base, mode: 'checkpoint' })
  const text = formatOutcomes(readOutcomes(tmp))
  assert.match(text, /OUTCOMES — 3 record\(s\): 2 checkpoint, 1 continue/)
  assert.match(text, /nothing gates on these records/)
  assert.match(formatOutcomes(readOutcomes(join(tmp, 'nope'))), /none recorded/)
})

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0
}
