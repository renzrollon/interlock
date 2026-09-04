import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planWaves,
  formatPlan,
  laneEffort,
  projectedWaveLoopAgents,
  DEFAULT_MAX_PARALLEL,
  createRunState,
  nextStep,
  recordBatchResult,
  recordVerifyResult,
  applyReplan,
  formatRunState,
  HALT_TASK_FAILURES,
  HALT_INTER_WAVE_VERIFY,
  SKIP_VERIFY_DOCS,
  SKIP_VERIFY_CAP,
  HANDOFF_SCHEMA,
  AUDIT_CONFIRMED,
  AUDIT_UNCONFIRMED,
  AUDIT_NOT_AUDITED,
  isDocsOnlyWave,
  batchOutcomes,
  OUTCOME_OK,
  OUTCOME_FAILED,
  OUTCOME_NOT_ATTEMPTED
} from '../../lib/waves.mjs'
import { LIMITS, RUNTIME, LANE_CAPS, SOLO } from '../../lib/limits.mjs'

const task = (over = {}) => ({
  id: '1.1',
  group: 1,
  description: 'do a thing',
  tier: 2,
  model: 'sonnet',
  isTestTask: false,
  ...over
})

// --- reading a laned plan --------------------------------------------------
//
// A wave's batches hold LANES, and a lane holds tasks: batches → lanes → tasks.
// These three readers exist so a test says which level it means. Before lanes,
// `batches[0][0]` was a task; it is now a lane, and a fixture that kept reading
// it as a task would compare `undefined` against `undefined` and pass.

/** Lane structure of a wave: `[[['1.1','1.2'], ['1.3']], ...]` per batch. */
const laneIds = wave => wave.batches.map(b => b.map(lane => lane.map(t => t.id)))

/** Task ids per batch, flattened across the batch's lanes. */
const batchIds = wave => wave.batches.map(b => b.flat().map(t => t.id))

/** Every task in a `run-batch`/`test-wave` step, across the batch's lanes. */
const stepTasks = step => (Array.isArray(step.tasks) ? step.tasks.flat() : [])

/** The first task of the first lane of the first batch. */
const firstTask = plan => plan.waves[0].batches[0][0][0]

/** Which batch a task landed in, and which lane inside it. */
function placementOf(plan, id) {
  const wave = plan.waves.find(w => w.batches.some(b => b.some(l => l.some(t => t.id === id))))
  if (!wave) return { batch: -1, lane: -1 }
  const batch = wave.batches.findIndex(b => b.some(l => l.some(t => t.id === id)))
  const lane = wave.batches[batch].findIndex(l => l.some(t => t.id === id))
  return { batch, lane }
}

test('groups become waves, ordered ascending regardless of input order', () => {
  // Two tasks per group: a 1-task group is folded onto the wave before it, so a
  // one-per-group fixture would be measuring the fold, not the ordering.
  const plan = planWaves({
    tasks: [
      task({ id: '3.1', group: 3 }),
      task({ id: '3.2', group: 3 }),
      task({ id: '1.1', group: 1 }),
      task({ id: '1.2', group: 1 }),
      task({ id: '2.1', group: 2 }),
      task({ id: '2.2', group: 2 })
    ]
  })
  assert.deepEqual(plan.waves.map(w => w.group), [1, 2, 3])
  assert.equal(plan.waveCount, 3)
  assert.deepEqual(plan.folded, [])
})

test('test tasks are pulled out into a trailing test wave', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1 }),
      task({ id: '1.2', group: 1, isTestTask: true })
    ]
  })
  assert.equal(plan.implCount, 1)
  assert.equal(plan.testCount, 1)
  assert.equal(plan.waves.length, 1)
  assert.equal(plan.waves[0].taskCount, 1)
  assert.equal(plan.testWave.taskCount, 1)
})

test('testWave is null when nothing is a test task', () => {
  const plan = planWaves({ tasks: [task()] })
  assert.equal(plan.testWave, null)
})

// --- the clamp ------------------------------------------------------------

test('clamps overeager opus below tier 5', () => {
  const plan = planWaves({ tasks: [task({ tier: 3, model: 'opus' })] })
  assert.equal(firstTask(plan).model, 'sonnet')
  assert.deepEqual(plan.clamped, [{ id: '1.1', from: 'opus', to: 'sonnet', tier: 3 }])
})

test('opus survives on a true tier-5 task', () => {
  const plan = planWaves({ tasks: [task({ tier: 5, model: 'opus' })] })
  assert.equal(firstTask(plan).model, 'opus')
  assert.deepEqual(plan.clamped, [])
})

test('haiku stays haiku', () => {
  const plan = planWaves({ tasks: [task({ tier: 1, model: 'haiku' })] })
  assert.equal(firstTask(plan).model, 'haiku')
  assert.deepEqual(plan.clamped, [])
})

test('the clamp does not mutate the caller input', () => {
  const input = { tasks: [task({ tier: 2, model: 'opus' })] }
  planWaves(input)
  assert.equal(input.tasks[0].model, 'opus', 'caller object must be untouched')
})

// --- the fan-out cap ------------------------------------------------------

test('a wide wave is split into batches of at most maxParallel', () => {
  // Tier 4, so cohesion leaves them alone and the wave is genuinely 30 lanes
  // wide. At tier 2 they would pack into four lanes and there would be no width
  // left for the batch splitter to act on — the test would still pass and would
  // no longer be testing the splitter.
  const tasks = Array.from({ length: 30 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 4 })
  )
  const plan = planWaves({ tasks }, { maxParallel: 8 })
  const wave = plan.waves[0]
  assert.equal(wave.taskCount, 30)
  assert.equal(wave.batches.length, 4, '30 tasks at 8 wide = 4 batches')
  assert.deepEqual(wave.batches.map(b => b.length), [8, 8, 8, 6])
  assert.ok(wave.batches.every(b => b.length <= 8))
  assert.ok(plan.warnings.some(w => w.includes('30 tasks')))
})

test('the hardest tasks land in the first batch of a wide wave', () => {
  // Boehm's riskiest-first, applied inside a wave. A tier-5 task that fails means
  // the design was wrong; finding that out in batch 1 is cheaper than in batch 4,
  // after the wave's budget is gone.
  const tasks = [
    ...Array.from({ length: 20 }, (_, i) => task({ id: `1.${i + 1}`, tier: 2 })),
    task({ id: '1.90', tier: 5, model: 'opus' }),
    task({ id: '1.91', tier: 4 })
  ]
  const plan = planWaves({ tasks }, { maxParallel: 8 })
  const first = batchIds(plan.waves[0])[0]
  assert.equal(first[0], '1.90', 'the tier-5 task runs first')
  assert.equal(first[1], '1.91', 'then the tier-4')
})

test('batch composition is deterministic for the same input', () => {
  // Ties break on id, so a re-run of the same classified input produces the same
  // batches. Without that nothing downstream of the plan is reproducible.
  const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `1.${i + 1}`, tier: 3 }))
  const a = planWaves({ tasks }, { maxParallel: 5 })
  const b = planWaves({ tasks: [...tasks].reverse() }, { maxParallel: 5 })
  assert.deepEqual(laneIds(a.waves[0]), laneIds(b.waves[0]))
})

// --- path collisions ------------------------------------------------------

test('two tasks in one group claiming the same path stay in one wave, one lane', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts', 'src/other.ts'] })
    ]
  })
  assert.equal(plan.waveCount, 1)
  assert.deepEqual(
    laneIds(plan.waves[0]),
    [[['1.1', '1.2']]],
    'a collision is one lane run by one agent, not two batches of one task'
  )
})

test('a collision is recorded in serialized and in warnings', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.equal(plan.serialized.length, 1)
  assert.equal(plan.serialized[0].id, '1.2')
  assert.equal(plan.serialized[0].path, 'src/auth.ts')
  assert.equal(plan.serialized[0].conflictsWith, '1.1')
  assert.equal(plan.serialized[0].group, 1)
  assert.ok(plan.warnings.some(w => w.includes('1.2') && w.includes('src/auth.ts')))
})

test('disjoint paths in one group stay in one group', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/b.ts'] })
    ]
  })
  assert.equal(plan.waveCount, 1)
  assert.deepEqual(plan.serialized, [])
})

test('tasks without paths are never re-grouped', () => {
  // A classifier that cannot predict paths says nothing, and nothing happens.
  // Guessing would cost a wave of parallelism for no reason.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1 }),
      task({ id: '1.2', group: 1 }),
      task({ id: '1.3', group: 1 })
    ]
  })
  assert.equal(plan.waveCount, 1)
  assert.deepEqual(plan.serialized, [])
})

test('a collision among three tasks on one path is one lane of one wave', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.equal(plan.waveCount, 1, 'collisions stay in the classified group')
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '1.3']]])
  assert.equal(plan.laneCount, 1, 'three tasks, one agent')
  assert.deepEqual(
    plan.lanes.map(l => [l.ids, l.tier]),
    [[['1.1', '1.2', '1.3'], 2]],
    'the fold is reported, not left to be inferred from a smaller agent bill'
  )
})

test('serializing preserves every task exactly once', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['a.ts'] }),
      task({ id: '1.2', group: 1, paths: ['a.ts'] }),
      task({ id: '1.3', group: 1, paths: ['b.ts'] }),
      task({ id: '2.1', group: 2, paths: ['a.ts'] })
    ]
  })
  const ids = plan.waves.flatMap(w => w.batches.flat(2)).map(t => t.id)
  assert.equal(ids.length, 4)
  assert.equal(new Set(ids).size, 4)
})

test('paths must be an array of strings when present', () => {
  assert.throws(
    () => planWaves({ tasks: [task({ paths: 'src/auth.ts' })] }),
    /paths must be an array of strings/
  )
  assert.throws(
    () => planWaves({ tasks: [task({ paths: [1, 2] })] }),
    /paths must be an array of strings/
  )
})

test('every task survives batching exactly once', () => {
  const tasks = Array.from({ length: 17 }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  const plan = planWaves({ tasks }, { maxParallel: 5 })
  const ids = plan.waves[0].batches.flat(2).map(t => t.id)
  assert.equal(ids.length, 17)
  assert.equal(new Set(ids).size, 17)
})

test('defaults to DEFAULT_MAX_PARALLEL, and ignores nonsense overrides', () => {
  assert.equal(planWaves({ tasks: [task()] }).maxParallel, DEFAULT_MAX_PARALLEL)
  assert.equal(planWaves({ tasks: [task()] }, { maxParallel: 0 }).maxParallel, DEFAULT_MAX_PARALLEL)
  assert.equal(planWaves({ tasks: [task()] }, { maxParallel: -3 }).maxParallel, DEFAULT_MAX_PARALLEL)
  assert.equal(planWaves({ tasks: [task()] }, { maxParallel: 2.5 }).maxParallel, DEFAULT_MAX_PARALLEL)
})

// --- validation -----------------------------------------------------------

test('rejects malformed input with an actionable message', () => {
  assert.throws(() => planWaves(null), /must be a JSON object/)
  assert.throws(() => planWaves({}), /must have a "tasks" array/)
  assert.throws(() => planWaves({ tasks: [task({ tier: 9 })] }), /tier must be an integer 1-5/)
  assert.throws(() => planWaves({ tasks: [task({ model: 'gpt' })] }), /model must be one of/)
  assert.throws(() => planWaves({ tasks: [task({ group: 'one' })] }), /group must be an integer/)
  assert.throws(() => planWaves({ tasks: [task({ isTestTask: 'yes' })] }), /isTestTask must be a boolean/)
  assert.throws(() => planWaves({ tasks: [task({ id: '' })] }), /id must be a non-empty string/)
})

test('rejects duplicate task ids', () => {
  assert.throws(
    () => planWaves({ tasks: [task({ id: '1.1' }), task({ id: '1.1', group: 2 })] }),
    /duplicated/
  )
})

test('warns when only test tasks were classified', () => {
  const plan = planWaves({ tasks: [task({ isTestTask: true })] })
  assert.equal(plan.implCount, 0)
  assert.ok(plan.warnings.some(w => w.includes('no implementation tasks')))
})

// --- formatting -----------------------------------------------------------

test('formatPlan renders waves, clamps and warnings', () => {
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 2, model: 'opus' }),
        task({ id: '1.2', group: 1 }),
        task({ id: '2.1', group: 2 }),
        task({ id: '2.2', group: 2 }),
        task({ id: '2.3', group: 2, isTestTask: true })
      ]
    },
    { maxParallel: 1 }
  )
  const out = formatPlan(plan)
  assert.match(out, /Wave 1: 2 task/)
  assert.match(out, /Wave 2: 2 task/)
  assert.match(out, /Test wave: 1 task/)
  assert.match(out, /clamped 1\.1: opus → sonnet \(tier 2\)/)
  assert.match(out, /projected agents:/)
})

test('formatPlan warns when the plan is still effectively serial after the fold', () => {
  // Nine impl tasks in five waves — a leading singleton (nothing to fold onto)
  // and four genuine pairs. Post-fold that is 5 > 9 * 0.5, so the warning is
  // reporting a shape the planner could not fix, which is the only shape worth
  // reporting.
  const tasks = [task({ id: '1.1', group: 1 })]
  for (const g of [2, 3, 4, 5]) {
    tasks.push(task({ id: `${g}.1`, group: g }), task({ id: `${g}.2`, group: g }))
  }
  const plan = planWaves({ tasks })
  assert.equal(plan.waveCount, 5)
  assert.deepEqual(plan.folded, [], 'nothing here was foldable')
  assert.ok(plan.warnings.some(w => /effectively serial/.test(w)))
  const out = formatPlan(plan)
  assert.match(out, /projected agents: /)
  assert.match(out, /warning: effectively serial/)
  const cost = projectedWaveLoopAgents(plan)
  assert.ok(cost.total > plan.implCount, 'a serial plan bills more agents than it has tasks')
})

// --- the singleton fold ---------------------------------------------------

test('a staircase of 1-task groups becomes one wave of sequential batches', () => {
  // The measured failure: six sequential slices of one file, classified as six
  // groups, costing six record pings and (until the cap) five verifies.
  const tasks = [2, 3, 4, 5, 6, 7].map(g =>
    task({ id: `${g}.1`, group: g, paths: ['src/planet_wars_engine/match_runner.py'] })
  )
  const plan = planWaves({ tasks })

  assert.equal(plan.waveCount, 1)
  assert.equal(plan.waves[0].group, 2, 'the surviving wave keeps the first group number')
  assert.equal(plan.waves[0].taskCount, 6)
  assert.deepEqual(
    batchIds(plan.waves[0]),
    [['2.1'], ['3.1'], ['4.1'], ['5.1'], ['6.1'], ['7.1']],
    'order is what the fold preserves'
  )
  assert.equal(
    plan.laneCount,
    6,
    'lanes are built per classified group, so a cross-group staircase is not folded into one agent'
  )
  assert.deepEqual(
    plan.folded.map(f => [f.id, f.from, f.to]),
    [['3.1', 3, 2], ['4.1', 4, 2], ['5.1', 5, 2], ['6.1', 6, 2], ['7.1', 7, 2]]
  )
  for (const f of plan.folded) {
    assert.ok(
      plan.warnings.some(w => w.includes(f.id) && w.includes(`group ${f.from}`) && w.includes(`wave ${f.to}`)),
      `the fold of ${f.id} must be reported, not silent`
    )
  }
})

test('a collapsed staircase is not reported as effectively serial', () => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    task({ id: `${i + 1}.1`, group: i + 1 })
  )
  const plan = planWaves({ tasks })
  assert.equal(plan.waveCount, 1)
  assert.ok(
    !plan.warnings.some(w => /effectively serial/.test(w)),
    'a shape the planner already collapsed is not a shape the operator must fix'
  )
  const out = formatPlan(plan)
  assert.doesNotMatch(out, /effectively serial/)
  assert.match(out, /folded 2\.1: 1-task wave 2 → later batch of wave 1/, 'the over-split stays visible')
})

