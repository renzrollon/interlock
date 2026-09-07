// Parsers for the short human-written values a config file carries.

/**
 * Parse a duration like `250ms` or `90s` into milliseconds.
 *
 * Only `ms` and `s` are understood; every other unit is rejected.
 *
 * @param {string} text
 * @returns {number}
 */
export function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(String(text).trim())
  if (!m) throw new Error(`cannot parse duration "${text}"`)
  return m[2] === 'ms' ? Number(m[1]) : Number(m[1]) * 1000
}
