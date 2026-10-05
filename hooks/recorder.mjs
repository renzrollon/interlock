#!/usr/bin/env node
// The recorder: a hook that REPORTS what a ship run cannot see about itself, and
// never decides anything.
//
// The guards beside it return a decision; this returns none. It prints nothing
// on stdout on any path, and it exits 0 on every path — a valid event, malformed
// input, an event it has no branch for, and its own crash. A recorder that could
// block would be a guard nobody reviewed as one.
//
// ONE FILE FOR EVERY REPORTING BRANCH. It dispatches on `hook_event_name`, and a
// later recorder branch (subagent or permission events) joins this file rather
// than adding a second recorder. Today it has one:
//
//   SessionEnd — a session that ends while its own ship run is live kills the
//   background workflow before `run close`: no receipt, no resume card, no
//   terminal trajectory event. This writes one small note under
//   `.claude/ship/interrupted/` so the next `interlock run start`, the next
//   SessionStart preflight and `interlock report` can say so (lib/interrupted.mjs).
//
// EVERY PLUGIN HOOK RUNS IN EVERY SESSION, in every repository. So the SessionEnd
// branch writes only when all of these hold, and otherwise creates no file and
// no directory:
//
//   - a stage marker is live: its pid — the session process, which is still
//     alive while its own SessionEnd hook runs — is a running process. A marker
//     whose process is gone is an orphan and means nothing;
//   - the run manifest names that marker's change and carries a run id;
//   - the manifest's session is the one ending. A session that does not own the
//     run, or a run with no session (the runner host), never matches — the
//     runner's own signal trap is its receipt instead.
//
// It never writes the run trajectory: hooks do not, and the note is a pointer to
// records written elsewhere. A failed write is a line on stderr, never an exit
// code (the note is outcome-class; docs/13-the-guards.md says why that differs
// from the trajectory's rule).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readStage, SHIP_DIR } from '../lib/ship-stage.mjs'
import { writeInterruptedNote } from '../lib/interrupted.mjs'
import { projectRoot, readEvent } from './_shared.mjs'

/** The run manifest, read raw: the run program is not loaded into a hook. */
function readRunManifest(root) {
  try {
    const value = JSON.parse(readFileSync(join(root, SHIP_DIR, 'run.json'), 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** A session that ended while its own run was live leaves a note. Anything else, nothing. */
function onSessionEnd(event) {
  const root = projectRoot(event)
  const sessionId = typeof event.session_id === 'string' ? event.session_id.trim() : ''
  if (!sessionId) return

  const marker = readStage({ root })
  if (marker.stage === 'unknown' || typeof marker.change !== 'string') return

  const manifest = readRunManifest(root)
  if (!manifest) return
  if (manifest.change !== marker.change) return
  if (typeof manifest.runId !== 'string' || !manifest.runId) return
  if (typeof manifest.sessionId !== 'string' || manifest.sessionId !== sessionId) return

  const written = writeInterruptedNote(root, {
    runId: manifest.runId,
    change: manifest.change,
    sessionId,
    reason: event.reason,
    stage: marker.stage
  })
  if (!written.written) {
    process.stderr.write(`interlock recorder: interrupted-run note not written: ${written.reason}\n`)
  }
}

const BRANCHES = {
  SessionEnd: onSessionEnd
}

try {
  const event = await readEvent()
  const branch = BRANCHES[event && event.hook_event_name]
  if (branch) branch(event)
} catch (err) {
  // Nothing this hook does may stop a session from ending, or speak a decision.
  process.stderr.write(`interlock recorder hook error (ignored): ${(err && err.message) || String(err)}\n`)
}
process.exit(0)
