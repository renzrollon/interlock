#!/usr/bin/env node
// Launch guard: a second ship launch in one session, with no human prompt since
// the last, is denied (guard-ship-relaunch; spec: hooks/launch-guard).
//
// The most expensive recorded mistake was a parent chat calling Workflow again
// over leftover checkboxes — another 20+ agents, a full review cycle included —
// and the skill's sentence forbidding it was the only thing in the way. This
// bounds it outside the model. The prose and `evals/trampoline-launch` stay: the
// eval measures whether the model obeys, this bounds what happens when it does
// not.
//
// ONE SCRIPT, FOUR REGISTRATIONS, dispatching on `hook_event_name`:
//
//   PreToolUse   (Workflow)  the only branch that may deny: a ship launch whose
//                            session ledger holds a launch newer than the last
//                            human prompt.
//   PostToolUse  (Workflow)  records a ship launch the runtime accepted, then
//                            sweeps ledgers past the published age.
//   UserPromptSubmit,        record the time of a human prompt — only when the
//   UserPromptExpansion      session already has a ledger. The host's completion
//                            wake fires UserPromptSubmit too; it is not a human
//                            and is not counted (lib/launch-ledger.mjs).
//
// EVERY UNKNOWN ALLOWS: no session id, an unsafe one, a missing, malformed or
// stale ledger, a tool input that is not a ship launch, a tool that is not
// Workflow, an event with no branch, and the guard's own crash. A false deny
// costs one typed message; that is still a denial, so it is the only branch that
// can speak one. The recorder branches print no decision on any path; a ledger
// write that fails is a stderr line, because a guard that silently stopped
// recording is a guard that silently stopped denying.
//
// The rule and its words live in lib/launch-ledger.mjs. This file is plumbing.

import {
  decideLaunch,
  isAcceptedLaunch,
  isHumanPrompt,
  isShipLaunch,
  readLedger,
  recordLaunch,
  recordPrompt,
  sweepStale
} from '../lib/launch-ledger.mjs'
import { readEvent, allow, deny, toolName, toolInput, projectRoot } from './_shared.mjs'

const GUARD = 'guard-relaunch'

/** The session id as the host sent it, or '' — an unsafe one is refused by the ledger module. */
const sessionOf = event => (typeof event.session_id === 'string' ? event.session_id.trim() : '')

function onPreToolUse(event) {
  if (toolName(event) !== 'Workflow') allow()
  const sessionId = sessionOf(event)
  if (!sessionId) allow()
  const root = projectRoot(event)

  const problems = []
  const ledger = readLedger(root, sessionId, { onProblem: message => problems.push(message) })
  if (!isShipLaunch(toolInput(event), ledger)) allow()
  if (problems.length) allow(`${GUARD}: ${problems.join('; ')} — allowing`)

  const verdict = decideLaunch(ledger)
  if (verdict.decision !== 'deny') allow()
  deny(verdict.reason, {
    guard: GUARD,
    sessionId,
    lastLaunchAt: verdict.lastLaunchAt,
    lastHumanPromptAt: verdict.lastHumanPromptAt
  })
}

function onPostToolUse(event) {
  if (toolName(event) !== 'Workflow') return
  const sessionId = sessionOf(event)
  if (!sessionId) return
  const root = projectRoot(event)

  if (!isShipLaunch(toolInput(event), readLedger(root, sessionId))) return
  if (!isAcceptedLaunch(event.tool_response)) return
  const written = recordLaunch(root, sessionId, event.tool_response)
  if (!written.written) {
    process.stderr.write(`${GUARD}: ${written.reason}\n`)
    return
  }
  sweepStale(root, { keep: sessionId })
}

function onPrompt(event) {
  const sessionId = sessionOf(event)
  if (!sessionId || !isHumanPrompt(event.prompt)) return
  const written = recordPrompt(projectRoot(event), sessionId)
  // Only a ledger that exists and failed to take the write is worth a line;
  // "no ledger for this session" is every prompt in every repository.
  if (!written.written && written.reason && written.reason.startsWith('launch ledger not written')) {
    process.stderr.write(`${GUARD}: ${written.reason}\n`)
  }
}

const BRANCHES = {
  PreToolUse: onPreToolUse,
  PostToolUse: onPostToolUse,
  UserPromptSubmit: onPrompt,
  UserPromptExpansion: onPrompt
}

try {
  const event = await readEvent()
  const branch = BRANCHES[event.hook_event_name]
  if (branch) branch(event)
} catch (err) {
  // The guard's own crash must never block a launch or a prompt. Allow, and
  // leave a diagnostic on stderr rather than a wedged session.
  allow(`${GUARD}: internal error, allowing by default: ${(err && err.message) || String(err)}`)
}
process.exit(0)
