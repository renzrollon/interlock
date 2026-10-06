// The agent-usage sidecar (design D2, D3) — what a ship run learns about each
// agent it spawned and each permission event that interrupted it, from host
// events the run itself cannot see.
//
// A Workflow script's `agent()` returns its result and nothing else: no usage,
// no served model, no word of a permission prompt. The host does fire
// `SubagentStart`, `SubagentStop`, `PermissionDenied` and `PermissionRequest`
// hooks, and the stop names the agent's own transcript. The recorder
// (`hooks/recorder.mjs`) writes one small file per key here, and `run close`
// joins the agent files to the spawns it dispatched by the briefing sha each
// transcript carries.
//
// ONE FILE PER KEY, WHOLE-FILE WRITES. `.claude/ship/agent-usage/<runId>/
// <agentId>.json` per agent and `permission-<kind>-<atMs>-<pid>-<seq>.json` per
// permission event. Never a JSONL append, so a writer that can only replace a
// file (the Brief 9 mod's `$.fs.write`) writes the same records and the join
// does not change. The start writes only when the file is absent — the dedup
// across the start, resume and teammate-message firings the host documents —
// and the stop replaces it with the summed figures.
//
// OUTCOME-CLASS, NOT FATAL. A failed write is a stderr line from the hook and
// nothing more; the sidecar points at records the close derives, beside the
// interrupted-run note (`lib/interrupted.mjs`). The run trajectory's failed
// append exits 1 instead — deliberately; see docs/13-the-guards.md before making
// the two consistent.
//
// UNKNOWN IS NEVER ZERO. A figure any turn omits is `null` for the agent, a
// transcript that cannot be read is `null` throughout, and an absent directory
// is `present: false`, not an empty sidecar. A zero here would be read by the
// close as a measured cache miss.
//
// Every function collapses a failure to a value and never throws, because its
// callers are hooks, and a hook whose own crash is its output is worse than no
// hook. No subprocess, no git: one `mkdirSync` and one write per record.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHIP_DIR } from './ship-stage.mjs'

export const AGENT_USAGE_SCHEMA = 'interlock.agent-usage/1'

/** Where the sidecar lives, per run, in the working root beside `state.json`. */
export const AGENT_USAGE_DIR = join(SHIP_DIR, 'agent-usage')

/**
 * The one agent type the recorder's subagent branches accept (design D1). The
 * host reports it for every agent a Workflow script spawns, whatever `type` the
 * script named; a plugin agent type reaches a subagent event only as an
 * internal agent of a `claude --agent` session, which must write nothing. The
 * hook and the manifest-registration test import this one definition.
 */
export const WORKFLOW_AGENT_TYPE = 'workflow-subagent'

/**
 * Free text is bounded to the trajectory's own bound (`MAX_TEXT` in
 * `lib/run-log.mjs`; `test/spine/agent-usage.test.mjs` pins the two equal).
 * Restated rather than imported so a hook loads two small modules and not the
 * trajectory writer.
 */
export const TEXT_MAX = 500

/** The bound on the served-model list one agent record carries. */
export const MODELS_MAX = 8

/**
 * The join key: the sentence the bootstrap text ends on
 * (`test/fixtures/prompts/bootstrap.txt`). Not global, so callers share no
 * `lastIndex`; the summary scans with a global copy to find the last match.
 */
export const BRIEFING_SHA_PATTERN = /Expected sha256: ([0-9a-f]{64})/

const BRIEFING_SHA_SCAN = new RegExp(BRIEFING_SHA_PATTERN.source, 'g')

/** The model id the host writes on turns it made up itself (errors, interrupts). */
const SYNTHETIC_MODEL = '<synthetic>'

const PERMISSION_KINDS = Object.freeze(['denied', 'request'])

/** Agent files share the directory with permission files; an agent id must not read back as one. */
const PERMISSION_PREFIX = 'permission-'

