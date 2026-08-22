// The ship-run trajectory (design.md decision 1) — one append-only JSON Lines
// file per `/interlock:ship` run, so a halt can be reconstructed later.
//
// This is a different corpus from `.claude/learning/outcomes.jsonl`
// (`lib/outcomes.mjs`): outcomes is one summary line per planning→ship
// attempt and is explicitly not a gate. This file is per-step — every
// wave-state action, load-bearing CLI exit, agent spawn the workflow
// requested, and verify judgement — so that a halted run can be replayed
// without reading git history. Mixing the two corpora would poison the
// continuity corpus outcomes.mjs exists to keep clean.
//
// Third impure module in `lib/`, copying `lib/outcomes.mjs`'s contract:
//
//   1. **It never throws.** A read-only checkout or an unwritable `.claude/`
//      degrades to a reported no-op — see design.md's two-phase failure
//      policy. (The later reconstructability *gate* that turns a write
//      failure into a halt is a separate module, added in a later task.)
//   2. **It writes a fixed shape, not whatever it was handed.** Fields are
//      copied by name per event `type`, so handing the writer a fat object
//      (a verify result, a wave-state cursor) cannot leak suite logs, diffs,
//      or finding bodies into a file future agents will read back.
//
// Append-only, one JSON object per line. The reader (added with
// session-query, a later task) tolerates a torn final line the same way
// `outcomes.mjs` does: a log truncated by a crash costs at most the one
// record being written, never the records before it.
//
// `seq` is assigned by this writer, never by the caller: it is derived from
// the highest `seq` already present in the run's file, so a caller cannot
// invent contiguity that never happened.
//
// Exposed to skills as `interlock run-log append` (later tasks add
// `list`/`show`/`query`/`check`).

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'

/** Where per-run trajectories live, relative to the repo root. */
export const SHIP_DIR = join('.claude', 'ship')

/** Directory holding one JSONL file per run, relative to the repo root. */
export const RUN_LOG_DIR = join(SHIP_DIR, 'runs')

/** Bump when the record shape changes, so old lines stay readable. */
export const RUN_LOG_SCHEMA = 'interlock.ship-run/1'

/** The event types a trajectory line may carry (design.md decision 2). */
export const RUN_LOG_TYPES = Object.freeze([
  'run-start',
  'wave-action',
  'cli-exit',
  'agent-spawn',
  'verify-judgement',
  'run-halt',
  'run-complete'
])

/** The two modes a run starts in — mirrors `lib/outcomes.mjs`'s `MODES`. */
export const RUN_MODES = Object.freeze(['checkpoint', 'continue'])

/** Verify contexts a `verify-judgement` event may report. */
export const VERIFY_CONTEXTS = Object.freeze(['inter-wave', 'final'])

/** Agent kinds a `agent-spawn` event may report. */
export const AGENT_KINDS = Object.freeze(['implementer', 'ping', 'verify', 'review', 'other'])

/** Wave-state sources a `wave-action` event may report. */
export const WAVE_SOURCES = Object.freeze(['create', 'next', 'record-batch', 'record-verify', 'replan'])

const MAX_TEXT = 500
const MAX_NAME = 120
const MAX_LABEL = 200
const MAX_COMMAND = 120
const MAX_ACTION = 40

function messageOf(err) {
  return (err && err.message) || String(err)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return ''
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// Like `text`, but an empty result stays `null` rather than `''` — this file
// distinguishes "field not given" from "field given as empty string" for
// fields that are meaningfully absent (a task id, a wave label).
function nullableText(value, max = MAX_TEXT) {
  const s = text(value, max)
  return s ? s : null
}

function count(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

function nullableCount(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.trunc(n)
}

// Judgements in this log are definite (a CLI already decided them), so unlike
// `outcomes.mjs`'s tri-state `bool`, an unrecognized value coerces to `false`
// rather than `null` — there is no "nobody said" here, only a caller that
// passed something malformed.
function boolStrict(value) {
  return value === true
}

function enumOf(allowed, value, fallback = null) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function stringArray(value, max = MAX_TEXT) {
  if (!Array.isArray(value)) return []
  return value.filter(v => typeof v === 'string').map(v => text(v, max))
}

// Safe as a path segment: bounded, no separators, no traversal. `runId` is
// generated internally (design.md: a UUID stored on the frozen wave-state),
// but this module also accepts it from a CLI argument, so it is validated
// like any other externally-supplied path component.
function isSafeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) && !value.includes('..')
}

