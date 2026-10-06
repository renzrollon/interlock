// The decision ledger for one OpenSpec change (§F2).
//
// Explore and spec both hit ambiguities. Historically those were resolved in
// chat — which means they were resolved nowhere, because chat is not an
// artifact and the next agent (or the next context window) never sees it. The
// continuity gate needs a durable answer to one question: "is there anything
// left here that only a human can decide?" That answer has to survive a
// /clear, so it lives on disk next to the change, versioned with it:
//
//   openspec/changes/<name>/decisions.md        (§4.13 option (a))
//
// Two classes exist and only two: `needs_human` and `agent_resolved`.
//
// The load-bearing rule is that `agent_resolved` is a *claim*, and this module
// audits it. A row that says agent_resolved but carries no written resolution
// or no evidence is an agent asserting it decided something without saying
// what it decided or why. That row is INVALID and is treated as unresolved —
// it blocks continuity exactly like a `needs_human` row. Without that check
// the entire gate can be defeated by writing the word "agent_resolved".
//
// Parsing is correspondingly paranoid. A ledger that cannot be read must never
// come back looking empty, because an empty ledger reads as "nothing needs a
// human". So malformed rows are *collected*, never dropped and never thrown:
// anything unparseable lands in `invalid`, and anything in `invalid` blocks.
//
// Structure: parseLedger/serializeLedger/summarize/formatLedger are pure and
// testable with no filesystem; readLedger/writeLedger are thin fs wrappers
// over them. Path resolution is delegated to artifacts.mjs so there is one
// definition of where a change lives.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inspectChange } from './artifacts.mjs'

export const LEDGER_FILE = 'decisions.md'

/** The only two classes. Anything else is a malformed row. */
export const NEEDS_HUMAN = 'needs_human'
export const AGENT_RESOLVED = 'agent_resolved'
export const DECISION_CLASSES = Object.freeze([NEEDS_HUMAN, AGENT_RESOLVED])

export const COLUMNS = Object.freeze(['id', 'question', 'class', 'resolution', 'evidence'])

// Placeholders that mean "no value". Real ledgers are hand-edited, so all the
// dashes people actually type are accepted, and so are the hedges that mean
// the same thing as blank.
//
// The hedges are here because shared/DECISION-LEDGER.md already lists them as
// "not evidence": `obvious`, `standard practice`, `see above`. A cell claiming
// the answer is self-evident is a cell that gives no evidence, and the whole
// point of the audit is that saying `agent_resolved` is not deciding anything.
// Matched after the existing lowercase-and-trim, plus an optional trailing
// period — "Obvious." is the same non-answer as "obvious".
const EMPTY_MARKERS = new Set([
  '',
  '-',
  '--',
  '---',
  '—',
  '–',
  'n/a',
  'na',
  'tbd',
  '?',
  'obvious',
  'self-evident',
  'self evident',
  'standard practice',
  'common sense',
  'see above',
  'as discussed',
  'n a'
])

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

// --- pure parsing --------------------------------------------------------

/**
 * True when a cell carries no value: blank, a dash placeholder, or a hedge
 * that asserts nothing.
 *
 * The match is on the WHOLE cell. A cell that merely contains a rejected word
 * inside a longer, substantive citation — "lib/session.ts:42 — the obvious
 * existing helper" — is real evidence and is accepted.
 */
export function isEmptyCell(value) {
  const folded = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  return EMPTY_MARKERS.has(folded) || EMPTY_MARKERS.has(folded.replace(/\s+/g, ' '))
}

// Split one markdown table row into cells. Tolerates a missing leading or
// trailing pipe and any amount of padding. '\|' is an escaped literal pipe.
function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1)
  return s
    .split(/(?<!\\)\|/)
    .map(c => c.replace(/\\\|/g, '|').trim())
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c))
}

function isHeaderRow(cells) {
  return cells.length >= 2 && cells[0].toLowerCase() === 'id' && cells[1].toLowerCase() === 'question'
}

