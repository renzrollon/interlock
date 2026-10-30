// Claude Code's own advisor tool, as Interlock sees it (replace-subagent-advisors-with-advisor-tool).
//
// Only the user can turn the tool on, so this module only reads. It is pure and
// imports no `node:` module: the caller reads the settings files and hands their
// text in, which is also why it cannot write one. That is the whole of the
// never-configure rule's enforcement — a static test finds the settings key
// spelled here and nowhere else under lib/, cli/, hooks/ and workflows/.
//
// The configured value is never returned. Like the prompt-cache row, Interlock
// names where the key is set and never resolves which scope wins: Claude Code's
// own merge decides that, and a preflight that picked one would be reporting a
// value it did not compute.

import { ADVISOR_DISABLE_ENV } from './host/claude-env.mjs'

const KEY = 'advisorModel'

/** The doctor row's fix when no scope sets the key. A plugin cannot set it for the user. */
export const ADVISOR_UNSET_FIX =
  'Run /advisor <model> to turn it on. Interlock cannot: a plugin\'s settings apply only agent and subagentStatusLine.'

const reasonOf = error => {
  if (typeof error === 'string') return error.trim() || 'unreadable'
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  return 'unreadable'
}

/**
 * Why a JSON parse failed, by position only. Node's messages quote the file
 * (`Unexpected token 'o', "{ntfy":"abc"..." is not valid JSON`, or the offending
 * token on older builds), and a settings file can hold a credential such as an
 * ntfy topic; this text lands in doctor output, run notes and the manifest. So
 * nothing of the message is passed on except the numbers: the position, and
 * line and column when the engine reports them.
 *
 * @param {unknown} err  the thrown SyntaxError
 * @returns {string}  `not valid JSON: at position 12 (line 1 column 13)`, or
 *   `not valid JSON: position not reported` when the message carries no position
 */
export function jsonParseReason(err) {
  const message = err && typeof err.message === 'string' ? err.message : ''
  const at = /\bat position (\d+)/.exec(message)
  if (!at) return 'not valid JSON: position not reported'
  const lc = /\(line (\d+) column (\d+)\)/.exec(message)
  return `not valid JSON: at position ${at[1]}${lc ? ` (line ${lc[1]} column ${lc[2]})` : ''}`
}

/**
 * Which settings scopes set the key, and which files could not be read.
 *
 * @param {Array<{scope: string, text?: string, absent?: boolean, error?: unknown}>} sources
 *   One entry per scope: its file's text, `absent: true` when there is no such
 *   file (not a degradation), or `error` when the file exists and did not read.
 * @returns {{scopes: string[], unreadable: Array<{scope: string, reason: string}>}}
 *   `scopes` holds those whose JSON sets the key to a non-empty string; any
 *   other value reads as unset. `unreadable` holds a file that does not read,
 *   does not parse, or parses to something other than an object.
 */
export function readAdvisorConfig(sources) {
  const scopes = []
  const unreadable = []
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== 'object') continue
    const scope = String(source.scope)
    if (source.absent === true) continue
    if (source.error !== undefined) {
      unreadable.push({ scope, reason: reasonOf(source.error) })
      continue
    }
    if (typeof source.text !== 'string') {
      unreadable.push({ scope, reason: 'no settings text given' })
      continue
    }
    let value
    try {
      value = JSON.parse(source.text)
    } catch (err) {
      unreadable.push({ scope, reason: jsonParseReason(err) })
      continue
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      unreadable.push({ scope, reason: 'not a JSON object' })
      continue
    }
    if (typeof value[KEY] === 'string' && value[KEY].trim() !== '') scopes.push(scope)
  }
  return { scopes, unreadable }
}

const asObservation = observation => {
  const o = observation && typeof observation === 'object' ? observation : {}
  return {
    scopes: Array.isArray(o.scopes) ? o.scopes : [],
    unreadable: Array.isArray(o.unreadable) ? o.unreadable : [],
    disabled: o.disabled === true
  }
}

/** True when a scope sets the key and the environment has not disabled the tool. */
export function advisorConfigured(observation) {
  const o = asObservation(observation)
  return o.scopes.length > 0 && !o.disabled
}

/**
 * The run-note texts for an observation. Nothing when no scope sets the key: an
 * unset advisor is the default, not a degradation. No text says the advisor is
 * active or states a spend.
 *
 * @param {{scopes?: string[], unreadable?: Array<{scope: string, reason: string}>, disabled?: boolean}} observation
 * @param {{counted?: boolean}} [opts] `counted`: whether this host counts consults per lane.
 * @returns {string[]}
 */
export function advisorNotes(observation, { counted = false } = {}) {
  const o = asObservation(observation)
  const notes = []
  const where = o.scopes.join(', ')
  if (o.scopes.length && !o.disabled) {
    notes.push(
      `ADVISOR CONFIGURED (${where}): lanes the engine pairs with it may consult it; ${
        counted ? 'consults are counted per lane' : 'consults are not counted on this host'
      }, the advice is not recorded, and its spend is not established`
    )
  } else if (o.scopes.length && o.disabled) {
    notes.push(`ADVISOR DISABLED: ${ADVISOR_DISABLE_ENV} is set, so ${KEY} in ${where} is ignored`)
  }
  for (const u of o.unreadable) notes.push(`ADVISOR CONFIGURATION NOT READ: ${u.scope} settings (${u.reason})`)
  return notes
}

/**
 * The doctor row's status, detail and fix for an observation. Never `fail`: the
 * status is `ok` or `skip`, and an unreadable file never demotes a row that a
 * set scope already supports.
 *
 * @returns {{status: 'ok'|'skip', detail: string, fix?: string}}
 */
export function advisorDoctor(observation) {
  const o = asObservation(observation)
  const notRead = o.unreadable.map(u => `; not read: ${u.scope} (${u.reason})`).join('')
  const where = o.scopes.join(', ')
  if (o.disabled) {
    return {
      status: 'skip',
      detail: o.scopes.length
        ? `${ADVISOR_DISABLE_ENV} is set, so ${KEY} in ${where} is ignored${notRead}`
        : `${ADVISOR_DISABLE_ENV} is set, so the advisor tool is off; ${KEY} is not set in any settings scope read here${notRead}`
    }
  }
  if (o.scopes.length) {
    return {
      status: 'ok',
      detail: `${KEY} set in ${where}; Claude decides when to consult it; ship lanes the engine pairs with it may consult it; Interlock counts consults on the Workflow host and never records the advice${notRead}`
    }
  }
  return {
    status: 'skip',
    detail: `${KEY} not set in any settings scope read here; a session's --advisor flag is not visible to doctor${notRead}`,
    fix: ADVISOR_UNSET_FIX
  }
}
