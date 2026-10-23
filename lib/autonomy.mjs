// The earned-autonomy ladder.
//
// Every gated path starts at L2 (human in the loop) and is promoted to L3
// (autonomous) only after PROMOTE_THRESHOLD consecutive clean runs. A blocker or
// a human override resets the counter and demotes L3 back to L2.
//
// Autonomy changes *whether the flow waits for a human*, never *whether the
// quality gates run*. A blocker is a hard stop at every level.
//
// Pure fs + JSON: no agent, no network, no clock beyond timestamps.
// Exposed to skills as `interlock autonomy <level|record|state> ...`.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_FILE = join('.claude', 'autonomy.json')
const PROMOTE_THRESHOLD = 3

// Upstream paths whose counters reset when a downstream gate fails.
// Key = downstream gate, Value = upstream paths that get blamed.
//
// This is what stops a path gaming its way to L3: `spec` cannot earn autonomy by
// emitting shallow "no open questions" output, because when the artifact gate
// catches the resulting bad spec it resets `spec` and `explore` too. Clean
// passes credit the same chain in reverse via recordCleanFlow().
//
// Blame is one hop, deliberately: a review-code blocker blames `ship`, and does
// not cascade further back to `spec` / `explore`.
const TRANSITIVE_BLAME = {
  'review-artifacts': ['explore', 'spec'],
  'review-code': ['ship']
}

function statePath(root) {
  return root ? join(root, STATE_FILE) : STATE_FILE
}

// Absent and unreadable are different facts (design D20). A record that does not
// exist yet is an empty ladder. A record that exists and cannot be read or
// parsed holds history that a blind overwrite would destroy, so the caller is
// told, and `save` moves the file aside before it writes fresh counters.
function loadState(root) {
  const p = statePath(root)
  let raw
  try {
    raw = readFileSync(p, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: {}, unreadable: false }
    return { state: {}, unreadable: true }
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { state: parsed, unreadable: false }
    }
  } catch {
    // falls through: not JSON
  }
  return { state: {}, unreadable: true }
}

function load(root) {
  return loadState(root).state
}

// Writes the record. When `unreadable` is set, the file already there is moved
// to `autonomy.json.unreadable-<ISO>` first and the returned string names both
// paths; the caller prints it. If the move fails the old file is left where it
// is and nothing is written over it, and the string says so.
function save(state, root, unreadable = false) {
  const p = statePath(root)
  mkdirSync(dirname(p), { recursive: true })
  let warning = null
  if (unreadable) {
    const moved = `${p}.unreadable-${new Date().toISOString()}`
    try {
      renameSync(p, moved)
      warning = `AUTONOMY RECORD UNREADABLE: ${p} moved to ${moved}; counters restarted`
    } catch (err) {
      return (
        `AUTONOMY RECORD UNREADABLE: ${p} could not be moved aside (${err && err.message ? err.message : err}); ` +
        'left in place, and this run was not recorded'
      )
    }
  }
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n')
  return warning
}

function ensureEntry(state, path) {
  if (!state[path]) {
    state[path] = {
      runs: 0,
      human_overrides: 0,
      blockers_caught: 0,
      consecutive_clean: 0,
      current_level: 'L2',
      last_promoted_at: null
    }
  }
  return state[path]
}

export function record(path, outcome, opts = {}) {
  const { root } = opts
  const { state, unreadable } = loadState(root)
  const entry = ensureEntry(state, path)

  entry.runs++

  if (outcome.human_override) {
    entry.human_overrides++
    entry.consecutive_clean = 0
    if (entry.current_level === 'L3') {
      entry.current_level = 'L2'
      entry.last_demoted_at = new Date().toISOString()
    }
  } else if (outcome.blockers > 0) {
    entry.blockers_caught += outcome.blockers
    entry.consecutive_clean = 0

    // Transitive blame: reset upstream paths that fed into this gate
    const upstreams = TRANSITIVE_BLAME[path] || []
    for (const upstream of upstreams) {
      const upEntry = ensureEntry(state, upstream)
      upEntry.consecutive_clean = 0
      if (upEntry.current_level === 'L3') {
        upEntry.current_level = 'L2'
        upEntry.last_demoted_at = new Date().toISOString()
      }
    }
  } else {
    entry.consecutive_clean++
  }

  state[path] = entry
  const warning = save(state, root, unreadable)

  // `warnings` is present only when there is one, so the result of a record
  // that found nothing wrong is the object it always was.
  const result = promote(path, state, opts)
  return warning ? { ...result, warnings: [warning] } : result
}

export function recordCleanFlow(paths, opts = {}) {
  const { root } = opts
  const { state, unreadable } = loadState(root)
  const results = []
  for (const path of paths) {
    const entry = ensureEntry(state, path)
    entry.runs++
    entry.consecutive_clean++
    state[path] = entry
    results.push({ path, consecutive_clean: entry.consecutive_clean })
  }
  const warning = save(state, root, unreadable)
  const out = results.map(r => ({ ...r, ...promote(r.path, state, opts) }))
  // A property on the array, set only when there is a warning: an array has no
  // other place to carry one, and the caller reads `.warnings` beside the rows.
  if (warning) out.warnings = [warning]
  return out
}

export function promote(path, stateOverride, opts = {}) {
  const { root } = opts
  const state = stateOverride || load(root)
  const entry = state[path]
  if (!entry) return { promoted: false, reason: 'no-entry' }

  if (entry.current_level === 'L2' && entry.consecutive_clean >= PROMOTE_THRESHOLD) {
    entry.current_level = 'L3'
    entry.last_promoted_at = new Date().toISOString()
    save(state, root)
    return { promoted: true, from: 'L2', to: 'L3', consecutive_clean: entry.consecutive_clean }
  }

  return {
    promoted: false,
    current_level: entry.current_level,
    consecutive_clean: entry.consecutive_clean,
    needed: PROMOTE_THRESHOLD
  }
}

export function getLevel(path, opts = {}) {
  const state = load(opts.root)
  return state[path]?.current_level || 'L2'
}

export function getState(opts = {}) {
  return load(opts.root)
}

export { PROMOTE_THRESHOLD, TRANSITIVE_BLAME }