// Tolerate "needs human", "Needs-Human", "AGENT_RESOLVED".
function normalizeClass(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

const HEADING = /^#\s*Decisions\s*[—–:-]\s*(.+?)\s*$/

/**
 * Does `id` appear as a token in the design document?
 *
 * A token, not a heading: shared/DECISION-LEDGER.md does not constrain *where*
 * in design.md a decision is recorded, so requiring a heading would invalidate
 * ledgers that comply with the documented contract. Token-bounded so a
 * reference to `D2` is not satisfied by a design that only mentions `D21`.
 */
function referenceResolves(id, designText) {
  if (typeof designText !== 'string' || !designText.trim()) return false
  const token = String(id).trim()
  if (!token) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(designText)
}

/**
 * Parse a decisions.md body. Never throws.
 *
 * @param {string} text
 * @param {{designText?: string|null}} [opts]
 *   `designText` is the change's `design.md`. Supplying it turns on the
 *   reference audit shared/DECISION-LEDGER.md has always advertised: "every
 *   `agent_resolved` decision must also appear as a written assumption in
 *   design.md, referenced by id". Passing `null` means *the design document is
 *   absent or unreadable*, which makes every reference unresolvable — an
 *   unreadable design document is not one that contains every id. Omitting the
 *   argument entirely means "do not audit references", which is what keeps
 *   this function a pure parse for callers that only want the rows.
 * @returns {{
 *   change: string|null,
 *   parseable: boolean,
 *   rows: Array<{id,question,class,resolution,evidence,line,valid,problems}>,
 *   invalid: Array<{row, reason: string}>
 * }}
 */
export function parseLedger(text, opts = {}) {
  const body = typeof text === 'string' ? text : ''
  const lines = body.split('\n')
  const auditReferences = Object.prototype.hasOwnProperty.call(opts || {}, 'designText')
  const designText = opts ? opts.designText : undefined

  let change = null
  let sawTable = false
  const rows = []
  const invalid = []
  // A markdown table ends at a blank line. Tracking that lets a row omit its
  // leading pipe without prose elsewhere in the file being mistaken for a row.
  let inTable = false

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()

    if (!trimmed) {
      inTable = false
      continue
    }

    if (change === null) {
      const h = HEADING.exec(trimmed)
      if (h) {
        change = h[1].trim()
        continue
      }
    }

    const looksLikeRow = trimmed.startsWith('|') || (inTable && trimmed.includes('|'))
    if (!looksLikeRow) continue

    const cells = splitRow(trimmed)
    if (isSeparatorRow(cells)) {
      inTable = true
      sawTable = true
      continue
    }
    if (isHeaderRow(cells)) {
      inTable = true
      sawTable = true
      continue
    }
    inTable = true
    sawTable = true

    const problems = []
    if (cells.length !== COLUMNS.length) {
      problems.push(`expected ${COLUMNS.length} columns (${COLUMNS.join(', ')}), found ${cells.length}`)
    }

    const row = {
      id: cells[0] ?? '',
      question: cells[1] ?? '',
      class: normalizeClass(cells[2]),
      resolution: isEmptyCell(cells[3]) ? '' : cells[3],
      evidence: isEmptyCell(cells[4]) ? '' : cells[4],
      line: i + 1,
      raw: trimmed,
      valid: true,
      problems
    }

    if (isEmptyCell(row.id)) problems.push('row has no id')
    if (isEmptyCell(row.question)) problems.push('row has no question')

    if (!DECISION_CLASSES.includes(row.class)) {
      problems.push(
        row.class
          ? `unknown class "${cells[2]}" (expected ${DECISION_CLASSES.join(' or ')})`
          : `missing class (expected ${DECISION_CLASSES.join(' or ')})`
      )
    } else if (row.class === AGENT_RESOLVED) {
      // The audit. agent_resolved is a claim, not a fact.
      if (!row.resolution) problems.push('agent_resolved without a written resolution')
      if (!row.evidence) problems.push('agent_resolved without evidence')
      if (auditReferences && !referenceResolves(row.id, designText)) {
        problems.push(
          typeof designText === 'string' && designText.trim()
            ? `agent_resolved but "${row.id}" appears nowhere in design.md — ` +
              'the resolution must be recorded there, referenced by id'
            : `agent_resolved but design.md is absent or unreadable, so the reference ` +
              `"${row.id}" cannot be resolved`
        )
      }
    }

    row.valid = problems.length === 0
    rows.push(row)
    if (!row.valid) invalid.push({ row, reason: problems.join('; ') })
  }

  // A file with neither a heading nor a table is not an empty ledger — it is a
  // ledger nobody can read. Reported as such, because "empty" is exactly the
  // conclusion that clears the gate.
  const parseable = sawTable || change !== null
  return { change, parseable, rows, invalid }
}

