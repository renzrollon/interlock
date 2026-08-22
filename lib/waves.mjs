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
// The second half of this file *executes* that plan — as a state machine, not a
// runner. The orchestration is moving into a dynamic-workflow script, which can
// import nothing and has no filesystem, shell or agent access of its own; only
// the agents it spawns do work. So the engine below never spawns an agent,
// never runs a command and never touches fs. It is handed the run state plus
// the result of whatever just happened, and answers one question: what next.
//
// Every transition returns a NEW state and leaves its input untouched. That is
// not stylistic. A resumed run is replayed through the same transitions from
// cached agent results, so an engine that mutated in place would answer
// differently on the replay than it did on the first pass. The returned state is
// deep-frozen and JSON-safe so the property stays honest rather than aspirational.
//
// The caps are not restated here — they are read from `lib/limits.mjs`, because
// a cap written down twice is a cap that drifts. What the failure policy in
// `skills/ship/SKILL.md` describes in prose, this file decides.
//
// Pure: no fs, no agent, no I/O, no clock.
// Exposed to skills as `interlock waves --classified <file>`.

import { randomUUID } from 'node:crypto'

import { LIMITS, clampParallel } from './limits.mjs'
import { canonicalizePath, isDocsPath } from './risk.mjs'

/** Skip reason when a completed wave claimed only documentation paths. */
export const SKIP_VERIFY_DOCS = 'docs-only-wave'
/** Skip reason when LIMITS.interWaveVerifications checkpoints are already spent. */
export const SKIP_VERIFY_CAP = 'verify-cap-reached'

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

/**
 * One task's predicted paths, as canonical identities paired with the spelling
 * its author wrote.
 *
 * THIS IS THE ONLY READER of `task.paths` in this module. The collision key,
 * the changed-file dedup and the docs-only test all go through it, because the
 * defect it closes was never "the collision map used the wrong key" — it was
 * "three readers of one value each did their own thing, and two of them were
 * never looked at". Fixing the reported call site while its siblings stay on
 * the raw form is how the original bug survives its own fix.
 *
 * A path that cannot be placed inside the repository (absolute, or escaping the
 * root) yields `canonical: null`. It is reported, and it never becomes a key:
 * an identity we cannot compute is not an identity that matches nothing.
 *
 * @param {object} task
 * @returns {Array<{authored: string, canonical: string|null}>}
 */
function predictedPaths(task) {
  const raw = task && Array.isArray(task.paths) ? task.paths : []
  const out = []
  for (const authored of raw) {
    if (typeof authored !== 'string' || !authored.trim()) continue
    out.push({ authored, canonical: canonicalizePath(authored) })
  }
  return out
}

/** Every predicted path in a task list that cannot be used as an identity. */
function unusablePaths(tasks) {
  const out = []
  for (const t of tasks) {
    for (const p of predictedPaths(t)) {
      if (p.canonical === null) out.push({ id: t.id, path: p.authored })
    }
  }
  return out
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Hardest first, within a group.
 *
 * Tasks in a group are independent and run in parallel, so this changes nothing
 * until the group is wider than `maxParallel` and gets split into batches. Then
 * it decides which tasks go in batch one — and the tier-5 task is the one whose
 * failure means the design was wrong. Discovering that in the first batch is
 * cheaper than discovering it in the third, after the wave's budget is spent.
 * This is the Boehm/spiral "riskiest first" ordering, applied inside a wave
 * rather than across a release.
 *
 * Tie-break on id so the plan is deterministic: the same classified input must
 * produce the same batches on every run, or nothing downstream is reproducible.
 */
function byHardestFirst(a, b) {
  if (b.tier !== a.tier) return b.tier - a.tier
  return String(a.id).localeCompare(String(b.id))
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
    // `paths` is optional by design. A classifier that cannot predict which
    // files a task will touch must be able to say nothing rather than guess —
    // an invented path would produce a re-group that costs a wave of
    // parallelism for no reason. Shape is checked; content never is.
    if (t.paths !== undefined) {
      if (!Array.isArray(t.paths) || t.paths.some(p => typeof p !== 'string')) {
        fail(`${at}.paths must be an array of strings when present (task ${t.id})`)
      }
    }
  })
}

/**
 * Pack a group's tasks into batches that never co-schedule two tasks claiming
 * the same path, and never exceed maxParallel.
 *
 * Tasks stay in this group. A collision is a later *batch*, not a new wave —
 * ordering is free inside a wave, a wave boundary is a checkpoint.
 *
 * The key is the CANONICAL path, never the authored spelling. Keyed on raw
 * text, this check prevents concurrent writes to one *string*: `src/a.ts` and
 * `./src/a.ts` are two keys for one file, so both tasks join the same batch and
 * one silently overwrites the other. The spelling the author wrote is still
 * what gets reported — a report naming a path the task author does not
 * recognize is a worse report.
 *
 * WHAT THIS DOES NOT DO. `paths` is a model's prediction, so a task that edits
 * a file it never named is still unguarded. This narrows the race; it does not
 * close it.
 */
