// The plan summary (draw-the-wave-board-in-the-meter-pane, spec ship/diagrams):
// the `plan` field the adoption and replan steps carry for the ship meter's
// board, drawn through the real renderer against the real halted run.
//
// The summary is a contract the relay pays for on every adoption, so this file
// pins both halves of it: that it draws exactly as its source, and that it
// carries nothing the board does not read. The fixture is the sibling's byte
// copy of one real run (see test/spine/draw-plan.test.mjs for its provenance).
// Widths are read from LIMITS, never restated.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { summarizePlan } from '../../lib/plan-summary.mjs'
import { drawPlanBoard } from '../../lib/draw-plan.mjs'
import { titleGist } from '../../lib/lane.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { walkModule } from '../helpers/module-walk.mjs'
import * as F from '../fixtures/mod/steps.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE = join(ROOT, 'test/fixtures/ship/halted-run-6e9d0b02')
const load = name => JSON.parse(readFileSync(join(FIXTURE, name), 'utf8'))
const PLAN = load('plan.json')
const STATE = load('state.json')
const columns = LIMITS.waveBoardDefaultColumns

const TASK_KEYS = ['id', 'tier', 'model', 'description']
const WAVE_KEYS = ['index', 'group', 'kind', 'red', 'batches']
const TEST_WAVE_KEYS = ['index', 'batches']
const RECORD_KEYS = ['id', 'group', 'after']

/** Every task of a summary or a plan, in position order. */
const tasksOf = source =>
  [...source.waves, ...(source.testWave ? [source.testWave] : [])].flatMap(w => w.batches.flat(2))

/**
 * What a summary carries that the board does not read, one message per field
 * found: a key outside the stated shape at any level, or a description longer
 * than the gist the lane title is built from.
 */
function forbidden(summary) {
  const out = []
  const extra = (where, value, allowed) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) out.push(`${where} carries ${key}`)
  }
  extra('the summary', summary, ['waves', 'testWave', 'deferred'])
  const check = (wave, where, allowed) => {
    extra(where, wave, allowed)
    for (const task of wave.batches.flat(2)) {
      extra(`task ${task.id}`, task, TASK_KEYS)
      if (typeof task.description === 'string' && task.description !== titleGist(task.description)) {
        out.push(`task ${task.id} carries a description longer than the title gist`)
      }
    }
  }
  summary.waves.forEach((wave, i) => check(wave, `wave ${i}`, WAVE_KEYS))
  if (summary.testWave) check(summary.testWave, 'the test wave', TEST_WAVE_KEYS)
  for (const record of summary.deferred) extra(`deferral ${record.id}`, record, RECORD_KEYS)
  return out
}

/** The ids of each lane of each block, as drawn order. */
const laneIds = summary =>
  [...summary.waves, ...(summary.testWave ? [summary.testWave] : [])].map(w => w.batches.map(b => b.map(l => l.map(t => t.id))))

test('a summary task carries exactly id, tier, model and the title gist', () => {
  const summary = summarizePlan(PLAN)
  assert.deepEqual(forbidden(summary), [])
  for (const task of tasksOf(summary)) assert.deepEqual(Object.keys(task), TASK_KEYS, task.id)
  const planned = new Map(tasksOf(PLAN).map(t => [t.id, t]))
  for (const task of tasksOf(summary)) {
    assert.equal(task.description, titleGist(planned.get(task.id).description), task.id)
    assert.equal(task.tier, planned.get(task.id).tier)
    assert.equal(task.model, planned.get(task.id).model)
  }
  assert.deepEqual(
    summary.waves.map(w => [w.index, w.group, w.kind]),
    [
      [0, 1, 'impl'],
      [1, 1, 'impl']
    ]
  )
  assert.equal(summary.testWave.index, 2)
})

test('a field the board does not read fails the summary, named', () => {
  const summary = summarizePlan(PLAN)
  const plant = mutate => {
    const copy = structuredClone(summary)
    mutate(copy, copy.waves[0].batches[0][0][0])
    return forbidden(copy).join('\n')
  }
  assert.match(plant((_, t) => (t.paths = ['lib/x.mjs'])), /task 1\.7 carries paths/)
  assert.match(plant((_, t) => (t.group = 1)), /task 1\.7 carries group/)
  assert.match(plant((_, t) => (t.isTestTask = false)), /task 1\.7 carries isTestTask/)
  assert.match(plant((_, t) => (t.description = tasksOf(PLAN)[0].description)), /longer than the title gist/)
  assert.match(plant((_, t) => (t.prompt = 'the briefing')), /task 1\.7 carries prompt/)
  assert.match(plant(s => (s.waves[0].remainingBatches = [])), /wave 0 carries remainingBatches/)
  assert.match(plant(s => (s.previousHandoffs = [])), /the summary carries previousHandoffs/)
})

