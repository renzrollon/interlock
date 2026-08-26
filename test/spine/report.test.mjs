// The reader's own reader.
//
// What is being held here is not arithmetic — summing four integers is not the
// risk. The risk is that a thin corpus reports as a clean one, which is the
// single failure mode `lib/report.mjs` exists to avoid and the one no downstream
// reader could detect. So most of these assertions are about ABSENCE: that a
// missing receipt field leaves a denominator short instead of scoring the run
// as first-pass, that a zero denominator yields `null` and never `0`, that a
// skill-written metrics file whose filename matches the counts pattern reaches
// no indicator, and that the uncomputable indicator stays uncomputable.
//
// Two structural properties are asserted separately because they are policy
// rather than behaviour: the command always exits 0, and the reader creates no
// file — including in a temp root where a stray write would otherwise pass
// unnoticed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReport, formatReport, REPORT_SCHEMA, SOURCES, UNATTRIBUTED } from '../../lib/report.mjs'
import { REPORT_CAPS } from '../../lib/limits.mjs'
import { REVIEW_METRICS_SCHEMA } from '../../lib/metrics.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO, 'bin', 'interlock')

function root() {
  return mkdtempSync(join(tmpdir(), 'interlock-report-'))
}

let seq = 0

/** Write one trajectory file from a list of partial events. */
function trajectory(dir, runId, events, { change = 'add-widget' } = {}) {
  const runs = join(dir, '.claude', 'ship', 'runs')
  mkdirSync(runs, { recursive: true })
  const lines = events.map((event, i) =>
    JSON.stringify({
      schema: 'interlock.ship-run/1',
      ts: event.ts || `2026-08-2${1 + (i % 8)}T00:00:0${i % 10}.000Z`,
      runId,
      change,
      seq: ++seq,
      ...event
    })
  )
  writeFileSync(join(runs, `${runId}.jsonl`), lines.join('\n') + '\n')
}

function outcomes(dir, records) {
  const learning = join(dir, '.claude', 'learning')
  mkdirSync(learning, { recursive: true })
  writeFileSync(
    join(learning, 'outcomes.jsonl'),
    records.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n'
  )
}