function collisionAwareChunk(tasks, maxParallel, serialized, group) {
  const remaining = tasks.slice()
  const batches = []
  while (remaining.length) {
    const batch = []
    const claimed = new Map()
    const deferred = []
    for (const t of remaining) {
      const paths = predictedPaths(t)
      const clash = paths.find(p => p.canonical !== null && claimed.has(p.canonical))
      if (clash) {
        serialized.push({
          id: t.id,
          group,
          path: clash.authored,
          conflictsWith: claimed.get(clash.canonical)
        })
        deferred.push(t)
        continue
      }
      if (batch.length >= maxParallel) {
        deferred.push(t)
        continue
      }
      batch.push(t)
      for (const p of paths) if (p.canonical !== null) claimed.set(p.canonical, t.id)
    }
    if (!batch.length) {
      batch.push(remaining[0])
      deferred.length = 0
      deferred.push(...remaining.slice(1))
    }
    batches.push(batch)
    remaining.length = 0
    remaining.push(...deferred)
  }
  return batches
}

/**
 * Every claimed path on every task is documentation.
 *
 * Missing paths → not docs-only, and a path that could not be canonicalized →
 * not docs-only either. "We could not place this file in the repo" is unknown,
 * and unknown is never a reason to skip a verification checkpoint.
 */
export function isDocsOnlyWave(wave) {
  const tasks = (wave && Array.isArray(wave.batches) ? wave.batches : []).flat()
  if (!tasks.length) return false
  for (const t of tasks) {
    const paths = predictedPaths(t)
    if (!paths.length) return false
    if (paths.some(p => p.canonical === null || !isDocsPath(p.canonical))) return false
  }
  return true
}

/**
 * The wave's changed-file set: deduplicated by canonical identity, reported in
 * the spelling each task's author wrote.
 *
 * This feeds `verify plan --changed`. Deduplicating on raw text let one file
 * spelled two ways inflate the changed set a verification is scoped to.
 */
function uniquePaths(wave) {
  const out = []
  const seen = new Set()
  for (const t of (wave && Array.isArray(wave.batches) ? wave.batches : []).flat()) {
    for (const p of predictedPaths(t)) {
      const key = p.canonical === null ? ` raw:${p.authored}` : p.canonical
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p.authored)
    }
  }
  return out
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

  const byGroup = new Map()
  for (const t of implTasks) {
    if (!byGroup.has(t.group)) byGroup.set(t.group, [])
    byGroup.get(t.group).push(t)
  }

  // Waves are the distinct classified group numbers, ascending. Groups execute
  // in order; tasks inside a group that claim the same path become later
  // batches of that wave, not a new group.
  const groups = [...byGroup.keys()].filter(g => byGroup.get(g).length).sort((a, b) => a - b)

  const serialized = []
  const waves = groups.map(group => {
    const groupTasks = byGroup.get(group).slice().sort(byHardestFirst)
    return {
      group,
      taskCount: groupTasks.length,
      batches: collisionAwareChunk(groupTasks, maxParallel, serialized, group)
    }
  })

  // Test tasks are deferred to a single trailing wave so that a cross-cutting
  // test failure is diagnosed once, against the finished implementation, rather
  // than repeatedly against half-built state.
  const testWave = testTasks.length
    ? { taskCount: testTasks.length, batches: chunk(testTasks, maxParallel) }
    : null

  const implCount = implTasks.length
  const warnings = []
  const widest = waves.reduce((m, w) => Math.max(m, w.taskCount), 0)
  if (widest > maxParallel) {
    warnings.push(
      `widest wave has ${widest} tasks; splitting into batches of ${maxParallel}`
    )
  }
  if (implCount >= 2 && waves.length > implCount * 0.5) {
    warnings.push(
      `effectively serial: ${waves.length} waves for ${implCount} implementation tasks`
    )
  }
  if (!implTasks.length) warnings.push('no implementation tasks — only test tasks were classified')

  // Reported at the boundary, never silently dropped: a predicted path that
  // cannot be placed in the repo is not compared against anything, so the task
  // claiming it is unguarded against a collision on that file and the plan has
  // to say so.
  const rejectedPaths = unusablePaths(tasks)
  for (const r of rejectedPaths) {
    warnings.push(
      `task ${r.id} predicted "${r.path}", which is absolute or escapes the repository root — ` +
        `it is not usable as a collision key and was not rewritten into scope`
    )
  }

  for (const m of serialized) {
    warnings.push(
      `task ${m.id} serialized in wave ${m.group}: it claims ${m.path}, already claimed by ${m.conflictsWith}`
    )
  }

  return {
    maxParallel,
    totalTasks: tasks.length,
    implCount,
    testCount: testTasks.length,
    waveCount: waves.length,
    waves,
    testWave,
    clamped,
    serialized,
    rejectedPaths,
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
  for (const m of plan.serialized || []) {
    lines.push(
      `  serialized ${m.id}: later batch in wave ${m.group} (${m.path} held by ${m.conflictsWith})`
    )
  }
  const cost = projectedWaveLoopAgents(plan)
  lines.push(
    `projected agents: ${cost.total} ` +
      `(${cost.implementers} implementers + ${cost.recordPings} record + ${cost.verifyPings} verify)`
  )
  for (const w of plan.warnings) lines.push(`  warning: ${w}`)
  return lines.join('\n') + '\n'
}

