import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendRunLogEvent,
  checkRunLog,
  deriveWaveElapsed,
  formatRunLog,
  formatRunLogList,
  listRunLogs,
  readRunLog,
  runLogPath,
  runLogDir,
  AGENT_KINDS,
  MAX_AGENT_ERRORS,
  MAX_TEXT,
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

test('every agent kind the run program spawns is one AGENT_KINDS declares', () => {
  // The field mapper coerces an unlisted kind to `other` with no warning, so a
  // kind the program spawns but this enum omits is recorded as an
  // indistinguishable agent — the silent degradation this repository refuses.
  // Walked out of the source the same way the cap-authority check walks
  // `lib/limits.mjs`'s readers.
  const source = readFileSync(new URL('../../lib/run.mjs', import.meta.url), 'utf8')
  const spawned = new Set([...source.matchAll(/\bkind:\s*'([a-z-]+)'/g)].map(m => m[1]))
  assert.ok(spawned.size >= 5, `expected the spawn kinds to be found, got ${[...spawned].join(', ')}`)
  for (const kind of spawned) {
    assert.ok(AGENT_KINDS.includes(kind), `lib/run.mjs spawns kind "${kind}", which AGENT_KINDS omits`)
  }
})

// --- measurements: duration ---------------------------------------------------

test('a duration the writer never measured is absent, not an instantaneous command', () => {
  // The `run-log append` path: a caller hands the writer an event it composed,
  // and nothing in it timed anything. `0` here would assert a command that ran
  // in no time at all — a claim, where the truth is an absence.
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'cli-exit',
    command: 'wave-state next',
    exitCode: 0
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.durationMs, null)
  assert.notEqual(record.durationMs, 0, 'an unmeasured duration must not read as an instant command')

  // And the same for a value that arrives malformed rather than missing.
  for (const durationMs of ['fast', -1, NaN, {}]) {
    const bad = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'x', exitCode: 0, durationMs })
    assert.equal(JSON.parse(lines(bad.path).pop()).durationMs, null, `durationMs=${String(durationMs)}`)
  }
})

test('a measured duration is kept as given, including a genuine zero', () => {
  // The distinction the field exists for: 0 is a measurement, null is not one.
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'a', exitCode: 0, durationMs: 0 })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'b', exitCode: 0, durationMs: 7 })
  const [a, b] = lines(runLogPath(tmp, RUN_ID)).map(l => JSON.parse(l))
  assert.equal(a.durationMs, 0)
  assert.equal(b.durationMs, 7)
})

// --- measurements: wave elapsed time comes from the timestamps ----------------

test('wave elapsed time is derived from the timestamps, with no recorded field to contradict it', () => {
  const at = s => `2026-08-12T10:00:0${s}.000Z`
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint', now: at(0) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', source: 'next', action: 'run-batch', wave: '1', now: at(1) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0, now: at(2) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'agent-spawn', label: '1.1', kind: 'implementer', now: at(3) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', source: 'record-batch', action: 'verify', wave: '1', now: at(4) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', source: 'next', action: 'run-batch', wave: '2', now: at(5) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0, now: at(9) })

  const elapsed = deriveWaveElapsed(readRunLog(tmp, RUN_ID).records)
  assert.deepEqual(elapsed.map(w => w.wave), ['1', '2'])
  assert.equal(elapsed[0].elapsedMs, 3000)
  assert.equal(elapsed[0].events, 4)
  assert.equal(elapsed[1].elapsedMs, 4000)

  // The point of deriving it: there is no second source. Nothing on the wire
  // states a wave duration, so nothing can disagree with the two timestamps
  // these numbers came out of.
  const raw = readFileSync(runLogPath(tmp, RUN_ID), 'utf8')
  assert.doesNotMatch(raw, /waveDurationMs|runDurationMs|elapsedMs/)

  assert.match(formatRunLog(readRunLog(tmp, RUN_ID)), /wave 1: 3000ms across 4 event\(s\)/)
  assert.match(formatRunLog(readRunLog(tmp, RUN_ID)), /derived from event timestamps, not a recorded field/)
})

test("the run's own close is not padded onto whichever wave happened to be last", () => {
  const at = s => `2026-08-12T10:00:${String(s).padStart(2, '0')}.000Z`
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', source: 'next', action: 'run-batch', wave: '1', now: at(1) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0, now: at(3) })
  // A close 40 seconds later: review, remediation, the commit. None of it is
  // wave 1's, and counting it there would make the last wave of every run look
  // like the expensive one.
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-receipt', waves: [], now: at(43) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-complete', leftoverTaskIds: [], now: at(44) })

  const elapsed = deriveWaveElapsed(readRunLog(tmp, RUN_ID).records)
  assert.deepEqual(elapsed.map(w => [w.wave, w.elapsedMs, w.events]), [['1', 2000, 2]])
})

test('deriving wave elapsed time never throws on a log it cannot read that way', () => {
  assert.deepEqual(deriveWaveElapsed(undefined), [])
  assert.deepEqual(deriveWaveElapsed([{ type: 'run-start', ts: 'not-a-date', seq: 1 }]), [])
  // Events before any wave-action belong to no wave and are attributed to none.
  assert.deepEqual(deriveWaveElapsed([{ type: 'run-start', ts: '2026-08-12T10:00:00.000Z', seq: 1 }]), [])
})

// --- measurements: token spend ------------------------------------------------

test('a malformed spend figure reads as unknown, never as a wave that spent nothing', () => {
  // A wave that ran agents never spends nothing, so a `0` from a coercion would
  // be wrong in the same direction on every affected run — silent, systematic,
  // and indistinguishable from a real measurement.
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    spend: [
      { wave: 1, outputTokens: 'lots' },
      { wave: 2, outputTokens: -5 },
      { wave: 3, outputTokens: NaN },
      { wave: 4 }
    ],
    outputTokens: 'plenty'
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(record.spend.map(s => s.wave), ['1', '2', '3', '4'])
  assert.deepEqual(record.spend.map(s => s.outputTokens), [null, null, null, null])
  assert.equal(record.outputTokens, null)
})

test('a host that cannot measure spend is distinguishable from a run that measured none', () => {
  const unmeasured = appendRunLogEvent(tmp, {
    runId: 'run-acp',
    type: 'run-receipt',
    spend: [{ wave: 1, outputTokens: null }],
    outputTokens: null
  })
  const measured = appendRunLogEvent(tmp, {
    runId: 'run-workflow',
    type: 'run-receipt',
    spend: [{ wave: 1, outputTokens: 0 }],
    outputTokens: 0
  })
  const a = JSON.parse(lines(unmeasured.path)[0])
  const b = JSON.parse(lines(measured.path)[0])

  assert.equal(a.spend[0].outputTokens, null, 'a host with no accounting says unknown')
  assert.equal(b.spend[0].outputTokens, 0, 'a run that measured zero says zero')
  assert.notEqual(a.spend[0].outputTokens, b.spend[0].outputTokens)
  assert.notEqual(a.outputTokens, b.outputTokens)

  // And the two are told apart in the rendering as well, not only in the file.
  assert.match(formatRunLog(readRunLog(tmp, 'run-acp')), /wave 1: unknown/)
  assert.match(formatRunLog(readRunLog(tmp, 'run-workflow')), /wave 1: 0\n/)
})

