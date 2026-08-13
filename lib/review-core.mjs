// Adversarial review: what survives two skeptics.
//
// Every finding a review dimension raises is independently verdicted by two
// skeptics whose job is to refute it. This module turns those verdicts into a
// survival decision — and, just as importantly, into *counts*. The README sells
// the dismissal count as the evidence a review is worth reading line by line;
// that claim is only true if the number is computed rather than narrated, so it
// is computed here.
//
// The quality band is **not** reimplemented here. `lib/findings.mjs` owns
// `TOLERANCE_BAND` / `applyToleranceBand` and the gate already applies it; this
// module calls the same function so a finding cannot be judged weak by one
// threshold in review and a different one at the gate.
//
// Pure: no fs, no agent, no spawning, no async. The dynamic-workflow runtime
// cannot `import()` and has no filesystem of its own, so it reaches this module
// by shelling out to a `interlock` subcommand — which means everything here must
// be a plain data-in / data-out decision.
//
// Feeding the gate: `applyToleranceBand` has already run by the time
// `resolveReview` returns, so pass `evaluateGate(result.surviving, { band: null,
// dismissed: [] })` — re-running the band would be harmless but re-counting
// `droppedByQuality` would double-report it.

import { SEVERITIES, TOLERANCE_BAND, applyToleranceBand } from './findings.mjs'

// Accept the same three input shapes `evaluateGate` accepts (bare array, one
// `{dimension, findings}` object, or an array of those). `applyToleranceBand`
// with a disabled band is exactly that flattener and nothing else, so reuse it
// rather than keeping a second copy of the shape-sniffing in this file.
function flatten(input) {
  return applyToleranceBand(input, null).reportable
}

// Most severe first: index 0 is the worst. Anything outside this list has no
// rank and is ignored when refinements are compared.
function severityRank(severity) {
  const i = SEVERITIES.indexOf(severity)
  return i === -1 ? Infinity : i
}

function titleOf(finding) {
  return finding && typeof finding.title === 'string' ? finding.title : null
}

// Verdicts are keyed to findings by title, narrowed by file when the skeptic
// supplied one. `VERDICT_SCHEMA.file` is optional because skeptics predate it,
// so the match degrades rather than fails: a verdict carrying a file only
// adjudicates the finding in that file, while a verdict without one still
// adjudicates every finding sharing the title. That asymmetry is deliberate —
// tightening the fileless case would silently orphan every existing verdict,
// and an orphaned verdict means an unadjudicated finding survives unreviewed.
const KEY_SEP = '\u0000'

function matchKeys(finding) {
  const title = titleOf(finding)
  if (title === null) return []
  const file = finding && typeof finding.file === 'string' ? finding.file.trim() : ''
  return file ? [title + KEY_SEP + file, title] : [title]
}

function verdictKey(verdict) {
  const title = verdict.findingTitle
  const file = typeof verdict.file === 'string' ? verdict.file.trim() : ''
  return file ? title + KEY_SEP + file : title
}

/**
 * A verdict is a vote that the finding is **not** real when the skeptic said so
 * outright, or when it refined the severity to `dismiss`.
 *
 * `dismiss` is treated as a not-real vote rather than as a severity: it is the
 * skeptic's way of saying "there is nothing here", and folding it into the
 * severity ladder would let a dismissed finding out-rank a real suggestion.
 */
function votedReal(verdict) {
  return verdict.isReal === true && verdict.refinedSeverity !== 'dismiss'
}

/**
 * Whether a not-real verdict is allowed to actually dismiss.
 *
 * A skeptic that cannot point at what it read has not refuted anything — it has
 * asserted. Refute-or-Promote (arXiv 2604.19049) documents where that ends: 80+
 * agents, adversarial reviewers among them, unanimously endorsing an OpenSSL
 * padding oracle that did not exist. Confident prose is exactly what an LLM
 * produces most reliably, so it is the one thing a dismissal must not rest on.
 *
 * So evidence gates the *dismissing* direction only. Voting a finding real
 * needs none: that direction already resolves toward a human reading it, which
 * is the cheap error. This is `agent_resolved` from shared/DECISION-LEDGER.md —
 * a claim is audited, and an unsubstantiated one is treated as unresolved.
 *
 * An uncited not-real verdict becomes a NON-VOTE, never a deleted verdict. That
 * distinction is load-bearing: dropping the verdict entirely would orphan it
 * (see the keying note above), and its `qualityScore` still deserves to reach
 * the tolerance band — a skeptic can be too lazy to cite and still be right
 * that the finding is badly written.
 */
