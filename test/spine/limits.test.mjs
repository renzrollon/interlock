// The caps are the product's spine, so the tests here are less about arithmetic
// than about the property that makes centralising them worth anything: every
// cap is a positive integer, nothing silently disappears, and a caller asking
// for more parallelism than the workflow runtime allows gets clamped rather
// than a failed run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, RUNTIME, clampParallel, formatLimits } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('every cap is a positive integer', () => {
  for (const [name, value] of Object.entries(LIMITS)) {
    assert.equal(typeof value, 'number', `${name} must be a number`)
    assert.ok(Number.isInteger(value), `${name} must be an integer`)
    assert.ok(value > 0, `${name} must be positive`)
  }
})

test('the documented ship caps are the ones the prose promised', () => {
  // These four were prose in skills/ship/SKILL.md before they lived here. If one
  // changes, that is a product decision and this assertion should be updated
  // deliberately — not a refactor that quietly moved a number.
  assert.equal(LIMITS.remediationRounds, 2)
  assert.equal(LIMITS.interWaveFixAttempts, 2)
  assert.equal(LIMITS.replansPerRun, 2)
  assert.equal(LIMITS.rootCauseIterations, 5)
  assert.equal(LIMITS.taskFailureHalt, 2)
  assert.equal(LIMITS.interWaveVerifications, 3)
})

test('the spill caps match design.md — 8192 byte threshold, 4096 char preview', () => {
  // add-ship-run-inspectability design.md §3 pins these numbers; lib/spill.mjs
  // falls back to the same defaults independently, so a drift here would leave
  // the two modules silently disagreeing.
  assert.equal(LIMITS.verifySpillBytes, 8192)
  assert.equal(LIMITS.verifyPreviewChars, 4096)
})

test('the wave handoff budget is pinned at 2000 characters', () => {
  // add-wave-handoff-and-prompt-snapshots design.md §2. Changing this is a
  // product decision about how much one wave may tell the next — update it here
  // deliberately, the same way remediationRounds would be.
  assert.equal(LIMITS.maxHandoffChars, 2000)
})

test('the default fan-out sits under the runtime concurrency ceiling', () => {
  assert.ok(
    LIMITS.maxParallel <= RUNTIME.maxConcurrentAgents,
    'default parallelism must not exceed what the workflow runtime will run'
  )
})

test('clampParallel falls back to the default for junk input', () => {
  for (const junk of [undefined, null, 0, -3, 2.5, '8', NaN]) {
    const got = clampParallel(junk)
    assert.equal(got.value, LIMITS.maxParallel)
    assert.equal(got.clamped, false)
    assert.equal(got.reason, null)
  }
})

test('clampParallel honours a reasonable request unchanged', () => {
  const got = clampParallel(4)
  assert.deepEqual(got, { value: 4, clamped: false, reason: null })
})

test('clampParallel clamps to the runtime ceiling and says why', () => {
  const got = clampParallel(40)
  assert.equal(got.value, RUNTIME.maxConcurrentAgents)
  assert.equal(got.clamped, true)
  assert.match(got.reason, /concurrent agents/)
})

test('formatLimits names every cap it prints', () => {
  const text = formatLimits()
  assert.match(text, /max parallel agents/)
  assert.match(text, /remediation rounds/)
  assert.match(text, new RegExp(String(RUNTIME.maxAgentsPerRun)))
  assert.match(text, /verify spill threshold/)
  assert.match(text, /verify preview budget/)
  assert.match(text, /inter-wave verifications/)
  // The handoff cap has to be readable from the CLI: the workflow prompt tells
  // implementers to look it up there rather than restating the number.
  assert.match(text, /wave handoff budget/)
  assert.match(text, new RegExp(String(LIMITS.maxHandoffChars)))
  assert.ok(text.endsWith('\n'))
})

// --- every printed cap is enforced by code (spec: ship/cap-authority) ------
//
// The failure this closes: `interlock limits` advertised two caps no code
// obeyed. `memoryEntriesPerRun` had zero references outside this module and
// its prose, and `verifySpillBytes` was read only by a test asserting it
// equals 8192. A printed cap that nothing reads is the same failure as a cap
// written in prose — which is the failure this module was created to end.
//
// A test that pins a cap's VALUE is deliberately not counted as a reader. That
// is what let the spill threshold look alive: it exercises the number, not the
// behaviour the number governs.

test('every cap the limits surface prints is read by the code path it governs', () => {
  const dirs = ['lib', 'bin', 'workflows']
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path !== join('lib', 'limits.mjs')) sources.push(readFileSync(path, 'utf8'))
    }
  }
  for (const dir of dirs) walk(join(ROOT, dir))

  const unread = Object.keys(LIMITS).filter(
    cap => !sources.some(text => text.includes(`LIMITS.${cap}`))
  )
  assert.deepEqual(
    unread,
    [],
    `these caps are printed but nothing reads them: ${unread.join(', ')}. ` +
      `Wire each to the path it governs, or remove it from LIMITS and from the printed ` +
      `surface together — a cap with no reader is a cap written in prose.`
  )
})

test('a removed cap is gone from the object and from the printed surface together', () => {
  assert.ok(
    !('memoryEntriesPerRun' in LIMITS),
    'memoryEntriesPerRun has no enforcement point; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /memory entries/)
})
