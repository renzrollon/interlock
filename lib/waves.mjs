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
//   3. Singleton fold. A classifier that mints a group per sequential slice of
//      one file turns 22 tasks into 15 waves, and each of those waves still
//      buys a record ping and — until the cap — an inter-wave verify. A 1-task
//      wave is ordering, not a checkpoint, so it is folded onto the previous
//      implementation wave as a later batch. Order survives; the checkpoint
//      does not. Every fold is reported.
//
//   4. Dependency edges. A group is a barrier and a path collision is a lane,
//      which left the classifier with no way to say "B needs A's output" when A
//      and B edit different files — so it minted a whole new section, dragging
//      every task independent of A along with it. `dependsOn` is that missing
//      signal: a task names the earlier tasks whose output it needs, and the
//      group is split into dependency LAYERS, each of which is a wave. The
//      singleton fold below then reclaims the checkpoint, so a precise edge
//      costs a later batch rather than an extra inter-wave verify. An edge is
//      additive — it can only push a task later than the section model already
//      put it — and a plan with no edges is planned exactly as it was before
//      this existed.
//
//   5. Lanes. A batch holds LANES, not tasks: a lane is an ordered task list
//      one agent executes start to finish. Tasks a path collision already
//      forced to run one after another gain nothing from separate agents —
//      isolating a task from the other edits to the file it is about to edit is
//      not isolation — and each separate agent pays its own spawn prefix. So
//      colliding tasks become one lane. Lanes in a batch are path-disjoint and
//      run in parallel; `LANE_CAPS.byTier` bounds how much one interruption can
//      discard, and a uniform override of 1 reproduces one agent per task.
//
//   6. Cohesion. Collision alone made every path-disjoint task its own agent,
//      however small: seven tasks each writing one `evals/*/case.yaml` were
//      seven spawns that then had to be told, by a hand-written eighth task,
//      what convention to agree on. So after collision components form, the
//      LOW-TIER ones in a layer pack greedily into shared lanes — next-fit,
//      hardest component first, bounded by that lane's per-tier cap. Tier 4 and
//      5 work is excluded on purpose: cross-file pattern-following is where a
//      fresh context per task still pays for itself. Every fold is reported.
//
//   7. Solo. A small change may be planned as ONE lane — every implementation
//      task in section, layer and id order, then every test task — run by one
//      opus agent inside the same verify-and-commit loop. The decision is made
//      inside a published envelope (`SOLO.maxTasks`): a flag wins, then the
//      classifier's recommendation if the change fits, then waves. The mode,
//      its source and its reason are on the plan, because a run that silently
//      changed its own shape is the failure the plan preview exists to remove.
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

import { LIMITS, EFFORT, LANE_CAPS, SOLO, clampParallel } from './limits.mjs'
import { diffIndex, locatorPath } from './locators.mjs'
import { canonicalizePath, isDocsPath } from './risk.mjs'

/** Skip reason when a completed wave claimed only documentation paths. */
export const SKIP_VERIFY_DOCS = 'docs-only-wave'
/** Skip reason when LIMITS.interWaveVerifications checkpoints are already spent. */
export const SKIP_VERIFY_CAP = 'verify-cap-reached'

export const DEFAULT_MAX_PARALLEL = 8

/** A lane whose tasks were joined by a canonical-path collision. */
export const LANE_COLLISION = 'collision'
/** A lane packing several path-disjoint low-tier components from one layer. */
export const LANE_COHESION = 'cohesion'
/** The single lane of a solo plan: the whole change, in order, on one agent. */
export const LANE_SOLO = 'solo'

/** The two plan shapes. `auto` is not one — it is the absence of an override. */
export const MODE_WAVES = 'waves'
export const MODE_SOLO = 'solo'

const MODES = new Set([MODE_WAVES, MODE_SOLO])

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

/**
 * One task's declared dependency edges, deduplicated, in the order written.
 *
 * THE ONLY READER of `task.dependsOn`, for the same reason `predictedPaths` is
 * the only reader of `task.paths`: validation, layering and the replan path all
 * ask the same question, and three readers each doing their own trimming is how
 * one of them ends up matching an id the others do not.
 *
 * Entries are trimmed. A whitespace-only entry is dropped here and rejected by
 * `validate`, which runs first on every path into the planner.
 */
function dependsOnIds(task) {
  const raw = task && Array.isArray(task.dependsOn) ? task.dependsOn : []
  const out = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const id = entry.trim()
    if (!out.includes(id)) out.push(id)
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
    // `dependsOn` is optional the way `paths` is optional — a classifier that
    // sees no dependency says nothing — but unlike `paths` it is a STRUCTURAL
    // claim, so its content is checked too (below). A wrong path costs a
    // needless serialization; a wrong edge is a task that runs before the work
    // it needed, which is the failure this planner exists to prevent.
    if (t.dependsOn !== undefined) {
      if (
        !Array.isArray(t.dependsOn) ||
        t.dependsOn.some(d => typeof d !== 'string' || !d.trim())
      ) {
        fail(`${at}.dependsOn must be an array of non-empty strings when present (task ${t.id})`)
      }
    }
  })

  validateDependencies(input.tasks)
}

/**
 * Check the dependency edge set fail-closed: every reference resolves, no edge
 * points at work that runs later, and the graph is acyclic.
 *
 * Nothing here is repaired. Dropping an unresolved reference or breaking a
 * cycle would produce a plan that looks successful and runs in the wrong order,
 * which is strictly worse than a halt naming the cause — the same reason an
 * out-of-repo `paths` entry is reported rather than normalized into scope.
 *
 * Two rejections beyond "dangling or cyclic" exist because the planner cannot
 * honour those edges at all, and silently ignoring them is the degradation this
 * is here to refuse:
 *
 *   - An edge pointing at a LATER numbered section. Sections are a barrier the
 *     edge cannot override (a section-predecessor is always earlier), so such
 *     an edge asks for an order the section model already forbids.
 *   - An implementation task depending on a TEST task. Test tasks are deferred
 *     to a single trailing wave, so the dependency could never be satisfied.
 */
function validateDependencies(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]))

  for (const t of tasks) {
    for (const dep of dependsOnIds(t)) {
      if (!byId.has(dep)) {
        fail(`task ${t.id} depends on "${dep}", which is not a task in this plan`)
      }
      const target = byId.get(dep)
      if (!t.isTestTask && target.isTestTask) {
        fail(
          `task ${t.id} depends on test task ${dep}, which runs in the trailing test wave — ` +
            `a dependency can only name work that runs earlier`
        )
      }
      if (!t.isTestTask && !target.isTestTask && target.group > t.group) {
        fail(
          `task ${t.id} (section ${t.group}) depends on ${dep} (section ${target.group}), which ` +
            `runs in a later section — a dependency can only name work that runs earlier`
        )
      }
    }
  }

  // Depth-first, naming the ids on the cycle rather than reporting that one
  // exists: "there is a cycle" is not something an author can act on.
  const UNVISITED = 0
  const ON_STACK = 1
  const DONE = 2
  const marks = new Map()
  const stack = []
  const walk = id => {
    const mark = marks.get(id) || UNVISITED
    if (mark === DONE) return
    if (mark === ON_STACK) {
      const from = stack.indexOf(id)
      fail(`dependency cycle: ${[...stack.slice(from), id].join(' → ')}`)
    }
    marks.set(id, ON_STACK)
    stack.push(id)
    for (const dep of dependsOnIds(byId.get(id))) walk(dep)
    stack.pop()
    marks.set(id, DONE)
  }
  for (const t of tasks) walk(t.id)
}

/**
 * Split one task set into dependency layers: everything with no dependency
 * inside the set, then everything that depended only on that, and so on.
 *
 * The layer index IS the topological depth over the set's own edges, so layer 0
 * runs first and a task is always in a strictly later layer than everything it
 * depends on. Edges leaving the set are ignored HERE and satisfied elsewhere:
 * a set is either one numbered section (whose predecessors are whole earlier
 * waves) or the trailing test wave (which runs after every implementation
 * wave), so an outbound edge is already ordered by the wave sequence.
 *
 * Order inside a layer is the caller's order, untouched. Re-sorting would be
 * invisible until it changed which tasks share a batch in an edge-free plan,
 * which is exactly the byte-identical guarantee this must not spend.
 *
 * With no edges every task is depth 0, so this returns `[tasks]` — one layer,
 * in the order it was handed, and every caller behaves as it did before.
 */
