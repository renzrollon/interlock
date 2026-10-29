// What a review proves it covered (prove-the-review-covered-the-diff design §3).
//
// The skeptics attack false positives; nothing attacked false negatives, so a
// review that raised nothing read as clean by default. On PR #28 four
// dimensions answered `{ "findings": [] }`, two after skipping the inputs their
// rubric requires, and the record said `ran`. This module is the other half:
// each dimension's answer carries a coverage ledger (what it checked, each cited
// at `path:line`, and what it did not read), and the proof computed here says
// which ran dimension is unproven, which left an input unread, and which changed
// source file no dimension cited.
//
// The ledger proves where a reviewer looked, never that it looked well. Each
// `at` is checked for the shape of a `path:line` or `path:start-end` token only,
// because blast radius and regression cite callers outside the diff; coverage is
// counted only against changed files, so a fabricated path covers nothing.
//
// Pure: no fs, no git, no clock. Its callers (`lib/review-cli.mjs`, `lib/run.mjs`)
// compute the changed-path list, as the union of `--changed` and git's own list
// for `--base`, and the files changed since a carried ledger's head.

import { LIMITS } from './limits.mjs'
import { isReviewSource } from './artifacts.mjs'
import { findingId } from './findings.mjs'
import { canonicalizePath } from './locators.mjs'

/** A ledger entry's `at`: one `path:line` or `path:start-end` token, and nothing else. */
const AT_TOKEN = /^(\S+?):(\d+)(?:-(\d+))?$/

/** The reason a dimension whose answer carried no `coverage` key is unproven. */
export const NOT_RECORDED = 'coverage not recorded'

/** The reason a proof given no changed-path list does not hold. */
export const NO_DIFF = 'no diff given'

const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isText = v => typeof v === 'string' && v.trim() !== ''

/** The per-dimension answers in a `--findings` input: `{ dimension, findings, coverage }` records. */
export function answersOf(input) {
  const list = Array.isArray(input) ? input : isObject(input) ? [input] : []
  return list.filter(a => isObject(a) && typeof a.dimension === 'string' && Array.isArray(a.findings))
}

/** The canonical path an `at` token names, or null when the token is not one. */
function atPath(at) {
  if (typeof at !== 'string') return null
  const m = at.trim().match(AT_TOKEN)
  if (!m) return null
  if (m[3] !== undefined && Number(m[3]) < Number(m[2])) return null
  return canonicalizePath(m[1])
}

/**
 * Validate one answer's `coverage`. Absent is not a fault of shape: it is
 * `{ ok: false, problem: NOT_RECORDED, absent: true }`, so an older worker
 * degrades to an unproven dimension rather than to an error.
 *
 * @param {unknown} coverage
 * @returns {{ ok: true, ledger: { checked: Array<{what: string, at: string}>, unread: Array<{input: string, reason: string}> } }
 *   | { ok: false, problem: string, absent?: true }}
 */
export function validateLedger(coverage) {
  if (coverage === undefined) return { ok: false, problem: NOT_RECORDED, absent: true }
  if (!isObject(coverage)) return { ok: false, problem: 'coverage is not an object with "checked" and "unread"' }
  for (const key of ['checked', 'unread']) {
    if (!Array.isArray(coverage[key])) return { ok: false, problem: `coverage."${key}" must be a list` }
  }
  for (const [i, entry] of coverage.checked.entries()) {
    if (!isObject(entry)) return { ok: false, problem: `checked[${i}] is not an object with "what" and "at"` }
    if (!isText(entry.what)) return { ok: false, problem: `checked[${i}] has no "what"` }
    if (entry.at === undefined) return { ok: false, problem: `checked[${i}] (${JSON.stringify(entry.what)}) has no "at"` }
    if (!atPath(entry.at)) {
      return { ok: false, problem: `checked[${i}] "at" ${JSON.stringify(entry.at)} is not a path:line or path:start-end token` }
    }
  }
  for (const [i, entry] of coverage.unread.entries()) {
    if (!isObject(entry) || !isText(entry.input) || !isText(entry.reason)) {
      return { ok: false, problem: `unread[${i}] must be an object with a string "input" and "reason"` }
    }
  }
  return {
    ok: true,
    ledger: {
      checked: coverage.checked.map(({ what, at }) => ({ what, at: at.trim() })),
      unread: coverage.unread.map(({ input, reason }) => ({ input, reason }))
    }
  }
}

