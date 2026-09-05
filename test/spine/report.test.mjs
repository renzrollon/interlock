// The reader's own reader.
//
// What is being held here is not arithmetic — summing four integers is not the
// risk. The risk is that a thin corpus reports as a clean one, which is the
// single failure mode `lib/report.mjs` exists to avoid and the one no downstream
// reader could detect. So most of these assertions are about ABSENCE: that a
// missing receipt field leaves a denominator short instead of scoring the run
// as first-pass, that a zero denominator yields `null` and never `0`, that a
// skill-written metrics file whose filename matches the counts pattern reaches
// no indicator, and that a run whose path sets were never observed is excluded
// from the diff-vs-plan share and counted by name rather than folded in at zero.
//
// Two structural properties are asserted separately because they are policy
// rather than behaviour: the command always exits 0, and the reader creates no
// file — including in a temp root where a stray write would otherwise pass
// unnoticed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  formatReport,
  NO_EVAL_RESULT,
  REPORT_SCHEMA,
  SOURCES,
  UNATTRIBUTED
} from '../../lib/report.mjs'
import { REPORT_CAPS } from '../../lib/limits.mjs'
import { REVIEW_METRICS_SCHEMA } from '../../lib/metrics.mjs'
import { appendRunLogEvent, listRunLogs, readRunLog, formatRunLog } from '../../lib/run-log.mjs'

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

// --- diff versus plan ------------------------------------------------------
//
// The indicator that used to be a declared gap. Every assertion below is about
// the same property from a different side: a run only counts when both path
// sets were actually observed, and a run that does not count is EXCLUDED AND
// NAMED rather than folded in at zero. Folding one in would depress the share
// for a recording gap and read as an implementer going off-plan.

/** A receipt whose two path sets are both observed, complete and untruncated. */
const PATHS_RECEIPT = {
  ...RECEIPT,
  committed: true,
  commit: 'deadbee',
  touchedPaths: ['lib/a.mjs', 'lib/b.mjs', 'test/a.test.mjs', 'README.md'],
  touchedPathsTruncated: false,
  predictedPaths: ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs'],
  predictedPathsTruncated: false,
  predictedPathsComplete: true
}

