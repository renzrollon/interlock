// The assembled implementer prompt, pinned the way the caps in limits.test.mjs
// are pinned.
//
// A wave implementer is a fresh agent whose entire briefing is this string. It
// lived inline at the agent() call, where a reworded tier ladder or a deleted
// stop-on-green rule would change what every implementer in every run is told
// and no test would notice. The fixtures under test/fixtures/prompts/ are the
// contract: changing the assembled text has to be a deliberate act that updates
// a file, not a side effect of editing nearby control flow.
//
// The function is read out of workflows/ship.js and eval'd, the same trick
// test/workflows.test.mjs already uses for parseInvocation. It cannot be
// imported: the workflow runtime rejects a script containing import(), so
// prompt assembly has to live in the script, and the markers are the seam.
//
// Deliberately Node-only. No network, no API key, no ACP or headless host —
// snapshotting what a model would have seen does not require running one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIP = join(ROOT, 'workflows', 'ship.js')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'prompts')

function assembleFromSource(input) {
  const text = readFileSync(SHIP, 'utf8')
  const m =
    /\/\/ ASSEMBLE_IMPLEMENTER_PROMPT_START\n([\s\S]*?)\n\/\/ ASSEMBLE_IMPLEMENTER_PROMPT_END/.exec(
      text
    )
  assert.ok(
    m,
    'ship.js must define assembleImplementerPrompt between ASSEMBLE_IMPLEMENTER_PROMPT markers'
  )
  return new Function('input', `${m[1]}; return assembleImplementerPrompt(input)`)(input)
}

/** The fixed inputs the fixtures were generated from. */
const forTier = tier => ({
  change: 'add-widget',
  task: {
    id: '1.1',
    description: 'sessions table',
    tier,
    model: tier === 5 ? 'opus' : tier === 1 ? 'haiku' : 'sonnet'
  },
  previousHandoffs: []
})

const TIERS = [1, 2, 3, 4, 5]

for (const tier of TIERS) {
  test(`tier ${tier} matches its snapshot exactly`, () => {
    const expected = readFileSync(join(FIXTURES, `implementer-tier-${tier}.txt`), 'utf8')
    assert.equal(
      assembleFromSource(forTier(tier)),
      expected,
      `the tier ${tier} implementer prompt changed. If that was intended, regenerate ` +
        `test/fixtures/prompts/implementer-tier-${tier}.txt deliberately — this is a cap-style pin.`
    )
  })
}

test('the same inputs always produce the same prompt', () => {
  assert.equal(assembleFromSource(forTier(3)), assembleFromSource(forTier(3)))
})

test('tier 1 is briefed on the task alone and told to stop on green', () => {
  const prompt = assembleFromSource(forTier(1))
  assert.match(prompt, /TASK 1\.1: sessions table/)
  assert.match(prompt, /Your tier is 1\./)
  assert.match(prompt, /tier 1: the task description alone/)
  assert.match(prompt, /after typecheck\/lint pass, stop/)
})

test('tier 4 reads design and specs in full and is not told to stop on green', () => {
  const prompt = assembleFromSource(forTier(4))
  assert.match(prompt, /tier 4\+: design\.md and the specs in full/)
  assert.match(prompt, /Your tier is 4\./)
  assert.doesNotMatch(
    prompt,
    /after typecheck\/lint pass, stop/,
    'stop-on-green is a tier 1-2 rule; a tier 4 task stopping there leaves work undone'
  )
})

test('tier 3 and above never carry the stop-on-green rule', () => {
  for (const tier of [3, 4, 5]) {
    assert.doesNotMatch(assembleFromSource(forTier(tier)), /Do not refactor or polish/)
  }
  for (const tier of [1, 2]) {
    assert.match(assembleFromSource(forTier(tier)), /Do not refactor or polish/)
  }
})

test('every tier is told to locate through the graph before grepping', () => {
  for (const tier of TIERS) {
    const prompt = assembleFromSource(forTier(tier))
    assert.match(prompt, /interlock-graph query \/ consumers before grep/)
    assert.match(prompt, /Do not re-read a file unless it changed/)
    assert.match(prompt, /Return the schema only/)
    assert.match(prompt, /Do not commit, and do not edit tasks\.md/)
  }
})

test('the character cap is cited, never restated as a number', () => {
  // The cap lives in lib/limits.mjs and is published by `interlock limits`.
  // A number copied into prompt text is a number that drifts.
  const prompt = assembleFromSource(forTier(2))
  assert.match(prompt, /interlock limits/)
  assert.doesNotMatch(prompt, /2000/)
})

// --- the previous-wave block ----------------------------------------------

const handoff = (over = {}) => ({
  schema: 'interlock.wave-handoff/1',
  taskId: '1.1',
  status: 'ok',
  summary: 'Added the sessions table.',
  evidence: ['db/schema.sql:12-40'],
  next: 'Wire login against this table.',
  blocker: null,
  ...over
})

test('an empty previous wave renders no PREVIOUS WAVE section at all', () => {
  // This is what keeps the tier snapshots stable: a first wave's prompt must be
  // exactly the prompt it was before handoffs existed.
  for (const empty of [[], undefined, null, 'nonsense', [null, 'x']]) {
    const prompt = assembleFromSource({ ...forTier(2), previousHandoffs: empty })
    assert.doesNotMatch(prompt, /PREVIOUS WAVE/, `${JSON.stringify(empty)} must render nothing`)
  }
  assert.equal(
    assembleFromSource({ ...forTier(2), previousHandoffs: [] }),
    readFileSync(join(FIXTURES, 'implementer-tier-2.txt'), 'utf8')
  )
})

test('packets are rendered with status, summary, evidence and next', () => {
  const prompt = assembleFromSource({
    ...forTier(3),
    previousHandoffs: [handoff(), handoff({ taskId: '1.2', summary: 'Indexed email.' })]
  })
  assert.match(prompt, /PREVIOUS WAVE \(schema-validated; do not re-derive from git\):/)
  assert.match(prompt, /- \[1\.1 ok\] Added the sessions table\./)
  assert.match(prompt, /evidence: db\/schema\.sql:12-40/)
  assert.match(prompt, /next: Wire login against this table\./)
  assert.match(prompt, /- \[1\.2 ok\] Indexed email\./)
})

test('a blocked packet carries its blocker into the next wave', () => {
  const prompt = assembleFromSource({
    ...forTier(3),
    previousHandoffs: [
      handoff({ status: 'blocked', blocker: 'migration runner is missing', next: 'add one first' })
    ]
  })
  assert.match(prompt, /- \[1\.1 blocked\]/)
  assert.match(prompt, /blocker: migration runner is missing/)
})

test('the previous-wave block never tells the agent to reconstruct from git', () => {
  const prompt = assembleFromSource({ ...forTier(3), previousHandoffs: [handoff()] })
  assert.match(prompt, /do not re-derive from git/)
  assert.doesNotMatch(prompt, /git log|git status|git diff/)
})