test('a spend entry cannot carry anything but a wave label and its figures', () => {
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    spend: [{ wave: 1, outputTokens: 900, lanes: ['SECRET-LANE'], prompt: 'SECRET-PROMPT' }]
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record.spend[0]).sort(), [
    'cacheCreationInputTokens',
    'cacheReadInputTokens',
    'outputTokens',
    'wave'
  ])
  assert.doesNotMatch(readFileSync(r.path, 'utf8'), /SECRET-LANE|SECRET-PROMPT/)
})

test('cache figures are absent, never zero, and their tiers are never summed', () => {
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    spend: [
      // Reported: both tiers survive as themselves.
      {
        wave: 1,
        outputTokens: 10,
        cacheReadInputTokens: 40_000,
        cacheCreationInputTokens: { ephemeral_5m: 900, ephemeral_1h: 7, 'BAD KEY': 5 }
      },
      // Not reported: absent, and specifically not `0` and not `{}`.
      { wave: 2, outputTokens: 10 }
    ],
    cacheReadInputTokens: 40_000,
    cacheCreationInputTokens: { ephemeral_5m: 900, ephemeral_1h: 7 }
  })
  const record = JSON.parse(lines(r.path)[0])

  assert.equal(record.spend[0].cacheReadInputTokens, 40_000)
  assert.deepEqual(record.spend[0].cacheCreationInputTokens, { ephemeral_5m: 900, ephemeral_1h: 7 })
  assert.notEqual(record.spend[0].cacheCreationInputTokens, 907, 'the tiers are never summed')

  assert.equal(record.spend[1].cacheReadInputTokens, null)
  assert.equal(record.spend[1].cacheCreationInputTokens, null)

  // A measured zero survives as a zero, which is a different fact from absence.
  const measured = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    spend: [{ wave: 1, outputTokens: 1, cacheReadInputTokens: 5, cacheCreationInputTokens: { ephemeral_5m: 0 } }]
  })
  const zeroed = JSON.parse(lines(measured.path).at(-1))
  assert.deepEqual(zeroed.spend[0].cacheCreationInputTokens, { ephemeral_5m: 0 })
})

// --- the rendering must not undo the coercion --------------------------------

test('an absent duration and an absent spend both render as unknown, never as zero', () => {
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0 })
  appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    waves: [{ wave: 1, ok: 1, failed: 0, notAttempted: [] }],
    spend: [{ wave: 1, outputTokens: null }]
  })
  const rendered = formatRunLog(readRunLog(tmp, RUN_ID))

  // Printing null as `0`, `0ms` or an empty column would undo the whole
  // distinction at the last hop, where nothing downstream could see it.
  const durationLine = rendered.split('\n').find(l => l.includes('durationMs'))
  assert.match(durationLine, /durationMs=unknown/)
  assert.doesNotMatch(durationLine, /durationMs=(0|0ms|null|""|\s|$)/)

  const spendLines = rendered
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^wave 1: unknown$|^run total:/.test(l))
  assert.deepEqual(spendLines, ['wave 1: unknown', 'run total: unknown'])
  for (const line of spendLines) assert.doesNotMatch(line, /0/, `${line} rendered an unknown as a zero`)

  // The framing rides with the figure, so nobody reads a wave aggregate as
  // implementer cost or divides it by a lane count.
  assert.match(rendered, /aggregate over the wave span — orchestrator turns included, not implementer cost/)
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

// --- the run receipt ---------------------------------------------------------
//
// The receipt is the largest payload in the table and the one built from the
// orchestrator's whole `summary` object — which holds a review result with
// finding bodies and a verify result with suite output. So the leak test below
// is not a formality: it is the reason the whitelist is the integrity boundary
// that makes transporting a receipt through an agent acceptable at all.

/** A receipt payload with every field observed. */
function fullReceipt(over = {}) {
  return {
    runId: RUN_ID,
    change: 'add-widget',
    type: 'run-receipt',
    waves: [
      { wave: 1, ok: 3, failed: 0, notAttempted: [] },
      { wave: 2, ok: 1, failed: 1, notAttempted: ['2.3'] }
    ],
    spend: [
      { wave: 1, outputTokens: 41200 },
      { wave: 2, outputTokens: 18700 }
    ],
    outputTokens: 74300,
    planReused: true,
    planStatus: 'match',
    planReason: 'the stored plan still matches every input it was built from',
    planFingerprint: 'f'.repeat(64),
    reviewRaised: 4,
    reviewSurviving: 2,
    reviewBlockers: 1,
    reviewWarnings: 1,
    remediationRounds: 2,
    skippedVerifications: 1,
    capExhaustedVerifications: 1,
    unresolvedErrors: 0,
    leftoverTaskIds: ['2.2'],
    halted: false,
    haltReason: null,
    committed: true,
    commit: 'deadbee',
    touchedPaths: ['lib/run-log.mjs', 'test/spine/run-log.test.mjs'],
    touchedPathsReason: null,
    predictedPaths: ['lib/run-log.mjs'],
    predictedPathsComplete: true,
    predictedPathsReason: null,
    degradations: ['VERIFY CAP EXHAUSTED: 1 inter-wave checkpoint(s) were skipped'],
    ...over
  }
}

test('a receipt records every field it was handed, per-wave tallies included', () => {
  const r = appendRunLogEvent(tmp, fullReceipt())
  assert.equal(r.written, true)
  const record = JSON.parse(lines(r.path)[0])

  assert.equal(record.type, 'run-receipt')
  assert.deepEqual(record.waves, [
    { wave: '1', ok: 3, failed: 0, notAttempted: 0 },
    { wave: '2', ok: 1, failed: 1, notAttempted: 1 }
  ])
  assert.equal(record.planReused, true)
  assert.equal(record.planStatus, 'match')
  assert.equal(record.planFingerprint, 'f'.repeat(64))
  assert.equal(record.reviewBlockers, 1)
  assert.equal(record.reviewWarnings, 1)
  assert.equal(record.remediationRounds, 2)
  assert.equal(record.capExhaustedVerifications, 1)
  assert.deepEqual(record.leftoverTaskIds, ['2.2'])
  assert.equal(record.halted, false)
  assert.equal(record.committed, true)
  assert.equal(record.commit, 'deadbee')
  assert.equal(record.degradations.length, 1)
  // The cache figures ride the same rows, absent on a fixture that reported
  // none — never zero, which would assert a run that read nothing from cache.
  assert.deepEqual(record.spend, [
    { wave: '1', outputTokens: 41200, cacheReadInputTokens: null, cacheCreationInputTokens: null },
    { wave: '2', outputTokens: 18700, cacheReadInputTokens: null, cacheCreationInputTokens: null }
  ])
  // Not the sum of the wave figures, and deliberately so: validation, planning,
  // review and the commit are in the run total and in none of the wave spans.
  assert.equal(record.outputTokens, 74300)
})