function messageOf(err) {
  return (err && err.message) || String(err)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** A string bounded to `TEXT_MAX`, or `null` for anything that is not a string. */
function boundedString(value) {
  if (typeof value !== 'string') return null
  return value.length > TEXT_MAX ? `${value.slice(0, TEXT_MAX - 1)}…` : value
}

/** The host's reason, stored as given and bounded; anything non-null that is not a string is stringified. */
function boundedReason(value) {
  if (value === undefined || value === null) return null
  return boundedString(typeof value === 'string' ? value : String(value))
}

function timestamp(at) {
  return typeof at === 'string' ? at : new Date().toISOString()
}

/**
 * An id safe to name a file or directory after: the shape `createRunState`
 * mints and the host's agent ids, and nothing with a separator — the same rule
 * `lib/interrupted.mjs` holds for run ids.
 */
export function isSafeSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value.length <= 200
}

/** The run's sidecar directory, rooted at `root`, or `null` for an unsafe run id. */
export function agentUsageDir(root, runId) {
  if (!isSafeSegment(runId)) return null
  return join(root, AGENT_USAGE_DIR, runId)
}

/**
 * One agent's file: `<root>/.claude/ship/agent-usage/<runId>/<agentId>.json`,
 * or `null` when either id is not a safe segment — or when the agent id would
 * read back as a permission record.
 */
export function agentFilePath(root, runId, agentId) {
  const dir = agentUsageDir(root, runId)
  if (dir === null || !isSafeSegment(agentId) || agentId.startsWith(PERMISSION_PREFIX)) return null
  return join(dir, `${agentId}.json`)
}

/** Milliseconds from an ISO string or a number, or `null`. */
function stampOf(at) {
  if (typeof at === 'number') return Number.isFinite(at) && at >= 0 ? Math.trunc(at) : null
  if (typeof at === 'string') {
    const ms = Date.parse(at)
    return Number.isFinite(ms) && ms >= 0 ? ms : null
  }
  return null
}

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * One permission event's file:
 * `<root>/.claude/ship/agent-usage/<runId>/permission-<denied|request>-<atMs>-<pid>-<seq>.json`,
 * or `null` on an unsafe run id, a kind that is neither, or a stamp, pid or
 * sequence number that is not a non-negative integer.
 */
export function permissionFilePath(root, runId, kind, at, pid, seq) {
  const dir = agentUsageDir(root, runId)
  const ms = stampOf(at)
  if (dir === null || !PERMISSION_KINDS.includes(kind) || ms === null || !isCounter(pid) || !isCounter(seq)) return null
  return join(dir, `${PERMISSION_PREFIX}${kind}-${ms}-${pid}-${seq}.json`)
}

// ---------------------------------------------------------------- the transcript

