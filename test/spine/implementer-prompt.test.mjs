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
// The function is imported from lib/prompts/implementer.mjs. It used to be read
// out of workflows/ship.js and eval'd, because the workflow runtime rejects a
// script containing import() and prompt assembly had to live in the script. The
// CLI assembles every briefing now, so the text lives in lib/ and this test can
// import it like any other module.
//
// Deliberately Node-only. No network, no API key, no ACP or headless host —
// snapshotting what a model would have seen does not require running one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleImplementerPrompt } from '../../lib/prompts/implementer.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'prompts')

function assembleFromSource(input) {
  return assembleImplementerPrompt(input)
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

// --- lanes ----------------------------------------------------------------
//
// A lane is what an implementer is dispatched on now: an ordered task list one
// agent runs start to finish. A lane of ONE must assemble byte-identically to
// the pre-lane prompt — that is what makes `maxTasksPerAgent: 1` a true rollback
// lever rather than a differently-worded run — so the tier fixtures above are
// re-asserted through the lane input, unmodified.

const laneOf = (tier, ids = ['1.1', '1.3', '1.4'], extra = {}) => ({
  change: 'add-widget',
  lane: ids.map((id, i) => ({
    id,
    description: i === 0 ? 'sessions table' : `step ${i + 1}`,
    tier,
    model: tier === 5 ? 'opus' : tier === 1 ? 'haiku' : 'sonnet'
  })),
  previousHandoffs: [],
  ...extra
})

for (const tier of TIERS) {
  test(`a lane of one task is byte-identical to the tier ${tier} snapshot`, () => {
    const expected = readFileSync(join(FIXTURES, `implementer-tier-${tier}.txt`), 'utf8')
    assert.equal(
      assembleFromSource(laneOf(tier, ['1.1'])),
      expected,
      `a one-task lane must render the pre-lane prompt exactly. The fixtures are NOT regenerated ` +
        `for lanes: if this fails, the single-task path diverged and a cap of 1 no longer ` +
        `reproduces the old behaviour.`
    )
  })

  test(`a multi-task lane matches its tier ${tier} snapshot exactly`, () => {
    const expected = readFileSync(join(FIXTURES, `implementer-lane-tier-${tier}.txt`), 'utf8')
    assert.equal(
      assembleFromSource(laneOf(tier)),
      expected,
      `the tier ${tier} lane prompt changed. If that was intended, regenerate ` +
        `test/fixtures/prompts/implementer-lane-tier-${tier}.txt deliberately — this is a ` +
        `cap-style pin.`
    )
  })
}

test('the lane heading claims one owner, never shared files', () => {
  // A cohesion lane packs path-DISJOINT tasks, so the old heading ("they edit
  // the same files") is a false statement handed to every implementer. What the
  // heading may claim is what is true of every lane: one agent owns it.
  for (const tier of TIERS) {
    const prompt = assembleFromSource(laneOf(tier))
    assert.doesNotMatch(
      prompt,
      /edit the same files/,
      `tier ${tier}: a lane is no longer necessarily a path-collision component`
    )
    assert.match(prompt, /one lane run by you alone/)
    assert.match(prompt, /no other agent touches the files they claim/)
  }
})

// --- solo lanes -------------------------------------------------------------
//
// A solo lane is the whole change in one agent. Two things about it are pinned
// here rather than left to the fixtures alone: the heading says so, and the
// briefing is the full-read ladder however cheap the tasks were classified —
// the agent has no sibling wave to inherit context from.

for (const tier of TIERS) {
  test(`a solo lane matches its tier ${tier} snapshot exactly`, () => {
    const expected = readFileSync(join(FIXTURES, `implementer-solo-tier-${tier}.txt`), 'utf8')
    assert.equal(
      assembleFromSource(laneOf(tier, ['1.1', '1.3', '1.4'], { solo: true })),
      expected,
      `the tier ${tier} solo prompt changed. If that was intended, regenerate ` +
        `test/fixtures/prompts/implementer-solo-tier-${tier}.txt deliberately — this is a ` +
        `cap-style pin.`
    )
  })
}

test('a solo lane of low-tier tasks is briefed as the whole change at the full-read ladder', () => {
  const prompt = assembleFromSource(laneOf(2, ['1.1', '1.3', '1.4'], { solo: true }))
  assert.match(prompt, /Implement OpenSpec change "add-widget" end to end — all 3 of its tasks/)
  assert.match(prompt, /you own every task listed below, including its test tasks/)
  assert.match(prompt, /Your tier is 4\./, 'a solo agent always reads design.md and the specs')
  assert.doesNotMatch(
    prompt,
    /after typecheck\/lint pass, stop/,
    'stop-on-green would end the run halfway through the change'
  )
})

test('the same lane without the solo flag is the ordinary tier-2 lane prompt', () => {
  const prompt = assembleFromSource(laneOf(2))
  assert.match(prompt, /Your tier is 2\./)
  assert.match(prompt, /after typecheck\/lint pass, stop/)
  assert.doesNotMatch(prompt, /end to end/)
})

test('solo raises the briefing without touching the tasks it was given', () => {
  // Tier is the classifier's record: effort and the promotion report are read
  // off it, so raising the BRIEFING must not rewrite it.
  const input = laneOf(2, ['1.1', '1.3', '1.4'], { solo: true })
  assembleFromSource(input)
  assert.deepEqual(
    input.lane.map(t => t.tier),
    [2, 2, 2]
  )
})

test('a solo lane still reports an outcome per task and stops at the first failure', () => {
  const prompt = assembleFromSource(laneOf(3, ['1.1', '1.3', '1.4'], { solo: true }))
  assert.match(prompt, /STOP at the first task you cannot complete/)
  assert.match(prompt, /"outcome": "ok" \| "failed" \| "not-attempted"/)
  assert.match(prompt, /report all 3/)
})

test('a lane prompt names every task in execution order', () => {
  const prompt = assembleFromSource(laneOf(2))
  assert.match(prompt, /Implement 3 tasks from OpenSpec change "add-widget", IN THIS ORDER/)
  const order = ['TASK 1/3 — 1.1', 'TASK 2/3 — 1.3', 'TASK 3/3 — 1.4'].map(s => prompt.indexOf(s))
  assert.ok(order.every(i => i > -1), `every task must be named: ${JSON.stringify(order)}`)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'and named in execution order')
})