/** Wave-loop agent bill: implementers + one record ping per wave + capped verifies. */
export function projectedWaveLoopAgents(plan) {
  const implWaves = Array.isArray(plan.waves) ? plan.waves : []
  const testWaves = plan.testWave ? [plan.testWave] : []
  const allWaves = [...implWaves, ...testWaves]
  const implementers = plan.totalTasks
  const recordPings = allWaves.length
  let verifyEligible = 0
  for (let i = 0; i < allWaves.length - 1; i++) {
    if (!isDocsOnlyWave(allWaves[i])) verifyEligible += 1
  }
  const verifyPings = Math.min(LIMITS.interWaveVerifications, verifyEligible)
  return { implementers, recordPings, verifyPings, total: implementers + recordPings + verifyPings }
}

// ---------------------------------------------------------------------------
// Execution state machine
// ---------------------------------------------------------------------------
//
// The walk is: for each wave in order, run its batches one after another (the
// tasks inside a batch are what the caller fans out in parallel); when a wave
// ends and another wave follows, verify before starting it. Verification only
// ever runs *between* waves, because the one question it answers — "do these
// errors block the next wave?" — is meaningless when there is no next wave. The
// full suite after the trailing test wave is a separate step the caller owns.

/** Why a run stopped. Callers branch on these, so they are constants. */
export const HALT_TASK_FAILURES = 'task-failures'
export const HALT_INTER_WAVE_VERIFY = 'inter-wave-verify'

// ---------------------------------------------------------------------------
// Wave handoff
// ---------------------------------------------------------------------------
//
// What one wave tells the next. Before this existed the next wave inferred it
// from `git log` plus a mutable state file, which is a reconstruction, not a
// report — and a reconstruction cannot be validated, bounded or refused.
//
// So it is a schema with a character cap, and it fails closed. A packet that is
// missing, malformed or over budget fails its task; it is never truncated and
// never passed through as prose for the next wave to interpret. Truncation is
// the exact silent degradation this replaces.

/** Version tag on every stored packet, so a later shape change is detectable. */
export const HANDOFF_SCHEMA = 'interlock.wave-handoff/1'

const HANDOFF_STATUSES = new Set(['ok', 'blocked', 'partial'])

/** Evidence is a locator, not a file body: `path`, `path:12`, `path:12-40`. */
const EVIDENCE_LOCATOR = /^[^\s:]+(:\d+(-\d+)?)?$/
const MAX_EVIDENCE = 8

function handoffError(reason) {
  return { ok: false, error: reason }
}

/**
 * Check one task's handoff packet. Pure — no state, no clock, no I/O.
 *
 * @param {string} taskId the id the packet must be reporting on
 * @param {unknown} packet
 * @returns {{ok: true, handoff: object} | {ok: false, error: string}}
 */
