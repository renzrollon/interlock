// The ship meter's step timeline: a step's words from its own fields, and the
// order the pane lays the launch, the steps, the agents they spawned, the
// relays no step names and the agents nothing names. Pure rules over plain
// inputs, pinned here under Node; the hooks module's drawing of them is
// `test/mod/meter.test.ts`'s, under `claude plugin test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { walkModule } from '../helpers/module-walk.mjs'
import { summarizePlan } from '../../lib/plan-summary.mjs'
import {
  BATCH_ACTIONS,
  batchText,
  laneCountText,
  planWaveCount,
  stepText,
  timeline
} from '../../lib/meter-timeline.mjs'
import { FIXTURE_PLAN_SUMMARY, REVISED_PLAN_SUMMARY } from '../fixtures/mod/steps.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY = join(ROOT, 'lib', 'meter-timeline.mjs')
const MOD = join(ROOT, 'hooks', 'mod.mjs')

const sha = c => c.repeat(64)
const spawn = (label, c) => ({ label, title: `task ${label}`, sha: c === null ? null : sha(c) })
const stepOf = (n, at, over = {}) => ({ n, at, action: 'run-batch', spawns: [], relayId: null, ...over })
const agent = (id, over = {}) => ({ id, sha: null, relay: null, firstAt: null, ...over })
const keys = entries => entries.map(e => e.key)
const shape = entries => entries.map(e => `${'  '.repeat(e.depth)}${e.key}`)

// --- a step's words ---------------------------------------------------------

test('a batch step reads its action, wave, batch position and how many lanes it runs side by side', () => {
  const three = stepOf(0, 1, { wave: 1, waveIndex: 0, batchIndex: 0, batchCount: 1, spawns: [spawn('1.1', 'a'), spawn('1.2', 'b'), spawn('1.3', 'c')] })
  assert.equal(stepText(three), 'run-batch · wave 1 · batch 1/1 · 3 in parallel')
  const one = stepOf(1, 2, { action: 'test-wave', wave: 2, batchIndex: 1, batchCount: 3, spawns: [spawn('3.1', 'd')] })
  assert.equal(stepText(one), 'test-wave · wave 2 · batch 2/3 · 1 lane')
  // The relayed shape carries no batch position and may dispatch nothing: no word stands in for either.
  assert.equal(stepText(stepOf(2, 3, { action: 'test-wave', wave: 2 })), 'test-wave · wave 2')
  assert.ok(BATCH_ACTIONS.has('run-batch') && BATCH_ACTIONS.has('test-wave') && BATCH_ACTIONS.size === 2)
})

test('the batch position is the status line\'s numbering, one-based, and absent without both indices', () => {
  assert.equal(batchText(0, 2), 'batch 1/2')
  assert.equal(batchText(1, 2), 'batch 2/2')
  for (const [i, k] of [[undefined, 2], [0, undefined], [null, null], ['0', 2], [0.5, 2]]) assert.equal(batchText(i, k), null)
  // The hooks module composes the status line from the same helper, so the two cannot drift.
  const mod = readFileSync(MOD, 'utf8')
  assert.match(mod, /const batch = batchText\(run\.batchIndex, run\.batchCount\)/)
  assert.ok(!mod.includes('batchIndex + 1'), 'the hooks module spells its own batch numbering')
})

test('a lane count reads `N in parallel` past one, `1 lane` for one, and nothing for none', () => {
  assert.equal(laneCountText(1), '1 lane')
  assert.equal(laneCountText(2), '2 in parallel')
  assert.equal(laneCountText(5), '5 in parallel')
  for (const none of [0, -1, null, undefined, 1.5]) assert.equal(laneCountText(none), null)
  // Only a batch action counts its lanes: a verify that spawned one names none.
  assert.equal(stepText(stepOf(0, 1, { action: 'verify', wave: 1, spawns: [spawn('v', 'e')] })), 'verify · wave 1')
})

