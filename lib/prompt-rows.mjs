// The prompt's argument suggestions (make-the-run-surfaces-interactive, spec
// hooks/ship-meter "The module SHALL suggest open change names and recent run
// ids…", design D11, D18): which draft asks for a change name or a run id, and
// the rows that answer it.
//
// The engine's `prompt.autocomplete` event carries `{ text, cursor, token, start }`:
// the whole draft, the cursor's offset, the word under the cursor and where it
// starts. Rows are added only when the words before the token are exactly one of
// the plugin's own commands in `ARGUMENT_COMMANDS`, so `fix the tests in add-`,
// `/interlock:ship add-foo --str` and `/interlock:shi` all get the engine's own
// answer. The names are the preflight report's (`openChanges`, `recentRuns`),
// newest first as the report lists them; nothing is listed, read or run here.
//
// Pure and Node-free: `hooks/mod.mjs` runs inside the engine with no Node and
// imports this module, importing only `./limits.mjs`. The row cap is read here as
// the default, so the hooks module calls `promptRows(event, report)` and never
// spells it.

import { LIMITS } from './limits.mjs'

/**
 * The commands whose next word is a name this module can suggest, and which
 * list the name comes from. `command` is the words before the argument; every
 * one is a verb in the CLI's inventory or a skill the plugin ships (a test
 * fails naming one that is neither). `list` is the preflight report's field.
 */
export const ARGUMENT_COMMANDS = Object.freeze(
  [
    { command: '/interlock:ship', list: 'openChanges' },
    { command: '/interlock:review-artifacts', list: 'openChanges' },
    { command: 'interlock validate', list: 'openChanges' },
    { command: 'interlock ledger', list: 'openChanges' },
    { command: 'interlock checkpoint', list: 'openChanges' },
    { command: 'interlock run-log show', list: 'recentRuns' },
    { command: 'interlock run-log follow --run', list: 'recentRuns' },
    { command: 'interlock run-log query --run', list: 'recentRuns' }
  ].map(entry => Object.freeze(entry))
)

/** What each list's rows say they are. */
const DESCRIPTIONS = Object.freeze({ openChanges: 'open change', recentRuns: 'recent run' })

const words = text => text.split(/\s+/).filter(Boolean)

/**
 * The report field the draft asks a name of: `openChanges` or `recentRuns`, or
 * null for any other draft. The token must start the argument, so the words
 * before it must be exactly a table entry and end at a space.
 *
 * @param {unknown} event the `prompt.autocomplete` event
 * @returns {'openChanges' | 'recentRuns' | null}
 */
export function argumentOf(event) {
  if (event === null || typeof event !== 'object') return null
  const { text, token } = event
  if (typeof text !== 'string' || typeof token !== 'string') return null
  const start = Number.isInteger(event.start)
    ? event.start
    : Number.isInteger(event.cursor)
      ? event.cursor - token.length
      : -1
  if (start <= 0 || start > text.length || text.slice(start, start + token.length) !== token) return null
  if (!/\s/.test(text[start - 1])) return null
  const before = words(text.slice(0, start)).join(' ')
  const entry = ARGUMENT_COMMANDS.find(candidate => candidate.command === before)
  return entry ? entry.list : null
}

/**
 * The rows for a draft: `{ text, label, description }` for each name of the
 * report's list that begins with the token, in the report's order, at most
 * `cap`. `null` for any draft that asks for no name, a report that is missing,
 * or a list that is `null`; `[]` when the draft asks and no name matches.
 *
 * @param {unknown} event the `prompt.autocomplete` event
 * @param {unknown} report the preflight report, or null
 * @param {number} [cap]
 * @returns {Array<{text: string, label: string, description: string}> | null}
 */
export function promptRows(event, report, cap = LIMITS.promptSuggestRows) {
  const list = argumentOf(event)
  if (list === null || report === null || typeof report !== 'object') return null
  const held = report[list]
  if (held === null || typeof held !== 'object' || !Array.isArray(held.names)) return null
  const limit = Number.isInteger(cap) && cap >= 0 ? cap : LIMITS.promptSuggestRows
  return held.names
    .filter(name => typeof name === 'string' && name !== '' && name.startsWith(event.token))
    .slice(0, limit)
    .map(name => ({ text: name, label: name, description: DESCRIPTIONS[list] }))
}
