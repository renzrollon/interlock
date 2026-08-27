## Context

The per-lane implementer spawn lives at `workflows/ship.js:1404`:

```js
const results = await pipeline(lanes, lane =>
  agent(assembleImplementerPrompt({ change, lane, previousHandoffs }), {
    label: laneLabel(lane),
    model: laneModel(lane),
    ...workerExtra,
    schema: lane.length === 1 ? SINGLE_TASK_SCHEMA : LANE_SCHEMA
  }))
```

All lanes in a batch run against one working tree. The planner (`lib/waves.mjs`) makes lanes in a batch path-disjoint over *canonical* paths (`laneCanonicalPaths`, connected components over `predictedPaths`), but its own comment is explicit: `paths` is a model's prediction, and "a task that edits a file it never declared" is invisible to the check. `README.md` states the honest consequence — the check "narrows the race rather than closing it."

The workflow runtime supports `opts.isolation:'worktree'` per `agent()` call: the agent runs in a fresh git worktree, auto-removed if unchanged, at ~200–500 ms + disk per agent. The ship engine (`lib/waves.mjs` second half) is a pure state machine; the workflow script (`workflows/ship.js`) is the only place with agent/shell/fs reach, so both the flag and the merge step are wired there, and the merge *logic* lives in a pure module the way `laneOutcomes` / `adjudicateBatches` do.

`laneLabel(lane)` is already documented as "stable across replays, so a resumed run cache-hits the lane it already ran" — it is the natural deterministic key for locating a lane's worktree.

## Goals / Non-Goals

**Goals:**
- Close the within-batch shared-write race outright by running each lane in its own worktree.
- Fold lane worktrees back deterministically, with a single stated conflict policy that halts on a real collision rather than resolving it.
- Keep the merge decision pure and replay-safe, matching the engine's existing "every transition returns new state, replays decide identically" discipline.
- Surface a prediction miss as a named halt (contended canonical path + two lane labels), preserving the contending worktrees for inspection.

**Non-Goals:**
- Isolation *between* batches or *between* waves — that already exists and is untouched.
- Any auto-merge, three-way merge, or last-writer-wins resolution. Explicitly refused (see Decisions).
- Changing the planner's lane/collision logic. `merge-lanes` reads `laneCanonicalPaths` / `laneLabel`; it does not alter membership.
- Cross-worktree isolation of *reads* — a lane reading a stale sibling file is a planning concern (ordering into a later wave), not a merge concern.
- Distributed or parallel merging. The fold is a single post-batch step.

## Decisions

**1. Add `isolation:'worktree'` to the per-lane spawn, gated behind an opt-in `--isolate-waves` flag — off by default.** `parseInvocation` gains `isolateWaves: has('isolate-waves')`, the same pattern `strict`/`review`/`handoff` already use. Unset, the run is byte-for-byte the current behavior: no worktree, no `merge-lanes` step, no new failure surface. Set, the per-lane spawn adds `isolation:'worktree'` and the batch routes through the `merge-lanes` step below before outcomes are recorded.

Reason for the flag, added after the trivial "one key" framing turned out to hide two real unknowns: (a) the workflow runtime does not document returning a spawned agent's worktree path from `agent()` the way the separate `EnterWorktree` tool does, so locating a lane's worktree requires the lane's own agent to self-report its working directory (see Decision 2 below) — a new contract on every implementer prompt, not a one-line flip; (b) that self-report only exists while the runtime has not auto-removed an unchanged worktree, which the merge step has to treat as "lane wrote nothing," not "worktree missing," or every no-op lane would falsely halt the run. Shipping this always-on would mean every ship run pays that surface immediately. Gating it lets the mechanism exist, be tested deliberately, and be dogfooded on real changes before it becomes the default — the same staged-rollout shape `--strict` already models for review/handoff/conformance.

**2. `merge-lanes` is a new deterministic CLI command backed by a pure module.** `bin/interlock merge-lanes` + `lib/merge-lanes.mjs`. The module takes the batch's lanes (identified by label) and each lane's already-observed changed-file set, and computes: the pairwise canonical-path intersection across lanes, and a fold decision (`clean` | `collision` | `error`). `bin/interlock` performs the git plumbing; `lib/merge-lanes.mjs` owns the *decision* and is pure — no fs, no clock, no random — exactly like `adjudicateBatches`.

Locating the worktree itself is not the runtime's job to hand back and not ours to guess: each lane's implementer prompt is extended (only when `--isolate-waves` is set) to report its own working directory as `worktreePath` in its structured result — a fact the agent can observe with its own Bash tool (`pwd`), not a path the orchestrator predicts. `workflows/ship.js` collects `{ label, worktreePath }` per lane and hands that, plus the shared-tree base commit, to the `merge-lanes` ping.

