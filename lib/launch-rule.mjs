// The launch rule: what a ship launch is, what a human prompt is, and whether
// the next launch has a human behind it (guard-ship-relaunch design D1, D3;
// guard-ship-relaunch-in-process design D1).
//
// The one recorded twenty-agent mistake was a parent chat calling Workflow again
// over leftover checkboxes, with no human message in between. The skill forbids
// it in prose; this is the rule that lets a hook refuse it: a launch newer than
// the session's last human prompt means the next launch has no human behind it.
//
// ONE RULE, TWO TRANSPORTS. Two guards read this module: the settings hook
// (`hooks/guard-relaunch.mjs`, through `lib/launch-ledger.mjs`, which keeps the
// record in a file per session and re-exports everything here unchanged) and
// the hooks module (`hooks/mod.mjs`, which keeps the same record in the
// engine's session state). The decision and its words are defined once, so a
// reword of the skill sentence moves both guards and both pins together.
//
// NO NODE. The hooks module runs in the engine with no Node, so this file
// imports nothing but the published age, and `test/spine/launch-ledger.test.mjs`
// pins that. A record here is plain data: `{ schema, launches: [{ at, runId,
// workflowName, scriptPath }], lastHumanPromptAt }`, times as ISO strings.
//
// EVERY UNKNOWN ALLOWS. A launch time that does not parse is no launch, a
// record that is not one is empty, an age past `LIMITS.launchLedgerMaxAgeMs` is
// absent. A false refusal costs one typed message; a rule whose own parse
// error blocked a launch would be the worse failure.

import { LIMITS } from './limits.mjs'

export const LEDGER_SCHEMA = 'interlock.launch-ledger/1'

/**
 * The skill sentence the deny quotes, verbatim, so one string is pinned in both
 * places: `test/hooks.test.mjs` asserts `skills/ship/SKILL.md` still contains it.
 */
export const SKILL_QUOTE = 'Leftover `- [ ]` boxes after a run are a report, not authorization to call Workflow again'

/** The leading marker of the host's completion wake (guard-ship-relaunch design D4, task-1 capture). */
export const WAKE_MARKER = '<task-notification>'

// The plugin's own ship workflow, by either handle the host passes: the script
// path the skill trampoline names, or the command name the manifest's
// `workflows` entry registers (`interlock:ship`, possibly marketplace-prefixed).
const SHIP_SCRIPT = /(^|\/)workflows\/ship\.js$/
const SHIP_NAME = /(^|[^A-Za-z0-9_])interlock:ship$/
const LAUNCHED = new Set(['async_launched', 'remote_launched'])

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const posix = path => path.replace(/\\/g, '/')
const str = value => (typeof value === 'string' && value ? value : null)
const timeOf = launch => (isObject(launch) && typeof launch.at === 'string' ? Date.parse(launch.at) : NaN)
const isRecord = value => isObject(value) && Array.isArray(value.launches)

/**
 * Is this Workflow input a launch of the plugin's ship workflow? A call
 * carrying `resumeFromRunId` is still a launch: a resume replays every agent
 * after the failed one. With the session's record, a call that resumes a run it
 * recorded — by `runId`, or by the persisted `scriptPath` the completion wake
 * suggests passing back — is one too, though it names neither handle above.
 */
export function isShipLaunch(toolInput, ledger = null) {
  if (!isObject(toolInput)) return false
  const scriptPath = typeof toolInput.scriptPath === 'string' ? posix(toolInput.scriptPath) : ''
  if (scriptPath && SHIP_SCRIPT.test(scriptPath)) return true
  if (typeof toolInput.name === 'string' && SHIP_NAME.test(toolInput.name)) return true
  if (!isRecord(ledger)) return false
  return ledger.launches.some(
    launch =>
      isObject(launch) &&
      ((str(launch.runId) && toolInput.resumeFromRunId === launch.runId) ||
        (str(launch.scriptPath) && scriptPath && scriptPath === posix(launch.scriptPath)))
  )
}

/**
 * Did the runtime accept this launch? Positive, not negative: only a response
 * object whose `status` says it launched, carrying no error mark, counts. The
 * capture found a refused launch never reaches PostToolUse at all — the engine
 * rejects it at input validation — so this is the second line, and anything it
 * cannot recognise records nothing, which is the allow direction.
 */