test('a fat summary object cannot leak finding bodies or suite output into a receipt', () => {
  // The exact object shape `workflows/ship.js` accumulates: `summary.review` is
  // a review result and `summary.closing` a verify/closing result, both of which
  // carry text nobody wants in a corpus future agents read back.
  const r = appendRunLogEvent(tmp, {
    ...fullReceipt(),
    review: {
      blockers: 1,
      findings: [{ title: 'SECRET-FINDING-TITLE', description: 'SECRET-FINDING-BODY' }]
    },
    verification: { suiteOutput: 'SECRET-SUITE-LOG', failures: ['SECRET-FAILURE'] },
    diff: 'SECRET-DIFF',
    prompt: 'SECRET-PROMPT',
    // A nested group carrying content on the same objects the tallies come from:
    // element-by-element coercion is what stops this, not the top-level list.
    waves: [{ wave: 1, ok: 1, failed: 0, notAttempted: [], handoffs: ['SECRET-HANDOFF'], diff: 'SECRET-WAVE-DIFF' }]
  })

  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record.waves[0]).sort(), ['failed', 'notAttempted', 'ok', 'wave'])
  assert.equal(record.review, undefined)
  assert.equal(record.verification, undefined)

  const raw = readFileSync(r.path, 'utf8')
  for (const secret of [
    'SECRET-FINDING-TITLE',
    'SECRET-FINDING-BODY',
    'SECRET-SUITE-LOG',
    'SECRET-FAILURE',
    'SECRET-DIFF',
    'SECRET-PROMPT',
    'SECRET-HANDOFF',
    'SECRET-WAVE-DIFF'
  ]) {
    assert.doesNotMatch(raw, new RegExp(secret), `${secret} reached the trajectory`)
  }
})

test('a receipt writes the same field set however thin the input was', () => {
  // Shape is fixed by the whitelist, not by what the caller happened to know —
  // which is what lets two hosts write "the same" receipt and a reader stay
  // unable to tell which one produced it.
  const full = appendRunLogEvent(tmp, fullReceipt())
  const thin = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-receipt' })
  const [a, b] = lines(full.path).map(l => JSON.parse(l))
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort())
  assert.equal(thin.written, true)
})

test('review counts nobody observed read as absent, never as zero blockers', () => {
  // A run that halted before its review step. Reporting 0 blockers here would
  // make the corpus flatter exactly the runs it exists to explain.
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    halted: true,
    haltReason: 'wave 2 failed every task',
    waves: [{ wave: 1, ok: 2, failed: 0, notAttempted: [] }]
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.reviewBlockers, null)
  assert.equal(record.reviewWarnings, null)
  assert.equal(record.reviewRaised, null)
  assert.equal(record.reviewSurviving, null)
  assert.equal(record.remediationRounds, null)
  assert.equal(record.skippedVerifications, null)
  assert.equal(record.unresolvedErrors, null)
  assert.equal(record.planReused, null, 'an unobserved plan verdict is not a rebuild')
})

test('"did not commit" and "never found out" are different receipts', () => {
  const declined = appendRunLogEvent(tmp, fullReceipt({ committed: false, commit: null }))
  const unobserved = appendRunLogEvent(tmp, fullReceipt({ committed: undefined, commit: undefined }))
  const [a, b] = lines(declined.path).map(l => JSON.parse(l))

  assert.equal(a.committed, false, 'a --no-commit run says so')
  assert.equal(a.commit, null)
  assert.equal(b.committed, null, 'a run that never reached its commit step says only that')
  assert.equal(b.commit, null)
  assert.notEqual(a.committed, b.committed)
  assert.equal(unobserved.written, true)
})

// --- the effort capability on the receipt's host block -----------------------
//
// Read as bounded text, the way `billing` is: this module cannot import the
// registry's legal values. A receipt written before the capability existed reads
// `null` — not recorded — never the assumed `flag` nor `unsupported`.

const HOST = { id: 'claude', billing: 'claude-subscription-programmatic', hooks: true, usage: true, cacheAccounting: true }

test('a stored receipt\'s effort capability reads back as stored', () => {
  for (const effort of ['flag', 'negotiated', 'unsupported']) {
    const runId = `${RUN_ID}-${effort}`
    appendRunLogEvent(tmp, { runId, type: 'run-receipt', host: { ...HOST, effort } })
    const [record] = readRunLog(tmp, runId).records
    assert.equal(record.host.effort, effort, `a receipt recording effort: ${effort}`)
  }
})

test('a stored receipt with no effort capability reads null, never flag or unsupported', () => {
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-receipt', host: { ...HOST } })
  const [record] = readRunLog(tmp, RUN_ID).records
  assert.equal(record.host.effort, null, 'not recorded')
})

// --- the two path sets -------------------------------------------------------
//
// These are the receipt's contribution to "did the merged diff match the plan",
// and the whole indicator rests on one distinction surviving into the corpus: a
// run that made no commit recorded NO touched set, which is not the same fact as
// a commit that touched nothing. A single `[]` in the wrong place turns "we did
// not measure" into "we measured zero" for every reader downstream.

test('an observed path set round-trips, both directions', () => {
  const r = appendRunLogEvent(tmp, fullReceipt())
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(record.touchedPaths, ['lib/run-log.mjs', 'test/spine/run-log.test.mjs'])
  assert.deepEqual(record.predictedPaths, ['lib/run-log.mjs'])
  assert.equal(record.predictedPathsComplete, true)
  assert.equal(record.touchedPathsTruncated, false)
  assert.equal(record.predictedPathsTruncated, false)
})

test('an absent path set reads as unobserved, never as an empty set', () => {
  const r = appendRunLogEvent(
    tmp,
    fullReceipt({
      committed: false,
      commit: null,
      touchedPaths: undefined,
      touchedPathsReason: 'the run made no commit',
      predictedPaths: undefined,
      predictedPathsComplete: undefined,
      predictedPathsReason: 'the executed plan could not be read back at close'
    })
  )
  const record = JSON.parse(lines(r.path)[0])

  assert.equal(record.touchedPaths, null, 'no commit means no touched set was observed')
  assert.notDeepEqual(record.touchedPaths, [], 'an empty set would assert a commit that touched nothing')
  assert.equal(record.touchedPathsReason, 'the run made no commit')
  assert.equal(record.touchedPathsTruncated, null, 'an unread set was never truncated, it was never read')
  assert.equal(record.predictedPaths, null)
  assert.equal(record.predictedPathsComplete, null, 'an unread plan is not a complete prediction')
  assert.equal(record.predictedPathsReason, 'the executed plan could not be read back at close')
})

test('an observed empty set stays an empty set, distinct from an absent one', () => {
  const r = appendRunLogEvent(tmp, fullReceipt({ touchedPaths: [], touchedPathsReason: null }))
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(record.touchedPaths, [], 'an empty commit genuinely touched nothing')
  assert.notEqual(record.touchedPaths, null)
})

