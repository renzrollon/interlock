// Parsers for the short human-written values a config file carries.

import { UNIT_MS } from './units.mjs'

// Built from the table's own keys, longest first, so `min` is matched before
// `m` would be if one were ever added — and so the accepted units and the
// table cannot drift apart.
const UNIT_PATTERN = Object.keys(UNIT_MS)
  .sort((a, b) => b.length - a.length)
  .join('|')

const DURATION = new RegExp(`^(\\d+(?:\\.\\d+)?)(${UNIT_PATTERN})$`)

/**
 * Parse a duration like `250ms`, `90s`, `5min` or `2h` into milliseconds.
 *
 * @param {string} text
 * @returns {number}
 */
export function parseDuration(text) {
  const m = DURATION.exec(String(text).trim())
  if (!m) throw new Error(`cannot parse duration "${text}"`)
  return Number(m[1]) * UNIT_MS[m[2]]
}

/**
 * Parse a comma-separated string into trimmed, non-empty entries.
 *
 * Doubled and trailing commas are typing accidents in a hand-written config,
 * not empty values a caller meant, so they contribute nothing.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseList(text) {
  return String(text)
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}
