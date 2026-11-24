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
import { inertSpan } from './merge-confidence.mjs'
import { coverageLine, proseUnreadClause } from './review-proof.mjs'

/** The reader-facing weights, in the order the comment lists them. */
export const WEIGHTS = Object.freeze(['Important', 'Pre-existing', 'Nit'])

export const NOT_AN_APPROVAL_LINE = 'This is an automated review, not an approval. A person decides whether this merges.'
export const RAN_NOTHING_LINE = 'Reviewers read the code and ran none of it.'
export const RAN_CODE_LINE = "Reviewers were allowed to run a single test file and the repository's own CLI."

/** The severities a confirmed mark may lighten: an unrecognised one is read as the heavier case. */
const MARKABLE = Object.freeze(['blocker', 'warning'])

/** A path as the diff and a finding both name it: leading `./` and surrounding space folded. */
const pathKey = p => String(p).trim().replace(/^(?:\.\/)+/, '')

/** The representative severity of findings of one identity, as the settle grouping picks it. */
function groupSeverity(members) {
  let rep = members[0]
  for (const m of members) if (SEVERITY_RANK(m.severity) < SEVERITY_RANK(rep.severity)) rep = m
  return normalizeSeverity(rep.severity)
}

/**
 * Which `preExisting` marks hold: a mark is confirmed only when the finding has a file and
 * a line and that line is outside every changed range of its file, or the file is not in the
 * diff. Findings of one identity are confirmed only when every one of them is marked and
 * confirmed. A mark on a finding whose severity is not a blocker or a warning changes no
 * weight, so it is neither confirmed nor refused. `ranges` null (the diff could not be read)
 * confirms nothing.
 *
 * @param {Array<object>} findings  the record's surviving findings, before they are grouped
 * @param {Array<{ path: string, ranges: Array<[number, number]> }>|null} ranges  what `changedRanges` returns
 * @returns {{ confirmed: string[], refused: Array<{ id: string, reason: string }> }}
 */
export function confirmPreExisting(findings, ranges) {
  const confirmed = []
  const refused = []
  if (!Array.isArray(ranges)) return { confirmed, refused }
  const byPath = new Map()
  for (const entry of ranges) {
    if (entry && typeof entry.path === 'string') byPath.set(pathKey(entry.path), Array.isArray(entry.ranges) ? entry.ranges : [])
  }
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
      if (m.preExisting !== true) {
        reason = 'another finding of the same identity carries no pre-existing mark'
        break
      }
      if (typeof m.file !== 'string' || !m.file.trim()) {
        reason = 'the finding names no file'
        break
      }
      if (!Number.isFinite(m.line)) {
        reason = `the finding names ${m.file} and no line`
        break
      }
      const changed = byPath.get(pathKey(m.file))
      if (changed && changed.some(r => Array.isArray(r) && m.line >= r[0] && m.line <= r[1])) {
        reason = `line ${m.line} of ${m.file} is a line the pull request changes`
        break
      }
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

/**
 * The comment text.
 *
 * @param {{ head: string, findings: Array<object>, proof: object|null, runCode: boolean, confirmed: string[] }} given
 *   `findings` one per identity (the settle grouping), `confirmed` the ids `confirmPreExisting` confirmed
 * @returns {string}
 */
export function renderReviewerComment({ head, findings = [], proof = null, runCode = false, confirmed = [] }) {
  const list = (Array.isArray(findings) ? findings : []).filter(f => f && typeof f === 'object' && !Array.isArray(f))
  const weighed = list.map((f, i) => ({ f, i, weight: weightOf(f, confirmed) }))
  const important = weighed.filter(w => w.weight === 'Important').sort((a, b) => SEVERITY_RANK(a.f.severity) - SEVERITY_RANK(b.f.severity) || a.i - b.i)
  const preExisting = weighed.filter(w => w.weight === 'Pre-existing')
  const nits = weighed.filter(w => w.weight === 'Nit')
  const inTable = { inTable: true }

  const tableOf = ws => [
    '| Id | Weight | Location | Finding |',
    '| --- | --- | --- | --- |',
    ...ws.map(({ f, weight }) => `| ${findingId(f)} | ${weight} | ${inertSpan(placeOf(f), inTable)} | ${inertSpan(titleOf(f), inTable)} |`),
    ''
  ]
  const bodiesOf = ws =>
    ws.flatMap(({ f, weight }) => [
      `**${findingId(f)}** (${weight}) ${inertSpan(placeOf(f))} — ${inertSpan(titleOf(f))}`,
      ...(typeof f.description === 'string' && f.description.trim() ? ['', ...fenced(f.description.trim())] : []),
      ...(typeof f.suggestion === 'string' && f.suggestion.trim() ? ['', 'Proposed fix:', ...fenced(f.suggestion.trim())] : []),
      ''
    ])
  const lead = [...important, ...preExisting]
  const collapsed = nits.length
    ? ['<details>', `<summary>${nits.length} nit${nits.length === 1 ? '' : 's'}</summary>`, '', ...tableOf(nits), ...bodiesOf(nits), '</details>', '']
    : []

  return [
    `## Automated review — ${head}`,
    '',
    ...(list.length ? [...(lead.length ? [...tableOf(lead), ...bodiesOf(lead)] : []), ...collapsed] : ['The automated review raised no surviving finding.', '']),
    proofParagraph(proof),
    '',
    runCode === true ? RAN_CODE_LINE : RAN_NOTHING_LINE,
    '',
    NOT_AN_APPROVAL_LINE,
    ''
  ].join('\n')
}
