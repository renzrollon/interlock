// The compound-notes table: what a review found that the spec never said, kept
// as one row per surprise so the next spec that touches the same file is told.
//
// A sibling of the decision ledger (`lib/ledger.mjs`): the same table dialect
// through `lib/md-table.mjs`, the same paranoia. A row that cannot be read is
// collected under `problems` with its line number — never read as a note and
// never lost — and a table nobody can read reports `parseable: false` rather
// than coming back empty. A machine appends to the file and never edits it, so
// an unreadable row survives every append untouched.
//
// Pure except for `appendNotes`, the one function that touches a file. The
// contract is `shared/COMPOUND-NOTES.md`; the committed home is `NOTES_PATH`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { escapeCell, isSeparatorRow, splitRow } from './md-table.mjs'
import { canonicalizePath } from './risk.mjs'
import { LIMITS } from './limits.mjs'

/** Where the table is committed, relative to the repository root. */
export const NOTES_PATH = 'docs/notes/compound.md'

/** The seven columns, in order. Tooling depends on them. */
export const COLUMNS = Object.freeze(['id', 'date', 'change', 'file', 'surprise', 'rule', 'source'])

const HEADING = '# Compound notes'

const isEmpty = s => s === ''

const cellText = value => String(value ?? '').replace(/\s+/g, ' ').trim()

const rowLine = row => `| ${COLUMNS.map(c => escapeCell(row[c], isEmpty)).join(' | ')} |`

const headerLines = () => [
  `| ${COLUMNS.join(' | ')} |`,
  `|${COLUMNS.map(c => '-'.repeat(c.length + 2)).join('|')}|`
]

function isHeaderCells(cells) {
  return (
    cells.length === COLUMNS.length &&
    cells.every((c, i) => c.toLowerCase() === COLUMNS[i])
  )
}

/**
 * Read a notes table.
 *
 * @param {string} text
 * @returns {{ parseable: boolean,
 *             rows: Array<Record<string,string>>,
 *             problems: Array<{ line: number, reason: string }> }}
 */
export function parseNotes(text) {
  const rows = []
  const problems = []
  const lines = String(text ?? '').split(/\r?\n/)
  let header = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|') && isHeaderCells(splitRow(lines[i]))) {
      header = i
      break
    }
  }
  if (header < 0) {
    return {
      parseable: false,
      rows,
      problems: [{ line: 1, reason: `no header row (${COLUMNS.join(' | ')}) — the table cannot be read` }]
    }
  }

  const seen = new Set()
  for (let i = header + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.includes('|')) continue
    const cells = splitRow(raw)
    if (isSeparatorRow(cells)) continue
    const line = i + 1
    if (cells.length !== COLUMNS.length) {
      problems.push({ line, reason: `expected ${COLUMNS.length} cells, found ${cells.length}` })
      continue
    }
    const row = {}
    COLUMNS.forEach((c, k) => {
      row[c] = cells[k] === '—' ? '' : cells[k]
    })
    const missing = ['id', 'file', 'rule'].find(c => !row[c])
    if (missing) {
      problems.push({ line, reason: `missing ${missing}` })
      continue
    }
    if (seen.has(row.id)) {
      problems.push({ line, reason: `repeated id ${row.id}` })
      continue
    }
    seen.add(row.id)
    rows.push(row)
  }
  return { parseable: true, rows, problems }
}

/** Render a whole table: heading, header row, separator, one line per row. */
export function renderNotes(rows) {
  return [HEADING, '', ...headerLines(), ...(rows ?? []).map(rowLine), ''].join('\n')
}

const idNumber = id => {
  const m = /^N(\d+)$/.exec(String(id))
  return m ? Number(m[1]) : 0
}

const dedupeKey = r => [r.change, r.file, r.rule].map(cellText).join('\u0000')

/**
 * Append rows to the table under `root`, creating it when absent. A row whose
 * change, file and rule are already present (or earlier in the batch) is
 * skipped. Ids are assigned here — one past the highest present — and any id
 * the caller wrote is ignored. Existing text is never rewritten, so a row the
 * parser could not read survives. Zero new rows touches nothing.
 *
 * Throws when the existing file has no readable table: appending to it would
 * bury the rows under a header nobody can find.
 *
 * @returns {{ appended: number, skipped: number, path: string }}
 */
export function appendNotes(root, rows, { date } = {}) {
  const abs = join(root, NOTES_PATH)
  const exists = existsSync(abs)
  const text = exists ? readFileSync(abs, 'utf8') : ''
  const parsed = exists ? parseNotes(text) : { parseable: true, rows: [], problems: [] }
  if (!parsed.parseable) {
    throw new Error(`${NOTES_PATH}: ${parsed.problems.map(p => p.reason).join('; ')}`)
  }

  const seen = new Set(parsed.rows.map(dedupeKey))
  let next = parsed.rows.reduce((n, r) => Math.max(n, idNumber(r.id)), 0)
  const today = date || new Date().toISOString().slice(0, 10)
  const fresh = []
  let skipped = 0
  for (const incoming of rows ?? []) {
    const key = dedupeKey(incoming)
    if (seen.has(key)) {
      skipped++
      continue
    }
    seen.add(key)
    next++
    fresh.push({
      id: `N${next}`,
      date: incoming.date || today,
      change: incoming.change,
      file: incoming.file,
      surprise: incoming.surprise,
      rule: incoming.rule,
      source: incoming.source
    })
  }
  if (fresh.length === 0) return { appended: 0, skipped, path: NOTES_PATH }

  mkdirSync(dirname(abs), { recursive: true })
  if (!exists) {
    writeFileSync(abs, renderNotes(fresh))
  } else {
    const lead = text === '' || text.endsWith('\n') ? text : text + '\n'
    writeFileSync(abs, lead + fresh.map(rowLine).join('\n') + '\n')
  }
  return { appended: fresh.length, skipped, path: NOTES_PATH }
}

/** The first sentence of a description, as written. */
function firstSentence(text) {
  const t = String(text ?? '').trim()
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(t)
  return (m ? m[0] : t).trim()
}

/**
 * One note per surviving finding whose `specGap` is exactly `true`. The rule is
 * the finding's `suggestion`, else its description's first sentence, as-is for
 * a person to reword. A finding with no file or no rule cannot be a note.
 *
 * @returns {Array<{date: string, change: string, file: string,
 *                  surprise: string, rule: string, source: string}>}
 */
export function deriveNotes(findings, { change, source, date } = {}) {
  const out = []
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || f.specGap !== true) continue
    const suggestion = typeof f.suggestion === 'string' ? f.suggestion.trim() : ''
    const rule = suggestion || firstSentence(f.description)
    const file = typeof f.file === 'string' ? f.file.trim() : ''
    if (!rule || !file) continue
    out.push({
      date,
      change,
      file,
      surprise: typeof f.title === 'string' ? f.title : '',
      rule,
      source
    })
  }
  return out
}

/**
 * The rows whose canonical `file` is one of `paths` (also canonicalised), in
 * table order, cut whole at the cap with the omitted count named.
 *
 * @returns {{ rows: Array<Record<string,string>>, omitted: number }}
 */
export function matchNotes(rows, paths, limits = LIMITS) {
  const wanted = new Set((paths ?? []).map(canonicalizePath).filter(Boolean))
  if (wanted.size === 0) return { rows: [], omitted: 0 }
  const hits = (rows ?? []).filter(r => wanted.has(canonicalizePath(r.file)))
  const cap = limits.maxAdvisorNoteRows ?? LIMITS.maxAdvisorNoteRows
  return { rows: hits.slice(0, cap), omitted: Math.max(0, hits.length - cap) }
}
