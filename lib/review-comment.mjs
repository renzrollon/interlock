// The comment a colleague reads on their pull request (design "The comment and its weights",
// "Pre-existing", D2, D8, D9, D27, D28 of review-a-teammates-pull-request-read-only).
//
// One top-level comment: the surviving findings under reader-facing weights, the proof line,
// a line saying whether reviewers were allowed to run code, and a closing line saying it is
// not an approval. It carries no gate word, verdict, score or label, and outside reviewer text
// no stored severity name: on a colleague's pull request the reader decides what the findings
// mean. Reviewer text is rendered with the settle comment's own parts (lib/comment-parts.mjs),
// so it mentions nobody, opens no table cell and closes no fence.
//
// Pure: the record's findings, its proof and the diff's changed ranges are handed in.

import { SEVERITY_RANK, fenced, notProvenGaps, placeOf, titleOf } from './comment-parts.mjs'
import { findingId, normalizeSeverity } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { inertSpan } from './merge-confidence.mjs'
import { canonicalizePath } from './risk.mjs'
import { coverageLine, proseUnreadClause } from './review-proof.mjs'

/** The reader-facing weights, in the order the comment lists them. */
export const WEIGHTS = Object.freeze(['Important', 'Pre-existing', 'Nit'])

export const NOT_AN_APPROVAL_LINE = 'This is an automated review, not an approval. A person decides whether this merges.'
export const RAN_NOTHING_LINE = 'Reviewers read the code and ran none of it.'
export const RAN_CODE_LINE = "Reviewers were allowed to run a single test file and the repository's own CLI."

/** The severities a confirmed mark may lighten: an unrecognised one is read as the heavier case. */
const MARKABLE = Object.freeze(['blocker', 'warning'])

/**
 * A path as the diff and a finding both name it, or null when it cannot be placed inside the
 * repository: the review root's own prefix dropped (under `--target` every prompt names the
 * worktree, and a reviewer may answer with it), then `canonicalizePath`, which folds `./`, `//`,
 * `.` segments and backslashes and refuses an absolute path or one that walks out.
 */
function pathKey(p, roots = []) {
  let path = String(p).trim()
  for (const root of roots) {
    if (path === root) return null
    if (path.startsWith(`${root}/`)) {
      path = path.slice(root.length + 1)
      break
    }
  }
  return canonicalizePath(path)
}

/** Each root as a prefix: absolute, without its trailing slash, longest first so a worktree under the root is tried before it. */
const rootsOf = roots =>
  (Array.isArray(roots) ? roots : [])
    .filter(r => typeof r === 'string' && r.startsWith('/'))
    .map(r => r.replace(/\/+$/, ''))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

/**
 * Text with every root replaced: `<root>/x` reads `x`, a bare `<root>` reads `.`. The comment
 * a colleague reads names files as the repository does, never by a path on the person's machine.
 */
export function relativeText(text, roots = []) {
  let out = String(text)
  for (const root of rootsOf(roots)) out = out.split(`${root}/`).join('').split(root).join('.')
  return out
}

/** The representative severity of findings of one identity, as the settle grouping picks it. */
function groupSeverity(members) {
  let rep = members[0]
  for (const m of members) if (SEVERITY_RANK(m.severity) < SEVERITY_RANK(rep.severity)) rep = m
  return normalizeSeverity(rep.severity)
}

/** Why the mark on `m` cannot hold, or null when it can: the checks on one finding. */
function markProblem(m, { byPath, changedNames, lineCount, roots }) {
  if (m.preExisting !== true) return 'another finding of the same identity carries no pre-existing mark'
  if (typeof m.file !== 'string' || !m.file.trim()) return 'the finding names no file'
  if (!Number.isInteger(m.line) || m.line < 1) {
    return Number.isFinite(m.line) ? `the finding names line ${m.line} of ${m.file}, which no file has` : `the finding names ${m.file} and no line`
  }
  const key = pathKey(m.file, roots)
  if (key === null) return `${m.file} is not a path inside the repository`
  const entry = byPath.get(key)
  if (entry) {
    if (entry.deleted === true) return `the pull request deletes ${key}`
    if (entry.ranges.some(r => Array.isArray(r) && m.line >= r[0] && m.line <= r[1])) {
      return `line ${m.line} of ${key} is a line the pull request changes`
    }
    // A pure-deletion hunk changes no post-image line; the two lines around the cut are the change.
    if (entry.removedAt.some(at => m.line === at || m.line === at + 1)) return `line ${m.line} of ${key} borders lines the pull request removes`
  } else if (changedNames && changedNames.has(key)) {
    return `the pull request changes ${key} and the diff gave no changed lines for it`
  }
  if (typeof lineCount === 'function') {
    const total = lineCount(key)
    if (!Number.isInteger(total)) return `the pull request's head holds no file ${key}`
    if (m.line > total) return `${key} has ${total} line${total === 1 ? '' : 's'} at the pull request's head, not ${m.line}`
  }
  return null
}

