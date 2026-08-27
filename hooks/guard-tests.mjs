#!/usr/bin/env node
// PreToolUse guard: an agent making a red check green must not be able to
// weaken the check itself.
//
// During `remediation` and `fix-tests` the run's whole job is to turn a failing
// assertion into a passing one. The cheapest way to do that dishonestly is to
// edit the test. This guard denies an Edit/Write to a test file for exactly
// those two stages, and allows everything else — including test edits during
// `implement`, where adding coverage for the feature you are building is the
// point, not a hazard.
//
// Fail open on everything it cannot establish: an unknown stage, an unresolvable
// path, a missing test profile, or its own crash all ALLOW. Blocking test edits
// whenever the marker is missing would break ordinary TDD the moment the plugin
// is installed — a cost strictly larger than the guard's benefit, which exists
// only inside a ship run's remediation window.

import { readStage } from '../lib/ship-stage.mjs'
import {
  readEvent,
  allow,
  deny,
  toolName,
  projectRoot,
  editTargetPath,
  loadTestProfile,
  testRootsFromProfile,
  isTestPath,
  relPosix
} from './_shared.mjs'

const GUARD = 'guard-tests'
const BLOCKED_STAGES = new Set(['remediation', 'fix-tests'])

try {
  const event = await readEvent()
  const tool = toolName(event)
  if (tool !== 'Edit' && tool !== 'Write') allow()

  const root = projectRoot(event)
  const { stage } = readStage({ root })
  if (!BLOCKED_STAGES.has(stage)) allow() // unknown or a non-repair stage → allow

  const target = editTargetPath(event)
  if (!target) allow() // no concrete path to protect

  const { roots, hasProfile } = testRootsFromProfile(loadTestProfile(root))
  if (!hasProfile) allow() // no profile → nothing names where tests live → allow

  if (!isTestPath(target, roots, root)) allow() // not a test file → allow (source repair is expected)

  const rel = relPosix(root, target) || target
  deny(
    `${GUARD}: editing the test file ${rel} is blocked during the ${stage} stage — ` +
      `a run making a failing check pass must fix the code under test, not weaken the check. ` +
      `If the test itself is wrong, stop the run and correct it outside remediation.`,
    { guard: GUARD, path: rel, stage }
  )
} catch (err) {
  // The guard's own crash must never block a tool call. Allow, and leave a
  // diagnostic on stderr rather than a wedged session.
  allow(`${GUARD}: internal error, allowing by default: ${(err && err.message) || String(err)}`)
}
