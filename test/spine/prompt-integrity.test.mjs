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
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runShip,
  collectPrompts,
  coverageRuns,
  coercionArtifacts,
  EXPECTED_PROMPT_LABELS
} from '../helpers/ship-harness.mjs'
import { PROMPTS, REGISTERED_MODULES, NON_ASSEMBLER_MODULES } from '../../lib/prompts/index.mjs'

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'prompts')

// --- the registry: every assembler the CLI can reach ------------------------
//
// Enumeration, made structural. The suite iterates `PROMPTS` rather than
// whatever a driven run happened to assemble, and a module under lib/prompts/
// that is not in the table fails by name — so adding an assembler and
// forgetting to register it is the failure, not a quietly smaller count.

/** Every registered assembler applied to every sample input, flattened. */
const registryPrompts = Object.entries(PROMPTS).flatMap(([name, entry]) =>
  entry.inputs.map((input, i) => ({
    label: entry.inputs.length > 1 ? `${name}[${i}]` : name,
    prompt: entry.assemble(input)
  }))
)

test('every module under lib/prompts/ that holds an assembler is registered', () => {
  const onDisk = readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.mjs'))
  const unregistered = onDisk.filter(
    f => !NON_ASSEMBLER_MODULES.includes(f) && !REGISTERED_MODULES.includes(f)
  )
  assert.deepEqual(
    unregistered,
    [],
    `these prompt modules are not in the PROMPTS registry, so nothing assembles or checks ` +
      `them: ${unregistered.join(', ')}. Register them in lib/prompts/index.mjs — an ` +
      `unregistered assembler must fail here, never silently reduce the coverage count.`
  )
})

test('every registered assembler produces a non-empty string, free of coercion artifacts', () => {
  assert.ok(registryPrompts.length > 0, 'the registry assembled nothing at all')

  const offenders = registryPrompts
    .map(p => ({ label: p.label, found: coercionArtifacts(p.prompt) }))
    .filter(p => p.found.length)
  assert.deepEqual(
    offenders.map(o => `${o.label}: ${o.found.join(', ')}`),
    [],
    'a briefing was assembled with a coerced operand — whatever that operand was supposed to ' +
      'say never reaches its agent, and the sentence is still sitting intact in lib/prompts/'
  )

  for (const { label, prompt } of registryPrompts) {
    assert.equal(typeof prompt, 'string', `${label} assembled a non-string`)
    assert.ok(prompt.trim().length > 0, `${label} assembled an empty briefing`)
  }

  console.log(
    `      prompt-integrity: checked ${registryPrompts.length} assembled briefing(s) across ` +
      `${Object.keys(PROMPTS).length} registered assembler(s)`
  )
})

test('every registered assembler is deterministic for the same input', () => {
  for (const [name, entry] of Object.entries(PROMPTS)) {
    for (const [i, input] of entry.inputs.entries()) {
      assert.equal(
        entry.assemble(input),
        entry.assemble(input),
        `${name}[${i}] assembled two different briefings from one input`
      )
    }
  }
})

const matches = (label, expected) =>
  expected.endsWith('-') ? label.startsWith(expected) : label === expected

let captured = null
async function allPrompts() {
  if (!captured) captured = await collectPrompts(coverageRuns())
  return captured
}

test('every prompt a driven run puts in front of an agent is free of coercion artifacts', async () => {
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
      'intact in its source file'
  )
})

test('a driven run reaches every prompt the host itself still assembles', async () => {
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
    `      prompt-integrity: checked ${prompts.length} driven prompt(s) ` +
      `across ${coverageRuns().length} run(s), covering ${labels.length} distinct label(s)`
  )
})

test('a prompt cannot escape the check by living behind a flag', async () => {
  // The host tail (review, remediation, handoff) is only built under --strict.
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
    () =>
      runShip({
        responses: {
          validate: () => {
            throw new Error('agent unreachable')
          }
        }
      }),
    /agent unreachable/
  )
})

test('every briefing names the change it is about, so none is assembled nameless', async () => {
  const prompts = await allPrompts()
  // Exemptions, all principled. `validate` is the environment probe and touches
  // no change. A `cli-N` relay names a command and a file, not a change — giving
  // it one would imply it could act on it. A lane briefing is labelled by task
  // id and names the change in its own text, which is what is being checked.
  const exempt = label => label === 'validate' || label.startsWith('cli-')
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

// --- provenance: nothing a model writes reaches the corpus -----------------
//
// The outcome corpus exists to answer "should we have skipped the human that
// time?". `recordOutcome` used to hand a haiku agent the values the script had
// observed — halt state, remediation rounds, surviving blockers — under the
// sentence "Correct any field that does not match what actually happened",
// which is the assessed party writing the assessment's inputs. A prompt check
// kept that invitation from being re-issued.
//
// The invitation is now unstatable rather than merely forbidden: the receipt
// and the outcome record are built by `lib/receipt.mjs` and appended by
// `lib/run.mjs` from what the run recorded. No agent is asked for them, so
// there is no prompt in which the invitation could appear. What is asserted
// here is that structural fact, which is strictly stronger than the wording
// check it replaces.

test('no closing prompt exists to invite an agent to correct an observed value', async () => {
  const prompts = await allPrompts()
  const closing = prompts.filter(p => /record-outcome|record-receipt/.test(p.label))
  assert.deepEqual(
    closing.map(p => p.label),
    [],
    'a closing prompt was assembled. The halt state, remediation rounds, surviving blocker ' +
      'count, wave tallies and commit sha are measurements, and the run writes them itself — ' +
      'the party being assessed does not write the assessment\'s inputs, and no longer has a ' +
      'prompt in which to be asked for them.'
  )
})

test('the receipt is built from what the run recorded, not from what a step reported', () => {
  const source = readFileSync(join(PROMPTS_DIR, '..', 'receipt.mjs'), 'utf8')
  // The two directions the corpus depends on, asserted at the builder: an
  // unobserved field stays unobserved, and a halt is recorded rather than
  // skipped.
  assert.match(source, /Every field is either observed or `undefined`/)
  assert.match(source, /substitutes[\s\S]{0,40}a zero for a value the run never found out/)
  const run = readFileSync(join(PROMPTS_DIR, '..', 'run.mjs'), 'utf8')
  assert.match(run, /observedFromReceipt\(receipt\)/, 'the observed half is derived from the receipt')
  assert.match(
    run,
    /type: haltReason \? 'run-halt' : 'run-complete'/,
    'and both terminal paths write a terminal event'
  )
})