export function validateHandoff(taskId, packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return handoffError('handoff must be an object')
  }

  // `schema` is defaulted rather than demanded. A model that drops a constant
  // string it was shown verbatim has not told us anything about its work, and
  // failing the whole task over it would throw away a valid report. A *wrong*
  // version is different — that is a packet written against another contract.
  const schema = packet.schema === undefined ? HANDOFF_SCHEMA : packet.schema
  if (schema !== HANDOFF_SCHEMA) {
    return handoffError(`unknown handoff schema "${schema}" (expected ${HANDOFF_SCHEMA})`)
  }

  if (typeof packet.taskId !== 'string' || packet.taskId !== taskId) {
    return handoffError(`taskId must be "${taskId}", got ${JSON.stringify(packet.taskId)}`)
  }

  if (!HANDOFF_STATUSES.has(packet.status)) {
    return handoffError(
      `status must be one of ${[...HANDOFF_STATUSES].join('|')}, got ${JSON.stringify(packet.status)}`
    )
  }

  if (typeof packet.summary !== 'string' || !packet.summary.trim()) {
    return handoffError('summary must be a non-empty string')
  }
  if (typeof packet.next !== 'string' || !packet.next.trim()) {
    return handoffError('next must be a non-empty string')
  }

  const blocker = packet.blocker === undefined ? null : packet.blocker
  if (packet.status === 'ok') {
    if (blocker !== null) return handoffError('status "ok" must have a null blocker')
  } else if (typeof blocker !== 'string' || !blocker.trim()) {
    return handoffError(`status "${packet.status}" must have a non-empty blocker`)
  }

  const evidence = packet.evidence === undefined ? [] : packet.evidence
  if (!Array.isArray(evidence)) return handoffError('evidence must be an array of locators')
  if (evidence.length > MAX_EVIDENCE) {
    return handoffError(`evidence has ${evidence.length} entries; at most ${MAX_EVIDENCE} are allowed`)
  }
  for (const entry of evidence) {
    if (typeof entry !== 'string' || !EVIDENCE_LOCATOR.test(entry)) {
      return handoffError(
        `evidence entry ${JSON.stringify(entry)} is not a locator (path, path:line or path:start-end)`
      )
    }
  }

  const counted =
    packet.summary.length + packet.next.length + (blocker || '').length + evidence.join('\n').length
  if (counted > LIMITS.maxHandoffChars) {
    return handoffError(
      `handoff is ${counted} characters; the cap is ${LIMITS.maxHandoffChars} ` +
        `(shorten it — it is never truncated for you)`
    )
  }

  // Rebuilt rather than spread, so unknown keys are dropped instead of stored.
  return {
    ok: true,
    handoff: {
      schema: HANDOFF_SCHEMA,
      taskId,
      status: packet.status,
      summary: packet.summary,
      evidence: evidence.slice(),
      next: packet.next,
      blocker: packet.status === 'ok' ? null : blocker
    }
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

// Clone through JSON rather than by hand: it deep-copies, it strips anything a
// state could not survive being persisted and rehydrated as, and it guarantees
// no object the caller still holds ends up inside — or frozen by — a new state.
function cloneState(state) {
  return JSON.parse(JSON.stringify(state))
}

function finalize(state) {
  return deepFreeze(cloneState(state))
}

function requireState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.waves) || !state.cursor) {
    fail('run state must be the object returned by createRunState')
  }
  return state
}

function mutable(state) {
  requireState(state)
  if (state.halt) {
    fail(`run has halted (${state.halt.reason}); no further results can be recorded`)
  }
  return cloneState(state)
}

/** "wave 2" / "the test wave" — used in every reason string, so it lives once. */
function label(wave) {
  if (!wave) return 'the end of the run'
  return wave.kind === 'test' ? 'the test wave' : `wave ${wave.group}`
}

function makeWave(kind, group, tasks, maxParallel) {
  const serialized = []
  return {
    kind,
    group,
    taskCount: tasks.length,
    batches: collisionAwareChunk(tasks, maxParallel, serialized, group)
  }
}

// Accept a wave straight out of planWaves. Re-split only to fit this run's
// maxParallel ceiling — never merge collision batches back together. A higher
// runtime cap is not permission to co-schedule two tasks that claim one file.
function adoptWave(wave, kind, index, maxParallel, warnings) {
  if (!wave || typeof wave !== 'object') fail(`plan wave ${index} must be an object`)
  if (!Array.isArray(wave.batches)) fail(`plan wave ${index} must have a "batches" array`)
  wave.batches.forEach((batch, i) => {
    if (!Array.isArray(batch)) fail(`plan wave ${index} batch ${i} must be an array of tasks`)
  })
  const group = kind === 'test' ? null : wave.group
  if (kind !== 'test' && !Number.isInteger(group)) {
    fail(`plan wave ${index} must have an integer "group"`)
  }
  const tasks = wave.batches.flat()
  if (wave.batches.some(b => b.length > maxParallel)) {
    warnings.push(
      `${label({ kind, group })}: batches wider than ${maxParallel} were re-split to fit the cap`
    )
  }
  return makeWave(kind, group, tasks, maxParallel)
}

function validateTasks(tasks, where) {
  if (!Array.isArray(tasks)) fail(`${where} must be an array of tasks`)
  tasks.forEach((t, i) => {
    if (!t || typeof t !== 'object') fail(`${where}[${i}] must be an object`)
    if (typeof t.id !== 'string' || !t.id.trim()) {
      fail(`${where}[${i}].id must be a non-empty string`)
    }
  })
  return tasks
}

/**
 * Start a run from a plan.
 *
 * @param {ReturnType<typeof planWaves>} plan
 * @param {{maxParallel?: number}} [opts] runtime override; clamped by
 *   `clampParallel`, because over-asking is a preference, not a mistake.
 * @returns {object} a frozen, JSON-safe run state
 */
