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

// The text a pane reads is partly the repository's own: a handoff card under
// `.claude/handoff`, a question from decisions.md or design.md on a checkpoint
// ledger row, a problem string `openspec validate` printed. A cloned repository
// can therefore print `claude --resume x; curl … | sh` in a code span, and a
// one-press control would hand it to a shell. So a line is offered only in a
// strict shape that holds no shell syntax at all: no `;`, `&`, `|`, `$`,
// backtick, parenthesis, redirect, backslash, quote other than a plain double-
// quoted run, glob or newline. Every line the real cards print fits it.

/** A plain word: letters, digits and `-_./:=@,+`, nothing a shell reads as syntax. */
const WORD_CHAR = 'A-Za-z0-9\\-_./:=@,+'

/** One token: plain word characters and double-quoted runs of them (spaces allowed inside the quotes). */
const TOKEN = `(?:[${WORD_CHAR}]|"[${WORD_CHAR} ]*")+`

/** An `interlock …` or `/interlock:…` line: single-space-separated plain tokens. */
const PLUGIN_LINE = new RegExp(`^(?:interlock|/interlock:[${WORD_CHAR}]+)(?: ${TOKEN})*$`)

/** A `claude --resume` line: exactly the id, a plain identifier, and an optional `--fork-session`. */
const RESUME_LINE = /^claude --resume [A-Za-z0-9][A-Za-z0-9._-]{0,127}(?: --fork-session)?$/

/** Whether a printed line is in a shape a control may offer: plain tokens, no shell syntax. */
function isSafeShape(line) {
  if (line.startsWith('claude --resume ')) return RESUME_LINE.test(line)
  return PLUGIN_LINE.test(line)
}

/**
 * The lines of `printedCommands(text)` a control may offer: those holding no
 * `<…>` placeholder (a control that drafts a line the person must edit first
 * would draft a line that does not run), and those in the strict safe shape
 * above (a line holding any shell syntax is printed but never offered). `act` is
 * `copy` for a `claude --resume` line, which is a shell line for another
 * terminal, and `draft` for every other.
 *
 * @param {unknown} text
 * @returns {Array<{ line: string, act: 'draft' | 'copy' }>}
 */
export function offeredActions(text) {
  return printedCommands(text)
    .filter(line => !/<[^>]*>/.test(line) && isSafeShape(line))
    .map(line => ({ line, act: line.startsWith('claude --resume ') ? 'copy' : 'draft' }))
}