/**
 * Which `preExisting` marks hold: a mark is confirmed only when the finding names a file
 * inside the repository and a line, and that line is outside every changed range of its file
 * and does not border a removal, or the file is not in the diff. Findings of one identity are
 * confirmed only when every one of them is marked and confirmed. A mark on a finding whose
 * severity is not a blocker or a warning changes no weight, so it is neither confirmed nor
 * refused. `ranges` null (the diff could not be read) confirms nothing.
 *
 * Absence from the parsed diff is never proof on its own: `changedNames`, the files git lists
 * as changed, refuses a file the diff changes but gave no ranges for (a binary file, a rename
 * with no edit); `lineCount(path)`, the file's line count at the head or null when the head
 * holds no such file, refuses a file or a line that does not exist; `roots` are the absolute
 * prefixes (the review worktree, the person's tree) a reviewer may have written a path under.
 *
 * @param {Array<object>} findings  the record's surviving findings, before they are grouped
 * @param {Array<{ path: string, ranges: Array<[number, number]>, deleted?: true, removedAt?: number[] }>|null} ranges
 *   what `changedRanges` returns, with `marks: true` for deletions
 * @param {{ changedNames?: Iterable<string>, lineCount?: (path: string) => number|null, roots?: string[] }} [options]
 * @returns {{ confirmed: string[], refused: Array<{ id: string, reason: string }> }}
 */
export function confirmPreExisting(findings, ranges, { changedNames, lineCount, roots } = {}) {
  const confirmed = []
  const refused = []
  if (!Array.isArray(ranges)) return { confirmed, refused }
  const byPath = new Map()
  for (const entry of ranges) {
    const key = entry && typeof entry.path === 'string' ? canonicalizePath(entry.path) : null
    if (key === null) continue
    byPath.set(key, {
      ranges: Array.isArray(entry.ranges) ? entry.ranges : [],
      deleted: entry.deleted === true,
      removedAt: Array.isArray(entry.removedAt) ? entry.removedAt.filter(Number.isInteger) : []
    })
  }
  const names = changedNames ? new Set([...changedNames].map(canonicalizePath).filter(Boolean)) : null
  const checks = { byPath, changedNames: names, lineCount, roots: rootsOf(roots) }
  const groups = new Map()
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue
    const id = findingId(f)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(f)
  }
  for (const [id, members] of groups) {
    if (!members.some(m => m.preExisting === true)) continue
    if (!MARKABLE.includes(groupSeverity(members))) continue
    let reason = null
    for (const m of members) {
      reason = markProblem(m, checks)
      if (reason) break
    }
    if (reason) refused.push({ id, reason })
    else confirmed.push(id)
  }
  return { confirmed, refused }
}

/**
 * The weight a reader sees: `Nit` for a suggestion, marked or not; `Pre-existing` for a blocker
 * or a warning whose mark was confirmed; `Important` for every other finding, a severity the
 * CLI does not recognise included.
 *
 * @returns {'Important'|'Pre-existing'|'Nit'}
 */
export function weightOf(finding, confirmedIds = []) {
  const severity = normalizeSeverity(finding && finding.severity)
  if (severity === 'suggestion') return 'Nit'
  if (MARKABLE.includes(severity) && [...confirmedIds].includes(findingId(finding))) return 'Pre-existing'
  return 'Important'
}

/** The proof paragraph: the coverage line when the proof holds, else `REVIEW NOT PROVEN:` with the gaps. */
function proofParagraph(proof) {
  const given = proof && typeof proof === 'object' && !Array.isArray(proof) ? proof : null
  if (given && given.proven === true) return coverageLine(given, { span: inertSpan })
  const clause = given ? proseUnreadClause(given, inertSpan) : ''
  return `REVIEW NOT PROVEN: ${notProvenGaps(given)}${clause ? `; ${clause}` : ''}`
}

/** The reviewer-written fields a reader sees, with every root made relative; the id is still the record's. */
function shownOf(f, roots) {
  if (!roots.length) return f
  const out = { ...f }
  for (const key of ['file', 'title', 'description', 'suggestion']) if (typeof f[key] === 'string') out[key] = relativeText(f[key], roots)
  return out
}

/** What a cut dropped, in the order it drops: nit bodies, nit rows, then the leading findings' bodies. */
const CUT_STAGES = Object.freeze(['nitBodies', 'nitRows', 'leadBodies'])

