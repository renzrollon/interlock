// Shared pieces of the two advisors' briefs.
//
// A brief is assembled by code from inputs the CLI chose, bounded by a
// character cap, and cut whole section at a time in a fixed order. The cut loop,
// the `## Omitted` block and the two text helpers are the same for the
// checkpoint advisor and the review-findings advisor, so they live here and each
// assembler passes in what differs: its sections, its cut order and its render.
//
// This module holds no assembler and is listed in `NON_ASSEMBLER_MODULES`. Like
// every prompt module it reads no clock, no file and no process state.
//
// See add-review-findings-advisor design.md D5, D6.

/** Collapse every run of whitespace to one space and trim. */
export const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim()

/** A fenced block whose fence is longer than any backtick run inside it. */
export function quote(text) {
  const body = String(text ?? '').replace(/\s+$/, '')
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}markdown\n${body}\n${fence}`
}

/**
 * The `## Omitted` block naming every section cut and the overrun, or null when
 * nothing was cut and nothing overran.
 *
 * @param {string[]} cut
 * @param {number} overrun
 * @returns {string | null}
 */
export function omittedBlock(cut, overrun) {
  if (cut.length === 0 && !(overrun > 0)) return null
  return ['## Omitted', '', ...cut.map(name => `- ${name}`), ...(overrun > 0 ? [`- cap exceeded by ${overrun} chars`] : [])].join(
    '\n'
  )
}

/**
 * Fit a brief to a cap. Sections are cut whole, one at a time in `cutOrder`,
 * until the text fits or nothing cuttable is left; a name in `cutOrder` that is
 * not among `sections` is skipped. When the sections that are never cut still
 * exceed the cap, the text is kept whole and the overrun is spoken: the
 * `render` call that names it is given the count, which is part of the text it
 * measures, so the count is found by iteration.
 *
 * @param {string[]} sections  names of the sections that can be cut
 * @param {string[]} cutOrder  the order they are cut in
 * @param {number} cap  most characters
 * @param {(cut: string[], overrun: number) => string} render
 * @returns {{ text: string, omitted: string[], overrun: number }}
 */
export function fitSections(sections, cutOrder, cap, render) {
  const order = cutOrder.filter(name => sections.includes(name))
  const cut = []
  let text = render(cut, 0)
  while (text.length > cap && cut.length < order.length) {
    cut.push(order[cut.length])
    text = render(cut, 0)
  }

  let overrun = 0
  if (text.length > cap) {
    // The overrun line is part of the text it measures, so find the count that
    // names its own total.
    let n = text.length - cap
    for (let i = 0; i < 12; i++) {
      const candidate = render(cut, n)
      overrun = n
      text = candidate
      if (candidate.length - cap === n) break
      n = candidate.length - cap
    }
  }
  return { text, omitted: cut, overrun }
}
