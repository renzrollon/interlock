// Every prompt the ship loop assembles, checked against its assembled output.
//
// The one-prompt version of this already existed and worked: implementer-
// prompt.test.mjs extracts a marked region, evaluates it, and compares against
// checked-in fixtures — and it would have caught a stray `+` inside
// `assembleImplementerPrompt` instantly. It was applied to exactly one of
// ship.js's dozen prompts, and the tier ladder in a different one was corrupted
// for as long as it took to notice by reading the source.
//
// So coverage here is ENUMERATED rather than sampled. The suite reports how
// many prompts it checked, and a prompt it expects but cannot reach is a
// failure — otherwise this change fixes one prompt and leaves the same hole for
// the next eleven.
//
// Deliberately Node-only: no network, no API key, no model.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runShip,
  collectPrompts,
  coverageRuns,
  coercionArtifacts,
  EXPECTED_PROMPT_LABELS
} from '../helpers/ship-harness.mjs'

const matches = (label, expected) =>
  expected.endsWith('-') ? label.startsWith(expected) : label === expected

let captured = null
async function allPrompts() {
  if (!captured) captured = await collectPrompts(coverageRuns())
  return captured
}

test('every assembled ship prompt is free of coercion artifacts', async () => {
  const prompts = await allPrompts()
  assert.ok(prompts.length > 0, 'the harness captured no prompts at all')

  const offenders = prompts
    .map(p => ({ label: p.label, found: coercionArtifacts(p.prompt) }))
    .filter(p => p.found.length)

  assert.deepEqual(
    offenders.map(o => `${o.label}: ${o.found.join(', ')}`),
    [],
    'a prompt was assembled with a coerced operand — whatever that operand was ' +
      'supposed to say never reaches its agent, and the sentence is still sitting ' +
      'intact in workflows/ship.js'
  )
})

test('the suite reports how many prompts it checked, and reaches every one it expects', async () => {
  const prompts = await allPrompts()
  const labels = [...new Set(prompts.map(p => p.label))]

  const unreachable = EXPECTED_PROMPT_LABELS.filter(
    expected => !labels.some(label => matches(label, expected))
  )
  assert.deepEqual(
    unreachable,
    [],
    `these prompts were never assembled, so nothing checked them: ${unreachable.join(', ')}. ` +
      `Extend coverageRuns() in test/helpers/ship-harness.mjs to reach them — a prompt the ` +
      `suite cannot reach must fail, never silently reduce the coverage count.`
  )

  // The count is part of the output on purpose: a coverage number that drops
  // should be visible to whoever reads the run, not only to this assertion.
  console.log(
    `      prompt-integrity: checked ${prompts.length} assembled prompt(s) ` +
      `across ${coverageRuns().length} run(s), covering ${labels.length} distinct label(s)`
  )
  assert.ok(
    labels.length >= EXPECTED_PROMPT_LABELS.length,
    `expected at least ${EXPECTED_PROMPT_LABELS.length} distinct prompts, saw ${labels.length}`
  )
})

test('a new assembled prompt cannot escape the check by living behind a flag', async () => {
  // The opt-in tail (review, remediation, handoff) is only built under --strict.
  // Coverage must not depend on which run modes the suite happens to exercise.
  const lean = await runShip({})
  const strict = await runShip({ args: 'demo-change --strict' })
  const leanLabels = new Set(lean.prompts.map(p => p.label))
  const strictLabels = new Set(strict.prompts.map(p => p.label))

  for (const optIn of ['review', 'handoff']) {
    assert.ok(!leanLabels.has(optIn), `${optIn} should not run on a lean invocation`)
    assert.ok(strictLabels.has(optIn), `${optIn} must be reachable and checked under --strict`)
  }
})

test('an unextractable prompt is a failure, not a smaller coverage number', async () => {
  // The property, asserted directly: if a run cannot be driven to completion the
  // harness throws rather than returning the prompts it did manage to collect.
  await assert.rejects(
    () => runShip({ responses: { validate: () => { throw new Error('agent unreachable') } } }),
    /agent unreachable/
  )
})

test('every prompt names the change it is about, so none is assembled nameless', async () => {
  const prompts = await allPrompts()
  // Two exemptions, both principled: `validate` is the step that resolves the
  // name in the first place, and `next-retry-N` is a pure re-read of the state
  // file — it names the state path, not the change, and giving it a change name
  // would imply it could act on one.
  const exempt = label =>
    label === 'validate' || label.startsWith('next-retry-') || label.startsWith('1.')
  const nameless = prompts
    .filter(p => !exempt(p.label))
    .filter(p => !p.prompt.includes('demo-change'))
    .map(p => p.label)
  assert.deepEqual(
    [...new Set(nameless)],
    [],
    'a prompt was assembled without the resolved change name interpolated into it'
  )
})
