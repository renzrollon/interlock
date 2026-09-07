// The reader the corpora never had.
//
// Interlock writes three corpora and, until this module, read none of them.
// `lib/outcomes.mjs` says so in its own header — per §4.15(a) it "records and
// nothing else" — `lib/run-log.mjs` accumulates a trajectory per ship run, and
// `lib/metrics.mjs` writes a review's counts. All three were write-only, which
// left the §4.16 / F6.6 question ("should we have skipped the human that time?")
// unanswerable not because the data was absent but because nothing computed
// over it.
//
// WHY THIS NEVER BLOCKS, AND NEVER WILL. Every rate here is one comparison away
// from a threshold, and §4.15(a) forbids exactly that comparison. So this module
// is an instrument: it exits nowhere, it labels nothing pass or fail, and no
// gate, readiness check, risk classification or workflow step may consume it.
// `interlock drift` and `interlock conformance` set the precedent for a
// subcommand that reports and does not block; this one carries the stronger
// version of that promise because the temptation is stronger.
//
// Four properties are load-bearing:
//
//   1. NEVER THROWS. A missing corpus, an unreadable file, a torn line and an
//      unreadable directory each become a reported condition carrying its
//      reason. A reader whose own crash is the output is worse than no reader.
//
//   2. WRITES NOTHING. Not even a cache. `lib/metrics.mjs` isolates the write
//      paths in `lib/` deliberately, and a reader that writes would join that
//      exception for no policy reason. The mitigation for a slow scan is
//      `--since`, not an index.
//
//   3. A DENOMINATOR TRAVELS WITH EVERY VALUE. `lib/doctor.mjs` holds that an
//      unknown is not a pass; `lib/outcomes.mjs` holds that reading absence as
//      cleanliness would flatter exactly the runs a corpus exists to explain. A
//      rate over an unstated denominator commits both errors at once, so a zero
//      denominator yields `null` and a reason — never `0`.
//
//   4. PROVENANCE SURVIVES THE ARITHMETIC. `lib/outcomes.mjs` partitions what a
//      run observed from what an agent reported. Averaging across that boundary
//      would launder a report into a measurement, so every indicator declares
//      the corpus it came from and the two are never summed.
//
// A FOURTH CORPUS JOINED LATER AND IS NOT ONE OF THE THREE. The outcome-eval
// history (`evals/history/ship-outcomes.jsonl`) records what a fixture run
// produced, not what real work produced. It is read under the same four
// properties above, and under one more: its indicators live in their own group,
// name their own source, carry their own denominators, and are never summed with
// a figure derived from a real run. A fixture result folded into a real-run
// figure would be a number about neither.
//
// THE SHARPEST INDICATOR IS COMPUTED FROM TWO RECORDED PATH SETS. "Does the
// merged diff still match the plan" was published as a declared gap for as long
// as nothing recorded the comparison. The receipt now records both halves — the
// paths the run's commit touched, read from version control, and the paths its
// executed plan predicted — so `planFidelity.diffMatchesPlan` is a share with a
// denominator, like every other value here.
//
// Its two near misses stay separate and are never merged into it: `planStatus`
// is about whether a *stored plan* was reused given its planning inputs, and the
// replan rate is about the plan changing mid-run. Both are about the plan;
// neither observes the diff, and publishing either under this name would be the
// restatement defect the old gap text existed to prevent.
//
// A run contributes only when both sets were observed, the prediction was
// complete, and neither set was truncated. Every other run is EXCLUDED AND
// COUNTED BY REASON rather than absorbed. A plan that declined to predict for
// some task is excluded rather than imputed as predicting nothing: imputing
// would depress the share for a planner's silence, and read as an implementer
// going off-plan.
//
// Exposed to skills as `interlock report [--json] [--since <iso>] [--change <name>]`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LEARNING_DIR, OUTCOMES_FILE, readOutcomes } from './outcomes.mjs'
import { METRICS_DIR, REVIEW_METRICS_SCHEMA } from './metrics.mjs'
import { RUN_LOG_DIR, readRunLog, runLogDir } from './run-log.mjs'
import { EVAL_HISTORY_DIR, SHIP_OUTCOMES_FILE, readShipOutcomes } from './eval-history.mjs'
import { REPORT_CAPS } from './limits.mjs'

/** Bump when an indicator's definition changes, so two reports stay comparable. */
export const REPORT_SCHEMA = 'interlock.report/1'

/**
 * Where each indicator's numbers came from. Kept as an explicit vocabulary
 * rather than a free string so a reader can tell a measurement from a report
 * without reading this file.
 */
export const SOURCES = Object.freeze({
  RECEIPT: 'receipt',
  TRAJECTORY: 'trajectory',
  OUTCOME_OBSERVED: 'outcome.observed',
  OUTCOME_REPORTED: 'outcome.reported',
  REVIEW_METRICS: 'review-metrics',
  /**
   * The outcome-eval history — results from fixture runs, not from real work.
   * Its own source name is what keeps it out of every other indicator: a figure
   * that summed a fixture result with a real run would be reporting a number
   * about neither.
   */
  EVAL_HISTORY: 'eval-history'
})

/**
 * The change name a trajectory carries when nothing told it which change it was
 * shipping. Runs carrying it are counted and reported as unattributed rather
 * than folded into a per-change tally — `a8e0db5` fixed the cause, so the share
 * is a fact about when a run happened, not a defect in this reader.
 */
export const UNATTRIBUTED = 'unnamed'

/**
 * What every surface says when the outcome-eval history holds nothing.
 *
 * Exported so the text and HTML renderings read it from one place. Two surfaces
 * wording the same absence differently is how a reader comes to believe they are
 * looking at two different facts.
 */
