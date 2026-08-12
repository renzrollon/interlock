import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planWaves, formatPlan, DEFAULT_MAX_PARALLEL } from '../../lib/waves.mjs'

const task = (over = {}) => ({
  id: '1.1',
  group: 1,
  description: 'do a thing',
  tier: 2,
  model: 'sonnet',
  isTestTask: false,
  ...over
})

test('groups become waves, ordered ascending regardless of input order', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '3.1', group: 3 }),
      task({ id: '1.1', group: 1 }),
      task({ id: '2.1', group: 2 })
    ]
  })
  assert.deepEqual(plan.waves.map(w => w.group), [1, 2, 3])
  assert.equal(plan.waveCount, 3)
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
  assert.equal(plan.waves[0].batches[0][0].model, 'sonnet')
  assert.deepEqual(plan.clamped, [{ id: '1.1', from: 'opus', to: 'sonnet', tier: 3 }])
})

test('opus survives on a true tier-5 task', () => {
  const plan = planWaves({ tasks: [task({ tier: 5, model: 'opus' })] })
  assert.equal(plan.waves[0].batches[0][0].model, 'opus')
  assert.deepEqual(plan.clamped, [])
})

test('haiku stays haiku', () => {
  const plan = planWaves({ tasks: [task({ tier: 1, model: 'haiku' })] })
  assert.equal(plan.waves[0].batches[0][0].model, 'haiku')
  assert.deepEqual(plan.clamped, [])
})

test('the clamp does not mutate the caller input', () => {
  const input = { tasks: [task({ tier: 2, model: 'opus' })] }
  planWaves(input)
  assert.equal(input.tasks[0].model, 'opus', 'caller object must be untouched')
})

// --- the fan-out cap ------------------------------------------------------

test('a wide wave is split into batches of at most maxParallel', () => {
  const tasks = Array.from({ length: 30 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1 })
  )
  const plan = planWaves({ tasks }, { maxParallel: 8 })
  const wave = plan.waves[0]
  assert.equal(wave.taskCount, 30)
  assert.equal(wave.batches.length, 4, '30 tasks at 8 wide = 4 batches')
  assert.deepEqual(wave.batches.map(b => b.length), [8, 8, 8, 6])
  assert.ok(wave.batches.every(b => b.length <= 8))
  assert.ok(plan.warnings.some(w => w.includes('30 tasks')))
})

test('every task survives batching exactly once', () => {
  const tasks = Array.from({ length: 17 }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  const plan = planWaves({ tasks }, { maxParallel: 5 })
  const ids = plan.waves[0].batches.flat().map(t => t.id)
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
        task({ id: '2.1', group: 2 }),
        task({ id: '2.2', group: 2, isTestTask: true })
      ]
    },
    { maxParallel: 1 }
  )
  const out = formatPlan(plan)
  assert.match(out, /Wave 1: 1 task/)
  assert.match(out, /Wave 2: 1 task/)
  assert.match(out, /Test wave: 1 task/)
  assert.match(out, /clamped 1\.1: opus → sonnet \(tier 2\)/)
})
