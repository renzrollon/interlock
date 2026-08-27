// The stage marker — the one channel from a ship run to the stateless
// `PreToolUse` guards that fire in a different process.
//
// A hook cannot ask the workflow "what stage are we in". It shares no memory
// with `workflows/ship.js`, it is spawned per tool call, and env vars do not
// survive across the separate subagent processes the workflow spawns. The only
// thing that reliably spans the run process and the hook process is the
// filesystem. So the run PUBLISHES its stage to a file, and the guard READS it.
//
// Three properties are load-bearing, and they mirror lib/doctor.mjs's own:
//
//   1. NEVER THROWS. A guard whose own crash blocks a tool call is worse than
//      no guard. Every function here collapses a failure to a value: a write
//      error returns a warning object, an absent or malformed marker reads back
//      as `{ stage: 'unknown' }`. The caller decides; this module never throws
//      the decision away as an exception.
//
//   2. AN UNKNOWN IS NOT A STAGE. A marker that is absent, unparseable, carries
//      a stage outside the known set, or is stale resolves to `stage: 'unknown'`
//      — never to the nearest known stage. The edit guards fail OPEN on unknown
//      (see the stage-guard spec): treating a marker we could not trust as a
//      real stage is exactly the false-positive that would brick ordinary TDD
//      the moment the plugin is installed.
//
//   3. STALENESS NARROWS, IT DOES NOT CLOSE. A run that is killed before it can
//      clear its marker leaves the file behind. Two signals catch that orphan:
//      `pid` (is the run's process still alive?) and `index` (is this marker's
//      write count the current run's, or one an abandoned run left?). Neither is
//      trusted alone — pids recycle, and an index has no meaning without a
//      caller that knows the current run's count — but together they narrow the
//      window in which a leftover `remediation` marker could spuriously block an
//      edit in a later session. They do not close it, and the guards' fail-open
//      default is what makes that residual window safe rather than harmful.
//
// WHO WRITES IT. `workflows/ship.js` writes the marker as it enters each stage.
// The workflow runtime rejects module loading, so the marker path and JSON
// shape are DUPLICATED there as literals and kept byte-identical to this module
// — the same discipline the PING_AGENT / WORKER_TOOLS constants already follow.
// A drift test (test/spine/ship-stage.test.mjs) asserts the two agree.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The stages a run publishes. A marker holding anything else reads as unknown. */
export const STAGES = Object.freeze(['implement', 'verify', 'review', 'remediation', 'fix-tests', 'commit'])

/** The fields a marker carries. The workflow's duplicated literal must match. */
export const MARKER_FIELDS = Object.freeze(['stage', 'change', 'index', 'pid'])

/** Root of the per-run state tree the doctor already probes for writability. */
export const SHIP_DIR = join('.claude', 'ship')

/** The marker filename under `<SHIP_DIR>/<change>/`. */
export const MARKER_FILE = 'stage.json'

/** The reading returned whenever no trustworthy stage can be established. */
export const UNKNOWN = Object.freeze({ stage: 'unknown' })

/**
 * The marker path for a change: `.claude/ship/<change>/stage.json`, rooted at
 * `root` (default cwd). Keep this derivation identical to the literal in
 * `workflows/ship.js` — the drift test compares them.
 */
export function stagePath(change, root = '.') {
  return join(root, SHIP_DIR, String(change), MARKER_FILE)
}

/** Is `pid` a live process? A probe, not a gate — any error resolves to a boolean. */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    // Signal 0 performs the permission/existence check without delivering a
    // signal. ESRCH means no such process; EPERM means it exists but is not
    // ours, which for a liveness question still counts as alive.
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err && err.code === 'EPERM'
  }
}

/**
 * Publish `stage` for `change`. Reads any existing marker to advance `index`
 * monotonically, then writes `{ stage, change, index, pid }`. Records `pid` as
 * this process's id — in a ship run the writer is a step agent whose parent is
 * the run session, so the recorded pid is alive for the run and dead once the
 * session ends, which is the signal a later session uses to reject an orphan.
 *
 * Never throws. On any filesystem error returns `{ ok: false, warning }` so the
 * run can record a non-fatal note and continue — the marker is a guard input,
 * not a gate the run itself depends on.
 *
 * @returns {{ ok: true, marker: object } | { ok: false, warning: string }}
 */