function layerByDependencies(tasks) {
  const inSet = new Map(tasks.map(t => [t.id, t]))
  const depth = new Map()
  const onStack = new Set()

  const depthOf = id => {
    if (depth.has(id)) return depth.get(id)
    // `validate` rejects cycles before any plan is built, but `makeWave` lanes a
    // replan whose tasks never went through it. A cycle there is a halt, not an
    // infinite descent.
    if (onStack.has(id)) fail(`dependency cycle through task ${id}`)
    onStack.add(id)
    let d = 0
    for (const dep of dependsOnIds(inSet.get(id))) {
      if (!inSet.has(dep)) continue
      d = Math.max(d, depthOf(dep) + 1)
    }
    onStack.delete(id)
    depth.set(id, d)
    return d
  }

  const layers = []
  for (const t of tasks) {
    const d = depthOf(t.id)
    while (layers.length <= d) layers.push([])
    layers[d].push(t)
  }
  return layers
}

/**
 * Ascending task id, natural order, so `1.9` sorts before `1.10`.
 *
 * This is the order tasks run in inside a lane. It is authored order, not tier
 * order: sequential same-file work is ordered work, and a tier is a statement
 * about difficulty, never about what depends on what.
 */
function byTaskId(a, b) {
  return String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
}

/**
 * Where a planned lane or collision sits, for a report. A null group is the
 * trailing test wave, which has no group number — naming it "wave null" would
 * be a worse report than naming it what it is.
 */
function laneWhere(group) {
  return group === null || group === undefined ? 'the test wave' : `wave ${group}`
}

/** Every canonical path a lane's tasks claim, deduplicated. */
function laneCanonicalPaths(lane) {
  const out = new Set()
  for (const t of lane) {
    for (const p of predictedPaths(t)) if (p.canonical !== null) out.add(p.canonical)
  }
  return out
}

/** The tier a lane dispatches on: the highest among its tasks. */
export function laneTier(lane) {
  return lane.reduce((m, t) => (Number.isInteger(t.tier) && t.tier > m ? t.tier : m), 0)
}

/**
 * The effective per-tier lane cap table for one plan: the published table with a
 * uniform override applied as a CEILING over every tier.
 *
 * A ceiling rather than a replacement, because the override's documented purpose
 * is rollback: an override of 1 must reproduce one agent per task exactly, for
 * cohesion lanes as well as collision lanes. Raising a tier's cap above the
 * published table is deliberately not possible — the table is where a cap is
 * stated, and a caller that could exceed it would be a second statement.
 *
 * @param {number} [override] uniform ceiling; ignored unless a positive integer
 * @returns {Record<number, number>} tier → cap, a fresh object every call
 */
export function effectiveLaneCaps(override) {
  const ceiling = Number.isInteger(override) && override > 0 ? override : null
  const out = {}
  for (const [tier, cap] of Object.entries(LANE_CAPS.byTier)) {
    out[tier] = ceiling === null ? cap : Math.min(cap, ceiling)
  }
  return out
}

/**
 * The cap that bounds a lane of `tier`, read off an effective table.
 *
 * Tier 0 — a lane whose tasks carry no readable tier — uses the tier-1 entry.
 * That is the same fallback `laneEffort` makes for an unreadable tier, and it
 * errs toward the most permissive cap on the least demanding work.
 */
function capForTier(caps, tier) {
  const table = caps && typeof caps === 'object' ? caps : LANE_CAPS.byTier
  const cap = table[tier] ?? table[1] ?? LANE_CAPS.byTier[1]
  return Number.isInteger(cap) && cap > 0 ? cap : 1
}

/**
 * The model a lane dispatches on — the one assigned to its hardest task.
 *
 * A lane is one agent, and that agent has to be capable of everything in it.
 * Taking the first task's model would run a tier-5 task on whatever tier 1 was
 * given, which is the one direction of this trade that is not survivable.
 */
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

export function laneModel(lane) {
  const tier = laneTier(lane)
  const hardest = lane.find(t => t.tier === tier)
  return (hardest && hardest.model) || (lane[0] && lane[0].model) || 'sonnet'
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
 * effort report distinguishes the two. Effort is orthogonal to the model clamp:
 * both are derived from tier so a future model tweak never silently moves effort.
 */
export function laneEffort(lane) {
  const tier = laneTier(lane)
  return EFFORT.byTier[tier] ?? null
}

/**
 * Group a group's tasks into lanes: connected components over canonical-path
 * collisions, ordered by task id, split at the lane cap.
 *
 * Two tasks join when they claim a common canonical path, directly or through
 * another task — component membership, not pairwise chaining. With tasks
 * A[x,y], B[x] and C[y], pairwise chaining would put B and C in different
 * lanes that both run beside A's writes.
 *
 * The key is the CANONICAL path, never the authored spelling. Keyed on raw
 * text, `src/a.ts` and `./src/a.ts` are two identities for one file, so the
 * two tasks claiming them would run concurrently and one would silently
 * overwrite the other. The spelling the author wrote is still what gets
 * reported — a report naming a path the task author does not recognize is a
 * worse report.
 *
 * A path that cannot be canonicalized joins nothing: an identity we could not
 * compute is not an identity that matches everything, and the plan reports it
 * rather than normalizing it into scope.
 *
 * WHAT THIS DOES NOT DO. `paths` is a model's prediction, so a task that edits
 * a file it never named is still unguarded. This narrows the race; it does not
 * close it.
 */
function buildLanes(tasks, serialized, group, laneCaps) {
  // Components are built in task-id order so the first claimant of a path is
  // the earliest task, which is both what a lane runs first and what the
  // collision report should name as the holder.
  const ordered = tasks.slice().sort(byTaskId)
  const parent = ordered.map((_, i) => i)
  const find = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Lower index wins so a component's root is its earliest task.
    if (ra < rb) parent[rb] = ra
    else parent[ra] = rb
  }

  const owner = new Map()
  ordered.forEach((t, i) => {
    let reported = false
    for (const p of predictedPaths(t)) {
      if (p.canonical === null) continue
      if (owner.has(p.canonical)) {
        const held = owner.get(p.canonical)
        if (!reported) {
          serialized.push({
            id: t.id,
            group,
            path: p.authored,
            conflictsWith: ordered[held].id
          })
          reported = true
        }
        union(held, i)
      } else {
        owner.set(p.canonical, i)
      }
    }
  })

  const components = new Map()
  ordered.forEach((t, i) => {
    const root = find(i)
    if (!components.has(root)) components.set(root, [])
    components.get(root).push(t)
  })

  // Hardest component first, for the same reason tasks used to sort that way:
  // when the group is wider than maxParallel, the component whose failure means
  // the design was wrong should be in the first batch, not the third. Split
  // lanes of one component are emitted in order right after each other, so the
  // packer below can only ever push a later sibling into a later batch.
  //
  // The order is also what makes cohesion's cap safe: eligible components are a
  // suffix of this ranking (eligibility is `tier <= cohesionMaxTier`, and the
  // ranking is by descending tier), so the FIRST component to join an open
  // cohesion lane is its hardest, and the lane's cap is fixed from that moment.
  // A cap can never shrink under a lane that already filled it.
  const ranked = [...components.values()].sort((a, b) => {
    const ta = laneTier(a)
    const tb = laneTier(b)
    if (tb !== ta) return tb - ta
    return byTaskId(a[0], b[0])
  })

  const lanes = []
  // One open lane, walked in ranked order — next-fit, not first-fit. First-fit
  // packs marginally tighter but lets a later small component slip into an
  // earlier lane whose tier it does not share, which makes "which agent got this
  // task" harder to read off the plan. Next-fit is one open lane, one rule, one
  // line in the preview.
  let open = null
  const close = () => {
    if (!open) return
    // Sorted by id exactly as a collision lane is: two components merged by
    // cohesion may interleave, which is authored order and runs inside one
    // agent, so no concurrency guarantee is spent on it.
    if (open.parts > 1) open.tasks.sort(byTaskId)
    lanes.push(open)
    open = null
  }

  for (const component of ranked) {
    const tier = laneTier(component)
    const cap = capForTier(laneCaps, tier)

    // Ineligible (tier above the cohesion ceiling), or too long to pack at all:
    // its own lane, or its own sequential lanes when it exceeds the cap. Closing
    // the open lane keeps next-fit's invariant honest — one open lane, appended
    // to in ranked order — rather than leaving a stale lane behind an emission.
    if (tier > LANE_CAPS.cohesionMaxTier || component.length > cap) {
      close()
      for (const part of chunk(component, cap)) {
        lanes.push({ tasks: part, kind: LANE_COLLISION, tier: laneTier(part), cap })
      }
      continue
    }

    if (open && open.tasks.length + component.length <= capForTier(laneCaps, Math.max(open.tier, tier))) {
      open.tasks.push(...component)
      open.parts += 1
      continue
    }
    close()
    open = { tasks: component.slice(), kind: LANE_COLLISION, tier, cap, parts: 1 }
  }
  close()

  // A lane holding more than one COMPONENT was joined by cohesion; a lane
  // holding one component (whole, or a cap-sized slice of it) was joined by a
  // collision. The distinction is not cosmetic — it is what the preview reports,
  // and it cannot be derived after the fact: the two halves of a split star
  // component are path-disjoint from each other, so a lane that re-derived its
  // kind from its own connectivity would call that split a cohesion fold.
  for (const lane of lanes) {
    if (lane.parts > 1) {
      lane.kind = LANE_COHESION
      lane.tier = laneTier(lane.tasks)
      lane.cap = capForTier(laneCaps, lane.tier)
    }
    delete lane.parts
  }
  return lanes
}

