## Why

`ship/wave-isolation` opens by promising "parallel implementers sharing one working tree cannot produce a lost write" — but the guarantee rests on a model's prediction. `lib/waves.mjs` is explicit that `task.paths` "is a model's prediction, so a task that edits" a file it never declared collides with nothing, and `README.md` states the honest version: the collision check "narrows the race rather than closing it." Two lanes the planner placed in one batch because their *predicted* paths were disjoint can still both write one file when the prediction was wrong, and — sharing a tree — the second write silently wins. That is the exact lost-write defect `predictedPaths` / `laneCanonicalPaths` exists to prevent, surviving in the one place canonicalization cannot reach: paths nobody predicted.

The workflow runtime now supports `opts.isolation:'worktree'` per agent. The per-lane implementer spawn at `workflows/ship.js:1404` passes `{ label, model, ...workerExtra, schema }` with no isolation, so all lanes in a batch still share one tree. Giving each lane its own worktree closes the race outright — but a worktree is only half the mechanism: the writes then have to come back to the shared tree, and *that* fold is where a real prediction-miss must be caught rather than resolved away.

## What Changes

- Run each lane in its own git worktree, opt-in behind a `--isolate-waves` flag (default off, same pattern as `--strict`): when set, add `isolation:'worktree'` to the per-lane `agent()` spawn at `workflows/ship.js:1404` and have each lane self-report its working directory. Lanes in a batch no longer share a working tree, so a mis-predicted path can no longer cause one lane to overwrite another mid-batch. Isolation *between* lanes stops being a probabilistic property of the path predictor and becomes a filesystem fact — for runs that ask for it. Unset, a ship run is unchanged from today.
- Add `interlock merge-lanes` (`bin/interlock` + new `lib/merge-lanes.mjs`): a deterministic, pure-logic command run after each batch that folds every lane worktree's writes back into the shared tree. It is handed the batch's lanes and the shared-tree state and answers one question — does this batch fold cleanly, and if not, which two lanes contend on which canonical path.
- State one conflict policy and enforce it fail-closed in one direction: a batch whose lane worktrees touched **disjoint** canonical paths folds with zero conflicts by construction (the planner already made lanes path-disjoint). A batch where two lanes actually wrote the **same** canonical path is a prediction miss — `merge-lanes` **HALTS**, naming the conflicting canonical path(s) and the two lane labels. It never auto-resolves, never applies last-writer-wins; a silent overwrite is precisely the defect wave-isolation exists to prevent, and hiding it behind a merge would be worse than the shared-tree race because the run would report success.
- Locate each lane's worktree deterministically from `laneLabel(lane)` (stable across replays), so a resumed run folds the same worktree it wrote and a merge is replay-safe.
- Clean up lane worktrees deterministically: removed after a clean fold, and on a halt the surviving worktrees are named in the halt report rather than silently discarded, so a human can inspect the contended writes.
- Publish the merge command's caps/bounds through `interlock limits` (`lib/limits.mjs`) so no scan or worktree bound is restated in prose.
- Amend `README.md` so the "narrows the race" paragraph tells the truth after this change: passing `--isolate-waves`, within a batch the race is closed, and a prediction miss now surfaces as a named halt instead of a lost write. Without it, the race is narrowed exactly as before.

Honest cost, stated up front: per the runtime's own note a worktree spawn adds ~200–500 ms and disk per agent; worktrees are auto-removed when unchanged. That cost is opt-in via `--isolate-waves`, off by default. The `merge-lanes` command, its conflict policy, and the implementer's `worktreePath` self-report are the real work of this change.

## Capabilities

### New Capabilities
- `ship/lane-merge`: the deterministic fold of per-lane worktrees back into the shared tree after a batch, and the stated conflict policy that halts on a real path collision rather than resolving it.

### Modified Capabilities
- `ship/wave-isolation`: the isolation guarantee strengthens from "narrows the race" to "closed within a batch." A mis-predicted shared write can no longer produce a lost write; it produces a named halt at merge time.

## Impact

- `workflows/ship.js` — per-lane spawn opts at ~1404 (`isolation:'worktree'`); a `merge-lanes` step after each batch, before the batch's outcomes are recorded.
- `bin/interlock` — new `merge-lanes` subcommand + `USAGE` entry.
- `lib/merge-lanes.mjs` — new pure module: fold decision, conflict detection over canonical paths, deterministic worktree location from lane labels.
- `lib/limits.mjs` — any new bound the merge introduces.
- `lib/waves.mjs` — no logic change; `laneLabel`/`laneCanonicalPaths` are read by the merge (worktree location, conflict keying).
- `README.md`, `docs/` — the isolation guarantee's wording.
- Runtime dependency: git worktrees (already required; no new library). No pinned third-party dependency is introduced.