export const NO_EVAL_RESULT = 'no outcome-eval result has been recorded'

function messageOf(err) {
  return (err && err.message) || String(err)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * One indicator. `value` is `null` whenever the denominator is zero, and
 * `reason` then says why — the whole point of property 3 in the header.
 */
function indicator(source, { value = null, observedOf = 0, notObserved = 0, reason = null } = {}) {
  return {
    source,
    value: observedOf > 0 ? value : null,
    observedOf,
    notObserved,
    reason: observedOf > 0 ? null : reason || 'nothing observed this value'
  }
}

/** A share, rounded to four places so a rate reads as a rate rather than a float artefact. */
function share(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 10000) / 10000
}

// A tri-state count, matching `lib/run-log.mjs`'s receipt fields: `null` means
// the run never found out, which is not zero.
function observedCount(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

// ---------------------------------------------------------------------------
// Corpus reading
// ---------------------------------------------------------------------------

/**
 * Enumerate trajectory files newest-first and bound how many are opened.
 *
 * Ordered by mtime rather than by the timestamps inside, because the bound has
 * to be applied *before* reading — sorting by recorded start time would require
 * opening every file to decide which files not to open. mtime is the best
 * available proxy for "most recent" without a read, and the truncation is
 * reported rather than sampled silently.
 */
function enumerateTrajectories(root, maxRuns) {
  const dir = runLogDir(root)
  let names
  try {
    names = existsSync(dir) ? readdirSync(dir) : []
  } catch (err) {
    return { total: 0, runIds: [], truncated: false, notScanned: 0, reason: messageOf(err) }
  }
  const files = names.filter(name => name.endsWith('.jsonl'))
  const stamped = files.map(name => {
    let mtime = 0
    try {
      mtime = statSync(join(dir, name)).mtimeMs
    } catch {
      // An unstattable file sorts last and is still eligible to be read; the
      // read reports its own failure.
      mtime = 0
    }
    return { runId: name.slice(0, -'.jsonl'.length), mtime }
  })
  stamped.sort((a, b) => b.mtime - a.mtime)
  const kept = stamped.slice(0, maxRuns)
  return {
    total: files.length,
    runIds: kept.map(s => s.runId),
    truncated: files.length > kept.length,
    notScanned: files.length - kept.length,
    reason: null
  }
}

/**
 * Read the trajectories, keeping one digest per run rather than every event —
 * the indicators need tallies, and holding 4 000 event objects to compute six
 * numbers would be the only unbounded allocation in this module.
 *
 * A run is in the window if its earliest record is at or after `since`. One rule
 * for run-level and event-level indicators alike, so they share a denominator
 * basis; two rules would make the two halves of the report quietly
 * incomparable.
 */
function digestTrajectories(root, { since, change, maxRuns }) {
  const listing = enumerateTrajectories(root, maxRuns)
  const runs = []
  const unreadable = []
  let skippedLines = 0
  let filteredOut = 0

  for (const runId of listing.runIds) {
    const read = readRunLog(root, runId)
    if (read.reason) {
      unreadable.push({ runId, reason: read.reason })
      continue
    }
    skippedLines += read.skipped.length
    const records = read.records
    if (!records.length) {
      // A file that parsed to nothing is not an unreadable file and not a run.
      filteredOut++
      continue
    }

    const firstTs = records.map(r => (typeof r.ts === 'string' ? r.ts : '')).filter(Boolean).sort()[0] || ''
    if (since && (!firstTs || firstTs < since)) {
      filteredOut++
      continue
    }

    const start = records.find(r => r.type === 'run-start')
    const receipt = records.find(r => r.type === 'run-receipt')
    const runChange =
      (start && typeof start.change === 'string' && start.change) ||
      (typeof records[0].change === 'string' && records[0].change) ||
      UNATTRIBUTED
    if (change && runChange !== change) {
      filteredOut++
      continue
    }

    const waveActions = records.filter(r => r.type === 'wave-action')
    const cliExits = records.filter(r => r.type === 'cli-exit')

    runs.push({
      runId,
      change: runChange,
      startedAt: firstTs || null,
      hasRunStart: Boolean(start),
      hasTerminal: records.some(r => r.type === 'run-complete' || r.type === 'run-halt'),
      hasReceipt: Boolean(receipt),
      // Receipt-derived, tri-state throughout: a receipt written by a run that
      // halted before its review step reports the review counts as unobserved.
      halted: receipt ? receipt.halted === true : null,
      remediationRounds: receipt ? observedCount(receipt.remediationRounds) : null,
      planStatus: receipt && typeof receipt.planStatus === 'string' ? receipt.planStatus : null,
      reviewRaised: receipt ? observedCount(receipt.reviewRaised) : null,
      reviewSurviving: receipt ? observedCount(receipt.reviewSurviving) : null,
      reviewBlockers: receipt ? observedCount(receipt.reviewBlockers) : null,
      reviewWarnings: receipt ? observedCount(receipt.reviewWarnings) : null,
      // The two path sets, carried as `null` unless the receipt recorded an
      // actual array. `committed` comes with them because it is what separates
      // the two ways a touched set can be missing: a run that made no commit
      // from a commit whose paths could not be read.
      committed: receipt ? (receipt.committed === true ? true : receipt.committed === false ? false : null) : null,
      touchedPaths: receipt && Array.isArray(receipt.touchedPaths) ? receipt.touchedPaths : null,
      predictedPaths: receipt && Array.isArray(receipt.predictedPaths) ? receipt.predictedPaths : null,
      predictedPathsComplete: receipt && receipt.predictedPathsComplete === true,
      pathsTruncated:
        Boolean(receipt) &&
        (receipt.touchedPathsTruncated === true || receipt.predictedPathsTruncated === true),
      // Trajectory-derived, and available on runs with no receipt at all — which
      // is why these two indicators carry the report before the receipt path has
      // ever fired.
      replanned: waveActions.some(r => r.source === 'replan'),
      hasWaveActions: waveActions.length > 0,
      exits: cliExits.map(r => ({
        command: typeof r.command === 'string' && r.command ? r.command : '(unnamed)',
        exitCode: Number(r.exitCode) || 0
      }))
    })
  }

  return { listing, runs, unreadable, skippedLines, filteredOut }
}

/**
 * Read `.claude/metrics/`, classifying by the declared `schema` and never by
 * filename.
 *
 * `lib/metrics.mjs` writes `review-<change>-<stamp>.json`; `skills/review-
 * artifacts/SKILL.md` writes `review-artifacts-<change>-<stamp>.json`, which the
 * glob `review-*.json` also matches while carrying full finding bodies instead
 * of counts. A filename reader would mix a skill's prose into a counts
 * indicator and nothing would notice, so an unrecognized shape is named and
 * excluded rather than parsed hopefully.
 */
function digestMetrics(root, { since, change }) {
  const dir = join(root, METRICS_DIR)
  const empty = { exists: false, total: 0, recognized: [], unrecognized: [], unreadable: [], filteredOut: 0 }
  let names
  try {
    if (!existsSync(dir)) return empty
    names = readdirSync(dir).filter(n => n.endsWith('.json'))
  } catch (err) {
    return { ...empty, exists: true, unreadable: [{ file: METRICS_DIR, reason: messageOf(err) }] }
  }

  const recognized = []
  const unrecognized = []
  const unreadable = []
  let filteredOut = 0

  for (const name of names.sort()) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch (err) {
      unreadable.push({ file: name, reason: messageOf(err) })
      continue
    }
    if (!isObject(parsed) || parsed.schema !== REVIEW_METRICS_SCHEMA) {
      unrecognized.push({ file: name, schema: isObject(parsed) && typeof parsed.schema === 'string' ? parsed.schema : null })
      continue
    }
    const ts = typeof parsed.timestamp === 'string' ? parsed.timestamp : ''
    if (since && (!ts || ts < since)) {
      filteredOut++
      continue
    }
    if (change && parsed.change !== change) {
      filteredOut++
      continue
    }
    const counts = isObject(parsed.counts) ? parsed.counts : {}
    recognized.push({
      file: name,
      change: typeof parsed.change === 'string' ? parsed.change : null,
      raised: observedCount(counts.raised) || 0,
      dismissed: observedCount(counts.dismissed) || 0,
      droppedByQuality: observedCount(counts.droppedByQuality) || 0,
      surviving: observedCount(counts.surviving) || 0
    })
  }

  return { exists: true, total: names.length, recognized, unrecognized, unreadable, filteredOut }
}

