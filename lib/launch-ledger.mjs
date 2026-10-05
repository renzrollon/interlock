// The launch ledger: what `hooks/guard-relaunch.mjs` reads to decide whether a
// ship launch is a relaunch nobody asked for (guard-ship-relaunch design D2, D3).
//
// The one recorded twenty-agent mistake was a parent chat calling Workflow again
// over leftover checkboxes, with no human message in between. The skill forbids
// it in prose; this is the record that lets a hook refuse it: per session, the
// ship launches the runtime accepted and the time of the last human prompt. A
// launch newer than the last human prompt means the next launch has no human
// behind it, and is denied.
//
// ONE FILE PER SESSION, CREATED ONLY BY AN ACCEPTED LAUNCH.
// `.claude/ship/launch-ledger/<session_id>.json`. Only the PostToolUse branch
// creates it. A prompt event records a time only when the file already exists —
// every plugin hook runs in every session in every repository, and a prompt in a
// repository that never shipped must write nothing.
//
// THE COMPLETION WAKE IS NOT A HUMAN. The host wakes the session when a
// background workflow finishes by firing `UserPromptSubmit` with the
// notification as the prompt (captured: test/fixtures/hooks/completion-wake.json).
// Counted as a human prompt it would reset the clock in exactly the turn the
// relaunch happens in, so `isHumanPrompt` refuses it by its leading marker.
//
// EVERY UNKNOWN READS AS NO LEDGER, and no ledger allows. A missing file, an
// unsafe session id, malformed JSON, a wrong schema, a launch time that does not
// parse, a ledger older than `LIMITS.launchLedgerMaxAgeMs`: each is null here,
// never an exception. A false deny costs one typed message; a guard whose own
// parse error blocked a launch would be the worse failure.
//
// Pure apart from the ledger files themselves. No hook protocol in here — the
// hook is plumbing over these functions, the way the stage guards are plumbing
// over `lib/ship-stage.mjs`.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LIMITS } from './limits.mjs'
import { SHIP_DIR } from './ship-stage.mjs'

export const LEDGER_SCHEMA = 'interlock.launch-ledger/1'

/** Where the ledgers live, beside the stage markers and the trajectory. */
export const LEDGER_DIR = join(SHIP_DIR, 'launch-ledger')

/**
 * The skill sentence the deny quotes, verbatim, so one string is pinned in both
 * places: `test/hooks.test.mjs` asserts `skills/ship/SKILL.md` still contains it.
 */
export const SKILL_QUOTE = 'Leftover `- [ ]` boxes after a run are a report, not authorization to call Workflow again'

/** The leading marker of the host's completion wake (design D4, task-1 capture). */
export const WAKE_MARKER = '<task-notification>'

// The plugin's own ship workflow, by either handle the host passes: the script
// path the skill trampoline names, or the command name the manifest's
// `workflows` entry registers (`interlock:ship`, possibly marketplace-prefixed).
const SHIP_SCRIPT = /(^|\/)workflows\/ship\.js$/
const SHIP_NAME = /(^|[^A-Za-z0-9_])interlock:ship$/
const LAUNCHED = new Set(['async_launched', 'remote_launched'])

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const posix = path => path.replace(/\\/g, '/')
const iso = ms => new Date(ms).toISOString()
const str = value => (typeof value === 'string' && value ? value : null)
const messageOf = err => (err && err.message) || String(err)

/** Safe as a file name: the trajectory's run-id rule (`lib/run-log.mjs`). */
function isSafeSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) && !value.includes('..')
}

/**
 * Is this Workflow `tool_input` a launch of the plugin's ship workflow? A call
 * carrying `resumeFromRunId` is still a launch: a resume replays every agent
 * after the failed one. With the session's ledger, a call that resumes a run it
 * recorded — by `runId`, or by the persisted `scriptPath` the completion wake
 * suggests passing back — is one too, though it names neither handle above.
 */
