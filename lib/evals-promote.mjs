// Eval promotion — decide whether a case has earned the right to fail a build.
//
// The eval job is advisory. Moving a case from advisory to blocking is the one
// decision in this suite with real consequences for everyone else's pull
// requests, and until now the rule that governed it was a sentence in a
// specification — "promotion requires observed run-to-run variance" — which is a
// sentence a reviewer re-argues once per proposal. This module is that rule with
// an exit code on it, which is the same argument `lib/evals-triage.mjs` makes one
// layer down: the one rule a model or a reviewer could re-argue per run is
// exactly the rule to put behind a command.
//
// It reads a history of prior runs and per-grader judge agreement, and nothing
// else: no model, no network, same inputs same verdict.
//
// The rule, whose numbers all come from EVAL_CAPS and appear nowhere in prose:
//
//   - A case is promotable when it passed EVERY trial of EVERY qualifying run
//     across the last `promotionRuns` qualifying runs. This is pass^k, not
//     pass@k: eventual success is not success. A run must carry at least
//     `promotionTrialsPerRun` trials of the case to qualify as evidence.
//   - A run triage classified no-signal or configuration does not qualify. It is
//     EXCLUDED and NAMED, and it does not break the chain — an aborted run is
//     missing evidence, not evidence against.
//   - A case with a judged grader additionally requires a measured agreement at
//     or above `judgeAgreementFloor` for each of its judged graders. "No
//     measurement" is refused distinctly from "insufficient history": the first
//     is a fact about this case, the second is a fact about the whole window.
//
// Exposed as `interlock evals promote --history <dir>`.
//
// The verdict is the exit code:
//   0  promotable        every case in the window may be promoted
//   1  refused           at least one may not, each with its reason
//   2  insufficient      the history cannot decide — NOT a refusal
// 2 is deliberately the same shape as triage's `no_signal`: "not enough
// evidence" must never read as "the evidence says no" (promotion spec, "The exit
// status is the promotion verdict").

import { EVAL_CAPS } from './limits.mjs'

/** Verdict → exit code. The exit code IS the verdict; nothing re-derives it. */
export const EXIT = { promotable: 0, refused: 1, insufficient_history: 2 }

/** Triage verdicts that make a run unusable as promotion evidence. */
const NON_QUALIFYING = new Set(['no_signal', 'no-signal', 'nosignal', 'configuration'])

function caseId(kase) {
  return kase && typeof kase.id === 'string' && kase.id ? kase.id : '(unnamed)'
}

/** The judged graders a history record attributes to a case, as `<case>/<grader>`. */
function judgedGradersOf(kase) {
  const id = caseId(kase)
  const named = Array.isArray(kase && kase.judged_graders)
    ? kase.judged_graders
    : Array.isArray(kase && kase.judgedGraders)
      ? kase.judgedGraders
      : []
  const ids = named.filter(g => typeof g === 'string' && g).map(g => (g.includes('/') ? g : `${id}/${g}`))
  // A record may flag a case as judged without naming which grader. That is
  // still enough to refuse it — the reason just cannot name the grader, and it
  // says so rather than pretending the case is deterministic.
  if (ids.length === 0 && (kase && (kase.judged === true))) return [`${id}/(unnamed judged grader)`]
  return ids
}

/**
 * Decide promotion over a history of prior runs.
 *
 * Pure: no fs, no network, no model.
 *
 * @param {{history?: Array, agreement?: Object}} input
 *   `history`   — entries in chronological order, oldest first. Each is either
 *                 `{ file, record }` for a parsed results/history file, or
 *                 `{ file, error }` for one that could not be read or parsed.
 *   `agreement` — `<case>/<grader>` → measured agreement (0..1), from
 *                 `interlock evals calibrate`. A grader absent from this map is
 *                 unmeasured, which is not the same as measured at zero.
 * @returns {{verdict, exitCode, reason, cases, excluded, unreadable, window}}
 */