test('a 1-task group after a multi-task group folds onto it', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '9.1', group: 9 }),
      task({ id: '9.2', group: 9 }),
      task({ id: '12.1', group: 12 })
    ]
  })
  assert.equal(plan.waveCount, 1)
  assert.equal(plan.waves[0].group, 9)
  assert.deepEqual(
    batchIds(plan.waves[0]),
    [['9.1', '9.2'], ['12.1']],
    'the singleton is a later batch of wave 9, not a wave of its own'
  )
  assert.deepEqual(plan.folded, [{ id: '12.1', from: 12, to: 9 }])
})

test('two multi-task waves are never folded into each other', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1 }),
      task({ id: '1.2', group: 1 }),
      task({ id: '2.1', group: 2 }),
      task({ id: '2.2', group: 2 }),
      task({ id: 't.1', group: 3, isTestTask: true })
    ]
  })
  assert.equal(plan.waveCount, 2, 'their boundary is a real checkpoint between two sets of work')
  assert.deepEqual(plan.folded, [])
  assert.equal(plan.testWave.taskCount, 1)
})

test('a leading singleton and the test wave are not folded away', () => {
  const tasks = [task({ id: '1.1', group: 1 })]
  for (let i = 0; i < 16; i++) tasks.push(task({ id: `t.${i + 1}`, group: 9, isTestTask: true }))
  const plan = planWaves({ tasks })
  assert.equal(plan.waveCount, 1, 'nothing to fold a leading singleton onto')
  assert.equal(plan.waves[0].group, 1)
  assert.equal(plan.testWave.taskCount, 16, 'the test wave keeps every test task')
  assert.deepEqual(plan.folded, [], 'the test wave is not an implementation wave in either direction')
})

test('projected record pings follow the collapsed waves, not the classified groups', () => {
  const tasks = [1, 2, 3, 4, 5, 6].map(g => task({ id: `${g}.1`, group: g }))
  tasks.push(task({ id: 't.1', group: 9, isTestTask: true }))
  const plan = planWaves({ tasks })
  const cost = projectedWaveLoopAgents(plan)
  assert.equal(cost.recordPings, 2, 'one implementation wave + one test wave, not seven')
  assert.equal(cost.implementers, 7, 'six impl tasks plus the test task')
})

// ===========================================================================
// Lanes (spec: lanes)
// ===========================================================================
//
// A lane is a connected component over canonical-path collisions, run start to
// finish by one agent. Every property below is one the batch model used to
// provide by accident and now has to provide on purpose: no two concurrent
// writers of one file, no reordering of dependent work, no task lost.

test('a three-task same-file chain becomes one lane, in task-id order', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.4', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.3', '1.4']]])
  assert.equal(projectedWaveLoopAgents(plan).implementers, 1, 'three tasks, one spawn')
})

test('a width-deferred disjoint task stays its own lane and is not folded', () => {
  // The scenario from lanes/spec.md: three disjoint tasks at maxParallel 2. The
  // third waits for a later batch; appending it to another task's lane would
  // serialize work the planner deliberately parallelized.
  //
  // Tier 4 so the three are cohesion-ineligible. Width deferral and cohesion are
  // different mechanisms with opposite answers, and this asserts the first: a
  // lane pushed out of a full batch is never merged into a lane inside it.
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 4, paths: ['src/a.ts'] }),
        task({ id: '1.2', group: 1, tier: 4, paths: ['src/b.ts'] }),
        task({ id: '1.3', group: 1, tier: 4, paths: ['src/c.ts'] })
      ]
    },
    { maxParallel: 2 }
  )
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1'], ['1.2']], [['1.3']]])
  assert.deepEqual(plan.lanes, [], 'nothing was folded, so nothing is reported as folded')
  assert.deepEqual(plan.serialized, [], 'width is not a collision')
})

test('two spellings of one path land in one lane', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, paths: ['./src/a.ts'] })
    ]
  })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2']]])
  assert.equal(
    plan.serialized[0].path,
    './src/a.ts',
    'reported in the spelling its author wrote, keyed on the canonical form'
  )
})

test('a task claiming two paths merges the two chains they belong to', () => {
  // A[x], B[y], C[x,y]: pairwise chaining would leave A and B in separate lanes
  // that both run beside C's writes. Component membership is the only primitive
  // that gets this right.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/b.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/a.ts', 'src/b.ts'] })
    ]
  })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '1.3']]])
})

test('no batch ever holds two lanes sharing a canonical path', () => {
  // Every fixture in one sweep: chains, bridges, spelling variants, disjoint
  // work and a component over the cap, at several widths.
  const tasks = [
    task({ id: '1.1', group: 1, paths: ['src/a.ts'] }),
    task({ id: '1.2', group: 1, paths: ['./src/a.ts'] }),
    task({ id: '1.3', group: 1, paths: ['src/b.ts'] }),
    task({ id: '1.4', group: 1, paths: ['src/b.ts', 'src/c.ts'] }),
    task({ id: '1.5', group: 1, paths: ['src/d.ts'] }),
    task({ id: '1.6', group: 1, paths: ['src/e.ts'] }),
    task({ id: '1.7', group: 1, paths: ['src/e.ts'] }),
    task({ id: '1.8', group: 1, paths: ['src/e.ts'] }),
    task({ id: '1.9', group: 1, paths: ['src/e.ts'] }),
    task({ id: '1.10', group: 1, paths: ['src/e.ts'] })
  ]
  for (const maxParallel of [1, 2, 3, 8]) {
    for (const maxTasksPerAgent of [1, 2, 4]) {
      const plan = planWaves({ tasks }, { maxParallel, maxTasksPerAgent })
      for (const wave of plan.waves) {
        for (const batch of wave.batches) {
          const claimed = new Set()
          for (const lane of batch) {
            for (const t of lane) {
              for (const p of t.paths || []) {
                const key = p.replace(/^\.\//, '')
                assert.ok(
                  !claimed.has(key),
                  `two lanes in one batch both claim ${key} at maxParallel ${maxParallel}, ` +
                    `cap ${maxTasksPerAgent}`
                )
              }
            }
          }
          for (const lane of batch) {
            for (const t of lane) for (const p of t.paths || []) claimed.add(p.replace(/^\.\//, ''))
          }
        }
      }
    }
  }
})

test('a component over the cap splits into sequential lanes holding every task once', () => {
  const tasks = Array.from({ length: 9 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, paths: ['src/auth.ts'] })
  )
  const plan = planWaves({ tasks }, { maxTasksPerAgent: 4 })
  const lanes = plan.waves[0].batches.map(b => b.map(l => l.map(t => t.id)))
  assert.deepEqual(lanes, [
    [['1.1', '1.2', '1.3', '1.4']],
    [['1.5', '1.6', '1.7', '1.8']],
    [['1.9']]
  ])
  const ids = plan.waves[0].batches.flat(2).map(t => t.id)
  assert.equal(ids.length, 9, 'no task is dropped by the split')
  assert.equal(new Set(ids).size, 9, 'and none is duplicated')
})

test('a cap of 1 reproduces the pre-lane agent count', () => {
  const tasks = Array.from({ length: 3 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, paths: ['src/auth.ts'] })
  )
  const plan = planWaves({ tasks }, { maxTasksPerAgent: 1 })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1']], [['1.2']], [['1.3']]])
  assert.equal(plan.laneCount, 3)
  assert.equal(
    projectedWaveLoopAgents(plan).implementers,
    3,
    'the rollback lever: one agent per task, exactly as before lanes existed'
  )
  assert.deepEqual(plan.lanes, [], 'a lane of one is not a fold and is not reported as one')
})

test('the lane cap defaults to the published tier table, and the plan says which it used', () => {
  // Tier 4 — the tier whose cap is smallest, so a component one longer than it
  // splits. The point is not the number 4: it is that lane construction obeys
  // the entry for the LANE'S tier rather than one scalar for every lane.
  const cap = LANE_CAPS.byTier[4]
  const tasks = Array.from({ length: cap + 1 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 4, paths: ['src/auth.ts'] })
  )
  const plan = planWaves({ tasks })
  assert.deepEqual(plan.laneCaps, LANE_CAPS.byTier, 'no override, so the published table stands')
  assert.deepEqual(
    plan.waves[0].batches.map(b => b[0].length),
    [cap, 1],
    'the published cap for the lane tier is the one lane construction actually obeys'
  )
})

test('each tier is capped by its own entry, not by one scalar', () => {
  // The same component length at two tiers, split differently, is the whole
  // reason the scalar became a table.
  for (const tier of [1, 2, 3, 4, 5]) {
    const cap = LANE_CAPS.byTier[tier]
    const tasks = Array.from({ length: cap + 1 }, (_, i) =>
      task({ id: `1.${i + 1}`, group: 1, tier, model: tier === 5 ? 'opus' : 'sonnet', paths: ['src/auth.ts'] })
    )
    const plan = planWaves({ tasks })
    assert.deepEqual(
      plan.waves[0].batches.map(b => b[0].length),
      [cap, 1],
      `a tier-${tier} component of ${cap + 1} must split at ${cap}`
    )
  }
})

test('a mixed-tier component is capped by its hardest task, not its first', () => {
  // A lane is dispatched at its hardest tier, so it must be bounded at that
  // tier too: bounding a lane holding a tier-4 task by the tier-1 cap of 8 would
  // hand eight judgement-heavy tasks to one agent.
  const tasks = [
    task({ id: '1.1', group: 1, tier: 1, model: 'haiku', paths: ['src/auth.ts'] }),
    ...Array.from({ length: LANE_CAPS.byTier[4] }, (_, i) =>
      task({ id: `1.${i + 2}`, group: 1, tier: 4, paths: ['src/auth.ts'] })
    )
  ]
  const plan = planWaves({ tasks })
  assert.deepEqual(
    plan.waves[0].batches.map(b => b[0].length),
    [LANE_CAPS.byTier[4], 1],
    'the tier-4 cap bounds the lane even though its first task is tier 1'
  )
})

test('a uniform override is a ceiling over every tier, never a raise', () => {
  const plan = planWaves({ tasks: [task({ tier: 1 })] }, { maxTasksPerAgent: 2 })
  assert.deepEqual(plan.laneCaps, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 })
  const raised = planWaves({ tasks: [task({ tier: 1 })] }, { maxTasksPerAgent: 99 })
  assert.deepEqual(
    raised.laneCaps,
    LANE_CAPS.byTier,
    'an override above the published table does not raise a single tier'
  )
})

test('intra-lane order is task-id order even when the tiers disagree', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 2, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, tier: 4, paths: ['src/auth.ts'] })
    ]
  })
  assert.deepEqual(
    laneIds(plan.waves[0]),
    [[['1.1', '1.2']]],
    'hardest-first places lanes; it must never reorder inside one'
  )
})

// --- cohesion lanes (spec: lanes) ------------------------------------------
//
// The requirement this replaces made every path-disjoint task its own agent
// however small it was. These assert the replacement's boundaries: what packs,
// what does not, and what the plan says about it either way.

test('seven small disjoint tasks become one cohesion lane', () => {
  // lanes/spec.md, the happy path: seven tier-2/3 tasks each claiming a
  // different evals/*/case.yaml. This is the plan shape that motivated the
  // change — seven spawns, plus a hand-written eighth task whose only job was to
  // tell the seven what convention to agree on.
  // All tier 2, because the scenario's precondition is that the lane's cap is at
  // least seven: a tier-3 task in the set would open the lane at the tier-3 cap
  // of 6 and split the seventh off, which is the cap doing its job, not a
  // failure of cohesion.
  const tasks = Array.from({ length: 7 }, (_, i) =>
    task({ id: `2.${i + 1}`, group: 2, tier: 2, paths: [`evals/c${i}/case.yaml`] })
  )
  const plan = planWaves({ tasks })
  assert.deepEqual(laneIds(plan.waves[0]), [
    [['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7']]
  ])
  assert.equal(projectedWaveLoopAgents(plan).implementers, 1, 'seven tasks, one spawn')
  assert.equal(plan.lanes.length, 1)
  assert.equal(plan.lanes[0].kind, 'cohesion')
  assert.deepEqual(plan.lanes[0].ids, ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'])
  assert.deepEqual(plan.serialized, [], 'nothing collided — they were packed by tier')
  assert.match(
    plan.warnings.join('\n'),
    /path-disjoint tier-2 work in wave 2; packed into one cohesion lane/,
    'the fold names its ids, its tier and the cap that bounded it'
  )
  assert.match(formatPlan(plan), /cohesion 2\.1 → 2\.2 → .*: 7 path-disjoint tasks in wave 2/)
})

test('judgement-heavy tasks are not packed', () => {
  // lanes/spec.md, the failure case. Tier 4 is excluded on purpose: cross-file
  // pattern-following is where a fresh context per task still pays.
  const tasks = Array.from({ length: 3 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 4, paths: [`src/${i}.ts`] })
  )
  const plan = planWaves({ tasks })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1'], ['1.2'], ['1.3']]])
  assert.deepEqual(plan.lanes, [], 'no fold to report')
  assert.equal(projectedWaveLoopAgents(plan).implementers, 3, 'exactly as before cohesion existed')
})

test('a tier-5 component is never packed with anything, however small', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 5, model: 'opus', paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, tier: 1, model: 'haiku', paths: ['src/b.ts'] }),
      task({ id: '1.3', group: 1, tier: 1, model: 'haiku', paths: ['src/c.ts'] })
    ]
  })
  const lanes = plan.waves[0].batches.flat(1).map(l => l.map(t => t.id))
  assert.deepEqual(lanes, [['1.1'], ['1.2', '1.3']], 'the tier-5 task keeps its own agent')
})

test('the cap closes a cohesion lane and the remainder opens another', () => {
  // lanes/spec.md, the edge case: ten path-disjoint tier-1 tasks at a tier-1 cap
  // of eight become 8 + 2, both in one batch because they are path-disjoint.
  const cap = LANE_CAPS.byTier[1]
  const tasks = Array.from({ length: cap + 2 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 1, model: 'haiku', paths: [`src/${i}.ts`] })
  )
  const plan = planWaves({ tasks }, { maxParallel: 8 })
  assert.equal(plan.waves[0].batches.length, 1, 'path-disjoint lanes share one batch')
  assert.deepEqual(plan.waves[0].batches[0].map(l => l.length), [cap, 2])
  const ids = plan.waves[0].batches.flat(2).map(t => t.id)
  assert.equal(new Set(ids).size, cap + 2, 'every task appears exactly once')
  assert.deepEqual(
    plan.waves[0].batches[0][0].map(t => t.id),
    ids.slice(0, cap),
    'the first lane holds the first tasks in id order'
  )
})

test('a cohesion lane is capped by its hardest component, fixed when it opened', () => {
  // Hardest-first packing means the first component fixes the lane's tier and
  // therefore its cap, so a cap can never shrink under a lane that already
  // filled it. Tier 3 opens the lane at cap 6; the tier-2 tasks join under 6,
  // not under their own 8.
  const cap = LANE_CAPS.byTier[3]
  const tasks = [
    task({ id: '1.1', group: 1, tier: 3, paths: ['src/hard.ts'] }),
    ...Array.from({ length: cap + 1 }, (_, i) =>
      task({ id: `1.${i + 2}`, group: 1, tier: 2, paths: [`src/${i}.ts`] })
    )
  ]
  const plan = planWaves({ tasks }, { maxParallel: 8 })
  const lanes = plan.waves[0].batches.flat(1)
  assert.deepEqual(lanes.map(l => l.length), [cap, 2], `the tier-3 cap of ${cap} bounds the lane`)
  assert.equal(plan.lanes[0].tier, 3)
  assert.equal(plan.lanes[0].cap, cap)
})

