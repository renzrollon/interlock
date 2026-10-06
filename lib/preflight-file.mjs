// The session start's report file: what `hooks/preflight.mjs` leaves in
// `.claude/ship/preflight.json`, and every line the hooks module draws from it
// (show-preflight-and-interrupted-runs-at-session-start design D1, D5-D8).
//
// Two readers of one shape. The hook builds the report from what it already
// holds: the doctor's verdict and checks, the interrupted-run notes it spoke
// and marked, the halt resume cards it listed. The hooks module reads it at a
// prompt the person submits and draws the `AbovePrompt` band and two panes.
// Neither side derives a fact the other did not say: every word drawn is the
// doctor's, the hook's or the card's, and the time is a date, never a
// staleness verdict.
//
// Node-free, and importing only `./limits.mjs`, because the hooks module runs
// in the engine with no Node (test/spine/mod-pins.test.mjs walks it). The
// handoff pane's cap is read here and restated nowhere in the module.

import { LIMITS } from './limits.mjs'

/** Bump when the report's shape changes, so a reader can tell an older one. */
export const PREFLIGHT_SCHEMA = 'interlock.preflight/1'

/** Where the report lands, relative to the working root. Already gitignored with `.claude/ship/`. */
export const PREFLIGHT_FILE = '.claude/ship/preflight.json'

/** The most characters of a card the handoff pane renders: the `Markdown` element's own bound (design D7). */
export const HANDOFF_PANE_CHARS = LIMITS.handoffPaneChars

/** The SessionStart sources the host names; anything else is recorded as null. */
const SOURCES = new Set(['startup', 'resume', 'clear', 'compact'])

const str = v => (typeof v === 'string' && v ? v : null)
const text = v => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])
const count = v => (Number.isInteger(v) && v >= 0 ? v : 0)

/** The report file's path under `cwd`, or the relative path the engine resolves under the session's directory. */
export function preflightFilePath(cwd) {
  if (typeof cwd !== 'string' || !cwd) return PREFLIGHT_FILE
  return `${cwd.endsWith('/') ? cwd.slice(0, -1) : cwd}/${PREFLIGHT_FILE}`
}

function doctorOf(d) {
  const doctor = d && typeof d === 'object' ? d : {}
  const counts =
    doctor.counts && typeof doctor.counts === 'object'
      ? Object.fromEntries(['ok', 'warn', 'fail', 'skip'].map(k => [k, count(doctor.counts[k])]))
      : null
  return {
    ran: doctor.ran === true,
    parsed: doctor.parsed === true,
    ok: typeof doctor.ok === 'boolean' ? doctor.ok : null,
    counts,
    // `evidence` is not copied: no reader draws it, and the module reads the file whole.
    checks: list(doctor.checks).map(c => ({ id: text(c.id), status: text(c.status), detail: text(c.detail), fix: str(c.fix) }))
  }
}

function notesOf(n) {
  const notes = n && typeof n === 'object' ? n : {}
  return {
    spoken: list(notes.spoken).map(s => ({
      runId: text(s.runId),
      change: str(s.change),
      stage: str(s.stage),
      banner: text(s.banner),
      marked: s.marked === true,
      marks: list(s.marks).map(m => ({ root: text(m.root), marked: m.marked === true, reason: str(m.reason) }))
    })),
    unreadable: list(notes.unreadable).map(u => ({ file: text(u.file), reason: text(u.reason) }))
  }
}

function cardsOf(c) {
  const cards = c && typeof c === 'object' ? c : {}
  return {
    listed: list(cards.listed).map(k => ({ path: text(k.path), change: text(k.change), runId: text(k.runId), writtenAt: str(k.writtenAt) })),
    archived: count(cards.archived),
    unreadable: list(cards.unreadable).map(u => ({ path: text(u.path), reason: text(u.reason) })),
    lookedIn: Array.isArray(cards.lookedIn) ? cards.lookedIn.filter(d => typeof d === 'string' && d) : []
  }
}

/**
 * The report, every field present: an absent fact is `null` or `[]`, never
 * omitted (design D1). Pure: the caller passes the time it wrote at.
 */
