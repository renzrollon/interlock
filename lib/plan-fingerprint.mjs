// Plan reuse: proof that a stored execution plan still describes the same work.
//
// `plan-waves` is the most expensive fixed step of a ship run — it reads
// proposal.md, design.md, tasks.md and every delta spec in full — and it used to
// re-run unconditionally, including on a run whose plan was already sitting in
// `.claude/ship/plan.json` from ten minutes earlier. That cost is only avoidable
// if a caller can PROVE the plan is still current, so this module computes a
// fingerprint over the plan's inputs and compares a stored one against a fresh
// one.
//
// Two properties are load-bearing, and both are about failing in the right
// direction:
//
//   1. Checkbox markers are normalized before hashing. Without that, the first
//      `interlock tasks tick` invalidates the plan and reuse never fires after
//      wave 1. Only the marker is normalized — every other byte of a task line
//      is hashed as written, so adding, removing, reordering or rewording a task
//      still invalidates.
//
//   2. Nothing here ever throws in a way a caller could read as a match. A
//      missing plan, an unreadable fingerprint, a plan written for another
//      format, an unparseable file, or any error at all resolves to a NAMED
//      no-reuse outcome. The fallback is running the classifier, which is what
//      happens today, so the degraded path costs exactly what the current path
//      always costs — and never yields a wrong plan.
//
// Note the direction differs from `interlock ready`: there, failing closed means
// refusing to proceed. Here it means doing the expensive-but-correct thing,
// which is why reuse can default on without a flag.
//
// Exposed to skills as `interlock plan fingerprint` / `interlock plan reuse`.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { inspectChange, normalizeTaskMarkers, taskMatchesId } from './artifacts.mjs'
import { LIMITS } from './limits.mjs'

/**
 * The shape of the plan this reader understands.
 *
 * Separate from the content hash on purpose: a plan can be perfectly current
 * and still be shaped for a reader that no longer exists. `/1` was the plan
 * whose batches held tasks; `/2` is the plan whose batches hold lanes. A stored
 * plan carrying another version is not reused however well its inputs match.
 */
export const PLAN_FORMAT = 'interlock.ship-plan/2'

/** Where the plan and its fingerprint live — machine-local and gitignored. */
export const PLAN_PATH = '.claude/ship/plan.json'
export const FINGERPRINT_PATH = '.claude/ship/plan-fingerprint.json'
/** Default destination for the narrowed copy, so the source is never clobbered. */
export const NARROWED_PLAN_PATH = '.claude/ship/plan-reuse.json'

// Every way this can end, named. A bare boolean would collapse "no plan yet"
// and "the plan changed under us" into one answer, and the run summary has to
// say which — per docs/06-why-it-works.md §13, a run that silently changed its
// own cost is the failure the banner block exists to remove.
export const REUSE_MATCH = 'match'
export const REUSE_MISMATCH = 'inputs-changed'
export const REUSE_NO_PLAN = 'no-plan'
export const REUSE_NO_FINGERPRINT = 'no-fingerprint'
export const REUSE_UNREADABLE_PLAN = 'unreadable-plan'
export const REUSE_UNREADABLE_FINGERPRINT = 'unreadable-fingerprint'
export const REUSE_FORMAT_VERSION = 'plan-format-changed'
export const REUSE_ERROR = 'check-failed'

/** The artifacts a plan is derived from, in the order they are hashed. */
const CORE_ARTIFACTS = ['proposal.md', 'design.md', 'tasks.md']

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function abs(root, relPosix) {
  return join(root, ...relPosix.split('/'))
}

// tasks.md is hashed through the marker normalizer; everything else is hashed as
// written. A file that cannot be read is recorded with a null digest rather than
// skipped: "this file is gone" has to change the fingerprint, and skipping it
// would make a deleted spec look like a plan that still matches.
function digestOf(path, rel) {
  try {
    const raw = readFileSync(path, 'utf8')
    const text = rel === 'tasks.md' ? normalizeTaskMarkers(raw) : raw
    return { path: rel, sha256: sha256(text), bytes: Buffer.byteLength(raw, 'utf8') }
  } catch (err) {
    return { path: rel, sha256: null, bytes: null, unreadable: err.message }
  }
}

function capsOf(opts = {}) {
  const requested = opts.maxParallel
  return {
    maxParallel:
      Number.isInteger(requested) && requested > 0 ? requested : LIMITS.maxParallel,
    maxTasksPerAgent: LIMITS.maxTasksPerAgent
  }
}

