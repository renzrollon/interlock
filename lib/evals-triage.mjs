// Eval triage — turn a completed results run into a verdict, without a model.
//
// The eval suite runs a real model against Interlock's model-facing surface and
// writes a results file. Deciding what that file *means* — regression, run-to-run
// variance, or no signal at all — is a decision with a correct answer, so it
// lives here rather than in skill prose a model could re-argue on each run. This
// is the same argument `interlock gate` makes for review findings, and the same
// exit-code-as-verdict contract (see the design's D13).
//
// It reads the results file and nothing else: no model, no network. The same
// input always yields the same classification.
//
// Exposed to skills as `interlock evals triage --results <file>`.
//
// The verdict is carried by the exit code so no consumer re-derives it:
//   0  pass          every scored case passed (variance is not a regression)
//   1  regression    at least one case is a regression
//   2  no signal      the run did not complete — classifies nothing
//   3  configuration  zero scorable cases, or every case failed to load
// No signal and configuration are non-zero on purpose: neither may read as a
// clean pass, which a shared 0 would make indistinguishable (triage spec,
// "No signal does not read as success").

/** Verdict → exit code. The exit code IS the verdict; nothing re-derives it. */
export const EXIT = { pass: 0, regression: 1, no_signal: 2, configuration: 3 }

// A grader is judged when it names a judge in the loop. Everything else —
// pattern, tool-invocation, file-existence, ordering, set-membership — is
// deterministic, so its failure is trustworthy on a single run.
const JUDGED_TYPES = new Set(['judge', 'judged', 'model-judge', 'llm-judge', 'semantic'])

function isJudged(grader) {
  if (grader && grader.judged === true) return true
  const type = grader && typeof grader.type === 'string' ? grader.type.toLowerCase() : ''
  return JUDGED_TYPES.has(type)
}

// Skill-fired graders report whether the plugin caused the behaviour; they are
// excluded from the score in both arms (case-suite spec), so they can never be
// the evidence for a regression.
function isIndicator(grader) {
  if (!grader) return false
  if (grader.indicator === true) return true
  const type = typeof grader.type === 'string' ? grader.type.toLowerCase() : ''
  return type === 'indicator'
}

function graderName(grader, i) {
  return grader && typeof grader.name === 'string' && grader.name ? grader.name : `grader-${i + 1}`
}

// Two results shapes reach triage: the one `claude plugin eval` writes at
// schemaVersion 1 (`name`, `arms.with` / `arms['with-only']`) and the legacy
// `id` / `runs` shape the offline unit tests construct. Normalizing both at the
// case boundary keeps `classifyCase` the single classification rule — a second
// copy of that rule, one per shape, is how the next schema tweak forks the
// verdict.

function nonEmptyString(value) {
  return typeof value === 'string' && value ? value : null
}

/** Case identity: `name` when it is a non-empty string, else `id`. */
function caseIdentity(kase) {
  if (!kase) return '(unnamed)'
  return nonEmptyString(kase.name) || nonEmptyString(kase.id) || '(unnamed)'
}

function nonEmptyList(value) {
  return Array.isArray(value) && value.length > 0 ? value : null
}

// First non-empty of `runs`, `arms.with`, `arms['with-only']`. `arms.without` is
// never selected: it is the no-plugin baseline, and scoring it would mix
// comparison trials into the plugin verdict.
function caseTrials(kase) {
  if (!kase) return []
  const arms = kase.arms && typeof kase.arms === 'object' ? kase.arms : {}
  const trials = nonEmptyList(kase.runs) || nonEmptyList(arms.with) || nonEmptyList(arms['with-only']) || []
  return trials.map(trial => ({ graders: trial && trial.graders }))
}

/** Map one raw case, in either shape, onto the `{ id, runs }` classifyCase reads. */
function normalizeCase(kase) {
  return { id: caseIdentity(kase), runs: caseTrials(kase) }
}

/**
 * Classify one case from its per-run graders.
 * @returns {{id, classification: 'regression'|'variance'|'pass', graders: string[], confirm: string|null}}
 */
