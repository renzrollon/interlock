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