/**
 * Read every answer's ledger. `ledgers` holds the valid ones by dimension;
 * `faults` the reason each other answer is unproven; `rejected` the subset that
 * carried a coverage key of the wrong shape, for the `LEDGER REJECTED:` line.
 * Two answers for one dimension are read as one: their checked and unread
 * entries joined, and a fault in either faulting both.
 */
export function readLedgers(answers) {
  const ledgers = {}
  const faults = {}
  const rejected = []
  for (const answer of answers) {
    const d = answer.dimension
    const read = validateLedger(answer.coverage)
    if (!read.ok) {
      if (!faults[d]) faults[d] = read.problem
      if (!read.absent) rejected.push({ dimension: d, problem: read.problem })
      continue
    }
    const into = ledgers[d] || (ledgers[d] = { checked: [], unread: [] })
    into.checked.push(...read.ledger.checked)
    into.unread.push(...read.ledger.unread)
  }
  for (const d of Object.keys(faults)) delete ledgers[d]
  return { ledgers, faults, rejected }
}

/** The one `LEDGER REJECTED:` line per rejected dimension, for standard error. */
export function rejectedLines(rejected) {
  return rejected.map(r => `LEDGER REJECTED: ${r.dimension}: ${r.problem}; recorded unproven`)
}

/**
 * Compute the proof.
 *
 * @param {object} given
 * @param {string[]} given.ran  the dimensions this review ran
 * @param {Array} given.answers  the per-dimension answers (`answersOf`)
 * @param {string[]|null} given.changedPaths  the union of `--changed` and git's list; null or empty when neither was given
 * @param {Record<string, {checked: Array, unread: Array, staleFiles?: string[]}>} [given.carried]
 *   the ledgers of dimensions carried from an earlier record, each with the files changed since its head
 * @param {Array<{file?: string, dimension?: string, staleFiles?: string[]}>} [given.carriedFindings]
 * @param {number} [given.reruns]
 * @returns {{ proven: boolean, reason: string|null, dimensions: string[], unproven: Array<{dimension: string, reason: string}>,
 *   unread: Array<{dimension: string, entries: Array<{input: string, reason: string}>}>, uncited: string[],
 *   changed: number, cited: number, carried: string[], reruns: number, rejected: Array<{dimension: string, problem: string}> }}
 */