export function createRunState(plan, opts = {}) {
  if (!plan || typeof plan !== 'object') fail('createRunState needs the plan object from planWaves')
  if (!Array.isArray(plan.waves)) fail('plan must have a "waves" array — pass the output of planWaves')
  if (plan.testWave != null && typeof plan.testWave !== 'object') {
    fail('plan.testWave must be an object or null')
  }

  const requested = Number.isInteger(opts.maxParallel) ? opts.maxParallel : plan.maxParallel
  const { value: maxParallel, clamped, reason } = clampParallel(requested)

  const warnings = []
  if (clamped) warnings.push(`max parallel reduced to ${maxParallel}: ${reason}`)

  const waves = plan.waves.map((w, i) => adoptWave(w, 'impl', i, maxParallel, warnings))
  if (plan.testWave) {
    waves.push(adoptWave(plan.testWave, 'test', waves.length, maxParallel, warnings))
  }

  return finalize({
    // Stable id for this run, stored on the frozen state so every later
    // wave-state call (and --write-state into .claude/ship/state.json) can
    // find it without a new flag.
    runId: randomUUID(),
    maxParallel,
    waves: waves.filter(w => w.batches.length > 0),
    // Where the walk is. `phase` is 'batch' while the wave at waveIndex still
    // has batches to run, 'verify' once it is finished and another wave follows.
    cursor: { waveIndex: 0, batchIndex: 0, phase: 'batch' },
    // Consecutive failed checks for the wave at the cursor: 0 means the check
    // has not run yet, N means N fix attempts have been consumed.
    verifyFailures: 0,
    lastVerifyErrors: [],
    replansUsed: 0,
    replanPending: false,
    // Groups with at least one recorded batch result. Replan is measured
    // against this, not against the cursor: a wave the cursor has reached but
    // nothing has been recorded for has not executed.
    executedGroups: [],
    // Validated per-task packets, keyed by task id. `nextStep` hands the
    // previous wave's back to the caller so a fresh implementer is given a
    // report rather than left to reconstruct one from git.
    handoffs: {},
    completed: [],
    failures: [],
    unresolved: [],
    skippedVerifications: [],
    verificationsUsed: 0,
    warnings,
    halt: null
  })
}

/**
 * What should happen next. Pure — call it as often as you like.
 *
 * @returns {{action: 'run-batch'|'test-wave'|'verify'|'replan'|'done'|'halt'}}
 */
export function nextStep(state) {
  requireState(state)

  if (state.halt) {
    return {
      action: 'halt',
      kind: state.halt.kind,
      reason: state.halt.reason,
      failures: state.failures,
      unresolved: state.unresolved
    }
  }

  const { waveIndex, batchIndex, phase } = state.cursor
  const wave = state.waves[waveIndex]
  if (!wave) return { action: 'done', summary: summarize(state) }

  const following = state.waves[waveIndex + 1] || null

  if (phase === 'verify') {
    const used = state.verifyFailures
    return {
      action: 'verify',
      wave: wave.group,
      waveIndex,
      waveKind: wave.kind,
      mode: used === 0 ? 'initial' : 'fix',
      fixAttempt: used,
      fixAttemptsRemaining: Math.max(0, LIMITS.interWaveFixAttempts - used),
      errors: state.lastVerifyErrors,
      nextWave: following ? following.group : null,
      nextWaveKind: following ? following.kind : null,
      changed: uniquePaths(wave)
    }
  }

  // Replan is offered only at a wave boundary — revising a group mid-wave would
  // mean revising work already in flight.
  if (batchIndex === 0 && state.replanPending) {
    const revisable = revisableGroups(state)
    if (state.replansUsed < LIMITS.replansPerRun && revisable.length) {
      return {
        action: 'replan',
        revisableGroups: revisable,
        replansUsed: state.replansUsed,
        replansRemaining: LIMITS.replansPerRun - state.replansUsed
      }
    }
  }

  return {
    action: wave.kind === 'test' ? 'test-wave' : 'run-batch',
    wave: wave.group,
    waveIndex,
    waveKind: wave.kind,
    batchIndex,
    batchCount: wave.batches.length,
    tasks: wave.batches[batchIndex],
    remainingBatches: wave.batches.slice(batchIndex),
    previousHandoffs: previousWaveHandoffs(state, waveIndex),
    // The wave's changed-file set, canonically deduplicated. A caller that
    // fuses the inter-wave verify plan into the record-batch ping (ship.js
    // does) needs it here, and recomputing it from raw `task.paths` is how
    // duplicate spellings inflate the set a verification is scoped to.
    changed: uniquePaths(wave),
    maxParallel: state.maxParallel
  }
}