// Fields copied by name for each event `type`. Anything on the caller's input
// that is not listed here for the given `type` is dropped — this is the
// anti-leak guarantee from the module header, and it is what lets a caller
// hand this a whole verify result or wave-state cursor safely.
const TYPE_FIELDS = {
  'run-start': {
    mode: source => enumOf(RUN_MODES, source.mode, null),
    strict: source => boolStrict(source.strict)
  },
  'wave-action': {
    action: source => nullableText(source.action, MAX_ACTION),
    wave: source => nullableText(source.wave, MAX_NAME),
    waveIndex: source => nullableCount(source.waveIndex),
    batchIndex: source => nullableCount(source.batchIndex),
    phase: source => nullableText(source.phase, MAX_ACTION),
    source: source => enumOf(WAVE_SOURCES, source.source, null)
  },
  'cli-exit': {
    command: source => text(source.command, MAX_COMMAND),
    exitCode: source => count(source.exitCode),
    durationMs: source => nullableCount(source.durationMs)
  },
  'agent-spawn': {
    label: source => text(source.label, MAX_LABEL),
    model: source => nullableText(source.model, 60),
    kind: source => enumOf(AGENT_KINDS, source.kind, 'other'),
    taskId: source => nullableText(source.taskId, MAX_NAME)
  },
  'verify-judgement': {
    context: source => enumOf(VERIFY_CONTEXTS, source.context, null),
    halt: source => boolStrict(source.halt),
    reason: source => text(source.reason),
    unitStatus: source => nullableText(source.unitStatus, MAX_ACTION),
    spill: source => stringArray(source.spill, 300)
  },
  'run-halt': {
    reason: source => text(source.reason)
  },
  'run-complete': {
    leftoverTaskIds: source => stringArray(source.leftoverTaskIds, MAX_NAME)
  }
}

/** Directory a run's trajectories live under, absolute from `root`. */
export function runLogDir(root) {
  return join(root, RUN_LOG_DIR)
}

/** Absolute path of one run's trajectory file. */
export function runLogPath(root, runId) {
  return join(runLogDir(root), `${runId}.jsonl`)
}

// If a previous append was torn mid-line (crash, full disk), a naive append
// would splice the new record onto the broken one and destroy two records
// instead of one. Reading the final byte is cheap and makes the log
// self-healing at the seam. Copied from `lib/outcomes.mjs`.
function endsWithNewline(file) {
  const size = statSync(file).size
  if (size === 0) return true
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1)
    readSync(fd, buf, 0, 1, size - 1)
    return buf[0] === 0x0a
  } finally {
    closeSync(fd)
  }
}

// The next `seq` for a run is one past the highest `seq` already on disk —
// never supplied by the caller. A line that fails to parse (e.g. a torn
// final line left by a prior crash) is skipped for this purpose: the heal in
// `appendRunLogEvent` repairs the seam, this just refuses to trust a broken
// line's claimed `seq`.
function nextSeq(file) {
  if (!existsSync(file)) return 1
  try {
    const lines = readFileSync(file, 'utf8').split('\n')
    let max = 0
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (isObject(parsed) && Number.isFinite(parsed.seq) && parsed.seq > max) {
          max = parsed.seq
        }
      } catch {
        // Torn or corrupt line: does not count toward seq. The append heal
        // below still protects it from being merged with the new record.
      }
    }
    return max + 1
  } catch {
    return 1
  }
}

