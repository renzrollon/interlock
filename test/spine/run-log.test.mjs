import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendRunLogEvent,
  checkRunLog,
  runLogPath,
  runLogDir,
  RUN_LOG_SCHEMA,
  RUN_LOG_TYPES,
  RUN_LOG_DIR,
  SHIP_DIR
} from '../../lib/run-log.mjs'
import { appendOutcome, outcomesPath, readOutcomes } from '../../lib/outcomes.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-run-log-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const RUN_ID = 'run-abc123'

const lines = file => readFileSync(file, 'utf8').split('\n').filter(Boolean)

// --- append order ----------------------------------------------------------

test('one call appends exactly one parseable line, seq 1', () => {
  const r = appendRunLogEvent(tmp, { runId: RUN_ID, change: 'add-widget', type: 'run-start', mode: 'checkpoint' })
  assert.equal(r.written, true)
  assert.equal(r.reason, null)
  assert.equal(r.seq, 1)
  assert.equal(r.path, runLogPath(tmp, RUN_ID))

  const written = lines(r.path)
  assert.equal(written.length, 1)
  const record = JSON.parse(written[0])
  assert.equal(record.schema, RUN_LOG_SCHEMA)
  assert.equal(record.runId, RUN_ID)
  assert.equal(record.change, 'add-widget')
  assert.equal(record.type, 'run-start')
  assert.equal(record.seq, 1)
  assert.equal(record.mode, 'checkpoint')
  assert.match(record.ts, /^\d{4}-\d{2}-\d{2}T/)
})

test('successive calls append in order with contiguous seq, and the file ends with a newline', () => {
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', action: 'run-batch', source: 'next' })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0 })

  const path = runLogPath(tmp, RUN_ID)
  const raw = readFileSync(path, 'utf8')
  assert.ok(raw.endsWith('\n'))
  const records = raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
  assert.deepEqual(records.map(r => r.seq), [1, 2, 3])
  assert.deepEqual(records.map(r => r.type), ['run-start', 'wave-action', 'cli-exit'])
})

test('two different run ids get two different files, each starting its own seq at 1', () => {
  appendRunLogEvent(tmp, { runId: 'run-one', type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(tmp, { runId: 'run-two', type: 'run-start', mode: 'continue' })
  appendRunLogEvent(tmp, { runId: 'run-one', type: 'run-halt', reason: 'x' })

  const one = lines(runLogPath(tmp, 'run-one')).map(l => JSON.parse(l))
  const two = lines(runLogPath(tmp, 'run-two')).map(l => JSON.parse(l))
  assert.deepEqual(one.map(r => r.seq), [1, 2])
  assert.deepEqual(two.map(r => r.seq), [1])
  assert.equal(runLogDir(tmp), join(tmp, RUN_LOG_DIR))
  assert.equal(runLogDir(tmp), join(tmp, SHIP_DIR, 'runs'))
})

// --- torn last line ----------------------------------------------------------

test('a torn last line costs one seq at most, not the records before it', () => {
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', action: 'run-batch', source: 'next' })
  // A crash mid-append: half a JSON object, no trailing newline.
  appendFileSync(runLogPath(tmp, RUN_ID), '{"schema":"interlock.ship-run/1","type":"cli-')

  const r = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-complete', leftoverTaskIds: [] })
  assert.equal(r.written, true)

  const raw = readFileSync(runLogPath(tmp, RUN_ID), 'utf8')
  // The heal inserts a newline before the new record rather than fusing it onto
  // the torn one, so every complete line still parses.
  const rawLines = raw.split('\n').filter(Boolean)
  const parsed = rawLines.map(l => {
    try {
      return JSON.parse(l)
    } catch {
      return null
    }
  })
  const good = parsed.filter(Boolean)
  assert.deepEqual(good.map(r2 => r2.type), ['run-start', 'wave-action', 'run-complete'])
  // seq is derived from what parses, so the healed record continues from 2, not
  // from whatever the torn line might have claimed.
  assert.equal(good[good.length - 1].seq, 3)
})

// --- unknown keys dropped ----------------------------------------------------

test('fields not declared for the event type are dropped, never leaked', () => {
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'wave-action',
    action: 'run-batch',
    source: 'next',
    wave: 2,
    // None of these are fields of `wave-action` — a caller handing the writer
    // a fat verify result or wave-state cursor must not leak them.
    cliStdout: 'SECRET-STDOUT',
    diff: 'SECRET-DIFF',
    findingBody: 'SECRET-FINDING',
    prompt: 'SECRET-PROMPT'
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record).sort(), [
    'action',
    'batchIndex',
    'change',
    'phase',
    'runId',
    'schema',
    'seq',
    'source',
    'ts',
    'type',
    'wave',
    'waveIndex'
  ].sort())
  const raw = readFileSync(r.path, 'utf8')
  for (const secret of ['SECRET-STDOUT', 'SECRET-DIFF', 'SECRET-FINDING', 'SECRET-PROMPT']) {
    assert.doesNotMatch(raw, new RegExp(secret), `${secret} reached the trajectory`)
  }
})