/**
 * The packets recorded by the wave immediately before this one.
 *
 * Immediately before, and nothing else. Accumulating every earlier wave would
 * grow without bound and bury the one report that is actually load-bearing.
 * Earlier batches of the *current* wave are excluded too: `remainingBatches`
 * hands the caller a whole wave from one step, so every batch in it must see
 * the same input — a batch that saw its predecessor's handoff would be running
 * under a different contract than the batch beside it.
 */
function previousWaveHandoffs(state, waveIndex) {
  const previous = state.waves[waveIndex - 1]
  if (!previous) return []
  const stored = state.handoffs && typeof state.handoffs === 'object' ? state.handoffs : {}
  const out = []
  for (const t of (Array.isArray(previous.batches) ? previous.batches : []).flat()) {
    const packet = stored[t.id]
    if (packet) out.push(packet)
  }
  return out
}

// Groups a replan may still touch: implementation waves at or after the first
// index the cursor has not committed to, minus anything already executed.
function firstMutableIndex(state) {
  const { waveIndex, batchIndex, phase } = state.cursor
  if (phase === 'verify' || batchIndex > 0) return waveIndex + 1
  return waveIndex
}

function revisableGroups(state) {
  const from = firstMutableIndex(state)
  return state.waves
    .filter((w, i) => i >= from && w.kind === 'impl' && !state.executedGroups.includes(w.group))
    .map(w => w.group)
}

function normalizeTaskResults(result) {
  if (!result || typeof result !== 'object') fail('batch result must be an object')
  if (!Array.isArray(result.tasks)) {
    fail('batch result must have a "tasks" array of { id, ok }')
  }
  return result.tasks.map((t, i) => {
    const at = `batch result tasks[${i}]`
    if (!t || typeof t !== 'object') fail(`${at} must be an object`)
    if (typeof t.id !== 'string' || !t.id.trim()) fail(`${at}.id must be a non-empty string`)
    if (typeof t.ok !== 'boolean') fail(`${at}.ok must be a boolean (task ${t.id})`)
    const error = typeof t.error === 'string' ? t.error : null
    const checked = validateHandoff(t.id, t.handoff)

    // A task that already reported failure does not owe a packet. ship.js turns
    // a null agent result into ok:false with no handoff, and rewriting that as
    // an invalid-handoff error would replace the reason it actually failed with
    // a complaint about the report it was never in a position to write. A valid
    // packet on a failed task is still kept — a blocked task's blocker is the
    // most useful thing the next wave could be handed.
    if (!t.ok) return { id: t.id, ok: false, error, handoff: checked.ok ? checked.handoff : null }

    // Claiming success is what obliges a report. Fail closed.
    if (!checked.ok) {
      return { id: t.id, ok: false, error: `invalid handoff: ${checked.error}`, handoff: null }
    }
    return { id: t.id, ok: true, error, handoff: checked.handoff }
  })
}

function advanceWave(state) {
  state.cursor = { waveIndex: state.cursor.waveIndex + 1, batchIndex: 0, phase: 'batch' }
  state.verifyFailures = 0
  state.lastVerifyErrors = []
  return state
}

/**
 * Record the outcome of the batch `nextStep` last asked for.
 *
 * @param {object} state
 * @param {{tasks: Array<{id: string, ok: boolean, error?: string}>,
 *          replanSuggested?: boolean}} result
 * @returns {object} a new state; `state` is left untouched
 */
export function recordBatchResult(state, result) {
  const next = mutable(state)
  const wave = next.waves[next.cursor.waveIndex]
  if (!wave || next.cursor.phase !== 'batch') {
    fail('recordBatchResult called while the run is not waiting on a batch — ask nextStep first')
  }

  const tasks = normalizeTaskResults(result)
  // An in-flight state.json written before handoffs existed has no such key.
  if (!next.handoffs || typeof next.handoffs !== 'object') next.handoffs = {}
  for (const t of tasks) {
    if (t.handoff) next.handoffs[t.id] = t.handoff
    if (t.ok) next.completed.push(t.id)
    else {
      next.failures.push({
        id: t.id,
        wave: wave.group,
        waveKind: wave.kind,
        error: t.error
      })
    }
  }

  if (wave.kind === 'impl' && !next.executedGroups.includes(wave.group)) {
    next.executedGroups.push(wave.group)
  }
  if (result.replanSuggested === true) next.replanPending = true

  next.cursor.batchIndex += 1
  if (next.cursor.batchIndex >= wave.batches.length) {
    if (next.waves[next.cursor.waveIndex + 1]) {
      const used = Number.isInteger(next.verificationsUsed) ? next.verificationsUsed : 0
      if (isDocsOnlyWave(wave)) {
        next.skippedVerifications.push({
          wave: wave.group,
          waveKind: wave.kind,
          reason: SKIP_VERIFY_DOCS
        })
        advanceWave(next)
      } else if (used >= LIMITS.interWaveVerifications) {
        next.skippedVerifications.push({
          wave: wave.group,
          waveKind: wave.kind,
          reason: SKIP_VERIFY_CAP
        })
        advanceWave(next)
      } else {
        next.cursor.phase = 'verify'
        next.verificationsUsed = used + 1
        next.verifyFailures = 0
        next.lastVerifyErrors = []
      }
    } else {
      advanceWave(next)
    }
  }

  // Checked last, so the failures that tripped the cap are already in the state
  // the halt is reported from. The trailing test wave counts like any other.
  if (next.failures.length > LIMITS.taskFailureHalt) {
    next.halt = {
      kind: HALT_TASK_FAILURES,
      reason:
        `${next.failures.length} task failures accumulated across waves; ` +
        `more than ${LIMITS.taskFailureHalt} halts the run`
    }
  }

  return finalize(next)
}