test('a skipped verification reads its reason, or only that it was skipped; an unskipped one reads neither', () => {
  assert.equal(stepText(stepOf(0, 1, { action: 'verify', wave: 1, skipped: true, reason: 'no-detectable-command' })), 'verify · wave 1 · skipped: no-detectable-command')
  assert.equal(stepText(stepOf(0, 1, { action: 'verify', wave: 1, skipped: true })), 'verify · wave 1 · skipped')
  assert.equal(stepText(stepOf(0, 1, { action: 'verify', wave: 1, skipped: true, reason: '' })), 'verify · wave 1 · skipped')
  assert.equal(stepText(stepOf(0, 1, { action: 'verify', wave: 1, skipped: false, reason: 'x' })), 'verify · wave 1')
})

test('a halt reads its reason when it carries one; the close record\'s halt reads the action alone', () => {
  assert.equal(stepText(stepOf(0, 1, { action: 'halt', reason: 'inter-wave verification failed twice' })), 'halt · inter-wave verification failed twice')
  assert.equal(stepText(stepOf(0, 1, { action: 'halt' })), 'halt')
  // A reason on any other action is not drawn.
  assert.equal(stepText(stepOf(0, 1, { action: 'replan', reason: 'x' })), 'replan')
})

test('a step that relayed a plan summary reads its size, the test wave counted', () => {
  assert.equal(planWaveCount(FIXTURE_PLAN_SUMMARY), 3)
  assert.equal(planWaveCount(REVISED_PLAN_SUMMARY), 3)
  assert.equal(planWaveCount({ ...FIXTURE_PLAN_SUMMARY, testWave: null }), 2)
  assert.equal(planWaveCount(summarizePlan({ waves: [] })), 0)
  for (const none of [null, undefined, 'plan', { waves: 'none' }, []]) assert.equal(planWaveCount(none), null)
  assert.equal(stepText(stepOf(0, 1, { wave: 1, planWaves: 3, spawns: [spawn('1.1', 'a')] })), 'run-batch · wave 1 · 1 lane · plan: 3 waves')
  assert.equal(stepText(stepOf(0, 1, { action: 'replan', planWaves: 1 })), 'replan · plan: 1 wave')
  assert.equal(stepText(stepOf(0, 1, { action: 'replan', planWaves: null })), 'replan')
})

test('an action the meter does not know reads verbatim, with no word of the meter\'s own', () => {
  assert.equal(stepText(stepOf(0, 1, { action: 'a-new-action' })), 'a-new-action')
  assert.equal(stepText(stepOf(0, 1, { action: 'commit', wave: 0 })), 'commit · wave 0')
  assert.equal(stepText(stepOf(0, 1, { action: 'review', wave: null })), 'review')
  // Every word drawn is one of the step's fields or a fixed connective: no verdict, no state.
  const words = stepText(stepOf(0, 1, { wave: 1, batchIndex: 0, batchCount: 2, spawns: [spawn('a', 'a'), spawn('b', 'b')], planWaves: 2 }))
  assert.equal(words, 'run-batch · wave 1 · batch 1/2 · 2 in parallel · plan: 2 waves')
  assert.doesNotMatch(words, /ok|failed|current|done|running|waiting/)
})

// --- the timeline's order -----------------------------------------------------

test('the launch, the steps and the orphan relays are laid by time, ties keeping their crossing order', () => {
  const steps = [stepOf(0, 100), stepOf(1, 300), stepOf(2, 300), stepOf(3, 500)]
  const agents = [agent('r1', { relay: 'limits', firstAt: 300 }), agent('r2', { relay: 'graph query', firstAt: 200 })]
  const entries = timeline({ steps, agents, launch: { at: 50, name: 'interlock:ship' } })
  assert.deepEqual(keys(entries), ['launch', 'step-0', 'agent-r2', 'step-1', 'step-2', 'agent-r1', 'step-3'])
  assert.deepEqual(entries.map(e => e.kind), ['launch', 'step', 'relay', 'step', 'step', 'relay', 'step'])
  assert.deepEqual(entries.map(e => e.depth), [0, 0, 0, 0, 0, 0, 0])
  assert.equal(entries[0].name, 'interlock:ship')
})

