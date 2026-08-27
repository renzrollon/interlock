## 1. Pure merge decision (`lib/merge-lanes.mjs`)

- [x] 1.1 Create `lib/merge-lanes.mjs` exporting a pure `mergeDecision({ lanes, changedByLane, base })` that returns `{ status: 'clean' | 'collision' | 'error', folds, collisions, unresolved }` — no fs, no clock, no random, consistent with `adjudicateBatches` / `laneOutcomes`. `changedByLane` maps a lane label to the files that lane actually changed vs `base`.
- [x] 1.2 Compute contention by intersecting each pair of lanes' changed-file sets over CANONICAL paths (via `canonicalizePath`), never raw spellings — so `src/a.ts` and `./src/a.ts` are one collision. Reuse `lib/risk.mjs` `canonicalizePath` rather than re-deriving.
- [x] 1.3 Derive each lane's worktree location from `laneLabel(lane)` deterministically; a label that is absent/empty, or two lanes in a batch resolving to the same label, yields `status: 'error'` naming the offending label — never a filesystem scan.
- [x] 1.4 On a collision, populate `collisions` with `{ canonicalPath, lanes: [labelA, labelB] }` for every contended path; `status: 'collision'`; `folds` empty (apply nothing).
- [x] 1.5 On disjoint writes, populate `folds` with `{ lane, files }` for each lane (an empty-write lane contributes `files: []` and is reported, not dropped); `status: 'clean'`.
- [x] 1.6 Unit tests in `test/spine/merge-lanes.test.mjs`: clean disjoint fold; empty-write lane; canonical-only collision; missing/empty label → error; duplicate label → error. Assert the module never touches fs/clock (pass all inputs, no I/O).

## 2. CLI wiring (`bin/interlock merge-lanes`)

- [x] 2.1 Add `merge-lanes` subcommand to `bin/interlock`: reads the batch's `{ label, worktreePath }` pairs + shared base commit, runs `git -C <worktreePath> diff --name-status <base>` per lane (plus an untracked-file scan via `git ls-files --others --exclude-standard`, since `git diff <base>` never reports a lane's new untracked file) to build `changedByLane`, calls `mergeDecision`, and on `clean` applies each lane's files into the shared tree; emits JSON `{ status, folds, collisions, unresolved, survivingWorktrees }`. Verified by smoke test: two lanes writing disjoint new files fold cleanly into the shared tree with both worktrees removed.
- [x] 2.1a A worktree path that does not exist AND whose lane self-reported no changed files is an empty-write lane (`changedByLane[label] = []`), consistent with the runtime auto-removing unchanged worktrees — never an error. A missing path whose lane reported changes, or a missing `worktreePath` altogether, or any other `git diff` failure, is unresolved and named.
- [x] 2.2 On `collision` or `error`: apply nothing to the shared tree, leave contending worktrees on disk, and include their filesystem locations in `survivingWorktrees`. Exit code signals halt (non-zero), distinct from a clean fold (0). Verified by smoke test: two lanes writing the same path halt with exit 1, empty shared-tree apply, and both worktrees preserved in `git worktree list`.
- [x] 2.3 On `clean`: remove the batch's lane worktrees uniformly (changed and unchanged alike, when their path still exists). A removal failure after a successful apply is reported in a `cleanupWarnings` field, NOT as a fold failure.
- [x] 2.4 Add the `USAGE` entry for `merge-lanes` and document its exit codes (0 clean fold, non-zero halt).
- [x] 2.5 No new bound needed beyond the existing `maxParallel`: a batch's lane worktree count is bounded by its lane count, which `maxParallel` already caps.

## 3. Workflow integration (`workflows/ship.js`)

- [x] 3.0 Add an opt-in `--isolate-waves` flag to `parseInvocation` (same pattern as `strict`/`review`/`handoff`), default OFF. Unset, the run is unchanged from today: no worktree, no `merge-lanes` step. This gate exists because the mechanism below adds real surface (a new implementer-prompt contract, new CLI git plumbing) that should not land on every ship run's default path.
- [x] 3.1 When `isolateWaves` is set, add `isolation: 'worktree'` to the per-lane `agent()` opts (~ship.js:1521) and extend the implementer prompt/schema so the lane reports its own working directory as `worktreePath` in its structured result (the agent observes this with its own Bash tool; the orchestrator never predicts a path). Label/model/schema keys otherwise unchanged; unset, the spawn is byte-identical to today.
- [x] 3.2 Capture the shared-tree base commit once at batch dispatch (like `previousHandoffs` is captured once per wave), via a ping running `git rev-parse HEAD`, and thread it to the merge step. Only when `isolateWaves` is set.
- [x] 3.3 Add a `merge-lanes` step, only when `isolateWaves` is set, after the batch's implementers return and before the batch outcomes are recorded, transcribed by a ping (reuse the existing CLI-ping pattern; `action`/`cliStdout` copy discipline).
- [x] 3.4 On a merge `collision`/`error`, route to the existing `halt(...)` path with a message naming the contended canonical path(s) and lane labels and the surviving worktree locations — do not record the batch as folded, do not advance to the next batch.
- [x] 3.5 Define partial-batch behavior: successful lanes fold, failed/not-attempted lanes contribute nothing and their worktrees are preserved (named), so a failed lane never folds a half-write.

## 4. Replay & resume safety

- [x] 4.1 Confirm the `merge-lanes` step is replay-keyed on the batch's lanes so a resumed run does not re-fold an already-folded batch; a cached-clean batch whose worktrees were removed is a cached no-op.
- [x] 4.2 Add a test/fixture exercising resume: first pass folds cleanly and removes worktrees; resumed pass reaches the same merge decision from cache without requiring the worktrees to still exist.

## 5. Docs & guarantee wording

- [x] 5.1 Amend `README.md`: the "narrows the race" paragraph now reads "closed within a batch," with the prediction-miss surfacing as a named `merge-lanes` halt.
- [x] 5.2 Update the relevant `docs/` page(s) describing wave isolation to reference the worktree-per-lane guarantee and the merge halt policy.
- [x] 5.3 Run `openspec validate isolate-ship-waves-in-worktrees --strict` and the unit suite; confirm green.
