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
// The survival decision is pure: no fs, no agent, no spawning, no async. The
// dynamic-workflow runtime cannot `import()` and has no filesystem of its own,
// so it reaches this module by shelling out to a `interlock` subcommand — which
// means the survival path must be a plain data-in / data-out decision.
//
// The one exception is `readReviewPolicy(repoRoot)` — it reads the repo-root
// `REVIEW.md` from disk. It is never called by the workflow (which shells out);
// only the node CLI (`interlock review` / `interlock review-policy`) invokes it,
// and there fs is available. Parsing stays pure in `parseReviewPolicy(text)`, so
// the survival arithmetic below never depends on the filesystem.
//
// Feeding the gate: `applyToleranceBand` has already run by the time
// `resolveReview` returns, so pass `evaluateGate(result.surviving, { band: null,
// dismissed: [] })` — re-running the band would be harmless but re-counting
// `droppedByQuality` would double-report it.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { LIMITS } from './limits.mjs'
import { REVIEW_DEPTHS } from './routing.mjs'
import { SEVERITIES, TOLERANCE_BAND, applyToleranceBand, normalizeSeverity } from './findings.mjs'
// The locator vocabulary lives in one module because a second surface now
// audits citations the same way (`auditHandoffEvidence` in lib/waves.mjs). Two
// definitions of "what a locator looks like" drift silently, each still passing
// its own tests. See lib/locators.mjs for what is shared and what is not.
import { CITATION_TOKEN, canonicalizePath, citesLineIn, diffIndex } from './locators.mjs'
// The one canonical requirement-heading form (design D1): a citation and the
// spec text it names are compared on `requirementKey`, never on raw spelling.
import { requirementKey } from './spec-text.mjs'

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
// Verdict matching stays on exact titles on purpose; lib/findings.mjs findingKey is the normalised identity (design D4, ledger D5).

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
 *
 * The predicate is a SHAPE check plus diff membership, and deliberately not a
 * semantic one. Judging whether a cited span actually *supports* the claim
 * needs a model, and putting one there recreates this problem one layer down.
 * Shape plus membership is the ceiling: both are deterministic and testable.
 *
 * Two conditions, because either alone is defeated:
 *
 *   1. `path:line` or `path:start-end`. Non-emptiness alone was satisfied by
 *      the string "👍".
 *   2. The path canonicalizes to one present in the reviewed diff. Shape alone
 *      is satisfied by inventing `lib/nowhere.ts:1`.
 *
 * The line is NOT required to exist in the file. A review runs against a diff,
 * the file on disk may have moved on, and a valid citation to a deleted line
 * would be rejected — path membership is the strongest condition that cannot
 * produce a false rejection.
 *
 * When no diff is supplied the shape half still applies on its own. A caller
 * that cannot name the changed files must not thereby reopen the emoji hole.
 *
 * Two dimensions widen the path set, by one path. A `blast-radius` finding's
 * `file` is the observing caller OUTSIDE the diff, and a `regression` finding's
 * may be an unchanged reader or end path, so a refutation has to cite that
 * file, and against the diff alone it could never dismiss. For those two
 * dimensions only, the allowed paths are the diff plus the finding's own
 * (canonicalised) file — see `evidencePathsFor`. Every other dimension cites
 * the diff, and an outside path still refuses.
 */
function hasEvidence(verdict, diff) {
  const text = typeof verdict.evidence === 'string' ? verdict.evidence : ''
  if (!text.trim()) return false

  // A path in the diff, cited with a line. Checked first and by literal match
  // because it is the only form that tolerates a path containing spaces —
  // token-splitting on whitespace cannot recover "src/my file.ts:12".
  if (diff && diff.size) {
    for (const spelling of diff) {
      if (citesLineIn(text, spelling)) return true
    }
  }

  const cited = [...text.matchAll(CITATION_TOKEN)]
    .map(m => canonicalizePath(m[1]))
    .filter(Boolean)
  if (!cited.length) return false
  if (!diff || !diff.size) return true
  return cited.some(p => diff.has(p))
}

/**
 * The dimensions whose finding names a file outside the diff: a blast-radius
 * finding's observing caller, and a regression finding's unchanged reader or
 * end path. A refutation of either may cite the finding's own file.
 */
const OUTSIDE_DIFF_DIMENSIONS = new Set(['blast-radius', 'regression'])