function metricsFile(dir, name, payload) {
  const metrics = join(dir, '.claude', 'metrics')
  mkdirSync(metrics, { recursive: true })
  writeFileSync(join(metrics, name), JSON.stringify(payload, null, 2) + '\n')
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const RECEIPT = {
  type: 'run-receipt',
  halted: false,
  remediationRounds: 0,
  planStatus: 'match',
  reviewRaised: 8,
  reviewSurviving: 2,
  reviewBlockers: 1,
  reviewWarnings: 1
}

// --- an absent corpus ------------------------------------------------------

test('an absent corpus still yields a coverage section and null indicators', () => {
  const dir = root()
  try {
    const report = buildReport(dir)
    assert.equal(report.schema, REPORT_SCHEMA)
    assert.equal(report.gates, false)
    assert.equal(report.coverage.trajectories.total, 0)
    assert.equal(report.coverage.outcomes.exists, false)
    assert.equal(report.coverage.metrics.exists, false)
    assert.equal(report.indicators.firstPassShip.rate.value, null)
    assert.match(report.indicators.firstPassShip.rate.reason, /no run has written a receipt/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a zero denominator yields null and a reason, never zero', () => {
  const dir = root()
  try {
    const report = buildReport(dir)
    for (const ind of [
      report.indicators.firstPassShip.rate,
      report.indicators.rework.remediationRounds,
      report.indicators.rework.attemptsPerChange,
      report.indicators.planFidelity.midRunRevision,
      report.indicators.reviewFindings.fromMetrics.dismissalShare,
      report.indicators.reviewFindings.fromReceipts.survivalShare,
      report.indicators.gateExitHealth.nonZeroShare
    ]) {
      assert.equal(ind.value, null)
      assert.equal(ind.observedOf, 0)
      assert.ok(ind.reason, 'a null value must carry a reason')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nonexistent root is reported, not raised', () => {
  const report = buildReport(join(tmpdir(), 'interlock-report-does-not-exist-' + process.pid))
  assert.equal(report.gates, false)
  assert.equal(report.coverage.trajectories.total, 0)
})

// --- damage tolerance ------------------------------------------------------

test('a torn final line costs one record and no more', () => {
  const dir = root()
  try {
    outcomes(dir, [
      { schema: 'interlock.outcome/2', ts: '2026-08-20T00:00:00.000Z', change: 'a', mode: 'continue' },
      { schema: 'interlock.outcome/2', ts: '2026-08-21T00:00:00.000Z', change: 'a', mode: 'checkpoint' },
      '{"schema":"interlock.outcome/2","ts":"2026-08-2'
    ])
    const report = buildReport(dir)
    assert.equal(report.coverage.outcomes.records, 2)
    assert.equal(report.coverage.outcomes.skippedLines, 1)
    assert.deepEqual(report.coverage.outcomes.byMode, { continue: 1, checkpoint: 1 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a trajectory with a torn line is counted and its other events are read', () => {
  const dir = root()
  try {
    const runs = join(dir, '.claude', 'ship', 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(
      join(runs, 'run-torn.jsonl'),
      JSON.stringify({ ts: '2026-08-20T00:00:00.000Z', runId: 'run-torn', change: 'a', type: 'run-start' }) +
        '\n{"type":"cli-exit","comm\n'
    )
    const report = buildReport(dir)
    assert.equal(report.coverage.trajectories.scanned, 1)
    assert.equal(report.coverage.trajectories.withRunStart, 1)
    assert.equal(report.coverage.trajectories.skippedLines, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- metrics are classified by schema, never by filename -------------------

test('a skill-written file whose name matches the counts pattern reaches no indicator', () => {
  const dir = root()
  try {
    // The trap: `review-artifacts-*.json` matches the glob `review-*.json`, and
    // carries finding bodies rather than counts.
    metricsFile(dir, 'review-artifacts-add-widget-20260826-120000.json', {
      dimension: 'artifacts',
      findings: [{ severity: 'blocker', title: 'x', description: 'y', file: 'z' }]
    })
    metricsFile(dir, 'fix-tests-20260812-000000.json', { skill: 'fix-tests', rootCauseIterations: 1 })
    metricsFile(dir, 'review-add-widget-20260826-130000.json', {
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: '2026-08-26T13:00:00.000Z',
      change: 'add-widget',
      counts: { raised: 10, dismissed: 6, droppedByQuality: 1, surviving: 3 }
    })

    const report = buildReport(dir)
    assert.equal(report.coverage.metrics.total, 3)
    assert.equal(report.coverage.metrics.recognized, 1)
    assert.equal(report.coverage.metrics.unrecognized.length, 2)
    const named = report.coverage.metrics.unrecognized.map(u => u.file).sort()
    assert.deepEqual(named, [
      'fix-tests-20260812-000000.json',
      'review-artifacts-add-widget-20260826-120000.json'
    ])

    // Only the schema-tagged file's counts reached the indicator.
    const fm = report.indicators.reviewFindings.fromMetrics
    assert.equal(fm.files, 1)
    assert.deepEqual(fm.counts, { raised: 10, dismissed: 6, droppedByQuality: 1, surviving: 3 })
    assert.equal(fm.dismissalShare.value, 0.6)
    assert.equal(fm.dismissalShare.source, SOURCES.REVIEW_METRICS)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unrecognized metrics file is named in the human-readable output', () => {
  const dir = root()
  try {
    metricsFile(dir, 'review-artifacts-x-20260826-120000.json', { dimension: 'artifacts', findings: [] })
    const text = formatReport(buildReport(dir))
    assert.match(text, /not counted\s+review-artifacts-x-20260826-120000\.json/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- absence is never cleanliness -----------------------------------------

test('a receipt with an unobserved remediation count leaves the denominator short', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-clean', [{ type: 'run-start' }, { ...RECEIPT }])
    // Halted false, but the remediation count was never observed. Reading that
    // absence as zero rounds would score it as a first-pass ship.
    trajectory(dir, 'run-unknown', [{ type: 'run-start' }, { ...RECEIPT, remediationRounds: null }])

    const report = buildReport(dir)
    const rate = report.indicators.firstPassShip.rate
    assert.equal(report.coverage.trajectories.withReceipt, 2)
    assert.equal(rate.observedOf, 1, 'only the fully-observed receipt is in the denominator')
    assert.equal(rate.notObserved, 1)
    assert.equal(rate.value, 1)
    assert.equal(report.indicators.firstPassShip.firstPassRuns, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a halted run is not a first-pass ship even with zero remediation rounds', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-halted', [{ type: 'run-start' }, { ...RECEIPT, halted: true, remediationRounds: 0 }])
    const rate = buildReport(dir).indicators.firstPassShip.rate
    assert.equal(rate.observedOf, 1)
    assert.equal(rate.value, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the first-pass indicator is never presented as a CI rate', () => {
  const dir = root()
  try {
    const report = buildReport(dir)
    assert.match(report.indicators.firstPassShip.note, /not a CI success rate/)
    assert.match(formatReport(report), /not a CI success rate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unattributed runs are excluded from the per-change tally and reported', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }], { change: 'add-widget' })
    trajectory(dir, 'run-b', [{ type: 'run-start' }], { change: 'add-widget' })
    trajectory(dir, 'run-c', [{ type: 'run-start' }], { change: UNATTRIBUTED })

    const attempts = buildReport(dir).indicators.rework.attemptsPerChange
    assert.equal(attempts.unattributed, 1)
    assert.equal(attempts.observedOf, 2)
    assert.equal(attempts.notObserved, 1)
    assert.deepEqual(attempts.changes, [{ change: 'add-widget', runs: 2 }])
    assert.equal(attempts.value, 2, 'two runs against one change')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remediation rounds and attempts per change are separate indicators', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, { ...RECEIPT, remediationRounds: 2 }])
    const rework = buildReport(dir).indicators.rework
    assert.equal(rework.remediationRounds.source, SOURCES.RECEIPT)
    assert.equal(rework.attemptsPerChange.source, SOURCES.TRAJECTORY)
    assert.deepEqual(rework.remediationRounds.distribution, { 2: 1 })
    assert.notEqual(rework.remediationRounds.value, rework.attemptsPerChange.value)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- the declared gap ------------------------------------------------------

test('diffMatchesPlan is always uncomputable, whatever the corpus holds', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [
      { type: 'run-start' },
      { type: 'wave-action', source: 'replan' },
      { ...RECEIPT, planStatus: 'match' }
    ])
    const plan = buildReport(dir).indicators.planFidelity
    assert.equal(plan.diffMatchesPlan.computable, false)
    assert.ok(plan.diffMatchesPlan.reason)
    assert.ok(plan.diffMatchesPlan.wouldRequire)
    // The two recorded figures exist and are NOT published under that name.
    assert.deepEqual(plan.planStatus.counts, { match: 1 })
    assert.equal(plan.midRunRevision.value, 1)
    assert.match(formatReport(buildReport(dir)), /diff matches plan\s+NOT COMPUTABLE/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mid-run revision counts runs, not replan events', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [
      { type: 'wave-action', source: 'create' },
      { type: 'wave-action', source: 'replan' },
      { type: 'wave-action', source: 'replan' }
    ])
    trajectory(dir, 'run-b', [{ type: 'wave-action', source: 'create' }])
    const revision = buildReport(dir).indicators.planFidelity.midRunRevision
    assert.equal(revision.observedOf, 2)
    assert.equal(revision.value, 0.5, 'one of two runs revised, despite two replan events')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- provenance is never merged -------------------------------------------

test('metrics-derived and receipt-derived finding series are kept apart', () => {
  const dir = root()
  try {
    metricsFile(dir, 'review-add-widget-20260826-130000.json', {
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: '2026-08-26T13:00:00.000Z',
      change: 'add-widget',
      counts: { raised: 4, dismissed: 3, droppedByQuality: 0, surviving: 1 }
    })
    trajectory(dir, 'run-a', [{ type: 'run-start' }, { ...RECEIPT, reviewRaised: 8, reviewSurviving: 2 }])

    const rf = buildReport(dir).indicators.reviewFindings
    assert.equal(rf.fromMetrics.counts.raised, 4)
    assert.equal(rf.fromReceipts.counts.raised, 8)
    assert.equal(rf.fromMetrics.dismissalShare.source, SOURCES.REVIEW_METRICS)
    assert.equal(rf.fromReceipts.survivalShare.source, SOURCES.RECEIPT)
    // The receipt records survival, not dismissal — so there is no dismissal
    // share on that series to accidentally sum with the other one.
    assert.equal(rf.fromReceipts.dismissalShare, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- gate exit health ------------------------------------------------------

test('a command with no recorded exits is absent rather than zero', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [
      { type: 'cli-exit', command: 'wave-state next', exitCode: 0 },
      { type: 'cli-exit', command: 'wave-state next', exitCode: 1 },
      { type: 'cli-exit', command: 'verify judge', exitCode: 0 }
    ])
    const health = buildReport(dir).indicators.gateExitHealth
    assert.equal(health.totalExits, 3)
    assert.equal(health.totalNonZero, 1)
    const names = health.commands.map(c => c.command)
    assert.deepEqual(names, ['wave-state next', 'verify judge'])
    assert.ok(!names.includes('gate'), 'a command that recorded no exit does not appear')
    assert.equal(health.commands[0].nonZeroShare, 0.5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- filters --------------------------------------------------------------

test('a window excludes records from values and from denominators alike', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-old', [
      { type: 'run-start', ts: '2026-01-01T00:00:00.000Z' },
      { type: 'cli-exit', ts: '2026-01-01T00:00:01.000Z', command: 'gate', exitCode: 1 }
    ])
    trajectory(dir, 'run-new', [
      { type: 'run-start', ts: '2026-08-01T00:00:00.000Z' },
      { type: 'cli-exit', ts: '2026-08-01T00:00:01.000Z', command: 'gate', exitCode: 0 }
    ])

    const all = buildReport(dir)
    assert.equal(all.coverage.trajectories.scanned, 2)
    assert.equal(all.indicators.gateExitHealth.totalExits, 2)

    const windowed = buildReport(dir, { since: '2026-06-01T00:00:00.000Z' })
    assert.equal(windowed.coverage.trajectories.scanned, 1)
    assert.equal(windowed.coverage.trajectories.filteredOut, 1)
    assert.equal(windowed.indicators.gateExitHealth.totalExits, 1)
    assert.equal(windowed.indicators.gateExitHealth.totalNonZero, 0)
    assert.equal(windowed.filter.since, '2026-06-01T00:00:00.000Z')
    assert.match(formatReport(windowed), /filter: since 2026-06-01/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a change filter narrows trajectories, outcomes and metrics together', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }], { change: 'add-widget' })
    trajectory(dir, 'run-b', [{ type: 'run-start' }], { change: 'other-change' })
    outcomes(dir, [
      { schema: 'interlock.outcome/2', ts: '2026-08-20T00:00:00.000Z', change: 'add-widget', mode: 'continue' },
      { schema: 'interlock.outcome/2', ts: '2026-08-20T00:00:00.000Z', change: 'other-change', mode: 'continue' }
    ])
    metricsFile(dir, 'review-other-change-20260826-130000.json', {
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: '2026-08-26T13:00:00.000Z',
      change: 'other-change',
      counts: { raised: 5, dismissed: 5, droppedByQuality: 0, surviving: 0 }
    })

    const report = buildReport(dir, { change: 'add-widget' })
    assert.equal(report.coverage.trajectories.scanned, 1)
    assert.equal(report.coverage.outcomes.records, 1)
    assert.equal(report.coverage.metrics.recognized, 0)
    assert.equal(report.coverage.metrics.filteredOut, 1)
    assert.equal(report.indicators.reviewFindings.fromMetrics.counts.raised, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- the scan bound -------------------------------------------------------

test('the scan is bounded and the truncation is reported, never sampled silently', () => {
  const dir = root()
  try {
    for (let i = 0; i < 5; i++) trajectory(dir, `run-${i}`, [{ type: 'run-start' }])
    const report = buildReport(dir, { maxRuns: 2 })
    assert.equal(report.coverage.trajectories.total, 5)
    assert.equal(report.coverage.trajectories.scanned, 2)
    assert.equal(report.coverage.trajectories.truncated, true)
    assert.equal(report.coverage.trajectories.notScanned, 3)
    assert.match(formatReport(report), /scan capped; 3 not read/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the published cap is the ceiling a larger request is clamped to', () => {
  const dir = root()
  try {
    const report = buildReport(dir, { maxRuns: REPORT_CAPS.maxRunsScanned * 10 })
    assert.equal(report.filter.maxRuns, REPORT_CAPS.maxRunsScanned)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('interlock limits publishes the scan cap', () => {
  const run = spawnSync(process.execPath, [BIN, 'limits', '--json'], { encoding: 'utf8' })
  assert.equal(run.status, 0)
  const parsed = JSON.parse(run.stdout)
  assert.equal(parsed.report.maxRunsScanned, REPORT_CAPS.maxRunsScanned)
})

// --- policy: no writes, no verdicts, exit 0 -------------------------------

test('the report creates no file', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, { ...RECEIPT }])
    const before = walk(dir).sort()
    buildReport(dir)
    formatReport(buildReport(dir))
    assert.deepEqual(walk(dir).sort(), before, 'the reader must write nothing, not even a cache')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI exits 0 with an empty corpus and every indicator null', () => {
  const dir = root()
  try {
    const run = spawnSync(process.execPath, [BIN, 'report', '--root', dir], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /COVERAGE/)
    assert.match(run.stdout, /Exit status is always 0/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI exits 0 when a receipt reports a halted run with surviving blockers', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-bad', [
      { type: 'run-start' },
      { ...RECEIPT, halted: true, haltReason: 'blockers survived', remediationRounds: 3, reviewBlockers: 9 }
    ])
    const run = spawnSync(process.execPath, [BIN, 'report', '--root', dir], { encoding: 'utf8' })
    assert.equal(run.status, 0, 'a bad corpus is still a report, never a failed command')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no indicator carries a verdict word', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, { ...RECEIPT, halted: true, remediationRounds: 4 }])
    const text = formatReport(buildReport(dir))
    for (const word of [/\bPASS\b/, /\bFAIL\b/, /\bBLOCKED\b/, /\bhealthy\b/i, /\bdegraded\b/i, /\bacceptable\b/i]) {
      assert.ok(!word.test(text), `the report must not label a value: ${word}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the machine-readable payload declares its schema and that it gates nothing', () => {
  const dir = root()
  try {
    const run = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--json'], { encoding: 'utf8' })
    assert.equal(run.status, 0)
    const parsed = JSON.parse(run.stdout)
    assert.equal(parsed.schema, REPORT_SCHEMA)
    assert.equal(parsed.gates, false)
    assert.match(parsed.note, /nothing in the loop reads this output/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('coverage precedes the indicators in the human-readable output', () => {
  const dir = root()
  try {
    const text = formatReport(buildReport(dir))
    assert.ok(text.indexOf('COVERAGE') < text.indexOf('INDICATORS'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
