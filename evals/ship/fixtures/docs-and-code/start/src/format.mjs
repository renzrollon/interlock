// Human-readable formatters for the numbers this package reports.

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
