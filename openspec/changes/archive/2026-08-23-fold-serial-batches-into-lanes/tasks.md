A `## N.` boundary here is a **dependency boundary**: sections run in order, tasks within a section are independent and may run in parallel. Sequential same-file work is one checkbox, not one per beat.

**Prerequisite:** land `collapse-singleton-waves` first (design.md Migration Plan step 1). It produces the multi-batch waves this change folds; implementing both against `lib/waves.mjs` concurrently will conflict.

## 1. Planner: separate deferral kinds, then build lanes

- [x] 1.1 In `lib/waves.mjs`, separate width-deferral from collision-deferral in `collisionAwareChunk` (D3), then build lanes as connected components over canonical-path collisions using the existing `canonicalizePath` and no second path form (D2). Order tasks within a lane by task id and set the lane's tier to the maximum over its tasks (D4). Widen a wave's `batches` from `Task[][]` to `Lane[][]`, keeping a one-task lane behaviourally identical to today (D1). Split any component longer than `LIMITS.maxTasksPerAgent` into sequential lanes without dropping or reordering tasks (D5). Reject an absolute or repo-escaping predicted path as today rather than normalizing it into a lane. Compute `formatPlan`, `projectedWaveLoopAgents` and the effectively-serial warning from the lane count rather than `totalTasks`, and report every lane holding more than one task. Carry lanes through `makeWave`, `adoptWave`, `createRunState` and `nextStep` so `remainingBatches` holds lanes.
- [x] 1.2 Add `maxTasksPerAgent` to `lib/limits.mjs` with a default of 1 for this section (raised in 3.1), and print it from `interlock limits` in `bin/interlock`. The reader is `lib/waves.mjs` from 1.1; do not add a test that only asserts its value, which `openspec/specs/ship/cap-authority` does not count as a reader.

## 2. Executor: dispatch one agent per lane

- [x] 2.1 In `workflows/ship.js`, fan the wave loop out over lanes instead of tasks — one `agent()` per lane, lanes within a batch in parallel, batches still sequential. Change `assembleImplementerPrompt` to take a lane: name every task in execution order, use the lane's tier for the context ladder and the tier 1–2 stop-on-green rule, instruct the agent to stop at the first task it cannot complete, and keep a one-task lane byte-identical to the current single-task text (D1). Replace the single-handoff result schema with per-task outcomes (`ok` / `failed` / `not-attempted`) each carrying its own packet for attempted tasks (D6, D7). Pass only `ok` ids to `interlock tasks tick`, and exclude `not-attempted` tasks from the accumulated task-failure count. Fail every task in a lane closed when the result omits outcomes for tasks it was given.

## 3. Raise the cap and document the fold

- [x] 3.1 Raise the `maxTasksPerAgent` default in `lib/limits.mjs` to 4 (D5), now that 1.1 and 2.1 make lanes real.
- [x] 3.2 In `docs/06-why-it-works.md` §5.1–5.2, name lanes next to `serialized`, correct the "one agent per task, always" statement, and state that the cap is the rollback lever because 1 reproduces the prior behaviour.

## 4. Plan reuse: fingerprint

- [x] 4.1 Add a plan-fingerprint module and its `bin/interlock` surface: compute a fingerprint over `proposal.md`, `design.md`, every delta spec and `tasks.md` with checkbox markers normalized to one form, plus the change name, `maxParallel`, `maxTasksPerAgent` and a plan format version; and check a stored fingerprint against a recomputed one (D8). Checking MUST report mismatch, absence, unreadability and format-version difference as distinct, named outcomes rather than a bare boolean, and MUST never raise in a way a caller could mistake for a match.

## 5. Plan reuse: wire it into the run

- [x] 5.1 In `workflows/ship.js`, make the `plan-waves` step conditional on an affirmative fingerprint match, reusing the stored plan when it matches and running the classifier otherwise (D10). When reusing, narrow the plan to incomplete tasks, drop lanes and waves left empty, preserve the order of what remains, and report no-remaining-work rather than creating an empty run (D9). Write the plan and its fingerprint after any classifier run. Add the reuse-or-rebuild line to the run summary with its reason, including the no-prior-plan case, and keep the banner strings greppable per `test/workflows.test.mjs`.

## 6. Tests

- [x] 6.1 In `test/spine/waves.test.mjs`, cover lane construction and scheduling: a three-task same-file chain becomes one lane; a width-deferred disjoint task stays its own lane and is not folded; `src/a.ts` and `./src/a.ts` land in one lane; a task claiming two paths merges two chains; no batch ever holds two lanes sharing a canonical path; a component over the cap splits into sequential lanes with every task present exactly once; a cap of 1 reproduces the pre-lane agent count; intra-lane order is task-id order even when tiers differ; a mixed-tier lane takes the maximum tier. Update every fixture that assumed `batches` holds tasks.
- [x] 6.2 In `test/spine/planner-prompt.test.mjs`, snapshot the assembled prompt for a single-task lane against the existing pre-lane fixtures unmodified, and add multi-task lane snapshots per tier. Assert the multi-task prompt names its tasks in order and carries the stop-at-first-failure instruction.
- [x] 6.3 In `test/workflows.test.mjs`, assert the wave loop spawns one agent per lane rather than per task; that a mid-lane failure ticks the earlier task, records the failure once, and leaves the later task unticked and uncounted; that a lane result missing per-task outcomes fails every task in the lane; and that `maxTasksPerAgent` has a non-test reader.
- [x] 6.4 Cover plan reuse: an unchanged change reuses and skips the classifier; ticking tasks between runs still matches; adding, removing, reordering or rewording a task invalidates; a differing format version does not reuse even when content matches; unreadable plan, unreadable fingerprint and absent plan each re-plan and each report a distinct reason; a reused plan drops completed tasks while preserving order; an all-complete plan reports no remaining work instead of an empty run.