test('an entry with no time follows every timed one, in its input order', () => {
  const steps = [stepOf(0, null), stepOf(1, 200), stepOf(2, null), stepOf(3, 100)]
  const agents = [agent('r1', { relay: 'limits' }), agent('r2', { relay: 'limits', firstAt: 150 })]
  assert.deepEqual(keys(timeline({ steps, agents, launch: { at: null } })), ['step-3', 'agent-r2', 'step-1', 'launch', 'step-0', 'step-2', 'agent-r1'])
  // With no reading at all, the crossing order stands: the launch, the steps, the relays.
  const none = timeline({ steps: [stepOf(0, null), stepOf(1, null)], agents: [agent('r1', { relay: 'limits' })], launch: { at: null } })
  assert.deepEqual(keys(none), ['launch', 'step-0', 'step-1', 'agent-r1'])
  assert.ok(none.every(e => e.at === null))
  // A launch that is not known is not drawn.
  assert.deepEqual(keys(timeline({ steps: [stepOf(0, 1)] })), ['step-0'])
  assert.deepEqual(timeline(), [])
})

test('a step\'s spawns sit beneath it: joined by hash in their agents\' start order, then the waiting ones in spawn order', () => {
  const steps = [stepOf(0, 10, { spawns: [spawn('1.1', 'a'), spawn('1.2', 'b'), spawn('1.3', 'c'), spawn('1.4', 'd'), spawn('1.5', null)] })]
  const agents = [
    agent('a-late', { sha: sha('a'), firstAt: 40 }),
    agent('c-early', { sha: sha('c'), firstAt: 20 }),
    agent('b-tie', { sha: sha('b'), firstAt: 20 }),
    agent('d-none', { sha: sha('d') })
  ]
  const entries = timeline({ steps, agents })
  // Two agents that started at the same reading keep the step's spawn order (1.2 before 1.3), whatever order they were seen in.
  assert.deepEqual(shape(entries), ['step-0', '  agent-b-tie', '  agent-c-early', '  agent-a-late', '  agent-d-none', '  spawn-0-1.5'])
  const kids = entries.slice(1)
  assert.ok(kids.every(e => e.kind === 'spawn' && e.depth === 1 && e.step === steps[0]))
  assert.deepEqual(kids.map(e => e.spawn.label), ['1.2', '1.3', '1.1', '1.4', '1.5'])
  assert.deepEqual(kids.map(e => e.at), [20, 20, 40, null, null])
  assert.equal(kids[4].agent, null)
  assert.equal(kids[0].agent, agents[2])
})

test('the same label dispatched again by a later step is a separate child beneath that step', () => {
  const steps = [
    stepOf(0, 10, { spawns: [spawn('1.1', 'a'), spawn('1.2', 'b')] }),
    stepOf(1, 30, { spawns: [spawn('1.1', 'e')] })
  ]
  const agents = [agent('x', { sha: sha('a'), firstAt: 12 }), agent('y', { sha: sha('e'), firstAt: 31 })]
  assert.deepEqual(shape(timeline({ steps, agents })), ['step-0', '  agent-x', '  spawn-0-1.2', 'step-1', '  agent-y'])
  // Before the second agent joins, the re-dispatch waits under its own step and the first stays joined.
  assert.deepEqual(shape(timeline({ steps, agents: agents.slice(0, 1) })), ['step-0', '  agent-x', '  spawn-0-1.2', 'step-1', '  spawn-1-1.1'])
})

test('one agent per spawn by hash, in step order; an agent beyond them stays with the last', () => {
  const steps = [stepOf(0, 10, { spawns: [spawn('1.1', 'a')] }), stepOf(1, 20, { spawns: [spawn('1.1', 'a')] })]
  const one = [agent('p', { sha: sha('a'), firstAt: 11 })]
  assert.deepEqual(shape(timeline({ steps, agents: one })), ['step-0', '  agent-p', 'step-1', '  spawn-1-1.1'])
  const three = [...one, agent('q', { sha: sha('a'), firstAt: 21 }), agent('r', { sha: sha('a'), firstAt: 22 })]
  assert.deepEqual(shape(timeline({ steps, agents: three })), ['step-0', '  agent-p', 'step-1', '  agent-q', '  agent-r'])
})