/** The paths a dismissing verdict on `finding` may cite: the diff, plus a blast-radius or regression finding's own file. */
function evidencePathsFor(finding, diff) {
  if (!diff || !OUTSIDE_DIFF_DIMENSIONS.has(finding.dimension) || typeof finding.file !== 'string') return diff
  return diffIndex([...diff, finding.file])
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
 * Verdicts are matched to findings by `findingTitle` → `title`, narrowed by
 * `file` when the verdict carries one. A verdict without a
 * file still adjudicates every finding that shares its title, in any file; that
 * is the deliberate fallback for skeptics that predate `VERDICT_SCHEMA.file`.
 *
 * @param {*} findings findings in any shape `evaluateGate` accepts
 * @param {Array<object>} verdicts flat array of `VERDICT_SCHEMA` objects
 * @param {{band?: object|null, changedPaths?: string[], excludePaths?: string[]}} [opts]
 *   `band` overrides the tolerance band (`null` disables it — the default is
 *   `TOLERANCE_BAND`). `changedPaths` is the reviewed diff; when supplied, a
 *   dismissing verdict's citation must name a path in it (see `hasEvidence`).
 *   `excludePaths` is a list of canonical do-not-report prefixes (from a repo's
 *   `REVIEW.md`); a finding whose canonical file lies at or under one is dropped
 *   BEFORE the band is applied, so exclusions shrink the input but never alter
 *   the arithmetic on what remains (add-interlock-review-policy spec §5).
 *   `requirementHeadings` maps each cited spec path (canonical) to that file's
 *   requirement keys, or to `{ unreadable: reason }`; with it, a finding's
 *   `requirement` citation is shape-checked (see `checkRequirementCitation`).
 *   A failed check is reported under `anomalies.requirementCitations` and
 *   changes nothing about how the finding is adjudicated.
 * @returns {{
 *   surviving: Array, dismissed: Array, droppedByQuality: Array, droppedByPolicy: Array,
 *   counts: {raised: number, dismissed: number, droppedByQuality: number, droppedByPolicy: number, surviving: number},
 *   dimensionStats: Object<string, {raised: number, surviving: number, carried?: number}>,
 *   anomalies: {orphanVerdicts: Array, malformedVerdicts: Array, requirementCitations: Array, specGapShape: Array}
 * }}
 */
export function resolveReview(findings, verdicts, opts = {}) {
  const raisedFindings = flatten(findings)
  const list = Array.isArray(verdicts) ? verdicts : verdicts ? [verdicts] : []
  const diff = diffIndex(opts.changedPaths)

  // Exclusions run FIRST, before any survival decision or the band. A finding
  // on an excluded path never reaches the skeptics' arithmetic — it is data the
  // CLI drops, not a request a reviewer could vote past (spec §3). Matching is
  // path-only and case-sensitive on the canonical form (see `pathExcludedBy`),
  // so a reviewer voting an excluded finding real cannot re-include it.
  const excludePrefixes = Array.isArray(opts.excludePaths)
    ? opts.excludePaths.filter(p => typeof p === 'string' && p)
    : []
  const droppedByPolicy = []
  const all = []
  for (const finding of raisedFindings) {
    const excludingPath = excludePrefixes.find(prefix => pathExcludedBy(finding.file, prefix))
    if (excludingPath) droppedByPolicy.push({ ...finding, excludedBy: excludingPath })
    else all.push(finding)
  }

  // Requirement citations are checked on every finding that reaches
  // adjudication, before survival is decided and without feeding into it: the
  // check is a SHAPE check, a broken citation must never delete a real defect,
  // and whether the cited requirement forbids the diff is the skeptics' question.
  const requirementCitations = []
  for (const finding of all) {
    const problem = checkRequirementCitation(finding, opts.requirementHeadings)
    if (problem) {
      requirementCitations.push({
        dimension: finding.dimension || 'unknown',
        file: typeof finding.file === 'string' ? finding.file : null,
        title: titleOf(finding),
        requirement: typeof finding.requirement === 'string' ? finding.requirement : null,
        problem
      })
    }
  }

  // `specGap` is advisory: a non-boolean is listed and read as absent, never
  // routed to the malformed path `evaluateGate` fails on.
  const specGapShape = []
  for (let i = 0; i < all.length; i++) {
    const finding = all[i]
    if (finding.specGap !== undefined && typeof finding.specGap !== 'boolean') {
      const { specGap: _dropped, ...rest } = finding
      all[i] = rest
      specGapShape.push({
        dimension: finding.dimension || 'unknown',
        file: typeof finding.file === 'string' ? finding.file : null,
        title: titleOf(finding),
        problem: `specGap is not a boolean (${finding.specGap === null ? 'null' : typeof finding.specGap})`
      })
    }
  }

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
  // Built from every raised finding, including policy-excluded ones: a verdict
  // that adjudicates a finding we dropped for policy is not an orphan (the
  // finding was real, just out of scope), so it must not be reported as one.
  const raisedKeys = new Set(raisedFindings.flatMap(matchKeys))
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
    const allowed = evidencePathsFor(finding, diff)

    let real = 0
    let notReal = 0
    let uncited = 0
    const scores = []
    for (const v of vs) {
      if (votedReal(v)) real += 1
      else if (hasEvidence(v, allowed)) notReal += 1
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

  // Every raised finding lands in exactly one bucket, so the counts always sum
  // back to `raised` (droppedByPolicy + dismissed + droppedByQuality +
  // surviving). That is what makes them safe to emit as metrics. `raised` is
  // the full set the dimensions produced, including the policy-excluded ones —
  // an honest denominator that does not shrink just because a path is exempt.
  // After `carryForward` appends findings this review did not raise, the
  // partition reads `raised = droppedByPolicy + dismissed + droppedByQuality +
  // surviving − carried`; `counts.carried` is absent until a carry happens.
  const counts = {
    raised: raisedFindings.length,
    droppedByPolicy: droppedByPolicy.length,
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
    droppedByPolicy,
    counts,
    dimensionStats,
    anomalies: { orphanVerdicts, malformedVerdicts, requirementCitations, specGapShape }
  }
}

/**
 * Keep a scoped re-review's record whole (design D18): append to `result.surviving`
 * every finding of `previous.surviving` whose `dimension` is not in `ran`, each a
 * copy marked `carried: true` with `carriedFrom` the earlier record's `head` (or
 * `null`). `counts.carried` is their number, `counts.surviving` counts the list
 * as emitted, and `dimensionStats[<dimension>].carried` counts them per dimension.
 * The partition is then `raised = droppedByPolicy + dismissed + droppedByQuality +
 * surviving − carried`: a carried finding was counted by the review that raised it.
 * Each carried dimension's ledger in `previous.coverage` lands on
 * `result.carriedCoverage[<dimension>]` with `carriedFrom`, for the proof; the
 * key is absent when nothing carried one.
 *
 * Mutates `result` and returns it. A `previous` with no `surviving` list throws,
 * as every reader of a review record refuses one; the command names the file.
 *
 * @param {{ surviving: Array, counts: object, dimensionStats: object }} result
 * @param {{ surviving?: Array, head?: string|null }} previous
 * @param {string[]} ran the dimensions this review ran
 * @returns {typeof result}
 */
export function carryForward(result, previous, ran) {
  if (!previous || typeof previous !== 'object' || !Array.isArray(previous.surviving)) {
    throw new Error('the carry record has no surviving list')
  }
  const ranSet = new Set(Array.isArray(ran) ? ran : [])
  const head = typeof previous.head === 'string' && previous.head ? previous.head : null
  const carried = previous.surviving
    .filter(f => f && typeof f === 'object' && !ranSet.has(f.dimension))
    .map(f => ({ ...f, carried: true, carriedFrom: head }))
  result.surviving.push(...carried)
  // A carried dimension's ledger travels with its findings (prove-the-review-
  // covered-the-diff design §3), with the earlier record's head, so the proof
  // can drop its entries on files changed since then.
  const ledgers = previous.coverage && typeof previous.coverage === 'object' ? previous.coverage : {}
  for (const [d, ledger] of Object.entries(ledgers)) {
    if (ranSet.has(d) || !ledger || typeof ledger !== 'object' || !Array.isArray(ledger.checked)) continue
    if (!result.carriedCoverage) result.carriedCoverage = {}
    result.carriedCoverage[d] = { checked: ledger.checked, unread: Array.isArray(ledger.unread) ? ledger.unread : [], carriedFrom: head }
  }
  result.counts.carried = carried.length
  result.counts.surviving = result.surviving.length
  for (const f of carried) {
    const d = f.dimension || 'unknown'
    if (!result.dimensionStats[d]) result.dimensionStats[d] = { raised: 0, surviving: 0 }
    result.dimensionStats[d].carried = (result.dimensionStats[d].carried || 0) + 1
  }
  return result
}

/**
 * Read the earlier review record at `file` for `--carry`. A file that cannot be
 * read, parsed, or that holds no `surviving` list is handed to `fail` as a
 * message naming the file; the command's `die` exits 1 there, before anything
 * is printed or written.
 *
 * @param {string} file
 * @param {(message: string) => never} fail
 * @returns {{ surviving: Array, head?: string|null }}
 */
export function readCarryFile(file, fail) {
  let record
  try {
    record = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return fail(`--carry ${file} could not be read as a review record: ${err.message}`)
  }
  if (!record || typeof record !== 'object' || !Array.isArray(record.surviving)) {
    return fail(`--carry ${file} holds no surviving list, so it is not a review record`)
  }
  return record
}

/**
 * Whether a finding's file lies at or under a canonical excluded prefix.
 *
 * The finding's file is canonicalized with the SAME `canonicalizePath` the
 * prefix went through (in `parseReviewPolicy`), so `dist/a.js`, `./dist/a.js`
 * and `dist/a.js` are one identity — a finding cannot slip past an exclusion on
 * an alternate spelling (spec §3 edge). The match is a path-boundary check, not
 * a raw `startsWith`: `dist` excludes `dist/a.js` and `dist` itself, but not a
 * sibling `distant/a.js`. It is case-sensitive by construction — the canonical
 * form preserves case — mirroring how the default filesystem resolves paths, so
 * `DIST/a.js` is NOT excluded by a `dist` rule (design.md D2: a visible
 * under-exclusion beats a silent over-exclusion).
 *
 * A finding whose file cannot be canonicalized (missing, absolute, escaping the
 * root) is not excluded: an exclusion is an affirmative scope decision, and a
 * path we cannot place cannot be affirmatively matched.
 */
export function pathExcludedBy(file, canonicalPrefix) {
  const canonicalFile = canonicalizePath(file)
  if (!canonicalFile) return false
  return canonicalFile === canonicalPrefix || canonicalFile.startsWith(canonicalPrefix + '/')
}

const SPEC_CITATION_PATH = /^openspec\/specs\/.+\/spec\.md$/

// A cited file's entry in `requirementHeadings`: a Map or a plain object.
function headingsEntry(headings, path) {
  if (headings instanceof Map) return headings.get(path)
  if (headings && typeof headings === 'object') {
    return Object.prototype.hasOwnProperty.call(headings, path) ? headings[path] : undefined
  }
  return undefined
}

/**
 * The shape check on one finding's requirement citation, or null when it passes
 * (or there is nothing to check).
 *
 * A citation is `openspec/specs/<capability>/spec.md#<heading>`. Three checks,
 * in order: the path is canonical, under `openspec/specs/` and names a
 * `spec.md`; the file was read at the base (`requirementHeadings` has it, and it
 * is not `{ unreadable }`); the heading, on `requirementKey`, names a
 * requirement in it. Case is part of the heading: a different case is a
 * different requirement, as OpenSpec itself reads it.
 *
 * A `domain` blocker with no citation is also a problem, because contradicting a
 * requirement in force is the only blocker that dimension raises. A `domain`
 * warning without one is not: behaviour no requirement describes has nothing to
 * cite.
 */
function checkRequirementCitation(finding, headings) {
  const cited = finding.requirement
  const present = typeof cited === 'string' ? cited.trim() !== '' : cited !== undefined && cited !== null
  if (!present) {
    // On the canonical severity, as the gate and the merge verdict read it:
    // "BLOCKER" blocks there, so it is a blocker here.
    return finding.dimension === 'domain' && normalizeSeverity(finding.severity) === 'blocker'
      ? 'domain blocker cites no requirement'
      : null
  }
  if (typeof cited !== 'string') return 'requirement citation is not a string'

  const hash = cited.indexOf('#')
  if (hash === -1) {
    return `requirement citation "${cited}" has no #heading naming a requirement`
  }
  const path = canonicalizePath(cited.slice(0, hash).trim())
  if (!path || !SPEC_CITATION_PATH.test(path)) {
    return (
      `requirement citation "${cited.slice(0, hash).trim()}" is not a canonical ` +
      `openspec/specs/<capability>/spec.md path`
    )
  }

  const entry = headingsEntry(headings, path)
  if (headings === undefined || headings === null) {
    return `unchecked: ${path} was not read, so the cited requirement could not be checked`
  }
  if (entry === undefined || entry === null) {
    return `unchecked: ${path} was not among the spec files read at the base`
  }
  if (!Array.isArray(entry) && !(entry instanceof Set)) {
    const reason = typeof entry.unreadable === 'string' && entry.unreadable ? entry.unreadable : 'unreadable'
    return `unchecked: ${path} could not be read at the base: ${reason}`
  }
  const wanted = requirementKey(cited.slice(hash + 1))
  const keys = [...entry].map(requirementKey)
  if (!wanted || !keys.includes(wanted)) {
    return `names no requirement in ${path}: "${cited.slice(hash + 1).trim()}"`
  }
  return null
}

/**
 * Read and validate a dimension record (design D3 of close-the-merge-request-loop):
 * the `{ selected, ran, unavailable, skipped }` the `review-code` skill writes
 * beside its findings. The first three are arrays of strings; `skipped` is an
 * array of `{ name, reason }` with both strings. An optional `depth` (design D20
 * of route-prose-spawns-by-role) must be one of `REVIEW_DEPTHS`. An optional
 * `degraded` is an array of `{ name, reason }` naming `domain` or `blast-radius`
 * only (prove-the-review-covered-the-diff design §2). Anything else is a fault
 * that names the file and the key, never a repaired record. Returns the four
 * keys, plus `degraded` and `depth` when the record carries them, and nothing
 * else; the caller marks the record complete.
 *
 * @param {string} text  the file's contents
 * @param {string} file  the path, for the fault
 * @returns {{ ok: true, record: { selected: string[], ran: string[], unavailable: string[],
 *   skipped: Array<{ name: string, reason: string }>, depth?: string } } | { ok: false, problem: string }}
 */
/**
 * The dimensions a record may name under `degraded`: each runs on an input the
 * CLI itself can cut (the domain text) or leave stale (the graph), so a
 * degraded run is a flag on the verdict, not a reviewer's failure.
 */
export const DEGRADABLE_DIMENSIONS = Object.freeze(['domain', 'blast-radius'])

export function readDimensionRecord(text, file) {
  const fault = detail => ({ ok: false, problem: `--dimensions ${file}: ${detail}` })
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return fault(`is not valid JSON: ${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fault('does not hold a JSON object')
  const isText = v => typeof v === 'string'
  for (const key of ['selected', 'ran', 'unavailable']) {
    if (!Array.isArray(parsed[key]) || !parsed[key].every(isText)) return fault(`"${key}" must be an array of strings`)
  }
  if (!Array.isArray(parsed.skipped)) return fault('"skipped" must be an array of { name, reason }')
  for (const [i, entry] of parsed.skipped.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fault(`"skipped"[${i}] must be an object with "name" and "reason"`)
    for (const key of ['name', 'reason']) {
      if (!isText(entry[key])) return fault(`"skipped"[${i}] needs a string "${key}"`)
    }
  }
  const hasDegraded = Object.hasOwn(parsed, 'degraded') && parsed.degraded !== undefined
  if (hasDegraded) {
    if (!Array.isArray(parsed.degraded)) return fault('"degraded" must be an array of { name, reason }')
    for (const [i, entry] of parsed.degraded.entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fault(`"degraded"[${i}] must be an object with "name" and "reason"`)
      for (const key of ['name', 'reason']) {
        if (!isText(entry[key])) return fault(`"degraded"[${i}] needs a string "${key}"`)
      }
      if (!DEGRADABLE_DIMENSIONS.includes(entry.name)) {
        return fault(`"degraded"[${i}] names ${JSON.stringify(entry.name)}; only ${DEGRADABLE_DIMENSIONS.join(' and ')} run on an input the CLI can cut or leave stale`)
      }
    }
  }
  const hasDepth = Object.hasOwn(parsed, 'depth') && parsed.depth !== undefined
  if (hasDepth && !(isText(parsed.depth) && REVIEW_DEPTHS.includes(parsed.depth))) {
    return fault(`"depth" must be one of ${REVIEW_DEPTHS.join(', ')}, got ${JSON.stringify(parsed.depth)}`)
  }
  return {
    ok: true,
    record: {
      selected: parsed.selected,
      ran: parsed.ran,
      unavailable: parsed.unavailable,
      skipped: parsed.skipped.map(({ name, reason }) => ({ name, reason })),
      ...(hasDegraded ? { degraded: parsed.degraded.map(({ name, reason }) => ({ name, reason })) } : {}),
      ...(hasDepth ? { depth: parsed.depth } : {})
    }
  }
}

/**
 * `interlock review`'s record flags, checked before anything is written or
 * printed: `--out` and `--dimensions` need a file, `--head` a commit. `head` is
 * the commit the review describes, when the caller names it: a record that names
 * its commit is how `merge-confidence` tells this head's review from an older
 * one's (design D3 of close-the-merge-request-loop).
 *
 * @param {Record<string, unknown>} flags
 * @param {(message: string) => never} fail
 * @returns {{ dimensions: object|null, head: string|null }}
 */
export function reviewRecordFlags(flags, fail) {
  if (flags.out === true) fail('--out needs a file')
  if (flags.head === true) fail('--head needs a commit sha')
  if (flags.dimensions === true) fail('--dimensions needs a file')
  return {
    dimensions: typeof flags.dimensions === 'string' ? readDimensionFile(flags.dimensions, fail) : null,
    head: typeof flags.head === 'string' && flags.head ? flags.head : null
  }
}

/**
 * Read the dimension record at `file` and return it marked `completed: true`, as
 * `interlock review --dimensions` records it. A file that cannot be read or does
 * not validate is handed to `fail` as a message naming the file and the fault;
 * the command's `die` exits 1 there, before anything is written.
 *
 * @param {string} file
 * @param {(message: string) => never} fail
 * @returns {{ selected: string[], ran: string[], unavailable: string[],
 *   skipped: Array<{ name: string, reason: string }>, depth?: string, completed: true }}
 */
export function readDimensionFile(file, fail) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return fail(`--dimensions ${file} could not be read: ${err.message}`)
  }
  const read = readDimensionRecord(text, file)
  if (!read.ok) return fail(read.problem)
  return { ...read.record, completed: true }
}

/**
 * Write `interlock review --out <file>`: any earlier file at the path is removed
 * first, so a stale record can never stand in for this review, its directories
 * are created, and a write that fails removes what it left and is handed to
 * `fail` naming the file. The command calls this before printing anything, so a
 * failed write leaves standard output empty.
 *
 * @param {string} file
 * @param {object} payload
 * @param {(message: string) => never} fail
 */
export function writeReviewOut(file, payload, fail) {
  try {
    rmSync(file, { force: true })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  } catch (err) {
    // A partial file left behind would read as a truncated record later, so a
    // cleanup that also fails is said, not swallowed.
    let left = ''
    try {
      rmSync(file, { force: true })
    } catch (cleanup) {
      left = `, and could not be removed: ${cleanup.message}`
    }
    fail(`--out ${file} could not be written: ${err.message}${left}`)
  }
}

/** Human-readable review summary. */
export function formatReview(result) {
  const { raised, dismissed, droppedByQuality, droppedByPolicy, surviving, dismissalsRejected } =
    result.counts
  const lines = []
  lines.push(`REVIEW — ${surviving} of ${raised} finding(s) survived`)
  const carriedCount = result.counts.carried
  lines.push(
    `  raised=${raised} droppedByPolicy=${droppedByPolicy || 0} dismissed=${dismissed} ` +
      `droppedByQuality=${droppedByQuality} surviving=${surviving}` +
      (carriedCount === undefined ? '' : ` carried=${carriedCount}`)
  )
  // Each policy drop names the path that excluded it: a drop reported without
  // its excluding path is indistinguishable from a finding that was never
  // raised, and "why isn't my exclusion working" must stay diagnosable.
  for (const f of result.droppedByPolicy || []) {
    lines.push(`  excluded by ${f.excludedBy}: ${f.file || '(no file)'} — ${f.title || '(untitled)'}`)
  }
  if (dismissalsRejected) {
    lines.push(
      `  ${dismissalsRejected} refutation(s) cited no evidence and did not dismiss anything`
    )
  }

  const dims = Object.keys(result.dimensionStats).sort()
  for (const d of dims) {
    const { raised: r, surviving: s, carried: c } = result.dimensionStats[d]
    lines.push(`  ${d}: ${s}/${r} surviving${c ? `, ${c} carried` : ''}`)
  }

  for (const f of result.surviving) {
    if (f.originalSeverity) {
      lines.push(`  refined ${f.originalSeverity} → ${f.severity}: ${f.title}`)
    }
  }
  for (const f of result.surviving) {
    if (f.carried) {
      lines.push(
        `  carried from ${f.carriedFrom || '(no head)'}: ${f.file || '(no file)'} — ${f.title || '(untitled)'}`
      )
    }
  }

  const { orphanVerdicts, malformedVerdicts } = result.anomalies
  for (const c of result.anomalies.requirementCitations || []) {
    const where = c.file ? `${c.file} — ` : ''
    const cite = c.requirement ? ` [${c.requirement}]` : ''
    lines.push(`  ANOMALY: requirement citation on ${where}${c.title || '(untitled)'}: ${c.problem}${cite}`)
  }
  for (const c of result.anomalies.specGapShape || []) {
    const where = c.file ? `${c.file} — ` : ''
    lines.push(`  ANOMALY: ${where}${c.title || '(untitled)'}: ${c.problem}`)
  }
  if (orphanVerdicts.length) {
    const titles = [...new Set(orphanVerdicts.map(v => v.findingTitle))]
    lines.push(`  ANOMALY: ${orphanVerdicts.length} verdict(s) matched no finding: ${titles.join(', ')}`)
  }
  if (malformedVerdicts.length) {
    lines.push(`  ANOMALY: ${malformedVerdicts.length} verdict(s) had no usable findingTitle`)
  }

  return lines.join('\n') + '\n'
}

// --- repo-root REVIEW.md policy -------------------------------------------
//
// A repo owns its review policy in one optional, versioned file. The file is
// split by trust boundary (design.md D1): its prose is advice handed to a
// reviewer, and its do-not-report paths are enforced here in the CLI as the
// exclusion filter above — never a request a model could vote past. Everything
// below is the reader/parser for that file. Parsing is pure; only
// `readReviewPolicy` touches the filesystem.

/** The one location that is read as policy: the repository root. */
export const REVIEW_POLICY_FILE = 'REVIEW.md'

const EMPTY_POLICY = () => ({ prose: '', excludePaths: [], humanPaths: [], owner: null, problems: [] })

// The only recognized front-matter key. The band and nit cap deliberately are
// NOT here — they live in the CLI so they are not re-argued (spec §5). Any other
// key (a `nitCap:`, a stray typo) is reported as not-an-accepted-field rather
// than silently adopted, which is the whole reason the file cannot relocate the
// gate into markdown.
const ACCEPTED_FRONT_MATTER_KEYS = new Set(['owner'])

// A line that looks like it is trying to set a survival threshold. Matched only
// at line start as `key:`/`key=` so a prose sentence mentioning "the band" does
// not trip it — only an actual assignment does.
const BAND_KEY_LINE = /^\s*(nit ?cap|min ?quality|quality ?band|severity ?band|tolerance|band)\s*[:=]/i

// Headings are matched by normalized text so `## What "Important" Means` and
// `## what important means` are one heading: lowercased, punctuation and quotes
// flattened to single spaces, trimmed.
function normalizeHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const PROSE_HEADINGS = new Set(['owner', 'what important means', 'exclusions rationale'])
const EXCLUSIONS_HEADING = 'do not report'
const HUMAN_REVIEW_HEADING = 'always human review'

// The two path-list sections share one grammar, one canonical form and one set
// of problem wordings; only the nouns differ. `humanPaths` is scope, read by the
// merge verdict alone — it never reaches `resolveReview` (design D3).
const EXCLUSIONS_SECTION = {
  label: 'Do Not Report',
  noPaths: 'no exclusions applied',
  entry: 'exclusion',
  nothing: 'excludes nothing'
}
const HUMAN_REVIEW_SECTION = {
  label: 'Always Human Review',
  noPaths: 'no paths declared',
  entry: 'entry',
  nothing: 'declares nothing'
}

// What marks a list item as a pattern rather than a path (design D11 of
// label-and-harden-the-merge-verdict). Only these two: brackets and braces
// occur in real paths, such as a route directory.
const PATTERN_ITEM = /[*?]/

/**
 * Read the repo-root `REVIEW.md` and parse it into a policy object.
 *
 * Fail-open (design.md D3): an absent file is the empty policy with no problems
 * — absence *is* the off switch, not an error. A file over the scan cap
 * (`LIMITS.maxReviewPolicyBytes`) or unreadable is reported as a problem and the
 * run proceeds under default policy rather than parsing unbounded input.
 *
 * @param {string} repoRoot repository root to look under (defaults to cwd)
 * @returns {{prose: string, excludePaths: string[], humanPaths: string[], owner: string|null, problems: string[]}}
 */
export function readReviewPolicy(repoRoot) {
  const root = typeof repoRoot === 'string' && repoRoot.trim() ? repoRoot : '.'
  const path = join(root, REVIEW_POLICY_FILE)
  if (!existsSync(path)) return EMPTY_POLICY()

  let size
  try {
    size = statSync(path).size
  } catch {
    return EMPTY_POLICY()
  }
  if (size > LIMITS.maxReviewPolicyBytes) {
    const policy = EMPTY_POLICY()
    policy.problems.push(
      `${REVIEW_POLICY_FILE} is ${size} bytes, over the ${LIMITS.maxReviewPolicyBytes}-byte scan ` +
        `cap — not parsed; review proceeds under default policy`
    )
    return policy
  }

  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    const policy = EMPTY_POLICY()
    policy.problems.push(`${REVIEW_POLICY_FILE} could not be read: ${err.message}`)
    return policy
  }
  return parseReviewPolicy(text)
}

/**
 * Parse `REVIEW.md` text into `{ prose, excludePaths, humanPaths, owner, problems }`.
 *
 * Each half is validated independently (design.md D3): a broken exclusions block
 * does not stop valid prose from being returned, and a broken prose section does
 * not stop valid exclusions — the broken half yields its empty value and a
 * problem, never a half-guess. Unknown `##` sections are ignored so the format
 * can grow (D4). Pure: no filesystem, no throw on malformed input.
 */
export function parseReviewPolicy(text) {
  const policy = EMPTY_POLICY()
  if (typeof text !== 'string' || !text.trim()) return policy

  const { frontMatter, body } = splitFrontMatter(text)

  // Front matter: owner is the one accepted key; anything else is reported and
  // never adopted (a `nitCap:` here is the spec §5 failure case).
  let owner = null
  for (const { key, value, raw } of frontMatter) {
    if (BAND_KEY_LINE.test(raw)) {
      policy.problems.push(
        `front-matter line "${raw.trim()}" looks like a survival threshold — REVIEW.md controls ` +
          `scope and advice, not the band or nit cap; ignored`
      )
      continue
    }
    if (key === 'owner') {
      if (value) owner = value
      continue
    }
    if (!ACCEPTED_FRONT_MATTER_KEYS.has(key)) {
      policy.problems.push(`front-matter key "${key}" is not an accepted policy field; ignored`)
    }
  }

  // A band-like assignment smuggled into the body (outside front matter) is the
  // same failure — report it, never read it as a threshold.
  for (const line of body.split('\n')) {
    if (BAND_KEY_LINE.test(line)) {
      policy.problems.push(
        `line "${line.trim()}" looks like a survival threshold — the band and nit cap live in the ` +
          `CLI, not REVIEW.md; ignored`
      )
    }
  }

  const sections = splitSections(body)

  const proseParts = []
  let ownerSectionSeen = false
  for (const section of sections) {
    const norm = normalizeHeading(section.heading)
    if (norm === EXCLUSIONS_HEADING) {
      const { paths, problems } = parsePathList(section.content, EXCLUSIONS_SECTION)
      policy.excludePaths.push(...paths)
      policy.problems.push(...problems)
      continue
    }
    if (norm === HUMAN_REVIEW_HEADING) {
      const { paths, problems } = parsePathList(section.content, HUMAN_REVIEW_SECTION)
      policy.humanPaths.push(...paths)
      policy.problems.push(...problems)
      continue
    }
    if (PROSE_HEADINGS.has(norm)) {
      const content = section.content.trim()
      if (norm === 'owner') {
        ownerSectionSeen = true
        if (!owner && content) owner = content.split('\n')[0].trim()
      }
      if (content) proseParts.push(`## ${section.heading.trim()}\n${content}`)
      continue
    }
    // Unknown heading: ignored, forward-compatible (D4).
  }

  // Fold a front-matter owner into the injected prose when the file did not also
  // spell it out as a `## Owner` section, so the prose the reviewer reads always
  // names the bar's owner (spec: "declared owner but no other content").
  if (owner && !ownerSectionSeen) {
    proseParts.unshift(`## Owner\n${owner}`)
  }

  policy.prose = proseParts.join('\n\n')
  policy.owner = owner
  // `./dist` and `dist/` canonicalize to one prefix; keep it once.
  policy.excludePaths = [...new Set(policy.excludePaths)]
  policy.humanPaths = [...new Set(policy.humanPaths)]
  return policy
}

/**
 * Split leading YAML-ish front matter (a `---`-fenced block at the very top)
 * from the body. Front matter is a small hand-parse — `key: value` lines only —
 * so the file needs no YAML dependency (design.md D4). A file with no fence has
 * empty front matter and the whole text as body.
 */
function splitFrontMatter(text) {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { frontMatter: [], body: text }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return { frontMatter: [], body: text }

  const frontMatter = []
  for (const raw of lines.slice(1, end)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!m) continue
    frontMatter.push({ key: m[1].toLowerCase(), value: stripQuotes(m[2].trim()), raw })
  }
  return { frontMatter, body: lines.slice(end + 1).join('\n') }
}

function stripQuotes(value) {
  const m = value.match(/^(['"])(.*)\1$/)
  return m ? m[2] : value
}

/** Split a markdown body into `{ heading, content }` for each `##` section. */
function splitSections(body) {
  const sections = []
  let current = null
  for (const line of body.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (m) {
      if (current) sections.push(current)
      current = { heading: m[1], contentLines: [] }
    } else if (current) {
      current.contentLines.push(line)
    }
  }
  if (current) sections.push(current)
  return sections.map(s => ({ heading: s.heading, content: s.contentLines.join('\n') }))
}

/**
 * Parse a path-list section (`## Do Not Report`, `## Always Human Review`) into
 * canonical path prefixes.
 *
 * Entries are markdown list items (`- path` / `* path`). Each is canonicalized
 * with the same `canonicalizePath` findings go through, so a finding cannot slip
 * past a listed prefix on an alternate spelling; an entry that cannot be
 * canonicalized (absolute, escaping the root) declares nothing and is reported
 * (spec §3, task 1.3). An entry shaped like a survival threshold (`- nitCap: 0`)
 * is reported and never read as a path, in either section. So is an entry that
 * holds `*` or `?`: the lists hold prefixes, not patterns, and a pattern read as
 * a literal path matches no file, so `- src/**` would list nothing and say
 * nothing. Square brackets and braces are characters a path may hold
 * (`app/[id]/`) and are read as part of it. A structurally broken
 * block — a fenced code block, or content with no list entries at all — is
 * reported unusable as a whole and yields no paths, rather than being
 * half-guessed (spec §4, the partially-valid file).
 *
 * @param {string} content the section body
 * @param {{label: string, noPaths: string, entry: string, nothing: string}} section
 */
function parsePathList(content, section) {
  const problems = []
  if (/^\s*```/m.test(content)) {
    problems.push(
      `the "${section.label}" block contains a code fence and could not be parsed as a path list; ` +
        `${section.noPaths}`
    )
    return { paths: [], problems }
  }

  const contentLines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('<!--'))
  if (!contentLines.length) return { paths: [], problems }

  const entries = []
  let sawNonEntry = false
  for (const line of contentLines) {
    const m = line.match(/^[-*]\s+(.+)$/)
    if (m) entries.push(m[1].trim())
    else sawNonEntry = true
  }

  // Non-blank content but not a single list item: the block is not a path list.
  if (!entries.length) {
    problems.push(
      `the "${section.label}" block has content but no path list items (\`- path\`); ` +
        `${section.noPaths}`
    )
    return { paths: [], problems }
  }
  if (sawNonEntry) {
    problems.push(
      `the "${section.label}" block mixes list items with non-list text; only the \`- path\` items ` +
        `were read`
    )
  }

  const paths = []
  for (const entry of entries) {
    if (BAND_KEY_LINE.test(entry)) {
      problems.push(
        `"${section.label}" item "${entry}" looks like a survival threshold — the band and nit cap ` +
          `live in the CLI, not REVIEW.md; ignored, not read as a path`
      )
      continue
    }
    if (PATTERN_ITEM.test(entry)) {
      // The problem names its section in the form the threshold-shaped one
      // does: the merge verdict tells the two sections' problems apart by it.
      problems.push(
        `"${section.label}" item "${entry}" is a pattern, and only a path or a directory prefix is read ` +
          `here; ignored, not read as a path (list the directory instead, such as \`src/\`)`
      )
      continue
    }
    const canonical = canonicalizePath(stripQuotes(entry.replace(/\/+$/, '')))
    if (canonical) paths.push(canonical)
    else problems.push(`${section.entry} "${entry}" is not a repo-relative path and ${section.nothing}`)
  }
  return { paths, problems }
}

// Line endings and trailing newlines are not a policy difference.
function normalizePolicyText(text) {
  if (typeof text !== 'string') return ''
  const lf = text.replace(/\r\n?/g, '\n')
  return lf.trim() ? lf.replace(/\s+$/, '') + '\n' : ''
}

/**
 * Compose the policy a review is judged by from two copies of `REVIEW.md`.
 *
 * The trust split `docs/12` draws decides where each part comes from. The two
 * path lists are enforced, so a change must not edit the copy applied to it:
 * they come from `base`. The prose is advice that cannot relax the gate, so it
 * (and the owner it names) comes from `working` — an uncommitted edit still
 * reaches the reviewer. `differsFromBase` says the two copies differ, so a
 * caller can speak it; it is the only thing that makes an edited policy visible.
 *
 * Pure: each copy is `{ text, policy }` (`policy` as `parseReviewPolicy`
 * returns it, `text` carried so line endings can be compared) or `null` for an
 * absent file, which is the empty policy with no problem — absence is the off
 * switch. Reading a file at a ref is I/O and lives with the caller.
 *
 * @param {{working: ?{text: string, policy: object}, base: ?{text: string, policy: object}, ref: ?string}} input
 * @returns {{prose: string, owner: ?string, excludePaths: string[], humanPaths: string[],
 *   problems: string[], listsFrom: ?string, differsFromBase: boolean}}
 */
export function composePolicy({ working = null, base = null, ref = null } = {}) {
  const workingPolicy = working?.policy ?? EMPTY_POLICY()
  const basePolicy = base?.policy ?? EMPTY_POLICY()
  const baseLabel = ref ? `(${ref})` : '(base)'
  const problems = [
    ...(workingPolicy.problems || []).map(p => `${p} (working tree)`),
    ...(basePolicy.problems || []).map(p => `${p} ${baseLabel}`)
  ]
  return {
    prose: workingPolicy.prose || '',
    owner: workingPolicy.owner ?? null,
    excludePaths: [...(basePolicy.excludePaths || [])],
    humanPaths: [...(basePolicy.humanPaths || [])],
    problems,
    listsFrom: ref ?? null,
    differsFromBase: normalizePolicyText(working?.text) !== normalizePolicyText(base?.text)
  }
}

/** Human-readable dump of a parsed policy, for `interlock review-policy`. */
export function formatReviewPolicy(policy) {
  const lines = []
  lines.push(`REVIEW POLICY — ${policy.owner ? `owner: ${policy.owner}` : 'no owner declared'}`)
  lines.push(`  exclusions: ${policy.excludePaths.length ? policy.excludePaths.join(', ') : '(none)'}`)
  const humanPaths = policy.humanPaths || []
  lines.push(`  human-review: ${humanPaths.length ? humanPaths.join(', ') : '(none)'}`)
  lines.push(`  prose: ${policy.prose ? `${policy.prose.length} char(s)` : '(none)'}`)
  for (const problem of policy.problems) lines.push(`  PROBLEM: ${problem}`)
  return lines.join('\n') + '\n'
}