test('a path set past its bound is marked truncated and the append still succeeds', () => {
  const many = Array.from({ length: 500 }, (_, i) => `src/file-${i}.ts`)
  const r = appendRunLogEvent(tmp, fullReceipt({ touchedPaths: many, predictedPaths: many }))
  assert.equal(r.written, true, 'truncation bounds the payload; it never fails the close')

  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.touchedPathsTruncated, true)
  assert.equal(record.predictedPathsTruncated, true)
  assert.ok(record.touchedPaths.length < many.length, 'the recorded set is a prefix')
  assert.ok(record.touchedPaths.length > 0)
  assert.equal(record.touchedPaths[0], 'src/file-0.ts', 'a prefix, in order')
})

test('a fat commit result cannot leak diff hunks or file contents through the path set', () => {
  // The realistic shape: a commit step that returned its own diff alongside the
  // paths. Only the named path strings are copied — the surrounding object is
  // never spread, and neither is any element of it.
  const r = appendRunLogEvent(tmp, {
    ...fullReceipt(),
    touchedPaths: ['lib/run-log.mjs', { path: 'lib/leak.mjs', hunk: 'SECRET-HUNK' }, 'lib/report.mjs'],
    commitResult: {
      sha: 'deadbee',
      diff: 'SECRET-DIFF-BODY',
      files: [{ path: 'lib/run-log.mjs', contents: 'SECRET-FILE-CONTENTS' }]
    }
  })
  const raw = readFileSync(r.path, 'utf8')
  const record = JSON.parse(lines(r.path)[0])

  assert.deepEqual(record.touchedPaths, ['lib/run-log.mjs', 'lib/report.mjs'], 'non-strings are dropped, not stringified')
  for (const secret of ['SECRET-HUNK', 'SECRET-DIFF-BODY', 'SECRET-FILE-CONTENTS']) {
    assert.doesNotMatch(raw, new RegExp(secret), `${secret} reached the trajectory`)
  }
})

test('an incomplete prediction is recorded as incomplete, not as a short set', () => {
  const r = appendRunLogEvent(
    tmp,
    fullReceipt({
      predictedPaths: ['lib/run-log.mjs'],
      predictedPathsComplete: false,
      predictedPathsReason: 'not every executed task declared its paths'
    })
  )
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(record.predictedPaths, ['lib/run-log.mjs'])
  assert.equal(record.predictedPathsComplete, false)
  assert.match(record.predictedPathsReason, /not every executed task/)
})

test('the run summary carries the path sets tri-state, and renders neither as an empty list', () => {
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint', change: 'add-widget' })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-complete', change: 'add-widget' })
  appendRunLogEvent(
    tmp,
    fullReceipt({
      committed: false,
      commit: null,
      touchedPaths: undefined,
      touchedPathsReason: 'the run made no commit'
    })
  )

  const [summary] = listRunLogs(tmp)
  assert.equal(summary.touchedPathCount, null, 'unobserved is null, not 0')
  assert.equal(summary.touchedPathsReason, 'the run made no commit')
  assert.equal(summary.predictedPathCount, 1)
  assert.equal(summary.predictedPathsComplete, true)
  assert.equal(summary.pathsTruncated, false)

  const rendered = formatRunLog(readRunLog(tmp, RUN_ID))
  assert.match(rendered, /paths touched \(read from version control\): unknown \(the run made no commit\)/)
  assert.doesNotMatch(rendered, /paths touched[^\n]*\[\]/, 'an unobserved set must never render as an empty list')
})

test('a commit step that reported failure yields no fabricated identifier', () => {
  const r = appendRunLogEvent(tmp, fullReceipt({ committed: false, commit: '' }))
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.committed, false)
  assert.equal(record.commit, null, 'an empty sha is absent, not an identifier')
})

test('a halted receipt names the halt and lists what was left', () => {
  const r = appendRunLogEvent(
    tmp,
    fullReceipt({
      halted: true,
      haltReason: 'wave 2: two tasks failed and the fix budget was spent',
      leftoverTaskIds: ['2.1', '2.2'],
      committed: undefined,
      commit: undefined
    })
  )
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.halted, true)
  assert.match(record.haltReason, /wave 2/)
  assert.deepEqual(record.leftoverTaskIds, ['2.1', '2.2'])
  assert.equal(record.commit, null)
})

test('a receipt append failure is reported, never raised', () => {
  // Same contract as every other append: losing the receipt must not lose the
  // run that earned it.
  const r = appendRunLogEvent(join(tmp, 'nope'), fullReceipt())
  assert.equal(r.written, false)
  assert.match(r.reason, /root does not exist/)
})

// --- the receipt, read back --------------------------------------------------

test('a run with a receipt passes reconstructability', () => {
  seed('run-start', 'wave-action', 'cli-exit')
  appendRunLogEvent(tmp, fullReceipt())
  seed('run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)
})

test('a closed run with no receipt still reconstructs, and says it has none', () => {
  // A run that died between its closing step and the receipt append. The gate
  // must not withhold the trajectory a reader most needs — but the absence is
  // a finding, so a reader listing the run can still see it.
  seed('run-start', 'wave-action', 'cli-exit', 'run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, true, result.problems.join('; '))
  assert.equal(
    result.problems.some(p => /receipt/.test(p)),
    false,
    'a missing receipt is not a reconstructability problem'
  )

  const [listed] = listRunLogs(tmp)
  assert.equal(listed.receipt, false)
  assert.match(formatRunLogList([listed]), /no receipt recorded/)
})

test('two receipts on one run is reported: a run has one close', () => {
  seed('run-start', 'wave-action', 'cli-exit')
  appendRunLogEvent(tmp, fullReceipt())
  appendRunLogEvent(tmp, fullReceipt())
  seed('run-complete')
  const result = checkRunLog(tmp, RUN_ID)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /one close and therefore one receipt/.test(p)))
})

test('the list surfaces the commit identifier and the halt from the receipt', () => {
  seed('run-start')
  appendRunLogEvent(tmp, fullReceipt())
  seed('run-complete')
  const [listed] = listRunLogs(tmp)
  assert.equal(listed.commit, 'deadbee')
  assert.equal(listed.committed, true)
  assert.equal(listed.receipt, true)
  assert.match(formatRunLogList([listed]), /commit=deadbee/)
})

test('a halted receipt is enough for the list to report the halt', () => {
  // The halt event and the receipt agree by construction, but a trajectory
  // missing the run-halt line still has the receipt's own account of it.
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(tmp, fullReceipt({ halted: true, haltReason: 'verification halted the run' }))
  const [listed] = listRunLogs(tmp)
  assert.equal(listed.halted, true)
  assert.match(listed.haltReason, /verification halted/)
})

test('a receipt renders absent fields as unknown, never as 0 or blank', () => {
  appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-receipt',
    halted: true,
    haltReason: 'wave 1 failed',
    waves: [{ wave: 1, ok: 0, failed: 2, notAttempted: ['1.3'] }]
  })
  const rendered = formatRunLog(readRunLog(tmp, RUN_ID))

  assert.match(rendered, /halted: wave 1 failed/)
  assert.match(rendered, /plan: unknown \(unknown\)/)
  assert.match(rendered, /fingerprint unknown/)
  assert.match(rendered, /review: unknown raised, unknown surviving, unknown blockers, unknown warnings/)
  assert.match(rendered, /remediation rounds: unknown/)
  assert.match(rendered, /commit: unknown/)
  assert.match(rendered, /wave 1: 0 ok, 2 failed, 1 not attempted/)
  assert.match(rendered, /degradations: none recorded/)
  assert.doesNotMatch(rendered, /review: 0 raised/, 'an unobserved review must not read as a clean one')
})