function normalizeErrors(errors) {
  if (!Array.isArray(errors)) return []
  return errors.filter(e => typeof e === 'string' && e.trim())
}

/**
 * Record the outcome of an inter-wave check.
 *
 * A failure buys up to `LIMITS.interWaveFixAttempts` targeted fix attempts for
 * that wave. When those are spent the errors are logged and the run halts if
 * the caller says they block the next wave, or continues with a warning if not.
 * Whether they block is an input, never an inference: only the caller can see
 * what the next wave is about to touch.
 *
 * @param {object} state
 * @param {{ok?: boolean, errors?: string[], blocksNextWave?: boolean,
 *          skipped?: boolean, reason?: string, replanSuggested?: boolean}} result
 * @returns {object} a new state; `state` is left untouched
 */
export function recordVerifyResult(state, result) {
  const next = mutable(state)
  if (next.cursor.phase !== 'verify') {
    fail('recordVerifyResult called while the run is not waiting on a check — ask nextStep first')
  }
  if (!result || typeof result !== 'object') fail('verify result must be an object')

  const wave = next.waves[next.cursor.waveIndex]
  const following = next.waves[next.cursor.waveIndex + 1] || null
  if (result.replanSuggested === true) next.replanPending = true

  // A skip is a legitimate outcome — no detectable commands, pre-existing
  // failures, over budget — but it is never silent: the reason is the banner.
  if (result.skipped === true) {
    const reason = typeof result.reason === 'string' ? result.reason.trim() : ''
    if (!reason) fail('a skipped verify result must carry a non-empty "reason"')
    next.skippedVerifications.push({ wave: wave.group, waveKind: wave.kind, reason })
    return finalize(advanceWave(next))
  }

  if (typeof result.ok !== 'boolean') {
    fail('verify result must have a boolean "ok" (or skipped: true with a reason)')
  }
  if (result.ok) return finalize(advanceWave(next))

  const errors = normalizeErrors(result.errors)
  next.verifyFailures += 1
  next.lastVerifyErrors = errors

  // Still inside the fix budget: the next step is another targeted fix and a
  // re-run of the failing check.
  if (next.verifyFailures <= LIMITS.interWaveFixAttempts) return finalize(next)

  const blocks = result.blocksNextWave === true
  next.unresolved.push({
    wave: wave.group,
    waveKind: wave.kind,
    attempts: LIMITS.interWaveFixAttempts,
    errors,
    blockedNextWave: blocks
  })

  if (blocks) {
    next.halt = {
      kind: HALT_INTER_WAVE_VERIFY,
      reason:
        `inter-wave checks after ${label(wave)} still failing after ` +
        `${LIMITS.interWaveFixAttempts} fix attempts, and the caller reported the ` +
        `errors block ${label(following)}`
    }
    return finalize(next)
  }

  next.warnings.push(
    `${label(wave)}: ${errors.length} unresolved error(s) after ` +
      `${LIMITS.interWaveFixAttempts} fix attempts; continuing — reported as not blocking ` +
      `${label(following)}`
  )
  return finalize(advanceWave(next))
}

/**
 * Revise groups that have not executed yet.
 *
 * Revising a group that has already run is a user-facing error rather than a
 * quietly-ignored request: the caller believes it changed the plan, and a run
 * that says otherwise only in a log has already misled it.
 *
 * @param {object} state
 * @param {Array<{group: number, tasks: Array}>} revisedGroups
 *   an empty `tasks` array drops that group's wave
 * @returns {object} a new state; `state` is left untouched
 */
