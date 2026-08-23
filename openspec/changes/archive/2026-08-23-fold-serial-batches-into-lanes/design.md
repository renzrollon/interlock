## Context

See proposal.md — Why. The mechanics that constrain the approach:

`collisionAwareChunk` (`lib/waves.mjs`) greedily fills a batch, claiming each task's canonical paths in a `Map`. A task whose path is already claimed is pushed to `deferred` and recorded in `serialized[]` as `{id, group, path, conflictsWith}`. The same `deferred` list also receives tasks pushed out by `batch.length >= maxParallel`. Both kinds land in the next batch, which is why the two are indistinguishable downstream today — and why the fix has to separate them before it can fold anything.

`workflows/ship.js` consumes `next.remainingBatches` and runs `pipeline(tasks, task => agent(...))` per batch. It has no filesystem and no module imports; everything it knows arrives through `wave-state next` or a CLI call made by an agent it spawned. Any structure lanes need at execution time must therefore travel on the plan and the run state, not be recomputed in the script.

`planWaves` output is already persisted at `.claude/ship/plan.json`, and `.claude/ship/` is gitignored — machine-local, surviving `/clear` and session restarts, which is the correct lifetime for a plan coupled to an uncommitted working tree.

## Goals / Non-Goals

**Goals:**

- One agent per lane rather than one per task, so a chain of same-file edits pays one spawn prefix.
- Preserve every safety property the batch model provided: no two concurrent writers of one file, no reordering of dependent work, no silent task loss.
- Make the expensive classifier step conditional on evidence that its output is still valid.
- Keep the degraded path identical to today's behaviour in both features, so neither can make a run worse than it is now.

**Non-Goals:**

- Resuming a partially executed run. This reuses the *plan*; `state.json` is still created fresh. Mid-run resume is a separate problem with a different failure model.
- Co-scheduling two writers of one file. Lanes make same-file work cheaper, not concurrent.
- Changing `classified.json`. The classifier's contract is untouched.
- Any new runtime dependency. This change adds no library, so there is no version to pin.

## Decisions

### D1 — Transpose the wave: batches hold lanes, not tasks

A wave becomes `batches: Lane[][]`, where `Lane = Task[]`. Batches still run sequentially; lanes within a batch still run in parallel; tasks within a lane now run sequentially inside one agent. Today's behaviour is exactly the case where every lane has length 1.

*Why this shape over adding a parallel `lanes` field:* two representations of the same schedule drift. The batch list is already the execution unit carried through `createRunState`, `nextStep` and `remainingBatches`; widening its element type changes one structure rather than introducing a second one that must be kept consistent with it.

*Alternative rejected:* have `ship.js` derive lanes itself from `serialized[]`. The script would need `serialized` on every `next` payload and would be re-deriving a scheduling decision the planner owns — the same "policy in the script" mistake the CLI split exists to prevent.

### D2 — A lane is a connected component over canonical-path collisions

Build lanes from the claim graph `collisionAwareChunk` already computes. Two tasks are joined when they share a canonical path; a task claiming two paths merges the components those paths belong to. Comparison stays on `canonicalizePath` from `lib/risk.mjs` — the existing single transform, per `openspec/specs/ship/wave-isolation`. No second path form is introduced.

Component membership, not pairwise chaining, is the right primitive: with tasks A[x,y], B[x], C[y], pairwise chaining could put B and C in different lanes that both run beside A's writes.

### D3 — Width-deferral and collision-deferral must be separated first

Today both push onto `deferred`. Only collision-deferred tasks may join a lane. A task deferred purely because the batch was full is path-disjoint from everything in it — folding it into another task's agent would serialize work the planner deliberately parallelized, turning a throughput cap into a latency penalty.

This is the one place the current code must be split before anything else can be built on it.

### D4 — Intra-lane order is task-id order; lane tier is the maximum

Within a lane, sort by task id. `byHardestFirst` continues to order *lanes* for batch placement but must not reorder inside one — sequential same-file work is ordered work, and tier is not a proxy for dependency order. The lane dispatches on the model implied by its highest tier, because a lane is one agent and that agent must be capable of its hardest task.

*Consequence, accepted:* a lane pairing a tier-1 task with a tier-5 task runs the trivial task on an expensive model. Folding is driven by file collisions, which correlate with similar tiers, so this is expected to be rare; the alternative — splitting a lane on tier — would reintroduce the spawn we are removing.

### D5 — `maxTasksPerAgent` in `lib/limits.mjs`, with a real reader

The cap bounds lane length. A component longer than the cap splits into sequential lanes. Per `openspec/specs/ship/cap-authority`: stated once, read from that statement by `lib/waves.mjs`, printed by `interlock limits`, and covered by the existing test that fails on a cap nothing reads — a value-pinning test does not count.

Proposed default **4**. Rationale: the workflow runtime's replay discards every agent started after the first unfinished one, so a lane is also the unit of work an interruption can lose. Four bounds that loss while capturing the common TDD staircase.