// --- portable without the repository ----------------------------------------

test('a trajectory copied off its machine still answers what the run did', () => {
  // No checkout, no change artifacts, no test suite: only the file. Everything
  // asserted here is read out of the copy, not out of `tmp`.
  appendRunLogEvent(tmp, { runId: RUN_ID, change: 'add-widget', type: 'run-start', mode: 'checkpoint' })
  appendRunLogEvent(
    tmp,
    fullReceipt({
      halted: true,
      haltReason: 'wave 2: unresolved blockers after remediation',
      leftoverTaskIds: ['2.1', '2.2'],
      committed: false,
      commit: null
    })
  )
  appendRunLogEvent(tmp, {
    runId: RUN_ID,
    change: 'add-widget',
    type: 'run-halt',
    reason: 'wave 2: unresolved blockers after remediation'
  })

  const elsewhere = mkdtempSync(join(tmpdir(), 'interlock-run-log-copy-'))
  try {
    mkdirSync(join(elsewhere, RUN_LOG_DIR), { recursive: true })
    writeFileSync(runLogPath(elsewhere, RUN_ID), readFileSync(runLogPath(tmp, RUN_ID)))

    const [listed] = listRunLogs(elsewhere)
    assert.equal(listed.change, 'add-widget')
    assert.equal(listed.halted, true)
    assert.match(listed.haltReason, /unresolved blockers/)
    assert.equal(listed.committed, false)

    const rendered = formatRunLog(readRunLog(elsewhere, RUN_ID))
    assert.match(rendered, /wave 1: 3 ok, 0 failed, 0 not attempted/)
    assert.match(rendered, /wave 2: 1 ok, 1 failed, 1 not attempted/)
    assert.match(rendered, /leftover tasks: 2\.1, 2\.2/)
    assert.match(rendered, /commit: no commit was made/)
    assert.match(rendered, /VERIFY CAP EXHAUSTED/)
    assert.match(rendered, /fingerprint f{64}/)
  } finally {
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('two runs of one plan match on the fingerprint and carry no plan contents', () => {
  const hash = 'c'.repeat(64)
  const first = 'run-first'
  const second = 'run-second'
  for (const runId of [first, second]) {
    appendRunLogEvent(tmp, { runId, type: 'run-start', change: 'add-widget', mode: 'checkpoint' })
    appendRunLogEvent(tmp, {
      ...fullReceipt({ planFingerprint: hash }),
      runId,
      // What a caller holding the whole plan would hand the writer.
      plan: { waves: [{ group: 1, tasks: [{ id: '1.1', description: 'PLAN-CONTENTS' }] }] }
    })
  }
  const a = JSON.parse(readFileSync(runLogPath(tmp, first), 'utf8').split('\n')[1])
  const b = JSON.parse(readFileSync(runLogPath(tmp, second), 'utf8').split('\n')[1])

  assert.equal(a.planFingerprint, b.planFingerprint)
  assert.equal(a.planFingerprint, hash)
  for (const runId of [first, second]) {
    const raw = readFileSync(runLogPath(tmp, runId), 'utf8')
    assert.doesNotMatch(raw, /PLAN-CONTENTS/, 'the receipt carries a plan identity, not a plan')
    assert.doesNotMatch(raw, /"plan":/)
  }
})

// --- the agent-result event (design D8) --------------------------------------
//
// One per observed agent: the host's envelope on the runner, the agent's own
// transcript on the Workflow host. The source object is a whole host record or
// a whole sidecar file, so the whitelist is what keeps a lane's stdout, its
// result body and its tool inputs out of a file future agents read back.

/** An agent-result with every field observed, as the runner's record path builds it. */
function fullAgentResult(over = {}) {
  return {
    runId: RUN_ID,
    change: 'add-widget',
    type: 'agent-result',
    label: '1.1',
    kind: 'implementer',
    agentId: 'agent-7',
    source: 'envelope',
    subtype: 'error_max_turns',
    isError: true,
    terminalReason: 'max_turns',
    errors: ['Reached maximum number of turns (1)'],
    permissionDenials: { count: 2, tools: ['Bash', 'Edit'] },
    sessionId: '00000000-0000-4000-8000-000000000000',
    numTurns: 2,
    modelRouted: 'sonnet',
    servedModels: ['claude-sonnet-5-5'],
    sessionModels: ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5'],
    modelScope: 'turns',
    substituted: false,
    resultMissing: false,
    usage: {
      inputTokens: 12,
      outputTokens: 64,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: { ephemeral_5m: 2048, ephemeral_1h: 0 }
    },
    hostCostUsd: 0.0123,
    ...over
  }
}

const AGENT_RESULT_KEYS = [
  'schema', 'ts', 'runId', 'change', 'seq', 'type',
  'label', 'kind', 'agentId', 'source', 'subtype', 'isError', 'terminalReason', 'errors',
  'permissionDenials', 'sessionId', 'numTurns', 'modelRouted', 'servedModels', 'sessionModels',
  'modelScope', 'substituted', 'resultMissing', 'usage', 'hostCostUsd'
].sort()

test('agent-result is a trajectory type, and adding it left the schema id alone', () => {
  assert.ok(RUN_LOG_TYPES.includes('agent-result'))
  assert.equal(RUN_LOG_SCHEMA, 'interlock.ship-run/1', 'the type is additive: old readers skip what they do not know')
})

test('an agent-result records every named field it was handed', () => {
  const r = appendRunLogEvent(tmp, fullAgentResult())
  assert.equal(r.written, true, r.reason)
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record).sort(), AGENT_RESULT_KEYS)
  assert.equal(record.label, '1.1')
  assert.equal(record.kind, 'implementer')
  assert.equal(record.agentId, 'agent-7')
  assert.equal(record.source, 'envelope')
  assert.equal(record.subtype, 'error_max_turns')
  assert.equal(record.isError, true)
  assert.equal(record.terminalReason, 'max_turns')
  assert.deepEqual(record.errors, ['Reached maximum number of turns (1)'])
  assert.deepEqual(record.permissionDenials, { count: 2, tools: ['Bash', 'Edit'] })
  assert.equal(record.sessionId, '00000000-0000-4000-8000-000000000000')
  assert.equal(record.numTurns, 2)
  assert.equal(record.modelRouted, 'sonnet')
  assert.deepEqual(record.servedModels, ['claude-sonnet-5-5'])
  assert.deepEqual(record.sessionModels, ['bedrock.claude-sonnet-5', 'bedrock.claude-haiku-4-5'])
  assert.equal(record.modelScope, 'turns')
  assert.equal(record.substituted, false)
  assert.equal(record.resultMissing, false)
  assert.deepEqual(record.usage, {
    inputTokens: 12,
    outputTokens: 64,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: { ephemeral_5m: 2048, ephemeral_1h: 0 }
  })
  assert.equal(record.hostCostUsd, 0.0123)
})

test('an agent-result handed a whole host record keeps only the named fields', () => {
  const r = appendRunLogEvent(tmp, {
    ...fullAgentResult(),
    // What a host record, an envelope or a sidecar file carries beside the
    // fields: none of it is the trajectory's to keep.
    stdout: 'SECRET-STDOUT',
    diff: 'SECRET-DIFF',
    result: 'SECRET-RESULT-BODY',
    structured_output: { tasks: ['SECRET-STRUCTURED'] },
    transcript: { path: '/x/SECRET-TRANSCRIPT.jsonl' },
    permissionDenials: { count: 1, tools: ['Bash'], toolInput: { command: 'SECRET-TOOL-INPUT' } },
    usage: { inputTokens: 1, outputTokens: 2, costUSD: 'SECRET-COST', server_tool_use: { web: 'SECRET-USE' } }
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.deepEqual(Object.keys(record).sort(), AGENT_RESULT_KEYS)
  assert.deepEqual(Object.keys(record.permissionDenials).sort(), ['count', 'tools'])
  assert.deepEqual(
    Object.keys(record.usage).sort(),
    ['cacheCreationInputTokens', 'cacheReadInputTokens', 'inputTokens', 'outputTokens']
  )
  const raw = readFileSync(r.path, 'utf8')
  for (const secret of [
    'SECRET-STDOUT', 'SECRET-DIFF', 'SECRET-RESULT-BODY', 'SECRET-STRUCTURED',
    'SECRET-TRANSCRIPT', 'SECRET-TOOL-INPUT', 'SECRET-COST', 'SECRET-USE'
  ]) {
    assert.doesNotMatch(raw, new RegExp(secret), `${secret} reached the trajectory`)
  }
})

test('an agent-result bounds its errors by count and by length', () => {
  // A record-shape bound like the path sets', not a policy cap: a host that
  // returned a thousand error strings must not write a thousand into the log.
  const many = Array.from({ length: MAX_AGENT_ERRORS + 5 }, (_, i) => `error ${i} ${'x'.repeat(2 * MAX_TEXT)}`)
  const r = appendRunLogEvent(tmp, fullAgentResult({ errors: [...many, 42, { message: 'SECRET-OBJECT' }] }))
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(MAX_AGENT_ERRORS, 10)
  assert.equal(record.errors.length, MAX_AGENT_ERRORS)
  assert.match(record.errors[0], /^error 0 /, 'a prefix, in order')
  for (const e of record.errors) assert.ok(e.length <= MAX_TEXT, `an error of ${e.length} chars passed the text bound`)
  assert.doesNotMatch(readFileSync(r.path, 'utf8'), /SECRET-OBJECT/)
})

test('an agent-result records an omitted field as absent and a measured zero as zero', () => {
  // Every figure on this event is something a host may or may not have said.
  // A field the source omits is null — never 0, never false, never [] — and a
  // zero the host reported is kept as the measurement it is.
  const thin = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'agent-result', label: '1.1' })
  assert.equal(thin.written, true, thin.reason)
  const absent = JSON.parse(lines(thin.path)[0])
  assert.deepEqual(Object.keys(absent).sort(), AGENT_RESULT_KEYS, 'the same field set however thin the input')
  for (const key of [
    'kind', 'agentId', 'source', 'subtype', 'isError', 'terminalReason', 'errors', 'permissionDenials',
    'sessionId', 'numTurns', 'modelRouted', 'servedModels', 'sessionModels', 'modelScope',
    'substituted', 'resultMissing', 'usage', 'hostCostUsd'
  ]) {
    assert.equal(absent[key], null, `${key} was not observed, so it is null`)
  }

  const zero = appendRunLogEvent(
    tmp,
    fullAgentResult({
      numTurns: 0,
      errors: [],
      permissionDenials: { count: 0, tools: [] },
      hostCostUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: { total: 0 } }
    })
  )
  const measured = JSON.parse(lines(zero.path).at(-1))
  assert.equal(measured.numTurns, 0)
  assert.deepEqual(measured.errors, [], 'observed and empty is not unobserved')
  assert.deepEqual(measured.permissionDenials, { count: 0, tools: [] })
  assert.equal(measured.hostCostUsd, 0)
  assert.deepEqual(measured.usage, {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: { total: 0 }
  })

  // A usage block with a figure missing keeps that one figure unknown.
  const partial = appendRunLogEvent(tmp, fullAgentResult({ usage: { outputTokens: 9 } }))
  assert.deepEqual(JSON.parse(lines(partial.path).at(-1)).usage, {
    inputTokens: null,
    outputTokens: 9,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null
  })
})

