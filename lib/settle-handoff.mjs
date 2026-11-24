// The citation rule behind `interlock settle handoff-check`.
//
// A confirmation read green on the worker's say-so alone: five self-reported
// counts and a paragraph. This module checks the reply against the record the
// briefing kept, one row per briefed id, and reads a row `confirmed` only when
// its citation names a file and a line that exist and is not the requirement's
// own text (design D10). The rule is mechanical on purpose: it cannot tell a
// relevant citation from an irrelevant one, and does not try.
//
// Pure: no `node:` import, no I/O. The caller supplies `lineCount(path)`, which
// answers how many lines a file has, or null when it does not exist. The path
// half of a citation goes through the shared `canonicalizePath`; the anchoring
// is this module's own (a trailing `:column` and a leading `./` are accepted).

import { canonicalizePath } from './locators.mjs'

export const REASONS = Object.freeze([
  'no row',
  'more than one row',
  'not confirmed by the worker',
  'no citation',
  'cited file not found',
  'cited line not in the file',
  "the citation is the requirement's own text"
])

const CITE = /^(\S+?):(\d+)(?:-(\d+))?(?::\d+)?$/

function judge(rows, dir, lineCount) {
  if (!rows.length) return { reason: 'no row', claimed: null, cite: null }
  const first = rows[0]
  const claimed = typeof first.status === 'string' ? first.status : null
  const cite = typeof first.cite === 'string' ? first.cite : null
  if (rows.length > 1) return { reason: 'more than one row', claimed: null, cite }
  if (claimed !== 'confirmed') return { reason: 'not confirmed by the worker', claimed, cite }
  const m = cite === null ? null : CITE.exec(cite.trim())
  if (!m) return { reason: 'no citation', claimed, cite }
  const path = canonicalizePath(m[1])
  const total = path === null ? null : lineCount(path)
  if (path === null || typeof total !== 'number') return { reason: 'cited file not found', claimed, cite }
  const start = Number(m[2])
  const end = m[3] === undefined ? start : Number(m[3])
  if (start < 1 || end < start || end > total) return { reason: 'cited line not in the file', claimed, cite }
  // Compared without regard to case: on a case-insensitive file system (the macOS
  // default) `OpenSpec/specs/x` opens the same file, and the stricter reading is
  // the safe one, since a row read as own text confirms nothing.
  const folded = path.toLowerCase()
  const home = typeof dir === 'string' && dir !== '' ? `${dir.replace(/\/+$/, '').toLowerCase()}/` : null
  const own = folded.startsWith('openspec/specs/') || (home !== null && folded.startsWith(home))
  if (own) return { reason: "the citation is the requirement's own text", claimed, cite }
  return { reason: null, claimed, cite }
}

/**
 * @param {{brief: object, reply: object, lineCount: (path: string) => number|null}} input
 * @returns {{handoff: object, lines: string[]}}
 */
export function checkHandoff({ brief, reply, lineCount }) {
  const living = brief?.living ?? {}
  const livingBuilt = !living.skipped
  const replyRows = Array.isArray(reply?.rows) ? reply.rows.filter(r => r && typeof r === 'object') : []

  const entries = [
    ...(brief?.scenarios ?? []).map(s => ({ kind: 'scenario', ...s })),
    ...(livingBuilt ? (living.requirements ?? []).map(r => ({ kind: 'requirement', ...r })) : [])
  ]
  const briefed = new Set(entries.map(e => e.id))

  const rows = entries.map(e => {
    const mine = replyRows.filter(r => r.id === e.id)
    const j = judge(mine, brief?.dir, lineCount)
    return {
      id: e.id,
      kind: e.kind,
      title: e.title,
      artifact: e.artifact,
      line: e.line,
      claimed: j.claimed,
      status: j.reason === null ? 'confirmed' : 'unconfirmed',
      cite: j.cite,
      reason: j.reason
    }
  })
  const unknownRows = replyRows.filter(r => !briefed.has(r.id))

  const count = kind => {
    const mine = rows.filter(r => r.kind === kind)
    return { checked: mine.filter(r => r.reason !== 'no row').length, unconfirmed: mine.filter(r => r.status !== 'confirmed').length }
  }
  const sc = count('scenario')
  const rq = count('requirement')

  const handoff = {
    ok: true,
    checked: true,
    head: reply?.head,
    detail: reply?.detail,
    scenariosChecked: sc.checked,
    scenariosUnconfirmed: sc.unconfirmed,
    requirementsChecked: rq.checked,
    requirementsUnconfirmed: rq.unconfirmed,
    claimed: {
      scenariosChecked: reply?.scenariosChecked,
      scenariosUnconfirmed: reply?.scenariosUnconfirmed,
      requirementsChecked: reply?.requirementsChecked,
      requirementsUnconfirmed: reply?.requirementsUnconfirmed
    },
    rows,
    living: { skipped: living.skipped ?? null, partial: living.partial ?? null, omitted: Array.isArray(living.omitted) ? living.omitted.length : 0 },
    unknownRows
  }

  const lines = [
    `Handoff checked: ${sc.checked} of ${(brief?.scenarios ?? []).length} scenarios with a row, ${sc.unconfirmed} unconfirmed; ${rq.checked} of ${rows.filter(r => r.kind === 'requirement').length} living requirements with a row, ${rq.unconfirmed} unconfirmed`
  ]
  const refused = rows.filter(r => r.claimed === 'confirmed' && r.reason !== null)
  if (refused.length) lines.push(`CONFIRMATION NOT CITED: ${refused.map(r => `${r.id} (${r.reason})`).join('; ')}`)
  if (unknownRows.length) lines.push(`ROWS NOT BRIEFED: ${unknownRows.map(r => String(r.id)).join(', ')}`)
  return { handoff, lines }
}
