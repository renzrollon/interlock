// Remediation policy: what gets fixed, what gets deferred, and when to stop.
//
// A review produces findings; something has to decide which of them a fixer
// agent is allowed to touch, how those fixers may be fanned out, and at what
// point the loop stops trying. None of that is judgement — it is policy — so it
// lives here rather than being re-argued in prose on every run:
//
//   1. Blockers are always fixed; suggestions are always deferred. A model
//      asked to triage its own review will negotiate with itself ("this
//      blocker is really a suggestion"), which is exactly why the routing is
//      not left to it. Warnings are fixed alongside blockers — they are cheap
//      to fix while a fixer is already in the file — but an unresolved warning
//      is never a halt reason. Only a blocker can stop a run.
//
//   2. Fixers are grouped by file. Two agents editing one file concurrently
//      lose each other's edits, so `byFile` groups (disjoint by construction)
//      are the parallel-safe partition and the unscoped group — findings with
//      no single owning file — is applied last, sequentially, on top of them.
//
//   3. Rounds are capped at `LIMITS.remediationRounds`. Each round is
//      fix → re-review, and the re-review is scoped to the dimensions that
//      actually raised findings; re-running a dimension that was already clean
//      is pure token cost.
//
//   4. Blockers still standing when the round budget is spent halt the run.
//      Halting is returned as a boolean and a reason, not as advice, because a
//      caller that can read the halt as a suggestion will talk itself past it.
//      The verdict is its own round (`cap + 1`) rather than a flag on the last
//      fix round — see `planRemediation`.
//
//   5. Nothing is dropped silently. A finding this module declines to fix is
//      recorded in `deferred` with the reason it was declined, including the
//      ones the tolerance band scored away.
//
// This module is a decision function, not a runner: state in, plan out. The
// dynamic-workflow runtime cannot import modules and has no filesystem or
// shell of its own, so its agents reach this policy by shelling out to
// `interlock remediate` and acting on the JSON. There is deliberately no loop,
// no agent callback and no I/O here.
//
// Pure: no fs, no agent, no I/O, no clock.
// Exposed to skills as `interlock remediate --findings <file> --round <n>`.

import { applyToleranceBand, groupByFile, TOLERANCE_BAND } from './findings.mjs'
import { LIMITS } from './limits.mjs'

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

/** Severities a fixer agent is allowed to act on, in priority order. */
export const FIXABLE_SEVERITIES = ['blocker', 'warning']

/** Severities policy always defers, however the reviewer argues. */
export const DEFERRED_SEVERITIES = ['suggestion']

const DEFER_REASONS = {
  suggestion:
    'suggestion — deferred by policy; a suggestion is never fixed inside a remediation round',
  unknownSeverity: severity =>
    `unrecognized severity ${severity} — deferred for human triage rather than guessed at`,
  quality: min => `scored below the reporting quality band (minQualityToReport=${min})`,
  budgetSpent: cap =>
    `remediation budget spent — ${cap} fix round(s) used, no round remains to fix this`
}

// Blocker and warning are fixed; suggestion is deferred; anything else is
// deferred rather than guessed at. Returning a reason for every non-fix keeps
// requirement 5 (nothing disappears) structural rather than remembered.
function route(finding) {
  const severity = finding.severity
  if (FIXABLE_SEVERITIES.includes(severity)) return { fix: true, reason: null }
  if (DEFERRED_SEVERITIES.includes(severity)) {
    return { fix: false, reason: DEFER_REASONS.suggestion }
  }
  const shown = typeof severity === 'string' && severity.trim() ? `"${severity}"` : '(missing)'
  return { fix: false, reason: DEFER_REASONS.unknownSeverity(shown) }
}

function deferralOf(finding, reason) {
  return {
    title: typeof finding.title === 'string' ? finding.title : null,
    file: typeof finding.file === 'string' ? finding.file : null,
    severity: typeof finding.severity === 'string' ? finding.severity : null,
    dimension: typeof finding.dimension === 'string' ? finding.dimension : null,
    reason
  }
}