/**
 * Read `evals/history/ship-outcomes.jsonl` — the fourth corpus.
 *
 * Under exactly the rules the other three are read by: never throws, a missing
 * or unreadable file is a reported condition carrying its reason, a torn line
 * costs that record and not the file, and a line is classified by its declared
 * schema rather than by where it was found.
 *
 * THE CHANGE FILTER CANNOT APPLY HERE, and that is stated rather than worked
 * around. Every other corpus keys on the change a run was shipping; an
 * outcome-eval result keys on a FIXTURE, which is not a change in this
 * repository and never will be. Returning these rows unfiltered under a
 * `--change` view would put fixture results into a page about one change, and
 * matching them against the change name would silently return nothing. So the
 * corpus is excluded and says so — the quiet degradation this project forbids,
 * refused in the smallest place it could have happened.
 */
function digestEvalHistory(root, { since, change }) {
  const path = join(root, EVAL_HISTORY_DIR, SHIP_OUTCOMES_FILE)
  if (change) {
    return {
      path,
      exists: null,
      excluded: true,
      reason:
        `excluded from a change-filtered view: an outcome-eval result is keyed by fixture and ` +
        `version, not by a change name, so the filter "${change}" cannot be applied to it`,
      records: [],
      unrecognized: [],
      skipped: [],
      filteredOut: 0
    }
  }

  const read = readShipOutcomes(root)
  const kept = []
  let filteredOut = 0
  for (const record of read.records) {
    const ts = typeof record.ts === 'string' ? record.ts : ''
    // A window filter narrows this corpus like any other: an excluded row
    // contributes to no value AND to no denominator.
    if (since && (!ts || ts < since)) {
      filteredOut++
      continue
    }
    kept.push(record)
  }
  return {
    path: read.path || path,
    exists: read.exists,
    excluded: false,
    reason: read.reason,
    records: kept,
    unrecognized: read.unrecognized,
    skipped: read.skipped,
    filteredOut
  }
}