test('a lane prompt carries the stop-at-first-failure instruction and per-task outcomes', () => {
  const prompt = assembleFromSource(laneOf(3))
  assert.match(prompt, /STOP at the first task you cannot complete/)
  assert.match(prompt, /report every task after it as not-attempted/)
  assert.match(prompt, /"outcome": "ok" \| "failed" \| "not-attempted"/)
  assert.match(prompt, /omits a task you were given fails every task in this lane/)
  assert.match(
    prompt,
    /Do not pass a packet between your own tasks/,
    'intra-lane handoffs are the token saving; asking for them would spend it'
  )
})

test('a one-task lane is never told about lanes at all', () => {
  const prompt = assembleFromSource(laneOf(2, ['1.1']))
  assert.doesNotMatch(prompt, /not-attempted/)
  assert.doesNotMatch(prompt, /IN THIS ORDER/)
  assert.match(prompt, /Implement exactly one task/)
})

test('a mixed-tier lane is briefed at its highest tier', () => {
  const input = laneOf(2)
  input.lane[1] = { ...input.lane[1], tier: 4 }
  const prompt = assembleFromSource(input)
  assert.match(prompt, /Your tier is 4\./, 'one agent must be briefed for its hardest task')
  assert.doesNotMatch(
    prompt,
    /after typecheck\/lint pass, stop/,
    'stop-on-green is a tier 1-2 rule and a tier-4 task in the lane withdraws it'
  )
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