function validateRound(round, cap) {
  if (!Number.isInteger(round) || round < 1) {
    fail(`remediation round must be a positive integer (got ${JSON.stringify(round)})`)
  }
  if (round > cap + 1) {
    fail(
      `remediation round ${round} exceeds the cap: rounds 1-${cap} are fix passes ` +
        `and round ${cap + 1} is the verdict`
    )
  }
}

function roundCapOf(limits) {
  const cap = limits && limits.remediationRounds
  if (!Number.isInteger(cap) || cap < 1) {
    fail('limits.remediationRounds must be a positive integer')
  }
  return cap
}

/**
 * Decide what one remediation round does.
 *
 * `findings` accepts every shape `evaluateGate` accepts — a bare array of
 * findings, a single `{ dimension, findings }` object, or an array of those.
 * Flattening and dimension-stamping are borrowed from `applyToleranceBand`
 * rather than reimplemented, so the two modules cannot disagree about what a
 * finding is. Degenerate input yields an empty plan, not an error: a review
 * that found nothing is a normal outcome.
 *
 * Rounds `1 .. cap` are fix passes and never halt: surviving blockers at round
 * 1 of 2 are expected, and surviving blockers at round 2 of 2 have not yet been
 * given their fix pass. Round `cap + 1` is the verdict, made after the final
 * re-review; it plans no fixes and halts iff blockers remain.
 *
 * The verdict is a separate round rather than a flag on the last fix round for
 * two reasons. A halt raised alongside a fix plan makes that fix pass
 * decorative — the caller can read the verdict early and skip the work that
 * would have cleared it. And keeping them apart makes "the budget is spent" a
 * fact about the input (`round === cap + 1`) rather than a judgement the caller
 * makes about a plan it was handed.
 *
 * @param {*} findings review output in any accepted shape
 * @param {{round?: number, limits?: object, band?: object|null}} [opts]
 *   `round` is 1-based and runs to `limits.remediationRounds + 1`; the last
 *   value is the verdict round. `band` overrides the tolerance band the way
 *   `evaluateGate` does; `null` disables it.
 * @returns {{
 *   round: number, roundCap: number,
 *   isFinalFixRound: boolean, isFinalRound: boolean,
 *   fix: {byFile: Array<{file: string, findings: Array}>, unscoped: Array},
 *   deferred: Array<{title: string|null, file: string|null, severity: string|null,
 *                    dimension: string|null, reason: string}>,
 *   reReviewDimensions: string[],
 *   halt: boolean, haltReason: string|null,
 *   counts: {blockers: number, warnings: number, suggestions: number,
 *            fixing: number, deferring: number}
 * }}
 */
