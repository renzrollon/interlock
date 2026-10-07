// The launch ledger: the file transport of the launch rule, which
// `hooks/guard-relaunch.mjs` reads to decide whether a ship launch is a
// relaunch nobody asked for (guard-ship-relaunch design D2, D3).
//
// The rule itself — what a ship launch is, what a human prompt is, the
// decision and its words — lives in `lib/launch-rule.mjs`, which the hooks
// module imports too (guard-ship-relaunch-in-process design D1). This module
// re-exports every name of it unchanged, so the settings hook and its tests
// import what they always imported and one function decides in both forms.
// What stays here is the file: per session, the ship launches the runtime
// accepted and the time of the last human prompt.
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
import { LEDGER_SCHEMA, emptyRecord, newestLaunch, promptMs, withLaunch, withPrompt } from './launch-rule.mjs'
import { SHIP_DIR } from './ship-stage.mjs'

export {
  LEDGER_SCHEMA,
  SKILL_QUOTE,
  WAKE_MARKER,
  decideLaunch,
  denyReason,
  emptyRecord,
  isAcceptedLaunch,
  isHumanPrompt,
  isShipLaunch,
  newestLaunch,
  promptMs,
  withLaunch,
  withPrompt
} from './launch-rule.mjs'

/** Where the ledgers live, beside the stage markers and the trajectory. */
export const LEDGER_DIR = join(SHIP_DIR, 'launch-ledger')

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const iso = ms => new Date(ms).toISOString()
const str = value => (typeof value === 'string' && value ? value : null)
const messageOf = err => (err && err.message) || String(err)

/** Safe as a file name: the trajectory's run-id rule (`lib/run-log.mjs`). */
function isSafeSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) && !value.includes('..')
}

/** The session's ledger path, or null when the session id cannot name a file. */
export function ledgerPath(root, sessionId) {
  if (typeof root !== 'string' || !isSafeSessionId(sessionId)) return null
  return join(root, LEDGER_DIR, `${sessionId}.json`)
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
 * launch, no prompt since" — exactly what just happened. The record is changed
 * by `withLaunch`, the transform the hooks module applies to its state record.
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
  return writeLedger(path, withLaunch({ ...(existing || emptyRecord()), sessionId }, entry, maxAgeMs))
}

/**
 * Record a human prompt — only when the session already has a readable ledger.
 * One existence check and out when it does not, so a prompt creates no file and
 * no directory. Keeps the later of the recorded time and `now`, through
 * `withPrompt`, the hooks module's transform too.
 */
export function recordPrompt(root, sessionId, { now = Date.now(), maxAgeMs = LIMITS.launchLedgerMaxAgeMs } = {}) {
  const path = ledgerPath(root, sessionId)
  if (!path) return { written: false, path: null, reason: 'session id is not a safe file name' }
  if (!existsSync(path)) return { written: false, path, reason: 'no ledger for this session' }
  const ledger = readLedger(root, sessionId, { now, maxAgeMs })
  if (!ledger) return { written: false, path, reason: 'ledger unreadable or stale' }
  const previous = promptMs(ledger)
  if (previous !== null && previous >= now) return { written: false, path, reason: 'a later prompt is already recorded' }
  return writeLedger(path, withPrompt(ledger, iso(now)))
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