/**
 * The comment text, within `LIMITS.maxReviewerCommentChars` where the rows of Important and
 * Pre-existing findings allow it.
 *
 * @param {{ head: string, findings: Array<object>, proof: object|null, runCode: boolean, confirmed: string[], roots?: string[], bound?: number }} given
 *   `findings` one per identity (the settle grouping), `confirmed` the ids `confirmPreExisting` confirmed,
 *   `roots` the absolute prefixes shown relative (the review worktree, the person's tree)
 * @returns {string}
 */
export function renderReviewerComment({ head, findings = [], proof = null, runCode = false, confirmed = [], roots = [], bound = LIMITS.maxReviewerCommentChars }) {
  const list = (Array.isArray(findings) ? findings : []).filter(f => f && typeof f === 'object' && !Array.isArray(f))
  const prefixes = rootsOf(roots)
  const weighed = list.map((f, i) => ({ f, shown: shownOf(f, prefixes), i, weight: weightOf(f, confirmed) }))
  const important = weighed.filter(w => w.weight === 'Important').sort((a, b) => SEVERITY_RANK(a.f.severity) - SEVERITY_RANK(b.f.severity) || a.i - b.i)
  const preExisting = weighed.filter(w => w.weight === 'Pre-existing')
  const nits = weighed.filter(w => w.weight === 'Nit')
  const lead = [...important, ...preExisting]
  const inTable = { inTable: true }

  const tableOf = ws => [
    '| Id | Weight | Location | Finding |',
    '| --- | --- | --- | --- |',
    ...ws.map(({ f, shown, weight }) => `| ${findingId(f)} | ${weight} | ${inertSpan(placeOf(shown), inTable)} | ${inertSpan(titleOf(shown), inTable)} |`),
    ''
  ]
  const bodiesOf = ws =>
    ws.flatMap(({ f, shown, weight }) => [
      `**${findingId(f)}** (${weight}) ${inertSpan(placeOf(shown))} — ${inertSpan(titleOf(shown))}`,
      ...(typeof shown.description === 'string' && shown.description.trim() ? ['', ...fenced(shown.description.trim())] : []),
      ...(typeof shown.suggestion === 'string' && shown.suggestion.trim() ? ['', 'Proposed fix:', ...fenced(shown.suggestion.trim())] : []),
      ''
    ])
  const proofText = relativeText(proofParagraph(proof), prefixes)

  const layout = cut => {
    const keptNits = nits.slice(0, nits.length - cut.nitRows)
    const nitBodies = keptNits.slice(0, Math.max(0, keptNits.length - cut.nitBodies))
    const leadBodies = lead.slice(0, lead.length - cut.leadBodies)
    const collapsed = keptNits.length
      ? ['<details>', `<summary>${nits.length} nit${nits.length === 1 ? '' : 's'}</summary>`, '', ...tableOf(keptNits), ...bodiesOf(nitBodies), '</details>', '']
      : []
    const dropped = [
      [nits.length - nitBodies.length - cut.nitRows, "nit's body", "nits' bodies"],
      [cut.nitRows, "nit's row", "nits' rows"],
      [cut.leadBodies, "finding's body", "findings' bodies"]
    ].filter(([n]) => n > 0)
    const cutLine = dropped.length
      ? [`CUT: ${dropped.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join('; ')}, to fit the comment's bound (\`interlock limits\`); the review record holds every finding whole.`, '']
      : []
    return [
      `## Automated review — ${head}`,
      '',
      ...(list.length ? [...(lead.length ? [...tableOf(lead), ...bodiesOf(leadBodies)] : []), ...collapsed] : ['The automated review raised no surviving finding.', '']),
      ...cutLine,
      proofText,
      '',
      runCode === true ? RAN_CODE_LINE : RAN_NOTHING_LINE,
      '',
      NOT_AN_APPROVAL_LINE,
      ''
    ].join('\n')
  }

  // Each stage drops the fewest it can, last first, before the next stage starts (the
  // validation comment's `fit`); the rows of the findings that lead are never cut.
  const sizes = { nitBodies: nits.length, nitRows: nits.length, leadBodies: lead.length }
  const cut = { nitBodies: 0, nitRows: 0, leadBodies: 0 }
  let text = layout(cut)
  for (const stage of CUT_STAGES) {
    if (text.length <= bound) break
    cut[stage] = sizes[stage]
    if (layout(cut).length > bound) {
      text = layout(cut)
      continue
    }
    let lo = 1
    let hi = sizes[stage]
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      cut[stage] = mid
      if (layout(cut).length <= bound) hi = mid
      else lo = mid + 1
    }
    cut[stage] = hi
    text = layout(cut)
  }
  return text
}