export function applyReplan(state, revisedGroups) {
  const next = mutable(state)
  if (!Array.isArray(revisedGroups) || !revisedGroups.length) {
    fail('applyReplan needs a non-empty array of { group, tasks } revisions')
  }
  if (next.replansUsed >= LIMITS.replansPerRun) {
    fail(
      `replan cap reached: ${LIMITS.replansPerRun} replans per run, ` +
        `${next.replansUsed} already used`
    )
  }

  // Validate every revision before applying any of them, so a rejected replan
  // leaves the run exactly where it was.
  for (const revision of revisedGroups) {
    if (!revision || typeof revision !== 'object') fail('each revision must be an object')
    if (!Number.isInteger(revision.group)) {
      fail('each revision must name an integer "group"; the trailing test wave cannot be replanned')
    }
    if (next.executedGroups.includes(revision.group)) {
      fail(`cannot replan group ${revision.group}: it has already executed`)
    }
    validateTasks(revision.tasks, `revision for group ${revision.group}: "tasks"`)
  }

  for (const revision of revisedGroups) {
    const from = firstMutableIndex(next)
    const at = next.waves.findIndex(w => w.kind === 'impl' && w.group === revision.group)

    if (at >= 0) {
      if (at < from) fail(`cannot replan group ${revision.group}: it has already executed`)
      if (!revision.tasks.length) next.waves.splice(at, 1)
      else next.waves[at] = makeWave('impl', revision.group, revision.tasks, next.maxParallel)
      continue
    }

    if (!revision.tasks.length) continue // dropping a group that is not there
    if (from >= next.waves.length && from > 0) {
      fail(`cannot replan group ${revision.group}: the run has no unexecuted groups left`)
    }
    // A group the plan never had is inserted in ascending order, but never
    // before the cursor and never after the trailing test wave.
    let insertAt = next.waves.length
    for (let i = from; i < next.waves.length; i++) {
      const w = next.waves[i]
      if (w.kind === 'test' || w.group > revision.group) {
        insertAt = i
        break
      }
    }
    next.waves.splice(insertAt, 0, makeWave('impl', revision.group, revision.tasks, next.maxParallel))
  }

  next.replansUsed += 1
  next.replanPending = false
  return finalize(next)
}

function summarize(state) {
  return {
    waves: state.waves.length,
    tasksCompleted: state.completed.length,
    taskFailures: state.failures.length,
    replansUsed: state.replansUsed,
    unresolved: state.unresolved,
    skippedVerifications: state.skippedVerifications,
    verificationsUsed: state.verificationsUsed || 0,
    warnings: state.warnings
  }
}

function describeStep(step) {
  switch (step.action) {
    case 'run-batch':
      return `run wave ${step.wave} batch ${step.batchIndex + 1}/${step.batchCount} ` +
        `(${step.tasks.length} task(s), max ${step.maxParallel} parallel)`
    case 'test-wave':
      return `run the test wave, batch ${step.batchIndex + 1}/${step.batchCount} ` +
        `(${step.tasks.length} task(s))`
    case 'verify':
      return step.mode === 'initial'
        ? `verify after ${step.waveKind === 'test' ? 'the test wave' : `wave ${step.wave}`}`
        : `fix and re-verify (attempt ${step.fixAttempt} of ${LIMITS.interWaveFixAttempts})`
    case 'replan':
      return `replan available for group(s) ${step.revisableGroups.join(', ')} ` +
        `(${step.replansRemaining} left)`
    case 'halt':
      return `HALTED — ${step.reason}`
    default:
      return 'done'
  }
}

/** Human-readable run state, for the skill to echo between steps. */
export function formatRunState(state) {
  requireState(state)
  const step = nextStep(state)
  const lines = []
  lines.push(
    `run: ${state.completed.length} task(s) done, ${state.failures.length} failed ` +
      `(halts above ${LIMITS.taskFailureHalt}), ` +
      `${state.replansUsed}/${LIMITS.replansPerRun} replans used`
  )
  lines.push(`  next: ${describeStep(step)}`)
  for (const f of state.failures) {
    lines.push(
      `  failed ${f.id} in ${label({ kind: f.waveKind, group: f.wave })}` +
        (f.error ? `: ${f.error}` : '')
    )
  }
  for (const u of state.unresolved) {
    lines.push(
      `  unresolved after ${label({ kind: u.waveKind, group: u.wave })}: ` +
        `${u.errors.length} error(s) after ${u.attempts} fix attempts` +
        (u.blockedNextWave ? ' (blocked the next wave)' : ' (did not block the next wave)')
    )
  }
  for (const s of state.skippedVerifications) {
    lines.push(`  VERIFICATION SKIPPED: reason=${s.reason}`)
  }
  for (const w of state.warnings) lines.push(`  warning: ${w}`)
  if (state.halt) lines.push(`HALTED: ${state.halt.reason}`)
  return lines.join('\n') + '\n'
}