test('diffMatchesPlan is a share pooled over paths, with its denominator', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, PATHS_RECEIPT])
    const dmp = buildReport(dir).indicators.planFidelity.diffMatchesPlan

    // 2 of 4 touched paths were predicted. `lib/c.mjs` was predicted and never
    // touched, and it is not in the denominator — that is the other direction.
    assert.equal(dmp.value, 0.5)
    assert.equal(dmp.observedOf, 4, 'the denominator is touched paths, not runs')
    assert.equal(dmp.paths.matched, 2)
    assert.equal(dmp.paths.touched, 4)
    assert.equal(dmp.runs, 1)
    assert.equal(dmp.source, SOURCES.RECEIPT)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the share is pooled across runs, so a big run outweighs a small one', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, { ...PATHS_RECEIPT, touchedPaths: ['lib/a.mjs'] }])
    trajectory(dir, 'run-b', [
      { type: 'run-start' },
      {
        ...PATHS_RECEIPT,
        touchedPaths: ['x/1.ts', 'x/2.ts', 'x/3.ts'],
        predictedPaths: []
      }
    ])
    const dmp = buildReport(dir).indicators.planFidelity.diffMatchesPlan
    assert.equal(dmp.paths.touched, 4, 'summed across runs, not averaged per run')
    assert.equal(dmp.paths.matched, 1)
    assert.equal(dmp.value, 0.25)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('each exclusion reason is counted and named, and none is absorbed', () => {
  const dir = root()
  try {
    trajectory(dir, 'ok-run', [{ type: 'run-start' }, PATHS_RECEIPT])
    // No commit: the touched set was never observed, and the run is not a run
    // whose diff matched nothing.
    trajectory(dir, 'no-commit', [
      { type: 'run-start' },
      { ...PATHS_RECEIPT, committed: false, touchedPaths: null, touchedPathsTruncated: null }
    ])
    // A commit whose paths could not be read: a different fact, counted apart.
    trajectory(dir, 'unreadable', [
      { type: 'run-start' },
      { ...PATHS_RECEIPT, committed: true, touchedPaths: null, touchedPathsTruncated: null }
    ])
    trajectory(dir, 'incomplete', [
      { type: 'run-start' },
      { ...PATHS_RECEIPT, predictedPathsComplete: false }
    ])
    trajectory(dir, 'truncated', [
      { type: 'run-start' },
      { ...PATHS_RECEIPT, touchedPathsTruncated: true }
    ])

    const report = buildReport(dir)
    const dmp = report.indicators.planFidelity.diffMatchesPlan
    assert.deepEqual(dmp.excluded, {
      noCommit: 1,
      unreadableSet: 1,
      incompletePrediction: 1,
      truncatedSet: 1
    })
    assert.equal(dmp.runs, 1, 'only the qualifying run contributes')
    assert.equal(dmp.observedOf, 4)
    assert.equal(dmp.notObserved, 4)

    const text = formatReport(report)
    assert.match(text, /excluded 1 run\(s\): the run made no commit/)
    assert.match(text, /excluded 1 run\(s\): a path set was recorded unobserved/)
    assert.match(text, /excluded 1 run\(s\): the executed plan did not predict paths for every task/)
    assert.match(text, /excluded 1 run\(s\): a path set exceeded its recorded bound/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an all-excluded corpus reports unobserved with a reason, never zero', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [
      { type: 'run-start' },
      { ...PATHS_RECEIPT, committed: false, touchedPaths: null, touchedPathsTruncated: null }
    ])
    const report = buildReport(dir)
    const dmp = report.indicators.planFidelity.diffMatchesPlan

    assert.equal(dmp.value, null, 'a zero would assert that nothing touched was predicted')
    assert.notEqual(dmp.value, 0)
    assert.match(dmp.reason, /no scanned run recorded both path sets/)
    assert.match(formatReport(report), /diff matches plan\s+unobserved/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the converse figure is never published under the diff-matches-plan name', () => {
  const dir = root()
  try {
    // Touched 4, predicted 3, overlap 2. The converse — predicted paths that
    // were touched — is 2/3; the published figure must be 2/4.
    trajectory(dir, 'run-a', [{ type: 'run-start' }, PATHS_RECEIPT])
    const report = buildReport(dir)
    const dmp = report.indicators.planFidelity.diffMatchesPlan

    assert.equal(dmp.value, 0.5)
    assert.notEqual(dmp.value, Math.round((2 / 3) * 10000) / 10000, 'that is the other question')
    assert.match(dmp.direction, /TOUCHED/)
    assert.match(formatReport(report), /the touched set is the denominator/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the two recorded plan figures are still reported, and still not under that name', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [
      { type: 'run-start' },
      { type: 'wave-action', source: 'replan' },
      { ...RECEIPT, planStatus: 'match' }
    ])
    const plan = buildReport(dir).indicators.planFidelity
    assert.deepEqual(plan.planStatus.counts, { match: 1 })
    assert.equal(plan.midRunRevision.value, 1)
    assert.equal(plan.diffMatchesPlan.value, null, 'neither of those is the diff figure')
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

// --- the HTML surface ------------------------------------------------------
//
// `--html` is a third rendering of the same object, so the property that
// matters is not what the document looks like but that it cannot say anything
// the other two surfaces do not. That is asserted directly below, indicator by
// indicator, rather than trusted to a shared code path.

/** Every reading in the document, as [headline, basis] pairs, in order. */
function readings(doc) {
  return [...doc.matchAll(
    /<div class="ind-headline">([\s\S]*?)<\/div><div class="ind-basis">([\s\S]*?)<\/div>/g
  )].map(m => [m[1], m[2]])
}

/** The (headline, basis) an indicator carries, formatted as every surface formats it. */
function readingOf(ind, kind) {
  if (!ind || ind.value === null) return ['UNOBSERVED', ind ? ind.reason : 'no indicator']
  const headline = kind === 'pct' ? `${(ind.value * 100).toFixed(1)}%` : String(ind.value)
  const basis = `of ${ind.observedOf} observed` + (ind.notObserved ? `, ${ind.notObserved} not observed` : '')
  return [headline, basis]
}

test('the three surfaces cannot disagree about a value or a denominator', () => {
  const dir = root()
  try {
    // A corpus with something in every indicator that can carry something, so
    // the comparison is over real values rather than over nine absences.
    trajectory(dir, 'run-a', [
      { type: 'run-start' },
      { type: 'cli-exit', command: 'gate', exitCode: 1 },
      { type: 'cli-exit', command: 'gate', exitCode: 0 },
      { type: 'wave', action: 'replan' },
      RECEIPT,
      { type: 'run-complete', leftoverTaskIds: [] }
    ])
    trajectory(dir, 'run-b', [
      { type: 'run-start' },
      { type: 'cli-exit', command: 'verify judge', exitCode: 0 },
      { ...RECEIPT, remediationRounds: 2 },
      { type: 'run-complete', leftoverTaskIds: [] }
    ], { change: 'add-other' })
    metricsFile(dir, 'review-add-widget-20260821-000000-000Z.json', {
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: '2026-08-21T00:00:00.000Z',
      change: 'add-widget',
      counts: { raised: 8, dismissed: 5, droppedByQuality: 1, surviving: 2 }
    })

    const cli = args => {
      const r = spawnSync(process.execPath, [BIN, 'report', '--root', dir, ...args], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      return r.stdout
    }

    const object = JSON.parse(cli(['--json']))
    const text = cli([])
    const doc = cli(['--html'])
    const i = object.indicators

    const expected = [
      readingOf(i.firstPassShip.rate, 'pct'),
      readingOf(i.rework.remediationRounds, 'plain'),
      readingOf(i.rework.attemptsPerChange, 'plain'),
      null, // plan-reuse status is a distribution, compared separately below
      readingOf(i.planFidelity.midRunRevision, 'pct'),
      readingOf(i.planFidelity.diffMatchesPlan, 'pct'),
      readingOf(i.reviewFindings.fromMetrics.dismissalShare, 'pct'),
      readingOf(i.reviewFindings.fromReceipts.survivalShare, 'pct'),
      readingOf(i.gateExitHealth.nonZeroShare, 'pct'),
      // The fourth corpus. This fixture writes no outcome-eval history, so the
      // reading is the absence — and the two surfaces must word it identically,
      // which is exactly the property being defended here.
      ['UNOBSERVED', NO_EVAL_RESULT]
    ]

    const actual = readings(doc)
    assert.equal(actual.length, expected.length, 'one reading per indicator the object carries')

    for (let n = 0; n < expected.length; n += 1) {
      if (!expected[n]) continue
      const [headline, basis] = expected[n]
      assert.deepEqual(actual[n], [headline, basis], `indicator ${n + 1} disagrees with the object`)
      // And the same two figures reach the text surface. It words absence in
      // lower case and parentheses rather than as a headline, which is the only
      // difference between the surfaces that is permitted to exist: the reason
      // itself must be identical, because both read it off the same object.
      if (headline === 'UNOBSERVED') {
        assert.ok(text.includes(`unobserved (${basis})`), `the text surface must carry "${basis}"`)
      } else {
        assert.ok(text.includes(headline), `the text surface must carry ${headline}`)
        assert.ok(text.includes(basis), `the text surface must carry "${basis}"`)
      }
    }

    // The two figures the readings above skip, checked in their own shape.
    for (const status of Object.keys(i.planFidelity.planStatus.counts)) {
      assert.ok(doc.includes(status), `plan status ${status} must appear`)
      assert.ok(text.includes(status))
    }
    // The diff-vs-plan reading is compared with the rest, above: it is a share
    // with a denominator now, so it is no longer the one indicator whose
    // surfaces had to be compared by a word rather than by a figure.

    // Coverage denominators, which every figure above rests on.
    const c = object.coverage
    assert.ok(doc.includes(`>${c.trajectories.scanned}</span> scanned of <span class="num">${c.trajectories.total}<`))
    assert.ok(doc.includes(`>${c.metrics.recognized}</span> recognized of <span class="num">${c.metrics.total}<`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty corpus still produces a document and exits 0', () => {
  const dir = root()
  try {
    const r = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--html'], { encoding: 'utf8' })
    assert.equal(r.status, 0, 'a corpus with nothing in it is a report, not a failure')
    assert.match(r.stdout, /^<!doctype html>/)
    assert.match(r.stdout, /UNOBSERVED/)
    assert.doesNotMatch(r.stdout, /<div class="ind-headline">0<\/div>/, 'absence is never a zero')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--html writes only where told, and producing it leaves the corpora untouched', () => {
  const dir = root()
  try {
    trajectory(dir, 'run-a', [{ type: 'run-start' }, RECEIPT, { type: 'run-complete', leftoverTaskIds: [] }])
    const before = walk(dir).sort()

    // Bare --html writes to stdout and touches no file at all.
    const piped = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--html'], { encoding: 'utf8' })
    assert.equal(piped.status, 0)
    assert.deepEqual(walk(dir).sort(), before, 'a report to stdout must create nothing')

    // A named path is written, and it is the only thing written.
    const out = join(dir, 'report.html')
    const named = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--html', out], { encoding: 'utf8' })
    assert.equal(named.status, 0, named.stderr)
    assert.match(named.stdout, /report written to/)
    assert.deepEqual(walk(dir).sort(), [...before, out].sort(), 'only the named destination is written')
    assert.equal(readFileSync(out, 'utf8'), piped.stdout, 'the file and the stream are the same document')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unwritable destination is reported and leaves no partial document', () => {
  const dir = root()
  try {
    const out = join(dir, 'no-such-dir', 'report.html')
    const r = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--html', out], { encoding: 'utf8' })
    assert.notEqual(r.status, 0, 'a write that did not happen must not report success')
    assert.match(r.stderr, /could not write/)
    assert.equal(existsSync(out), false, 'nothing may be left at the named path')
    assert.equal(existsSync(`${out}.interlock-partial`), false, 'nor beside it')
    assert.doesNotMatch(r.stdout, /doctype/, 'a failed write must not also spill the document')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--html and --json are refused together rather than one silently winning', () => {
  const dir = root()
  try {
    const r = spawnSync(process.execPath, [BIN, 'report', '--root', dir, '--html', '--json'], { encoding: 'utf8' })
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /--html and --json are mutually exclusive/)
    assert.equal(r.stdout, '', 'neither surface may be produced')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- end to end: unobserved survives every hop ------------------------------

test('the unobserved-versus-empty distinction survives writer, reader and report', () => {
  const dir = root()
  try {
    // Written through the real writer rather than hand-rolled JSON, so the
    // coercion the writer applies is part of what is being asserted: this is
    // the one property that has to hold across three modules and four surfaces,
    // and each hop is somewhere `null` could quietly become `[]`.
    const write = (runId, receipt) => {
      for (const event of [
        { type: 'run-start', mode: 'checkpoint' },
        { type: 'run-complete', leftoverTaskIds: [] },
        { type: 'run-receipt', ...receipt }
      ]) {
        const r = appendRunLogEvent(dir, { runId, change: 'add-widget', ...event })
        assert.equal(r.written, true, `${runId}: ${r.reason}`)
      }
    }

    write('run-committed', {
      halted: false,
      remediationRounds: 0,
      committed: true,
      commit: 'deadbee',
      touchedPaths: ['lib/a.mjs', 'lib/b.mjs'],
      predictedPaths: ['lib/a.mjs'],
      predictedPathsComplete: true
    })
    write('run-no-commit', {
      halted: true,
      haltReason: 'the unit suite was red at the final verification',
      committed: false,
      touchedPathsReason: 'the run made no commit',
      predictedPaths: ['lib/a.mjs'],
      predictedPathsComplete: true
    })

    // Hop 1 — the reader. The committing run has a count; the other has none,
    // and `null` is not `0`.
    const listed = Object.fromEntries(listRunLogs(dir).map(r => [r.runId, r]))
    assert.equal(listed['run-committed'].touchedPathCount, 2)
    assert.equal(listed['run-no-commit'].touchedPathCount, null)
    assert.notEqual(listed['run-no-commit'].touchedPathCount, 0)
    assert.match(listed['run-no-commit'].touchedPathsReason, /made no commit/)

    // Hop 2 — the report. One run contributes; the other is excluded and named.
    const report = buildReport(dir)
    const dmp = report.indicators.planFidelity.diffMatchesPlan
    assert.equal(dmp.runs, 1, 'only the committing run qualifies')
    assert.equal(dmp.paths.touched, 2)
    assert.equal(dmp.paths.matched, 1)
    assert.equal(dmp.value, 0.5)
    assert.equal(dmp.excluded.noCommit, 1, 'the halted run is excluded under the absent commit')
    assert.equal(dmp.excluded.unreadableSet, 0, 'and not misfiled as a failed read')

    // Hop 3 — every surface. No rendering may show the non-committing run's
    // touched set as an empty list.
    const surfaces = [
      formatReport(report),
      JSON.stringify(report),
      formatRunLog(readRunLog(dir, 'run-no-commit')),
      JSON.stringify(readRunLog(dir, 'run-no-commit'))
    ]
    for (const text of surfaces) {
      assert.doesNotMatch(text, /"touchedPaths"\s*:\s*\[\s*\]/, 'an unobserved set rendered as an empty list')
      assert.doesNotMatch(text, /touched paths[^\n]*: none/i, 'an unobserved set rendered as measured-empty')
    }
    assert.match(surfaces[2], /paths touched \(read from version control\): unknown \(the run made no commit\)/)

    // And the receipt the writer stored says the same thing directly.
    const stored = readRunLog(dir, 'run-no-commit').records.find(r => r.type === 'run-receipt')
    assert.equal(stored.touchedPaths, null)
    assert.notDeepEqual(stored.touchedPaths, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