`bin/interlock merge-lanes` then does the git plumbing per lane: `git -C <worktreePath> diff --name-status <base>`. Three outcomes, not two: (1) the path exists and diffs cleanly — a real changed-file set, possibly empty; (2) the path does not exist AND the lane's own report claimed no files changed — treated as an empty-write lane per the runtime's documented auto-removal of unchanged worktrees, not an error; (3) the path does not exist but the lane reported changes, or `worktreePath` was never reported, or `git diff` fails for any other reason — an unresolved lane, named, per the "worktree could not be located" halt. Only case (3) reaches `mergeDecision` as an unresolved label; cases (1) and (2) both produce a `changedByLane` entry (possibly `[]`).

`workflows/ship.js` gains a `merge-lanes` step, only when `isolateWaves` is set, after each batch's implementers return and before the batch outcomes are recorded, transcribed by a ping the same way other CLI steps are.

**3. Conflict policy: disjoint → apply union; contended → HALT.** Lanes in a batch are path-disjoint by the planner's construction, so the *expected* fold is zero-conflict. The worktree exists for the case the prediction was wrong: two lanes actually wrote the same canonical path. There, `merge-lanes` halts, names the contended canonical path(s) and the two lane labels, applies nothing, and records the batch as not folded. It never applies last-writer-wins and never attempts a textual auto-merge. **Rationale, against the repo's fail-closed philosophy:** `laneOutcomes` fails all tasks in a lane whose result is unaccounted for, "because nothing read as success is how a task silently ships unimplemented." A silent overwrite at merge time is the same failure wearing a green check — worse than the shared-tree race, because the race at least never claimed the discarded write succeeded. The merge fails closed in one direction: an uncertain fold halts; it never applies a guess.

**4. Contention is keyed on canonical paths, never raw spellings.** The intersection test runs through `canonicalizePath` (the same boundary `predictedPaths` / `laneCanonicalPaths` use), so `src/a.ts` and `./src/a.ts` written by two lanes are one collision. Keying on the raw string is the exact defect `wave-isolation` closed for the *predicted* set; the merge must not reintroduce it for the *actual* set.

**5. Worktree location is derived from `laneLabel`, deterministically.** The worktree for a lane lives at a path computed from `laneLabel(lane)` under a run-scoped worktree root. A resumed run recomputes the same label → same path → folds the worktree it wrote. A label that is absent/empty, or two lanes in a batch that resolve to the same label, is a halt (named), never a filesystem scan for a best guess — a guessed worktree is a guessed write.

**6. Cleanup: remove on clean fold; preserve and name on halt.** After a clean fold the batch's lane worktrees are removed (uniformly — an unchanged worktree the runtime would auto-remove is removed here too, so post-fold state is uniform). On a halt the contending worktrees are left on disk and their locations named in the halt report, so a human can diff the two versions. A removal that itself fails after a successful fold is a cleanup *warning*, not a fold failure — the writes are already in the shared tree.

**7. Bounds live in `interlock limits`.** Any bound the merge introduces (e.g. a max lane-worktree count per batch, if one is needed beyond the existing `maxParallel`) is published through `lib/limits.mjs`, never restated in prose — consistent with "a cap written down twice is a cap that drifts."

No new third-party library is introduced. The mechanism is git worktrees (already a runtime requirement) and the workflow runtime's built-in `isolation:'worktree'`; there is no dependency to pin.

## Risks / Trade-offs

- **Cost.** ~200–500 ms + disk per lane worktree, per the runtime's own note. Accepted: it buys a filesystem guarantee in place of a probabilistic one. Unchanged worktrees are auto-removed, so a no-op lane costs setup only.
- **A halt is more disruptive than a lost write is invisible.** By design. A run that halts on a real collision is doing its job; the previous behavior "succeeded" by discarding a write. The trade is legibility for a lower clean-run rate on genuinely mis-predicted batches — which are exactly the batches that were silently wrong before.
- **Base-commit discipline.** Each lane's "files actually changed" is a diff against the batch's shared base commit; if that base is computed inconsistently across lanes the intersection is meaningless. Mitigation: the base is the shared tree's HEAD at batch dispatch, captured once, passed to the merge — a single value, like `previousHandoffs` is a single value shared by all batches of a wave.
- **Replay and worktrees.** A resumed run's agent results are cached, but the worktrees may or may not still exist on disk. If a cached-clean batch's worktrees were already removed, the merge for that batch is a cached no-op (it already folded); the merge step, like the agents, is replay-keyed on the lanes so it does not re-fold. This must be verified against the runtime's resume semantics (see tasks).
- **Interaction with `--apply-only` and partial batches.** A batch that failed some lanes still needs a defined fold: successful lanes fold, failed lanes contribute nothing, and a failed lane's worktree is preserved for inspection rather than folded. Covered in tasks.