test('two sections never share a cohesion lane', () => {
  // lanes/spec.md, the edge case: a section is a barrier, and cohesion is packed
  // inside one layer of one section — never across.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 1, model: 'haiku', paths: ['src/a.ts'] }),
      task({ id: '2.1', group: 2, tier: 1, model: 'haiku', paths: ['src/b.ts'] })
    ]
  })
  assert.deepEqual(plan.lanes, [], 'no fold — the two are in different waves')
  const laneOf = id => plan.waves.flatMap(w => w.batches.flat(1)).find(l => l.some(t => t.id === id))
  assert.notEqual(laneOf('1.1'), laneOf('2.1'))
})

test('a dependent task never shares a lane or a batch with its dependency', () => {
  // lanes/spec.md: 1.1 and 1.2 may pack; 1.3 depends on 1.1 and stays out of
  // both its lane and its batch. Cohesion is per LAYER, so an edge still orders.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 2, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, tier: 2, paths: ['src/b.ts'] }),
      task({ id: '1.3', group: 1, tier: 2, paths: ['src/c.ts'], dependsOn: ['1.1'] })
    ]
  })
  const placements = plan.waves.flatMap((w, wi) =>
    w.batches.flatMap((b, bi) => b.flatMap((lane, li) => lane.map(t => [t.id, `${wi}/${bi}/${li}`])))
  )
  const at = id => placements.find(p => p[0] === id)[1]
  assert.equal(at('1.1'), at('1.2'), '1.1 and 1.2 may share a cohesion lane')
  assert.notEqual(at('1.3'), at('1.1'), '1.3 is never in its dependency’s lane')
  assert.notEqual(
    at('1.3').split('/').slice(0, 2).join('/'),
    at('1.1').split('/').slice(0, 2).join('/'),
    'nor in its batch'
  )
})

test('a uniform override of 1 reproduces one agent per task, cohesion included', () => {
  // lanes/spec.md, the rollback lever: three cohesion-eligible disjoint tasks
  // and one 3-task collision component, all at a uniform cap of 1.
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 1, model: 'haiku', paths: ['src/a.ts'] }),
        task({ id: '1.2', group: 1, tier: 1, model: 'haiku', paths: ['src/b.ts'] }),
        task({ id: '1.3', group: 1, tier: 1, model: 'haiku', paths: ['src/c.ts'] }),
        task({ id: '1.4', group: 1, tier: 2, paths: ['src/one.ts'] }),
        task({ id: '1.5', group: 1, tier: 2, paths: ['src/one.ts'] }),
        task({ id: '1.6', group: 1, tier: 2, paths: ['src/one.ts'] })
      ]
    },
    { maxTasksPerAgent: 1 }
  )
  const lanes = plan.waves.flatMap(w => w.batches.flat(1))
  assert.ok(lanes.every(l => l.length === 1), 'every lane holds exactly one task')
  assert.equal(plan.laneCount, 6)
  assert.equal(projectedWaveLoopAgents(plan).implementers, 6)
  assert.deepEqual(plan.lanes, [], 'a lane of one is not a fold and is not reported as one')
})

test('a collision lane packed with a disjoint sibling is reported as cohesion', () => {
  // lanes/spec.md, the failure case: the lane's kind is cohesion, and the
  // collision inside it is still reported in the serialized-path report.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 2, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, tier: 2, paths: ['src/a.ts'] }),
      task({ id: '1.3', group: 1, tier: 2, paths: ['src/b.ts'] })
    ]
  })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '1.3']]])
  assert.equal(plan.lanes[0].kind, 'cohesion')
  assert.deepEqual(plan.serialized, [
    { id: '1.2', group: 1, path: 'src/a.ts', conflictsWith: '1.1' }
  ])
})

test('a split collision component is never relabelled as cohesion', () => {
  // The two halves of a split star component are path-disjoint from each other,
  // so a lane that re-derived its kind from its own connectivity would call this
  // split a cohesion fold. It is a collision split, and it says so.
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 2, paths: ['x.ts', 'y.ts', 'z.ts'] }),
        task({ id: '1.2', group: 1, tier: 2, paths: ['x.ts'] }),
        task({ id: '1.3', group: 1, tier: 2, paths: ['y.ts'] }),
        task({ id: '1.4', group: 1, tier: 2, paths: ['z.ts'] })
      ]
    },
    { maxTasksPerAgent: 2 }
  )
  assert.deepEqual(plan.lanes.map(l => l.kind), ['collision', 'collision'])
})

test('a lane of one is never reported as a fold of size one', () => {
  const plan = planWaves({
    tasks: [task({ id: '1.1', group: 1, tier: 4, paths: ['src/a.ts'] })]
  })
  assert.deepEqual(plan.lanes, [])
  assert.doesNotMatch(formatPlan(plan), /cohesion |^ {2}lane /m)
})

// --- solo mode (spec: solo-mode) -------------------------------------------

const soloTasks = () => [
  task({ id: '1.1', group: 1, tier: 2, paths: ['src/a.ts'] }),
  task({ id: '1.2', group: 1, tier: 3, paths: ['src/b.ts'] }),
  task({ id: '2.1', group: 2, tier: 1, model: 'haiku', paths: ['src/c.ts'] }),
  task({ id: 't.1', group: 2, tier: 2, isTestTask: true, paths: ['test/a.test.mjs'] })
]

test('a solo plan is one wave, one batch, one lane, tests last', () => {
  const plan = planWaves({ tasks: soloTasks() }, { mode: 'solo' })
  assert.equal(plan.waveCount, 1)
  assert.equal(plan.waves[0].batches.length, 1)
  assert.equal(plan.waves[0].batches[0].length, 1)
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '2.1', 't.1']]])
  assert.equal(plan.testWave, null, 'a solo plan has no trailing test wave')
  assert.equal(plan.laneCount, 1)
  assert.equal(plan.lanes[0].kind, 'solo')
  assert.equal(projectedWaveLoopAgents(plan).verifyPings, 0, 'no wave boundary, no verify')
})

test('a solo lane orders by section, then layer, then id', () => {
  // solo-mode/spec.md: layer order beats id order, so an edge from 1.2 to 1.5
  // puts 1.5 first even though its id sorts later.
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.2', group: 1, tier: 2, dependsOn: ['1.5'] }),
        task({ id: '1.5', group: 1, tier: 2 }),
        task({ id: '2.1', group: 2, tier: 2 })
      ]
    },
    { mode: 'solo' }
  )
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.5', '1.2', '2.1']]])
  assert.deepEqual(
    plan.deferred,
    [{ id: '1.2', group: 1, after: ['1.5'] }],
    'and the edge is reported exactly as it would be in waves mode'
  )
  assert.match(plan.warnings.join('\n'), /runs after them inside the solo lane/)
})

test('a solo diamond is honoured by position in the lane', () => {
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 2 }),
        task({ id: '1.2', group: 1, tier: 2, dependsOn: ['1.1'] }),
        task({ id: '1.3', group: 1, tier: 2, dependsOn: ['1.1'] }),
        task({ id: '1.4', group: 1, tier: 2, dependsOn: ['1.2', '1.3'] })
      ]
    },
    { mode: 'solo' }
  )
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '1.3', '1.4']]])
})

test('a solo change holding only test tasks still becomes one lane', () => {
  const plan = planWaves(
    {
      tasks: [
        task({ id: 't.2', group: 1, tier: 2, isTestTask: true }),
        task({ id: 't.1', group: 1, tier: 2, isTestTask: true })
      ]
    },
    { mode: 'solo' }
  )
  assert.deepEqual(laneIds(plan.waves[0]), [[['t.1', 't.2']]])
  assert.match(plan.warnings.join('\n'), /no implementation tasks/)
})

test('solo promotes every task to opus after the clamp and reports each promotion', () => {
  const plan = planWaves({ tasks: soloTasks() }, { mode: 'solo' })
  assert.ok(
    plan.waves[0].batches[0][0].every(t => t.model === 'opus'),
    'every task in the lane carries opus'
  )
  assert.deepEqual(plan.promoted, [
    { id: '1.1', from: 'sonnet', to: 'opus', tier: 2 },
    { id: '1.2', from: 'sonnet', to: 'opus', tier: 3 },
    { id: '2.1', from: 'haiku', to: 'opus', tier: 1 },
    { id: 't.1', from: 'sonnet', to: 'opus', tier: 2 }
  ])
  assert.equal(plan.lanes[0].model, 'opus')
  assert.equal(plan.lanes[0].tier, 3, 'the recorded tier is still the hardest task’s')
  assert.equal(plan.lanes[0].effort, null, 'so its effort is the published tier-3 effort')
  assert.match(formatPlan(plan), /promoted 2\.1: haiku → opus \(tier 1, solo lane\)/)
})

test('a task already on opus is not double-reported as promoted', () => {
  const plan = planWaves(
    {
      tasks: [
        task({ id: '1.1', group: 1, tier: 5, model: 'opus' }),
        task({ id: '1.2', group: 1, tier: 2 })
      ]
    },
    { mode: 'solo' }
  )
  assert.deepEqual(plan.promoted, [{ id: '1.2', from: 'sonnet', to: 'opus', tier: 2 }])
  assert.equal(plan.lanes[0].effort, 'xhigh', 'the lane runs at the published tier-5 effort')
})

test('the clamp is not bypassed in waves mode and emits no promotion report', () => {
  const plan = planWaves({
    tasks: [task({ id: '1.1', group: 1, tier: 3, model: 'opus' })]
  })
  assert.deepEqual(plan.clamped, [{ id: '1.1', from: 'opus', to: 'sonnet', tier: 3 }])
  assert.deepEqual(plan.promoted, [])
})

test('mode precedence: a flag wins over the classifier', () => {
  const input = { tasks: soloTasks(), recommendedMode: 'solo', modeReason: 'one coherent edit' }
  const forced = planWaves(input, { mode: 'waves' })
  assert.equal(forced.mode, 'waves')
  assert.equal(forced.modeSource, 'flag')
  const solo = planWaves({ tasks: soloTasks() }, { mode: 'solo' })
  assert.equal(solo.modeSource, 'flag')
  assert.equal(solo.modeReason, null, 'a flag carries no reason — it is the reason')
})

test('a classifier recommendation inside the envelope is honoured and carried verbatim', () => {
  const plan = planWaves({
    tasks: soloTasks(),
    recommendedMode: 'solo',
    modeReason: 'four small edits to one subsystem'
  })
  assert.equal(plan.mode, 'solo')
  assert.equal(plan.modeSource, 'classifier')
  assert.equal(plan.modeReason, 'four small edits to one subsystem')
  assert.match(formatPlan(plan), /^mode: solo \(classifier: four small edits to one subsystem\)/)
})

test('a recommendation above the envelope is refused and named', () => {
  const tasks = Array.from({ length: SOLO.maxTasks + 1 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 2 })
  )
  const plan = planWaves({ tasks, recommendedMode: 'solo', modeReason: 'feels small' })
  assert.equal(plan.mode, 'waves')
  assert.equal(plan.modeSource, 'default')
  assert.match(
    plan.warnings.join('\n'),
    new RegExp(
      `classifier recommended solo for ${SOLO.maxTasks + 1} tasks; the envelope is ` +
        `${SOLO.maxTasks}, planned as waves`
    )
  )
})

test('a flag may force solo above the envelope, and says that it did', () => {
  const tasks = Array.from({ length: SOLO.maxTasks + 1 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 2 })
  )
  const plan = planWaves({ tasks }, { mode: 'solo' })
  assert.equal(plan.mode, 'solo')
  assert.equal(plan.modeSource, 'flag')
  assert.equal(plan.laneCount, 1)
  assert.match(
    plan.warnings.join('\n'),
    new RegExp(`solo forced by flag: ${SOLO.maxTasks + 1} tasks exceeds the published envelope`)
  )
})

test('a classification with no recommendation plans as waves with no mode warning', () => {
  // A classified.json written before the field existed must plan exactly as it
  // did before, and say nothing about a decision nobody made.
  const plan = planWaves({ tasks: soloTasks() })
  assert.equal(plan.mode, 'waves')
  assert.equal(plan.modeSource, 'default')
  assert.equal(plan.modeReason, null)
  assert.doesNotMatch(plan.warnings.join('\n'), /solo|envelope/)
  assert.match(formatPlan(plan), /^mode: waves \(default\)/)
})

test('an unrecognized recommendation is waves, not an error', () => {
  const plan = planWaves({ tasks: soloTasks(), recommendedMode: 'turbo' })
  assert.equal(plan.mode, 'waves')
  assert.equal(plan.modeSource, 'default')
  assert.doesNotMatch(plan.warnings.join('\n'), /turbo/)
})

test('contradictory or unknown mode overrides are rejected before planning', () => {
  assert.throws(
    () => planWaves({ tasks: soloTasks() }, { mode: ['solo', 'waves'] }),
    /contradictory mode overrides \(solo and waves\)/
  )
  assert.throws(
    () => planWaves({ tasks: soloTasks() }, { mode: 'turbo' }),
    /unknown mode override "turbo"/
  )
})

test('a solo modeReason is bounded by the handoff budget', () => {
  const plan = planWaves({
    tasks: soloTasks(),
    recommendedMode: 'solo',
    modeReason: 'x'.repeat(LIMITS.maxHandoffChars * 2)
  })
  assert.equal(plan.modeReason.length, LIMITS.maxHandoffChars)
})

// --- effort routing (spec: effort-routing) ---------------------------------

test('laneEffort maps a mechanical lane to low effort', () => {
  assert.equal(laneEffort([task({ tier: 1 }), task({ id: '1.2', tier: 2 })]), 'low')
})

test('laneEffort takes the hardest task effort, not the first task', () => {
  // The lane's first task is tier 1; its last is tier 5. Effort follows the
  // hardest task, so a tier-1-first lane still runs at xhigh — never low.
  const lane = [task({ id: '1.1', tier: 1 }), task({ id: '1.2', tier: 5 })]
  assert.equal(laneEffort(lane), 'xhigh')
  assert.notEqual(laneEffort(lane), 'low')
})

test('laneEffort inherits (null) for a tier 3–4 lane by policy', () => {
  assert.equal(laneEffort([task({ tier: 3 })]), null)
  assert.equal(laneEffort([task({ tier: 4 })]), null)
})

test('laneEffort inherits (null) for an untiered lane by fallback', () => {
  assert.equal(laneEffort([task({ tier: undefined }), task({ id: '1.2', tier: null })]), null)
})

test('the plan reports one effort entry per listed lane, forced vs inherited-by-policy', () => {
  // A folded tier-5 lane routes xhigh; a folded tier-3 lane inherits the session
  // default by policy — reported as inherited, never silently upgraded. (The
  // tier-unreadable fallback branch cannot arise through planWaves: validate()
  // rejects a non-integer tier before planning, so it is exercised on laneEffort
  // directly above.)
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', tier: 5, model: 'opus', paths: ['src/a.ts'] }),
      task({ id: '1.2', tier: 1, model: 'haiku', paths: ['src/a.ts'] }),
      task({ id: '2.1', group: 2, tier: 3, model: 'sonnet', paths: ['src/b.ts'] }),
      task({ id: '2.2', group: 2, tier: 3, model: 'sonnet', paths: ['src/b.ts'] })
    ]
  })
  const byIds = Object.fromEntries(plan.effort.map(e => [e.ids.join('+'), e]))
  assert.deepEqual(byIds['1.1+1.2'], { ids: ['1.1', '1.2'], tier: 5, effort: 'xhigh', inherited: null })
  assert.deepEqual(byIds['2.1+2.2'], { ids: ['2.1', '2.2'], tier: 3, effort: null, inherited: 'policy' })
  assert.match(formatPlan(plan), /effort 1\.1 → 1\.2: xhigh \(tier 5\)/)
  assert.match(formatPlan(plan), /effort 2\.1 → 2\.2: inherited \(by policy\) \(tier 3\)/)
})

