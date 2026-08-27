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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LIMITS } from './limits.mjs'
import { SEVERITIES, TOLERANCE_BAND, applyToleranceBand } from './findings.mjs'
// The locator vocabulary lives in one module because a second surface now
// audits citations the same way (`auditHandoffEvidence` in lib/waves.mjs). Two
// definitions of "what a locator looks like" drift silently, each still passing
// its own tests. See lib/locators.mjs for what is shared and what is not.
import { CITATION_TOKEN, canonicalizePath, citesLineIn, diffIndex } from './locators.mjs'

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
 * @param {{band?: object|null, changedPaths?: string[], excludePaths?: string[]}} [opts]
 *   `band` overrides the tolerance band (`null` disables it — the default is
 *   `TOLERANCE_BAND`). `changedPaths` is the reviewed diff; when supplied, a
 *   dismissing verdict's citation must name a path in it (see `hasEvidence`).
 *   `excludePaths` is a list of canonical do-not-report prefixes (from a repo's
 *   `REVIEW.md`); a finding whose canonical file lies at or under one is dropped
 *   BEFORE the band is applied, so exclusions shrink the input but never alter
 *   the arithmetic on what remains (add-interlock-review-policy spec §5).
 * @returns {{
 *   surviving: Array, dismissed: Array, droppedByQuality: Array, droppedByPolicy: Array,
 *   counts: {raised: number, dismissed: number, droppedByQuality: number, droppedByPolicy: number, surviving: number},
 *   dimensionStats: Object<string, {raised: number, surviving: number}>,
 *   anomalies: {orphanVerdicts: Array, malformedVerdicts: Array}
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

    let real = 0
    let notReal = 0
    let uncited = 0
    const scores = []
    for (const v of vs) {
      if (votedReal(v)) real += 1
      else if (hasEvidence(v, diff)) notReal += 1
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
    anomalies: { orphanVerdicts, malformedVerdicts }
  }
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
function pathExcludedBy(file, canonicalPrefix) {
  const canonicalFile = canonicalizePath(file)
  if (!canonicalFile) return false
  return canonicalFile === canonicalPrefix || canonicalFile.startsWith(canonicalPrefix + '/')
}

/** Human-readable review summary. */
export function formatReview(result) {
  const { raised, dismissed, droppedByQuality, droppedByPolicy, surviving, dismissalsRejected } =
    result.counts
  const lines = []
  lines.push(`REVIEW — ${surviving} of ${raised} finding(s) survived`)
  lines.push(
    `  raised=${raised} droppedByPolicy=${droppedByPolicy || 0} dismissed=${dismissed} ` +
      `droppedByQuality=${droppedByQuality} surviving=${surviving}`
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

const EMPTY_POLICY = () => ({ prose: '', excludePaths: [], owner: null, problems: [] })

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

/**
 * Read the repo-root `REVIEW.md` and parse it into a policy object.
 *
 * Fail-open (design.md D3): an absent file is the empty policy with no problems
 * — absence *is* the off switch, not an error. A file over the scan cap
 * (`LIMITS.maxReviewPolicyBytes`) or unreadable is reported as a problem and the
 * run proceeds under default policy rather than parsing unbounded input.
 *
 * @param {string} repoRoot repository root to look under (defaults to cwd)
 * @returns {{prose: string, excludePaths: string[], owner: string|null, problems: string[]}}
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
 * Parse `REVIEW.md` text into `{ prose, excludePaths, owner, problems }`.
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
      const { paths, problems } = parseExclusions(section.content)
      policy.excludePaths.push(...paths)
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
 * Parse a `## Do Not Report` block into canonical excluded prefixes.
 *
 * Entries are markdown list items (`- path` / `* path`). Each is canonicalized
 * with the same `canonicalizePath` findings go through, so a finding cannot slip
 * an exclusion on an alternate spelling; an entry that cannot be canonicalized
 * (absolute, escaping the root) excludes nothing and is reported (spec §3, task
 * 1.3). A structurally broken block — a fenced code block, or content with no
 * list entries at all — is reported unusable as a whole and yields no
 * exclusions, rather than being half-guessed (spec §4, the partially-valid file).
 */
function parseExclusions(content) {
  const problems = []
  if (/^\s*```/m.test(content)) {
    problems.push(
      `the "Do Not Report" block contains a code fence and could not be parsed as a path list; ` +
        `no exclusions applied`
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
      `the "Do Not Report" block has content but no path list items (\`- path\`); ` +
        `no exclusions applied`
    )
    return { paths: [], problems }
  }
  if (sawNonEntry) {
    problems.push(
      `the "Do Not Report" block mixes list items with non-list text; only the \`- path\` items ` +
        `were read`
    )
  }

  const paths = []
  for (const entry of entries) {
    const canonical = canonicalizePath(stripQuotes(entry.replace(/\/+$/, '')))
    if (canonical) paths.push(canonical)
    else problems.push(`exclusion "${entry}" is not a repo-relative path and excludes nothing`)
  }
  return { paths, problems }
}

/** Human-readable dump of a parsed policy, for `interlock review-policy`. */
export function formatReviewPolicy(policy) {
  const lines = []
  lines.push(`REVIEW POLICY — ${policy.owner ? `owner: ${policy.owner}` : 'no owner declared'}`)
  lines.push(`  exclusions: ${policy.excludePaths.length ? policy.excludePaths.join(', ') : '(none)'}`)
  lines.push(`  prose: ${policy.prose ? `${policy.prose.length} char(s)` : '(none)'}`)
  for (const problem of policy.problems) lines.push(`  PROBLEM: ${problem}`)
  return lines.join('\n') + '\n'
}