export function isAcceptedLaunch(toolResponse) {
  if (!isObject(toolResponse)) return false
  if (toolResponse.is_error === true || toolResponse.isError === true || toolResponse.error !== undefined) return false
  return LAUNCHED.has(toolResponse.status)
}

/**
 * A prompt a person sent, as opposed to the host's completion wake, read off
 * the prompt's text: the settings form's test, which has no origin to read. No
 * text is still a prompt. The hooks module reads the engine's stamped origin
 * instead (guard-ship-relaunch-in-process design D3).
 */
export function isHumanPrompt(prompt) {
  if (typeof prompt !== 'string') return true
  return !prompt.trimStart().startsWith(WAKE_MARKER)
}

/** The newest launch with a readable time, or null. */
export function newestLaunch(ledger) {
  if (!isRecord(ledger)) return null
  let newest = null
  for (const launch of ledger.launches) {
    const ms = timeOf(launch)
    if (Number.isFinite(ms) && (!newest || ms > newest.ms)) newest = { at: launch.at, ms }
  }
  return newest
}

/** `lastHumanPromptAt` as milliseconds: null when none was recorded, NaN when it cannot be read. */
export function promptMs(ledger) {
  if (ledger.lastHumanPromptAt === null || ledger.lastHumanPromptAt === undefined) return null
  return typeof ledger.lastHumanPromptAt === 'string' ? Date.parse(ledger.lastHumanPromptAt) : NaN
}

/** A record with no launch and no prompt: what a session starts from. A new object on every call. */
export function emptyRecord() {
  return { schema: LEDGER_SCHEMA, launches: [], lastHumanPromptAt: null }
}

/**
 * The record with one more launch. Launches older than the published age
 * (measured back from this one) and launches with no readable time are
 * dropped, so the record stays bounded in either transport. Anything that is
 * not a record starts from `emptyRecord()`. The input is never mutated.
 */
export function withLaunch(record, launch, maxAgeMs = LIMITS.launchLedgerMaxAgeMs) {
  const base = isRecord(record) ? record : emptyRecord()
  const ms = timeOf(launch)
  const kept = base.launches.filter(prior => {
    const at = timeOf(prior)
    return Number.isFinite(at) && (!Number.isFinite(ms) || ms - at <= maxAgeMs)
  })
  return { ...base, launches: [...kept, launch] }
}

/**
 * The record with a human prompt at `at` (an ISO time). Keeps the later of the
 * recorded time and `at`: an earlier clock never moves the prompt back. Anything
 * that is not a record starts from `emptyRecord()`. The input is never mutated.
 */
export function withPrompt(record, at) {
  const base = isRecord(record) ? record : emptyRecord()
  const next = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(next)) return base
  const previous = promptMs(base)
  if (previous !== null && Number.isFinite(previous) && previous >= next) return base
  return { ...base, lastHumanPromptAt: at }
}

/** The deny's words (guard-ship-relaunch design D3): what happened, the skill's rule, and the remedy. */
export function denyReason(lastLaunchAt) {
  return (
    `guard-relaunch: a ship workflow was already launched in this session at ${lastLaunchAt} ` +
    `and no human prompt has arrived since. skills/ship/SKILL.md: "${SKILL_QUOTE}." ` +
    `Send a new message that asks to ship the leftovers, or type /interlock:ship again, ` +
    `and the next launch is allowed.`
  )
}

/**
 * The rule. No record, or a stale one → allow. A launch newer than the last
 * human prompt — including every launch when no prompt was recorded → deny.
 * Anything this cannot read a time from → allow.
 */
export function decideLaunch(ledger, now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs) {
  const allow = { decision: 'allow', reason: null, lastLaunchAt: null, lastHumanPromptAt: null }
  const newest = newestLaunch(ledger)
  if (!newest) return allow
  const prompt = promptMs(ledger)
  const seen = { lastLaunchAt: newest.at, lastHumanPromptAt: prompt === null ? null : ledger.lastHumanPromptAt }
  if (now - newest.ms > maxAgeMs) return { ...allow, ...seen }
  if (prompt !== null && (!Number.isFinite(prompt) || prompt >= newest.ms)) return { ...allow, ...seen }
  return { decision: 'deny', reason: denyReason(newest.at), ...seen }
}