test('a task cannot escalate its own effort — the tier-derived value wins', () => {
  // A tier-1 task carrying a self-declared effort is still routed low: effort is
  // assigned from tier after classification, never read off the task.
  const lane = [task({ tier: 1, effort: 'xhigh' })]
  assert.equal(laneEffort(lane), 'low')
})

test('a mixed-tier lane takes the maximum tier and its model', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 1, model: 'haiku', paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, tier: 5, model: 'opus', paths: ['src/auth.ts'] })
    ]
  })
  assert.deepEqual(plan.lanes, [
    {
      group: 1,
      kind: 'collision',
      ids: ['1.1', '1.2'],
      tier: 5,
      cap: LANE_CAPS.byTier[5],
      model: 'opus',
      effort: 'xhigh'
    }
  ])
  assert.match(
    formatPlan(plan),
    /lane 1\.1 → 1\.2: 2 tasks in wave 1 on one opus\/T5 agent/,
    'the plan names the lane and the model it runs on'
  )
})

test('a mixed-tier lane is not split to keep the trivial task cheap', () => {
  // The accepted consequence, asserted rather than left implicit: splitting on
  // tier would reintroduce exactly the spawn lanes exist to remove.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 1, model: 'haiku', paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, tier: 4, paths: ['src/auth.ts'] })
    ]
  })
  assert.equal(projectedWaveLoopAgents(plan).implementers, 1)
})

test('the test wave lanes colliding test tasks rather than co-scheduling them', () => {
  // It used to hold one lane per task on the reasoning that deferral had already
  // bought the parallelism a lane would spend. That also meant two test tasks
  // writing one file ran side by side — the collision the packer exists to
  // prevent. The deferral is about WHEN tests run, not how many agents run them.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1 }),
      task({ id: 't.1', group: 9, tier: 4, isTestTask: true, paths: ['test/a.test.mjs'] }),
      task({ id: 't.2', group: 9, tier: 4, isTestTask: true, paths: ['test/a.test.mjs'] })
    ]
  })
  assert.deepEqual(laneIds(plan.testWave), [[['t.1', 't.2']]])
  assert.equal(plan.serialized.length, 1, 'and the collision is reported')
  assert.equal(plan.serialized[0].group, null, 'with no group number — it is the test wave')
  assert.match(plan.warnings.join('\n'), /serialized in the test wave/)
})

test('the test wave packs low-tier test tasks by cohesion', () => {
  // lanes/spec.md: sixteen tier-2 test tasks with no edges and a tier-2 cap of
  // eight become two lanes of eight, not sixteen spawns.
  const cap = LANE_CAPS.byTier[2]
  const tests = Array.from({ length: cap * 2 }, (_, i) =>
    task({ id: `t.${i + 1}`, group: 9, tier: 2, isTestTask: true, paths: [`test/${i}.test.mjs`] })
  )
  const plan = planWaves({ tasks: [task({ id: '1.1', group: 1 }), ...tests] }, { maxParallel: 8 })
  const lanes = plan.testWave.batches.flat(1)
  assert.equal(lanes.length, 2, `${cap * 2} test tasks become two lanes of ${cap}`)
  assert.deepEqual(lanes.map(l => l.length), [cap, cap])
  assert.deepEqual(
    plan.lanes.filter(l => l.group === null).map(l => l.kind),
    ['cohesion', 'cohesion'],
    'and both are reported as cohesion folds of the test wave'
  )
})

test('cohesion does not pack test tasks with implementation tasks', () => {
  // The implementation/test boundary is the whole reason the test wave exists.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, tier: 2, paths: ['src/a.ts'] }),
      task({ id: '1.2', group: 1, tier: 2, paths: ['src/b.ts'] }),
      task({ id: 't.1', group: 1, tier: 2, isTestTask: true, paths: ['test/a.test.mjs'] })
    ]
  })
  const implIds = plan.waves.flatMap(w => laneIds(w).flat(2))
  assert.deepEqual(implIds, ['1.1', '1.2'], 'no test task joined an implementation lane')
  assert.deepEqual(laneIds(plan.testWave), [[['t.1']]])
})

// ===========================================================================
// Execution state machine
// ===========================================================================

const planOf = (tasks, opts) => planWaves({ tasks }, opts)

/**
 * A plan with TWO disjoint-path impl tasks per listed group, plus optional
 * test tasks.
 *
 * Two, not one, and that is load-bearing rather than incidental: a group
 * holding a single implementation task is folded onto the previous wave, so a
 * fixture built one-task-per-group would collapse to a single wave and every
 * state-machine test that needs N checkpoints would stop testing what it says
 * it tests. Disjoint paths keep the pair in one batch.
 */
function simpleTasks(groups = [1, 2], testTasks = 0) {
  const tasks = groups.flatMap(g => [
    task({ id: `${g}.1`, group: g, paths: [`src/g${g}-a.ts`] }),
    task({ id: `${g}.2`, group: g, paths: [`src/g${g}-b.ts`] })
  ])
  for (let i = 0; i < testTasks; i++) {
    tasks.push(task({ id: `t.${i + 1}`, group: 99, isTestTask: true }))
  }
  return tasks
}

function simplePlan(groups = [1, 2], testTasks = 0, opts) {
  return planOf(simpleTasks(groups, testTasks), opts)
}

/**
 * A valid handoff for one task. Claiming ok:true without one fails the task,
 * so every successful result in these tests carries a packet.
 */
const handoffFor = (id, over = {}) => ({
  schema: HANDOFF_SCHEMA,
  taskId: id,
  status: 'ok',
  summary: `did ${id}`,
  evidence: [`src/${id}.ts:1-10`],
  next: `wave n+1 can build on ${id}`,
  blocker: null,
  ...over
})

const okTask = id => ({ id, ok: true, handoff: handoffFor(id) })

// Across the batch's LANES: the state machine is handed one result per task,
// however many agents produced them.
const allOk = step => ({ tasks: stepTasks(step).map(t => okTask(t.id)) })

/**
 * Walk the machine to completion, collecting every step it asked for.
 * `onBatch` / `onVerify` supply the results the caller would have gathered.
 */
function drive(start, { onBatch = allOk, onVerify = () => ({ ok: true }), limit = 50 } = {}) {
  const trace = []
  let state = start
  for (let i = 0; i < limit; i++) {
    const step = nextStep(state)
    trace.push(step)
    if (step.action === 'done' || step.action === 'halt') {
      return { state, trace, actions: trace.map(s => s.action) }
    }
    if (step.action === 'run-batch' || step.action === 'test-wave') {
      state = recordBatchResult(state, onBatch(step))
    } else if (step.action === 'verify') {
      state = recordVerifyResult(state, onVerify(step))
    } else {
      throw new Error(`drive cannot answer a ${step.action} step`)
    }
  }
  throw new Error('drive did not terminate')
}

// --- the happy path -------------------------------------------------------

test('a clean run walks wave → verify → wave → verify → test wave → done', () => {
  const { actions, state } = drive(createRunState(simplePlan([1, 2], 1)))
  assert.deepEqual(actions, ['run-batch', 'verify', 'run-batch', 'verify', 'test-wave', 'done'])
  assert.equal(state.failures.length, 0)
  assert.equal(state.halt, null)
})

test('verification runs between waves only — never after the final one', () => {
  const { actions } = drive(createRunState(simplePlan([1], 0)))
  assert.deepEqual(actions, ['run-batch', 'done'], 'a lone wave has no next wave to guard')
})

test('a wide wave is walked one batch at a time, in order', () => {
  // Tier 4 keeps the five tasks in five lanes; at a cohesion-eligible tier they
  // would pack into one lane in one batch and there would be no walk left.
  const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `1.${i + 1}`, group: 1, tier: 4 }))
  const seen = []
  drive(createRunState(planOf(tasks, { maxParallel: 2 })), {
    onBatch: step => {
      seen.push(stepTasks(step).map(t => t.id))
      return allOk(step)
    }
  })
  assert.deepEqual(seen, [['1.1', '1.2'], ['1.3', '1.4'], ['1.5']])
})

test('the trailing test wave runs after every impl wave, never before', () => {
  const { actions } = drive(createRunState(simplePlan([1, 2, 3], 2)))
  const testAt = actions.indexOf('test-wave')
  const lastImplAt = actions.lastIndexOf('run-batch')
  assert.ok(testAt > -1, 'the test wave must be reached')
  assert.ok(testAt > lastImplAt, 'no impl batch may run after the test wave')
})

test('done carries a summary of what the run actually did', () => {
  const { trace } = drive(createRunState(simplePlan([1, 2], 1)))
  const done = trace.at(-1)
  assert.equal(done.action, 'done')
  assert.equal(done.summary.tasksCompleted, 5, 'two impl tasks per group, plus the test task')
  assert.equal(done.summary.taskFailures, 0)
})

// --- inter-wave verification ---------------------------------------------

test('a failed check buys exactly LIMITS.interWaveFixAttempts fix attempts', () => {
  const attempts = []
  const { actions, state } = drive(createRunState(simplePlan([1, 2])), {
    onVerify: step => {
      attempts.push({ mode: step.mode, fixAttempt: step.fixAttempt })
      return { ok: false, errors: ['tsc: Foo is not assignable to Bar'], blocksNextWave: false }
    }
  })
  assert.equal(
    attempts.length,
    1 + LIMITS.interWaveFixAttempts,
    'one initial check, then the fix budget'
  )
  assert.equal(attempts[0].mode, 'initial')
  assert.deepEqual(
    attempts.slice(1).map(a => a.fixAttempt),
    Array.from({ length: LIMITS.interWaveFixAttempts }, (_, i) => i + 1)
  )
  assert.equal(actions.at(-1), 'done', 'non-blocking errors continue the run')
  assert.equal(state.unresolved.length, 1)
  assert.equal(state.unresolved[0].attempts, LIMITS.interWaveFixAttempts)
  assert.equal(state.unresolved[0].blockedNextWave, false)
  assert.ok(state.warnings.some(w => w.includes('unresolved')), 'continuing must warn')
})

test('the same unresolved errors halt when the caller says they block the next wave', () => {
  const { trace, state } = drive(createRunState(simplePlan([1, 2])), {
    onVerify: () => ({ ok: false, errors: ['tsc: broken'], blocksNextWave: true })
  })
  const halt = trace.at(-1)
  assert.equal(halt.action, 'halt')
  assert.equal(halt.kind, HALT_INTER_WAVE_VERIFY)
  assert.match(halt.reason, /block/)
  assert.equal(state.unresolved[0].blockedNextWave, true)
  assert.ok(!state.warnings.some(w => w.includes('continuing')), 'a halt is not a warning')
})

test('a check that passes after a fix attempt clears the budget for the next wave', () => {
  let calls = 0
  const { actions, state } = drive(createRunState(simplePlan([1, 2, 3])), {
    onVerify: () => {
      calls += 1
      return calls === 1 ? { ok: false, errors: ['flaky'] } : { ok: true }
    }
  })
  assert.equal(calls, 3, 'wave 1 fails once then passes; wave 2 passes first time')
  assert.deepEqual(actions.at(-1), 'done')
  assert.equal(state.unresolved.length, 0)
})

test('a skipped check must state its reason, and surfaces as a banner', () => {
  const start = createRunState(simplePlan([1, 2]))
  const afterBatch = recordBatchResult(start, allOk(nextStep(start)))
  assert.throws(() => recordVerifyResult(afterBatch, { skipped: true }), /non-empty "reason"/)
  const skipped = recordVerifyResult(afterBatch, { skipped: true, reason: 'no commands detected' })
  assert.equal(skipped.skippedVerifications.length, 1)
  assert.match(formatRunState(skipped), /VERIFICATION SKIPPED: reason=no commands detected/)
  assert.equal(nextStep(skipped).action, 'run-batch', 'a skip advances the run')
})

test('nextStep includes remainingBatches from the current index', () => {
  // Tier 4, so the five tasks stay five lanes and there are batches to remain.
  const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `1.${i + 1}`, group: 1, tier: 4 }))
  const start = createRunState(planOf(tasks, { maxParallel: 2 }))
  const first = nextStep(start)
  assert.equal(first.remainingBatches.length, 3)
  assert.deepEqual(
    stepTasks(first).map(t => t.id),
    first.remainingBatches[0].flat().map(t => t.id)
  )
  const after = recordBatchResult(start, allOk(first))
  const second = nextStep(after)
  assert.equal(second.remainingBatches.length, 2)
})

// --- handoffs at the wave boundary ----------------------------------------

test('record-batch fails a task that claims success without a handoff', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const after = recordBatchResult(start, { tasks: [{ id: stepTasks(step)[0].id, ok: true }] })

  assert.deepEqual(after.completed, [], 'an unreported success is not a success')
  assert.equal(after.failures.length, 1)
  assert.match(after.failures[0].error, /^invalid handoff: /)
  assert.deepEqual(after.handoffs, {}, 'nothing to hand the next wave')
})

test('an invalid packet fails the task and counts toward the failure halt', () => {
  // Three tasks, all claiming success, all with unusable packets. That is over
  // LIMITS.taskFailureHalt, so the run stops — a wave whose reports are all
  // unreadable has not produced a coherent change.
  const tasks = Array.from({ length: LIMITS.taskFailureHalt + 1 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1 })
  )
  const start = createRunState(planOf(tasks))
  const step = nextStep(start)
  const after = recordBatchResult(start, {
    tasks: stepTasks(step).map(t => ({
      id: t.id,
      ok: true,
      handoff: handoffFor(t.id, { status: 'blocked', blocker: '' })
    }))
  })
  assert.equal(after.failures.length, LIMITS.taskFailureHalt + 1)
  assert.equal(after.halt.kind, HALT_TASK_FAILURES)
  for (const f of after.failures) assert.match(f.error, /non-empty blocker/)
})

test('an over-budget packet fails the task rather than being trimmed', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const id = stepTasks(step)[0].id
  const after = recordBatchResult(start, {
    tasks: [{ id, ok: true, handoff: handoffFor(id, { summary: 'x'.repeat(2500) }) }]
  })
  assert.equal(after.failures.length, 1)
  assert.match(after.failures[0].error, /invalid handoff: .*the cap is/)
  assert.deepEqual(after.handoffs, {})
})

test('a null agent result keeps its own reason and is not asked for a packet', () => {
  // ship.js reports a stopped or crashed agent as ok:false with no handoff.
  // Overwriting that with an invalid-handoff complaint would hide why it failed.
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const after = recordBatchResult(start, {
    tasks: [{ id: stepTasks(step)[0].id, ok: false, error: 'agent returned no result' }]
  })
  assert.equal(after.failures[0].error, 'agent returned no result')
})

test('a blocked task keeps its packet so the next wave is told why', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const id = stepTasks(step)[0].id
  const after = recordBatchResult(start, {
    tasks: [
      {
        id,
        ok: false,
        error: 'could not finish',
        handoff: handoffFor(id, { status: 'blocked', blocker: 'no migration runner' })
      }
    ]
  })
  assert.equal(after.failures[0].error, 'could not finish')
  assert.equal(after.handoffs[id].blocker, 'no migration runner')
})

// --- what a batch recorded, reported back ---------------------------------
//
// The adjudication was always right and always private: `record-batch` failed
// the task and told its caller only what to do next. Both ship hosts therefore
// ticked and tallied from the agent's claim, and a run could tick five boxes
// beside a halt naming those same five tasks as failures.

