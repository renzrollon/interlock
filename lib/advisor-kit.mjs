// Shared pieces of the two advisors' draft checks and renderers.
//
// The checkpoint advisor (`lib/advisor.mjs`) and the review-findings advisor
// (`lib/review-advisor.mjs`) both render a markdown table, both record a consult
// that did not run as the same stanza, and both keep what survives validation
// before applying a cap. Those three generic parts live here, parameterised by
// the text that differs, so neither advisor copies the other.
//
// Nothing here reads a clock or a file: the stamp is the caller's, so the same
// inputs give the same bytes.
//
// See add-review-findings-advisor design.md D5, D6.

import { escapeCell } from './md-table.mjs'

/**
 * A markdown table, or the word `none` for no rows. A literal pipe in a cell
 * is escaped so it cannot break the row.
 *
 * @param {string[]} columns
 * @param {Array<Array<unknown>>} rows
 */
export function table(columns, rows) {
  if (rows.length === 0) return 'none'
  return [
    `| ${columns.join(' | ')} |`,
    `|${columns.map(c => '-'.repeat(c.length + 2)).join('|')}|`,
    ...rows.map(r => `| ${r.map(v => escapeCell(v)).join(' | ')} |`)
  ].join('\n')
}

/**
 * The stanza for a consult that did not run: the title, the stamp when there is
 * one, the reason on one line, the closing text, and no tables.
 *
 * @param {unknown} reason
 * @param {{ title: string, closing: string, status?: string, stamp?: string }} opts
 *   `title` is the heading line, `closing` the final paragraph, `status` the
 *   label before the reason (default `did not run`).
 */
export function didNotRunStanza(reason, { title, closing, status = 'did not run', stamp } = {}) {
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().replace(/\s+/g, ' ') : 'no reason given'
  return [title, '', ...(stamp ? [`recorded ${stamp}`, ''] : []), `${status}: ${why}`, '', closing, ''].join('\n')
}

/**
 * Validate a draft's items first and cap second, so an invalid item never
 * pushes a valid one over the cap. Ids are positional (`<prefix><n>` by draft
 * position) and any id the model wrote is never consulted.
 *
 * `validate(item, id)` returns the entry to keep (an object, which receives the
 * id), or a string naming why the item is dropped.
 *
 * @param {unknown[]} items
 * @param {(item: unknown, id: string) => object | string} validate
 * @param {number} cap  most items kept; the rest drop as `over cap`
 * @param {{ prefix?: string }} [opts]
 * @returns {{ kept: Array<{id: string}>, dropped: Array<{id: string, reason: string}> }}
 */
export function keepThenCap(items, validate, cap, { prefix = '' } = {}) {
  const kept = []
  const dropped = []
  items.forEach((item, i) => {
    const id = `${prefix}${i + 1}`
    const verdict = validate(item, id)
    if (typeof verdict === 'string') return dropped.push({ id, reason: verdict })
    if (kept.length >= cap) return dropped.push({ id, reason: 'over cap' })
    kept.push({ id, ...verdict })
  })
  return { kept, dropped }
}