export function computeProof({ ran, answers, changedPaths, carried = {}, carriedFindings = [], reruns = 0 }) {
  const dimensions = [...new Set((Array.isArray(ran) ? ran : []).filter(isText))]
  const { ledgers, faults, rejected } = readLedgers(answers)
  const findingsBy = {}
  for (const a of answers) (findingsBy[a.dimension] ||= []).push(...a.findings.filter(isObject))

  const unproven = []
  const unread = []
  for (const d of dimensions) {
    const ledger = ledgers[d]
    if (faults[d]) unproven.push({ dimension: d, reason: faults[d] })
    else if (!ledger && !findingsBy[d]) unproven.push({ dimension: d, reason: 'no answer recorded' })
    else if (!ledger) unproven.push({ dimension: d, reason: NOT_RECORDED })
    else if (!ledger.checked.length && !(findingsBy[d] || []).length) unproven.push({ dimension: d, reason: 'raised nothing and checked nothing' })
    if (ledger && ledger.unread.length) unread.push({ dimension: d, entries: ledger.unread })
  }

  const changedList = Array.isArray(changedPaths) ? changedPaths.map(canonicalizePath).filter(Boolean) : []
  const coverable = [...new Set(changedList)].filter(isReviewSource).sort()
  const coverableSet = new Set(coverable)
  const cited = new Set()
  const cite = (path, stale) => {
    const p = canonicalizePath(path)
    if (p && coverableSet.has(p) && !(stale && stale.has(p))) cited.add(p)
  }
  for (const d of dimensions) {
    for (const entry of ledgers[d]?.checked || []) cite(atPath(entry.at))
    for (const f of findingsBy[d] || []) if (typeof f.file === 'string') cite(f.file)
  }
  const carriedNames = []
  for (const [d, ledger] of Object.entries(carried)) {
    if (dimensions.includes(d) || !isObject(ledger) || !Array.isArray(ledger.checked)) continue
    carriedNames.push(d)
    const stale = new Set((ledger.staleFiles || []).map(canonicalizePath).filter(Boolean))
    for (const entry of ledger.checked) cite(atPath(entry.at), stale)
  }
  for (const f of carriedFindings) {
    if (!isObject(f) || typeof f.file !== 'string') continue
    cite(f.file, new Set((f.staleFiles || []).map(canonicalizePath).filter(Boolean)))
  }
  const uncited = coverable.filter(p => !cited.has(p))

  let reason = null
  if (!changedList.length) reason = NO_DIFF
  else if (!dimensions.length && !carriedNames.length) reason = 'no dimension ran'
  const proven = reason === null && !unproven.length && !unread.length && !uncited.length
  if (!proven && reason === null) reason = 'gaps in coverage'
  return {
    proven,
    reason: proven ? null : reason,
    dimensions,
    unproven,
    unread,
    uncited,
    changed: coverable.length,
    cited: cited.size,
    carried: carriedNames,
    reruns: Number.isInteger(reruns) && reruns >= 0 ? reruns : 0,
    rejected
  }
}

/**
 * The record's coverage, keyed by dimension: this review's valid ledgers, then
 * the carried ones marked so. A carried ledger keeps its `staleFiles`, so a run
 * that carries it again still finds a file edited since the ledger was written
 * stale, however many rounds ago that edit was.
 */
export function coverageRecord(answers, carried = {}) {
  const { ledgers } = readLedgers(answers)
  const out = { ...ledgers }
  for (const [d, ledger] of Object.entries(carried)) {
    if (out[d] || !isObject(ledger)) continue
    const { staleFiles, ...kept } = ledger
    const stale = Array.isArray(staleFiles) ? [...new Set(staleFiles.filter(isText))].sort() : []
    out[d] = { ...kept, ...(stale.length ? { staleFiles: stale } : {}), carried: true }
  }
  return out
}

/**
 * The dimensions a proof names for a re-run, in the order they ran: each
 * unproven dimension, each with unread inputs, and the uncited target. The
 * uncited target is `regression` when it ran, else the first ran dimension, so a
 * scoped review re-runs nothing outside its `--dimensions`.
 */
export function rerunTargets(proof) {
  const { dimensions, unproven, unread, uncited } = listsOf(proof)
  const named = new Set([...unproven.map(u => u.dimension), ...unread.map(u => u.dimension)])
  if (uncited.length && dimensions.length) {
    named.add(dimensions.includes('regression') ? 'regression' : dimensions[0])
  }
  return dimensions.filter(d => named.has(d))
}

/** One reason line per gap, for the lines after the proof answer and for the not-proven paragraph. */
export function gapLines(proof) {
  const { dimensions, unproven, unread, uncited } = listsOf(proof)
  const lines = []
  for (const u of unproven) lines.push(`${u.dimension}: unproven (${u.reason})`)
  for (const u of unread) {
    lines.push(`${u.dimension}: unread ${u.entries.map(e => `${e.input} (${e.reason})`).join('; ')}`)
  }
  if (uncited.length) {
    const target = dimensions.includes('regression') ? 'regression' : dimensions[0]
    lines.push(`${target || 'no dimension'}: uncited ${uncited.join(', ')}`)
  }
  if (proof.reason === NO_DIFF) lines.push('no diff given: the proof had no changed-path list, from --changed or from a --base git could diff')
  return lines
}