/**
 * Fingerprint the inputs a plan for `change` would be derived from.
 *
 * Pure apart from reading the change directory. Never throws: an unreadable
 * change resolves to `ok:false` with a reason, because the caller's only correct
 * response to "we could not compute this" is to re-plan, and an exception makes
 * that decision harder rather than easier.
 *
 * @param {string} root repo root
 * @param {string} change OpenSpec change name
 * @param {{maxParallel?: number}} [opts]
 */
export function computeFingerprint(root = '.', change, opts = {}) {
  const caps = capsOf(opts)
  const base = {
    planFormat: PLAN_FORMAT,
    change: typeof change === 'string' ? change : null,
    ...caps
  }
  try {
    if (!base.change) {
      return { ...base, ok: false, hash: null, inputs: [], problems: ['no change name given'] }
    }
    const info = inspectChange(root, base.change)
    if (!info.exists) {
      return {
        ...base,
        ok: false,
        hash: null,
        inputs: [],
        problems: [`change directory does not exist: ${info.path}`]
      }
    }

    const inputs = []
    for (const rel of CORE_ARTIFACTS) inputs.push(digestOf(join(info.path, rel), rel))
    // `specFiles` is already sorted by inspectChange, so the hash does not
    // depend on directory-read order.
    for (const rel of info.specFiles) {
      inputs.push(digestOf(join(info.path, 'specs', rel), `specs/${rel}`))
    }

    // The canonical text the hash is taken over. Written out line by line rather
    // than JSON.stringify'd so the ordering is visible here instead of implied
    // by key insertion order somewhere else.
    const canonical = [
      `plan-format ${PLAN_FORMAT}`,
      `change ${base.change}`,
      `max-parallel ${caps.maxParallel}`,
      `max-tasks-per-agent ${caps.maxTasksPerAgent}`,
      ...inputs.map(i => `${i.path} ${i.sha256 === null ? 'ABSENT' : i.sha256}`)
    ].join('\n')

    const problems = inputs.filter(i => i.sha256 === null).map(i => `unreadable: ${i.path}`)
    return { ...base, ok: true, hash: sha256(canonical), inputs, problems }
  } catch (err) {
    return {
      ...base,
      ok: false,
      hash: null,
      inputs: [],
      problems: [`could not fingerprint the change: ${err && err.message ? err.message : err}`]
    }
  }
}

/**
 * Store a fingerprint beside the plan it belongs to.
 *
 * Reported, never thrown: losing the fingerprint costs a classifier run on the
 * next invocation, which is the price of the behaviour that exists today. It is
 * not worth failing the run that just produced a valid plan.
 */
export function writeFingerprint(root = '.', fingerprint, opts = {}) {
  const rel = typeof opts.path === 'string' && opts.path.trim() ? opts.path.trim() : FINGERPRINT_PATH
  const dest = abs(root, rel)
  try {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, JSON.stringify(fingerprint, null, 2) + '\n')
    return { written: true, path: rel, reason: null }
  } catch (err) {
    return { written: false, path: rel, reason: err && err.message ? err.message : String(err) }
  }
}

/** A plan whose batches hold LANES (arrays of tasks), which is format /2. */
function isLanePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.waves)) return false
  const waves = plan.testWave ? [...plan.waves, plan.testWave] : plan.waves
  for (const wave of waves) {
    if (!wave || !Array.isArray(wave.batches)) return false
    for (const batch of wave.batches) {
      if (!Array.isArray(batch)) return false
      for (const lane of batch) {
        if (!Array.isArray(lane)) return false
        for (const t of lane) if (!t || typeof t !== 'object' || typeof t.id !== 'string') return false
      }
    }
  }
  return true
}

function noReuse(status, reason, extra = {}) {
  return { reuse: false, status, reason, plan: null, ...extra }
}

/**
 * Decide whether the stored plan for `change` may be reused.
 *
 * Returns `{reuse, status, reason, plan, stored, current}`. `status` is one of
 * the REUSE_* constants above — a named outcome, never a bare boolean, so the
 * summary can report WHY it re-planned and a caller cannot confuse "we could not
 * tell" with "it matches".
 */