/**
 * Pack lanes into batches that never co-schedule two lanes claiming the same
 * path, and never exceed maxParallel lanes.
 *
 * Lanes from different components are path-disjoint by construction, so the
 * only collision the packer can see is between the split halves of a component
 * too long for the cap — which is exactly the pair that must stay sequential.
 *
 * The two deferral kinds are deliberately distinct. A lane pushed out because
 * the batch was full is path-disjoint from everything in it, so it waits for a
 * later batch; it is never folded into another lane's agent, which would
 * serialize work the planner deliberately parallelized.
 */
function packLanes(entries, maxParallel) {
  const remaining = entries.slice()
  const batches = []
  while (remaining.length) {
    const batch = []
    const claimed = new Set()
    const deferred = []
    for (const entry of remaining) {
      const paths = laneCanonicalPaths(entry.tasks)
      let clash = false
      for (const p of paths) {
        if (claimed.has(p)) {
          clash = true
          break
        }
      }
      if (clash || batch.length >= maxParallel) {
        deferred.push(entry)
        continue
      }
      batch.push(entry.tasks)
      for (const p of paths) claimed.add(p)
    }
    if (!batch.length) {
      batch.push(remaining[0].tasks)
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
 * A group's tasks as batches of lanes, plus the lane entries that describe them.
 *
 * A batch is a list of lanes run in parallel; a lane is a list of tasks run in
 * order by one agent. Today's pre-lane behaviour is the case where every lane
 * holds exactly one task, which is what a uniform cap of 1 reproduces exactly.
 *
 * The entries are returned beside the batches rather than attached to them
 * because a lane IS a plain array of tasks — the shape every consumer, the run
 * state and `plan.json` already expect — and a property hung on an array does
 * not survive `JSON.stringify`. Each entry's `tasks` is the very array placed in
 * a batch, so the caller can report a lane's kind without re-deriving it.
 */
function collisionAwareChunk(tasks, maxParallel, serialized, group, laneCaps) {
  const entries = buildLanes(tasks, serialized, group, laneCaps)
  return { batches: packLanes(entries, maxParallel), entries }
}

/** Every task in a wave, in execution order, regardless of lane nesting. */
function waveTasks(wave) {
  const batches = wave && Array.isArray(wave.batches) ? wave.batches : []
  return batches.flat(2)
}

/** Every lane in a wave, in execution order. */
function waveLanes(wave) {
  const batches = wave && Array.isArray(wave.batches) ? wave.batches : []
  return batches.flat(1)
}

/**
 * Fold every 1-task implementation wave onto the wave before it.
 *
 * A wave boundary is a checkpoint: a record ping, and until the cap an
 * inter-wave verification. A wave holding a single task buys that checkpoint to
 * express one thing — that its task runs after the previous wave's. A later
 * *batch* of the previous wave expresses exactly the same ordering and costs
 * nothing, so that is where the task goes.
 *
 * What is deliberately not folded:
 *
 *   - A leading singleton. With no previous implementation wave there is
 *     nothing to fold onto, and inventing one would reorder the run.
 *   - Two waves that each hold two or more tasks. Their boundary is a real
 *     checkpoint between two sets of parallel work, not a staircase.
 *   - The trailing test wave, in either direction. It is deferred on purpose
 *     so a cross-cutting failure is diagnosed once, against finished work.
 *
 * The batches are appended as they were planned, which is what makes D3's
 * split-only `adoptWave` load-bearing: a folded task with a disjoint path has
 * no collision to keep it out of batch 0, so only the batch boundary the plan
 * recorded keeps it from running too early.
 *
 * @param {Array<{group: number, taskCount: number, batches: Array}>} planned
 * @returns {{waves: Array, folded: Array<{id: string, from: number, to: number}>}}
 */
function foldSingletonWaves(planned) {
  const waves = []
  const folded = []
  for (const wave of planned) {
    const previous = waves[waves.length - 1]
    if (wave.taskCount === 1 && previous) {
      const [task] = waveTasks(wave)
      previous.batches.push(...wave.batches)
      previous.taskCount += wave.taskCount
      folded.push({ id: task.id, from: wave.group, to: previous.group })
      continue
    }
    waves.push(wave)
  }
  return { waves, folded }
}

/**
 * Every claimed path on every task is documentation.
 *
 * Missing paths → not docs-only, and a path that could not be canonicalized →
 * not docs-only either. "We could not place this file in the repo" is unknown,
 * and unknown is never a reason to skip a verification checkpoint.
 */
export function isDocsOnlyWave(wave) {
  const tasks = waveTasks(wave)
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
  for (const t of waveTasks(wave)) {
    for (const p of predictedPaths(t)) {
      // Prefixed with "./" because canonicalizePath never returns a leading
      // "./", so an unusable path can never collide with a real canonical
      // identity. (This used to be a literal NUL byte, which made the whole
      // module read as binary to grep.)
      const key = p.canonical === null ? `./unusable:${p.authored}` : p.canonical
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p.authored)
    }
  }
  return out
}

/**
 * Which shape to plan in: flag, then the classifier inside the envelope, then
 * waves. Pure, and the only place the precedence is written down.
 *
 * A flag may exceed the envelope and is warned about; a classifier
 * recommendation may not, and its refusal is warned about too. Both directions
 * are spoken because the operator's question at a plan preview is always "why is
 * it doing it this way", and an unexplained mode is an unanswerable one.
 *
 * An absent, unrecognized or `waves` recommendation is waves with no warning, so
 * a `classified.json` written before this field existed plans exactly as before.
 *
 * @param {unknown} override `opts.mode`
 * @param {unknown} recommended `input.recommendedMode`
 * @param {unknown} reason `input.modeReason`
 * @param {number} taskCount every task the lane would hold
 */
function decideMode(override, recommended, reason, taskCount) {
  const warnings = []
  // Contradictory input is rejected before planning rather than resolved by
  // order: last-wins would silently pick one of two things the caller asked for.
  if (Array.isArray(override)) {
    const asked = [...new Set(override.map(m => String(m)))]
    fail(
      `contradictory mode overrides (${asked.join(' and ')}) — pass exactly one of ` +
        `${MODE_SOLO}|${MODE_WAVES}`
    )
  }
  if (override !== undefined && override !== null && !MODES.has(override)) {
    fail(`unknown mode override ${JSON.stringify(override)} — expected ${MODE_SOLO}|${MODE_WAVES}`)
  }

  // Carried verbatim but bounded by the handoff budget, so a runaway reason
  // cannot bloat every plan, every fingerprint and every preview that echoes it.
  const carried =
    typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, LIMITS.maxHandoffChars)
      : null

  if (MODES.has(override)) {
    if (override === MODE_SOLO && taskCount > SOLO.maxTasks) {
      warnings.push(
        `solo forced by flag: ${taskCount} tasks exceeds the published envelope of ` +
          `${SOLO.maxTasks} — the whole change runs on one agent by explicit request`
      )
    }
    return { mode: override, modeSource: 'flag', modeReason: null, warnings }
  }

  if (recommended === MODE_SOLO) {
    if (taskCount <= SOLO.maxTasks) {
      return { mode: MODE_SOLO, modeSource: 'classifier', modeReason: carried, warnings }
    }
    warnings.push(
      `classifier recommended solo for ${taskCount} tasks; the envelope is ${SOLO.maxTasks}, ` +
        `planned as waves`
    )
  }
  return { mode: MODE_WAVES, modeSource: 'default', modeReason: null, warnings }
}

/**
 * Every task in solo order: implementation by (group, dependency layer, id),
 * then tests by (layer, id).
 *
 * The order is the whole ordering guarantee of a solo plan. There are no batch
 * boundaries left to express "after" with, so a section barrier and a
 * `dependsOn` edge are both honoured by sequence inside the one agent — which is
 * why layer beats id here, and why the edge report is still emitted.
 *
 * @returns {{lane: Array, deferred: Array}}
 */
function soloOrder(groups, byGroup, testTasks) {
  const lane = []
  const deferred = []
  const orderLayers = (tasks, group) => {
    const layers = layerByDependencies(tasks)
    layers.forEach((layer, depth) => {
      if (depth > 0) {
        const earlier = new Set(layers.slice(0, depth).flat().map(t => t.id))
        for (const t of layer) {
          deferred.push({ id: t.id, group, after: dependsOnIds(t).filter(d => earlier.has(d)) })
        }
      }
      lane.push(...layer.slice().sort(byTaskId))
    })
  }
  for (const group of groups) orderLayers(byGroup.get(group), group)
  if (testTasks.length) orderLayers(testTasks, null)
  return { lane, deferred }
}

/**
 * @param {{tasks: Array, recommendedMode?: string, modeReason?: string}} input
 *   classified tasks, optionally carrying the classifier's mode recommendation
 * @param {{maxParallel?: number, maxTasksPerAgent?: number, mode?: string}} opts
 *   `maxTasksPerAgent` is a UNIFORM CEILING over every tier's published cap for
 *   this plan only; the caps themselves stay stated once in `LANE_CAPS.byTier`.
 *   It is an override because 1 is the documented rollback lever — it reproduces
 *   one agent per task exactly, cohesion included — and a lever nothing can pull
 *   is not a lever. `mode` forces `solo` or `waves`; absent, the classifier's
 *   recommendation is honoured inside the published envelope.
 */
export function planWaves(input, opts = {}) {
  validate(input)

  const maxParallel = Number.isInteger(opts.maxParallel) && opts.maxParallel > 0
    ? opts.maxParallel
    : DEFAULT_MAX_PARALLEL
  const laneCaps = effectiveLaneCaps(opts.maxTasksPerAgent)

  // Copy so the caller's objects are never mutated by the clamp.
  const tasks = input.tasks.map(t => ({ ...t }))

  const clamped = []
  for (const t of tasks) {
    const record = clampModel(t)
    if (record) clamped.push(record)
  }

  const decision = decideMode(opts.mode, input.recommendedMode, input.modeReason, tasks.length)

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

  const solo = decision.mode === MODE_SOLO

  const serialized = []
  const deferred = []
  const laneEntries = []
  const promoted = []
  let planned = []
  let waves = []
  let folded = []
  let testWave = null
  let widest = 0

  if (solo) {
    // Every task on one agent, so there is nothing to pack: `foldSingletonWaves`,
    // `packLanes` and the collision report are all answers to "what may run
    // beside what", and in a lane of one agent that question has no content.
    // What survives is the ORDER, which is the whole ordering guarantee here.
    //
    // Promotion happens after the clamp, not instead of it. The clamp's job is to
    // stop the CLASSIFIER escalating itself to opus; handing one agent the whole
    // change is the planner's own decision, so it is recorded as a promotion
    // rather than smuggled in as a classification.
    for (const t of tasks) {
      if (t.model === 'opus') continue
      promoted.push({ id: t.id, from: t.model, to: 'opus', tier: t.tier })
      t.model = 'opus'
    }

    const ordered = soloOrder(groups, byGroup, testTasks)
    deferred.push(...ordered.deferred)
    if (ordered.lane.length) {
      const group = groups.length ? groups[0] : Math.min(...tasks.map(t => t.group))
      const entry = {
        tasks: ordered.lane,
        kind: LANE_SOLO,
        tier: laneTier(ordered.lane),
        cap: null
      }
      laneEntries.push({ group, entry })
      waves = [{ group, taskCount: ordered.lane.length, batches: [[ordered.lane]] }]
      widest = ordered.lane.length
    }
  } else {
    // A group is split into dependency layers, each of which becomes a wave of
    // its own. With no edges a group is exactly one layer, so this loop emits the
    // same one-wave-per-group plan it always did; with edges, the dependent task
    // lands in a later layer, and the singleton fold below usually turns that
    // layer back into a later BATCH of the same wave rather than a new checkpoint.
    planned = []
    for (const group of groups) {
      const layers = layerByDependencies(byGroup.get(group))
      layers.forEach((layer, depth) => {
        if (depth > 0) {
          const earlier = new Set(layers.slice(0, depth).flat().map(t => t.id))
          for (const t of layer) {
            deferred.push({
              id: t.id,
              group,
              after: dependsOnIds(t).filter(d => earlier.has(d))
            })
          }
        }
        const layerTasks = layer.slice().sort(byHardestFirst)
        const { batches, entries } = collisionAwareChunk(
          layerTasks,
          maxParallel,
          serialized,
          group,
          laneCaps
        )
        for (const entry of entries) laneEntries.push({ group, entry })
        planned.push({ group, taskCount: layerTasks.length, batches })
      })
    }

    // The width warning describes what the classifier handed us — how wide a
    // single group was before anything was folded onto it. Measured after the
    // fold it would report a wave whose batches already fit the cap.
    widest = planned.reduce((m, w) => Math.max(m, w.taskCount), 0)

    const folding = foldSingletonWaves(planned)
    waves = folding.waves
    folded = folding.folded

    // Test tasks are deferred to a single trailing wave so that a cross-cutting
    // test failure is diagnosed once, against the finished implementation, rather
    // than repeatedly against half-built state.
    //
    // The wave is laned exactly as an implementation layer is. It used to be
    // chunked one task per lane on the reasoning that deferral had already bought
    // the parallelism a lane would spend — but sixteen tier-2 test tasks were
    // sixteen spawns for that, and two test tasks claiming one path were run side
    // by side, which is the collision the packer exists to prevent. The deferral
    // is about WHEN tests run, not about how many agents run them.
    //
    // Layered for the same reason a group is: two test tasks joined by an edge
    // would otherwise be chunked side by side into one concurrent batch. Layers
    // become later batches here rather than waves, because the test wave is one
    // wave by construction.
    if (testTasks.length) {
      const batches = []
      for (const layer of layerByDependencies(testTasks)) {
        const packed = collisionAwareChunk(
          layer.slice().sort(byHardestFirst),
          maxParallel,
          serialized,
          null,
          laneCaps
        )
        for (const entry of packed.entries) laneEntries.push({ group: null, entry })
        batches.push(...packed.batches)
      }
      testWave = { taskCount: testTasks.length, batches }
    }
  }

  const implCount = implTasks.length

  // Every lane holding more than one task, so a fold is visible rather than
  // inferred from a smaller agent bill. A lane of one is not a fold and is not
  // listed — the plan would otherwise report a "fold" for every task it has.
  //
  // Read off the entries the packer produced rather than re-walked from the
  // waves, because `kind` is a fact about how the lane was BUILT and cannot be
  // recovered from the lane's contents afterwards. The test wave's lanes are
  // listed too (with a null group): a cohesion fold there is exactly as much a
  // fold as one in an implementation wave.
  const lanes = []
  for (const { group, entry } of laneEntries) {
    if (entry.tasks.length < 2) continue
    lanes.push({
      group,
      kind: entry.kind,
      ids: entry.tasks.map(t => t.id),
      tier: laneTier(entry.tasks),
      cap: entry.cap,
      model: laneModel(entry.tasks),
      effort: laneEffort(entry.tasks)
    })
  }
  const laneCount = waves.reduce((n, w) => n + waveLanes(w).length, 0)

  // One effort entry per listed lane, mirroring the clamp report. An inherited
  // effort (null) is either "by policy" (a tier 3–4 lane the table leaves to the
  // session default) or "by fallback" (a lane whose tier could not be read, tier
  // 0) — reported apart so an inherited effort is never mistaken for no routing.
  const effort = lanes.map(l => ({
    ids: l.ids,
    tier: l.tier,
    effort: l.effort,
    inherited: l.effort !== null ? null : l.tier >= 1 && l.tier <= 5 ? 'policy' : 'fallback'
  }))

  const warnings = []
  warnings.push(...decision.warnings)
  if (widest > maxParallel && !solo) {
    warnings.push(
      `widest wave has ${widest} tasks; splitting into batches of ${maxParallel}`
    )
  }
  // Measured on the collapsed list and in lanes, because a lane is one agent:
  // a staircase the fold already removed, or a chain the lanes already folded,
  // is not a shape the operator still has to fix.
  if (laneCount >= 2 && waves.length > laneCount * 0.5) {
    warnings.push(
      `effectively serial: ${waves.length} waves for ${laneCount} implementation lane(s)`
    )
  }
  // One warning per fold, phrased by KIND. A cohesion fold is not a collision:
  // an operator reading "share a file" about seven path-disjoint tasks would go
  // looking for a file they do not share.
  for (const lane of lanes) {
    if (lane.kind === LANE_SOLO) {
      warnings.push(
        `solo lane: tasks ${lane.ids.join(', ')} run in that order on one opus agent — ` +
          `every section barrier and dependency edge is honoured by position in the lane`
      )
    } else if (lane.kind === LANE_COHESION) {
      warnings.push(
        `tasks ${lane.ids.join(', ')} are path-disjoint tier-${lane.tier} work in ` +
          `${laneWhere(lane.group)}; packed into one cohesion lane run by a single agent in that ` +
          `order (tier-${lane.tier} lane cap ${lane.cap})`
      )
    } else {
      warnings.push(
        `tasks ${lane.ids.join(', ')} share a file in ${laneWhere(lane.group)}; folded into one ` +
          `lane run by a single tier-${lane.tier} agent in that order`
      )
    }
  }
  for (const f of folded) {
    warnings.push(
      `task ${f.id} was a 1-task wave in group ${f.from}; folded into wave ${f.to} as a later ` +
        `batch — ordering is kept, the checkpoint is not`
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
      `task ${m.id} serialized in ${laneWhere(m.group)}: it claims ${m.path}, already claimed by ` +
        `${m.conflictsWith} — they run in one lane, in task-id order`
    )
  }

  // Named rather than left to be inferred from a batch boundary: an edge is the
  // one ordering signal in this planner an author wrote by hand, so an author
  // reading the plan has to be able to see it took effect. In solo mode the
  // batch boundary is gone and the edge is honoured by position in the lane, so
  // it matters even more that the plan says the edge was seen.
  for (const d of deferred) {
    warnings.push(
      solo
        ? `task ${d.id} declares dependsOn ${d.after.join(', ')}; it runs after them inside the ` +
          `solo lane rather than beside them`
        : `task ${d.id} declares dependsOn ${d.after.join(', ')}; it runs after them in ` +
          `${laneWhere(d.group)}, in a later batch or wave rather than beside them`
    )
  }

  return {
    maxParallel,
    mode: decision.mode,
    modeSource: decision.modeSource,
    modeReason: decision.modeReason,
    totalTasks: tasks.length,
    implCount,
    testCount: testTasks.length,
    waveCount: waves.length,
    laneCount,
    laneCaps,
    waves,
    testWave,
    clamped,
    promoted,
    serialized,
    deferred,
    lanes,
    effort,
    folded,
    rejectedPaths,
    warnings
  }
}

/**
 * A wave's tasks, one line each, with a lane header for anything folded.
 *
 * A single-task lane prints exactly the line it printed before lanes existed:
 * naming a "lane" for every task would bury the folds this is here to show.
 */
function formatBatches(wave) {
  const lines = []
  for (const batch of wave.batches) {
    for (const lane of batch) {
      if (lane.length > 1) {
        lines.push(
          `    lane [${laneModel(lane)}/T${laneTier(lane)}] ${lane.length} tasks, one agent, in order:`
        )
      }
      for (const t of lane) lines.push(`    - [${t.model}/T${t.tier}] ${t.id} ${t.description}`)
    }
  }
  return lines
}

/** Human-readable execution plan, for the skill to echo before it fans out. */
export function formatPlan(plan) {
  const lines = []
  // The mode opens the preview, before the shape it produced: an operator
  // looking at one lane for twelve tasks has to be told it was a decision, whose
  // decision it was, and why — at the top, not inferred from the absence of
  // batches further down.
  const source = plan.modeSource || 'default'
  lines.push(
    `mode: ${plan.mode || MODE_WAVES} (${source}${plan.modeReason ? `: ${plan.modeReason}` : ''})`
  )
  lines.push(
    `${plan.totalTasks} tasks → ${plan.waveCount} wave(s), ` +
      `${plan.implCount} impl + ${plan.testCount} test, max ${plan.maxParallel} parallel`
  )
  for (const wave of plan.waves) {
    const batchNote = wave.batches.length > 1 ? ` in ${wave.batches.length} batches` : ''
    lines.push(`  Wave ${wave.group}: ${wave.taskCount} task(s)${batchNote}`)
    for (const line of formatBatches(wave)) lines.push(line)
  }
  if (plan.testWave) {
    lines.push(`  Test wave: ${plan.testWave.taskCount} task(s)`)
    for (const line of formatBatches(plan.testWave)) lines.push(line)
  }
  for (const c of plan.clamped) {
    lines.push(`  clamped ${c.id}: ${c.from} → ${c.to} (tier ${c.tier})`)
  }
  // Beside the clamps, and phrased the same way, because they are the same kind
  // of fact read in opposite directions: the clamp is what the classifier was
  // not allowed to ask for, the promotion is what the planner decided anyway.
  for (const p of plan.promoted || []) {
    lines.push(`  promoted ${p.id}: ${p.from} → ${p.to} (tier ${p.tier}, solo lane)`)
  }
  for (const m of plan.serialized || []) {
    lines.push(
      `  serialized ${m.id}: same lane in ${laneWhere(m.group)} ` +
        `(${m.path} held by ${m.conflictsWith})`
    )
  }
  for (const d of plan.deferred || []) {
    lines.push(
      `  ordered ${d.id}: after ${d.after.join(', ')} in ${laneWhere(d.group)} (dependsOn)`
    )
  }
  // The over-split is still visible even though it no longer costs a
  // checkpoint — a plan that silently absorbed it would stop the authoring
  // problem from ever being fixed.
  for (const f of plan.folded || []) {
    lines.push(`  folded ${f.id}: 1-task wave ${f.from} → later batch of wave ${f.to}`)
  }
  // The fold that removed the spawns, named rather than left to be inferred
  // from an agent count that is smaller than the task count. Cohesion prints
  // under its own keyword and names the cap that bounded it, so an operator can
  // see both that the fold happened and what would have stopped it.
  for (const lane of plan.lanes || []) {
    if (lane.kind === LANE_SOLO) {
      lines.push(
        `  solo ${lane.ids.join(' → ')}: ${lane.ids.length} tasks, the whole change on one ` +
          `${lane.model}/T${lane.tier} agent`
      )
    } else if (lane.kind === LANE_COHESION) {
      lines.push(
        `  cohesion ${lane.ids.join(' → ')}: ${lane.ids.length} path-disjoint tasks in ` +
          `${laneWhere(lane.group)} on one ${lane.model}/T${lane.tier} agent (cap ${lane.cap})`
      )
    } else {
      lines.push(
        `  lane ${lane.ids.join(' → ')}: ${lane.ids.length} tasks in ${laneWhere(lane.group)} on ` +
          `one ${lane.model}/T${lane.tier} agent`
      )
    }
  }
  // The effort each listed lane routes at, named the way clamps are — an
  // inherited effort says which kind, so "tier 3 → inherited (policy)" reads
  // differently from "tier unreadable → inherited (fallback)".
  for (const e of plan.effort || []) {
    const chosen =
      e.effort === null
        ? `inherited (${e.inherited === 'fallback' ? 'tier unreadable' : 'by policy'})`
        : e.effort
    lines.push(`  effort ${e.ids.join(' → ')}: ${chosen} (tier ${e.tier})`)
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
  // One lane is one agent, however many tasks it carries. Billing this by task
  // is what made the fold invisible: the whole point of a lane is that four
  // tasks in it cost one spawn prefix, not four.
  const implementers = allWaves.reduce((n, w) => n + waveLanes(w).length, 0)
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

// ---------------------------------------------------------------------------
// Handoff evidence audit
// ---------------------------------------------------------------------------
//
// `validateHandoff` checks that an evidence entry has locator SHAPE. Shape
// alone is satisfied by inventing `lib/nowhere.mjs:1`, which is exactly the
// hole `lib/review-core.mjs` closed for review findings by adding a second,
// independent condition: the cited path must be one that actually changed.
// This is that condition, applied to the second surface, with the same
// deliberate ceilings:
//
//   - Path membership only. The cited LINE is never required to exist — a
//     locator may name a line the same wave later moved or deleted, and
//     rejecting it would be a false rejection of a true claim.
//   - No semantic judgement. Whether the cited span supports the summary needs
//     a model, and a model there recreates the unverified-claim problem one
//     layer down.
//
// AND IT NEVER GATES. The verdict is recorded and read; it does not decide
// whether a task succeeded, whether a wave proceeds, or whether the run halts.
// An unconfirmed packet is still handed to the next wave, because a report with
// unverifiable evidence is still more information than no report — and because
// membership here is run-scoped, not task-scoped (see `source` below), so a
// halt built on it would stop good runs.

/** Every locator names a path in the changed-path set. */
export const AUDIT_CONFIRMED = 'confirmed'
/** At least one locator names a path the set does not contain. */
export const AUDIT_UNCONFIRMED = 'unconfirmed'
/** The check could not run. NOT a synonym for failure — see below. */
export const AUDIT_NOT_AUDITED = 'not-audited'

/** Does one discrete locator name a path in `index`? Shape, then membership. */
function locatorMatches(entry, index) {
  if (typeof entry !== 'string' || !EVIDENCE_LOCATOR.test(entry)) return false
  const path = locatorPath(entry)
  return path !== null && index.has(path)
}

/**
 * Audit one handoff packet's evidence against the paths that changed.
 *
 * Pure by construction: the path set is an ARGUMENT, never fetched. `lib/` has
 * no business running git, and the moment that matters is the caller's — at
 * `record-batch` the working tree still matches what the implementer just
 * claimed, and audited any later a `confirmed` verdict means nothing.
 *
 * `source` is load-bearing, not decoration. Auditing self-reported evidence
 * against a self-reported path set is a CONSISTENCY check — it catches an agent
 * that contradicts itself, not one that fabricates coherently. Recording the
 * two identically would present the weaker check as the stronger one, which is
 * the defect class this exists to remove. So the fallback is kept and labelled,
 * and an unlabelled path set is treated as `reported`: the weaker claim is the
 * safe default, because the failure mode of the other default is a lie.
 *
 * `reportedMatch` is the narrower cross-check kept separately. The observed set
 * is `git status` at record time, which mid-run is the accumulated diff of the
 * RUN, not of this task — tasks in a wave run concurrently against one working
 * tree, so no git question can attribute a path to a lane. Read together the
 * two fields say: the run demonstrably changed this path, and the task claimed
 * it. Collapsing them into one boolean would sell the aggregate as per-task
 * attribution.
 *
 * @param {unknown} packet a validated handoff packet
 * @param {unknown} changedPaths the path set to test against
 * @param {{source?: 'observed'|'reported', reportedPaths?: string[]}} [opts]
 * @returns {{verdict: string, source: string|null, reason: string,
 *            unmatched: string[], reportedMatch: boolean|null}}
 */
export function auditHandoffEvidence(packet, changedPaths, opts = {}) {
  const source = opts.source === 'observed' ? 'observed' : 'reported'
  const evidence =
    packet && typeof packet === 'object' && Array.isArray(packet.evidence) ? packet.evidence : []

  const index = diffIndex(changedPaths)
  const reported = diffIndex(opts.reportedPaths)
  // `null` means "the task reported no paths", which is not the same fact as
  // "the task reported paths and none of them match".
  const reportedMatch =
    reported && evidence.length ? evidence.every(e => locatorMatches(e, reported)) : null

  const verdict = (verdict, reason, unmatched = []) => ({
    verdict,
    // Named only when a path set was actually used. A `not-audited` verdict
    // that still named a source would read as a check that ran.
    source: verdict === AUDIT_NOT_AUDITED ? null : source,
    reason,
    unmatched,
    reportedMatch
  })

  // Evidence is optional in the packet schema, so a packet without it is not
  // malformed — there is simply nothing to audit. Reporting that as
  // `unconfirmed` would blame a packet for a claim it never made.
  if (!evidence.length) {
    return verdict(AUDIT_NOT_AUDITED, 'the packet cites no evidence locators')
  }
  if (!index) {
    return verdict(
      AUDIT_NOT_AUDITED,
      'no changed-path set was available from either the observed source or the task\'s own report'
    )
  }

  const unmatched = evidence.filter(e => !locatorMatches(e, index))
  if (unmatched.length) {
    return verdict(
      AUDIT_UNCONFIRMED,
      `${unmatched.length} of ${evidence.length} locator(s) name a path absent from the ` +
        `${source} changed-path set: ${unmatched.map(e => JSON.stringify(e)).join(', ')}`,
      unmatched
    )
  }
  return verdict(
    AUDIT_CONFIRMED,
    `all ${evidence.length} locator(s) name a path in the ${source} changed-path set`
  )
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

/**
 * The shape a run was planned in. Absent means waves: every state written before
 * modes existed describes a waves run, and defaulting the other way would brief
 * a whole fleet of ordinary lanes as if each held a whole change.
 */
function runMode(state) {
  return state && state.mode === MODE_SOLO ? MODE_SOLO : MODE_WAVES
}

function mutable(state) {
  requireState(state)
  if (state.halt) {
    fail(`run has halted (${state.halt.reason}); no further results can be recorded`)
  }
  const next = cloneState(state)
  // `record-batch` reports the batch it just recorded beside the state it
  // returns, so a caller that piped that stdout into its state file carries one
  // batch's outcomes on it. They describe work that is now history: a run
  // resumed from such a file must not present them as this batch's verdict.
  delete next.recorded
  return next
}

/** "wave 2" / "the test wave" — used in every reason string, so it lives once. */
function label(wave) {
  if (!wave) return 'the end of the run'
  return wave.kind === 'test' ? 'the test wave' : `wave ${wave.group}`
}

function makeWave(kind, group, tasks, maxParallel, laneCaps) {
  const serialized = []
  // A state written before the table existed carries no `laneCaps`. It reads as
  // the published table rather than as an error, the same fallback the
  // outcome-audit fields already make: a run resumed across an upgrade must
  // still be able to replan.
  const caps = laneCaps && typeof laneCaps === 'object' ? laneCaps : LANE_CAPS.byTier
  return {
    kind,
    group,
    taskCount: tasks.length,
    // A replanned group is laned under the SAME caps the rest of the run was
    // planned with, read off the state. Falling back to the current published
    // table would let a replan mid-run produce lanes of a different length than
    // the plan the run started from — including under a uniform override, which
    // is already folded into the table the state carries.
    //
    // And it is layered by `dependsOn` the way initial planning is, so a
    // revision that carries edges keeps their order. The layers become later
    // BATCHES here rather than separate waves, because a replan revises one
    // group into one wave — a later batch expresses the same ordering, which is
    // what the singleton fold would have collapsed the extra wave into anyway.
    batches: layerByDependencies(tasks).flatMap(
      layer => collisionAwareChunk(layer, maxParallel, serialized, group, caps).batches
    )
  }
}

// Accept a wave straight out of planWaves. The plan's batch boundaries are the
// answer, not a suggestion: a batch wider than this run's ceiling is SPLIT, and
// nothing is ever merged forward into an earlier batch.
//
// This used to flatten the wave and re-run the collision packer, which was
// harmless while every later batch existed because of a path collision — the
// packer would rebuild exactly the same boundary. It stopped being harmless
// once the singleton fold started appending later batches whose task has a
// *disjoint* path: re-packing would find no collision, see room under
// maxParallel, and pull that task into batch 0 — running it in parallel with
// the work it was ordered after. A higher runtime cap is not permission to
// undo an ordering the plan recorded.
function adoptWave(wave, kind, index, maxParallel, warnings) {
  if (!wave || typeof wave !== 'object') fail(`plan wave ${index} must be an object`)
  if (!Array.isArray(wave.batches)) fail(`plan wave ${index} must have a "batches" array`)
  wave.batches.forEach((batch, i) => {
    if (!Array.isArray(batch)) fail(`plan wave ${index} batch ${i} must be an array of lanes`)
    batch.forEach((lane, j) => {
      if (!Array.isArray(lane)) {
        fail(`plan wave ${index} batch ${i} lane ${j} must be an array of tasks`)
      }
    })
  })
  const group = kind === 'test' ? null : wave.group
  if (kind !== 'test' && !Number.isInteger(group)) {
    fail(`plan wave ${index} must have an integer "group"`)
  }

  // Width is measured in lanes, because a lane is what runs concurrently. A
  // batch of three lanes is three agents whatever the lanes hold.
  const batches = []
  let split = false
  for (const batch of wave.batches) {
    const lanes = batch.filter(lane => lane.length)
    if (!lanes.length) continue
    if (lanes.length > maxParallel) {
      split = true
      batches.push(...chunk(lanes, maxParallel))
    } else {
      batches.push(lanes.map(lane => lane.slice()))
    }
  }
  if (split) {
    warnings.push(
      `${label({ kind, group })}: batches wider than ${maxParallel} were re-split to fit the cap`
    )
  }

  return {
    kind,
    group,
    taskCount: batches.reduce((n, b) => n + b.reduce((m, lane) => m + lane.length, 0), 0),
    batches
  }
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
 * @param {{maxParallel?: number, change?: string}} [opts] `maxParallel` is a
 *   runtime override, clamped by `clampParallel`, because over-asking is a
 *   preference, not a mistake. `change` names the change this run ships and is
 *   carried on the state for the life of the run.
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
    // The change this run ships, travelling the same route as `runId` for the
    // same reason: a per-invocation flag that every later wave-state call has to
    // remember is a flag that gets dropped, and it was — every recorded event in
    // this repo read `unnamed`. Named once, here. Absent stays absent (the JSON
    // clone below drops an undefined key), because a run with no name must still
    // run; `appendRunLogEvent` bounds and defaults it at the write site, which is
    // where the log's field limits already live.
    change: typeof opts.change === 'string' && opts.change.trim() ? opts.change.trim() : undefined,
    maxParallel,
    // The shape this run was planned in, so `wave-state next` can tell the host
    // how to brief the implementer without the host re-deciding it. A state
    // written before modes existed is a waves run — the only thing it could have
    // been.
    mode: plan.mode === MODE_SOLO ? MODE_SOLO : MODE_WAVES,
    // Carried so a replan lanes its revision the way the plan was laned — the
    // EFFECTIVE table, so a uniform override the plan was built under survives
    // into the revision rather than silently lapsing back to the published caps.
    laneCaps:
      plan.laneCaps && typeof plan.laneCaps === 'object'
        ? { ...plan.laneCaps }
        : { ...LANE_CAPS.byTier },
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
    // What each task REPORTED changing, keyed by task id. Requested from every
    // implementer and, until this existed, thrown away — while being the only
    // cross-check available against the packet's own evidence. A report, never
    // presented as evidence that those paths changed.
    reportedPaths: {},
    // One `auditHandoffEvidence` verdict per stored packet. Read by a human at a
    // halt and by later scoring; read by no control-flow decision anywhere.
    evidenceAudits: {},
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

  // On every payload, not only the one that dispatches an implementer. The host
  // reads a step and nothing else, so a field present on some steps and absent
  // on others is a field the host has to defend against — and a solo run whose
  // step forgot to say so briefs its one agent as an ordinary lane.
  const mode = runMode(state)

  if (state.halt) {
    return {
      action: 'halt',
      mode,
      kind: state.halt.kind,
      reason: state.halt.reason,
      failures: state.failures,
      unresolved: state.unresolved
    }
  }

  const { waveIndex, batchIndex, phase } = state.cursor
  const wave = state.waves[waveIndex]
  if (!wave) return { action: 'done', mode, summary: summarize(state) }

  const following = state.waves[waveIndex + 1] || null

  if (phase === 'verify') {
    const used = state.verifyFailures
    return {
      action: 'verify',
      wave: wave.group,
      waveIndex,
      waveKind: wave.kind,
      // The ONE step whose `mode` is not the run's plan shape: this field named
      // the verify attempt (initial or fix) before plan modes existed, and both
      // hosts branch on it. The run mode is deliberately not echoed here rather
      // than shadowed by it — a solo plan is one wave, so it never reaches an
      // inter-wave verify, and nothing downstream of this step briefs an
      // implementer. `runMode` carries it for a reader that wants both.
      mode: used === 0 ? 'initial' : 'fix',
      runMode: mode,
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
        mode,
        revisableGroups: revisable,
        replansUsed: state.replansUsed,
        replansRemaining: LIMITS.replansPerRun - state.replansUsed
      }
    }
  }

  return {
    action: wave.kind === 'test' ? 'test-wave' : 'run-batch',
    mode,
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
  const audits =
    state.evidenceAudits && typeof state.evidenceAudits === 'object' ? state.evidenceAudits : {}
  const out = []
  for (const t of waveTasks(previous)) {
    const packet = stored[t.id]
    if (!packet) continue
    // The verdict travels with the packet it is about, so a reader of the step
    // is never left inferring which audit belongs to which report. It does NOT
    // change what the next implementer is told: the prompt renders taskId,
    // status, summary, evidence, next and blocker, and an unconfirmed packet
    // renders byte-identically to a confirmed one. Annotating the prompt would
    // tell an implementer to distrust its predecessor on an aggregate signal
    // (design.md — Decision 6).
    const audit = audits[t.id]
    out.push(audit ? { ...packet, audit } : packet)
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
  // Deduplicated: a group split into dependency layers occupies more than one
  // wave, and offering the same group number twice would read as two things a
  // replan could revise separately when a revision replaces the whole group.
  return [
    ...new Set(
      state.waves
        .filter((w, i) => i >= from && w.kind === 'impl' && !state.executedGroups.includes(w.group))
        .map(w => w.group)
    )
  ]
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
    // What the agent says it touched, kept as a REPORT. It is the cross-check
    // against the packet's own evidence, and it cannot be recovered later once
    // the working tree moves on — which is why it is retained here rather than
    // dropped as it was. Never substituted for by the evidence locators: a task
    // that reported no paths reported no paths.
    const filesChanged = Array.isArray(t.filesChanged)
      ? t.filesChanged.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim())
      : []
    const checked = validateHandoff(t.id, t.handoff)

    // A task that already reported failure does not owe a packet. ship.js turns
    // a null agent result into ok:false with no handoff, and rewriting that as
    // an invalid-handoff error would replace the reason it actually failed with
    // a complaint about the report it was never in a position to write. A valid
    // packet on a failed task is still kept — a blocked task's blocker is the
    // most useful thing the next wave could be handed.
    if (!t.ok) {
      return {
        id: t.id,
        ok: false,
        error,
        filesChanged,
        handoff: checked.ok ? checked.handoff : null
      }
    }

    // Claiming success is what obliges a report. Fail closed.
    if (!checked.ok) {
      return {
        id: t.id,
        ok: false,
        error: `invalid handoff: ${checked.error}`,
        filesChanged,
        handoff: null
      }
    }
    return { id: t.id, ok: true, error, filesChanged, handoff: checked.handoff }
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
 * @param {{tasks: Array<{id: string, ok: boolean, error?: string,
 *          filesChanged?: string[]}>, replanSuggested?: boolean}} result
 * @param {{changedPaths?: string[]}} [opts] the OBSERVED changed-path set, read
 *   from version control by the caller at this moment — the only point at which
 *   the working tree still matches what the implementer just claimed. It is a
 *   separate argument rather than a field on `result` on purpose: `result` is
 *   written by the agent being audited, and an audit whose own input the subject
 *   supplies is not an audit. Absent, each task is audited against its own
 *   reported paths and the verdict says so.
 * @returns {object} a new state; `state` is left untouched
 */
export function recordBatchResult(state, result, opts = {}) {
  const next = mutable(state)
  const wave = next.waves[next.cursor.waveIndex]
  if (!wave || next.cursor.phase !== 'batch') {
    fail('recordBatchResult called while the run is not waiting on a batch — ask nextStep first')
  }

  const tasks = normalizeTaskResults(result)
  // An in-flight state.json written before handoffs existed has no such key.
  if (!next.handoffs || typeof next.handoffs !== 'object') next.handoffs = {}
  // Same guard, same reason: a state written before these fields existed is
  // initialized, never treated as malformed. (design.md — Migration Plan.)
  if (!next.reportedPaths || typeof next.reportedPaths !== 'object') next.reportedPaths = {}
  if (!next.evidenceAudits || typeof next.evidenceAudits !== 'object') next.evidenceAudits = {}

  // Resolved once per batch: git's answer is about the working tree, not about
  // one task, so asking it per task would be the same answer at a higher cost
  // and would imply an attribution it cannot make.
  const observed = Array.isArray(opts.changedPaths)
    ? opts.changedPaths.filter(p => typeof p === 'string' && p.trim())
    : []

  for (const t of tasks) {
    // Stored for every task that was actually reported on, including a failed
    // one: what a failed task touched is exactly what the next reader needs.
    next.reportedPaths[t.id] = t.filesChanged
    if (t.handoff) {
      next.handoffs[t.id] = t.handoff
      // Recorded, never gated on. Nothing below this line reads it.
      next.evidenceAudits[t.id] = auditHandoffEvidence(
        t.handoff,
        observed.length ? observed : t.filesChanged,
        { source: observed.length ? 'observed' : 'reported', reportedPaths: t.filesChanged }
      )
    }
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

// ---------------------------------------------------------------------------
// What a batch recorded
// ---------------------------------------------------------------------------
//
// `recordBatchResult` already adjudicates every task — an invalid or oversized
// packet fails it, a lane result missing an outcome fails the whole lane — and
// then tells its caller nothing but the next action. So a caller learned what
// to do next and never learned what had just been decided, and both ship hosts
// ticked checkboxes and counted waves from the agent's own claim instead. That
// is how five tasks the machine failed got ticked beside a halt naming them.
//
// The delta is DERIVED from two states rather than stored on one: `recorded`
// describes one batch, and a durable field holding it would be read as current
// by a run resumed a day later.

/** A task the batch recorded as done. */
export const OUTCOME_OK = 'ok'
/** A task the batch adjudicated as failed, with the reason it was failed for. */
export const OUTCOME_FAILED = 'failed'
/**
 * A task in the batch that no result accounted for. Distinct from failed on
 * purpose: it is ticked nowhere and counted in no failure budget.
 */
export const OUTCOME_NOT_ATTEMPTED = 'not-attempted'

/** An adjudication reason travels through an agent, so it is a string, not a log. */
const MAX_OUTCOME_REASON = 300

function shortReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (!text) return undefined
  return text.length > MAX_OUTCOME_REASON ? `${text.slice(0, MAX_OUTCOME_REASON - 1)}…` : text
}

/** The task ids the batch at `state`'s cursor was supposed to account for. */
function plannedBatchIds(state) {
  const wave =
    state && Array.isArray(state.waves) && state.cursor
      ? state.waves[state.cursor.waveIndex]
      : null
  const batch = wave && Array.isArray(wave.batches) ? wave.batches[state.cursor.batchIndex] : null
  if (!Array.isArray(batch)) return []
  return batch
    .flat(1)
    .map(t => (t && typeof t.id === 'string' ? t.id : null))
    .filter(Boolean)
}

/**
 * The per-task outcomes one `recordBatchResult` call recorded.
 *
 * Pure, and derived: `recordBatchResult` appends to `completed` and `failures`,
 * so this batch's verdicts are the tails of both, and a planned task in neither
 * was never attempted. Nothing here reads a field the recorder stored, and
 * nothing here is written back onto a state.
 *
 * @param {object} before the state passed to `recordBatchResult`
 * @param {object} after the state it returned
 * @returns {Array<{id: string, outcome: string, reason?: string}>} this batch's
 *   outcomes only — never the run's accumulated history. Ordered by the plan,
 *   with anything recorded that the plan did not name appended after it.
 */
export function batchOutcomes(before, after) {
  const prevCompleted = before && Array.isArray(before.completed) ? before.completed.length : 0
  const prevFailures = before && Array.isArray(before.failures) ? before.failures.length : 0
  const completed = after && Array.isArray(after.completed) ? after.completed.slice(prevCompleted) : []
  const failures = after && Array.isArray(after.failures) ? after.failures.slice(prevFailures) : []

  const outcomes = new Map()
  for (const id of completed) {
    if (typeof id === 'string') outcomes.set(id, { id, outcome: OUTCOME_OK })
  }
  for (const f of failures) {
    if (!f || typeof f.id !== 'string') continue
    const reason = shortReason(f.error)
    outcomes.set(f.id, reason ? { id: f.id, outcome: OUTCOME_FAILED, reason } : { id: f.id, outcome: OUTCOME_FAILED })
  }

  const ordered = []
  for (const id of plannedBatchIds(before)) {
    if (ordered.some(o => o.id === id)) continue
    ordered.push(
      outcomes.get(id) || {
        id,
        outcome: OUTCOME_NOT_ATTEMPTED,
        reason: 'the batch result accounted for no outcome for this task'
      }
    )
  }
  for (const [id, outcome] of outcomes) {
    if (!ordered.some(o => o.id === id)) ordered.push(outcome)
  }
  return ordered
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
      // A group occupies more than one wave once dependency layers split it, and
      // those waves are contiguous. Every one of them is replaced by the single
      // revised wave: leaving a later layer in place would run the tasks the
      // revision superseded after the tasks that replaced them.
      const spans = next.waves.filter(w => w.kind === 'impl' && w.group === revision.group).length
      if (!revision.tasks.length) next.waves.splice(at, spans)
      else {
        next.waves.splice(
          at,
          spans,
          makeWave('impl', revision.group, revision.tasks, next.maxParallel, next.laneCaps)
        )
      }
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
    next.waves.splice(insertAt, 0, makeWave('impl', revision.group, revision.tasks, next.maxParallel, next.laneCaps))
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

/** Tasks across a batch of lanes — one agent per lane, N tasks inside them. */
function countTasks(batch) {
  return (Array.isArray(batch) ? batch : []).reduce(
    (n, lane) => n + (Array.isArray(lane) ? lane.length : 0),
    0
  )
}

function describeStep(step) {
  switch (step.action) {
    case 'run-batch':
      return `run wave ${step.wave} batch ${step.batchIndex + 1}/${step.batchCount} ` +
        `(${step.tasks.length} lane(s), ${countTasks(step.tasks)} task(s), ` +
        `max ${step.maxParallel} parallel)`
    case 'test-wave':
      return `run the test wave, batch ${step.batchIndex + 1}/${step.batchCount} ` +
        `(${step.tasks.length} lane(s), ${countTasks(step.tasks)} task(s))`
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
  // The audit is recorded, so it has to be readable — a verdict nobody ever sees
  // is a verdict that may as well not exist. Printed as a tally plus a line per
  // packet that did NOT confirm: a run's confirmed packets are the boring case
  // and listing all of them would bury the two that are not.
  //
  // "recorded only" is in the banner on purpose. Anyone reading a halt beside a
  // column of `unconfirmed` will wonder whether the audit caused it; the line
  // itself answers that, at the one moment the question gets asked.
  const audits = Object.entries(
    state.evidenceAudits && typeof state.evidenceAudits === 'object' ? state.evidenceAudits : {}
  ).filter(([, a]) => a && typeof a === 'object')
  if (audits.length) {
    const tally = { [AUDIT_CONFIRMED]: 0, [AUDIT_UNCONFIRMED]: 0, [AUDIT_NOT_AUDITED]: 0 }
    for (const [, a] of audits) if (a.verdict in tally) tally[a.verdict] += 1
    lines.push(
      `  evidence audit: ${tally[AUDIT_CONFIRMED]} confirmed, ` +
        `${tally[AUDIT_UNCONFIRMED]} unconfirmed, ${tally[AUDIT_NOT_AUDITED]} not audited ` +
        `(recorded only — never gates the run)`
    )
    for (const [id, a] of audits) {
      if (a.verdict === AUDIT_CONFIRMED) continue
      lines.push(
        `    ${a.verdict} ${id}${a.source ? ` [${a.source}]` : ''}: ${a.reason}`
      )
    }
  }
  for (const w of state.warnings) lines.push(`  warning: ${w}`)
  if (state.halt) lines.push(`HALTED: ${state.halt.reason}`)
  return lines.join('\n') + '\n'
}