test('a recorded batch reports an outcome per task, with the reason it failed', () => {
  const before = createRunState(simplePlan([1, 2]))
  const step = nextStep(before)
  const [first, second] = stepTasks(step).map(t => t.id)
  const after = recordBatchResult(before, {
    tasks: [
      okTask(first),
      // Claims success, packet is unusable — the live defect's exact shape.
      { id: second, ok: true, handoff: handoffFor(second, { status: 'done' }) }
    ]
  })

  const outcomes = batchOutcomes(before, after)
  assert.deepEqual(
    outcomes.map(o => [o.id, o.outcome]),
    [[first, OUTCOME_OK], [second, OUTCOME_FAILED]],
    'one bad packet fails its own task, not the batch'
  )
  assert.equal(outcomes[0].reason, undefined, 'a succeeded task owes no reason')
  assert.match(outcomes[1].reason, /invalid handoff: .*status/)
  assert.ok(outcomes[1].reason.length <= 300, 'the reason is an adjudication string, not a transcript')
})

test('a batch reports only itself, never the run accumulated so far', () => {
  const start = createRunState(simplePlan([1, 2]))
  const afterOne = recordBatchResult(start, allOk(nextStep(start)))
  const afterVerify = recordVerifyResult(afterOne, { ok: true })
  const secondStep = nextStep(afterVerify)
  const afterTwo = recordBatchResult(afterVerify, allOk(secondStep))

  assert.deepEqual(
    batchOutcomes(afterVerify, afterTwo).map(o => o.id),
    stepTasks(secondStep).map(t => t.id),
    'wave 1 is already history — reporting it again would double-count every tick'
  )
})

test('a lane whose tail was never attempted reports it as such, not as failed', () => {
  // One lane of three: the tasks collide on a path, so they run in order in one
  // agent. It failed at 1.2 and never reached 1.3, so no result mentions it.
  const tasks = ['1.1', '1.2', '1.3'].map(id => task({ id, group: 1, paths: ['src/same.ts'] }))
  const before = createRunState(planOf(tasks))
  const after = recordBatchResult(before, {
    tasks: [okTask('1.1'), { id: '1.2', ok: false, error: 'no migration runner' }]
  })

  const outcomes = batchOutcomes(before, after)
  assert.deepEqual(
    outcomes.map(o => [o.id, o.outcome]),
    [['1.1', OUTCOME_OK], ['1.2', OUTCOME_FAILED], ['1.3', OUTCOME_NOT_ATTEMPTED]],
    'not-attempted is neither ticked nor counted against the failure budget'
  )
  assert.equal(after.failures.length, 1, 'and the state agrees: one failure, not two')
  assert.match(outcomes[2].reason, /no outcome/)
})

test('the batch outcomes are derived from two states, never stored on one', () => {
  // A field on the state would be read as current by a run resumed from it a
  // day later, so `record-batch` never writes one — and strips one it was
  // handed, which is what a caller that piped plain-path stdout into its state
  // file would carry.
  const before = createRunState(simplePlan([1, 2]))
  const step = nextStep(before)
  const after = recordBatchResult(before, allOk(step))
  assert.equal(after.recorded, undefined, 'the verdict is reported, not persisted')

  const stale = { ...before, recorded: [{ id: 'from-a-previous-batch', outcome: OUTCOME_OK }] }
  const afterStale = recordBatchResult(stale, allOk(step))
  assert.equal(afterStale.recorded, undefined, 'a stale batch\'s outcomes do not survive a resume')
})

test('nextStep hands the next wave the previous wave, and only the previous wave', () => {
  const start = createRunState(simplePlan([1, 2, 3]))

  const wave1 = recordBatchResult(start, allOk(nextStep(start)))
  const atWave2 = recordVerifyResult(wave1, { ok: true })
  const step2 = nextStep(atWave2)
  assert.equal(step2.wave, 2)
  assert.deepEqual(step2.previousHandoffs.map(h => h.taskId), ['1.1', '1.2'])
  assert.equal(step2.previousHandoffs[0].summary, 'did 1.1')

  const wave2 = recordBatchResult(atWave2, allOk(step2))
  const atWave3 = recordVerifyResult(wave2, { ok: true })
  const step3 = nextStep(atWave3)
  assert.equal(step3.wave, 3)
  assert.deepEqual(
    step3.previousHandoffs.map(h => h.taskId),
    ['2.1', '2.2'],
    'wave 3 gets wave 2 only — packets do not accumulate across the run'
  )
})

test('the first wave has no previous wave to be handed', () => {
  const start = createRunState(simplePlan([1, 2]))
  assert.deepEqual(nextStep(start).previousHandoffs, [])
})

test('every remaining batch of a wave shares the previous wave, not each other', () => {
  // Three disjoint tasks in wave 2 at maxParallel 1: three batches of one lane,
  // which ship.js runs from a single `next`. They must all see wave 1 and none of
  // them each other, or two batches of one wave would be running under different
  // contracts depending on where they happened to land.
  //
  // Width-deferred rather than same-file on purpose: same-file tasks are now ONE
  // lane in one batch, so a collision fixture would leave nothing to compare.
  // Tier 4 for the same reason in the other direction — cohesion would pack the
  // three disjoint tasks into one lane and collapse the three batches to one.
  const plan = planOf(
    [
      task({ id: '1.1', group: 1 }),
      task({ id: '2.1', group: 2, tier: 4, paths: ['src/a.ts'] }),
      task({ id: '2.2', group: 2, tier: 4, paths: ['src/b.ts'] }),
      task({ id: '2.3', group: 2, tier: 4, paths: ['src/c.ts'] })
    ],
    { maxParallel: 1 }
  )
  const start = createRunState(plan)
  const afterWave1 = recordBatchResult(start, allOk(nextStep(start)))
  const atWave2 = recordVerifyResult(afterWave1, { ok: true })

  const batch0 = nextStep(atWave2)
  assert.equal(batch0.remainingBatches.length, 3)
  assert.deepEqual(batch0.previousHandoffs.map(h => h.taskId), ['1.1'])

  const afterBatch0 = recordBatchResult(atWave2, allOk(batch0))
  const batch1 = nextStep(afterBatch0)
  assert.equal(batch1.batchIndex, 1)
  assert.deepEqual(
    batch1.previousHandoffs.map(h => h.taskId),
    ['1.1'],
    'batch 1 must not receive batch 0\'s handoff — that is a different contract'
  )
})

test('a wave whose tasks all failed hands the next wave nothing', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const after = recordBatchResult(start, {
    tasks: [{ id: stepTasks(step)[0].id, ok: false, error: 'gave up' }]
  })
  const atWave2 = recordVerifyResult(after, { ok: true })
  assert.deepEqual(nextStep(atWave2).previousHandoffs, [])
})

test('stored handoffs survive the freeze and the JSON round-trip', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(start, allOk(nextStep(start)))
  assert.ok(Object.isFrozen(after.handoffs['1.1']))
  assert.deepEqual(JSON.parse(JSON.stringify(after)).handoffs['1.1'], after.handoffs['1.1'])
})

test('a state written before handoffs existed still records and reads them', () => {
  // Migration: an in-flight .claude/ship/state.json has no "handoffs" key.
  const start = createRunState(simplePlan([1, 2]))
  const legacy = JSON.parse(JSON.stringify(start))
  delete legacy.handoffs
  const after = recordBatchResult(legacy, allOk(nextStep(legacy)))
  assert.equal(after.handoffs['1.1'].taskId, '1.1')
})

// --- retained paths and evidence audits -----------------------------------
//
// `filesChanged` is requested from every implementer and was thrown away, while
// being the only cross-check available against the packet's own evidence. It is
// retained here, and each packet gains an audit verdict.
//
// Everything in this section is about a RECORDED FACT. The section after it is
// about the property that matters more: none of it changes what the run does.

/** An ok result that also reports what it touched, and cites what it likes. */
const okTaskWith = (id, filesChanged, evidence) => ({
  id,
  ok: true,
  filesChanged,
  handoff: evidence ? handoffFor(id, { evidence }) : handoffFor(id)
})

/** The state minus the audit bookkeeping — what "the run did the same thing" means. */
function withoutAudits(state) {
  const copy = JSON.parse(JSON.stringify(state))
  delete copy.evidenceAudits
  return copy
}

test('reported paths survive the recording', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(start, {
    tasks: [okTaskWith('1.1', ['lib/export.mjs', 'test/export.test.mjs']), okTask('1.2')]
  })
  assert.deepEqual(after.reportedPaths['1.1'], ['lib/export.mjs', 'test/export.test.mjs'])
})

test('a task reporting no paths gets an empty set, not its own locators', () => {
  // Substituting the evidence for the missing report would manufacture the very
  // cross-check the report exists to provide — the packet would be confirming
  // itself.
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(start, { tasks: [okTask('1.1'), okTask('1.2')] })
  assert.deepEqual(after.reportedPaths['1.1'], [])
  assert.equal(after.handoffs['1.1'].evidence[0], 'src/1.1.ts:1-10')
  assert.equal(
    after.evidenceAudits['1.1'].verdict,
    AUDIT_NOT_AUDITED,
    'no observed set and no reported set means the audit could not run'
  )
  assert.equal(after.evidenceAudits['1.1'].reportedMatch, null)
})

test('a task nobody attempted has no reported-path entry, and that is not an error', () => {
  // A lane that stopped early reports nothing for the tasks behind the failure.
  // Absence is the honest record; an empty set would be a claim it never made.
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(start, {
    tasks: [{ id: '1.1', ok: false, error: 'blocked on a missing migration runner' }]
  })
  assert.equal(Object.prototype.hasOwnProperty.call(after.reportedPaths, '1.2'), false)
  assert.equal(after.halt, null)
  assert.deepEqual(after.reportedPaths['1.1'], [], 'the task that ran did report — emptily')
})

test('the observed path set is used when supplied, and the verdict says so', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(
    start,
    { tasks: [okTaskWith('1.1', ['src/1.1.ts']), okTask('1.2')] },
    { changedPaths: ['src/1.1.ts', 'src/1.2.ts'] }
  )
  assert.equal(after.evidenceAudits['1.1'].verdict, AUDIT_CONFIRMED)
  assert.equal(after.evidenceAudits['1.1'].source, 'observed')
  assert.equal(after.evidenceAudits['1.1'].reportedMatch, true)
})

test('with no observed set the audit falls back to the report and labels it', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(start, {
    tasks: [okTaskWith('1.1', ['src/1.1.ts']), okTask('1.2')]
  })
  assert.equal(after.evidenceAudits['1.1'].verdict, AUDIT_CONFIRMED)
  assert.equal(
    after.evidenceAudits['1.1'].source,
    'reported',
    'a self-reported path set must never be presented as an observed one'
  )
})

test('nextStep hands the next wave each packet with its verdict attached', () => {
  const start = createRunState(simplePlan([1, 2]))
  const wave1 = recordBatchResult(
    start,
    { tasks: [okTaskWith('1.1', ['src/1.1.ts']), okTaskWith('1.2', ['src/elsewhere.ts'])] },
    { changedPaths: ['src/1.1.ts', 'src/elsewhere.ts'] }
  )
  const step2 = nextStep(recordVerifyResult(wave1, { ok: true }))
  const byId = new Map(step2.previousHandoffs.map(h => [h.taskId, h]))
  assert.equal(byId.get('1.1').audit.verdict, AUDIT_CONFIRMED)
  assert.equal(byId.get('1.2').audit.verdict, AUDIT_UNCONFIRMED)
  // The packet itself is unchanged — the verdict travels beside it.
  assert.equal(byId.get('1.2').summary, 'did 1.2')
  assert.deepEqual(byId.get('1.2').evidence, ['src/1.2.ts:1-10'])
})

test('a state written before these fields existed records normally', () => {
  const start = createRunState(simplePlan([1, 2]))
  const legacy = JSON.parse(JSON.stringify(start))
  delete legacy.reportedPaths
  delete legacy.evidenceAudits
  const after = recordBatchResult(
    legacy,
    { tasks: [okTaskWith('1.1', ['src/1.1.ts']), okTask('1.2')] },
    { changedPaths: ['src/1.1.ts'] }
  )
  assert.deepEqual(after.reportedPaths['1.1'], ['src/1.1.ts'])
  assert.equal(after.evidenceAudits['1.1'].verdict, AUDIT_CONFIRMED)
  assert.equal(after.halt, null)
})

test('stored verdicts survive the freeze and the JSON round-trip', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(
    start,
    { tasks: [okTaskWith('1.1', ['src/1.1.ts']), okTask('1.2')] },
    { changedPaths: ['src/1.1.ts'] }
  )
  assert.ok(Object.isFrozen(after.evidenceAudits['1.1']))
  assert.deepEqual(
    JSON.parse(JSON.stringify(after)).evidenceAudits['1.1'],
    after.evidenceAudits['1.1']
  )
})

// --- the audit changes no control flow ------------------------------------
//
// The verdict is recorded and never gated on. That is a spec requirement rather
// than a convention precisely because the first reader of a corpus full of
// `unconfirmed` verdicts will reasonably reach for a threshold — and membership
// here is run-scoped, not task-scoped, so a halt built on it would stop good
// runs. These tests are the lever that stops that from being added quietly.

test('an unconfirmed packet leaves the recorded run byte-identical', () => {
  const start = createRunState(
    planOf([
      task({ id: '1.1', group: 1, paths: ['src/g1-a.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/g1-b.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/g1-c.ts'] }),
      task({ id: '2.1', group: 2, paths: ['src/g2-a.ts'] }),
      task({ id: '2.2', group: 2, paths: ['src/g2-b.ts'] })
    ])
  )
  const result = {
    tasks: ['1.1', '1.2', '1.3'].map(id => okTaskWith(id, [`src/${id}.ts`]))
  }
  const allSeen = ['src/1.1.ts', 'src/1.2.ts', 'src/1.3.ts']

  const confirmed = recordBatchResult(start, result, { changedPaths: allSeen })
  const oneMissing = recordBatchResult(start, result, { changedPaths: allSeen.slice(0, 2) })

  assert.equal(confirmed.evidenceAudits['1.3'].verdict, AUDIT_CONFIRMED)
  assert.equal(oneMissing.evidenceAudits['1.3'].verdict, AUDIT_UNCONFIRMED)

  assert.deepEqual(oneMissing.completed, ['1.1', '1.2', '1.3'], 'all three still succeeded')
  assert.equal(oneMissing.failures.length, 0, 'the failure count is untouched')
  assert.deepEqual(
    withoutAudits(oneMissing),
    withoutAudits(confirmed),
    'the recorded run must differ in nothing but the verdict'
  )
  assert.deepEqual(nextStep(oneMissing), nextStep(confirmed), 'the wave advances identically')
})

test('a run whose every packet is unconfirmed completes rather than halting', () => {
  const { actions, state } = drive(createRunState(simplePlan([1, 2], 1)), {
    onBatch: step => ({
      tasks: stepTasks(step).map(t => ({
        id: t.id,
        ok: true,
        // Reported one thing, cited another: unconfirmed against the report,
        // which is the strongest failure this audit can produce.
        filesChanged: ['src/actually-touched.ts'],
        handoff: handoffFor(t.id, { evidence: ['lib/nowhere.mjs:1'] })
      }))
    })
  })
  assert.deepEqual(actions, ['run-batch', 'verify', 'run-batch', 'verify', 'test-wave', 'done'])
  assert.equal(state.halt, null)
  assert.equal(state.failures.length, 0)
  const verdicts = Object.values(state.evidenceAudits).map(a => a.verdict)
  assert.equal(verdicts.length, 5)
  assert.ok(
    verdicts.every(v => v === AUDIT_UNCONFIRMED),
    `every verdict should be unconfirmed, got ${verdicts.join(', ')}`
  )
})

