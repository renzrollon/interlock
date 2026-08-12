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
  HALT_INTER_WAVE_VERIFY
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

const allOk = step => ({ tasks: step.tasks.map(t => ({ id: t.id, ok: true })) })

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

// --- task-failure halt ----------------------------------------------------

test(`exactly LIMITS.taskFailureHalt task failures continue; one more halts`, () => {
  const width = LIMITS.taskFailureHalt + 1
  const tasks = Array.from({ length: width }, (_, i) => task({ id: `1.${i + 1}`, group: 1 }))
  tasks.push(task({ id: '2.1', group: 2 }))
  const start = createRunState(planOf(tasks))

  const first = nextStep(start)
  const atCap = recordBatchResult(start, {
    tasks: first.tasks.map((t, i) => ({ id: t.id, ok: i >= LIMITS.taskFailureHalt }))
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