function hasEvidence(verdict) {
  return typeof verdict.evidence === 'string' && verdict.evidence.trim().length > 0
}

function numericScore(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Resolve a review: which findings survived the skeptics, which the skeptics
 * dismissed, which the quality band dropped, and how many of each.
 *
 * ## Survival rules
 *
 * 1. **Majority survival.** A finding survives when at least as many skeptics
 *    voted it real as voted it not-real.
 * 2. **Tie rule — a tie KEEPS the finding.** With exactly two skeptics a 1–1
 *    split is the common case, so this is the rule that matters most. Keeping is
 *    the right resolution because the two errors are not symmetric: a surviving
 *    false positive costs a human ten seconds of reading, while a wrongly
 *    dismissed finding is *invisible* — it never reaches the report, so nobody
 *    can catch the mistake. Every ambiguous case therefore resolves toward
 *    reporting. (This is the same asymmetry `applyToleranceBand` uses when
 *    skeptics disagree by more than `drift`.)
 * 3. **No verdicts means survival.** A finding nobody adjudicated is not a
 *    finding that was refuted. Absence of adjudication is not dismissal, so it
 *    is kept — falling out of rule 1 as 0 >= 0, but stated because it is a
 *    decision, not an accident.
 * 4. **Severity refinement — the most severe refinement wins**, counting only
 *    skeptics who thought the finding real. A skeptic who says "not real" has
 *    not offered an opinion on how bad it would be if it were. Refinements
 *    outside `SEVERITIES` are ignored and the reviewer's original severity
 *    stands; when a refinement does apply, the original is preserved as
 *    `originalSeverity`.
 * 5. **The quality band runs after survival**, via `applyToleranceBand`, so a
 *    finding that survived but is too poorly-grounded to be worth a human's
 *    attention disappears before the gate counts blockers. Quality scores from
 *    every verdict (including not-real ones — a skeptic can judge a finding
 *    badly written and still believe it) are attached as `qualityScores` for the
 *    band to pool.
 *
 * Verdicts are matched to findings by `findingTitle` → `title`. Two findings
 * that share a title in different files share a verdict set; that is a known
 * coarseness of the skeptic contract, not something this module can fix, since
 * `VERDICT_SCHEMA` carries no file.
 *
 * @param {*} findings findings in any shape `evaluateGate` accepts
 * @param {Array<object>} verdicts flat array of `VERDICT_SCHEMA` objects
 * @param {{band?: object|null}} [opts] `band` overrides the tolerance band
 *   (`null` disables it — the default is `TOLERANCE_BAND`)
 * @returns {{
 *   surviving: Array, dismissed: Array, droppedByQuality: Array,
 *   counts: {raised: number, dismissed: number, droppedByQuality: number, surviving: number},
 *   dimensionStats: Object<string, {raised: number, surviving: number}>,
 *   anomalies: {orphanVerdicts: Array, malformedVerdicts: Array}
 * }}
 */
export function resolveReview(findings, verdicts, opts = {}) {
  const all = flatten(findings)
  const list = Array.isArray(verdicts) ? verdicts : verdicts ? [verdicts] : []

  // Index verdicts by what they claim to adjudicate: title, plus file when the
  // skeptic named one.
  const byKey = new Map()
  const malformedVerdicts = []
  for (const v of list) {
    if (!v || typeof v !== 'object' || typeof v.findingTitle !== 'string') {
      malformedVerdicts.push(v)
      continue
    }
    const key = verdictKey(v)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(v)
  }

  // A verdict for a finding nobody raised is an anomaly, not a crash: the
  // skeptic hallucinated a title, or the reviewer's output was truncated
  // between the two steps. Either way it is reported and the run continues.
  const raisedKeys = new Set(all.flatMap(matchKeys))
  const orphanVerdicts = []
  for (const [key, vs] of byKey) {
    if (!raisedKeys.has(key)) orphanVerdicts.push(...vs)
  }

  const survived = []
  const dismissed = []
  // Reported, never silent: a dismissal quietly downgraded to a non-vote looks
  // identical to a skeptic that simply agreed, and the whole point of the rule
  // is that the reader can see it fired.
  let dismissalsRejected = 0

  for (const finding of all) {
    // Prefer the file-qualified verdict set; fall back to the title-only one so
    // a skeptic that did not report a file still adjudicates.
    const vs = matchKeys(finding).map(k => byKey.get(k)).find(Boolean) || []

    let real = 0
    let notReal = 0
    let uncited = 0
    const scores = []
    for (const v of vs) {
      if (votedReal(v)) real += 1
      else if (hasEvidence(v)) notReal += 1
      // An uncited refutation counts as neither: it does not dismiss, and it is
      // not a vote to keep either. It falls through to rule 3.
      else uncited += 1
      if (numericScore(v.qualityScore)) scores.push(v.qualityScore)
    }
    dismissalsRejected += uncited

    const votes = { real, notReal, uncited, total: vs.length }

    // Rule 1 + rule 2 + rule 3: majority, ties keep, no verdicts keeps.
    if (real < notReal) {
      dismissed.push({ ...finding, votes })
      continue
    }

    // Rule 4: most severe refinement among skeptics who thought it real.
    let refined = null
    for (const v of vs) {
      if (!votedReal(v)) continue
      const rank = severityRank(v.refinedSeverity)
      if (rank !== Infinity && (refined === null || rank < severityRank(refined))) {
        refined = v.refinedSeverity
      }
    }

    // Rule 5: hand the band every score the skeptics produced, alongside any
    // the finding already carried.
    const existing = Array.isArray(finding.qualityScores) ? finding.qualityScores : []
    const pooled = [...existing, ...scores]

    const out = { ...finding, votes }
    if (pooled.length) out.qualityScores = pooled
    if (refined !== null && refined !== finding.severity) {
      out.originalSeverity = finding.severity
      out.severity = refined
    }
    survived.push(out)
  }

  const band = opts.band === undefined ? TOLERANCE_BAND : opts.band
  const { reportable: surviving, dropped: droppedByQuality } = applyToleranceBand(survived, band)

  // Every raised finding lands in exactly one bucket, so the four counts always
  // sum back to `raised`. That is what makes them safe to emit as metrics.
  const counts = {
    raised: all.length,
    dismissed: dismissed.length,
    droppedByQuality: droppedByQuality.length,
    surviving: surviving.length,
    // Not part of the four-way partition above — it counts verdicts, not
    // findings, so it does not sum with them. Reported because a refutation
    // that was refused for lack of evidence is exactly what a reader needs to
    // know when a finding they expected to be dismissed is still on the list.
    dismissalsRejected
  }

  const dimensionStats = {}
  const bump = (finding, key) => {
    const d = finding.dimension || 'unknown'
    if (!dimensionStats[d]) dimensionStats[d] = { raised: 0, surviving: 0 }
    dimensionStats[d][key] += 1
  }
  for (const f of all) bump(f, 'raised')
  for (const f of surviving) bump(f, 'surviving')

  return {
    surviving,
    dismissed,
    droppedByQuality,
    counts,
    dimensionStats,
    anomalies: { orphanVerdicts, malformedVerdicts }
  }
}

/** Human-readable review summary. */
export function formatReview(result) {
  const { raised, dismissed, droppedByQuality, surviving, dismissalsRejected } = result.counts
  const lines = []
  lines.push(`REVIEW — ${surviving} of ${raised} finding(s) survived`)
  lines.push(
    `  raised=${raised} dismissed=${dismissed} droppedByQuality=${droppedByQuality} ` +
      `surviving=${surviving}`
  )
  if (dismissalsRejected) {
    lines.push(
      `  ${dismissalsRejected} refutation(s) cited no evidence and did not dismiss anything`
    )
  }

  const dims = Object.keys(result.dimensionStats).sort()
  for (const d of dims) {
    const { raised: r, surviving: s } = result.dimensionStats[d]
    lines.push(`  ${d}: ${s}/${r} surviving`)
  }

  for (const f of result.surviving) {
    if (f.originalSeverity) {
      lines.push(`  refined ${f.originalSeverity} → ${f.severity}: ${f.title}`)
    }
  }

  const { orphanVerdicts, malformedVerdicts } = result.anomalies
  if (orphanVerdicts.length) {
    const titles = [...new Set(orphanVerdicts.map(v => v.findingTitle))]
    lines.push(`  ANOMALY: ${orphanVerdicts.length} verdict(s) matched no finding: ${titles.join(', ')}`)
  }
  if (malformedVerdicts.length) {
    lines.push(`  ANOMALY: ${malformedVerdicts.length} verdict(s) had no usable findingTitle`)
  }

  return lines.join('\n') + '\n'
}