*This cap is also the rollback lever.* Setting it to 1 reproduces one-agent-per-task exactly, which is why D1 keeps that case byte-identical.

### D6 — Lane results report per task, with `not-attempted` distinct from `failed`

A lane returns `tasks: [{ id, outcome: 'ok'|'failed'|'not-attempted', handoff? }]`. The distinction is load-bearing in two places: `interlock tasks tick` must not tick a task nobody ran, and `taskFailureHalt` must not count one. Collapsing the two would let a single early failure in a 4-task lane spend the entire two-failure budget and halt a run that has one real problem.

A lane result missing outcomes for tasks it was given fails all of them closed — consistent with how a missing or malformed handoff packet is already treated.

### D7 — Intra-lane handoff packets are not passed between tasks

Task *k+1* shares an agent and a context window with task *k*; it does not need a schema-validated packet to learn what just happened. Packets are still produced per attempted task, because the *next wave* and the tick accounting consume them. This is a token saving that falls out of the design rather than one that has to be engineered.

### D8 — Plan fingerprint: full artifact content, normalized checkboxes, format version

The fingerprint covers `proposal.md`, `design.md`, every delta spec, and `tasks.md` — with `- [ ]` and `- [x]` normalized to one form — plus the change name, `maxParallel`, `maxTasksPerAgent`, and a plan format version.

Normalizing the checkbox is the decision that makes reuse worth anything: without it the first `tasks tick` invalidates the plan and reuse never fires after wave 1. Hashing the surrounding text unnormalized keeps the protection that matters — adding, removing, reordering or rewording a task still invalidates.

The format version is separate from the content hash because a plan can be perfectly current and still be shaped for a reader that no longer exists — which is precisely what this change does to any plan written before it.

### D9 — Reuse narrows the plan; it does not resume a run

A reused plan is filtered to incomplete tasks, emptied lanes and waves are dropped, and `wave-state create` builds fresh run state from the remainder. Order is preserved because filtering a lane preserves the order of what is left.

Narrowing is safe without re-planning: removing a completed task cannot introduce a collision, and lanes are already path-disjoint, so the remaining schedule holds.

### D10 — Every failure to prove reuse falls back to planning, and the run says which path it took

Missing plan, missing or unreadable fingerprint, unparseable plan, mismatch, or any error while checking → run the classifier. There is no condition under which a plan is reused without an affirmative match.

Note the direction of failure differs from `interlock ready`: there, failing closed means refusing to proceed; here it means doing the expensive-but-correct thing. That is why this can default on without a flag.

The summary states reuse-or-rebuild and the reason, including "no prior plan" — per `docs/06-why-it-works.md` §13, a run that silently changed its own cost is the failure mode the banner block exists to remove.

## Risks / Trade-offs

- **A lane is the unit an interruption can lose.** Replay caching stops at the first unfinished agent; a 4-task lane interrupted at task 3 re-runs all four. → Bounded by D5's cap, and the cap is tunable per repo. Net position still improves: fewer, shorter-lived agents beat many long-tailed ones for the same work.
- **A lane agent may drift across task boundaries**, doing task 3's work while nominally on task 2. The per-task isolation that made this structurally impossible is genuinely being traded away. → The lane prompt requires an outcome per task and stop-at-first-failure; per-task packets with evidence locators make drift visible in the record rather than silent. This narrows the risk; it does not eliminate it, and that is an honest cost of the change.
- **Two changes editing `lib/waves.mjs` concurrently.** `collapse-singleton-waves` rewrites batch construction in the same functions. → Sequence it first and treat its collapsed wave list as this change's input; do not implement both in one wave.
- **Checkbox normalization could mask an edit that only changes a marker.** → Only the marker is normalized; every other byte of the line is hashed, so a reworded task still invalidates.
- **A default of 4 is a judgement, not a measurement.** → It is a single cap with one reader, so retuning is a one-line change with a test, and 1 restores prior behaviour exactly.

## Migration Plan

1. Land `collapse-singleton-waves` first — it produces the multi-batch waves this change folds.
2. Split width-deferral from collision-deferral (D3) with no behaviour change: lanes of length 1 everywhere, all existing tests green. This is the reversible checkpoint.
3. Introduce lanes and the cap (D1, D2, D4, D5) with the cap defaulted to 1, so behaviour is still identical and only the shape has changed.
4. Raise the default to 4 and land the lane prompt and result schema (D6, D7).
5. Land plan reuse (D8, D9, D10) independently — it touches `ship.js` startup and the CLI, not the planner.

Rollback: set `maxTasksPerAgent` to 1 for lanes; plan reuse rolls back by deleting the stored fingerprint, which forces the existing path.

## Open Questions

- Whether `maxTasksPerAgent` should eventually derive from the tier of the lane (a tier-1 staircase tolerating a longer lane than a tier-4 one). Deferrable: it changes the value of one cap, not the specs, the approach, or the task breakdown.
- Whether the plan fingerprint should also cover the graph build, so a re-indexed repo re-plans. Deferrable and probably no — the graph informs implementers, not the schedule.
