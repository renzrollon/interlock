// The ship meter's colours, as the theme keys the pane draws with.
//
// Each value is a key of the person's own theme, never a fixed hue: `Text` and
// `Box` colour props resolve a theme key, so the pane follows the light, dark
// or colour-blind theme the person chose (probed on Claude Code 2.1.295: the
// keys below resolve, nested spans inside one `Text` keep their own, a
// bordered `Box` takes one for its border, and an unknown key draws uncoloured
// with no error). A colour names what a word means: a state the renderer
// printed, a name, a heading, a word the host or the CLI sent. It is never a
// threshold or a verdict of the meter's own, so a figure the engine reports
// (the context, the cost, a plan window) carries none.
//
// Pure and Node-free: the hooks module runs in the engine with no Node, and
// imports this file.

export const PALETTE = Object.freeze({
  // A state word the board printed: the recorded ok, the recorded failure, the cursor.
  ok: 'success',
  failed: 'error',
  current: 'warning',
  // A lane label and an agent's name.
  identity: 'suggestion',
  // The run header and the section headings.
  accent: 'claude',
  // A word the CLI or the host raised to be read: a banner, the quiet word, a running turn.
  warn: 'warning',
  // A refusal, and a turn the host ended without an answer.
  alarm: 'error'
})

const DIM_WORDS = new Set(['pending', 'not reached', 'not recorded', 'per task'])

/** The props a state word the board printed is drawn with: a hue for ok, failed and current, dim for the rest, else none. */
export function stateProps(word) {
  if (word === 'ok') return { color: PALETTE.ok }
  if (word === 'failed') return { color: PALETTE.failed }
  if (word === 'current') return { color: PALETTE.current }
  if (DIM_WORDS.has(word)) return { dimColor: true }
  return null
}

/**
 * The props an agent's turn word is drawn with. No reason is a turn still
 * running; `answer` is the host's ordinary end; any other word the host sends
 * is a turn it ended without one. The caller shows the word itself verbatim.
 */
export function turnProps(reason) {
  if (reason === null || reason === undefined) return { color: PALETTE.warn }
  if (reason === 'answer') return { color: PALETTE.ok }
  return { color: PALETTE.alarm }
}
