// The lane rule (draw-wave-plan-and-handoff-graph-from-the-cli design D3): the
// tier, label, title, model and effort a lane dispatches under, the cut that
// fits a drawn row to a width, and the one reader of a task's `dependsOn`.
//
// Moved out of `lib/waves.mjs` unchanged, because that module imports
// `node:crypto` and the ship meter's hooks module, which runs in the engine with
// no Node, needs the same names the planner gives a lane. `lib/waves.mjs`
// re-exports the lane functions it always exported, so its importers are
// unchanged.
//
// Pure and Node-free: `test/spine/draw-plan.test.mjs` walks this closure.

import { EFFORT, LANE_CAPS } from './limits.mjs'

/** The tier a lane dispatches on: the highest among its tasks. */
export function laneTier(lane) {
  return lane.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0)
}

/**
 * The label a lane runs under — the name its agent, its trajectory line and its
 * briefing file all carry.
 *
 * Stable across replays, so a resumed run cache-hits the lane it already ran.
 * This derivation was written three times (the workflow script, the ACP driver,
 * and `bin/interlock`'s own trajectory logger); it is stated here once because a
 * trajectory line and the agent it describes must carry one name, not two.
 */
export function laneLabel(lane) {
  return lane.length === 1 ? lane[0].id : `${lane[0].id}+${lane.length - 1}`
}

/** Separates a spawn's label from the words its title adds. */
export const TITLE_SEPARATOR = ' · '

/** The longest title a lane displays under, ellipsis included. */
const TITLE_MAX = 48

/**
 * The words a lane's title is built from: the first six words of a task
 * description, stripped of markdown emphasis and trailing punctuation; '' when
 * there are none. A fixed point — the gist of a gist is itself — so a plan
 * summary that stores it in place of the description titles every lane exactly
 * as the plan does (draw-the-wave-board-in-the-meter-pane design D3).
 *
 * @param {unknown} description
 * @returns {string}
 */
export function titleGist(description) {
  const text = typeof description === 'string' ? description : ''
  const words = text.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  return words.replace(/[\s.,;:—-]+$/, '')
}

/**
 * What a lane is called in words: `task 1.1` for a one-task lane, `tasks 1.1+2`
 * for a lane of several. The role word names what the agent is doing for a
 * reader of /workflows and the meter, where a bare `1.5` reads as an outline
 * sub-number. Display only: the join key stays `laneLabel`.
 */
export function laneName(lane) {
  return `${lane.length === 1 ? 'task' : 'tasks'} ${laneLabel(lane)}`
}

/**
 * The words a lane's title adds after its name: the first words of its first
 * task's description, cut so that label + separator + gist fits TITLE_MAX
 * (ellipsis included); '' when the description says nothing. The role word does
 * not count against the cap, so a gist is cut exactly where it always was.
 */
export function laneGist(lane) {
  const gist = titleGist(lane[0] && lane[0].description)
  if (!gist) return ''
  const head = `${laneLabel(lane)}${TITLE_SEPARATOR}`
  const full = `${head}${gist}`
  const cut = full.length <= TITLE_MAX ? full : `${full.slice(0, TITLE_MAX - 1).trimEnd()}…`
  return cut.slice(head.length)
}

/**
 * The name a lane is SHOWN under — its role word and label, then the first words
 * of its first task's description: `tasks 1.1+5 · Add the relaunch guard to…`.
 * The role word names what the agent is doing for a reader of /workflows and the
 * meter; the cap is on the label and gist, so a gist is cut where it always was.
 *
 * Display only. Everything that joins on a lane — its briefing file, worktree,
 * trajectory line, record-batch fold — keys on `laneLabel`, because a key built
 * from prose would change whenever a task was reworded. It is still a pure
 * function of the lane, so a replay displays, and cache-hits, the same agent.
 */
export function laneTitle(lane) {
  const gist = laneGist(lane)
  return gist ? `${laneName(lane)}${TITLE_SEPARATOR}${gist}` : laneName(lane)
}

/**
 * One task's declared dependency edges, deduplicated, in the order written.
 *
 * THE ONLY READER of `task.dependsOn`, for the same reason `predictedPaths` is
 * the only reader of `task.paths`: validation, layering and the replan path all
 * ask the same question, and three readers each doing their own trimming is how
 * one of them ends up matching an id the others do not. Here rather than in
 * `lib/waves.mjs`, which imports it, so the Node-free plan summary can ask it
 * too (draw-the-wave-board-in-the-meter-pane design D3).
 *
 * Entries are trimmed. A whitespace-only entry is dropped here and rejected by
 * `validate`, which runs first on every path into the planner.
 */
export function dependsOnIds(task) {
  const raw = task && Array.isArray(task.dependsOn) ? task.dependsOn : []
  const out = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const id = entry.trim()
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * The model a lane dispatches on, derived from the lane's shape and hardest tier.
 *
 * A lane of one task dispatches on that task's clamped model — haiku or sonnet,
 * or opus for a tier-5 task or a solo promotion. A lane of two or more tasks is
 * the work agent the planner chose not to split: it dispatches on opus when its
 * hardest tier is at or above `LANE_CAPS.opusMinTier`, or when every task already
 * carries opus (solo promotion of the whole change). Otherwise it runs on
 * sonnet — routine multi-task work no longer pays the flagship model by default.
 * Nothing here rewrites `task.model`: a narrowed lane of one returns to the
 * task's model.
 */
export function laneModel(lane) {
  if (!Array.isArray(lane) || lane.length === 0) return 'sonnet'
  if (lane.length === 1) {
    const only = lane[0]
    return (only && only.model) || 'sonnet'
  }
  // Solo promotions rewrite every task to opus after the clamp; an all-opus
  // multi-task lane is that decision (or a pure tier-5 pack), not the floor.
  if (lane.every(t => t && t.model === 'opus')) return 'opus'
  return laneTier(lane) >= LANE_CAPS.opusMinTier ? 'opus' : 'sonnet'
}

/**
 * The reasoning effort a lane dispatches at — a sibling of `laneModel`, derived
 * from the same hardest-task tier, looked up in the table published by
 * `lib/limits.mjs`. A lane is one agent, and that agent must be capable of the
 * hardest thing in the lane, so the effort is the hardest task's, never the
 * first task's — the one direction of this trade that is not survivable.
 *
 * Returns `null` (inherit the session default — do not force) for tiers 3–4 by
 * policy and for an untiered lane (`laneTier` → 0) by fallback; the plan's
 * effort report distinguishes the two. Effort is derived from tier alone. The
 * model a lane dispatches on follows shape and the opus floor, so a multi-task
 * lane of tier-1 or tier-2 tasks runs on sonnet at `low`.
 */
export function laneEffort(lane) {
  const tier = laneTier(lane)
  return EFFORT.byTier[tier] ?? null
}

/**
 * A drawn row fitted to `columns` code points: unchanged when it fits; else its
 * first `columns - 1` code points and `…`, so the result is exactly `columns`
 * wide. Both renderers cut every row with it, so a plan board and a run board
 * cut alike, and at the place the ship meter's pane cuts a line.
 *
 * @param {string} text
 * @param {number} columns
 * @returns {string}
 */
export function fitRow(text, columns) {
  const points = [...text]
  if (points.length <= columns) return text
  return `${points.slice(0, Math.max(0, columns - 1)).join('')}…`
}
