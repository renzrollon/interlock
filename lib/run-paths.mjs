// The two path sets a run's receipt records: what the commit touched, and what
// the executed plan predicted it would touch.
//
// Both are read here rather than reported by an agent, and that is the whole
// point of the module. The commit step in `workflows/ship.js` is a model agent
// returning `{ok, sha, detail}`; `ship-run` already requires a run's tallies to
// be its *recorded* outcomes rather than an agent's account of them, and this
// set carries more weight than a tally because it is the denominator of
// `interlock report`'s sharpest indicator. An agent that mis-listed its own
// commit would move that number and nothing downstream could see it.
//
// Two properties are load-bearing, and they are the same two the rest of the
// corpus code holds:
//
//   1. NEVER THROWS. A missing git, a detached object, a pruned commit, a
//      directory that is not a repository — each becomes an unobserved result
//      carrying its reason. A reader whose own crash is the output is worse
//      than no reader.
//
//   2. UNOBSERVED IS NOT EMPTY. A failed read returns `paths: null`, never
//      `[]`. `[]` asserts that a commit touched nothing or that a plan
//      predicted nothing, and the indicator these feed exists precisely to
//      tell those two apart from "we never found out".
//
// Shelling out to `git` from `lib/` is precedented rather than novel:
// `lib/drift.mjs` already does it, with the same collapse-every-failure-to-null
// discipline.
//
// Exposed to skills and to both ship hosts as `interlock paths touched` and
// `interlock paths predicted`.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_PATH } from './plan-fingerprint.mjs'

/**
 * A commit identifier we are willing to hand to git.
 *
 * Bounded, and rejected outright when it could be read as an option: this value
 * arrives from a receipt, a CLI flag or an agent's report, and none of those is
 * a trusted argument source. A rejected identifier is an unobserved read with a
 * stated reason, never a git invocation we hope fails.
 */
const SAFE_COMMIT = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,199}$/

function messageOf(err) {
  return (err && err.message) || String(err)
}

function unobserved(reason, extra = {}) {
  return { observed: false, paths: null, reason, ...extra }
}

/**
 * The repository-relative paths one commit touched, read from version control.
 *
 * @param {string} root repository root the commit lives in
 * @param {string} commit a commit identifier — the sha the receipt already carries
 * @returns {{observed: boolean, paths: string[]|null, reason: string|null, commit: string|null}}
 *   `observed: true` carries the set, which MAY be empty when the commit
 *   genuinely touched nothing. `observed: false` carries `paths: null` and the
 *   reason — never a partial list, and never `[]`.
 */
export function readTouchedPaths(root, commit) {
  const id = typeof commit === 'string' ? commit.trim() : ''
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return unobserved('no repository root was given', { commit: id || null })
    }
    if (!id) {
      return unobserved('the run recorded no commit identifier', { commit: null })
    }
    if (!SAFE_COMMIT.test(id)) {
      return unobserved(`"${id.slice(0, 60)}" is not a usable git object name`, { commit: id })
    }

    // `diff-tree -r --name-only` against a single commit lists exactly the paths
    // that commit changed, one per line, with no rename or status columns to
    // parse. `--no-commit-id` drops the header line so every line is a path.
    //
    // `--root` and `-m` are the two commits that would otherwise print nothing
    // and be recorded as a commit that touched no files: a repository's first
    // commit has no parent to diff against, and a merge is skipped entirely
    // unless it is asked for per parent. Both are rare in a ship run and both
    // would be silently wrong, which is the combination worth two flags. `-m`
    // repeats a path once per parent, so the set is deduplicated below.
    const out = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--root', id], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000
    })

    const paths = [
      ...new Set(
        out
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
      )
    ]

    return { observed: true, paths, reason: null, commit: id }
  } catch (err) {
    // Not a repository, git missing, an object git has never seen, a timeout.
    // All four mean the same thing to a reader — the set was not observed — and
    // the reason says which. A partial list is never returned: this command
    // either prints the whole set or fails.
    return unobserved(`the commit's paths could not be read from git: ${messageOf(err)}`, { commit: id })
  }
}

