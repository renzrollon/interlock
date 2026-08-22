import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planWaves,
  formatPlan,
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
  isDocsOnlyWave
} from '../../lib/waves.mjs'
import { LIMITS, RUNTIME } from '../../lib/limits.mjs'

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
  const first = plan.waves[0].batches[0].map(t => t.id)
  assert.equal(first[0], '1.90', 'the tier-5 task runs first')
  assert.equal(first[1], '1.91', 'then the tier-4')
})

test('batch composition is deterministic for the same input', () => {
  // Ties break on id, so a re-run of the same classified input produces the same
  // batches. Without that nothing downstream of the plan is reproducible.
  const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `1.${i + 1}`, tier: 3 }))
  const a = planWaves({ tasks }, { maxParallel: 5 })
  const b = planWaves({ tasks: [...tasks].reverse() }, { maxParallel: 5 })
  assert.deepEqual(
    a.waves[0].batches.map(x => x.map(t => t.id)),
    b.waves[0].batches.map(x => x.map(t => t.id))
  )
})

// --- path collisions ------------------------------------------------------

test('two tasks in one group claiming the same path stay in one wave, later batch', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts', 'src/other.ts'] })
    ]
  })
  assert.equal(plan.waveCount, 1)
  assert.equal(plan.waves[0].batches.length, 2)
  assert.deepEqual(plan.waves[0].batches[0].map(t => t.id), ['1.1'])
  assert.deepEqual(plan.waves[0].batches[1].map(t => t.id), ['1.2'])
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

test('a collision among three tasks on one path is three batches of one wave', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.equal(plan.waveCount, 1, 'collisions stay in the classified group')
  assert.equal(plan.waves[0].batches.length, 3)
  assert.deepEqual(
    plan.waves[0].batches.map(b => b.map(t => t.id)),
    [['1.1'], ['1.2'], ['1.3']]
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
  const ids = plan.waves.flatMap(w => w.batches.flat()).map(t => t.id)
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
  assert.match(out, /projected agents:/)
})

test('formatPlan warns when the plan is effectively serial', () => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    task({ id: `${i + 1}.1`, group: i + 1 })
  )
  const plan = planWaves({ tasks })
  assert.equal(plan.waveCount, 10)
  assert.ok(plan.warnings.some(w => /effectively serial/.test(w)))
  assert.match(formatPlan(plan), /projected agents: /)
  assert.match(formatPlan(plan), /warning: effectively serial/)
})

// ===========================================================================
// Execution state machine
// ===========================================================================

const planOf = (tasks, opts) => planWaves({ tasks }, opts)