function digestOutcomes(root, { since, change }) {
  const read = readOutcomes(root)
  const kept = []
  let filteredOut = 0
  for (const record of read.records) {
    const ts = typeof record.ts === 'string' ? record.ts : ''
    if (since && (!ts || ts < since)) {
      filteredOut++
      continue
    }
    if (change && record.change !== change) {
      filteredOut++
      continue
    }
    kept.push(record)
  }
  return { ...read, records: kept, filteredOut }
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

function coverageOf(trajectories, outcomes, metrics, evalHistory) {
  const byMode = {}
  for (const record of outcomes.records) {
    const mode = typeof record.mode === 'string' ? record.mode : 'unknown'
    byMode[mode] = (byMode[mode] || 0) + 1
  }
  return {
    trajectories: {
      total: trajectories.listing.total,
      scanned: trajectories.runs.length,
      truncated: trajectories.listing.truncated,
      notScanned: trajectories.listing.notScanned,
      filteredOut: trajectories.filteredOut,
      withRunStart: trajectories.runs.filter(r => r.hasRunStart).length,
      withTerminal: trajectories.runs.filter(r => r.hasTerminal).length,
      withReceipt: trajectories.runs.filter(r => r.hasReceipt).length,
      unreadable: trajectories.unreadable,
      skippedLines: trajectories.skippedLines,
      reason: trajectories.listing.reason
    },
    outcomes: {
      path: outcomes.path,
      exists: outcomes.exists,
      records: outcomes.records.length,
      byMode,
      filteredOut: outcomes.filteredOut,
      skippedLines: outcomes.skipped.length,
      reason: outcomes.reason
    },
    metrics: {
      exists: metrics.exists,
      total: metrics.total,
      recognized: metrics.recognized.length,
      unrecognized: metrics.unrecognized,
      unreadable: metrics.unreadable,
      filteredOut: metrics.filteredOut
    },
    // The fourth corpus. Fixture runs, not real work — kept in its own block for
    // the same reason its indicators are kept in their own group.
    evalHistory: {
      path: evalHistory.path,
      exists: evalHistory.exists,
      excluded: evalHistory.excluded,
      records: evalHistory.records.length,
      unrecognized: evalHistory.unrecognized,
      skippedLines: evalHistory.skipped.length,
      filteredOut: evalHistory.filteredOut,
      reason: evalHistory.reason
    }
  }
}

/**
 * The share of runs that reached their close without a remediation round.
 *
 * Deliberately NOT called a CI success rate: no CI result is recorded anywhere
 * in these corpora, and borrowing the name would claim an observation nothing
 * made. A receipt whose remediation count is unobserved is counted as not
 * observed and leaves the denominator short — the alternative, reading absence
 * as zero rounds, would score exactly the runs that died early as the cleanest.
 */
function firstPassShipOf(runs) {
  const receipts = runs.filter(r => r.hasReceipt)
  const observed = receipts.filter(r => r.halted !== null && r.remediationRounds !== null)
  const firstPass = observed.filter(r => r.halted === false && r.remediationRounds === 0)
  return {
    rate: indicator(SOURCES.RECEIPT, {
      value: share(firstPass.length, observed.length),
      observedOf: observed.length,
      notObserved: receipts.length - observed.length,
      reason: receipts.length
        ? 'no receipt observed both the halt state and the remediation count'
        : 'no run has written a receipt'
    }),
    firstPassRuns: firstPass.length,
    note: 'not a CI success rate — no CI result is recorded in any corpus'
  }
}

function reworkOf(runs) {
  const receipts = runs.filter(r => r.hasReceipt && r.remediationRounds !== null)
  const distribution = {}
  let total = 0
  for (const run of receipts) {
    const key = String(run.remediationRounds)
    distribution[key] = (distribution[key] || 0) + 1
    total += run.remediationRounds
  }

  const attributed = runs.filter(r => r.change !== UNATTRIBUTED)
  const perChange = {}
  for (const run of attributed) perChange[run.change] = (perChange[run.change] || 0) + 1
  const changes = Object.keys(perChange)
    .sort()
    .map(change => ({ change, runs: perChange[change] }))

  return {
    // Kept apart from attempts-per-change on purpose: one counts repair inside a
    // run, the other counts runs against one change. Summing them would invent a
    // "rework" number neither corpus supports.
    remediationRounds: {
      ...indicator(SOURCES.RECEIPT, {
        value: receipts.length ? Math.round((total / receipts.length) * 100) / 100 : null,
        observedOf: receipts.length,
        notObserved: runs.filter(r => r.hasReceipt).length - receipts.length,
        reason: 'no receipt observed a remediation count'
      }),
      distribution
    },
    attemptsPerChange: {
      ...indicator(SOURCES.TRAJECTORY, {
        value: changes.length ? Math.round((attributed.length / changes.length) * 100) / 100 : null,
        observedOf: attributed.length,
        notObserved: runs.length - attributed.length,
        reason: `every scanned run is attributed to "${UNATTRIBUTED}"`
      }),
      changes,
      unattributed: runs.length - attributed.length
    }
  }
}

/**
 * Why a run kept out of the diff-vs-plan share was kept out. Each is counted and
 * printed beside the figure, so a reader can see which recording gap to close
 * first rather than inferring one from a thin denominator.
 */
export const PLAN_FIDELITY_EXCLUSIONS = Object.freeze({
  noCommit: 'the run made no commit, so no touched set was observed',
  unreadableSet: 'a path set was recorded unobserved — the read failed',
  incompletePrediction: 'the executed plan did not predict paths for every task',
  truncatedSet: 'a path set exceeded its recorded bound, so it is a prefix rather than the set'
})

/**
 * The share of touched paths the executed plan predicted, pooled over paths.
 *
 * POOLED, NOT AVERAGED PER RUN: a run touching one file would otherwise weigh
 * the same as a run touching forty, and the question ("how much of what we
 * changed was foreseen") is about paths, not about runs.
 *
 * THE DIRECTION IS FIXED. Numerator: touched paths that were predicted.
 * Denominator: touched paths. The converse — predicted paths that were touched
 * — answers a different question (a plan that predicted work the run never did)
 * and is never published under this name.
 */
function diffMatchesPlanOf(runs) {
  const receipts = runs.filter(r => r.hasReceipt)
  const excluded = { noCommit: 0, unreadableSet: 0, incompletePrediction: 0, truncatedSet: 0 }
  const qualifying = []

  for (const run of receipts) {
    if (!Array.isArray(run.touchedPaths)) {
      // Which of the two absences this is, decided from the recorded commit
      // state rather than by parsing the recorded reason string.
      if (run.committed !== true) excluded.noCommit++
      else excluded.unreadableSet++
      continue
    }
    if (!Array.isArray(run.predictedPaths)) {
      excluded.unreadableSet++
      continue
    }
    if (run.pathsTruncated) {
      excluded.truncatedSet++
      continue
    }
    if (!run.predictedPathsComplete) {
      excluded.incompletePrediction++
      continue
    }
    qualifying.push(run)
  }

  let matched = 0
  let touched = 0
  for (const run of qualifying) {
    const predicted = new Set(run.predictedPaths)
    touched += run.touchedPaths.length
    matched += run.touchedPaths.filter(p => predicted.has(p)).length
  }

  const excludedRuns = Object.values(excluded).reduce((a, b) => a + b, 0)

  return {
    // A zero denominator yields `null` with its reason, never `0` — a `0` here
    // would assert that nothing the runs touched was predicted.
    ...indicator(SOURCES.RECEIPT, {
      value: share(matched, touched),
      observedOf: touched,
      notObserved: excludedRuns,
      reason: qualifying.length
        ? 'the qualifying runs committed no paths, so there is nothing to have predicted'
        : receipts.length
          ? 'no scanned run recorded both path sets complete and untruncated'
          : 'no run has written a receipt'
    }),
    direction:
      'the share of paths the run TOUCHED that the executed plan predicted — the touched set is ' +
      'the denominator; the converse figure is a different question and is not published here',
    runs: qualifying.length,
    paths: { matched, touched },
    excluded,
    excludedRuns,
    exclusionReasons: PLAN_FIDELITY_EXCLUSIONS
  }
}

function planFidelityOf(runs) {
  const withStatus = runs.filter(r => r.planStatus)
  const statusCounts = {}
  for (const run of withStatus) statusCounts[run.planStatus] = (statusCounts[run.planStatus] || 0) + 1

  const withWaves = runs.filter(r => r.hasWaveActions)
  const revised = withWaves.filter(r => r.replanned)

  return {
    planStatus: {
      ...indicator(SOURCES.RECEIPT, {
        value: null,
        observedOf: withStatus.length,
        notObserved: runs.filter(r => r.hasReceipt).length - withStatus.length,
        reason: 'no receipt recorded a plan-reuse status'
      }),
      // A distribution, not a rate: the statuses are the `REUSE_*` vocabulary in
      // lib/plan-fingerprint.mjs and are not ordered, so there is no numerator.
      counts: statusCounts
    },
    midRunRevision: indicator(SOURCES.TRAJECTORY, {
      value: share(revised.length, withWaves.length),
      observedOf: withWaves.length,
      notObserved: runs.length - withWaves.length,
      reason: 'no scanned run recorded a wave action'
    }),
    // Computed from the receipt's two path sets. See the module header: the two
    // figures above are about the plan, this one is about the diff, and none of
    // the three may be published under another's name.
    diffMatchesPlan: diffMatchesPlanOf(runs)
  }
}

function reviewFindingsOf(runs, metrics) {
  const files = metrics.recognized
  const fromMetrics = files.reduce(
    (acc, f) => ({
      raised: acc.raised + f.raised,
      dismissed: acc.dismissed + f.dismissed,
      droppedByQuality: acc.droppedByQuality + f.droppedByQuality,
      surviving: acc.surviving + f.surviving
    }),
    { raised: 0, dismissed: 0, droppedByQuality: 0, surviving: 0 }
  )

  const receipts = runs.filter(r => r.hasReceipt && r.reviewRaised !== null)
  const fromReceipts = receipts.reduce(
    (acc, r) => ({
      raised: acc.raised + r.reviewRaised,
      surviving: acc.surviving + (r.reviewSurviving || 0),
      blockers: acc.blockers + (r.reviewBlockers || 0),
      warnings: acc.warnings + (r.reviewWarnings || 0)
    }),
    { raised: 0, surviving: 0, blockers: 0, warnings: 0 }
  )

  return {
    // Two series, never summed: different writers, different runs, and one of
    // them counts a dismissal the other does not record at all.
    fromMetrics: {
      files: files.length,
      counts: fromMetrics,
      dismissalShare: indicator(SOURCES.REVIEW_METRICS, {
        value: share(fromMetrics.dismissed, fromMetrics.raised),
        observedOf: fromMetrics.raised,
        notObserved: files.length,
        reason: files.length
          ? 'no finding was raised in the recognized review-metrics files'
          : 'no review-metrics file was recognized'
      })
    },
    fromReceipts: {
      runs: receipts.length,
      counts: fromReceipts,
      // The receipt records what survived, not what was dismissed, so the share
      // it supports is survival — naming it a dismissal share would assert a
      // count nothing wrote.
      survivalShare: indicator(SOURCES.RECEIPT, {
        value: share(fromReceipts.surviving, fromReceipts.raised),
        observedOf: fromReceipts.raised,
        notObserved: runs.filter(r => r.hasReceipt).length - receipts.length,
        reason: 'no receipt observed a raised-finding count'
      })
    }
  }
}

/**
 * Which deterministic gate actually blocks, and how often. Derived from
 * `cli-exit` events, which exist on runs that never wrote a receipt — this and
 * `midRunRevision` are why the report says something useful before the receipt
 * path has ever fired.
 *
 * A command with no recorded exits is absent rather than zero: an unexercised
 * command and a command that never failed are different facts.
 */
function gateExitHealthOf(runs) {
  const byCommand = new Map()
  let totalExits = 0
  let totalNonZero = 0
  for (const run of runs) {
    for (const exit of run.exits) {
      const entry = byCommand.get(exit.command) || { command: exit.command, exits: 0, nonZero: 0 }
      entry.exits++
      totalExits++
      if (exit.exitCode !== 0) {
        entry.nonZero++
        totalNonZero++
      }
      byCommand.set(exit.command, entry)
    }
  }
  const commands = [...byCommand.values()]
    .map(e => ({ ...e, nonZeroShare: share(e.nonZero, e.exits) }))
    .sort((a, b) => b.nonZero - a.nonZero || a.command.localeCompare(b.command))
  return {
    nonZeroShare: indicator(SOURCES.TRAJECTORY, {
      value: share(totalNonZero, totalExits),
      observedOf: totalExits,
      notObserved: 0,
      reason: 'no scanned run recorded a command exit'
    }),
    totalExits,
    totalNonZero,
    commands
  }
}

/**
 * What the outcome-eval history records, per arm.
 *
 * THREE RULES, and they are the whole reason this is a separate function rather
 * than more entries in the groups above:
 *
 *   1. Its indicators are sourced from `eval-history` and from nothing else. No
 *      figure here counts a real run, and no figure above counts a fixture
 *      result. The two are never summed.
 *   2. Every figure carries its own denominator, and a zero denominator yields
 *      `null` with a reason rather than a `0`.
 *   3. There is no verdict. A pass share here is a count over a stated whole; it
 *      is not a grade, and the thinness of the record is stated beside it
 *      because one run per fixture per arm licenses nothing on its own.
 *
 * A row missing its model or its eval-agent identity is counted `incomparable`
 * and excluded: without the instrument, a row cannot be paired with another for
 * a version comparison, and pairing it anyway is how an apparatus change gets
 * read as a product change.
 */
function shipOutcomeEvalOf(history) {
  const base = {
    excluded: Boolean(history.excluded),
    reason: history.excluded ? history.reason : null,
    records: history.records.length,
    byArm: {},
    fixtures: [],
    versions: {},
    incomparable: 0,
    note:
      'fixture results, never real runs — no figure here is summed with another corpus, and one ' +
      'run per fixture per arm licenses no conclusion on its own'
  }
  if (history.excluded) return base

  const fixtures = new Set()
  const byArm = {}
  for (const record of history.records) {
    const arm = typeof record.arm === 'string' ? record.arm : 'unknown'
    if (typeof record.fixture === 'string') fixtures.add(record.fixture)
    if (typeof record.version === 'string') {
      base.versions[record.version] = (base.versions[record.version] || 0) + 1
    }
    // The instrument, or its absence. A row that cannot say which model and
    // which agent produced it is not comparable across versions, and says so.
    const comparable =
      typeof record.model === 'string' &&
      record.model &&
      record.model !== 'unknown' &&
      typeof record.evalAgent === 'string' &&
      record.evalAgent &&
      record.evalAgent !== 'unknown'
    if (!comparable) base.incomparable++

    const entry = (byArm[arm] = byArm[arm] || { rows: 0, met: 0, applicable: 0, notApplicable: 0, unobserved: 0 })
    entry.rows++
    const tally = record.tally && typeof record.tally === 'object' ? record.tally : {}
    entry.met += observedCount(tally.met) || 0
    entry.applicable += observedCount(tally.applicable) || 0
    entry.notApplicable += observedCount(tally.notApplicable) || 0
    entry.unobserved += observedCount(tally.unobserved) || 0
  }

  for (const [arm, entry] of Object.entries(byArm)) {
    base.byArm[arm] = {
      rows: entry.rows,
      criteriaMet: indicator(SOURCES.EVAL_HISTORY, {
        value: share(entry.met, entry.applicable),
        observedOf: entry.applicable,
        notObserved: entry.notApplicable,
        reason: entry.rows
          ? 'no recorded result carried an applicable criterion'
          : 'no result has been recorded for this arm'
      }),
      // Kept beside the share rather than folded into it: a criterion that could
      // not be decided is not a criterion that failed, and a criterion the arm
      // cannot have is neither.
      notApplicable: entry.notApplicable,
      unobserved: entry.unobserved
    }
  }
  base.fixtures = [...fixtures].sort()
  return base
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Compute every indicator the corpora support. Never throws, writes nothing,
 * and produces no verdict.
 *
 * @param {string} [root] repository root
 * @param {{since?: string, change?: string, maxRuns?: number}} [opts]
 *   `since` is an ISO 8601 instant; a run is in the window when its earliest
 *   record is at or after it. `maxRuns` overrides the published scan cap.
 * @returns {object} report
 */
export function buildReport(root = '.', opts = {}) {
  const since = typeof opts.since === 'string' && opts.since.trim() ? opts.since.trim() : null
  const change = typeof opts.change === 'string' && opts.change.trim() ? opts.change.trim() : null
  const requested = Number(opts.maxRuns)
  const maxRuns =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), REPORT_CAPS.maxRunsScanned)
      : REPORT_CAPS.maxRunsScanned

  const filter = { since, change, maxRuns }

  try {
    const trajectories = digestTrajectories(root, filter)
    const outcomes = digestOutcomes(root, filter)
    const metrics = digestMetrics(root, filter)
    const evalHistory = digestEvalHistory(root, filter)
    const runs = trajectories.runs

    return {
      schema: REPORT_SCHEMA,
      root,
      filter,
      coverage: coverageOf(trajectories, outcomes, metrics, evalHistory),
      indicators: {
        firstPassShip: firstPassShipOf(runs),
        rework: reworkOf(runs),
        planFidelity: planFidelityOf(runs),
        reviewFindings: reviewFindingsOf(runs, metrics),
        gateExitHealth: gateExitHealthOf(runs),
        // Last, and in its own group: these are fixture results, and everything
        // above is real work. Nothing crosses between the two.
        shipOutcomeEval: shipOutcomeEvalOf(evalHistory)
      },
      // Restated on the payload, not only in the header, because the payload is
      // what a reader who never opens this file will see.
      gates: false,
      note: 'reports only — nothing in the loop reads this output, and no value is compared against a threshold (§4.15a)'
    }
  } catch (err) {
    // A reader that cannot read is still a reader that reports. Property 1.
    return {
      schema: REPORT_SCHEMA,
      root,
      filter,
      coverage: null,
      indicators: null,
      gates: false,
      reason: messageOf(err),
      note: 'the report could not be computed; nothing is asserted about the corpora'
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pct(ind) {
  if (!ind || ind.value === null) return `unobserved (${ind ? ind.reason : 'no indicator'})`
  return `${(ind.value * 100).toFixed(1)}%  of ${ind.observedOf} observed` +
    (ind.notObserved ? `, ${ind.notObserved} not observed` : '')
}

function plain(ind, unit = '') {
  if (!ind || ind.value === null) return `unobserved (${ind ? ind.reason : 'no indicator'})`
  return `${ind.value}${unit}  of ${ind.observedOf} observed` +
    (ind.notObserved ? `, ${ind.notObserved} not observed` : '')
}

/** Human-readable report. Coverage first, per design.md D3. */
export function formatReport(report) {
  const lines = []
  lines.push('INTERLOCK REPORT — indicators over the recorded corpora. Gates nothing (§4.15a).')

  if (report.filter && (report.filter.since || report.filter.change)) {
    const bits = []
    if (report.filter.since) bits.push(`since ${report.filter.since}`)
    if (report.filter.change) bits.push(`change ${report.filter.change}`)
    lines.push(`  filter: ${bits.join(', ')}`)
  }

  if (!report.coverage) {
    lines.push(`  the report could not be computed: ${report.reason || 'unknown'}`)
    return lines.join('\n') + '\n'
  }

  const { trajectories: t, outcomes: o, metrics: m, evalHistory: e } = report.coverage

  lines.push('')
  lines.push('COVERAGE — what the corpora can and cannot answer')
  lines.push(
    `  trajectories      ${t.scanned} scanned of ${t.total} on disk` +
      (t.truncated ? `  (scan capped; ${t.notScanned} not read)` : '') +
      (t.filteredOut ? `  (${t.filteredOut} outside the filter)` : '')
  )
  lines.push(`    with run-start  ${t.withRunStart}`)
  lines.push(`    with terminal   ${t.withTerminal}   (run-complete or run-halt)`)
  lines.push(`    with receipt    ${t.withReceipt}   — every receipt-derived indicator below rests on this`)
  if (t.skippedLines) lines.push(`    torn lines      ${t.skippedLines} skipped`)
  for (const u of t.unreadable) lines.push(`    unreadable      ${u.runId}: ${u.reason}`)
  if (t.reason) lines.push(`    directory       ${t.reason}`)

  lines.push(
    `  outcome corpus    ${o.exists ? `${o.records} record(s)` : 'absent'}` +
      (o.exists && Object.keys(o.byMode).length
        ? `: ${Object.keys(o.byMode).sort().map(k => `${o.byMode[k]} ${k}`).join(', ')}`
        : '') +
      (o.filteredOut ? `  (${o.filteredOut} outside the filter)` : '')
  )
  if (!o.exists) lines.push(`    ${o.path} does not exist — no ship run has recorded an outcome`)
  if (o.skippedLines) lines.push(`    ${o.skippedLines} unreadable line(s) skipped`)

  lines.push(
    `  review metrics    ${m.recognized} recognized of ${m.total} file(s)` +
      (m.filteredOut ? `  (${m.filteredOut} outside the filter)` : '')
  )
  for (const u of m.unrecognized) {
    lines.push(`    not counted     ${u.file}${u.schema ? ` (schema ${u.schema})` : ' (no schema key)'}`)
  }
  for (const u of m.unreadable) lines.push(`    unreadable      ${u.file}: ${u.reason}`)

  // The fourth corpus, and it says out loud when a filter has removed it rather
  // than reporting an empty one.
  if (e) {
    lines.push(
      `  outcome evals     ` +
        (e.excluded
          ? 'excluded from this view'
          : e.exists
            ? `${e.records} result(s)`
            : 'absent') +
        (!e.excluded && e.filteredOut ? `  (${e.filteredOut} outside the filter)` : '')
    )
    if (e.excluded) lines.push(`    ${e.reason}`)
    else if (!e.exists) lines.push(`    ${e.path} does not exist — no outcome eval has recorded a result`)
    if (e.reason && !e.excluded) lines.push(`    unreadable      ${e.reason}`)
    if (e.skippedLines) lines.push(`    ${e.skippedLines} unreadable line(s) skipped`)
    for (const u of e.unrecognized || []) {
      lines.push(`    not counted     line ${u.line}${u.schema ? ` (schema ${u.schema})` : ' (no schema key)'}`)
    }
  }

  const i = report.indicators
  lines.push('')
  lines.push('INDICATORS')

  lines.push(`  first-pass ship          ${pct(i.firstPassShip.rate)}`)
  lines.push(`                           ${i.firstPassShip.note}`)

  lines.push(`  remediation rounds/run   ${plain(i.rework.remediationRounds)}`)
  const dist = Object.keys(i.rework.remediationRounds.distribution).sort()
  if (dist.length) {
    lines.push(`                           distribution: ${dist.map(k => `${k}→${i.rework.remediationRounds.distribution[k]}`).join('  ')}`)
  }
  lines.push(`  runs per change          ${plain(i.rework.attemptsPerChange)}`)
  if (i.rework.attemptsPerChange.unattributed) {
    lines.push(`                           ${i.rework.attemptsPerChange.unattributed} run(s) attributed to "${UNATTRIBUTED}" and excluded`)
  }
  for (const c of i.rework.attemptsPerChange.changes) {
    lines.push(`                           ${c.change}: ${c.runs} run(s)`)
  }

  const statuses = Object.keys(i.planFidelity.planStatus.counts).sort()
  lines.push(
    `  plan-reuse status        ${statuses.length ? statuses.map(s => `${s}→${i.planFidelity.planStatus.counts[s]}`).join('  ') : `unobserved (${i.planFidelity.planStatus.reason})`}`
  )
  lines.push(`  plan revised mid-run     ${pct(i.planFidelity.midRunRevision)}`)
  const dmp = i.planFidelity.diffMatchesPlan
  lines.push(`  diff matches plan        ${pct(dmp)}`)
  lines.push(`                           ${dmp.direction}`)
  if (dmp.value !== null) {
    lines.push(
      `                           ${dmp.paths.matched} of ${dmp.paths.touched} touched path(s) ` +
        `across ${dmp.runs} qualifying run(s)`
    )
  }
  // Named and counted, never absorbed: the exclusions are how a reader tells a
  // thin denominator from a fair one, and which recording gap to close first.
  for (const key of Object.keys(dmp.excluded)) {
    if (!dmp.excluded[key]) continue
    lines.push(`                           excluded ${dmp.excluded[key]} run(s): ${dmp.exclusionReasons[key]}`)
  }

  const fm = i.reviewFindings.fromMetrics
  lines.push(
    `  review findings          from ${fm.files} metrics file(s): ` +
      `${fm.counts.raised} raised, ${fm.counts.dismissed} dismissed, ` +
      `${fm.counts.droppedByQuality} dropped by quality, ${fm.counts.surviving} surviving`
  )
  lines.push(`                           dismissal share: ${pct(fm.dismissalShare)}`)
  const fr = i.reviewFindings.fromReceipts
  lines.push(
    `                           from ${fr.runs} receipt(s): ` +
      `${fr.counts.raised} raised, ${fr.counts.surviving} surviving, ` +
      `${fr.counts.blockers} blocker(s), ${fr.counts.warnings} warning(s)`
  )
  lines.push(`                           survival share: ${pct(fr.survivalShare)}`)
  lines.push('                           the two series are never summed — different writers, different runs')

  const g = i.gateExitHealth
  lines.push(`  gate exits non-zero      ${pct(g.nonZeroShare)}`)
  for (const c of g.commands) {
    lines.push(`      ${String(c.command).padEnd(26)} ${c.nonZero} of ${c.exits} non-zero`)
  }

  // Its own block, after a rule, because everything above is real work and this
  // is fixtures. A reader who skims must not carry a fixture number away as a
  // fact about the loop's real runs.
  const s = i.shipOutcomeEval
  if (s) {
    lines.push('')
    lines.push('  OUTCOME EVALS (fixtures, never real runs — never summed with anything above)')
    if (s.excluded) {
      lines.push(`      excluded: ${s.reason}`)
    } else if (!s.records) {
      // Worded exactly as the HTML surface words it, from one constant: the two
      // must not describe the same absence differently.
      lines.push(`      unobserved (${NO_EVAL_RESULT})`)
    } else {
      for (const arm of Object.keys(s.byArm).sort()) {
        const a = s.byArm[arm]
        lines.push(`      ${arm.padEnd(10)} ${a.rows} result(s), criteria met ${pct(a.criteriaMet)}`)
        if (a.notApplicable) {
          lines.push(`                 ${a.notApplicable} criterion/criteria not applicable to this arm, excluded`)
        }
        if (a.unobserved) lines.push(`                 ${a.unobserved} unobserved, counted as not met`)
      }
      const versions = Object.keys(s.versions).sort()
      if (versions.length) {
        lines.push(`      versions   ${versions.map(v => `${v}→${s.versions[v]}`).join('  ')}`)
      }
      if (s.fixtures.length) lines.push(`      fixtures   ${s.fixtures.join(', ')}`)
      if (s.incomparable) {
        lines.push(
          `      ${s.incomparable} row(s) carry no model or eval-agent identity and are not paired ` +
            `across versions`
        )
      }
      lines.push(`      ${s.note}`)
    }
  }

  lines.push('')
  lines.push('  Nothing above is a verdict, and nothing in the loop reads it. Exit status is always 0.')
  return lines.join('\n') + '\n'
}

/** Re-exported so a caller need not import three modules to know where to look. */
export const CORPORA = Object.freeze({
  outcomes: join(LEARNING_DIR, OUTCOMES_FILE),
  trajectories: RUN_LOG_DIR,
  metrics: METRICS_DIR,
  evalHistory: join(EVAL_HISTORY_DIR, SHIP_OUTCOMES_FILE)
})