// Every task in a plan, whatever shape the plan was persisted in.
//
// `planWaves` emits `waves[].batches[][]` (batch → lane → task) plus an optional
// `testWave`; a wave state persisted by `wave-state create` keeps the same
// nesting under one `waves` array. Both are walked here rather than in two
// readers, because "the executed plan" is whichever of the two the host can hand
// back, and a reader that understood only one would report the other unreadable.
function tasksOf(plan) {
  const waves = []
  if (Array.isArray(plan.waves)) waves.push(...plan.waves)
  if (plan.testWave) waves.push(plan.testWave)

  const tasks = []
  for (const wave of waves) {
    if (!wave || !Array.isArray(wave.batches)) continue
    for (const batch of wave.batches) {
      if (!Array.isArray(batch)) continue
      for (const lane of batch) {
        if (!Array.isArray(lane)) continue
        for (const task of lane) {
          if (task && typeof task === 'object') tasks.push(task)
        }
      }
    }
  }
  return tasks
}

/**
 * The paths the executed plan predicted its tasks would touch: the union of
 * `task.paths` across the plan, plus whether every task declared any.
 *
 * `paths` is optional per task by design — `lib/waves.mjs` states it: "a
 * classifier that cannot predict which files a task will touch must be able to
 * say nothing rather than guess". So the union alone cannot distinguish a plan
 * that predicted nothing extra from a plan that declined to predict, and the
 * completeness marker is not a convenience: without it the report would read a
 * planner's silence as an implementer going off-plan.
 *
 * @param {string} root repository root
 * @param {{planPath?: string, plan?: object}} [opts]
 *   `plan` supplies an already-loaded plan (or wave state) and skips the read;
 *   `planPath` overrides the default location, repo-relative.
 * @returns {{
 *   observed: boolean, paths: string[]|null, complete: boolean|null,
 *   reason: string|null, tasks: number|null, predicting: number|null, path: string|null
 * }}
 */
export function readPredictedPaths(root, opts = {}) {
  const rel =
    opts && typeof opts.planPath === 'string' && opts.planPath.trim() ? opts.planPath.trim() : PLAN_PATH
  const abs = typeof root === 'string' && root.trim() ? join(root, rel) : rel
  const miss = (reason, path) => ({
    observed: false,
    paths: null,
    complete: null,
    reason,
    tasks: null,
    predicting: null,
    path: path || null
  })

  try {
    let plan = opts && opts.plan
    if (!plan) {
      if (typeof root !== 'string' || !root.trim()) return miss('no repository root was given', null)
      if (!existsSync(abs)) return miss(`no executed plan was found at ${rel}`, abs)
      plan = JSON.parse(readFileSync(abs, 'utf8'))
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return miss(`the executed plan at ${rel} is not a plan object`, abs)
    }

    const tasks = tasksOf(plan)
    if (!tasks.length) {
      // Observed, and observed to predict nothing. Reported incomplete rather
      // than vacuously complete: a plan with no tasks predicted no path for any
      // work the run did, and letting it qualify would score the run at zero
      // fidelity for a reason that has nothing to do with the implementer.
      return {
        observed: true,
        paths: [],
        complete: false,
        reason: `the executed plan at ${rel} declares no tasks, so no task declared paths`,
        tasks: 0,
        predicting: 0,
        path: abs
      }
    }

    const union = new Set()
    let predicting = 0
    for (const task of tasks) {
      const declared = Array.isArray(task.paths) ? task.paths.filter(p => typeof p === 'string' && p.trim()) : []
      if (declared.length) predicting++
      for (const p of declared) union.add(p.trim())
    }

    const complete = predicting === tasks.length
    return {
      observed: true,
      paths: [...union].sort(),
      complete,
      reason: complete
        ? null
        : `${tasks.length - predicting} of ${tasks.length} executed task(s) declared no paths, so the prediction is incomplete`,
      tasks: tasks.length,
      predicting,
      path: abs
    }
  } catch (err) {
    return miss(`the executed plan at ${rel} could not be read: ${messageOf(err)}`, abs)
  }
}

/** Human-readable rendering of either reader, for the CLI. */
export function formatPathSet(label, result) {
  if (!result.observed) {
    return `${label} — UNOBSERVED: ${result.reason}\n`
  }
  const lines = [`${label} — ${result.paths.length} path(s) observed`]
  for (const p of result.paths) lines.push(`  ${p}`)
  if (result.complete === false) lines.push(`  incomplete: ${result.reason}`)
  if (result.complete === true) lines.push('  every executed task declared its paths')
  return lines.join('\n') + '\n'
}