test('an unrecognised type is refused rather than guessed', () => {
  for (const type of [undefined, null, '', 'wave-mutation', 'RUN-START']) {
    const r = appendRunLogEvent(tmp, { runId: RUN_ID, type })
    assert.equal(r.written, false, `type=${String(type)} should be refused`)
    assert.match(r.reason, new RegExp(RUN_LOG_TYPES[0]))
  }
  assert.equal(existsSync(runLogPath(tmp, RUN_ID)), false)
})

test('a missing or unsafe runId is refused rather than guessed', () => {
  for (const runId of [undefined, null, '', '   ', '../escape', 'a/b', 'x'.repeat(200)]) {
    const r = appendRunLogEvent(tmp, { runId, type: 'run-start', mode: 'checkpoint' })
    assert.equal(r.written, false, `runId=${JSON.stringify(runId)} should be refused`)
    assert.match(r.reason, /runId/)
  }
})

test('every declared field for every type is exercised', () => {
  const cases = [
    { type: 'run-start', extra: { mode: 'continue', strict: true } },
    { type: 'wave-action', extra: { action: 'verify', wave: '3', waveIndex: 2, batchIndex: 0, phase: 'verify', source: 'record-verify' } },
    { type: 'cli-exit', extra: { command: 'verify judge', exitCode: 1, durationMs: 42 } },
    { type: 'agent-spawn', extra: { label: '1.1', model: 'sonnet', kind: 'implementer', taskId: '1.1' } },
    { type: 'verify-judgement', extra: { context: 'final', halt: true, reason: 'unit suite is red', unitStatus: 'red', spill: ['.claude/ship/spill/x/1-unit.log'] } },
    { type: 'run-halt', extra: { reason: 'more than two task failures' } },
    { type: 'run-complete', extra: { leftoverTaskIds: ['2.1'] } }
  ]
  for (const { type, extra } of cases) {
    const r = appendRunLogEvent(tmp, { runId: RUN_ID, type, ...extra })
    assert.equal(r.written, true, `${type}: ${r.reason}`)
  }
  const records = lines(runLogPath(tmp, RUN_ID)).map(l => JSON.parse(l))
  assert.deepEqual(records.map(r => r.type), cases.map(c => c.type))
  assert.equal(records[3].kind, 'implementer')
  assert.deepEqual(records[4].spill, ['.claude/ship/spill/x/1-unit.log'])
})

// --- outcomes.jsonl is untouched ---------------------------------------------

test('appending to the trajectory never writes or touches the outcomes corpus', () => {
  for (let i = 0; i < 3; i++) {
    appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', action: 'run-batch', source: 'next' })
  }
  assert.equal(existsSync(outcomesPath(tmp)), false)

  // And the reverse: the outcomes writer must not touch the trajectory dir.
  appendOutcome(tmp, { change: 'x', mode: 'checkpoint' })
  const trajectoryLinesBefore = lines(runLogPath(tmp, RUN_ID)).length
  appendOutcome(tmp, { change: 'y', mode: 'continue' })
  assert.equal(lines(runLogPath(tmp, RUN_ID)).length, trajectoryLinesBefore)
  assert.equal(readOutcomes(tmp).records.length, 2)
})

