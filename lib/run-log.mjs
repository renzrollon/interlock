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
  'run-complete',
  'run-receipt'
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
const MAX_HASH = 80

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

// Tri-state, and the exception to the paragraph above: a receipt field has to
// keep "did not" apart from "never found out". Flooring an unobserved value to
// `false` would file a run that died before its commit step as a run that
// chose not to commit — the same defect `nullableCount` exists to prevent one
// type down. Same reasoning as `lib/outcomes.mjs`'s tri-state `bool`.
function nullableBool(value) {
  if (value === true) return true
  if (value === false) return false
  return null
}

// The per-wave tally group, built element by element with its own coercers.
// Passing the wave objects through — or spreading them — would defeat the
// whitelist one level down, and the summary a receipt is built from carries
// implementer handoffs and changed-file lists on those same objects.
function waveTallies(value) {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map(wave => ({
    wave: nullableText(typeof wave.wave === 'number' ? String(wave.wave) : wave.wave, MAX_NAME),
    ok: nullableCount(wave.ok),
    failed: nullableCount(wave.failed),
    notAttempted: nullableCount(
      Array.isArray(wave.notAttempted) ? wave.notAttempted.length : wave.notAttempted
    )
  }))
}

// The per-wave spend group, built element by element for the same reason
// `waveTallies` is: it comes off the orchestrator's `summary`, and spreading a
// wave object through would defeat the whitelist one level down.
//
// `nullableCount` on the figure, never `count`. A host with no token accounting,
// a runtime that stops exposing it mid-run, and a malformed value must all read
// as unknown — a `0` would assert a wave that spent nothing, which is never true
// of a wave that ran agents, so the error would be silent and systematic.
function waveSpend(value) {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).map(entry => ({
    wave: nullableText(typeof entry.wave === 'number' ? String(entry.wave) : entry.wave, MAX_NAME),
    outputTokens: nullableCount(entry.outputTokens)
  }))
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
    // WHAT THIS MEASURES: the execution time of the CLI command that wrote this
    // event — argument parsing, the lib/ call it made, and this append. Nothing
    // else.
    //
    // WHAT IT DOES NOT MEASURE: how long the agent turn around that command
    // took. `bin/interlock` runs BETWEEN agent turns and cannot observe one, so
    // an interval here is CLI self-time and is typically a millisecond or two.
    // Reading it as agent wall clock would understate a turn by three orders of
    // magnitude — hence the sentence rather than a bare field name.
    //
    // Wave and run elapsed time are NOT recorded anywhere: they are derived
    // from `ts` deltas by `deriveWaveElapsed` below. A recorded copy could
    // disagree with the timestamps that produced it, and one of the two would
    // be wrong in a way no reader could see.
    //
    // `nullableCount`, so a command that did not measure itself stays absent. A
    // `0` would assert an instantaneous command.
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
  },
  // The receipt: what the run observed about itself, so a trajectory file is
  // readable without the repository beside it. It is the largest payload in
  // this table and it is built from the orchestrator's whole `summary` object,
  // which holds a review result with finding bodies and a verify result with
  // suite output — so every field here is named, and the two nested groups are
  // built element by element rather than passed through.
  //
  // `nullable*` throughout, deliberately: a receipt written by a run that
  // halted before its review step must report the review counts as unobserved,
  // not as zero blockers. A corpus that reads absence as cleanliness would
  // systematically flatter exactly the runs it exists to explain.
  'run-receipt': {
    waves: source => waveTallies(source.waves),
    planReused: source => nullableBool(source.planReused),
    planStatus: source => nullableText(source.planStatus, MAX_ACTION),
    planReason: source => nullableText(source.planReason),
    planFingerprint: source => nullableText(source.planFingerprint, MAX_HASH),
    reviewRaised: source => nullableCount(source.reviewRaised),
    reviewSurviving: source => nullableCount(source.reviewSurviving),
    reviewBlockers: source => nullableCount(source.reviewBlockers),
    reviewWarnings: source => nullableCount(source.reviewWarnings),
    remediationRounds: source => nullableCount(source.remediationRounds),
    skippedVerifications: source => nullableCount(source.skippedVerifications),
    capExhaustedVerifications: source => nullableCount(source.capExhaustedVerifications),
    unresolvedErrors: source => nullableCount(source.unresolvedErrors),
    leftoverTaskIds: source => stringArray(source.leftoverTaskIds, MAX_NAME),
    // Output-token spend, per wave and for the run. The figure is a cumulative
    // process-wide delta over the wave's span, so it includes the
    // orchestrator's own turns as well as the implementers' — it is the wave's
    // aggregate and never per-lane cost. No per-agent attribution is recorded,
    // and none can be obtained by dividing this by the lane count: the runtime
    // exposes one counter for the process, not one per agent.
    //
    // A host whose runtime exposes no accounting records these as absent (see
    // `bin/interlock-ship-acp`), which is a different fact from a run that
    // measured and found nothing.
    spend: source => waveSpend(source.spend),
    outputTokens: source => nullableCount(source.outputTokens),
    halted: source => boolStrict(source.halted),
    haltReason: source => nullableText(source.haltReason),
    committed: source => nullableBool(source.committed),
    commit: source => nullableText(source.commit, MAX_NAME),
    degradations: source => stringArray(source.degradations)
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
 *   type?: 'run-start'|'wave-action'|'cli-exit'|'agent-spawn'|'verify-judgement'|'run-halt'|'run-complete'|'run-receipt',
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
  const receipt = records.find(r => r.type === 'run-receipt')
  return {
    runId,
    change: (start && start.change) || (records[0] && records[0].change) || null,
    halted: Boolean(halt) || Boolean(receipt && receipt.halted === true),
    haltReason: halt ? halt.reason : receipt ? nullableText(receipt.haltReason) : null,
    complete: Boolean(complete),
    // Reported separately from `complete`: a closed run with no receipt did not
    // reach its own close, and that is a finding rather than missing data. A
    // list that showed only `complete` would make the two indistinguishable.
    receipt: Boolean(receipt),
    committed: receipt ? nullableBool(receipt.committed) : null,
    commit: receipt ? nullableText(receipt.commit, MAX_NAME) : null,
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

/**
 * Per-wave elapsed time, derived from the timestamps the events already carry.
 *
 * There is deliberately no recorded wave-duration field for this to be checked
 * against: the `ts` values bound the wave, so recording a second copy would
 * create a value that can disagree with the one that produced it. This is the
 * only answer, which is why it cannot be contradicted.
 *
 * A wave opens at the first `wave-action` naming it and runs until the next one
 * names a different wave; everything in between is attributed to it. A wave
 * whose events are interleaved with a later re-entry (a replan sending the run
 * back through it) spans from its earliest event to its latest.
 *
 * The run's own close — its receipt and its halt/complete line — is attributed
 * to no wave. Those events happen after the last wave finished, and folding them
 * in would silently pad whichever wave happened to be last with the cost of
 * closing the run.
 *
 * Read-only and never throws: an unparseable `ts` is skipped, not guessed at.
 *
 * @param {object[]} records as returned by `readRunLog`/`queryRunLog`
 * @returns {Array<{wave: string, firstTs: string, lastTs: string, events: number, elapsedMs: number}>}
 */
export function deriveWaveElapsed(records) {
  const ordered = (Array.isArray(records) ? records : [])
    .filter(isObject)
    .slice()
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))

  const spans = new Map()
  const CLOSING = new Set(['run-receipt', 'run-halt', 'run-complete'])
  let current = null
  for (const r of ordered) {
    if (CLOSING.has(r.type)) {
      current = null
      continue
    }
    if (r.type === 'wave-action' && r.wave !== null && r.wave !== undefined && String(r.wave).trim()) {
      current = String(r.wave)
    }
    if (current === null) continue
    const at = Date.parse(r.ts)
    if (!Number.isFinite(at)) continue
    const found = spans.get(current)
    if (!found) {
      spans.set(current, { wave: current, firstTs: r.ts, lastTs: r.ts, first: at, last: at, events: 1 })
      continue
    }
    found.events += 1
    if (at < found.first) {
      found.first = at
      found.firstTs = r.ts
    }
    if (at > found.last) {
      found.last = at
      found.lastTs = r.ts
    }
  }

  return [...spans.values()].map(s => ({
    wave: s.wave,
    firstTs: s.firstTs,
    lastTs: s.lastTs,
    events: s.events,
    elapsedMs: s.last - s.first
  }))
}

