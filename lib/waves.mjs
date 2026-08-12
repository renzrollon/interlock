// Deterministic wave planner.
//
// Turns a classified task list into an execution plan: which tasks run in which
// wave, in which parallel batch, on which model. Classification itself is a
// judgement call and stays with the model; everything downstream of it is
// mechanical and lives here.
//
// Two rules exist specifically to stop the classifier from harming the run:
//
//   1. Model clamp. Classifiers reliably over-assign `opus` to anything that
//      touches several files. Sonnet handles tiers 1-4; opus survives only on a
//      true tier-5 task. The clamp is applied after classification so the model
//      cannot escalate itself, and every clamp is reported.
//
//   2. Fan-out cap. A wave is a set of independent tasks, so the temptation is
//      to spawn all of them at once. The original implementation did exactly
//      that, which meant a classifier that put 30 tasks in group 1 spawned 30
//      parallel agents. Waves are chunked into batches of at most maxParallel.
//
// Pure: no fs, no agent, no I/O, no clock.
// Exposed to skills as `specflow waves --classified <file>`.

export const DEFAULT_MAX_PARALLEL = 8

const MODELS = new Set(['haiku', 'sonnet', 'opus'])

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

// Apply the clamp to one task, returning a clamp record when it changed.
function clampModel(task) {
  const before = task.model
  if (task.tier < 5 || task.model !== 'opus') {
    task.model = task.model === 'haiku' ? 'haiku' : 'sonnet'
  }
  if (task.model === before) return null
  return { id: task.id, from: before, to: task.model, tier: task.tier }
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function validate(input) {
  if (!input || typeof input !== 'object') fail('classified input must be a JSON object')
  if (!Array.isArray(input.tasks)) fail('classified input must have a "tasks" array')

  const seen = new Set()
  input.tasks.forEach((t, i) => {
    const at = `tasks[${i}]`
    if (!t || typeof t !== 'object') fail(`${at} must be an object`)
    if (typeof t.id !== 'string' || !t.id.trim()) fail(`${at}.id must be a non-empty string`)
    if (seen.has(t.id)) fail(`${at}.id "${t.id}" is duplicated`)
    seen.add(t.id)
    if (!Number.isInteger(t.group)) fail(`${at}.group must be an integer (task ${t.id})`)
    if (typeof t.description !== 'string' || !t.description.trim()) {
      fail(`${at}.description must be a non-empty string (task ${t.id})`)
    }
    if (!Number.isInteger(t.tier) || t.tier < 1 || t.tier > 5) {
      fail(`${at}.tier must be an integer 1-5 (task ${t.id})`)
    }
    if (!MODELS.has(t.model)) {
      fail(`${at}.model must be one of haiku|sonnet|opus (task ${t.id})`)
    }
    if (typeof t.isTestTask !== 'boolean') {
      fail(`${at}.isTestTask must be a boolean (task ${t.id})`)
    }
  })
}

/**
 * @param {{tasks: Array}} input   classified tasks
 * @param {{maxParallel?: number}} opts
 */
export function planWaves(input, opts = {}) {
  validate(input)

  const maxParallel = Number.isInteger(opts.maxParallel) && opts.maxParallel > 0
    ? opts.maxParallel
    : DEFAULT_MAX_PARALLEL

  // Copy so the caller's objects are never mutated by the clamp.
  const tasks = input.tasks.map(t => ({ ...t }))

  const clamped = []
  for (const t of tasks) {
    const record = clampModel(t)
    if (record) clamped.push(record)
  }

  const implTasks = tasks.filter(t => !t.isTestTask)
  const testTasks = tasks.filter(t => t.isTestTask)

  // Waves are the distinct group numbers, ascending. Groups execute in order;
  // tasks inside a group are independent.
  const groups = [...new Set(implTasks.map(t => t.group))].sort((a, b) => a - b)

  const waves = groups.map(group => {
    const groupTasks = implTasks.filter(t => t.group === group)
    return {
      group,
      taskCount: groupTasks.length,
      batches: chunk(groupTasks, maxParallel)
    }
  })

  // Test tasks are deferred to a single trailing wave so that a cross-cutting
  // test failure is diagnosed once, against the finished implementation, rather
  // than repeatedly against half-built state.
  const testWave = testTasks.length
    ? { taskCount: testTasks.length, batches: chunk(testTasks, maxParallel) }
    : null

  const warnings = []
  const widest = waves.reduce((m, w) => Math.max(m, w.taskCount), 0)
  if (widest > maxParallel) {
    warnings.push(
      `widest wave has ${widest} tasks; splitting into batches of ${maxParallel}`
    )
  }
  if (!implTasks.length) warnings.push('no implementation tasks — only test tasks were classified')

  return {
    maxParallel,
    totalTasks: tasks.length,
    implCount: implTasks.length,
    testCount: testTasks.length,
    waveCount: waves.length,
    waves,
    testWave,
    clamped,
    warnings
  }
}

/** Human-readable execution plan, for the skill to echo before it fans out. */
export function formatPlan(plan) {
  const lines = []
  lines.push(
    `${plan.totalTasks} tasks → ${plan.waveCount} wave(s), ` +
      `${plan.implCount} impl + ${plan.testCount} test, max ${plan.maxParallel} parallel`
  )
  for (const wave of plan.waves) {
    const batchNote = wave.batches.length > 1 ? ` in ${wave.batches.length} batches` : ''
    lines.push(`  Wave ${wave.group}: ${wave.taskCount} task(s)${batchNote}`)
    for (const batch of wave.batches) {
      for (const t of batch) lines.push(`    - [${t.model}/T${t.tier}] ${t.id} ${t.description}`)
    }
  }
  if (plan.testWave) {
    lines.push(`  Test wave: ${plan.testWave.taskCount} task(s)`)
    for (const batch of plan.testWave.batches) {
      for (const t of batch) lines.push(`    - [${t.model}/T${t.tier}] ${t.id} ${t.description}`)
    }
  }
  for (const c of plan.clamped) {
    lines.push(`  clamped ${c.id}: ${c.from} → ${c.to} (tier ${c.tier})`)
  }
  for (const w of plan.warnings) lines.push(`  warning: ${w}`)
  return lines.join('\n') + '\n'
}