test('a step\'s relay is drawn on its line and nowhere else; a relay no step names stands at its own time', () => {
  const steps = [stepOf(0, 10, { relayId: 'ping1', spawns: [spawn('1.1', 'a')] }), stepOf(1, 50, { relayId: 'ping2' })]
  const agents = [
    agent('ping1', { relay: 'run next', firstAt: 9 }),
    agent('lim', { relay: 'limits', firstAt: 30 }),
    agent('ping2', { relay: 'run next', firstAt: 49 }),
    // A step's relay that also carried a briefing hash is still its step's, never a child.
    agent('ping3', { sha: sha('a'), firstAt: 11 })
  ]
  const withRelayChild = [...steps, stepOf(2, 60, { relayId: 'ping3' })]
  const entries = timeline({ steps: withRelayChild, agents, launch: { at: 1 } })
  assert.deepEqual(shape(entries), ['launch', 'step-0', '  spawn-0-1.1', 'agent-lim', 'step-1', 'step-2'])
  assert.equal(entries.find(e => e.key === 'agent-lim').kind, 'relay')
  assert.equal(entries.filter(e => e.agent && ['ping1', 'ping2', 'ping3'].includes(e.agent.id)).length, 0)
})

test('the agents nothing names form a trailing group under one head, first seen first', () => {
  const steps = [stepOf(0, 10, { spawns: [spawn('1.1', 'a')] })]
  const agents = [
    agent('u2', { firstAt: 50 }),
    agent('j', { sha: sha('a'), firstAt: 12 }),
    agent('u1', { firstAt: 5 }),
    // A hash no step's spawn carries joins nothing.
    agent('u3', { sha: sha('z') })
  ]
  const entries = timeline({ steps, agents, launch: { at: 1 } })
  assert.deepEqual(shape(entries), ['launch', 'step-0', '  agent-j', 'agents-unmatched-head', '  agent-u2', '  agent-u1', '  agent-u3'])
  assert.deepEqual(entries.slice(3).map(e => e.kind), ['unmatched-head', 'unmatched', 'unmatched', 'unmatched'])
  assert.deepEqual(entries.slice(4).map(e => e.at), [50, 5, null])
  // No unmatched agent, no head.
  assert.ok(!keys(timeline({ steps, agents: [agents[1]] })).includes('agents-unmatched-head'))
})

test('every agent is drawn once, and every key is unique', () => {
  const steps = [
    stepOf(0, 10, { relayId: 'r', spawns: [spawn('1.1', 'a'), spawn('1.2', 'b')] }),
    stepOf(1, 20, { spawns: [spawn('1.1', 'c')] })
  ]
  const agents = [
    agent('r', { relay: 'run next', firstAt: 9 }),
    agent('a1', { sha: sha('a'), firstAt: 11 }),
    agent('c1', { sha: sha('c'), firstAt: 21 }),
    agent('o', { relay: 'limits', firstAt: 15 }),
    agent('u', { firstAt: 3 })
  ]
  const entries = timeline({ steps, agents, launch: { at: 1 } })
  const all = keys(entries)
  assert.equal(new Set(all).size, all.length)
  const drawn = entries.filter(e => e.agent).map(e => e.agent.id)
  assert.deepEqual([...drawn].sort(), ['a1', 'c1', 'o', 'u'])
})

// --- purity -----------------------------------------------------------------------

test('the timeline imports nothing that reaches Node, so the hooks module can load it in the engine', () => {
  const { files, problems } = walkModule(ENTRY, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(files, [ENTRY])
})

test('the timeline never spells the clean close\'s word', () => {
  assert.equal(readFileSync(ENTRY, 'utf8').search(/complete/i), -1)
})