export function buildPreflightReport(input) {
  const i = input && typeof input === 'object' ? input : {}
  return {
    schema: PREFLIGHT_SCHEMA,
    writtenAt: str(i.writtenAt),
    source: SOURCES.has(i.source) ? i.source : null,
    root: str(i.root),
    stateHome: str(i.stateHome),
    surface: str(i.surface),
    message: typeof i.message === 'string' ? i.message : null,
    doctor: doctorOf(i.doctor),
    notes: notesOf(i.notes),
    cards: cardsOf(i.cards)
  }
}

/** `{ report }` from the file's text, or `{ problem }` naming why there is none. */
export function readPreflightReport(raw) {
  if (typeof raw !== 'string') return { problem: `not text: the read returned ${raw === null ? 'null' : typeof raw}` }
  let value
  try {
    value = JSON.parse(raw)
  } catch (err) {
    return { problem: `not JSON: ${(err && err.message) || err}` }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: 'not an object' }
  if (value.schema !== PREFLIGHT_SCHEMA) return { problem: `stamped ${JSON.stringify(value.schema)}, not ${PREFLIGHT_SCHEMA}` }
  return { report: buildPreflightReport(value) }
}

const flagged = report => report.doctor.checks.filter(c => c.status === 'fail' || c.status === 'warn')

/** Whether the band has anything to say: a fail or warn check, a doctor that did not run or parse, a spoken note, a card. */
export function shouldDraw(report) {
  return (
    flagged(report).length > 0 ||
    !report.doctor.ran ||
    !report.doctor.parsed ||
    report.notes.spoken.length > 0 ||
    report.cards.listed.length > 0
  )
}

/** One listed card's line: where it is, which change and run, when it was written. */
export function cardLine(card) {
  return `${card.path} · ${card.change} · run ${card.runId} · written ${card.writtenAt || 'at an unknown time'}`
}

/** The listed cards, newest written first; equal or unknown times keep the listing's order. */
export function orderCards(report) {
  const at = c => {
    const t = Date.parse(c.writtenAt)
    return Number.isNaN(t) ? -Infinity : t
  }
  return report.cards.listed
    .map((card, i) => ({ card, i }))
    .sort((a, b) => at(b.card) - at(a.card) || a.i - b.i)
    .map(x => x.card)
}

const writtenLine = report => `preflight written ${report.writtenAt || 'at an unknown time'}`

/**
 * The band's lines, in order (design D6): the message's first line, each
 * `fail` or `warn` check in the doctor's words, each spoken note's banner,
 * each card with the command that shows it, and when the report was written.
 * Empty when there is nothing to say.
 */
export function bandLines(report) {
  if (!shouldDraw(report)) return []
  const lines = []
  const first = (report.message || '').split('\n')[0]
  if (first) lines.push(first)
  for (const c of flagged(report)) lines.push(`${c.status} ${c.id}: ${c.detail}`)
  for (const n of report.notes.spoken) lines.push(n.banner)
  for (const card of orderCards(report)) lines.push(`${cardLine(card)} — /interlock-handoff`)
  lines.push(`${writtenLine(report)} · /interlock-preflight`)
  return lines
}

/**
 * The `/interlock-preflight` pane's lines: the message verbatim, every check
 * with its fix lines indented as the hook prints them, the notes spoken at
 * this session start with each root's mark, the cards and what was not
 * listed, and every note and card the hook could not read. No empty line.
 */