test('an agent-result coerces a malformed value to absent, never to a guess', () => {
  const r = appendRunLogEvent(
    tmp,
    fullAgentResult({
      source: 'stdout',
      modelScope: 'everything',
      isError: 'yes',
      substituted: 1,
      resultMissing: 'false',
      numTurns: -3,
      hostCostUsd: '0.5',
      permissionDenials: 'two',
      usage: 'lots',
      servedModels: 'claude-sonnet-5-5',
      kind: 'wizard'
    })
  )
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.source, null)
  assert.equal(record.modelScope, null)
  assert.equal(record.isError, null)
  assert.equal(record.substituted, null)
  assert.equal(record.resultMissing, null)
  assert.equal(record.numTurns, null)
  assert.equal(record.hostCostUsd, null, 'a cost is a number or it is unknown')
  assert.equal(record.permissionDenials, null)
  assert.equal(record.usage, null)
  assert.equal(record.servedModels, null, 'a bare string is not a model list')
  // Same rule as agent-spawn: a kind given but unlisted reads as `other`.
  assert.equal(record.kind, 'other')

  for (const hostCostUsd of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, true]) {
    const bad = appendRunLogEvent(tmp, fullAgentResult({ hostCostUsd }))
    assert.equal(JSON.parse(lines(bad.path).at(-1)).hostCostUsd, null, `hostCostUsd=${String(hostCostUsd)}`)
  }
  for (const source of ['envelope', 'transcript']) {
    const ok = appendRunLogEvent(tmp, fullAgentResult({ source }))
    assert.equal(JSON.parse(lines(ok.path).at(-1)).source, source)
  }
  for (const modelScope of ['turns', 'session']) {
    const ok = appendRunLogEvent(tmp, fullAgentResult({ modelScope }))
    assert.equal(JSON.parse(lines(ok.path).at(-1)).modelScope, modelScope)
  }
})