export function isShipLaunch(toolInput, ledger = null) {
  if (!isObject(toolInput)) return false
  const scriptPath = typeof toolInput.scriptPath === 'string' ? posix(toolInput.scriptPath) : ''
  if (scriptPath && SHIP_SCRIPT.test(scriptPath)) return true
  if (typeof toolInput.name === 'string' && SHIP_NAME.test(toolInput.name)) return true
  if (!isObject(ledger) || !Array.isArray(ledger.launches)) return false
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

/** A prompt a person sent, as opposed to the host's completion wake. No text is still a prompt. */
export function isHumanPrompt(prompt) {
  if (typeof prompt !== 'string') return true
  return !prompt.trimStart().startsWith(WAKE_MARKER)
}

/** The session's ledger path, or null when the session id cannot name a file. */
export function ledgerPath(root, sessionId) {
  if (typeof root !== 'string' || !isSafeSessionId(sessionId)) return null
  return join(root, LEDGER_DIR, `${sessionId}.json`)
}

/** The newest launch with a readable time, or null. */
function newestLaunch(ledger) {
  if (!isObject(ledger) || !Array.isArray(ledger.launches)) return null
  let newest = null
  for (const launch of ledger.launches) {
    const ms = isObject(launch) && typeof launch.at === 'string' ? Date.parse(launch.at) : NaN
    if (Number.isFinite(ms) && (!newest || ms > newest.ms)) newest = { at: launch.at, ms }
  }
  return newest
}

/** `lastHumanPromptAt` as milliseconds: null when none was recorded, NaN when it cannot be read. */
function promptMs(ledger) {
  if (ledger.lastHumanPromptAt === null || ledger.lastHumanPromptAt === undefined) return null
  return typeof ledger.lastHumanPromptAt === 'string' ? Date.parse(ledger.lastHumanPromptAt) : NaN
}

function isLedger(value) {
  if (!isObject(value) || value.schema !== LEDGER_SCHEMA || !Array.isArray(value.launches)) return false
  const prompt = promptMs(value)
  return prompt === null || Number.isFinite(prompt)
}

const isStale = (ledger, now, maxAgeMs) => {
  const newest = newestLaunch(ledger)
  return newest !== null && now - newest.ms > maxAgeMs
}

/**
 * The session's ledger, or null on every failure. A stale ledger reads as
 * absent. `onProblem` hears about a ledger that exists and cannot be read — an
 * absent or stale one is ordinary and says nothing — so the hook can speak the
 * degradation instead of allowing silently.
 */
export function readLedger(root, sessionId, { now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs, onProblem } = {}) {
  const path = ledgerPath(root, sessionId)
  if (!path) return null
  const problem = message => {
    if (typeof onProblem === 'function') onProblem(message)
  }
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if (err && err.code !== 'ENOENT') problem(`launch ledger unreadable, ignored: ${path}: ${messageOf(err)}`)
    return null
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    problem(`launch ledger is not valid JSON, ignored: ${path}`)
    return null
  }
  if (!isLedger(value)) {
    problem(`launch ledger is not an ${LEDGER_SCHEMA} document, ignored: ${path}`)
    return null
  }
  return isStale(value, now, maxAgeMs) ? null : value
}

function writeLedger(path, ledger) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(ledger, null, 2) + '\n')
    return { written: true, path, reason: null }
  } catch (err) {
    return { written: false, path, reason: `launch ledger not written: ${path}: ${messageOf(err)}` }
  }
}

/**
 * Record one launch the runtime accepted, with the identity its response
 * carried. Appends to a readable ledger and keeps its recorded prompt; over a
 * missing, stale or unreadable one it starts fresh, which is the state "one
 * launch, no prompt since" — exactly what just happened.
 */
export function recordLaunch(root, sessionId, toolResponse, { now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs } = {}) {
  const path = ledgerPath(root, sessionId)
  if (!path) return { written: false, path: null, reason: 'session id is not a safe file name' }
  const response = isObject(toolResponse) ? toolResponse : {}
  const entry = {
    at: iso(now),
    taskId: str(response.taskId),
    runId: str(response.runId),
    workflowName: str(response.workflowName),
    scriptPath: str(response.scriptPath)
  }
  const existing = readLedger(root, sessionId, { now, maxAgeMs })
  const ledger = existing
    ? { ...existing, sessionId, launches: [...existing.launches, entry] }
    : { schema: LEDGER_SCHEMA, sessionId, launches: [entry], lastHumanPromptAt: null }
  return writeLedger(path, ledger)
}

/**
 * Record a human prompt — only when the session already has a readable ledger.
 * One existence check and out when it does not, so a prompt creates no file and
 * no directory. Keeps the later of the recorded time and `now`.
 */
export function recordPrompt(root, sessionId, { now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs } = {}) {
  const path = ledgerPath(root, sessionId)
  if (!path) return { written: false, path: null, reason: 'session id is not a safe file name' }
  if (!existsSync(path)) return { written: false, path, reason: 'no ledger for this session' }
  const ledger = readLedger(root, sessionId, { now, maxAgeMs })
  if (!ledger) return { written: false, path, reason: 'ledger unreadable or stale' }
  const previous = promptMs(ledger)
  if (previous !== null && previous >= now) return { written: false, path, reason: 'a later prompt is already recorded' }
  return writeLedger(path, { ...ledger, lastHumanPromptAt: iso(now) })
}

/**
 * Remove sibling ledgers whose file is older than the published age, sparing
 * `keep` (the session just written). Only `.json` files in the ledger directory
 * are touched; a missing directory or a failed removal is a no-op.
 */
export function sweepStale(root, { now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs, keep } = {}) {
  const removed = []
  if (typeof root !== 'string') return { removed }
  const dir = join(root, LEDGER_DIR)
  let names
  try {
    names = readdirSync(dir).sort()
  } catch {
    return { removed }
  }
  for (const name of names) {
    if (!name.endsWith('.json') || (keep && name === `${keep}.json`)) continue
    try {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(path)
        removed.push(name)
      }
    } catch {
      // Another session may have swept or rewritten it first; nothing to say.
    }
  }
  return { removed }
}

/** The deny's words (design D3): what happened, the skill's rule, and the remedy. */
export function denyReason(lastLaunchAt) {
  return (
    `guard-relaunch: a ship workflow was already launched in this session at ${lastLaunchAt} ` +
    `and no human prompt has arrived since. skills/ship/SKILL.md: "${SKILL_QUOTE}." ` +
    `Send a new message that asks to ship the leftovers, or type /interlock:ship again, ` +
    `and the next launch is allowed.`
  )
}

/**
 * The rule. No ledger, or a stale one → allow. A launch newer than the last
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
