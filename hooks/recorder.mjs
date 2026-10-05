#!/usr/bin/env node
// The recorder: a hook that REPORTS what a ship run cannot see about itself, and
// never decides anything.
//
// The guards beside it return a decision; this returns none. It prints nothing
// on stdout on any path, and it exits 0 on every path — a valid event, malformed
// input, an event it has no branch for, and its own crash. A recorder that could
// block would be a guard nobody reviewed as one. A subagent hook that exited
// non-zero could keep the agent it reports on running.
//
// ONE FILE FOR EVERY REPORTING BRANCH. It dispatches on `hook_event_name`; a new
// reporting branch joins this file rather than adding a second recorder. Five
// branches today:
//
//   SessionEnd — a session that ends while its own ship run is live kills the
//   background workflow before `run close`: no receipt, no resume card, no
//   terminal trajectory event. This writes one small note under the state
//   home's `.claude/ship/interrupted/` so the next `interlock run start`, the
//   next SessionStart preflight and `interlock report` can say so
//   (lib/interrupted.mjs). The home is the one the manifest records — a linked
//   worktree's run writes into its main checkout — else the working root. It is
//   read from the manifest, never found by running version control.
//
//   SubagentStart, SubagentStop — a Workflow script's `agent()` returns its
//   result and nothing else. The start records the agent once (the resume and
//   teammate-message firings change nothing); the stop sums the agent's own
//   transcript — usage per turn, the models that served it, the briefing sha it
//   was spawned with — into the same file (lib/agent-usage.mjs). `run close`
//   joins those files to the spawns it dispatched.
//
//   PermissionDenied, PermissionRequest — a permission event that interrupted
//   the run, one file per event: its kind, the time, the agent, the tool name and
//   the host's reason. Never the tool input, never the host's suggestions.
//
// EVERY PLUGIN HOOK RUNS IN EVERY SESSION, in every repository. So every branch
// passes one gate, in this order, and otherwise creates no file and no
// directory:
//
//   - a stage marker is live: its pid — the session process, which is still
//     alive while its own hooks run — is a running process. A marker whose
//     process is gone is an orphan and means nothing;
//   - the run manifest names that marker's change and carries a run id;
//   - SessionEnd only: the manifest's session is the one ending. A session that
//     does not own the run, or a run with no session (the runner host), never
//     matches — the runner's own signal trap is its receipt instead;
//   - the two subagent branches only: the event's agent type is exactly the one
//     the host reports for every agent a Workflow script spawns, whatever type
//     the script named. The registration's matcher says the same, and the
//     branch checks again: an internal agent of a `claude --agent
//     interlock:worker` session reports `interlock:worker`, and writes nothing.
//
// It never reads or writes the run trajectory, and it starts no process: one
// `mkdirSync` and one write per record. A failed write is a line on stderr, never
// an exit code (the note and the agent-usage sidecar are outcome-class;
// docs/13-the-guards.md says why that differs from the trajectory's rule).

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readStage, SHIP_DIR } from '../lib/ship-stage.mjs'
import { writeInterruptedNote } from '../lib/interrupted.mjs'
import { WORKFLOW_AGENT_TYPE, writeAgentStart, writeAgentStop, writePermissionEvent } from '../lib/agent-usage.mjs'
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

/**
 * The gate every branch passes before it touches the filesystem: a live marker,
 * and a manifest for that marker's change carrying a run id. `null` otherwise.
 */
function liveRun(root) {
  const marker = readStage({ root })
  if (marker.stage === 'unknown' || typeof marker.change !== 'string') return null

  const manifest = readRunManifest(root)
  if (!manifest) return null
  if (manifest.change !== marker.change) return null
  if (typeof manifest.runId !== 'string' || !manifest.runId) return null
  return { marker, manifest, runId: manifest.runId }
}

/** The gate, plus the agent-type re-check the two subagent branches add. */
function liveRunForAgent(root, event) {
  const run = liveRun(root)
  if (!run) return null
  if (event.agent_type !== WORKFLOW_AGENT_TYPE) return null
  return run
}

/** A record that did not land is one line on stderr, and nothing more. */
function speak(what, result) {
  if (!result.written) process.stderr.write(`interlock recorder: ${what} not written: ${result.reason}\n`)
}

/** A session that ended while its own run was live leaves a note. Anything else, nothing. */
function onSessionEnd(event) {
  const root = projectRoot(event)
  const sessionId = typeof event.session_id === 'string' ? event.session_id.trim() : ''
  if (!sessionId) return

  const run = liveRun(root)
  if (!run) return
  const { marker, manifest } = run
  if (typeof manifest.sessionId !== 'string' || manifest.sessionId !== sessionId) return

  // The home `run start` resolved and recorded; a manifest without one is a run
  // in the main checkout, or one written before the field existed.
  const home = typeof manifest.stateHome === 'string' && manifest.stateHome ? resolve(root, manifest.stateHome) : root
  speak(
    'interrupted-run note',
    writeInterruptedNote(home, {
      runId: run.runId,
      change: manifest.change,
      sessionId,
      reason: event.reason,
      stage: marker.stage
    })
  )
}

/** A Workflow agent started: its record, once. */
function onSubagentStart(event) {
  const root = projectRoot(event)
  const run = liveRunForAgent(root, event)
  if (!run) return
  speak('agent start', writeAgentStart(root, { runId: run.runId, agentId: event.agent_id, agentType: event.agent_type }))
}

/** A Workflow agent stopped: its transcript, summed into the same record. */
function onSubagentStop(event) {
  const root = projectRoot(event)
  const run = liveRunForAgent(root, event)
  if (!run) return
  speak(
    'agent stop',
    writeAgentStop(root, {
      runId: run.runId,
      agentId: event.agent_id,
      agentType: event.agent_type,
      transcriptPath: event.agent_transcript_path
    })
  )
}

/** One permission event, one file — the fields by name, and nothing the tool was given. */
function permissionBranch(kind) {
  return event => {
    const root = projectRoot(event)
    const run = liveRun(root)
    if (!run) return
    speak(
      `permission ${kind} event`,
      writePermissionEvent(root, {
        runId: run.runId,
        kind,
        agentId: event.agent_id ?? null,
        tool: event.tool_name,
        reason: event.reason ?? null
      })
    )
  }
}

const BRANCHES = {
  SessionEnd: onSessionEnd,
  SubagentStart: onSubagentStart,
  SubagentStop: onSubagentStop,
  PermissionDenied: permissionBranch('denied'),
  PermissionRequest: permissionBranch('request')
}

try {
  const event = await readEvent()
  const name = event && event.hook_event_name
  // Own keys only: an event named after an Object.prototype member is no branch.
  if (typeof name === 'string' && Object.hasOwn(BRANCHES, name)) BRANCHES[name](event)
} catch (err) {
  // Nothing this hook does may stop a session from ending, keep an agent
  // running, or speak a decision.
  process.stderr.write(`interlock recorder hook error (ignored): ${(err && err.message) || String(err)}\n`)
}
process.exit(0)
