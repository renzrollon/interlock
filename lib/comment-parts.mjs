// The parts of a review comment that `interlock settle comment` and `interlock review
// comment` share: one finding per identity, the place and title of a finding, a severity
// rendered inert when it is not one of ours, reviewer prose in a fence it cannot close,
// the identity-bearing summary, and the gaps of a proof that does not hold. Moved here
// from lib/settle-cli.mjs (review-a-teammates-pull-request-read-only D28) so the two
// comments render reviewer text with the same code, never with a copy of it.
//
// Pure: a record and its findings in, text and objects out.

import { SEVERITIES, findingId, findingKey, normalizeSeverity } from './findings.mjs'
import { inertSpan } from './merge-confidence.mjs'
import { gapLines, proofCounts } from './review-proof.mjs'

export const isObject = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export const SEVERITY_RANK = sev => {
  const i = SEVERITIES.indexOf(normalizeSeverity(sev))
  return i < 0 ? SEVERITIES.length : i
}

export const scoresOf = f => [
  ...(Array.isArray(f.qualityScores) ? f.qualityScores : []),
  ...(f.qualityScore === undefined ? [] : [f.qualityScore])
]

/**
 * The record's surviving findings, one per identity: findings with one key are
 * one finding, kept at the highest severity any of them carries. The
 * representative is the member with the highest normalised severity (the first
 * of them on a tie), its severity canonicalised when it is one of ours. A
 * merged group pools every member's quality scores, as the tolerance band
 * pools repeated entries, so merging cannot drop a finding the band would have
 * kept. Order is the order each key first appears.
 */
export function survivingOf(record) {
  const groups = new Map()
  for (const f of record.surviving) {
    if (!isObject(f)) continue
    const key = findingKey(f)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  return [...groups.values()].map(members => {
    let rep = members[0]
    for (const m of members) if (SEVERITY_RANK(m.severity) < SEVERITY_RANK(rep.severity)) rep = m
    const severity = normalizeSeverity(rep.severity)
    const out = severity === null || severity === rep.severity ? { ...rep } : { ...rep, severity }
    if (members.length > 1) {
      const pooled = members.flatMap(scoresOf)
      delete out.qualityScore
      if (pooled.length) out.qualityScores = pooled
      else delete out.qualityScores
    }
    return out
  })
}

export const placeOf = f => {
  const file = typeof f.file === 'string' && f.file.trim() ? f.file : '(unscoped)'
  return Number.isFinite(f.line) ? `${file}:${f.line}` : file
}
export const titleOf = f => (typeof f.title === 'string' && f.title.trim() ? f.title : '(untitled)')

/** A known severity as itself; anything else is reviewer text, so it is quoted inert. */
export const severityOf = (f, opts) =>
  SEVERITIES.includes(f.severity) ? f.severity : inertSpan(typeof f.severity === 'string' ? f.severity : '(missing)', opts)

/**
 * Reviewer prose in a backtick fence longer than any backtick run inside it
 * (at least three), so no line of the text can close it early.
 */
export function fenced(text) {
  const runs = text.match(/`+/g) || []
  const fence = '`'.repeat(Math.max(3, ...runs.map(r => r.length + 1)))
  return [fence, text, fence]
}

/** The identity-bearing summary a comment and a reply table both list. */
export const summaryOf = f => ({
  id: findingId(f),
  key: findingKey(f),
  severity: typeof f.severity === 'string' ? f.severity : null,
  file: typeof f.file === 'string' ? f.file : null,
  line: Number.isFinite(f.line) ? f.line : null,
  title: typeof f.title === 'string' ? f.title : null
})

/** The gaps of a proof that does not hold, in one clause, each name in an inert span. */
export function notProvenGaps(proof) {
  if (!proof) return 'the review record carries no proof of coverage; re-run the review on this version'
  const lines = gapLines(proof)
  return `${proofCounts(proof)}: ${lines.map(l => inertSpan(l)).join('; ') || inertSpan(proof.reason || 'gaps in coverage')}`
}