/**
 * Render a ledger. Round-trips with parseLedger: serialize → parse → serialize
 * is stable. Empty cells become the em dash placeholder from the §F2 template.
 */
export function serializeLedger(change, rows) {
  const name = typeof change === 'string' && change.trim() ? change.trim() : 'unnamed-change'
  const list = Array.isArray(rows) ? rows : []
  const out = []
  out.push(`# Decisions — ${name}`)
  out.push('')
  out.push(`| ${COLUMNS.join(' | ')} |`)
  out.push(`|${COLUMNS.map(() => '----').join('|')}|`)
  for (const r of list) {
    const row = r && typeof r === 'object' ? r : {}
    out.push(
      '| ' +
        [
          cell(row.id),
          cell(row.question),
          cell(normalizeClass(row.class)),
          cell(row.resolution),
          cell(row.evidence)
        ].join(' | ') +
        ' |'
    )
  }
  out.push('')
  return out.join('\n')
}

// A cell never breaks the table: pipes are escaped, newlines collapse, and an
// absent value renders as the placeholder the template uses.
function cell(value) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (isEmptyCell(s)) return '—'
  return s.replace(/\|/g, '\\|')
}

/**
 * Roll a parsed ledger up into the numbers a gate acts on.
 *
 * `blocking` is true when anything remains that a human must touch: a
 * `needs_human` row, OR any invalid row — an unreadable or unsubstantiated row
 * is treated as unresolved, never as absent.
 */
export function summarize(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  const rows = Array.isArray(p.rows) ? p.rows : []
  const invalidList = Array.isArray(p.invalid) ? p.invalid : []

  const needsHuman = rows.filter(r => r.valid && r.class === NEEDS_HUMAN).length
  const agentResolved = rows.filter(r => r.valid && r.class === AGENT_RESOLVED).length
  const invalidCount = invalidList.length

  // `changeExists === false` means the change directory itself is absent, which
  // is never "nothing to decide" — it is a caller error, and clearing on it
  // would be the one fail-open this module cannot afford.
  const missingChange = p.changeExists === false

  // Three outcomes that must never collapse into each other, because two of
  // them read as "nothing needs a human" and only one of them means it:
  //   missing     — no decisions.md at all. A failure of the audit.
  //   unparseable — a file is there and nobody can read it.
  //   present and empty — a ledger with a heading and no rows.
  const exists = p.exists !== false
  const missing = !exists
  const unparseable = exists && p.parseable === false

  return {
    total: rows.length,
    needsHuman,
    agentResolved,
    // Count, not rows. `parseLedger`/`readLedger` return `invalid` as the rows
    // themselves; keeping both under one key made a merged object ambiguous.
    invalidCount,
    invalid: invalidCount,
    exists,
    missing,
    unparseable,
    changeExists: !missingChange,
    blocking: needsHuman > 0 || invalidCount > 0 || missingChange || missing || unparseable
  }
}

// --- filesystem wrappers -------------------------------------------------