/**
 * Append one trajectory event to `.claude/ship/runs/<runId>.jsonl`.
 *
 * Only `schema`, `ts`, `runId`, `change`, `seq`, `type`, and the fields listed
 * in `TYPE_FIELDS` for that `type` are ever written — anything else on
 * `input` is ignored, so a caller may pass a whole verify result or
 * wave-state cursor without leaking its text into the log.
 *
 * @param {string} root repo root; `.claude/ship/runs` is created beneath it
 * @param {{
 *   runId?: string,
 *   type?: 'run-start'|'wave-action'|'cli-exit'|'agent-spawn'|'verify-judgement'|'run-halt'|'run-complete',
 *   change?: string,
 *   now?: Date|string,
 *   [field: string]: unknown
 * }} [input] extra keys are read only for the fields the given `type` declares
 * @returns {{written: boolean, path: string|null, reason: string|null, seq: number|null}}
 *   `reason` explains a `written: false` — it is never an exception
 */
export function appendRunLogEvent(root, input = {}) {
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return { written: false, path: null, reason: 'no root directory given', seq: null }
    }
    if (!existsSync(root)) {
      return { written: false, path: null, reason: `root does not exist: ${root}`, seq: null }
    }
    const source = isObject(input) ? input : {}

    const runId = typeof source.runId === 'string' ? source.runId.trim() : ''
    if (!isSafeId(runId)) {
      return { written: false, path: null, reason: 'runId must be a non-empty safe identifier', seq: null }
    }

    const type = typeof source.type === 'string' ? source.type.trim() : ''
    const fields = TYPE_FIELDS[type]
    if (!fields) {
      return { written: false, path: null, reason: `type must be one of ${RUN_LOG_TYPES.join(', ')}`, seq: null }
    }

    const when = source.now instanceof Date ? source.now : new Date(source.now || Date.now())
    const iso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString()

    const dir = runLogDir(root)
    mkdirSync(dir, { recursive: true })
    const file = runLogPath(root, runId)

    // Assigned here, from what is already on disk — never trusted from the
    // caller (design.md decision 2).
    const seq = nextSeq(file)

    // Built key by key: see the module header. Nothing not named in
    // `TYPE_FIELDS[type]` is written, whatever the caller passed.
    const extra = {}
    for (const key of Object.keys(fields)) extra[key] = fields[key](source)

    const payload = {
      schema: RUN_LOG_SCHEMA,
      ts: iso,
      runId,
      change: text(source.change, MAX_NAME) || 'unnamed',
      seq,
      type,
      ...extra
    }

    const prefix = existsSync(file) && !endsWithNewline(file) ? '\n' : ''
    // JSON.stringify never emits a raw newline, so one record is always one line.
    appendFileSync(file, `${prefix}${JSON.stringify(payload)}\n`)
    return { written: true, path: file, reason: null, seq }
  } catch (err) {
    // Deliberately swallowed: see the module header. The caller gets a
    // reason, never an exception — a run must not fail because its
    // trajectory could not grow (until the later reconstructability gate).
    return { written: false, path: null, reason: messageOf(err), seq: null }
  }
}

// ---------------------------------------------------------------------------
// Session-query (design.md decision 4) — read-only, never-throw, and tolerant
// of a torn or garbage line the same way `lib/outcomes.mjs`'s reader is:
// skip the bad line, keep the rest, report which line numbers were skipped.
// None of this interprets events as a new state machine; it reports the log.
// ---------------------------------------------------------------------------

/**
 * Read one run's trajectory back, in order.
 *
 * @param {string} root repo root
 * @param {string} runId
 * @returns {{
 *   path: string|null, exists: boolean,
 *   records: object[], skipped: Array<{line: number, reason: string}>,
 *   reason: string|null
 * }}
 */