/**
 * `interlock review proof --review <file>`'s answer for a parsed record: the
 * first line, the reason lines after it, and the exit code. A record that is
 * not an adjudicated review, or carries no proof, is exit 2 with the reason on
 * `error`, so it is never mistaken for the re-run answer.
 *
 * @param {unknown} record
 * @param {{ maxReruns?: number }} [opts]
 * @returns {{ exit: 0|1|2, first?: string, reasons?: string[], error?: string }}
 */
export function proofAnswer(record, { maxReruns = LIMITS.maxProofReruns } = {}) {
  if (!isObject(record) || !Array.isArray(record.surviving)) {
    return { exit: 2, error: 'the record carries no surviving list, so it is not an adjudicated review' }
  }
  const proof = record.proof
  if (!isObject(proof) || !Array.isArray(proof.dimensions)) {
    return { exit: 2, error: 'the record carries no proof; write it with this version of interlock review' }
  }
  if (proof.proven === true) return { exit: 0, first: 'proven', reasons: [] }
  const targets = rerunTargets(proof)
  const reasons = gapLines(proof)
  if (!targets.length) {
    return { exit: 2, error: `the proof does not hold and no dimension can be re-run for it: ${reasons.join('; ') || proof.reason}` }
  }
  const reruns = Number.isInteger(proof.reruns) && proof.reruns >= 0 ? proof.reruns : 0
  if (reruns >= maxReruns) return { exit: 0, first: `PROOF CAP REACHED: ${targets.join(', ')}`, reasons }
  return { exit: 1, first: `re-run: ${targets.join(', ')}`, reasons }
}

/** The ids of the findings a draft's verdicts adjudicate, matched as `resolveReview` matches them: title, narrowed by file. */
export function verdictedIds(draft) {
  const inputs = isObject(draft) && isObject(draft.inputs) ? draft.inputs : {}
  const verdicts = Array.isArray(inputs.verdicts) ? inputs.verdicts.filter(v => isObject(v) && typeof v.findingTitle === 'string') : []
  const ids = new Set()
  for (const answer of answersOf(inputs.answers)) {
    for (const f of answer.findings) {
      if (!isObject(f) || typeof f.title !== 'string') continue
      const file = typeof f.file === 'string' ? f.file.trim() : ''
      const judged = verdicts.some(v => v.findingTitle === f.title && (!isText(v.file) || v.file.trim() === file))
      if (judged) ids.add(findingId(f))
    }
  }
  return ids
}

/**
 * Merge a re-run into a draft's inputs (D22). No first-pass finding is dropped:
 * every re-run dimension keeps its first answer's findings and gains the ones
 * whose ids are new. A dimension the draft's proof named unproven or unread has
 * its ledger replaced by the re-run's (absent when the re-run carries none); any
 * other re-run dimension has its new checked and unread entries appended; a
 * dimension the re-run does not name is untouched. The draft's verdicts are kept
 * and the new ones appended. `reruns` is the draft's count plus one when the
 * re-run carries an answer, and the draft's count when it carries none (the
 * promote write).
 *
 * @param {{ inputs?: { answers?: Array, verdicts?: Array }, proof?: object }} draft
 * @param {{ answers?: Array, verdicts?: Array }} rerun
 * @returns {{ answers: Array, verdicts: Array, reruns: number }}
 */