/** A plan with one impl task per listed group, plus optional test tasks. */
function simplePlan(groups = [1, 2], testTasks = 0, opts) {
  const tasks = groups.map(g => task({ id: `${g}.1`, group: g }))
  for (let i = 0; i < testTasks; i++) {
    tasks.push(task({ id: `t.${i + 1}`, group: 99, isTestTask: true }))
  }
  return planOf(tasks, opts)
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

const allOk = step => ({ tasks: step.tasks.map(t => okTask(t.id)) })

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
  const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  const seen = []
  drive(createRunState(planOf(tasks, { maxParallel: 2 })), {
    onBatch: step => {
      seen.push(step.tasks.map(t => t.id))
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
  assert.equal(done.summary.tasksCompleted, 3)
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
  const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  const start = createRunState(planOf(tasks, { maxParallel: 2 }))
  const first = nextStep(start)
  assert.equal(first.remainingBatches.length, 3)
  assert.deepEqual(first.tasks.map(t => t.id), first.remainingBatches[0].map(t => t.id))
  const after = recordBatchResult(start, allOk(first))
  const second = nextStep(after)
  assert.equal(second.remainingBatches.length, 2)
})

// --- handoffs at the wave boundary ----------------------------------------

test('record-batch fails a task that claims success without a handoff', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const after = recordBatchResult(start, { tasks: [{ id: step.tasks[0].id, ok: true }] })

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
    tasks: step.tasks.map(t => ({
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
  const id = step.tasks[0].id
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
    tasks: [{ id: step.tasks[0].id, ok: false, error: 'agent returned no result' }]
  })
  assert.equal(after.failures[0].error, 'agent returned no result')
})

test('a blocked task keeps its packet so the next wave is told why', () => {
  const start = createRunState(simplePlan([1, 2]))
  const step = nextStep(start)
  const id = step.tasks[0].id
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

test('nextStep hands the next wave the previous wave, and only the previous wave', () => {
  const start = createRunState(simplePlan([1, 2, 3]))

  const wave1 = recordBatchResult(start, allOk(nextStep(start)))
  const atWave2 = recordVerifyResult(wave1, { ok: true })
  const step2 = nextStep(atWave2)
  assert.equal(step2.wave, 2)
  assert.deepEqual(step2.previousHandoffs.map(h => h.taskId), ['1.1'])
  assert.equal(step2.previousHandoffs[0].summary, 'did 1.1')

  const wave2 = recordBatchResult(atWave2, allOk(step2))
  const atWave3 = recordVerifyResult(wave2, { ok: true })
  const step3 = nextStep(atWave3)
  assert.equal(step3.wave, 3)
  assert.deepEqual(
    step3.previousHandoffs.map(h => h.taskId),
    ['2.1'],
    'wave 3 gets wave 2 only — packets do not accumulate across the run'
  )
})

test('the first wave has no previous wave to be handed', () => {
  const start = createRunState(simplePlan([1, 2]))
  assert.deepEqual(nextStep(start).previousHandoffs, [])
})

test('every remaining batch of a wave shares the previous wave, not each other', () => {
  // Three same-file tasks in wave 2 serialize into three batches that ship.js
  // runs from a single `next`. They must all see wave 1 and none of them each
  // other, or two batches of one wave would be running under different
  // contracts depending on where they happened to land.
  const plan = planOf([
    task({ id: '1.1', group: 1 }),
    task({ id: '2.1', group: 2, paths: ['src/auth.ts'] }),
    task({ id: '2.2', group: 2, paths: ['src/auth.ts'] }),
    task({ id: '2.3', group: 2, paths: ['src/auth.ts'] })
  ])
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
    tasks: [{ id: step.tasks[0].id, ok: false, error: 'gave up' }]
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

test('createRunState keeps collision batches instead of merging them under maxParallel', () => {
  const plan = planWaves({
    tasks: [
      task({ id: '1.1', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.2', group: 1, paths: ['src/auth.ts'] }),
      task({ id: '1.3', group: 1, paths: ['src/auth.ts'] })
    ]
  })
  assert.equal(plan.waves[0].batches.length, 3)
  const start = createRunState(plan)
  assert.equal(start.waves[0].batches.length, 3, 'a higher runtime cap must not co-schedule colliding tasks')
  const step = nextStep(start)
  assert.equal(step.remainingBatches.length, 3)
  assert.deepEqual(
    step.remainingBatches.map(b => b.map(t => t.id)),
    [['1.1'], ['1.2'], ['1.3']]
  )
})

test('a docs-only wave skips verify and does not consume the cap', () => {
  const plan = planOf([
    task({ id: '1.1', group: 1, paths: ['docs/foo.md'] }),
    task({ id: '2.1', group: 2, paths: ['src/auth.ts'] })
  ])
  const start = createRunState(plan)
  const after = recordBatchResult(start, allOk(nextStep(start)))
  assert.equal(nextStep(after).action, 'run-batch')
  assert.equal(after.skippedVerifications[0].reason, SKIP_VERIFY_DOCS)
  assert.equal(after.verificationsUsed, 0)
})

test('missing paths are not treated as docs-only', () => {
  const start = createRunState(simplePlan([1, 2]))
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
    tasks: first.tasks.map((t, i) =>
      i >= LIMITS.taskFailureHalt ? okTask(t.id) : { id: t.id, ok: false }
    )
  })
  assert.equal(atCap.failures.length, LIMITS.taskFailureHalt)
  assert.equal(atCap.halt, null)
  assert.notEqual(nextStep(atCap).action, 'halt')

  const overCap = recordBatchResult(start, {
    tasks: first.tasks.map(t => ({ id: t.id, ok: false, error: 'agent gave up' }))
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
        ? { tasks: step.tasks.map(t => ({ id: t.id, ok: false })) }
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
    onBatch: step => ({ tasks: step.tasks.map(t => ({ id: t.id, ok: false })) }),
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
    tasks: step.tasks.map(t => ({ id: t.id, ok: false }))
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
  assert.deepEqual(step.tasks.map(t => t.id), ['2.9', '2.10'])
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
  assert.deepEqual(wave3.batches[0].map(t => t.id), ['3.1'], 'group 3 must be unchanged')
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
  assert.ok(Object.isFrozen(state.waves[0].batches[0][0]))
  assert.throws(() => {
    state.halt = { kind: 'nope', reason: 'nope' }
  }, TypeError)
})

test('a run state holds nothing the caller can reach or mutate through the plan', () => {
  const plan = simplePlan([1, 2])
  const state = createRunState(plan)
  assert.ok(!Object.isFrozen(plan.waves[0].batches[0][0]), 'the caller plan must not be frozen')
  plan.waves[0].batches[0][0].model = 'opus'
  assert.equal(state.waves[0].batches[0][0].model, 'sonnet')
})

// --- caps, clamps and guards ---------------------------------------------

test('parallelism is clamped to the runtime ceiling, and wide batches re-split', () => {
  const tasks = Array.from({ length: RUNTIME.maxConcurrentAgents + 4 }, (_, i) =>
    task({ id: `1.${i + 1}`, group: 1 })
  )
  const plan = planOf(tasks, { maxParallel: RUNTIME.maxConcurrentAgents + 10 })
  const state = createRunState(plan)
  assert.equal(state.maxParallel, RUNTIME.maxConcurrentAgents)
  assert.ok(state.waves[0].batches.every(b => b.length <= RUNTIME.maxConcurrentAgents))
  assert.ok(state.warnings.some(w => w.includes('re-split')))
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
    tasks: step.tasks.map(t => ({ id: t.id, ok: false, error: 'import path broke' }))
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

/** Two tasks in one group, each predicting the file under a different spelling. */
function collidingPlan(pathA, pathB) {
  return planWaves({
    tasks: [
      {
        id: '1.1',
        group: 1,
        description: 'first',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: [pathA]
      },
      {
        id: '1.2',
        group: 1,
        description: 'second',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: [pathB]
      }
    ]
  })
}

const batchOf = (plan, id) =>
  plan.waves[0].batches.findIndex(batch => batch.some(t => t.id === id))

test('two tasks predicting the same file, spelled identically, are serialized', () => {
  const plan = collidingPlan('lib/waves.mjs', 'lib/waves.mjs')
  assert.equal(plan.waves.length, 1, 'a collision is a later batch, never a new wave')
  assert.notEqual(batchOf(plan, '1.1'), batchOf(plan, '1.2'))
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
    assert.notEqual(
      batchOf(plan, '1.1'),
      batchOf(plan, '1.2'),
      `"${spelt}" and "${variant}" denote one file, so the two tasks must not share a batch`
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
    assert.equal(batchOf(plan, '1.1'), batchOf(plan, '1.2'))
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
  assert.equal(plan.serialized.length, 0)
  assert.equal(batchOf(plan, '1.1'), batchOf(plan, '1.2'))
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
      {
        id: '2.1',
        group: 2,
        description: 'c',
        tier: 2,
        model: 'sonnet',
        isTestTask: false,
        paths: ['lib/c.mjs']
      }
    ]
  })
  const state = createRunState(plan)
  let step = nextStep(state)
  let cursor = state
  while (step.action === 'run-batch') {
    cursor = recordBatchResult(cursor, {
      tasks: step.tasks.map(t => ({ id: t.id, ok: true, handoff: handoffFor(t.id) }))
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
      }
    ]
  })
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