export function readRunLog(root, runId) {
  if (typeof root !== 'string' || !root.trim()) {
    return { path: null, exists: false, records: [], skipped: [], reason: 'no root directory given' }
  }
  if (!isSafeId(typeof runId === 'string' ? runId.trim() : '')) {
    return { path: null, exists: false, records: [], skipped: [], reason: 'runId must be a non-empty safe identifier' }
  }
  const path = runLogPath(root, runId.trim())
  try {
    if (!existsSync(path)) {
      return { path, exists: false, records: [], skipped: [], reason: null }
    }
    const lines = readFileSync(path, 'utf8').split('\n')
    const records = []
    const skipped = []
    lines.forEach((line, i) => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line)
        if (isObject(parsed)) records.push(parsed)
        else skipped.push({ line: i + 1, reason: 'line is not a JSON object' })
      } catch (err) {
        skipped.push({ line: i + 1, reason: messageOf(err) })
      }
    })
    return { path, exists: true, records, skipped, reason: null }
  } catch (err) {
    return { path, exists: true, records: [], skipped: [], reason: messageOf(err) }
  }
}

// One run's list-level summary: enough to tell runs apart without reading
// every event out to the caller.
function summarizeRunLog(root, runId) {
  const read = readRunLog(root, runId)
  const records = read.records
  const start = records.find(r => r.type === 'run-start')
  const halt = records.find(r => r.type === 'run-halt')
  const complete = records.find(r => r.type === 'run-complete')
  return {
    runId,
    change: (start && start.change) || (records[0] && records[0].change) || null,
    halted: Boolean(halt),
    haltReason: halt ? halt.reason : null,
    complete: Boolean(complete),
    events: records.length,
    skipped: read.skipped.length,
    startedAt: start ? start.ts : (records[0] ? records[0].ts : null)
  }
}

/**
 * List every run that has a trajectory file, most recently started last.
 * Never throws: a missing or unreadable runs directory is an empty list, the
 * same way an absent outcomes corpus is empty rather than an error.
 *
 * @param {string} root repo root
 * @param {{change?: string}} [opts] filter to one change name
 * @returns {Array<ReturnType<typeof summarizeRunLog>>}
 */
export function listRunLogs(root, opts = {}) {
  if (typeof root !== 'string' || !root.trim()) return []
  const dir = runLogDir(root)
  let entries
  try {
    entries = existsSync(dir) ? readdirSync(dir) : []
  } catch {
    return []
  }
  const runIds = entries.filter(name => name.endsWith('.jsonl')).map(name => name.slice(0, -'.jsonl'.length))
  const summaries = runIds.map(runId => summarizeRunLog(root, runId))
  summaries.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')))
  const change = isObject(opts) && typeof opts.change === 'string' ? opts.change.trim() : ''
  return change ? summaries.filter(s => s.change === change) : summaries
}

/**
 * Read one run's trajectory, filtered by event type and/or halt-relevance.
 * `halted: true` narrows to the events that explain a halt — the `run-halt`
 * line itself, plus any `verify-judgement` that halted — rather than every
 * line in the run; combine with `type` to narrow further.
 *
 * @param {string} root repo root
 * @param {string} runId
 * @param {{type?: string, halted?: boolean}} [opts]
 * @returns {ReturnType<typeof readRunLog> } same shape as `readRunLog`, `records` filtered
 */
export function queryRunLog(root, runId, opts = {}) {
  const read = readRunLog(root, runId)
  let records = read.records
  const type = isObject(opts) && typeof opts.type === 'string' ? opts.type.trim() : ''
  if (type) records = records.filter(r => r.type === type)
  if (isObject(opts) && opts.halted === true) {
    records = records.filter(r => r.type === 'run-halt' || r.halt === true)
  }
  return { ...read, records }
}

