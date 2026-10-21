/**
 * Markdown table row helpers shared by the sibling table formats
 * (`lib/ledger.mjs`, `lib/notes.mjs`), so both read a cell the same way.
 * Pure string functions; no I/O.
 */

/**
 * Split one markdown table row into cells. Tolerates a missing leading or
 * trailing pipe and any amount of padding. '\|' is an escaped literal pipe.
 */
export function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1)
  return s
    .split(/(?<!\\)\|/)
    .map(c => c.replace(/\\\|/g, '|').trim())
}

/** Whether every cell of a split row is a `---` / `:---:` separator cell. */
export function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c))
}

/**
 * Render a value as one cell that cannot break the table: newlines collapse,
 * pipes are escaped. `isEmpty`, when given, names the values that render as
 * the placeholder `—`.
 */
export function escapeCell(value, isEmpty) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (isEmpty && isEmpty(s)) return '—'
  return s.replace(/\|/g, '\\|')
}