export function checkPlanReuse(root = '.', change, opts = {}) {
  const planRel = typeof opts.planPath === 'string' && opts.planPath.trim() ? opts.planPath.trim() : PLAN_PATH
  const fpRel =
    typeof opts.fingerprintPath === 'string' && opts.fingerprintPath.trim()
      ? opts.fingerprintPath.trim()
      : FINGERPRINT_PATH
  const paths = { planPath: planRel, fingerprintPath: fpRel, expectedFormat: PLAN_FORMAT }

  try {
    const planAbs = abs(root, planRel)
    const fpAbs = abs(root, fpRel)

    if (!existsSync(planAbs)) {
      return noReuse(REUSE_NO_PLAN, `no stored plan at ${planRel}`, paths)
    }
    if (!existsSync(fpAbs)) {
      return noReuse(
        REUSE_NO_FINGERPRINT,
        `a plan exists at ${planRel} but no fingerprint at ${fpRel}, so its provenance is unknown`,
        paths
      )
    }

    let stored
    try {
      stored = JSON.parse(readFileSync(fpAbs, 'utf8'))
    } catch (err) {
      return noReuse(
        REUSE_UNREADABLE_FINGERPRINT,
        `the stored fingerprint at ${fpRel} could not be read: ${err.message}`,
        paths
      )
    }
    if (!stored || typeof stored !== 'object' || typeof stored.hash !== 'string') {
      return noReuse(
        REUSE_UNREADABLE_FINGERPRINT,
        `the stored fingerprint at ${fpRel} carries no hash`,
        paths
      )
    }

    let plan
    try {
      plan = JSON.parse(readFileSync(planAbs, 'utf8'))
    } catch (err) {
      return noReuse(
        REUSE_UNREADABLE_PLAN,
        `the stored plan at ${planRel} could not be read: ${err.message}`,
        paths
      )
    }

    // Checked BEFORE the hash, and reported as its own outcome: a plan whose
    // inputs match perfectly is still unusable if it is shaped for a reader that
    // no longer exists.
    if (stored.planFormat !== PLAN_FORMAT) {
      return noReuse(
        REUSE_FORMAT_VERSION,
        `the stored plan was written for ${JSON.stringify(stored.planFormat)} and this run reads ` +
          `${PLAN_FORMAT}`,
        { ...paths, stored }
      )
    }
    if (!isLanePlan(plan)) {
      return noReuse(
        REUSE_UNREADABLE_PLAN,
        `the stored plan at ${planRel} does not hold lanes, so it is not a ${PLAN_FORMAT} plan`,
        { ...paths, stored }
      )
    }

    const current = computeFingerprint(root, change, opts)
    if (!current.ok) {
      return noReuse(
        REUSE_ERROR,
        `the current inputs could not be fingerprinted: ${current.problems.join('; ')}`,
        { ...paths, stored, current }
      )
    }
    if (typeof stored.change === 'string' && stored.change !== current.change) {
      return noReuse(
        REUSE_MISMATCH,
        `the stored plan was built for change "${stored.change}", not "${current.change}"`,
        { ...paths, stored, current }
      )
    }
    if (stored.hash !== current.hash) {
      return noReuse(
        REUSE_MISMATCH,
        `the change's artifacts have been edited since the plan was built`,
        { ...paths, stored, current }
      )
    }

    return {
      reuse: true,
      status: REUSE_MATCH,
      reason: `the stored plan still matches every input it was built from`,
      plan,
      stored,
      current,
      ...paths
    }
  } catch (err) {
    // The one branch that must never surface as a match: an unexpected error is
    // a reason to re-plan, and it says so.
    return noReuse(
      REUSE_ERROR,
      `the reuse check itself failed: ${err && err.message ? err.message : err}`,
      paths
    )
  }
}

/**
 * Drop already-complete tasks from a plan, keeping the order of what is left.
 *
 * Narrowing is safe without re-planning: removing a completed task cannot
 * introduce a collision, and lanes are already path-disjoint, so the remaining
 * schedule holds. An emptied lane is DROPPED rather than dispatched — an agent
 * given no tasks is a spawn that can only report nothing.
 *
 * @param {object} plan a lane-shaped plan
 * @param {(taskId: string) => boolean} isComplete
 */