test('a run one failure below the halt does not halt on unconfirmed verdicts', () => {
  // taskFailureHalt is the number TOLERATED, so the halt fires above it. Two
  // failures is the last state that must survive, and it is the state a
  // verdict-derived halt would break first.
  const start = createRunState(simplePlan([1, 2, 3]))
  const failedWave1 = recordBatchResult(start, {
    tasks: [
      { id: '1.1', ok: false, error: 'gave up' },
      { id: '1.2', ok: false, error: 'gave up' }
    ]
  })
  assert.equal(failedWave1.failures.length, LIMITS.taskFailureHalt)
  assert.equal(failedWave1.halt, null)

  const atWave2 = recordVerifyResult(failedWave1, { ok: true })
  const after = recordBatchResult(
    atWave2,
    { tasks: [okTaskWith('2.1', ['src/2.1.ts']), okTaskWith('2.2', ['src/2.2.ts'])] },
    { changedPaths: ['lib/somewhere-else.mjs'] }
  )
  assert.equal(after.evidenceAudits['2.1'].verdict, AUDIT_UNCONFIRMED)
  assert.equal(after.halt, null, 'an unconfirmed verdict is not a failure')
  assert.equal(after.failures.length, LIMITS.taskFailureHalt, 'the failure count is unchanged')
})

test('an over-budget packet still fails closed, with no verdict stored for it', () => {
  const start = createRunState(simplePlan([1, 2]))
  const after = recordBatchResult(
    start,
    {
      tasks: [
        {
          id: '1.1',
          ok: true,
          filesChanged: ['src/1.1.ts'],
          handoff: handoffFor('1.1', { summary: 'x'.repeat(2500) })
        }
      ]
    },
    { changedPaths: ['src/1.1.ts'] }
  )
  assert.equal(after.completed.length, 0)
  assert.match(after.failures[0].error, /invalid handoff: .*the cap is/)
  assert.deepEqual(after.handoffs, {}, 'a rejected packet is not stored')
  assert.equal(
    Object.prototype.hasOwnProperty.call(after.evidenceAudits, '1.1'),
    false,
    'there is no packet to audit, so there is no verdict'
  )
})

test('createRunState carries a collision lane through instead of splitting it', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2', '1.3']]])
  const start = createRunState(plan)
  assert.deepEqual(
    laneIds(start.waves[0]),
    [[['1.1', '1.2', '1.3']]],
    'a higher runtime cap is not permission to co-schedule tasks that write one file'
  )
  const step = nextStep(start)
  assert.equal(step.remainingBatches.length, 1)
  assert.deepEqual(
    step.remainingBatches.map(b => b.map(l => l.map(t => t.id))),
    [[['1.1', '1.2', '1.3']]],
    'the lane reaches the executor as a lane — flattening it here would be one agent per task again'
  )
})

test('a collision component over the cap becomes sequential lanes, never one batch', () => {
  const tasks = Array.from({ length: 6 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, paths: ['src/auth.ts'] })
  )
  const plan = planWaves({ tasks }, { maxTasksPerAgent: 4 })
  assert.deepEqual(laneIds(plan.waves[0]), [
    [['1.1', '1.2', '1.3', '1.4']],
    [['1.5', '1.6']]
  ])
  const start = createRunState(plan, { maxParallel: 8 })
  assert.deepEqual(
    laneIds(start.waves[0]),
    [[['1.1', '1.2', '1.3', '1.4']], [['1.5', '1.6']]],
    'the two halves of a split component write the same file, so they may never share a batch'
  )
})

test('createRunState does not pull a folded disjoint-path batch into batch 0', () => {
  // The batch boundary here exists because of the fold, not because of a path
  // collision — the two tasks claim different files. A createRunState that
  // flattened the wave and re-packed it would find no collision, see room under
  // maxParallel, and run 2.1 in parallel with the work it was ordered after.
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/match_runner.py'] }),
      task({ id: '2.1', group: 2, paths: ['scripts/run_match.py'] })
    ]
  })
  assert.deepEqual(plan.folded, [{ id: '2.1', from: 2, to: 1 }])

  const start = createRunState(plan, { maxParallel: 4 })
  assert.equal(start.waves.length, 1)
  assert.deepEqual(
    batchIds(start.waves[0]),
    [['1.1'], ['2.1']],
    'a higher runtime cap is not permission to undo an ordering the plan recorded'
  )
})

test('a planned batch wider than the runtime cap is split, not merged with its neighbour', () => {
  // Tier 4: cohesion-ineligible, so the planned batch really is ten lanes wide
  // and the runtime cap has something to split.
  const wide = Array.from({ length: 10 }, (_, i) => task({ id: `1.${i + 1}`, group: 1, tier: 4 }))
  const plan = planWaves({ tasks: [...wide, task({ id: '2.1', group: 2 })] }, { maxParallel: 10 })
  assert.deepEqual(plan.waves[0].batches.map(b => b.length), [10, 1])

  const start = createRunState(plan, { maxParallel: 8 })
  assert.deepEqual(
    start.waves[0].batches.map(b => b.length),
    [8, 2, 1],
    'the wide batch splits to fit; the folded task stays behind both halves'
  )
  assert.equal(start.waves[0].batches.at(-1)[0][0].id, '2.1')
  assert.ok(start.warnings.some(w => w.includes('re-split')))
})

test('a docs-only wave skips verify and does not consume the cap', () => {
  // Two tasks per group, or group 2 would fold onto group 1 and there would be
  // no wave boundary left for a skip to be recorded at.
  const plan = planOf([
    task({ id: '1.1', group: 1, paths: ['docs/foo.md'] }),
    task({ id: '1.2', group: 1, paths: ['docs/bar.md'] }),
    task({ id: '2.1', group: 2, paths: ['src/auth.ts'] }),
    task({ id: '2.2', group: 2, paths: ['src/other.ts'] })
  ])
  const start = createRunState(plan)
  const after = recordBatchResult(start, allOk(nextStep(start)))
  assert.equal(nextStep(after).action, 'run-batch')
  assert.equal(after.skippedVerifications[0].reason, SKIP_VERIFY_DOCS)
  assert.equal(after.verificationsUsed, 0)
})

test('missing paths are not treated as docs-only', () => {
  const plan = planOf([
    task({ id: '1.1', group: 1 }),
    task({ id: '1.2', group: 1 }),
    task({ id: '2.1', group: 2 }),
    task({ id: '2.2', group: 2 })
  ])
  const start = createRunState(plan)
  const after = recordBatchResult(start, allOk(nextStep(start)))
  assert.equal(nextStep(after).action, 'verify')
})

test('the inter-wave verify cap skips further checkpoints', () => {
  const groups = Array.from({ length: LIMITS.interWaveVerifications + 2 }, (_, i) => i + 1)
  const start = createRunState(simplePlan(groups))
  const { actions, state } = drive(start)
  const verifies = actions.filter(a => a === 'verify').length
  assert.equal(verifies, LIMITS.interWaveVerifications)
  assert.ok(state.skippedVerifications.some(s => s.reason === SKIP_VERIFY_CAP))
  assert.equal(actions.at(-1), 'done')
})

// --- task-failure halt ----------------------------------------------------

test(`exactly LIMITS.taskFailureHalt task failures continue; one more halts`, () => {
  const width = LIMITS.taskFailureHalt + 1
  const tasks = Array.from({ length: width }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  tasks.push(task({ id: '2.1', group: 2 }))
  const start = createRunState(planOf(tasks))

  const first = nextStep(start)
  const atCap = recordBatchResult(start, {
    tasks: stepTasks(first).map((t, i) =>
      i >= LIMITS.taskFailureHalt ? okTask(t.id) : { id: t.id, ok: false }
    )
  })
  assert.equal(atCap.failures.length, LIMITS.taskFailureHalt)
  assert.equal(atCap.halt, null)
  assert.notEqual(nextStep(atCap).action, 'halt')

  const overCap = recordBatchResult(start, {
    tasks: stepTasks(first).map(t => ({ id: t.id, ok: false, error: 'agent gave up' }))
  })
  assert.equal(overCap.failures.length, LIMITS.taskFailureHalt + 1)
  assert.equal(overCap.halt.kind, HALT_TASK_FAILURES)
  const halt = nextStep(overCap)
  assert.equal(halt.action, 'halt')
  assert.equal(halt.failures.length, LIMITS.taskFailureHalt + 1)
})

test('test-wave failures count towards the same halt accounting', () => {
  const tasks = [task({ id: '1.1', group: 1 })]
  for (let i = 0; i <= LIMITS.taskFailureHalt; i++) {
    tasks.push(task({ id: `t.${i + 1}`, group: 9, isTestTask: true }))
  }
  const { trace, state } = drive(createRunState(planOf(tasks)), {
    onBatch: step =>
      step.action === 'test-wave'
        ? { tasks: stepTasks(step).map(t => ({ id: t.id, ok: false })) }
        : allOk(step)
  })
  assert.equal(trace.at(-1).action, 'halt')
  assert.equal(state.halt.kind, HALT_TASK_FAILURES)
})

test('every halt carries a non-empty reason the caller cannot read as advice', () => {
  const blocked = drive(createRunState(simplePlan([1, 2])), {
    onVerify: () => ({ ok: false, blocksNextWave: true })
  })
  const doomed = Array.from({ length: LIMITS.taskFailureHalt + 1 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1 })
  )
  const failed = drive(createRunState(planOf(doomed)), {
    onBatch: step => ({ tasks: stepTasks(step).map(t => ({ id: t.id, ok: false })) }),
    onVerify: () => ({ ok: true })
  })
  for (const { trace, state } of [blocked, failed]) {
    const halt = trace.at(-1)
    assert.equal(halt.action, 'halt')
    assert.equal(typeof halt.reason, 'string')
    assert.ok(halt.reason.trim().length > 0, 'a halt without a reason is not a halt')
    assert.match(formatRunState(state), /^HALTED: .+/m)
  }
})

test('nothing can be recorded once the run has halted', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const halted = recordBatchResult(start, {
    tasks: stepTasks(step).map(t => ({ id: t.id, ok: false }))
      .concat(
        Array.from({ length: LIMITS.taskFailureHalt }, (_, i) => ({ id: `x.${i}`, ok: false }))
      )
  })
  assert.equal(halted.halt.kind, HALT_TASK_FAILURES)
  assert.throws(() => recordBatchResult(halted, { tasks: [] }), /run has halted/)
  assert.throws(() => applyReplan(halted, [{ group: 2, tasks: [] }]), /run has halted/)
})

// --- replan ---------------------------------------------------------------

test('replan revises a group that has not executed yet', () => {
  const start = createRunState(simplePlan([1, 2]))
  const afterWave1 = recordBatchResult(start, allOk(nextStep(start)))
  const replanned = applyReplan(afterWave1, [
    { group: 2, tasks: [task({ id: '2.9', group: 2 }), task({ id: '2.10', group: 2 })] }
  ])
  assert.equal(replanned.replansUsed, 1)

  const afterVerify = recordVerifyResult(replanned, { ok: true })
  const step = nextStep(afterVerify)
  assert.equal(step.action, 'run-batch')
  assert.deepEqual(stepTasks(step).map(t => t.id), ['2.9', '2.10'])
})

test('replanning an executed group is a user-facing error, not a silent no-op', () => {
  const start = createRunState(simplePlan([1, 2]))
  const afterWave1 = recordBatchResult(start, allOk(nextStep(start)))
  assert.ok(afterWave1.executedGroups.includes(1))
  try {
    applyReplan(afterWave1, [{ group: 1, tasks: [task({ id: '1.9', group: 1 })] }])
    assert.fail('replanning an executed group must throw')
  } catch (err) {
    assert.match(err.message, /group 1: it has already executed/)
    assert.equal(err.userFacing, true)
  }
  assert.equal(afterWave1.replansUsed, 0, 'a rejected replan must not consume the budget')
})

test('a rejected revision leaves every other group in the batch untouched', () => {
  const start = createRunState(simplePlan([1, 2, 3]))
  const afterWave1 = recordBatchResult(start, allOk(nextStep(start)))
  assert.throws(
    () =>
      applyReplan(afterWave1, [
        { group: 3, tasks: [task({ id: '3.9', group: 3 })] },
        { group: 1, tasks: [] }
      ]),
    /already executed/
  )
  const wave3 = afterWave1.waves.find(w => w.group === 3)
  assert.deepEqual(batchIds(wave3)[0], ['3.1', '3.2'], 'group 3 must be unchanged')
})

test('the replan cap comes from LIMITS.replansPerRun', () => {
  let state = createRunState(simplePlan(Array.from({ length: LIMITS.replansPerRun + 2 }, (_, i) => i + 1)))
  for (let i = 0; i < LIMITS.replansPerRun; i++) {
    const group = i + 2
    state = applyReplan(state, [{ group, tasks: [task({ id: `${group}.9`, group })] }])
  }
  assert.equal(state.replansUsed, LIMITS.replansPerRun)
  assert.throws(
    () => applyReplan(state, [{ group: LIMITS.replansPerRun + 2, tasks: [] }]),
    new RegExp(`replan cap reached: ${LIMITS.replansPerRun} replans per run`)
  )
})

test('an empty task list drops a future wave; a new group is inserted in order', () => {
  const start = createRunState(simplePlan([1, 2, 4]))
  const dropped = applyReplan(start, [{ group: 4, tasks: [] }])
  assert.deepEqual(dropped.waves.map(w => w.group), [1, 2])

  const added = applyReplan(dropped, [{ group: 3, tasks: [task({ id: '3.1', group: 3 })] }])
  assert.deepEqual(added.waves.map(w => w.group), [1, 2, 3])
})

test('the test wave is not a replannable group', () => {
  const start = createRunState(simplePlan([1], 1))
  assert.throws(
    () => applyReplan(start, [{ group: null, tasks: [] }]),
    /integer "group"; the trailing test wave cannot be replanned/
  )
})

test('replan is offered at a wave boundary when a result asked for one', () => {
  const start = createRunState(simplePlan([1, 2]))
  const afterWave1 = recordBatchResult(start, {
    ...allOk(nextStep(start)),
    replanSuggested: true
  })
  assert.equal(nextStep(afterWave1).action, 'verify', 'never mid-wave, and never before the check')

  const afterVerify = recordVerifyResult(afterWave1, { ok: true })
  const step = nextStep(afterVerify)
  assert.equal(step.action, 'replan')
  assert.deepEqual(step.revisableGroups, [2])
  assert.equal(step.replansRemaining, LIMITS.replansPerRun)

  const replanned = applyReplan(afterVerify, [{ group: 2, tasks: [task({ id: '2.9', group: 2 })] }])
  assert.equal(nextStep(replanned).action, 'run-batch', 'the offer is consumed')
})

// --- immutability ---------------------------------------------------------

test('every transition returns a new state and leaves its input deeply unchanged', () => {
  const start = createRunState(simplePlan([1, 2, 3]))
  const before = JSON.stringify(start)

  const afterBatch = recordBatchResult(start, allOk(nextStep(start)))
  assert.notEqual(afterBatch, start)
  assert.equal(JSON.stringify(start), before, 'recordBatchResult mutated its input')

  const afterVerify = recordVerifyResult(afterBatch, { ok: false, errors: ['x'] })
  const afterBatchSnapshot = JSON.stringify(afterBatch)
  assert.notEqual(afterVerify, afterBatch)
  recordVerifyResult(afterBatch, { ok: true })
  assert.equal(JSON.stringify(afterBatch), afterBatchSnapshot, 'recordVerifyResult mutated its input')

  const replanned = applyReplan(afterBatch, [{ group: 3, tasks: [task({ id: '3.9', group: 3 })] }])
  assert.notEqual(replanned, afterBatch)
  assert.equal(JSON.stringify(afterBatch), afterBatchSnapshot, 'applyReplan mutated its input')
})