export function promote({ history = [], agreement = {} } = {}) {
  const entries = Array.isArray(history) ? history : []

  // An entry nobody could parse is named and stated as excluded. It is never
  // treated as an absent one, because an unreadable run silently narrowing the
  // window is exactly how a case gets promoted on less evidence than the rule
  // requires (promotion spec, "An unreadable history entry is spoken").
  const unreadable = entries
    .filter(e => e && (e.error || !e.record))
    .map(e => ({
      file: (e && e.file) || '(unnamed)',
      reason: (e && e.error) || 'no parsed record'
    }))

  const parsed = entries.filter(e => e && e.record && !e.error)

  // Runs that cannot serve as evidence. Excluded and named; the chain steps over
  // them rather than breaking on them.
  const excluded = []
  const qualifying = []
  for (const entry of parsed) {
    const verdict = String(
      entry.record.triage || entry.record.verdict || entry.record.classification || ''
    ).toLowerCase()
    if (NON_QUALIFYING.has(verdict)) {
      excluded.push({ file: entry.file, verdict: verdict || '(none)' })
      continue
    }
    qualifying.push(entry)
  }

  const needRuns = EVAL_CAPS.promotionRuns
  const needTrials = EVAL_CAPS.promotionTrialsPerRun
  const floor = EVAL_CAPS.judgeAgreementFloor

  // The window is the most recent `promotionRuns` qualifying runs.
  const window = qualifying.slice(-needRuns)

  const insufficient = (reason) => ({
    verdict: 'insufficient_history',
    exitCode: EXIT.insufficient_history,
    reason,
    cases: [],
    excluded,
    unreadable,
    window: window.map(e => e.file)
  })

  if (parsed.length === 0) {
    return insufficient(
      entries.length === 0
        ? 'the history directory holds no records'
        : `no history entry could be parsed (${unreadable.length} unreadable)`
    )
  }
  if (window.length < needRuns) {
    return insufficient(
      `the history holds ${window.length} qualifying run(s); the rule requires ${needRuns} ` +
        `consecutive` + (excluded.length ? ` (${excluded.length} excluded as non-qualifying)` : '')
    )
  }

  // Every case named anywhere in the window is in scope.
  const scope = new Set()
  for (const entry of window) {
    for (const kase of Array.isArray(entry.record.cases) ? entry.record.cases : []) {
      scope.add(caseId(kase))
    }
  }
  if (scope.size === 0) {
    return insufficient('the qualifying runs name no case; there is nothing to decide')
  }

  const cases = []
  for (const id of [...scope].sort()) {
    let refusal = null
    const judged = new Set()

    for (const entry of window) {
      const kase = (Array.isArray(entry.record.cases) ? entry.record.cases : []).find(
        c => caseId(c) === id
      )
      if (!kase) {
        refusal = refusal || `absent from qualifying run ${entry.file}`
        continue
      }
      for (const g of judgedGradersOf(kase)) judged.add(g)

      const trials = Number.isFinite(kase.trials) ? kase.trials : Number(kase.runs)
      const passed = Number.isFinite(kase.passed) ? kase.passed : Number(kase.passes)
      if (!Number.isFinite(trials) || !Number.isFinite(passed)) {
        refusal = refusal || `run ${entry.file} records no trial count for this case`
        continue
      }
      if (trials < needTrials) {
        refusal =
          refusal ||
          `run ${entry.file} carried ${trials} trial(s); a qualifying run needs ${needTrials}`
        continue
      }
      // pass^k: every trial of every run. Not most, not eventually.
      if (passed < trials) {
        refusal = refusal || `failed ${trials - passed} of ${trials} trial(s) in run ${entry.file}`
      }
    }

    // The judged rule applies on top of the run history, and its two failure
    // modes are reported apart: a judge measured below the floor is a fact about
    // the judge, a judge never measured is a fact about the calibration set.
    const judgedGraders = [...judged].sort()
    if (!refusal) {
      for (const g of judgedGraders) {
        const measured = agreement && Object.prototype.hasOwnProperty.call(agreement, g)
          ? agreement[g]
          : null
        if (typeof measured !== 'number' || Number.isNaN(measured)) {
          refusal = `judged grader ${g} has no measured agreement — run \`interlock evals calibrate\``
          break
        }
        if (measured < floor) {
          refusal = `judged grader ${g} agrees with the human label ${Math.round(measured * 100)}% of the time, below the published floor`
          break
        }
      }
    }

    cases.push({
      id,
      promotable: !refusal,
      reason: refusal,
      judgedGraders
    })
  }

  const refused = cases.filter(c => !c.promotable)
  return {
    verdict: refused.length ? 'refused' : 'promotable',
    exitCode: refused.length ? EXIT.refused : EXIT.promotable,
    reason: null,
    cases,
    excluded,
    unreadable,
    window: window.map(e => e.file)
  }
}

/** Human-readable rendering. The exit code, not this text, is the verdict. */
export function formatPromotion(result) {
  const lines = []
  if (result.verdict === 'insufficient_history') {
    lines.push(`insufficient history — ${result.reason}`)
    lines.push('no case is reported promotable; this is not a refusal')
  } else {
    lines.push(
      result.verdict === 'refused'
        ? `not yet promotable — ${result.cases.filter(c => !c.promotable).length} case(s) refused`
        : `promotable — every case in the window qualifies`
    )
    for (const c of result.cases) {
      if (c.promotable) lines.push(`  promotable  ${c.id}`)
      else lines.push(`  refused     ${c.id}  — ${c.reason}`)
    }
  }

  // Excluded and unreadable entries print in every verdict, including the clean
  // ones: a window that quietly stepped over half its history is exactly the
  // thing a reader needs to see before trusting a promotion.
  for (const e of result.excluded) {
    lines.push(`  excluded    ${e.file}  — triage classified it "${e.verdict}"; it does not break the chain`)
  }
  for (const u of result.unreadable) {
    lines.push(`  unreadable  ${u.file}  — excluded from the decision (${u.reason})`)
  }
  if (result.window.length) lines.push(`  window: ${result.window.join(', ')}`)
  lines.push('the exit code is the verdict (0 promotable, 1 refused, 2 insufficient history)')
  return lines.join('\n') + '\n'
}