export function preflightPaneLines(report) {
  const lines = []
  for (const line of (report.message || '').split('\n')) if (line) lines.push(line)
  lines.push(writtenLine(report))

  lines.push(report.doctor.ran ? (report.doctor.parsed ? 'checks' : 'checks: the doctor ran and its output could not be parsed') : 'checks: the doctor did not run')
  for (const c of report.doctor.checks) {
    lines.push(`${c.status} ${c.id}: ${c.detail}`)
    if (c.fix) {
      const [first, ...rest] = c.fix.split('\n')
      lines.push(`     fix: ${first}`)
      for (const more of rest) if (more.trim()) lines.push(`          ${more.trim()}`)
    }
  }

  lines.push(report.notes.spoken.length ? 'interrupted runs spoken at this session start' : 'no interrupted run was spoken at this session start')
  for (const n of report.notes.spoken) {
    lines.push(n.banner)
    for (const m of n.marks) lines.push(m.marked ? `  marked · ${m.root}` : `  not marked: ${m.reason || 'no reason given'}`)
  }
  for (const u of report.notes.unreadable) lines.push(`note unreadable: ${u.file}: ${u.reason}`)

  const ordered = orderCards(report)
  lines.push(ordered.length ? 'halt resume cards — /interlock-handoff' : 'no halt resume card is on disk for an open change')
  for (const card of ordered) lines.push(cardLine(card))
  if (report.cards.archived) lines.push(`${report.cards.archived} card(s) of archived changes not listed`)
  for (const u of report.cards.unreadable) lines.push(`card unreadable: ${u.path}: ${u.reason}`)
  for (const dir of report.cards.lookedIn) lines.push(`looked in: ${dir}`)
  return lines
}

/** What a pane says with no report held: the file's path and why, or that it has not been read yet. */
export function noReportText(path, problem) {
  return `no preflight report is held for this session start: ${path}: ${problem || 'not read yet'}`
}

/** What the handoff pane says with a report and no card: that, and every directory looked in. */
export function noCardText(report) {
  return ['no halt resume card is on disk for an open change', ...report.cards.lookedIn.map(dir => `looked in: ${dir}`)]
}

// Every control character but tab and newline: the `Markdown` element refuses them.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

/**
 * A card's text as the handoff pane renders it: control characters made
 * spaces, and when longer than `cap`, cut so that the text and a note naming
 * the characters left out and the card's path fit within `cap` (design D7).
 */
export function clampCard(raw, path, cap = LIMITS.handoffPaneChars) {
  const clean = text(raw).replace(CONTROL, ' ')
  if (clean.length <= cap) return { text: clean, cut: 0 }
  const note = n => `\n\n_… ${n} characters left out; the whole card is ${path}_`
  // The note for the whole text is the longest the note can be, so the kept head plus any shorter note still fits.
  let keep = Math.max(0, cap - note(clean.length).length)
  const code = clean.charCodeAt(keep - 1)
  if (keep > 0 && code >= 0xd800 && code <= 0xdbff) keep -= 1
  const cut = clean.length - keep
  return { text: (clean.slice(0, keep) + note(cut)).slice(0, cap), cut }
}

/** What the module holds between reads (design D8): the report or the problem, the hide flag, whether the problem was named. */
export function freshStart() {
  return { report: null, path: null, problem: null, hidden: false, named: false }
}

/**
 * The module's next `start` after a read (design D5, D8), whether the band
 * must be redrawn, and the one debug line to name, if any. A re-read of the
 * report already held changes nothing, hide flag and all. A new report is
 * held, and stays hidden only when it continues a report already held across
 * a compaction. A problem drops the held report, since the file is no longer
 * this session's, and is named once until a report is held again.
 *
 * @param {object} start what `freshStart` returns, as last adopted
 * @param {{report?: object, problem?: string}} outcome `readPreflightReport`'s result, or a read's rejection as a problem
 * @param {string} path the file's path, named on the debug line and the panes
 * @returns {{start: object, changed: boolean, log: string|null}}
 */
export function adoptPreflight(start, outcome, path) {
  const held = start && typeof start === 'object' ? start : freshStart()
  const report = outcome && outcome.report
  if (report) {
    if (held.report && held.report.writtenAt === report.writtenAt && held.report.root === report.root) {
      return { start: held, changed: false, log: null }
    }
    const hidden = held.report !== null && held.hidden && report.source === 'compact'
    return { start: { report, path, problem: null, hidden, named: false }, changed: true, log: null }
  }
  const problem = (outcome && outcome.problem) || 'no report was read'
  const log = held.named ? null : `interlock meter: no preflight report at ${path}: ${problem}`
  const changed = held.report !== null || held.problem !== problem || held.path !== path
  return { start: { report: null, path, problem, hidden: held.hidden, named: true }, changed, log }
}