// An absent receipt field is rendered as `unknown`, never as `0` or as blank.
// The generic `k=null` rendering below would be technically accurate and read
// as noise; `0 blockers` would read as a clean review that never ran.
function receiptLines(r) {
  const show = v => (v === null || v === undefined ? 'unknown' : String(v))
  const out = []
  out.push(r.halted === true ? `halted: ${show(r.haltReason)}` : 'halted: no')
  const reuse = r.planReused === true ? 'reused' : r.planReused === false ? 'rebuilt' : 'unknown'
  out.push(`plan: ${reuse} (${show(r.planStatus)}), fingerprint ${show(r.planFingerprint)}`)
  for (const wave of Array.isArray(r.waves) ? r.waves : []) {
    out.push(
      `wave ${show(wave.wave)}: ${show(wave.ok)} ok, ${show(wave.failed)} failed, ` +
        `${show(wave.notAttempted)} not attempted`
    )
  }
  out.push(
    `review: ${show(r.reviewRaised)} raised, ${show(r.reviewSurviving)} surviving, ` +
      `${show(r.reviewBlockers)} blockers, ${show(r.reviewWarnings)} warnings`
  )
  out.push(`remediation rounds: ${show(r.remediationRounds)}`)
  out.push(
    `verifications skipped: ${show(r.skippedVerifications)} ` +
      `(cap exhausted: ${show(r.capExhaustedVerifications)})`
  )
  out.push(`unresolved errors carried past a wave: ${show(r.unresolvedErrors)}`)
  // Framed on the line itself, not left to a schema comment nobody reading a
  // terminal will open: the figure covers everything that ran in the wave's
  // span, orchestrator turns included. A reader who takes it for implementer
  // cost, or divides it by the lane count, gets a number the run never measured.
  out.push('output tokens (aggregate over the wave span — orchestrator turns included, not implementer cost):')
  const spend = Array.isArray(r.spend) ? r.spend : []
  if (!spend.length) out.push('  per wave: none recorded')
  for (const entry of spend) out.push(`  wave ${show(entry.wave)}: ${show(entry.outputTokens)}`)
  out.push(`  run total: ${show(r.outputTokens)}`)
  const leftover = Array.isArray(r.leftoverTaskIds) ? r.leftoverTaskIds : []
  out.push(`leftover tasks: ${leftover.length ? leftover.join(', ') : 'none'}`)
  out.push(
    `commit: ${
      r.commit
        ? r.commit
        : r.committed === true
          ? 'created, no identifier recorded'
          : r.committed === false
            ? 'no commit was made'
            : 'unknown'
    }`
  )
  const degradations = Array.isArray(r.degradations) ? r.degradations : []
  out.push(`degradations: ${degradations.length ? '' : 'none recorded'}`.trimEnd())
  for (const line of degradations) out.push(`  ${line}`)
  return out
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
    if (r.type === 'run-receipt') {
      lines.push(`  #${r.seq}\t${r.type}`)
      for (const line of receiptLines(r)) lines.push(`    ${line}`)
      continue
    }
    const extra = Object.keys(r)
      .filter(k => !OMIT.has(k))
      // `durationMs` is the one field the generic renderer would misreport: the
      // fallback would print `durationMs=null`, and any tidier version of that
      // ("", `0ms`) would read as a command that took no time. An unmeasured
      // duration says so, and a measured one carries its unit so nobody reads
      // CLI self-time as an agent turn.
      .map(k =>
        k === 'durationMs'
          ? `durationMs=${r[k] === null || r[k] === undefined ? 'unknown' : `${r[k]}ms`}`
          : `${k}=${JSON.stringify(r[k])}`
      )
      .join(' ')
    lines.push(`  #${r.seq}\t${r.type}${extra ? `\t${extra}` : ''}`)
  }
  // Derived here rather than read from a field, because there is no field: see
  // `deriveWaveElapsed`. Said out loud so a reader knows which of the two kinds
  // of number this is.
  const elapsed = deriveWaveElapsed(result.records)
  if (elapsed.length) {
    lines.push('  WAVE ELAPSED — derived from event timestamps, not a recorded field')
    for (const w of elapsed) {
      lines.push(`    wave ${w.wave}: ${w.elapsedMs}ms across ${w.events} event(s)`)
    }
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

  // `run-receipt` is a valid type and deliberately NOT in the required set: a
  // run that halted before reaching its own close could not have written one,
  // and refusing to reconstruct such a run would withhold exactly the
  // trajectory a reader most needs. Two of them is a different matter — a run
  // has one close, so it has one receipt.
  const receipts = records.filter(r => r.type === 'run-receipt').length
  if (receipts > 1) {
    problems.push(`${receipts} run-receipt events: a run has one close and therefore one receipt`)
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
          `commit=${r.commit ? r.commit : r.committed === false ? 'none' : r.committed === true ? 'created' : 'unknown'}\t` +
          `events=${r.events}${r.skipped ? ` skipped=${r.skipped}` : ''}` +
          // Said out loud rather than left to inference: a closed run with no
          // receipt did not reach its own close, which is a finding.
          `${r.receipt ? '' : '\tno receipt recorded'}`
      )
      .join('\n') + '\n'
  )
}