export function mergeRerun(draft, rerun = {}) {
  const inputs = isObject(draft?.inputs) ? draft.inputs : {}
  const proof = isObject(draft?.proof) ? draft.proof : { unproven: [], unread: [] }
  const replace = new Set([
    ...(Array.isArray(proof.unproven) ? proof.unproven.map(u => u.dimension) : []),
    ...(Array.isArray(proof.unread) ? proof.unread.map(u => u.dimension) : [])
  ])
  const answers = answersOf(inputs.answers).map(a => ({ ...a, findings: [...a.findings] }))
  const fresh = answersOf(rerun.answers)
  for (const next of fresh) {
    const at = answers.findIndex(a => a.dimension === next.dimension)
    if (at === -1) {
      answers.push(next)
      continue
    }
    const first = answers[at]
    const known = new Set(first.findings.filter(isObject).map(findingId))
    const added = next.findings.filter(f => isObject(f) && !known.has(findingId(f)))
    const merged = { ...first, findings: [...first.findings, ...added] }
    if (replace.has(next.dimension)) {
      delete merged.coverage
      if (next.coverage !== undefined) merged.coverage = next.coverage
      answers[at] = merged
      continue
    }
    const a = validateLedger(first.coverage)
    const b = validateLedger(next.coverage)
    if (a.ok || b.ok) {
      merged.coverage = {
        checked: [...(a.ok ? a.ledger.checked : []), ...(b.ok ? b.ledger.checked : [])],
        unread: [...(a.ok ? a.ledger.unread : []), ...(b.ok ? b.ledger.unread : [])]
      }
    }
    answers[at] = merged
  }
  const verdicts = [
    ...(Array.isArray(inputs.verdicts) ? inputs.verdicts : []),
    ...(Array.isArray(rerun.verdicts) ? rerun.verdicts : [])
  ]
  const before = Number.isInteger(proof.reruns) && proof.reruns >= 0 ? proof.reruns : 0
  return { answers, verdicts, reruns: before + (fresh.length ? 1 : 0) }
}

/** A proof's lists, each `[]` when a hand-made or older record lacks it, so a reader prints rather than throws. */
function listsOf(proof) {
  const list = key => (Array.isArray(proof[key]) ? proof[key].filter(isObject) : [])
  return {
    dimensions: Array.isArray(proof.dimensions) ? proof.dimensions.filter(isText) : [],
    carried: Array.isArray(proof.carried) ? proof.carried.filter(isText) : [],
    unproven: list('unproven'),
    unread: list('unread').map(u => ({ ...u, entries: Array.isArray(u.entries) ? u.entries.filter(isObject) : [] })),
    uncited: Array.isArray(proof.uncited) ? proof.uncited.filter(isText) : []
  }
}

const countOf = n => (Number.isInteger(n) && n >= 0 ? n : 0)

/** The proof's counts in one clause, for the comment's coverage line and the run's banner. */
export function proofCounts(proof) {
  const { unproven, unread, uncited } = listsOf(proof)
  return (
    `${unproven.length} unproven, ${unread.length} with unread inputs, ` +
    `${uncited.length} uncited of ${countOf(proof.changed)} changed source file(s)`
  )
}

/** The `REVIEW NOT PROVEN` banner a ship close and a settle comment carry for a proof that does not hold. */
export function notProvenBanner(proof) {
  if (!isObject(proof)) return 'REVIEW NOT PROVEN: the review record carries no proof of coverage'
  const { unproven, unread, uncited } = listsOf(proof)
  const parts = []
  if (unproven.length) parts.push(`unproven ${unproven.map(u => u.dimension).join(', ')}`)
  if (unread.length) {
    parts.push(`unread ${unread.map(u => `${u.dimension} (${u.entries.map(e => e.input).join(', ')})`).join(', ')}`)
  }
  if (uncited.length) parts.push(`uncited ${uncited.join(', ')}`)
  if (proof.reason === NO_DIFF) parts.push(NO_DIFF)
  return `REVIEW NOT PROVEN: ${parts.join('; ') || proof.reason || 'gaps in coverage'}`
}