test('replaying the same results from the same state gives the same answer', () => {
  const start = createRunState(simplePlan([1, 2], 1))
  const first = drive(start)
  const replay = drive(start)
  assert.deepEqual(replay.actions, first.actions)
  assert.deepEqual(JSON.parse(JSON.stringify(replay.state)), JSON.parse(JSON.stringify(first.state)))
})

test('a returned state is frozen all the way down', () => {
  const state = createRunState(simplePlan([1, 2]))
  assert.ok(Object.isFrozen(state))
  assert.ok(Object.isFrozen(state.waves))
  assert.ok(Object.isFrozen(state.waves[0].batches[0]), 'the lane list')
  assert.ok(Object.isFrozen(state.waves[0].batches[0][0]), 'the lane')
  assert.ok(Object.isFrozen(state.waves[0].batches[0][0][0]), 'the task inside it')
  assert.throws(() => {
    state.halt = { kind: 'nope', reason: 'nope' }
  }, TypeError)
})

test('a run state holds nothing the caller can reach or mutate through the plan', () => {
  const plan = simplePlan([1, 2])
  const state = createRunState(plan)
  assert.ok(!Object.isFrozen(firstTask(plan)), 'the caller plan must not be frozen')
  firstTask(plan).model = 'opus'
  assert.equal(state.waves[0].batches[0][0][0].model, 'sonnet')
})

// --- the change name on the state ------------------------------------------

test('createRunState carries the change name onto the frozen state', () => {
  const state = createRunState(simplePlan([1, 2]), { change: '  add-widget-export  ' })
  assert.equal(state.change, 'add-widget-export', 'the name is trimmed and kept')
})

test('the change name survives record-batch, record-verify and replan', () => {
  // The name is fixed at create and must reach the last event of the run, so
  // every mutation path is walked rather than only the one the happy path uses.
  const start = createRunState(simplePlan([1, 2, 3]), { change: 'add-widget-export' })

  const afterBatch = recordBatchResult(start, allOk(nextStep(start)))
  assert.equal(afterBatch.change, 'add-widget-export', 'recordBatchResult dropped the name')

  const afterVerify = recordVerifyResult(afterBatch, { ok: true })
  assert.equal(afterVerify.change, 'add-widget-export', 'recordVerifyResult dropped the name')

  const replanned = applyReplan(afterBatch, [{ group: 3, tasks: [task({ id: '3.9', group: 3 })] }])
  assert.equal(replanned.change, 'add-widget-export', 'applyReplan dropped the name')
})

test('createRunState without a change name is not an error', () => {
  const state = createRunState(simplePlan([1, 2]))
  assert.equal(state.change, undefined)
  assert.equal(nextStep(state).action, 'run-batch', 'an unnamed run still walks')

  const blank = createRunState(simplePlan([1, 2]), { change: '   ' })
  assert.equal(blank.change, undefined, 'a blank name is no name, not an empty one')
})

// --- caps, clamps and guards ---------------------------------------------

test('parallelism is clamped to the runtime ceiling, and wide batches re-split', () => {
  // Tier 4 so every task is its own lane and the planned batch is genuinely
  // wider than the runtime ceiling.
  const tasks = Array.from({ length: RUNTIME.maxConcurrentAgents + 4 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1, tier: 4 })
  )
  const plan = planOf(tasks, { maxParallel: RUNTIME.maxConcurrentAgents + 10 })
  const state = createRunState(plan)
  assert.equal(state.maxParallel, RUNTIME.maxConcurrentAgents)
  assert.ok(state.waves[0].batches.every(b => b.length <= RUNTIME.maxConcurrentAgents))
  assert.ok(state.warnings.some(w => w.includes('re-split')))
})

// --- mode and lane caps on the run state (design D10) ----------------------

test('the run state carries the plan mode, and every step echoes it', () => {
  const solo = createRunState(planWaves({ tasks: soloTasks() }, { mode: 'solo' }))
  assert.equal(solo.mode, 'solo')
  assert.equal(nextStep(solo).mode, 'solo')

  const waves = createRunState(planWaves({ tasks: soloTasks() }))
  assert.equal(waves.mode, 'waves')
  assert.equal(nextStep(waves).mode, 'waves')
})

test('a state written before modes existed reads as waves', () => {
  // The host reads `step.mode` and brings nothing of its own, so the fallback
  // has to be the shape every pre-mode run actually was.
  const state = createRunState(simplePlan([1, 2]))
  const legacy = { ...state }
  delete legacy.mode
  assert.equal(nextStep(legacy).mode, 'waves')
})

test('every kind of step carries the mode, not only the dispatching one', () => {
  const state = createRunState(planWaves({ tasks: soloTasks() }, { mode: 'solo' }))
  const seen = new Set()
  let at = state
  for (let i = 0; i < 6; i++) {
    const step = nextStep(at)
    seen.add(step.mode)
    if (step.action === 'done' || step.action === 'halt') break
    at = step.action === 'verify' ? recordVerifyResult(at, { ok: true }) : recordBatchResult(at, allOk(step))
  }
  assert.deepEqual([...seen], ['solo'], 'no step along the walk dropped the mode')
})

test('the run state carries the effective lane caps, and a replan lanes under them', () => {
  const plan = planWaves({ tasks: simpleTasks([1, 2]) }, { maxTasksPerAgent: 2 })
  const state = createRunState(plan)
  assert.deepEqual(state.laneCaps, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 })

  const revised = applyReplan(state, [
    {
      group: 2,
      tasks: Array.from({ length: 3 }, (_, i) =>
        task({ id: `2.${i + 1}`, group: 2, tier: 1, model: 'haiku', paths: [`src/r${i}.ts`] })
      )
    }
  ])
  const wave2 = revised.waves.find(w => w.group === 2)
  assert.deepEqual(
    wave2.batches.flat(1).map(l => l.length),
    [2, 1],
    'the revision is laned under the caps the run started with, override included'
  )
})

test('a state written before laneCaps existed replans under the published table', () => {
  const state = createRunState(planWaves({ tasks: simpleTasks([1, 2]) }))
  const legacy = { ...state }
  delete legacy.laneCaps
  const revised = applyReplan(legacy, [
    {
      group: 2,
      tasks: Array.from({ length: LANE_CAPS.byTier[1] + 1 }, (_, i) =>
        task({ id: `2.${i + 1}`, group: 2, tier: 1, model: 'haiku', paths: [`src/r${i}.ts`] })
      )
    }
  ])
  const wave2 = revised.waves.find(w => w.group === 2)
  assert.deepEqual(
    wave2.batches.flat(1).map(l => l.length),
    [LANE_CAPS.byTier[1], 1],
    'absence falls back to the published table rather than failing the replan'
  )
})

test('planning the same classified input twice is byte-identical, cohesion and solo alike', () => {
  // Replay: a resumed run is replanned from the same cached input and must reach
  // the same plan, or nothing downstream of it is reproducible.
  const tasks = () => [
    ...Array.from({ length: 5 }, (_, i) =>
      task({ id: `1.${i + 1}`, group: 1, tier: 2, paths: [`src/${i}.ts`] })
    ),
    task({ id: '1.6', group: 1, tier: 5, model: 'opus', paths: ['src/hard.ts'] }),
    task({ id: 't.1', group: 2, tier: 2, isTestTask: true, paths: ['test/a.test.mjs'] })
  ]
  for (const opts of [{}, { mode: 'solo' }, { maxTasksPerAgent: 2 }]) {
    const a = JSON.stringify(planWaves({ tasks: tasks() }, opts))
    const b = JSON.stringify(planWaves({ tasks: tasks() }, opts))
    assert.equal(a, b, `planning is not deterministic under ${JSON.stringify(opts)}`)
  }
})

test('opts.maxParallel overrides the plan cap', () => {
  const state = createRunState(simplePlan([1, 2]), { maxParallel: 3 })
  assert.equal(state.maxParallel, 3)
  assert.equal(createRunState(simplePlan([1])).maxParallel, LIMITS.maxParallel)
})

test('results recorded against the wrong phase are rejected', () => {
  const start = createRunState(simplePlan([1, 2]))
  assert.throws(() => recordVerifyResult(start, { ok: true }), /not waiting on a check/)
  const afterBatch = recordBatchResult(start, allOk(nextStep(start)))
  assert.throws(() => recordBatchResult(afterBatch, { tasks: [] }), /not waiting on a batch/)
})

test('batch results are validated with actionable messages', () => {
  const start = createRunState(simplePlan([1]))
  assert.throws(() => recordBatchResult(start, null), /must be an object/)
  assert.throws(() => recordBatchResult(start, {}), /"tasks" array/)
  assert.throws(() => recordBatchResult(start, { tasks: [{ id: '1.1' }] }), /\.ok must be a boolean/)
  assert.throws(() => recordBatchResult(start, { tasks: [{ id: '', ok: true }] }), /non-empty string/)

  const twoWaves = createRunState(simplePlan([1, 2]))
  const atVerify = recordBatchResult(twoWaves, allOk(nextStep(twoWaves)))
  assert.throws(() => recordVerifyResult(atVerify, {}), /boolean "ok"/)
  assert.throws(() => recordVerifyResult(atVerify, null), /must be an object/)
})

test('createRunState rejects anything that is not a planWaves plan', () => {
  assert.throws(() => createRunState(null), /needs the plan object/)
  assert.throws(() => createRunState({}), /"waves" array/)
  assert.throws(() => createRunState({ waves: [{ group: 1 }] }), /"batches" array/)
  assert.throws(() => nextStep({}), /must be the object returned by createRunState/)
})

test('a plan with nothing in it is done immediately', () => {
  const state = createRunState({ maxParallel: 8, waves: [], testWave: null })
  assert.equal(nextStep(state).action, 'done')
})

// --- formatting -----------------------------------------------------------

test('formatRunState reports position, failures and the next step', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const afterBatch = recordBatchResult(start, {
    tasks: stepTasks(step).map(t => ({ id: t.id, ok: false, error: 'import path broke' }))
  })
  const out = formatRunState(afterBatch)
  assert.match(out, /1 task\(s\) done|0 task\(s\) done/)
  assert.match(out, /failed 1\.1 in wave 1: import path broke/)
  assert.match(out, new RegExp(`0/${LIMITS.replansPerRun} replans used`))
  assert.match(out, /next: verify after wave 1/)
})

// --- path canonicalization (spec: ship/wave-isolation) ---------------------
//
// The collision guarantee is the one this repository advertises most
// prominently, and it exists to stop two implementers writing one file in one
// working tree. A check keyed on the raw predicted string prevents concurrent
// writes only to one *spelling*: `src/a.ts` and `./src/a.ts` are different keys
// for the same file, so the two tasks land in the same batch and race.

/**
 * Two tasks in one group, each predicting the file under a different spelling.
 *
 * Tier 4 so that cohesion never packs them: these fixtures answer "did the
 * planner see a collision", and a pair packed by tier would land in one lane
 * whether the paths collided or not, which would make every negative case here
 * pass for the wrong reason.
 */
function collidingPlan(pathA, pathB) {
  return planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'first',
        tier: 4,
        model: 'sonnet',
        isTestTask: false,
        paths: [pathA]
      },
      {
        id: '1.2',
        group: 1,
        description: 'second',
        tier: 4,
        model: 'sonnet',
        isTestTask: false,
        paths: [pathB]
      }
    ]
  })
}

const batchOf = (plan, id) => placementOf(plan, id).batch

/** Same batch AND same lane: the two tasks run in order inside one agent. */
function assertOneLane(plan, a, b, why) {
  const pa = placementOf(plan, a)
  const pb = placementOf(plan, b)
  assert.deepEqual(pa, pb, why)
  const lane = plan.waves[0].batches[pa.batch][pa.lane].map(t => t.id)
  assert.deepEqual(lane, [a, b], 'and in task-id order inside it')
}

test('two tasks predicting the same file, spelled identically, are serialized', () => {
  const plan = collidingPlan('lib/waves.mjs', 'lib/waves.mjs')
  assert.equal(plan.waves.length, 1, 'a collision is a lane, never a new wave')
  assertOneLane(plan, '1.1', '1.2', 'two writers of one file belong to one lane')
  assert.equal(plan.serialized.length, 1)
  assert.equal(plan.serialized[0].id, '1.2')
  assert.equal(plan.serialized[0].conflictsWith, '1.1')
  assert.equal(plan.serialized[0].group, 1)
})

// Every spelling in ship/wave-isolation's edge-case scenario.
const SAME_FILE_SPELLINGS = [
  ['a leading ./', 'src/a.ts', './src/a.ts'],
  ['a redundant foo/../ segment', 'src/a.ts', 'src/foo/../a.ts'],
  ['duplicated separators', 'src/a.ts', 'src//a.ts'],
  ['a trailing separator on a directory prefix', 'src/a.ts', 'src/./a.ts'],
  ['mixed separator characters', 'src/a.ts', 'src\\a.ts'],
  ['all of them at once', 'src/a.ts', './src\\foo/..//a.ts']
]

for (const [name, spelt, variant] of SAME_FILE_SPELLINGS) {
  test(`a collision survives ${name}`, () => {
    const plan = collidingPlan(spelt, variant)
    assertOneLane(
      plan,
      '1.1',
      '1.2',
      `"${spelt}" and "${variant}" denote one file, so the two tasks must share one lane rather ` +
        `than run concurrently`
    )
    assert.equal(plan.serialized.length, 1, `no serialization was recorded for ${name}`)
  })
}

test('paths that genuinely denote different files are not merged', () => {
  for (const [a, b] of [
    ['src/a.ts', 'src/b.ts'],
    ['src/a.ts', 'src/sub/a.ts'],
    ['src/a.ts', 'srcx/a.ts'],
    ['lib/a.mjs', 'lib/a.mts']
  ]) {
    const plan = collidingPlan(a, b)
    assert.equal(
      plan.serialized.length,
      0,
      `"${a}" and "${b}" are different files and must stay in one batch`
    )
    assert.equal(batchOf(plan, '1.1'), batchOf(plan, '1.2'), 'same batch — they run in parallel')
    assert.notEqual(
      placementOf(plan, '1.1').lane,
      placementOf(plan, '1.2').lane,
      'and separate lanes: at tier 4 nothing may fold disjoint work into one agent'
    )
  }
})

test('the serialization report keeps the spelling the task author wrote', () => {
  // A report naming a path the author does not recognize is a worse report.
  const plan = collidingPlan('lib/verify.mjs', './lib/verify.mjs')
  assert.equal(plan.serialized[0].path, './lib/verify.mjs')
  assert.match(plan.warnings.join('\n'), /\.\/lib\/verify\.mjs/)
})

test('an absolute or root-escaping predicted path is rejected, never rewritten into scope', () => {
  const plan = planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'first',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['/etc/passwd', '../outside/a.ts']
      }
    ]
  })
  const warnings = plan.warnings.join('\n')
  assert.match(warnings, /\/etc\/passwd/, 'an absolute path must be reported as unusable')
  assert.match(warnings, /\.\.\/outside\/a\.ts/, 'an escaping path must be reported as unusable')
  assert.ok(
    Array.isArray(plan.rejectedPaths) && plan.rejectedPaths.length === 2,
    'the plan must record which predicted paths could not be used for collision keying'
  )
})

test('a task that predicts no paths contends with nothing', () => {
  const plan = planWaves({
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 4, model: 'sonnet', isTestTask: false },
      {
        id: '1.2',
        group: 1,
        description: 'b',
        tier: 4,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/a.mjs']
      }
    ]
  })
  assert.equal(plan.serialized.length, 0)
  assert.equal(batchOf(plan, '1.1'), batchOf(plan, '1.2'))
  assert.notEqual(
    placementOf(plan, '1.1').lane,
    placementOf(plan, '1.2').lane,
    'a task claiming no paths joins no COLLISION lane — it cannot be shown to collide'
  )
})

