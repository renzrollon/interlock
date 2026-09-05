import { formatBytes, formatDuration } from './format.mjs'

/**
 * The one line a report prints for a completed piece of work.
 *
 * It formats nothing itself — both halves come from `src/format.mjs`, so a
 * rounding change has exactly one site.
 *
 * @param {{ bytes: number, ms: number }} result
 * @returns {string}
 */
export function summarize({ bytes, ms }) {
  return `${formatBytes(bytes)} in ${formatDuration(ms)}`
}
