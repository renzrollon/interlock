## Why

A wave's batches run one after another and every task inside a batch gets its own agent (`workflows/ship.js` wave loop; `collisionAwareChunk` in `lib/waves.mjs`). When the planner finds a path collision it defers the losing task to the *next batch of the same wave* — so N tasks that all edit `auth.ts` become N batches of one task, and therefore N agent spawns. Those N tasks are already forced sequential, and they all read and write the same file. Parallelism gained: none. Context isolation gained: none, because isolating a task from the other edits to the file it is about to edit is not isolation. What is paid: N inherited spawn prefixes (~30k of system/MCP schemas plus ~10k of skill descriptions each, `docs/06-why-it-works.md` §5.1) and N independent reads of one file. A serial 22-task `tasks.md` pays that ~22 times.

The batch structure is a transpose away from the fix. Today a wave is a sequence of parallel batches; the work it actually describes is a set of parallel **lanes**, each internally sequential. One agent per lane costs one prefix per lane instead of one per task, and loses nothing the current shape was buying.

## What Changes

- **Lanes replace tasks as a wave's unit of execution.** `wave.batches[i]` becomes a list of *lanes* rather than a list of tasks, where a lane is an ordered task list. Today's behaviour is the degenerate case in which every lane holds exactly one task. Lanes within a batch run in parallel; tasks within a lane run sequentially in **one** agent.
- **Lanes are built from the collision graph that already exists.** `collisionAwareChunk` records every conflict as `{id, group, path, conflictsWith}`. A lane is a connected component over those canonical-path edges. No second path transform is introduced — `canonicalizePath` from `lib/risk.mjs` remains the only one.
- **Width-deferral and collision-deferral stop being the same thing.** A task deferred because `batch.length >= maxParallel` is path-disjoint from the batch and MUST remain its own lane; only collision-deferred tasks join an existing lane. Merging width-deferred tasks would destroy parallelism the planner intended.
- **Intra-lane order is authored order.** Tasks inside a lane run in task-id order, not `byHardestFirst` order. Sequential same-file work is ordered work; hardest-first stays a *lane*-placement heuristic only.
- **New cap `maxTasksPerAgent` in `lib/limits.mjs`.** A lane longer than the cap splits into multiple lanes that stay sequential relative to each other. Fat agents cost resume granularity — the workflow runtime's replay stops at the first unfinished agent and re-runs every agent started after it — so the cap bounds what one interruption can discard.
- **One handoff packet per task, not per agent.** A lane agent returns an array of `interlock.wave-handoff/1` packets. `maxHandoffChars` stays a per-packet cap; an invalid or oversized packet still fails its task closed.
- **Per-task outcomes inside a lane.** A lane reports each task as `ok`, `failed`, or `not-attempted`. Tasks after a failure in the same lane are `not-attempted`, which is distinct from failed: `interlock tasks tick` must not tick them and the `taskFailureHalt` accounting must not count them as failures.
- **Intra-lane handoffs are dropped.** Task *k+1* in a lane shares an agent and a context window with task *k*, so it needs no packet to learn what just happened. Packets are still produced for the next wave and for tick accounting.
- **Lane folding is reported.** `plan.lanes` (or equivalent) and `formatPlan` name every fold alongside the existing `serialized` reporting; the projected agent bill is computed from lanes.
- **The execution plan becomes a reusable handoff artifact.** `plan-waves` is the single most expensive fixed step in a run — it reads `proposal.md`, `design.md`, `tasks.md` and every delta spec in full, and it re-runs unconditionally on every `ship` invocation even when a plan for that change already exists on disk. The plan gains a fingerprint over the inputs it was derived from, and `ship` reuses a matching plan instead of re-deriving it — including in a later session, since `.claude/ship/` is machine-local and survives a `/clear` or a restart. A missing, stale, or unreadable plan re-plans, which is exactly today's behaviour, so the degraded path costs what the current path always costs and never yields a wrong plan.

No **BREAKING** CLI flags. `classified.json` is untouched — the classifier still emits tasks with `group` and `paths`; only the plan's execution shape changes.

## Capabilities

### New Capabilities

- `lanes`: How tasks that must run in order are grouped into a lane, capped, ordered, executed by a single agent, and reported per task. Covers lane construction from the canonical-path collision graph, lane disjointness, the `maxTasksPerAgent` cap, intra-lane ordering, and per-task outcome reporting including `not-attempted`.
- `plan-reuse`: When a previously derived execution plan may be reused instead of re-running the classifier. Covers the fingerprint over the plan's inputs, the conditions that invalidate it, reuse across sessions, and the requirement that every failure to establish a match falls back to re-planning rather than to reusing a plan of unknown provenance.

### Modified Capabilities

- `waves`: the consequence of a path collision changes from "later batch of the same wave" to "same lane"; a wave's batches hold lanes rather than tasks; the plan preview, the effectively-serial warning, and `projectedWaveLoopAgents` compute the agent bill from lanes rather than from `totalTasks`; the per-task handoff requirement becomes one packet per task returned by the lane rather than one per agent result.
- `implementer-prompts`: the assembled implementer prompt covers an ordered multi-task lane deterministically, and a lane of exactly one task assembles byte-identically to today's single-task prompt so existing snapshots do not churn.

## Impact

- `lib/waves.mjs` — `collisionAwareChunk` becomes lane construction; `makeWave` / `adoptWave` / `createRunState` / `nextStep` carry lanes; `formatPlan` and `projectedWaveLoopAgents` read them; `validateHandoff` gains an array form.
- `lib/limits.mjs` — `maxTasksPerAgent`, with a real reader in `lib/waves.mjs` (a value-pinning test does not count, per `openspec/specs/ship/cap-authority`).
- `bin/interlock` — `interlock limits` prints the new cap.
- `workflows/ship.js` — the wave loop fans out over lanes instead of tasks; `assembleImplementerPrompt` takes a lane; the implementer result schema carries an array of packets and per-task outcomes; `tasks tick` receives only `ok` ids. The `plan-waves` step becomes conditional on a fingerprint check, and the run reports which path it took.
- Plan reuse — a fingerprint written beside the plan under `.claude/ship/` (gitignored, machine-local, which is the correct scope for a plan coupled to an uncommitted working tree), plus the CLI surface that computes and checks it.
- `test/spine/waves.test.mjs`, `test/spine/planner-prompt.test.mjs`, `test/workflows.test.mjs` — lane fixtures, prompt snapshots for 1-task and N-task lanes, cap-reader assertion.
- `docs/06-why-it-works.md` §5.1–5.2 — name lanes next to `serialized`; correct the "one agent per task, always" statement.
- **Depends on** `collapse-singleton-waves` (in progress): that change folds 1-task implementation *waves* into batches of the previous wave, which is what produces the multi-batch waves this change then collapses into lanes. Treat its output as input; do not re-specify its fold.
- Out of scope: `resumeFromRunId` from the trampoline (a host-level replay cache, distinct from the plan artifact — and a trap, because the `plan-waves` prompt embeds only the change name, so it would cache-hit and return a pre-tick plan); which reasons halt a run; relaunch-after-halt behaviour, which `skills/ship/SKILL.md` already forbids; co-scheduling two writers of one file concurrently; the test-wave packer; resuming mid-wave execution state (`state.json`) — this change reuses the *plan*, not a partially executed run.