test('a pathless task may still join a cohesion lane by tier', () => {
  // lanes/spec.md: "Tasks that omit `paths` MUST NOT be treated as colliding,
  // but MAY join a cohesion lane by tier." The same pair at a cohesion-eligible
  // tier packs — by tier, and the plan says so rather than reporting a collision
  // it did not find.
  const plan = planWaves({
    tasks: [
      { id: '1.1', group: 1, description: 'a', tier: 2, model: 'sonnet', isTestTask: false },
      {
        id: '1.2',
        group: 1,
        description: 'b',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/a.mjs']
      }
    ]
  })
  assert.deepEqual(plan.serialized, [], 'still no collision — nothing was shown to share a path')
  assert.deepEqual(laneIds(plan.waves[0]), [[['1.1', '1.2']]])
  assert.equal(plan.lanes[0].kind, 'cohesion')
})

test('the changed-file list a verification receives deduplicates by canonical path', () => {
  const plan = planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'a',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/a.mjs']
      },
      {
        id: '1.2',
        group: 1,
        description: 'b',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['./lib/a.mjs', 'lib//b.mjs']
      },
      // Two tasks in group 2, so it stays a wave: a 1-task group would fold
      // onto wave 1 and there would be no inter-wave check to inspect.
      {
        id: '2.1',
        group: 2,
        description: 'c',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/c.mjs']
      },
      {
        id: '2.2',
        group: 2,
        description: 'd',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/d.mjs']
      }
    ]
  })
  const state = createRunState(plan)
  let step = nextStep(state)
  let cursor = state
  while (step.action === 'run-batch') {
    cursor = recordBatchResult(cursor, {
      tasks: stepTasks(step).map(t => ({ id: t.id, ok: true, handoff: handoffFor(t.id) }))
    })
    step = nextStep(cursor)
  }
  assert.equal(step.action, 'verify')
  assert.deepEqual(
    step.changed,
    ['lib/a.mjs', 'lib//b.mjs'],
    'one file spelled twice appears once, in the spelling its task author used'
  )
})

test('a run-batch step carries the wave changed-file list too', () => {
  // ship.js builds the fused inter-wave `verify plan --changed` list from the
  // step it is already holding. Recomputing it from raw task.paths is how
  // duplicate spellings inflate the changed set.
  const plan = collidingPlan('lib/a.mjs', './lib/a.mjs')
  const step = nextStep(createRunState(plan))
  assert.equal(step.action, 'run-batch')
  assert.deepEqual(step.changed, ['lib/a.mjs'])
})

test('a docs-only wave is recognized whatever the path spelling', () => {
  const plan = planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'a',
        tier: 1,
        model: 'haiku',
        isTestTask: false,
        paths: ['./docs/06-why-it-works.md']
      },
      {
        id: '2.1',
        group: 2,
        description: 'b',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/a.mjs']
      },
      {
        id: '2.2',
        group: 2,
        description: 'c',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/b.mjs']
      }
    ]
  })
  assert.equal(plan.waveCount, 2, 'group 2 must survive as a wave for this to compare two of them')
  assert.equal(isDocsOnlyWave(plan.waves[0]), true)
  assert.equal(isDocsOnlyWave(plan.waves[1]), false)
})

test('a wave whose only path is unusable is never treated as docs-only', () => {
  const plan = planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'a',
        tier: 1,
        model: 'haiku',
        isTestTask: false,
        paths: ['/absolute/docs/x.md']
      }
    ]
  })
  assert.equal(
    isDocsOnlyWave(plan.waves[0]),
    false,
    'a path we cannot place in the repo is unknown, not documentation'
  )
})

// --- dependency edges (specs: task-dependencies, waves) --------------------
//
// `dependsOn` is the cross-file ordering signal the planner used to lack. The
// tests below fix three separate things: that a malformed edge set HALTS rather
// than degrading, that an edge orders exactly the dependent task and nobody
// else, and that a plan carrying no edges is planned the way it always was.

/** Global execution position: which wave, then which batch inside it. */
function positionOf(plan, id) {
  for (let w = 0; w < plan.waves.length; w++) {
    const wave = plan.waves[w]
    for (let b = 0; b < wave.batches.length; b++) {
      if (wave.batches[b].some(lane => lane.some(t => t.id === id))) return { wave: w, batch: b }
    }
  }
  return { wave: -1, batch: -1 }
}

/** Strictly earlier in the run: an earlier wave, or an earlier batch of one. */
function assertRunsBefore(plan, a, b, why) {
  const pa = positionOf(plan, a)
  const pb = positionOf(plan, b)
  assert.ok(pa.wave >= 0, `${a} is not in the plan`)
  assert.ok(pb.wave >= 0, `${b} is not in the plan`)
  assert.ok(pa.wave < pb.wave || (pa.wave === pb.wave && pa.batch < pb.batch), why)
}

/** Everything an edge-free plan must reproduce byte for byte. */
const shapeOf = plan => ({
  waves: plan.waves.map(w => ({ group: w.group, taskCount: w.taskCount, lanes: laneIds(w) })),
  testWave: plan.testWave ? laneIds(plan.testWave) : null,
  waveCount: plan.waveCount,
  laneCount: plan.laneCount,
  folded: plan.folded,
  lanes: plan.lanes,
  serialized: plan.serialized
})

const fileTask = (id, group, path, over = {}) =>
  task({ id, group, paths: [path], ...over })

test('a valid edge is accepted and constrains ordering', () => {
  const plan = planWaves({
    tasks: [
      fileTask('2.1', 2, 'src/a.ts'),
      fileTask('2.2', 2, 'src/b.ts', { dependsOn: ['2.1'] })
    ]
  })
  assertRunsBefore(plan, '2.1', '2.2', 'the edge from 2.2 to 2.1 must order them')
  assert.deepEqual(
    plan.deferred,
    [{ id: '2.2', group: 2, after: ['2.1'] }],
    'and the plan reports the edge that took effect'
  )
})

// Each rejection names its cause, because "the plan is malformed" is not
// something the author of a bad edge can act on.
const MALFORMED = [
  ['a non-array dependsOn', { id: '1.2', dependsOn: '1.1' }, /dependsOn must be an array.*1\.2/],
  ['an array holding a number', { id: '1.2', dependsOn: [7] }, /dependsOn must be an array/],
  ['an array holding a blank string', { id: '1.2', dependsOn: ['  '] }, /dependsOn must be an array/],
  ['a dangling reference', { id: '1.2', dependsOn: ['9.9'] }, /1\.2 depends on "9\.9".*not a task/],
  ['a self-edge', { id: '1.2', dependsOn: ['1.2'] }, /dependency cycle: 1\.2 → 1\.2/]
]

for (const [name, over, message] of MALFORMED) {
  test(`${name} is rejected fail-closed, naming the cause`, () => {
    assert.throws(
      () => planWaves({ tasks: [task({ id: '1.1' }), task({ ...over, group: 1 })] }),
      message,
      `${name} must halt the plan rather than be silently dropped`
    )
  })
}

test('a cycle is rejected naming the ids on it', () => {
  assert.throws(
    () =>
      planWaves({
        tasks: [
          task({ id: '1.1', dependsOn: ['1.2'] }),
          task({ id: '1.2', dependsOn: ['1.1'] })
        ]
      }),
    /dependency cycle: 1\.1 → 1\.2 → 1\.1/,
    'the planner must not break the cycle to proceed'
  )
})

test('an edge pointing at a later section is rejected, not silently ignored', () => {
  // Sections are a barrier an edge cannot override, so this edge asks for an
  // order the section model already forbids. Honouring it is impossible and
  // dropping it is the silent degradation D4 exists to refuse.
  assert.throws(
    () =>
      planWaves({
        tasks: [
          task({ id: '1.1', group: 1, dependsOn: ['2.1'] }),
          task({ id: '2.1', group: 2 })
        ]
      }),
    /1\.1 \(section 1\) depends on 2\.1 \(section 2\).*later section/
  )
})

test('an implementation task depending on a test task is rejected', () => {
  assert.throws(
    () =>
      planWaves({
        tasks: [
          task({ id: '1.1', dependsOn: ['1.2'] }),
          task({ id: '1.2', isTestTask: true })
        ]
      }),
    /1\.1 depends on test task 1\.2.*trailing test wave/
  )
})

test('a cross-file edge orders without a new section, and a sibling stays parallel', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts', { dependsOn: ['1.1'] }),
      fileTask('1.3', 1, 'src/c.ts')
    ]
  })
  assertRunsBefore(plan, '1.1', '1.2', '1.2 needs 1.1, so it runs strictly after it')
  assert.deepEqual(
    positionOf(plan, '1.3'),
    positionOf(plan, '1.1'),
    '1.3 has no edge, so the ordering of 1.2 must not drag it anywhere'
  )
})

test('a lone dependent folds back as a later batch rather than buying a verify', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts', { dependsOn: ['1.1'] }),
      fileTask('1.3', 1, 'src/c.ts')
    ]
  })
  assert.equal(plan.waveCount, 1, 'the singleton dependency layer folds onto the wave before it')
  assert.deepEqual(batchIds(plan.waves[0]), [['1.1', '1.3'], ['1.2']])
})

test('an edge cannot pull a task earlier than its section', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts'),
      fileTask('2.1', 2, 'src/c.ts'),
      fileTask('2.2', 2, 'src/d.ts')
    ]
  })
  assertRunsBefore(plan, '1.1', '2.1', 'section 1 runs before section 2 with or without edges')
  assertRunsBefore(plan, '1.2', '2.2', 'and every task in it does')
})

test('a diamond serializes only along its edges', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts', { dependsOn: ['1.1'] }),
      fileTask('1.3', 1, 'src/c.ts', { dependsOn: ['1.1'] }),
      fileTask('1.4', 1, 'src/d.ts', { dependsOn: ['1.2', '1.3'] })
    ]
  })
  assertRunsBefore(plan, '1.1', '1.2', '1.1 runs first')
  assertRunsBefore(plan, '1.1', '1.3', '1.1 runs first')
  assertRunsBefore(plan, '1.2', '1.4', '1.4 waits for both of its dependencies')
  assertRunsBefore(plan, '1.3', '1.4', '1.4 waits for both of its dependencies')
  assert.deepEqual(
    positionOf(plan, '1.2'),
    positionOf(plan, '1.3'),
    '1.2 and 1.3 have no edge between them, so nothing serializes them'
  )
})

test('a dependent pair is never co-scheduled, and is never folded into one lane', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts', { dependsOn: ['1.1'] })
    ]
  })
  const pa = positionOf(plan, '1.1')
  const pb = positionOf(plan, '1.2')
  assert.notDeepEqual(pa, pb, 'an edge-connected pair may never share a batch')
  const laneWith = id =>
    plan.waves
      .flatMap(w => w.batches.flat())
      .find(lane => lane.some(t => t.id === id))
      .map(t => t.id)
  assert.deepEqual(laneWith('1.1'), ['1.1'], 'lane membership is a path collision, not an edge')
  assert.deepEqual(laneWith('1.2'), ['1.2'], 'so two path-disjoint tasks stay two agents')
})

test('two test tasks joined by an edge are not chunked side by side', () => {
  const plan = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts'),
      task({ id: '2.1', group: 2, isTestTask: true, paths: ['test/a.test.mjs'] }),
      task({
        id: '2.2',
        group: 2,
        isTestTask: true,
        paths: ['test/b.test.mjs'],
        dependsOn: ['2.1']
      })
    ]
  })
  assert.deepEqual(
    plan.testWave.batches.map(b => b.flat().map(t => t.id)),
    [['2.1'], ['2.2']],
    'the trailing test wave honours edges between test tasks as later batches'
  )
})

test('an empty dependsOn plans identically to the field being absent', () => {
  const withField = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts', { dependsOn: [] }),
      fileTask('1.2', 1, 'src/b.ts', { dependsOn: [] }),
      fileTask('2.1', 2, 'src/c.ts', { dependsOn: [] }),
      fileTask('2.2', 2, 'src/d.ts', { dependsOn: [] })
    ]
  })
  const without = planWaves({
    tasks: [
      fileTask('1.1', 1, 'src/a.ts'),
      fileTask('1.2', 1, 'src/b.ts'),
      fileTask('2.1', 2, 'src/c.ts'),
      fileTask('2.2', 2, 'src/d.ts')
    ]
  })
  assert.deepEqual(shapeOf(withField), shapeOf(without))
  assert.deepEqual(withField.deferred, [], 'an empty edge list is not an edge')
})

test('an edge-free plan is planned exactly as it was before edges existed', () => {
  // The compatibility guarantee (D10), asserted against a fixture that exercises
  // every mechanism the depth layering sits in front of: two sections, a path
  // collision, a wide group and a trailing test wave.
  // Every task is tier 4 or 5, so cohesion is off and the shape below is the one
  // the pre-cohesion planner produced byte for byte. Making the fixture
  // cohesion-eligible would test cohesion here instead of edge compatibility,
  // which is what the tests above and below this one are for.
  const tasks = [
    fileTask('1.1', 1, 'lib/a.mjs', { tier: 5, model: 'opus' }),
    fileTask('1.2', 1, './lib/a.mjs', { tier: 4 }),
    fileTask('1.3', 1, 'lib/b.mjs', { tier: 4 }),
    fileTask('2.1', 2, 'lib/c.mjs', { tier: 4 }),
    fileTask('2.2', 2, 'lib/d.mjs', { tier: 4 }),
    task({ id: '3.1', group: 3, tier: 4, isTestTask: true })
  ]
  const plan = planWaves({ tasks }, { maxParallel: 2 })
  assert.deepEqual(shapeOf(plan), {
    waves: [
      { group: 1, taskCount: 3, lanes: [[['1.1', '1.2'], ['1.3']]] },
      { group: 2, taskCount: 2, lanes: [[['2.1'], ['2.2']]] }
    ],
    testWave: [[['3.1']]],
    waveCount: 2,
    laneCount: 4,
    folded: [],
    lanes: [
      {
        group: 1,
        kind: 'collision',
        ids: ['1.1', '1.2'],
        tier: 5,
        cap: LANE_CAPS.byTier[5],
        model: 'opus',
        effort: 'xhigh'
      }
    ],
    serialized: [{ id: '1.2', group: 1, path: './lib/a.mjs', conflictsWith: '1.1' }]
  })
  assert.deepEqual(plan.deferred, [])
})

test('planning is reproducible across repeated runs', () => {
  const tasks = () => [
    fileTask('1.3', 1, 'src/c.ts', { dependsOn: ['1.1'] }),
    fileTask('1.1', 1, 'src/a.ts'),
    fileTask('1.4', 1, 'src/d.ts', { dependsOn: ['1.3', '1.2'] }),
    fileTask('1.2', 1, 'src/b.ts')
  ]
  const first = planWaves({ tasks: tasks() })
  const second = planWaves({ tasks: tasks() })
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('a replanned group keeps the edge order of its revision', () => {
  const state = createRunState(
    planWaves({
      tasks: [
        fileTask('1.1', 1, 'src/a.ts'),
        fileTask('1.2', 1, 'src/b.ts'),
        fileTask('2.1', 2, 'src/c.ts'),
        fileTask('2.2', 2, 'src/d.ts')
      ]
    })
  )
  const replanned = applyReplan(state, [
    {
      group: 2,
      tasks: [
        fileTask('2.1', 2, 'src/c.ts'),
        fileTask('2.2', 2, 'src/d.ts', { dependsOn: ['2.1'] })
      ]
    }
  ])
  const wave = replanned.waves.find(w => w.group === 2)
  assert.deepEqual(
    wave.batches.map(b => b.flat().map(t => t.id)),
    [['2.1'], ['2.2']],
    'the replan path must re-derive the edge order, not drop it'
  )
})