export function narrowPlan(plan, isComplete) {
  const done = typeof isComplete === 'function' ? isComplete : () => false
  const dropped = []

  const narrowWave = wave => {
    if (!wave || !Array.isArray(wave.batches)) return null
    const batches = []
    for (const batch of wave.batches) {
      const lanes = []
      for (const lane of Array.isArray(batch) ? batch : []) {
        const kept = (Array.isArray(lane) ? lane : []).filter(t => {
          if (t && typeof t.id === 'string' && done(t.id)) {
            dropped.push(t.id)
            return false
          }
          return true
        })
        if (kept.length) lanes.push(kept)
      }
      if (lanes.length) batches.push(lanes)
    }
    if (!batches.length) return null
    return {
      ...wave,
      batches,
      taskCount: batches.reduce((n, b) => n + b.reduce((m, lane) => m + lane.length, 0), 0)
    }
  }

  const waves = (Array.isArray(plan.waves) ? plan.waves : []).map(narrowWave).filter(Boolean)
  const testWave = plan.testWave ? narrowWave(plan.testWave) : null

  const all = testWave ? [...waves, testWave] : waves
  const laneCount = all.reduce((n, w) => n + w.batches.reduce((m, b) => m + b.length, 0), 0)
  const taskCount = all.reduce((n, w) => n + w.taskCount, 0)

  return {
    plan: {
      ...plan,
      waves,
      testWave,
      waveCount: waves.length,
      laneCount,
      totalTasks: taskCount
    },
    dropped,
    waveCount: waves.length,
    laneCount,
    taskCount,
    // Every task in the plan was already complete. That is not an empty run to
    // dispatch; it is a change with no remaining work, and the caller has to be
    // able to tell the difference.
    noRemainingWork: taskCount === 0
  }
}

/**
 * The text of every ticked checkbox in a change's tasks.md.
 *
 * Text, not ids: a checkbox line is `1.1 Do the thing`, and deciding whether a
 * plan's task id matches one is `taskMatchesId`'s job — the same reader
 * `interlock tasks tick` uses, so reuse and ticking cannot disagree about what
 * "already done" means.
 */
export function completedTaskLines(root = '.', change) {
  try {
    const info = inspectChange(root, change)
    return info.tasks.items.filter(t => t.done).map(t => t.text)
  } catch {
    // Unreadable tasks.md: nothing is known to be complete, so nothing is
    // dropped. Re-running a finished task is wasteful; skipping an unfinished
    // one is a silently unimplemented task, so this errs the survivable way.
    return []
  }
}

/**
 * Check, then narrow. What `ship` actually calls.
 *
 * @returns {object} the check result plus `narrowed` when the plan was reused
 */
export function resolvePlanReuse(root = '.', change, opts = {}) {
  const check = checkPlanReuse(root, change, opts)
  if (!check.reuse) return { ...check, narrowed: null, noRemainingWork: false }

  const completedText = completedTaskLines(root, change)
  const isComplete = id => completedText.some(text => taskMatchesId(text, id))
  const narrowed = narrowPlan(check.plan, isComplete)
  return {
    ...check,
    narrowed: narrowed.plan,
    droppedTaskIds: narrowed.dropped,
    waveCount: narrowed.waveCount,
    laneCount: narrowed.laneCount,
    taskCount: narrowed.taskCount,
    noRemainingWork: narrowed.noRemainingWork
  }
}

/** Human-readable outcome, for the skill and the run summary to echo. */
export function formatPlanReuse(result) {
  const lines = []
  lines.push(
    result.reuse
      ? `PLAN REUSED — ${result.reason}`
      : `PLAN REBUILT (${result.status}) — ${result.reason}`
  )
  if (result.reuse) {
    lines.push(
      `  ${result.taskCount ?? '?'} task(s) in ${result.laneCount ?? '?'} lane(s) across ` +
        `${result.waveCount ?? '?'} wave(s) remain`
    )
    if (result.droppedTaskIds && result.droppedTaskIds.length) {
      lines.push(`  already complete, dropped: ${result.droppedTaskIds.join(', ')}`)
    }
    if (result.noRemainingWork) lines.push('  NO REMAINING WORK — every task in the plan is complete')
  }
  return lines.join('\n') + '\n'
}

/** Human-readable fingerprint dump. */
export function formatFingerprint(fp) {
  const lines = []
  lines.push(fp.ok ? `fingerprint ${fp.hash}` : `NOT FINGERPRINTED — ${fp.problems.join('; ')}`)
  lines.push(`  format ${fp.planFormat}, change ${fp.change}`)
  lines.push(`  maxParallel ${fp.maxParallel}, maxTasksPerAgent ${fp.maxTasksPerAgent}`)
  for (const i of fp.inputs || []) {
    lines.push(`  ${i.sha256 === null ? 'ABSENT   ' : i.sha256.slice(0, 12)}  ${i.path}`)
  }
  for (const p of fp.problems || []) lines.push(`  problem: ${p}`)
  return lines.join('\n') + '\n'
}
