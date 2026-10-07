// The ship meter's refusal words (speak-permission-prompts-and-guard-denials
// design D4-D6): the four guard names a settings guard's denial is read by,
// the slice of an errored result's text the meter repeats, and the pane lines.
//
// Pure and Node-free: `hooks/mod.mjs` imports it inside the engine, where there
// is no Node, and `test/spine/mod-pins.test.mjs` walks the import and pins the
// names against the four guards' own `GUARD` constants. Nothing here judges a
// denial: the words are the guard's, and the ruling is `lib/launch-rule.mjs`'s.

/** The settings guards whose denials the meter repeats, as each prints its name. */
export const GUARD_NAMES = Object.freeze(['guard-tests', 'guard-tasks', 'guard-commit', 'guard-relaunch'])

// Anywhere in the text, not only at its start: the engine puts
// `PreToolUse:<tool> hook error: ` in front of a settings hook's reason (probe 2).
const NAMED = new RegExp(`\\b(${GUARD_NAMES.join('|')}): `)

/**
 * The text from the first guard name on, or `null` for a text that names no
 * guard (another plugin's deny, a command that failed) or is not a string.
 *
 * @param {unknown} text an errored tool result's `text`
 * @returns {string|null}
 */
export function guardReason(text) {
  if (typeof text !== 'string') return null
  const m = NAMED.exec(text)
  return m ? text.slice(m.index) : null
}

/**
 * The guard that spoke `reason`, as `guardReason` sliced it; `null` for none.
 *
 * @param {unknown} reason
 * @returns {string|null}
 */
export function guardOf(reason) {
  if (typeof reason !== 'string') return null
  const m = NAMED.exec(reason)
  return m && m.index === 0 ? m[1] : null
}

/**
 * `guard denials: <n> (<guard> <n>, …)` in the order each guard was first
 * seen, or `null` when none was: the pane draws no line for nothing.
 *
 * @param {Map<string, number>|undefined} counts
 * @returns {string|null}
 */
export function guardDenialLine(counts) {
  if (!(counts instanceof Map) || counts.size === 0) return null
  let total = 0
  const parts = []
  for (const [guard, n] of counts) {
    total += n
    parts.push(`${guard} ${n}`)
  }
  return `guard denials: ${total} (${parts.join(', ')})`
}

/**
 * The launch guard's current ruling over the session's record, in the rule's
 * own words. `now` is `null` only when the guard's facts could not be read,
 * which allows the next launch (design D5).
 *
 * @param {{ decision: string, reason: string|null }} ruling what `decideLaunch` returned
 * @param {number|null} now
 * @returns {string}
 */
export function launchGuardLine(ruling, now) {
  if (now === null) return 'launch guard: facts unreadable; the next launch is allowed'
  if (ruling && ruling.decision === 'deny' && ruling.reason) return `launch guard: next launch refused: ${ruling.reason}`
  return 'launch guard: next launch allowed'
}