/**
 * Absolute-from-root path of a change's ledger. Path resolution for the change
 * directory itself belongs to artifacts.mjs — do not rebuild it here.
 */
export function ledgerPath(root = '.', change) {
  if (typeof change !== 'string' || !change.trim()) fail('ledger requires a change name')
  return join(inspectChange(root, change).path, LEDGER_FILE)
}

/**
 * Read and parse a change's ledger. A missing file is `exists: false`, not a
 * throw — "no ledger yet" is a normal state early in a change.
 */
export function readLedger(root = '.', change) {
  const path = ledgerPath(root, change)
  // The design document is read HERE rather than inside parseLedger, which is
  // pure by contract. The path comes from artifacts.mjs (via ledgerPath) so
  // there is still one definition of where a change lives. `null` when it is
  // absent or unreadable — which makes every reference unresolvable, rather
  // than treating a document nobody could read as one containing every id.
  const designPath = join(dirname(path), 'design.md')
  let designText = null
  if (existsSync(designPath)) {
    try {
      designText = readFileSync(designPath, 'utf8')
    } catch {
      designText = null
    }
  }
  // A ledger missing because the change directory does not exist is a different
  // fact from a ledger missing because nobody wrote one, and the difference is
  // load-bearing: the readiness gate can skip a human, so a typo'd change name
  // must not read as "no decisions outstanding". `changeExists` lets the caller
  // tell the two apart; `summarize` refuses to clear a ledger for a change that
  // is not there.
  const changeExists = existsSync(dirname(path))
  if (!existsSync(path)) {
    return { exists: false, parseable: false, changeExists, path, change, rows: [], invalid: [] }
  }
  const parsed = parseLedger(readFileSync(path, 'utf8'), { designText })
  return {
    exists: true,
    parseable: parsed.parseable,
    changeExists: true,
    path,
    designPath,
    designExists: designText !== null,
    change: parsed.change || change,
    rows: parsed.rows,
    invalid: parsed.invalid
  }
}

/** Write (or replace) a change's ledger. Creates the change directory if needed. */
export function writeLedger(root = '.', change, rows) {
  const path = ledgerPath(root, change)
  if (!Array.isArray(rows)) fail('writeLedger requires a rows array')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serializeLedger(change, rows), 'utf8')
  return { path }
}

// --- formatting ----------------------------------------------------------

/** Human-readable ledger status, for a skill to echo at a checkpoint. */
export function formatLedger(parsed) {
  const s = summarize(parsed)
  const lines = []
  // "MISSING" and "0 row(s)" are different facts and are printed differently.
  // An absent ledger reads as "nothing needs a human" only if you assume
  // explore and spec had nothing to record; under fail-closed it reads as
  // "unknown", and the audit says so rather than reporting an empty result.
  if (parsed && parsed.exists === false) {
    lines.push(
      `DECISIONS MISSING — no ${LEDGER_FILE}${parsed.path ? ` at ${parsed.path}` : ''} ` +
        `(missing, not empty — nothing here proves no human is needed)`
    )
    return lines.join('\n') + '\n'
  }
  if (s.unparseable) {
    lines.push(
      `DECISIONS UNPARSEABLE — ${LEDGER_FILE} is present but carries no readable decision table ` +
        `(unparseable, not empty)`
    )
    return lines.join('\n') + '\n'
  }
  lines.push(
    `DECISIONS ${s.blocking ? 'BLOCKING' : 'CLEAR'} — ${s.total} row(s): ` +
      `${s.needsHuman} needs_human, ${s.agentResolved} agent_resolved, ${s.invalid} invalid`
  )
  for (const r of parsed?.rows ?? []) {
    if (r.valid && r.class === NEEDS_HUMAN) lines.push(`  [needs_human] ${r.id}: ${r.question}`)
  }
  for (const { row, reason } of parsed?.invalid ?? []) {
    lines.push(`  [invalid] ${row.id || `line ${row.line}`}: ${reason}`)
  }
  return lines.join('\n') + '\n'
}