test('an agent-result keeps the cache-creation tiers apart and never sums them', () => {
  const at = over => {
    const r = appendRunLogEvent(tmp, fullAgentResult(over))
    return JSON.parse(lines(r.path).at(-1)).usage.cacheCreationInputTokens
  }
  // The split the transcript reported: both tiers, as themselves.
  assert.deepEqual(
    at({ usage: { cacheCreationInputTokens: { ephemeral_5m: 900, ephemeral_1h: 7, 'BAD KEY': 5 } } }),
    { ephemeral_5m: 900, ephemeral_1h: 7 }
  )
  // One tier reported, the other unknown — not zero.
  assert.deepEqual(at({ usage: { cacheCreationInputTokens: { ephemeral_5m: 900 } } }), {
    ephemeral_5m: 900,
    ephemeral_1h: null
  })
  // Only a total: the tier split stays unknown rather than being invented.
  assert.deepEqual(at({ usage: { cacheCreationInputTokens: { total: 907 } } }), { total: 907 })
  // Tiers and a total: the tiers win, and the total is never derived from them.
  assert.deepEqual(
    at({ usage: { cacheCreationInputTokens: { ephemeral_5m: 900, ephemeral_1h: 7, total: 907 } } }),
    { ephemeral_5m: 900, ephemeral_1h: 7 }
  )
  // No decomposition at all is absent, not `{}` and not 0.
  assert.equal(at({ usage: { cacheCreationInputTokens: {} } }), null)
  assert.equal(at({ usage: { cacheCreationInputTokens: 907 } }), null)
})

test('an agent-result bounds its model and tool lists and drops what is not a string', () => {
  const ids = Array.from({ length: 50 }, (_, i) => `claude-model-${i}`)
  const r = appendRunLogEvent(
    tmp,
    fullAgentResult({
      servedModels: [...ids, 42],
      sessionModels: ['x'.repeat(2000)],
      permissionDenials: { count: 50, tools: [...ids, null] }
    })
  )
  const record = JSON.parse(lines(r.path)[0])
  assert.ok(record.servedModels.length < ids.length, 'the model list is bounded')
  assert.ok(record.servedModels.length > 0)
  assert.equal(record.servedModels[0], 'claude-model-0', 'a prefix, in order')
  assert.ok(record.servedModels.every(m => typeof m === 'string'))
  assert.ok(record.sessionModels[0].length < 2000, 'each id is bounded')
  assert.equal(record.permissionDenials.count, 50, 'the count is the whole count even when the list is cut')
  assert.ok(record.permissionDenials.tools.length < ids.length)
})

// --- the surface and the state home (design D14) ------------------------------

test('run-start records the surface, the state home and the working directory', () => {
  const r = appendRunLogEvent(tmp, {
    runId: RUN_ID,
    type: 'run-start',
    mode: 'continue',
    surface: 'linked-worktree',
    stateHome: '/r',
    cwd: '/r/.claude/worktrees/w1'
  })
  const record = JSON.parse(lines(r.path)[0])
  assert.equal(record.surface, 'linked-worktree')
  assert.equal(record.stateHome, '/r')
  assert.equal(record.cwd, '/r/.claude/worktrees/w1')

  for (const surface of ['main', 'linked-worktree', 'lane-worktree', 'unknown']) {
    const ok = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', surface })
    assert.equal(JSON.parse(lines(ok.path).at(-1)).surface, surface)
  }
})

test('run-start records an unrecognised surface and an absent path as absent', () => {
  // A surface outside the four is not a fifth surface: a reader partitioning by
  // surface counts it as unrecorded, with the runs that never recorded one.
  for (const surface of ['worktree', 'MAIN', 42, undefined]) {
    const r = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', surface })
    assert.equal(JSON.parse(lines(r.path).at(-1)).surface, null, `surface=${String(surface)}`)
  }
  const bare = JSON.parse(lines(runLogPath(tmp, RUN_ID)).at(-1))
  assert.equal(bare.stateHome, null)
  assert.equal(bare.cwd, null)

  const long = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', stateHome: `/${'d'.repeat(4000)}` })
  assert.ok(JSON.parse(lines(long.path).at(-1)).stateHome.length <= MAX_TEXT, 'a path is bounded like every text field')
})

test('the receipt carries the six observation counts, the surface and the state home', () => {
  const counts = {
    lanesStoppedByHost: 1,
    schemaResultsMissing: 0,
    toolsDeniedInLanes: 2,
    modelSubstitutions: 0,
    permissionPrompts: 3,
    autoModeDenials: 0
  }
  const r = appendRunLogEvent(tmp, fullReceipt({ ...counts, surface: 'linked-worktree', stateHome: '/r' }))
  const record = JSON.parse(lines(r.path)[0])
  for (const [key, value] of Object.entries(counts)) assert.equal(record[key], value, key)
  assert.equal(record.surface, 'linked-worktree')
  assert.equal(record.stateHome, '/r')

  // Nothing observed: each count is absent, never a zero nobody measured.
  const thin = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-receipt' })
  const absent = JSON.parse(lines(thin.path).at(-1))
  for (const key of Object.keys(counts)) assert.equal(absent[key], null, key)
  assert.equal(absent.surface, null)
  assert.equal(absent.stateHome, null)

  const bad = appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-receipt', surface: 'elsewhere', lanesStoppedByHost: -1 })
  const coerced = JSON.parse(lines(bad.path).at(-1))
  assert.equal(coerced.surface, null)
  assert.equal(coerced.lanesStoppedByHost, null)
})

test('the receipt host block keeps true, false and the observed hook value, and nothing else', () => {
  // `hook` is the value a complete close-time join records (design D5). An old
  // receipt's boolean must read exactly as it did.
  // One run id per probe, by counter: a case-insensitive filesystem would map
  // a run id derived from `'HOOK'` onto the one derived from `'hook'`.
  let probe = 0
  const read = cacheAccounting => {
    const runId = `${RUN_ID}-cache-${++probe}`
    appendRunLogEvent(tmp, { runId, type: 'run-receipt', host: { ...HOST, cacheAccounting } })
    return readRunLog(tmp, runId).records[0].host.cacheAccounting
  }
  assert.equal(read(true), true)
  assert.equal(read(false), false)
  assert.equal(read('hook'), 'hook')
  for (const junk of ['yes', 1, 0, 'HOOK', 'true', undefined, null, {}]) {
    assert.equal(read(junk), null, `cacheAccounting=${JSON.stringify(junk)}`)
  }
})

