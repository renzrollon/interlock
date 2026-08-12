// The caps are the product's spine, so the tests here are less about arithmetic
// than about the property that makes centralising them worth anything: every
// cap is a positive integer, nothing silently disappears, and a caller asking
// for more parallelism than the workflow runtime allows gets clamped rather
// than a failed run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, RUNTIME, clampParallel, formatLimits } from '../../lib/limits.mjs'

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
  assert.ok(text.endsWith('\n'))
})