test('the fixture plan and its summary draw the same board, with and without the state', () => {
  const summary = summarizePlan(PLAN)
  assert.deepEqual(drawPlanBoard(summary, { columns }), drawPlanBoard(PLAN, { columns }))
  assert.deepEqual(drawPlanBoard(summary, { columns, state: STATE }), drawPlanBoard(PLAN, { columns, state: STATE }))
})

test("the state's summary draws as the plan it adopted, its deferrals derived", () => {
  // The state keeps no deferral list, so the summary derives one from the tasks'
  // own `dependsOn`; it is the plan's four, as a set (design D3).
  const summary = summarizePlan(STATE)
  const asSet = records => records.map(r => `${r.id}:${r.group}:${r.after.join(',')}`).sort()
  assert.deepEqual(asSet(summary.deferred), asSet(PLAN.deferred))
  assert.deepEqual(laneIds(summary), laneIds(summarizePlan(PLAN)))
  assert.deepEqual(drawPlanBoard(summary, { columns }), drawPlanBoard(PLAN, { columns }))
  assert.deepEqual(drawPlanBoard(summary, { columns, state: STATE }), drawPlanBoard(PLAN, { columns, state: STATE }))
  // Given the planner's own records, the summary carries those instead.
  assert.deepEqual(summarizePlan(STATE, { deferred: PLAN.deferred }).deferred, PLAN.deferred)
})

test('a replanned state summarises its revised waves, and a state with no waves the empty board', () => {
  const revised = {
    ...STATE,
    waves: [STATE.waves[0], { ...STATE.waves[1], batches: STATE.waves[1].batches.slice(0, 2) }, STATE.waves[2]]
  }
  const summary = summarizePlan(revised)
  assert.deepEqual(laneIds(summary)[1], [[['1.5'], ['1.1']], [['2.1']]])
  const lines = drawPlanBoard(summary, { columns })
  assert.notDeepEqual(lines, drawPlanBoard(PLAN, { columns }))
  const second = lines.filter(line => line.startsWith('┌'))[1]
  assert.ok(second.includes('idx 1') && second.includes('2 batches'), second)

  for (const empty of [{ ...STATE, waves: [] }, { waves: [], testWave: null }]) {
    const none = summarizePlan(empty)
    assert.deepEqual(none, { waves: [], testWave: null, deferred: [] })
    assert.deepEqual(drawPlanBoard(none, { columns }), drawPlanBoard({ waves: [], testWave: null }, { columns }))
    assert.ok(drawPlanBoard(none, { columns })[0].includes('holds no waves'))
  }
})

test('a task with no description, tier or model summarises without one', () => {
  const plan = { waves: [{ group: 1, batches: [[[{ id: '9.1', group: 1, paths: ['a'] }]]] }], testWave: null, deferred: [] }
  let summary
  assert.doesNotThrow(() => (summary = summarizePlan(plan)))
  assert.deepEqual(summary.waves[0].batches, [[[{ id: '9.1' }]]])
  const lines = drawPlanBoard(summary, { columns })
  assert.deepEqual(lines, drawPlanBoard(plan, { columns }))
  const row = lines.find(line => line.startsWith('│'))
  assert.ok(row.includes(' 9.1 ') && row.includes(' T? ') && !row.includes(' · '), row)
})

test('the summary prints at under a quarter of the plan', () => {
  const printed = value => JSON.stringify(value, null, 2).length
  const summary = summarizePlan(STATE, { deferred: PLAN.deferred })
  assert.ok(printed(summary) * 4 < printed(PLAN), `${printed(summary)} bytes against the plan's ${printed(PLAN)}`)
})

test('the summary module is pure and Node-free, its closure the lane rule and the limits', () => {
  const entry = join(ROOT, 'lib', 'plan-summary.mjs')
  const { files, problems } = walkModule(entry, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  const allowed = new Set(['plan-summary.mjs', 'lane.mjs', 'limits.mjs'].map(name => join(ROOT, 'lib', name)))
  for (const file of files) assert.ok(allowed.has(file), `lib/plan-summary.mjs reaches ${file}`)
  assert.ok(files.includes(join(ROOT, 'lib', 'lane.mjs')), 'the gist and the dependency reader are the lane rule')
  const source = readFileSync(entry, 'utf8')
  for (const token of ['process.', 'Date', 'performance', 'globalThis', 'readFileSync', 'import(']) {
    assert.ok(!source.includes(token), `lib/plan-summary.mjs contains ${token}`)
  }
})

test("the meter fixtures' summary literal is the fixture plan's summary", () => {
  assert.deepEqual(F.ADOPTION_BATCH.plan, summarizePlan(PLAN))
  assert.deepEqual(forbidden(F.REVISED_PLAN_SUMMARY), [])
})