export function writeStage(change, stage, opts = {}) {
  const root = opts.root || '.'
  const pid = Number.isInteger(opts.pid) ? opts.pid : process.pid
  const path = stagePath(change, root)
  let index = 1
  try {
    const prior = readMarkerFile(path)
    if (prior && Number.isInteger(prior.index) && prior.index > 0) index = prior.index + 1
  } catch {
    // A prior marker we cannot read is not a reason to refuse to write a new
    // one — start the counter fresh rather than throw.
    index = 1
  }
  const marker = { stage, change, index, pid }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(marker) + '\n')
    return { ok: true, marker }
  } catch (err) {
    return { ok: false, warning: `stage marker unwritable at ${path}: ${(err && err.message) || String(err)}` }
  }
}

/** Read and parse one marker file. Returns null on absence or malformed JSON. */
function readMarkerFile(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * Read the current ship stage, for a guard that knows only the filesystem.
 *
 * With no change name (the hook's situation) it scans `.claude/ship/*` for
 * markers and returns the freshest live one. A marker is LIVE when its `pid` is
 * still a running process; a marker whose process is gone is treated as an
 * orphan and ignored. Among live markers the highest `index` wins — that is the
 * most recent transition. When a caller knows the current run's write count it
 * passes `minIndex`, and any marker whose `index` is below it is rejected as a
 * leftover from an earlier run.
 *
 * Returns `{ stage: 'unknown' }` when nothing trustworthy is found: no marker,
 * malformed marker, unrecognized stage value, dead pid, or stale index. Never
 * throws — a scan that blows up is an unknown stage, not an exception.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]         project root (default cwd)
 * @param {string} [opts.change]       read only this change's marker
 * @param {number} [opts.minIndex]     reject markers whose index is below this
 * @param {(pid:number)=>boolean} [opts.isAlive]  liveness probe (injected in tests)
 * @returns {{ stage: string, change?: string, index?: number, pid?: number, reason?: string }}
 */
export function readStage(opts = {}) {
  const root = opts.root || '.'
  const isAlive = typeof opts.isAlive === 'function' ? opts.isAlive : processAlive
  const minIndex = Number.isInteger(opts.minIndex) ? opts.minIndex : null

  let paths
  try {
    if (opts.change) {
      paths = [stagePath(opts.change, root)]
    } else {
      const base = join(root, SHIP_DIR)
      if (!existsSync(base)) return { ...UNKNOWN }
      paths = readdirSync(base, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => join(base, e.name, MARKER_FILE))
    }
  } catch {
    return { ...UNKNOWN }
  }

  let best = null
  for (const path of paths) {
    const marker = readMarkerFile(path)
    if (!marker) continue
    if (!STAGES.includes(marker.stage)) continue // unrecognized stage → not a match
    if (!Number.isInteger(marker.index) || marker.index <= 0) continue
    if (minIndex !== null && marker.index < minIndex) continue // stale: behind the current run
    if (!isAlive(marker.pid)) continue // orphaned: the run that wrote it is gone
    if (!best || marker.index > best.index) best = marker
  }

  if (!best) return { ...UNKNOWN }
  return { stage: best.stage, change: best.change, index: best.index, pid: best.pid }
}

/**
 * Remove a change's marker. Called on every terminal path of a run so no stage
 * leaks into the next session. Never throws — an already-absent marker is
 * success, and a marker we cannot delete becomes a warning, not a crash.
 *
 * @returns {{ ok: true } | { ok: false, warning: string }}
 */
export function clearStage(change, opts = {}) {
  const path = stagePath(change, opts.root || '.')
  try {
    rmSync(path, { force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, warning: `stage marker not cleared at ${path}: ${(err && err.message) || String(err)}` }
  }
}

// Kept for callers that want to know a marker exists without interpreting it.
export function markerExists(change, root = '.') {
  try {
    return statSync(stagePath(change, root)).isFile()
  } catch {
    return false
  }
}
