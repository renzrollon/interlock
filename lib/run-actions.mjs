// The command lines a pane printed, and the ones a control may offer to draft.
//
// A halt resume card and the spec checkpoint card both print the lines a person
// runs next. The panes turn those lines into controls (make-the-run-surfaces-
// interactive design D4, D22), so the question "which lines did this text
// print" has one answer, here, and the tests that run a card's commands read the
// same one the pane does. Node-free on purpose: `hooks/mod.mjs` runs inside the
// engine with no Node and imports this module, so it holds no Node-module import and
// no bare specifier (`test/spine/mod-pins.test.mjs` pins that for the module's
// import walk). Pure: text in, lines out.

/** The prefixes a printed command line begins with, in no particular order. */
const COMMAND_PREFIXES = ['interlock ', '/interlock:', 'claude --resume ']

/** The prefix of a `draft` control's label: the line goes into the prompt box. */
export const DRAFT_LABEL_PREFIX = 'Draft: '

/** The prefix of a `copy` control's label: the line goes to the clipboard. */
export const COPY_LABEL_PREFIX = 'Copy: '

function isCommand(candidate) {
  return COMMAND_PREFIXES.some(prefix => candidate.startsWith(prefix))
}

/**
 * Every command line a text printed: a fenced line or a code span that begins
 * `interlock `, `/interlock:` or `claude --resume `, in print order, each one
 * time. A line holding a placeholder is returned whole; `offeredActions` is the
 * one that leaves it out. Never throws: anything that is not a string prints
 * nothing.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function printedCommands(text) {
  if (typeof text !== 'string') return []
  const found = []
  const seen = new Set()
  const take = line => {
    const trimmed = line.trim()
    if (!isCommand(trimmed) || seen.has(trimmed)) return
    seen.add(trimmed)
    found.push(trimmed)
  }
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      take(line)
      continue
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) take(match[1])
  }
  return found
}

/**
 * The lines of `printedCommands(text)` a control may offer: those holding no
 * `<…>` placeholder (a control that drafts a line the person must edit first
 * would draft a line that does not run). `act` is `copy` for a
 * `claude --resume` line, which is a shell line for another terminal, and
 * `draft` for every other.
 *
 * @param {unknown} text
 * @returns {Array<{ line: string, act: 'draft' | 'copy' }>}
 */
export function offeredActions(text) {
  return printedCommands(text)
    .filter(line => !/<[^>]*>/.test(line))
    .map(line => ({ line, act: line.startsWith('claude --resume ') ? 'copy' : 'draft' }))
}