/** A usage figure as a finite non-negative number, or `null` for omitted. */
function figure(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** One turn's cache creation: the tier split, a total with the split unknown, or unknown. */
function cacheCreationOf(usage) {
  const tiers = usage.cache_creation
  if (isObject(tiers)) {
    const m5 = figure(tiers.ephemeral_5m_input_tokens)
    const h1 = figure(tiers.ephemeral_1h_input_tokens)
    if (m5 !== null && h1 !== null) return { ephemeral_5m: m5, ephemeral_1h: h1 }
  }
  const total = figure(usage.cache_creation_input_tokens)
  return total === null ? null : { total }
}

/** A sum over turns that is `null` the moment any turn omitted the figure. */
function sumOrNull(values) {
  let sum = 0
  for (const v of values) {
    if (v === null) return null
    sum += v
  }
  return sum
}

function sumCacheCreation(turns) {
  const each = turns.map(cacheCreationOf)
  if (each.some(c => c === null)) return null
  if (each.every(c => 'ephemeral_5m' in c)) {
    return {
      ephemeral_5m: each.reduce((s, c) => s + c.ephemeral_5m, 0),
      ephemeral_1h: each.reduce((s, c) => s + c.ephemeral_1h, 0)
    }
  }
  return { total: each.reduce((s, c) => s + ('total' in c ? c.total : c.ephemeral_5m + c.ephemeral_1h), 0) }
}

/** The text a user line carries: string content, or its `text` blocks — never a `tool_result`. */
function userTexts(message) {
  if (!isObject(message)) return []
  const { content } = message
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter(b => isObject(b) && b.type === 'text' && typeof b.text === 'string').map(b => b.text)
}

function lastBriefingSha(texts) {
  let sha = null
  for (const text of texts) {
    for (const m of text.matchAll(BRIEFING_SHA_SCAN)) sha = m[1]
  }
  return sha
}

/**
 * Summarize one agent's transcript (JSON Lines). Pure; never throws.
 *
 * A TURN IS ONE ASSISTANT MESSAGE, NOT ONE LINE. The host writes one
 * `assistant` line per content block (thinking, text, each tool call) and
 * repeats the request's `message.usage` on every one, with the final output
 * count only on the last. Lines whose `message.usage` is an object are grouped
 * by `message.id`, else `requestId`, else the line itself, and the last line of
 * each group is that turn's usage. Summing per line would double every input.
 *
 * THE JOIN KEY is the LAST briefing sha in the `user` lines that precede the
 * FIRST `assistant` line. Last, and over every pre-assistant user line rather
 * than the first: the 2.1.289 engine relays the user's own request as a first
 * harness user turn and puts the computed task, indented, in a second, and the
 * bootstrap's sha line is the last line it writes. Stopping at the first
 * assistant line: tool results are `user` lines too, so an agent that reads a
 * file carrying bootstrap text must not rejoin itself to another spawn.
 *
 * @param {string} text
 * @returns {{
 *   usage: null | {inputTokens: number|null, outputTokens: number|null, cacheReadInputTokens: number|null,
 *     cacheCreationInputTokens: null | {ephemeral_5m: number, ephemeral_1h: number} | {total: number}},
 *   models: string[], turns: number, briefingSha: string|null, skipped: number, reason: string|null
 * }}
 */
export function summarizeTranscript(text) {
  if (typeof text !== 'string') {
    return { usage: null, models: [], turns: 0, briefingSha: null, skipped: 0, reason: 'transcript is not text' }
  }
  let skipped = 0
  let parsedLines = 0
  let seenAssistant = false
  const briefingTexts = []
  const groups = new Map()
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    let row
    try {
      row = JSON.parse(lines[index])
    } catch {
      skipped++
      continue
    }
    parsedLines++
    if (!isObject(row)) continue
    if (row.type === 'user' && !seenAssistant) briefingTexts.push(...userTexts(row.message))
    if (row.type !== 'assistant') continue
    seenAssistant = true
    const message = row.message
    if (!isObject(message) || !isObject(message.usage)) continue
    const key =
      typeof message.id === 'string' && message.id
        ? `id:${message.id}`
        : typeof row.requestId === 'string' && row.requestId
          ? `request:${row.requestId}`
          : `line:${index}`
    // A Map keeps the first-seen order of its keys; the value is the group's last line.
    groups.set(key, message)
  }

  const briefingSha = lastBriefingSha(briefingTexts)
  const turns = [...groups.values()]
  const models = []
  for (const message of turns) {
    const model = message.model
    if (typeof model !== 'string' || !model || model === SYNTHETIC_MODEL || models.includes(model)) continue
    if (models.length < MODELS_MAX) models.push(model)
  }

  if (turns.length === 0) {
    const reason =
      parsedLines === 0
        ? skipped > 0
          ? `no line of the transcript parsed (${skipped} skipped)`
          : 'transcript is empty'
        : 'no assistant turn with usage'
    return { usage: null, models, turns: 0, briefingSha, skipped, reason }
  }

  const usages = turns.map(m => m.usage)
  const usage = {
    inputTokens: sumOrNull(usages.map(u => figure(u.input_tokens))),
    outputTokens: sumOrNull(usages.map(u => figure(u.output_tokens))),
    cacheReadInputTokens: sumOrNull(usages.map(u => figure(u.cache_read_input_tokens))),
    cacheCreationInputTokens: sumCacheCreation(usages)
  }
  return { usage, models, turns: turns.length, briefingSha, skipped, reason: null }
}