function classifyCase(kase) {
  const id = kase && typeof kase.id === 'string' && kase.id ? kase.id : '(unnamed)'
  const runs = Array.isArray(kase && kase.runs) ? kase.runs : []
  const runCount = runs.length

  // Deterministic failures are a regression on a single run. Judged failures
  // are counted across runs so a majority can be distinguished from a dip.
  const deterministicFails = []
  const judgedFailCounts = new Map()
  let judgedFailSeen = false

  for (const run of runs) {
    const graders = Array.isArray(run && run.graders) ? run.graders : []
    graders.forEach((g, i) => {
      if (isIndicator(g)) return
      if (g && g.passed === true) return
      const name = graderName(g, i)
      if (isJudged(g)) {
        judgedFailSeen = true
        judgedFailCounts.set(name, (judgedFailCounts.get(name) || 0) + 1)
      } else {
        if (!deterministicFails.includes(name)) deterministicFails.push(name)
      }
    })
  }

  // A judged grader failing on a majority of runs is a regression — but only
  // when there is more than one run to form a majority. A single judged dip is
  // variance, never a regression.
  const judgedRegressions = []
  if (runCount > 1) {
    for (const [name, fails] of judgedFailCounts) {
      if (fails * 2 > runCount) judgedRegressions.push(name)
    }
  }

  if (deterministicFails.length || judgedRegressions.length) {
    return {
      id,
      classification: 'regression',
      graders: [...deterministicFails, ...judgedRegressions],
      confirm: null
    }
  }

  if (judgedFailSeen) {
    const graders = [...judgedFailCounts.keys()]
    const confirm =
      runCount <= 1
        ? 'a judged grader dipped on the only run; further runs failing the same grader would confirm a regression'
        : 'a judged grader failed on a minority of runs; failing on a majority would confirm a regression'
    return { id, classification: 'variance', graders, confirm }
  }

  return { id, classification: 'pass', graders: [], confirm: null }
}

/**
 * Triage a completed eval results file into a verdict.
 * @param {any} results  parsed results file
 * @returns {{verdict, exitCode, reason, cases, unloadable, counts}}
 */
export function triage(results) {
  const r = results && typeof results === 'object' && !Array.isArray(results) ? results : {}

  // An incomplete run classifies nothing. A partial results file, an aborted
  // run, or a rejected credential is no signal — not a suite failure and not a
  // pass.
  const partialReason =
    typeof r.reason === 'string' && r.reason
      ? r.reason
      : typeof r.partial_reason === 'string' && r.partial_reason
        ? r.partial_reason
        : null
  if (r.partial === true || r.complete === false || partialReason) {
    return {
      verdict: 'no_signal',
      exitCode: EXIT.no_signal,
      reason: partialReason || 'run reported itself partial',
      cases: [],
      unloadable: [],
      counts: { regressions: 0, variance: 0, pass: 0 }
    }
  }

  const allCases = Array.isArray(r.cases) ? r.cases : []
  const unloadable = allCases
    .filter(c => c && c.loaded === false)
    .map(caseIdentity)
  const scorable = allCases.filter(c => c && c.loaded !== false)

  // Zero cases, or a suite where nothing loaded, is a configuration problem —
  // reported distinctly from both a clean pass and a regression.
  if (scorable.length === 0) {
    const reason =
      allCases.length === 0
        ? 'the run discovered no cases'
        : `every case failed to load (${unloadable.length})`
    return {
      verdict: 'configuration',
      exitCode: EXIT.configuration,
      reason,
      cases: [],
      unloadable,
      counts: { regressions: 0, variance: 0, pass: 0 }
    }
  }

  const cases = scorable.map(kase => classifyCase(normalizeCase(kase)))
  const counts = {
    regressions: cases.filter(c => c.classification === 'regression').length,
    variance: cases.filter(c => c.classification === 'variance').length,
    pass: cases.filter(c => c.classification === 'pass').length
  }
  const verdict = counts.regressions > 0 ? 'regression' : 'pass'
  return {
    verdict,
    exitCode: counts.regressions > 0 ? EXIT.regression : EXIT.pass,
    reason: null,
    cases,
    unloadable,
    counts
  }
}

/** Human-readable rendering. The exit code, not this text, is the verdict. */
export function formatTriage(result) {
  const lines = []
  if (result.verdict === 'no_signal') {
    lines.push(`no signal — ${result.reason}`)
    lines.push('classified no case; the run did not complete')
    return lines.join('\n') + '\n'
  }
  if (result.verdict === 'configuration') {
    lines.push(`configuration problem — ${result.reason}`)
    if (result.unloadable.length) lines.push(`unloadable: ${result.unloadable.join(', ')}`)
    lines.push('this is not a pass')
    return lines.join('\n') + '\n'
  }

  const { regressions, variance, pass } = result.counts
  lines.push(
    result.verdict === 'regression'
      ? `regression — ${regressions} case(s)`
      : variance
        ? 'no regression (variance present)'
        : 'pass'
  )
  for (const c of result.cases) {
    if (c.classification === 'regression') {
      lines.push(`  regression  ${c.id}  (failed: ${c.graders.join(', ')})`)
    } else if (c.classification === 'variance') {
      lines.push(`  variance    ${c.id}  (${c.graders.join(', ')}) — ${c.confirm}`)
    }
  }
  if (result.unloadable.length) {
    lines.push(`  unloadable  ${result.unloadable.join(', ')}`)
  }
  lines.push(`  scored ${result.cases.length}: ${regressions} regression, ${variance} variance, ${pass} pass`)
  return lines.join('\n') + '\n'
}