/** The coverage line every settle comment ends with: the dimensions that ran and how many changed source files they cited. */
export function coverageLine(proof) {
  if (!isObject(proof)) return 'Coverage: the review recorded no proof of coverage.'
  const { dimensions, carried: carriedNames } = listsOf(proof)
  const ran = dimensions.length ? dimensions.join(', ') : 'none'
  const carried = carriedNames.length ? `; carried: ${carriedNames.join(', ')}` : ''
  return `Coverage: ran ${ran}${carried}; ${countOf(proof.cited)} of ${countOf(proof.changed)} changed source file(s) cited.`
}

/**
 * The proof a ship run's adjudication records (spec: review/review-proof, the
 * run's review step), so `lib/run.mjs` only calls it. The first review proves
 * every ran dimension from its answer. A fix round re-reviews `reReviewed`
 * only: every other ran dimension carries its ledger from `previous`, and an
 * entry on a file whose content hash moved since `previous.proofHashes`, or
 * that went stale in an earlier round (the ledger's own `staleFiles`), covers
 * nothing, so a fixer's edit is always re-cited by someone. A carried dimension
 * with no ledger to carry is unproven. A round that re-reviews nothing and
 * moves no file (the verdict round) changes nothing the proof stands on, so
 * `previous`'s coverage, proof and hashes are kept as they are. The run runs no
 * proof re-run (D24).
 *
 * @param {object} given
 * @param {*} given.findings  the findings work file as written
 * @param {string[]} given.ran  the dimension record's `ran`
 * @param {string[]} given.changedPaths  the run's observed changed paths
 * @param {string[]|null} [given.reReviewed]  null for the first review
 * @param {{ coverage?: object, proofHashes?: Record<string, string> }|null} [given.previous]
 * @param {(path: string) => string|null} given.hashOf  a changed file's content hash, null when unreadable
 * @returns {{ coverage: object, proof: object, proofHashes: Record<string, string>, banner: string|null }}
 */
export function runProofRecord({ findings, ran, changedPaths, reReviewed = null, previous = null, hashOf }) {
  const answers = answersOf(findings)
  const fresh = Array.isArray(reReviewed) ? ran.filter(d => reReviewed.includes(d)) : ran
  const proofHashes = {}
  for (const p of Array.isArray(changedPaths) ? changedPaths : []) {
    const h = hashOf(p)
    if (h !== null) proofHashes[p] = h
  }
  const carried = {}
  const before = isObject(previous?.proofHashes) ? previous.proofHashes : {}
  // A file deleted since `previous` has no hash now, and moved all the same.
  const stale = [...new Set([...Object.keys(before), ...Object.keys(proofHashes)])].filter(p => before[p] !== proofHashes[p])
  if (Array.isArray(reReviewed) && !fresh.length && !stale.length && isObject(previous?.proof) && isObject(previous.coverage)) {
    const proof = previous.proof
    return { coverage: previous.coverage, proof, proofHashes: before, banner: proof.proven === true ? null : notProvenBanner(proof) }
  }
  const ledgers = isObject(previous?.coverage) ? previous.coverage : {}
  const missing = []
  for (const d of ran) {
    if (fresh.includes(d)) continue
    if (isObject(ledgers[d]) && Array.isArray(ledgers[d].checked)) {
      const earlier = Array.isArray(ledgers[d].staleFiles) ? ledgers[d].staleFiles : []
      carried[d] = { ...ledgers[d], staleFiles: [...new Set([...earlier, ...stale])] }
    } else missing.push(d)
  }
  const { rejected: _r, ...proof } = computeProof({
    ran: [...fresh, ...missing],
    answers: answers.filter(a => fresh.includes(a.dimension)),
    changedPaths,
    carried
  })
  return {
    coverage: coverageRecord(answers.filter(a => fresh.includes(a.dimension)), carried),
    proof,
    proofHashes,
    banner: proof.proven ? null : notProvenBanner(proof)
  }
}