/**
 * Summarize the transcript at `path`. Never throws. A file that cannot be read
 * is unknown throughout — `usage`, `models`, `turns`, `briefingSha` and
 * `skipped` all `null` — never zero or empty. `transcript.parsed` says whether
 * the file was read; `transcript.reason` says why there is no usage, or how
 * many torn lines were skipped when there is.
 *
 * @returns {ReturnType<typeof summarizeTranscript> & {transcript: {path: string|null, parsed: boolean, reason: string|null}}}
 */
export function summarizeTranscriptFile(path) {
  const unread = reason => ({
    usage: null,
    models: null,
    turns: null,
    briefingSha: null,
    skipped: null,
    reason,
    transcript: { path: typeof path === 'string' ? path : null, parsed: false, reason }
  })
  if (typeof path !== 'string' || !path) return unread('the event named no transcript path')
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    return unread(`transcript unreadable: ${messageOf(err)}`)
  }
  const summary = summarizeTranscript(text)
  const reason =
    summary.reason !== null
      ? summary.reason
      : summary.skipped > 0
        ? `${summary.skipped} unparseable line${summary.skipped === 1 ? '' : 's'} skipped`
        : null
  return { ...summary, transcript: { path, parsed: true, reason } }
}

// ---------------------------------------------------------------- the writers

function writeRecord(dir, path, record, flag) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(record, null, 2) + '\n', flag ? { flag } : undefined)
    return { written: true, path }
  } catch (err) {
    if (flag === 'wx' && err && err.code === 'EEXIST') return { written: false, reason: 'already recorded' }
    return { written: false, reason: `${path}: ${messageOf(err)}` }
  }
}

function refusedIds(runId, agentId) {
  if (!isSafeSegment(runId)) return `not a usable run id: ${JSON.stringify(runId)}`
  return `not a usable agent id: ${JSON.stringify(agentId)}`
}

/**
 * Record an agent's start: the file is written only when absent (exclusive
 * create), so the start, resume and teammate-message firings of one agent leave
 * one record, and a start arriving after the stop changes nothing.
 *
 * @param {string} root
 * @param {{runId: string, agentId: string, agentType?: string, at?: string}} event
 * @returns {{written: true, path: string} | {written: false, reason: string}}
 */
export function writeAgentStart(root, { runId, agentId, agentType, at } = {}) {
  const path = agentFilePath(root, runId, agentId)
  if (path === null) return { written: false, reason: refusedIds(runId, agentId) }
  const record = {
    schema: AGENT_USAGE_SCHEMA,
    agentId,
    agentType: boundedString(agentType),
    startedAt: timestamp(at),
    stoppedAt: null,
    briefingSha: null,
    models: null,
    turns: null,
    usage: null,
    transcript: null
  }
  return writeRecord(agentUsageDir(root, runId), path, record, 'wx')
}

/** The start time an existing record carries, or `null` when there is none to read. */
function recordedStart(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return isObject(value) && typeof value.startedAt === 'string' ? value.startedAt : null
  } catch {
    return null
  }
}

/**
 * Record an agent's stop: summarize its transcript and replace the file with
 * the summed figures, keeping the start time a readable earlier record carries.
 * A transcript that cannot be read is recorded with `usage: null` and the
 * reason, never with zeros.
 *
 * @param {string} root
 * @param {{runId: string, agentId: string, agentType?: string, at?: string, transcriptPath?: string}} event
 * @returns {{written: true, path: string} | {written: false, reason: string}}
 */
export function writeAgentStop(root, { runId, agentId, agentType, at, transcriptPath } = {}) {
  const path = agentFilePath(root, runId, agentId)
  if (path === null) return { written: false, reason: refusedIds(runId, agentId) }
  const summary = summarizeTranscriptFile(transcriptPath)
  const record = {
    schema: AGENT_USAGE_SCHEMA,
    agentId,
    agentType: boundedString(agentType),
    startedAt: recordedStart(path),
    stoppedAt: timestamp(at),
    briefingSha: summary.briefingSha,
    models: summary.models,
    turns: summary.turns,
    usage: summary.usage,
    transcript: summary.transcript
  }
  return writeRecord(agentUsageDir(root, runId), path, record)
}