// --- a pre-change trajectory -------------------------------------------------
//
// Written verbatim by the writer as it stood before `agent-result`, `surface`,
// `stateHome`, `cwd` and the six counts existed. Literal lines rather than a
// call to today's writer, so this fixture cannot drift with the code it guards.
const PRE_CHANGE_LINES = [
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:00.000Z","runId":"run-pre","change":"add-widget","seq":1,"type":"run-start","mode":"continue","strict":false,"sessionId":"sess-1"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:01.000Z","runId":"run-pre","change":"add-widget","seq":2,"type":"wave-action","action":"run-batch","wave":"1","waveIndex":0,"batchIndex":0,"phase":"implement","source":"next"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:02.000Z","runId":"run-pre","change":"add-widget","seq":3,"type":"cli-exit","command":"wave-state next","exitCode":0,"durationMs":3}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:03.000Z","runId":"run-pre","change":"add-widget","seq":4,"type":"agent-spawn","label":"1.1","model":"sonnet","kind":"implementer","taskId":"1.1"}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:04.000Z","runId":"run-pre","change":"add-widget","seq":5,"type":"verify-judgement","context":"final","halt":false,"reason":"green","unitStatus":"green","spill":[]}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:05.000Z","runId":"run-pre","change":"add-widget","seq":6,"type":"cli-exit","command":"verify judge","exitCode":0,"durationMs":null}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:06.000Z","runId":"run-pre","change":"add-widget","seq":7,"type":"run-receipt","host":{"id":"claude","billing":"x","hooks":true,"usage":true,"cacheAccounting":false,"effort":"flag"},"waves":[{"wave":"1","ok":1,"failed":0,"notAttempted":0}],"planReused":null,"planStatus":null,"planReason":null,"planFingerprint":null,"reviewRaised":null,"reviewSurviving":null,"reviewBlockers":null,"reviewWarnings":null,"remediationRounds":null,"skippedVerifications":null,"capExhaustedVerifications":null,"unresolvedErrors":null,"leftoverTaskIds":[],"spend":[{"wave":"1","outputTokens":10,"cacheReadInputTokens":null,"cacheCreationInputTokens":null}],"outputTokens":12,"cacheReadInputTokens":null,"cacheCreationInputTokens":null,"halted":false,"haltReason":null,"committed":true,"commit":"abc1234","touchedPaths":["a.mjs"],"touchedPathsTruncated":false,"touchedPathsReason":null,"predictedPaths":["a.mjs"],"predictedPathsTruncated":false,"predictedPathsComplete":true,"predictedPathsReason":null,"degradations":[]}',
  '{"schema":"interlock.ship-run/1","ts":"2026-09-01T10:00:07.000Z","runId":"run-pre","change":"add-widget","seq":8,"type":"run-complete","leftoverTaskIds":[]}'
]

// What the readers produced over that file before the change, captured from them.
const PRE_CHANGE_RENDERED =
  'RUN LOG — 8 event(s)\n' +
  '  #1\trun-start\tmode="continue" strict=false sessionId="sess-1"\n' +
  '  #2\twave-action\taction="run-batch" wave="1" waveIndex=0 batchIndex=0 phase="implement" source="next"\n' +
  '  #3\tcli-exit\tcommand="wave-state next" exitCode=0 durationMs=3ms\n' +
  '  #4\tagent-spawn\tlabel="1.1" model="sonnet" kind="implementer" taskId="1.1"\n' +
  '  #5\tverify-judgement\tcontext="final" halt=false reason="green" unitStatus="green" spill=[]\n' +
  '  #6\tcli-exit\tcommand="verify judge" exitCode=0 durationMs=unknown\n' +
  '  #7\trun-receipt\n' +
  '    halted: no\n' +
  '    plan: unknown (unknown), fingerprint unknown\n' +
  '    wave 1: 1 ok, 0 failed, 0 not attempted\n' +
  '    review: unknown raised, unknown surviving, unknown blockers, unknown warnings\n' +
  '    remediation rounds: unknown\n' +
  '    verifications skipped: unknown (cap exhausted: unknown)\n' +
  '    unresolved errors carried past a wave: unknown\n' +
  '    output tokens (aggregate over the wave span — orchestrator turns included, not implementer cost):\n' +
  '      wave 1: 10\n' +
  '      run total: 12\n' +
  '    leftover tasks: none\n' +
  '    commit: abc1234\n' +
  '    paths touched (read from version control): 1 path(s): a.mjs\n' +
  '    paths predicted (from the executed plan): 1 path(s): a.mjs\n' +
  '      prediction complete: yes — every executed task declared its paths\n' +
  '    degradations: none recorded\n' +
  '  #8\trun-complete\tleftoverTaskIds=[]\n' +
  '  WAVE ELAPSED — derived from event timestamps, not a recorded field\n' +
  '    wave 1: 4000ms across 5 event(s)\n'

const PRE_CHANGE_LIST = [
  {
    runId: 'run-pre',
    change: 'add-widget',
    halted: false,
    haltReason: null,
    complete: true,
    receipt: true,
    committed: true,
    commit: 'abc1234',
    touchedPathCount: 1,
    touchedPathsReason: null,
    predictedPathCount: 1,
    predictedPathsReason: null,
    predictedPathsComplete: true,
    pathsTruncated: false,
    events: 8,
    skipped: 0,
    startedAt: '2026-09-01T10:00:00.000Z'
  }
]

function plantPreChange(root) {
  mkdirSync(runLogDir(root), { recursive: true })
  writeFileSync(runLogPath(root, 'run-pre'), PRE_CHANGE_LINES.join('\n') + '\n')
}

test('a trajectory written before agent-result and the surface fields lists, checks and renders as before', () => {
  plantPreChange(tmp)
  assert.deepEqual(listRunLogs(tmp), PRE_CHANGE_LIST)
  assert.equal(formatRunLogList(listRunLogs(tmp)), 'run-pre\tchange=add-widget\tcomplete\tcommit=abc1234\tevents=8\n')
  assert.deepEqual(checkRunLog(tmp, 'run-pre'), { ok: true, runId: 'run-pre', problems: [], events: 8 })
  assert.equal(formatRunLog(readRunLog(tmp, 'run-pre')), PRE_CHANGE_RENDERED)
  // The old receipt's boolean cache-accounting value reads exactly as it was.
  assert.equal(readRunLog(tmp, 'run-pre').records[6].host.cacheAccounting, false)
})

test('agent-result events raise no reconstructability problem and do not pad a wave', () => {
  // On the Workflow host the close appends one agent-result per joined agent
  // just before the receipt. Its timestamp is when the close observed the
  // agent, not when the agent ran, so folding it into the last wave would pad
  // that wave with everything between its last event and the close.
  const at = s => `2026-09-01T10:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000Z`
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'continue', now: at(0) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'wave-action', action: 'run-batch', wave: '1', source: 'next', now: at(1) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'cli-exit', command: 'wave-state next', exitCode: 0, now: at(2) })
  appendRunLogEvent(tmp, { ...fullAgentResult({ source: 'transcript' }), now: at(600) })
  appendRunLogEvent(tmp, { ...fullAgentResult({ label: '1.2', source: 'transcript' }), now: at(600) })
  appendRunLogEvent(tmp, { ...fullReceipt(), now: at(601) })
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-complete', now: at(602) })

  const result = checkRunLog(tmp, RUN_ID)
  assert.deepEqual(result.problems, [])
  assert.equal(result.ok, true)

  const [listed] = listRunLogs(tmp)
  assert.equal(listed.events, 7)
  assert.equal(listed.complete, true)
  assert.equal(listed.receipt, true)

  const records = readRunLog(tmp, RUN_ID).records
  assert.deepEqual(deriveWaveElapsed(records), [
    { wave: '1', firstTs: at(1), lastTs: at(2), events: 2, elapsedMs: 1000 }
  ])

  const rendered = formatRunLog(readRunLog(tmp, RUN_ID))
  assert.match(rendered, /agent-result\tlabel="1\.1"/)
  assert.match(rendered, /sessionId="00000000-0000-4000-8000-000000000000"/)
  assert.match(rendered, /wave 1: 1000ms across 2 event\(s\)/)
})
