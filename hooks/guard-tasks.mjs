#!/usr/bin/env node
// PreToolUse guard: the completion tick belongs to the CLI, not to an agent's
// Edit tool.
//
// `interlock tasks tick` writes a change's `tasks.md` checkbox from an
// adjudicated outcome — the tick is keyed off what the run RECORDED, not off
// what an implementing agent claims (see the shipped change
// `2026-08-25-tick-tasks-from-recorded-outcomes`). That change removed the
// incentive to hand-tick; this guard removes the capability. An Edit/Write that
// flips a checkbox line in the active change's `tasks.md` while a run is live is
// denied; a prose-only edit that leaves every checkbox byte-identical is
// allowed, and so is any edit when no run is active.
//
// The CLI's own tick does not route through the Edit/Write tools, so it never
// trips this guard — the guard scopes to the agent-facing tools by construction.

import { readStage, STAGES } from '../lib/ship-stage.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  readEvent,
  allow,
  deny,
  toolName,
  toolInput,
  projectRoot,
  editTargetPath,
  relPosix
} from './_shared.mjs'

const GUARD = 'guard-tasks'
// Every stage a run publishes is an active-run stage; the tick is never the
// agent's job in any of them. (The commit-stage agent does not edit tasks.md,
// but denying a checkbox flip there too costs nothing and is the honest rule.)
const ACTIVE_STAGES = new Set(STAGES)
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]/

/**
 * The checkbox STATES of a blob, in order — `' '` or `'x'` per checkbox line.
 * Only the marker inside the brackets is captured, so a reworded task title or
 * a prose edit anywhere leaves this sequence byte-identical; only a tick flip,
 * or a checkbox added or removed, changes it. That is exactly the edit the CLI
 * owns and a hand-edit must not make.
 */
function checkboxStates(text) {
  if (typeof text !== 'string') return []
  const states = []
  for (const line of text.split(/\r?\n/)) {
    const m = CHECKBOX.exec(line)
    if (m) states.push(m[1].toLowerCase())
  }
  return states
}

/** Do two blobs carry a different sequence of checkbox states (added, removed, or flipped)? */
function checkboxesDiffer(before, after) {
  const a = checkboxStates(before)
  const b = checkboxStates(after)
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true
  return false
}

try {
  const event = await readEvent()
  const tool = toolName(event)
  if (tool !== 'Edit' && tool !== 'Write') allow()

  const root = projectRoot(event)
  const { stage, change } = readStage({ root })
  if (!ACTIVE_STAGES.has(stage) || !change) allow() // no active run → allow

  const target = editTargetPath(event)
  if (!target) allow()

  const tasksPath = resolve(root, 'openspec', 'changes', String(change), 'tasks.md')
  if (resolve(target) !== tasksPath) allow() // not the active change's tasks.md

  const input = toolInput(event)
  let before
  let after
  if (tool === 'Edit') {
    before = input.old_string || input.oldString || ''
    after = input.new_string || input.newString || ''
  } else {
    // Write replaces the whole file — compare against what is on disk now.
    try {
      before = readFileSync(tasksPath, 'utf8')
    } catch {
      before = ''
    }
    after = input.content || input.contents || ''
  }

  if (!checkboxesDiffer(before, after)) allow() // prose-only edit, checkboxes byte-identical

  const rel = relPosix(root, target) || target
  deny(
    `${GUARD}: changing a checkbox line in ${rel} is blocked during a ship run (stage ${stage}). ` +
      `The completion tick is written by \`interlock tasks tick\` from the run's recorded outcomes, ` +
      `never by hand — a hand-tick is how unimplemented work ships marked done. Edit the task's prose ` +
      `freely; leave the \`- [ ]\` / \`- [x]\` markers to the CLI.`,
    { guard: GUARD, path: rel, stage, change }
  )
} catch (err) {
  allow(`${GUARD}: internal error, allowing by default: ${(err && err.message) || String(err)}`)
}
