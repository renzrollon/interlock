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
//
// A linked worktree has no test profile of its own. `run start` records the one
// it found — the root's, else the main checkout's — as the manifest's
// `testProfilePath`, and when the root has none the guard reads that file, so a
// worktree run keeps its profile-derived test roots. It is read from the
// manifest, never found by running version control. A recorded path that cannot
// be read leaves the `.test.`/`.spec.` filename rule alone: the run had a
// profile, so test files exist, and the filename shape needs no roots. A
// manifest that records no path changes nothing.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readStage, SHIP_DIR } from '../lib/ship-stage.mjs'
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

/**
 * The test profile the run recorded at start, read through the manifest's
 * `testProfilePath`. `recorded: false` when there is no manifest or it records
 * no path — the guard then behaves exactly as it did without one. `profile:
 * null` with `recorded: true`, and the reason, when the path names nothing
 * readable as JSON.
 *
 * @returns {{ recorded: boolean, profile: object|null, reason?: string }}
 */
function recordedTestProfile(root) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, SHIP_DIR, 'run.json'), 'utf8'))
  } catch {
    return { recorded: false, profile: null }
  }
  const path = manifest && typeof manifest === 'object' ? manifest.testProfilePath : null
  if (typeof path !== 'string' || !path) return { recorded: false, profile: null }
  try {
    const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
    if (value && typeof value === 'object') return { recorded: true, profile: value }
    return { recorded: true, profile: null, reason: `${path}: not a profile object` }
  } catch (err) {
    return { recorded: true, profile: null, reason: `${path}: ${(err && err.message) || String(err)}` }
  }
}

try {
  const event = await readEvent()
  const tool = toolName(event)
  if (tool !== 'Edit' && tool !== 'Write') allow()

  const root = projectRoot(event)
  const { stage } = readStage({ root })
  if (!BLOCKED_STAGES.has(stage)) allow() // unknown or a non-repair stage → allow

  const target = editTargetPath(event)
  if (!target) allow() // no concrete path to protect

  const fromRoot = testRootsFromProfile(loadTestProfile(root))
  let roots = fromRoot.roots
  if (!fromRoot.hasProfile) {
    const recorded = recordedTestProfile(root)
    if (!recorded.recorded) allow() // no profile, none recorded → nothing names where tests live → allow
    // The run's profile, derived exactly as a root profile is; unreadable → no
    // roots, and the filename rule alone — said, not silent.
    if (!recorded.profile) {
      process.stderr.write(`${GUARD}: the test profile the run recorded could not be read, so only the filename rule applies: ${recorded.reason}\n`)
    }
    roots = testRootsFromProfile(recorded.profile).roots
  }

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