export function planRemediation(findings, opts = {}) {
  const limits = opts.limits === undefined ? LIMITS : opts.limits
  const roundCap = roundCapOf(limits)
  const round = opts.round === undefined ? 1 : opts.round
  validateRound(round, roundCap)

  // The verdict round reads the final re-review and reports; it never plans
  // work, because there is no round left to do it in.
  const isVerdictRound = round === roundCap + 1

  const band = opts.band === undefined ? TOLERANCE_BAND : opts.band
  const { reportable, dropped } = applyToleranceBand(findings, band)

  const deferred = []

  // Findings the band scored away are still findings someone raised, so they
  // are deferred with a reason rather than vanishing between the gate and here.
  const bandFloor = band ? band.minQualityToReport : null
  for (const f of dropped) deferred.push(deferralOf(f, DEFER_REASONS.quality(bandFloor)))

  // Copy before partitioning: the caller's finding objects must survive this
  // call untouched, and the plan is handed to fixer agents that may annotate it.
  const fixing = []
  const counts = { blockers: 0, warnings: 0, suggestions: 0, fixing: 0, deferring: 0 }
  for (const f of reportable) {
    if (f.severity === 'blocker') counts.blockers += 1
    else if (f.severity === 'warning') counts.warnings += 1
    else if (f.severity === 'suggestion') counts.suggestions += 1

    const verdict = route(f)
    // At the verdict round even a fixable finding goes unfixed — so it is
    // recorded with that as its reason rather than disappearing from the plan.
    if (verdict.fix && isVerdictRound) {
      deferred.push(deferralOf(f, DEFER_REASONS.budgetSpent(roundCap)))
    } else if (verdict.fix) {
      fixing.push({ ...f })
    } else {
      deferred.push(deferralOf(f, verdict.reason))
    }
  }
  counts.fixing = fixing.length
  counts.deferring = deferred.length

  const { byFile, unscoped } = groupByFile(fixing)

  // Only dimensions that raised something we are about to change are worth
  // re-running. Nothing to fix means nothing to re-review.
  const dimensions = new Set()
  for (const f of fixing) {
    if (typeof f.dimension === 'string' && f.dimension.trim()) dimensions.add(f.dimension)
  }
  const reReviewDimensions = [...dimensions].sort()

  const halt = isVerdictRound && counts.blockers > 0
  const haltReason = halt
    ? `${counts.blockers} unresolved blocker(s) after ${roundCap} remediation round(s)`
    : null

  return {
    round,
    roundCap,
    /** The last round that still fixes anything. */
    isFinalFixRound: round === roundCap,
    /** The verdict round — the last round of the loop, and the only one that halts. */
    isFinalRound: isVerdictRound,
    // byFile groups are disjoint, so every group may be fixed by its own agent
    // in parallel; unscoped has no owning file and is applied last, in sequence.
    fix: { byFile, unscoped },
    deferred,
    reReviewDimensions,
    halt,
    haltReason,
    counts
  }
}

/** Human-readable remediation plan, for the skill to echo before it fans out. */
export function formatRemediationPlan(plan) {
  const lines = []
  // The verdict round is a report, not a plan; rendering it as "0 to fix" would
  // read like a fix round that found nothing left to do.
  lines.push(
    plan.isFinalRound
      ? `REMEDIATION VERDICT after ${plan.roundCap} round(s) — ` +
        (plan.halt
          ? `${plan.counts.blockers} blocker(s) unresolved`
          : 'clean, no unresolved blockers')
      : `REMEDIATION round ${plan.round}/${plan.roundCap}` +
        (plan.isFinalFixRound ? ' (last fix pass)' : '') +
        ` — ${plan.counts.fixing} to fix, ${plan.counts.deferring} deferred`
  )
  lines.push(
    `  blocker=${plan.counts.blockers} warning=${plan.counts.warnings} ` +
      `suggestion=${plan.counts.suggestions}`
  )

  if (plan.fix.byFile.length) {
    lines.push(`  parallel — one fixer per file, ${plan.fix.byFile.length} group(s):`)
    for (const g of plan.fix.byFile) {
      lines.push(`    ${g.file} — ${g.findings.length} finding(s)`)
    }
  }
  if (plan.fix.unscoped.length) {
    lines.push(`  sequential — ${plan.fix.unscoped.length} unscoped finding(s), applied last`)
  }
  if (!plan.isFinalRound && !plan.fix.byFile.length && !plan.fix.unscoped.length) {
    lines.push('  nothing to fix')
  }

  if (plan.reReviewDimensions.length) {
    lines.push(`  re-review dimensions: ${plan.reReviewDimensions.join(', ')}`)
  } else if (plan.counts.fixing) {
    lines.push('  re-review dimensions: (unlabelled — re-run the review that raised these)')
  }

  if (plan.deferred.length) {
    lines.push(`  deferred (${plan.deferred.length}):`)
    for (const d of plan.deferred) {
      lines.push(`    [${d.severity || 'unknown'}] ${d.file || '(unscoped)'} — ${d.title || '(untitled)'}: ${d.reason}`)
    }
  }

  if (plan.halt) lines.push(`  HALT: ${plan.haltReason}`)
  return lines.join('\n') + '\n'
}