/** Human-readable rendering of `readRunLog` / `queryRunLog`, for the CLI. */
export function formatRunLog(result) {
  if (!result.exists) return `RUN LOG — none recorded (${result.path ?? RUN_LOG_DIR})\n`
  const lines = [`RUN LOG — ${result.records.length} event(s)`]
  if (result.skipped.length) {
    lines.push(`  ${result.skipped.length} unreadable line(s) skipped: ${result.skipped.map(s => s.line).join(', ')}`)
  }
  const OMIT = new Set(['schema', 'ts', 'runId', 'change', 'seq', 'type'])
  for (const r of result.records) {
    const extra = Object.keys(r)
      .filter(k => !OMIT.has(k))
      .map(k => `${k}=${JSON.stringify(r[k])}`)
      .join(' ')
    lines.push(`  #${r.seq}\t${r.type}${extra ? `\t${extra}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Reconstructability gate (design.md decision 4 / spec "Reconstructability is
// a gate invariant") — read-only itself; the CLI decides what a non-zero
// result means. Checks the three things the spec names: contiguous seq from
// 1, a run-start, a closing run-halt/run-complete, plus a logged cli-exit for
// every wave-state/verify-judge invocation. The last one is checkable purely
// from the log's own shape because both `wave-state` (via `wave-action`) and
// `verify judge` (via `verify-judgement`) always append their `cli-exit` in
// the same call that appends the semantic event — so a 1:1 count is exactly
// what "one per invocation" means here.
// ---------------------------------------------------------------------------

/**
 * @param {string} root repo root
 * @param {string} runId
 * @returns {{ok: boolean, runId: string, problems: string[], events: number}}
 */
export function checkRunLog(root, runId) {
  const read = readRunLog(root, runId)
  const problems = []

  if (!read.exists) {
    problems.push(`no trajectory file found for run ${runId}`)
    return { ok: false, runId, problems, events: 0 }
  }
  if (read.reason) problems.push(`trajectory unreadable: ${read.reason}`)
  if (read.skipped.length) {
    problems.push(`${read.skipped.length} unreadable line(s): ${read.skipped.map(s => s.line).join(', ')}`)
  }

  const records = read.records
  if (!records.length) problems.push('trajectory has no events')

  const seqs = records.map(r => r.seq).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  for (let i = 0; i < seqs.length; i++) {
    if (seqs[i] !== i + 1) {
      problems.push(`sequence gap: expected seq ${i + 1}, found ${seqs[i]}`)
      break
    }
  }

  if (!records.some(r => r.type === 'run-start')) problems.push('missing a run-start event')
  if (!records.some(r => r.type === 'run-halt' || r.type === 'run-complete')) {
    problems.push('missing a run-halt or run-complete event')
  }

  const invocations = records.filter(r => r.type === 'wave-action' || r.type === 'verify-judgement').length
  const exits = records.filter(r => r.type === 'cli-exit').length
  if (exits < invocations) {
    problems.push(`${invocations - exits} wave-state/verify-judge invocation(s) missing a cli-exit`)
  }

  return { ok: problems.length === 0, runId, problems, events: records.length }
}

/** Human-readable rendering of `checkRunLog`, for the CLI. */
export function formatRunLogCheck(result) {
  return result.ok
    ? `RECONSTRUCTABLE — run ${result.runId}, ${result.events} event(s)\n`
    : `INCOMPLETE — run ${result.runId}: ${result.problems.join('; ')}\n`
}

/** Human-readable rendering of `listRunLogs`, for the CLI. */
export function formatRunLogList(runs) {
  if (!runs.length) return '(no runs recorded)\n'
  return (
    runs
      .map(
        r =>
          `${r.runId}\tchange=${r.change ?? '(unknown)'}\t` +
          `${r.halted ? `HALTED (${r.haltReason || 'no reason recorded'})` : r.complete ? 'complete' : 'in-progress'}\t` +
          `events=${r.events}${r.skipped ? ` skipped=${r.skipped}` : ''}`
      )
      .join('\n') + '\n'
  )
}