// --- failure is always a report, never an exception --------------------------

test('a missing or absent root is a no-op with a reason', () => {
  for (const root of [undefined, null, '', '   ', 42, join(tmp, 'nope')]) {
    const r = appendRunLogEvent(root, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
    assert.equal(r.written, false)
    assert.equal(r.path, null)
    assert.ok(r.reason)
  }
})

test('a non-object input is refused without throwing', () => {
  for (const input of ['everything', 7, [{ runId: RUN_ID, type: 'run-start' }]]) {
    const r = appendRunLogEvent(tmp, input)
    assert.equal(r.written, false)
    assert.ok(r.reason)
  }
})

test('the timestamp can be injected for deterministic runs', () => {
  const r = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint', now: '2026-08-12T10:00:00.000Z' })
  assert.equal(JSON.parse(lines(r.path)[0]).ts, '2026-08-12T10:00:00.000Z')
})

test('an unwritable ship directory degrades to a reported no-op', { skip: isRoot() }, () => {
  const dir = join(tmp, SHIP_DIR)
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o500)
  try {
    const r = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
    assert.equal(r.written, false)
    assert.ok(r.reason)
  } finally {
    chmodSync(dir, 0o700)
  }
})

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0
}

// --- reconstructability gate (checkRunLog) -----------------------------------

function seed(...types) {
  for (const type of types) {
    const extra =
      type === 'run-start'
        ? { mode: 'checkpoint' }
        : type === 'wave-action'
          ? { action: 'run-batch', source: 'create' }
          : type === 'cli-exit'
            ? { command: 'wave-state create', exitCode: 0 }
            : type === 'run-halt'
              ? { reason: 'x' }
              : type === 'run-complete'
                ? { leftoverTaskIds: [] }
                : {}
    appendRunLogEvent(tmp, { runId: RUN_ID, type, ...extra })
  }
}

test('a complete run — start, paired wave-action/cli-exit, complete — passes the check', () => {
  seed('run-start', 'wave-action', 'cli-exit', 'run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.equal(result.events, 4)
})

test('a halted run — start, paired events, run-halt — also passes the check', () => {
  seed('run-start', 'wave-action', 'cli-exit', 'run-halt')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, true)
})

test('a run with no trajectory file fails the check with a clear reason', () => {
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /no trajectory file found/)
})

test('missing run-start fails the check', () => {
  seed('wave-action', 'cli-exit', 'run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /missing a run-start/.test(p)))
})

test('missing a closing run-halt/run-complete fails the check', () => {
  seed('run-start', 'wave-action', 'cli-exit')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /missing a run-halt or run-complete/.test(p)))
})

test('a sequence gap fails the check', () => {
  seed('run-start', 'wave-action', 'cli-exit', 'run-complete')
  // Splice in a gap: rewrite seq 3 as seq 5.
  const path = runLogPath(tmp, RUN_ID)
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  const records = lines.map(l => JSON.parse(l))
  records[2].seq = 5
  writeFileSync(path, records.map(r => JSON.stringify(r)).join('\n') + '\n')

  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /sequence gap/.test(p)))
})

test('a wave-action with no matching cli-exit fails the check', () => {
  // Simulates a crash between the two appends `logWaveMutation` makes.
  seed('run-start', 'wave-action', 'run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /missing a cli-exit/.test(p)))
})

test('a verify-judgement with no matching cli-exit fails the check the same way', () => {
  seed('run-start')
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'verify-judgement', context: 'final', halt: false, reason: 'ok' })
  seed('run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /missing a cli-exit/.test(p)))
})

test('a torn final line is reported by name, and the healthy records before it still read as a walk', () => {
  seed('run-start', 'wave-action', 'cli-exit', 'run-complete')
  appendFileSync(runLogPath(tmp, RUN_ID), '{"schema":"interlock.ship-run/1","type":"wave-')
  const result = checkRunLog(tmp, RUN_ID)
  // The torn line makes the check fail (a torn write is exactly what the gate
  // exists to catch) — but it costs the check that one line, not the four
  // complete records before it, which the reported `events` count still reflects.
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /unreadable line/.test(p)))
  assert.equal(result.events, 4)
})
