// The stage marker's shape, and the duplication that no longer exists.
//
// `workflows/ship.js` used to write the marker with LITERALS — the workflow
// runtime rejects module loading, so it could not import `lib/ship-stage.mjs`
// and call `stagePath` — and this file was the drift guard that kept the two
// byte-identical. A rename in the module that was not mirrored in the workflow
// failed here rather than at run time, as a marker the guards silently could
// not read.
//
// The CLI assembles every briefing now, so the fragment that asks an agent to
// publish its stage is rendered by `lib/prompts/stage.mjs` FROM the module's own
// `stagePath`, `MARKER_FIELDS` and `STAGES` (design D8). There is nothing left
// to drift, so what this file asserts changed shape with the code: that the
// duplication is gone, in every place it could come back, and that the one
// remaining renderer really does read the module rather than restate it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER_FIELDS, MARKER_FILE, SHIP_DIR, STAGES, stagePath } from '../../lib/ship-stage.mjs'
import { publishStageLine } from '../../lib/prompts/stage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DRIVERS = [
  join(ROOT, 'workflows', 'ship.js'),
  join(ROOT, 'bin', 'interlock-ship-acp')
]

const posix = s => s.replace(/\\/g, '/')

test('no driver declares a stage-marker literal of its own', () => {
  // The four constants the workflow script used to carry. Each one is a place
  // the duplication could return, so each is named rather than checked as a
  // pattern — a reader who adds one back should see which one this test means.
  for (const driver of DRIVERS) {
    const text = readFileSync(driver, 'utf8')
    for (const name of [
      'STAGE_MARKER_DIR',
      'STAGE_MARKER_FILE',
      'STAGE_MARKER_FIELDS',
      'stageMarkerPath'
    ]) {
      assert.doesNotMatch(
        text,
        new RegExp(`\\b${name}\\b`),
        `${driver} declares ${name}. The marker's shape is rendered by lib/prompts/stage.mjs ` +
          `from lib/ship-stage.mjs's own constants — a driver that restates it is the drift ` +
          `this file used to guard against, reintroduced.`
      )
    }
  }
})

test('no driver embeds the marker JSON, and none builds the marker path', () => {
  for (const driver of DRIVERS) {
    const text = readFileSync(driver, 'utf8')
    assert.doesNotMatch(
      text,
      /\{"stage":/,
      `${driver} embeds the marker object. Only lib/prompts/stage.mjs renders it.`
    )
    assert.doesNotMatch(
      text,
      new RegExp(`${posix(SHIP_DIR).replace('.', '\\.')}/\\$\\{[^}]+\\}/${MARKER_FILE}`),
      `${driver} builds the marker path. Only lib/ship-stage.mjs derives it.`
    )
  }
})

test('the rendered fragment names the path lib/ship-stage.mjs derives', () => {
  for (const change of ['add-foo', 'a-change-with-dashes']) {
    assert.ok(
      publishStageLine('implement', change, 1).includes(posix(stagePath(change))),
      `the fragment for ${change} does not name ${stagePath(change)}`
    )
  }
})

test('the rendered marker carries the module\'s fields, in the module\'s order', () => {
  const json = /\{"[^\n]*\}/.exec(publishStageLine('remediation', 'add-foo', 9))
  assert.ok(json, 'the fragment must embed the one-line JSON the guards parse')
  const keys = [...json[0].matchAll(/"(\w+)":/g)].map(m => m[1])
  assert.deepEqual(
    keys,
    [...MARKER_FIELDS],
    'a reordered or renamed key is drift — the guards parse this object by shape'
  )
})

test('the renderer refuses a stage the module does not declare', () => {
  // The failure this replaces was a marker the guards silently could not read.
  // A stage outside the known set reads back as `unknown` and the edit guards
  // fail open, so a typo would disarm the guard for that window — and assembly
  // is the last place it can still be caught.
  for (const stage of STAGES) {
    assert.equal(typeof publishStageLine(stage, 'add-foo', 1), 'string')
  }
  assert.throws(() => publishStageLine('remediating', 'add-foo', 1), /unknown ship stage/)
})

test('the tail\'s stage lines are rendered by the CLI, on the briefing that publishes them', () => {
  // The review and remediation stages used to be rendered onto a `host-tail`
  // step for the Workflow script to read back (design D6). The tail is the
  // CLI's own program now, so each fragment rides on the briefing of the agent
  // that will publish it — the one party with a filesystem and the right pid —
  // and no driver sees a stage line at all.
  const run = readFileSync(join(ROOT, 'lib', 'run.mjs'), 'utf8')
  assert.match(run, /publishStageLine\('review', change, \+\+manifest\.stageIndex\)/)
  assert.match(run, /publishStageLine\('remediation', change, \+\+manifest\.stageIndex\)/)
  // And each is handed to the assembler as `stageLine`, so the briefing carries
  // it rather than the step.
  for (const module of ['review.mjs', 'remediate.mjs']) {
    assert.match(
      readFileSync(join(ROOT, 'lib', 'prompts', module), 'utf8'),
      /stageLine/,
      `lib/prompts/${module} must take the rendered fragment rather than build one`
    )
  }
  for (const driver of [join(ROOT, 'workflows', 'ship.js'), join(ROOT, 'bin', 'interlock-ship-acp')]) {
    assert.doesNotMatch(
      readFileSync(driver, 'utf8'),
      /stageLines?\b/,
      `${driver} reads a stage line off a step — the briefing carries it now`
    )
  }
})