/** Distinguishes two events one process records within one millisecond. */
let nextSeq = 0

/**
 * Record one permission event as one new file (exclusive create). Each field is
 * copied by name and bounded; `reason` is `null` when the host gave none, as the
 * captured `PermissionRequest` does. The tool input and the host's permission
 * suggestions are never recorded — this function does not even accept them.
 *
 * @param {string} root
 * @param {{runId: string, kind: 'denied'|'request', at?: string, agentId?: string, tool?: string,
 *   reason?: string, pid?: number, seq?: number}} event
 * @returns {{written: true, path: string} | {written: false, reason: string}}
 */
export function writePermissionEvent(root, { runId, kind, at, agentId, tool, reason, pid, seq } = {}) {
  if (!isSafeSegment(runId)) return { written: false, reason: `not a usable run id: ${JSON.stringify(runId)}` }
  if (!PERMISSION_KINDS.includes(kind)) return { written: false, reason: `not a permission event kind: ${JSON.stringify(kind)}` }
  const when = timestamp(at)
  const path = permissionFilePath(
    root,
    runId,
    kind,
    // The stamp only orders and separates file names; the record keeps `at` as given.
    stampOf(when) ?? Date.now(),
    pid === undefined ? process.pid : pid,
    seq === undefined ? nextSeq++ : seq
  )
  if (path === null) return { written: false, reason: `not a usable pid or sequence number: ${JSON.stringify({ pid, seq })}` }
  const record = {
    schema: AGENT_USAGE_SCHEMA,
    kind,
    at: when,
    agentId: boundedString(agentId),
    tool: boundedString(tool),
    reason: boundedReason(reason)
  }
  return writeRecord(agentUsageDir(root, runId), path, record, 'wx')
}

// ---------------------------------------------------------------- the reader

function isAgentRecord(value) {
  return isObject(value) && value.schema === AGENT_USAGE_SCHEMA && typeof value.agentId === 'string' && value.agentId !== ''
}

function isPermissionRecord(value) {
  return isObject(value) && value.schema === AGENT_USAGE_SCHEMA && PERMISSION_KINDS.includes(value.kind)
}

/**
 * Every record of one run. `present: false` only when the run's directory does
 * not exist — that is how the close tells "no sidecar" from "an empty one". A
 * file that does not parse, or parses to something that is not a record, is
 * returned under `unreadable` by its root-relative name and reason — never
 * dropped, because an agent nobody can read is still an agent the run spawned.
 *
 * @returns {{present: boolean, agents: object[], permissions: object[], unreadable: Array<{file: string, reason: string}>}}
 */
export function readAgentUsage(root, runId) {
  if (!isSafeSegment(runId)) {
    return {
      present: false,
      agents: [],
      permissions: [],
      unreadable: [{ file: AGENT_USAGE_DIR, reason: `not a usable run id: ${JSON.stringify(runId)}` }]
    }
  }
  const relDir = join(AGENT_USAGE_DIR, runId)
  let names
  try {
    names = readdirSync(join(root, relDir)).filter(name => name.endsWith('.json')).sort()
  } catch (err) {
    if (err && err.code === 'ENOENT') return { present: false, agents: [], permissions: [], unreadable: [] }
    return { present: true, agents: [], permissions: [], unreadable: [{ file: relDir, reason: messageOf(err) }] }
  }
  const agents = []
  const permissions = []
  const unreadable = []
  for (const name of names) {
    const file = join(relDir, name)
    let value
    try {
      value = JSON.parse(readFileSync(join(root, file), 'utf8'))
    } catch (err) {
      unreadable.push({ file, reason: messageOf(err) })
      continue
    }
    if (name.startsWith(PERMISSION_PREFIX)) {
      if (isPermissionRecord(value)) permissions.push({ ...value, file })
      else unreadable.push({ file, reason: 'not a permission record: no known kind or schema' })
    } else if (isAgentRecord(value)) {
      agents.push({ ...value, file })
    } else {
      unreadable.push({ file, reason: 'not an agent record: no agentId or schema' })
    }
  }
  return { present: true, agents, permissions, unreadable }
}
