// Human-readable formatters for the numbers this package reports.

const KB = 1024
const MB = KB * 1024

const SECOND = 1000
const MINUTE = SECOND * 60

/**
 * Format a count with its unit, pluralised.
 *
 * @param {number} n
 * @param {string} unit singular form, e.g. "file"
 * @returns {string}
 */
export function formatCount(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * Format a byte count. The base unit prints as an integer; every larger unit
 * prints to exactly one decimal place, so a column of these stays aligned.
 *
 * @param {number} n
 * @returns {string}
 */
export function formatBytes(n) {
  if (n < KB) return `${n} B`
  if (n < MB) return `${(n / KB).toFixed(1)} KB`
  return `${(n / MB).toFixed(1)} MB`
}

/**
 * Format a millisecond duration, on the same fixed-decimal rule as
 * {@link formatBytes}.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < SECOND) return `${ms} ms`
  if (ms < MINUTE) return `${(ms / SECOND).toFixed(1)} s`
  return `${(ms / MINUTE).toFixed(1)} min`
}
