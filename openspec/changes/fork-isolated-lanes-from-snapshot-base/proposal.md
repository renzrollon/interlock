## Why

Under `--isolate-waves`, every isolated batch forks its lane worktrees from `git rev-parse HEAD`, and HEAD never moves during a run because the ship commit is the run's last step. A collision-deferred batch therefore edits a stale copy of the file an earlier batch already changed, and its whole-file fold overwrites that earlier edit with exit 0 and no collision; a wave-2 lane cannot see a file a wave-1 lane created. This is the worst class of failure Interlock has: the run reports success and the code is wrong. It was found by reading `decorate()` in `lib/run.mjs` and reproduced on 2026-10-05 against the real `merge-lanes` binary (batch 2 forked from the unchanged pre-run HEAD dropped batch 1's edit; a hand-built snapshot commit as the base carried both). Source: `briefs/claude-code-teams-and-orchestration-briefs.md`, Brief 1.

## What Changes

- **The merge base becomes a snapshot of the shared tree, not HEAD.** Before an isolated batch is dispatched, the CLI builds a commit object of the shared tree as it stands, through a temporary index and git plumbing only. It moves no ref, touches no index and changes no working-tree file. That snapshot is stored as the batch's merge base; lane worktrees are forked from it and lane diffs are taken against it.
- **A deferred batch sees the earlier batch, and wave 2 sees wave 1.** Because the snapshot includes every earlier fold and every untracked, non-ignored file, a later lane edits the current file and a later wave's lane tree contains what earlier waves created. No cross-batch collision check is needed: the whole-file fold now carries both edits.
- **The lane base is checked on every host before anything folds.** `run record-batch` reads each clean lane's worktree HEAD itself and halts the run with `LANE BASE MISMATCH: <lane> forked from <sha>, expected <snapshot>` when it is not the stored snapshot. Nothing from that batch is folded. A fold against the wrong base becomes a named halt, never a silent revert.
- **A clean tree forks from HEAD itself.** When the snapshot's tree equals HEAD's tree, HEAD is the base, so no dangling commit is created and a lane forked from HEAD passes the check. This is the first isolated batch of a run started on a clean tree.
- **The Workflow host's degradation is spoken.** The runtime forks `isolation: 'worktree'` lanes from `worktree.baseRef`, which a plugin can neither read nor set, so in this phase an isolated batch there will usually halt with `LANE BASE MISMATCH` after the first fold. `run start` banners that on a runtime-worktree host under `--isolate-waves`, and the halt names `worktree.baseRef` and the follow-up change.
- **A batch without `--isolate-waves` is unchanged.** It still carries `mergeBase: null` and runs byte-for-byte as before.
- **The false comment in `decorate()`** that the next batch's base "is read off this tree" is corrected to say what the base now is.

## Capabilities

### New Capabilities

None. Isolation is an existing behaviour of lanes, waves and the runner; this change corrects what it forks from.

### Modified Capabilities

- `lanes`: adds the requirements that an isolated batch's merge base is a snapshot of the shared tree (including untracked, non-ignored files, excluding Interlock's own run state and any linked worktree inside the root), that the snapshot moves no ref and leaves HEAD, the index and the working tree unchanged, that a lane whose worktree base is not the stored snapshot halts the run before anything folds, and that a clean tree resolves the snapshot to HEAD.
- `waves`: adds the requirement that an isolated lane in a later batch or wave sees every earlier fold of the run, so a collision-deferred batch edits the current file and a wave-2 lane finds a wave-1 lane's new file.
- `run-host-adapters`: modifies "Every runner host SHALL get driver-owned worktree isolation under `--isolate-waves`" so the base the runner forks from is the snapshot the step names, and the fold refuses a lane whose base is not that snapshot.

## Impact

**Code**

- `bin/interlock` — a `snapshotTree(root)` dep beside `headCommit`, and a `worktreeHead(path)` dep for the lane-base read. `laneDiff`, `applyLaneDiff` and `runMergeLanes` unchanged.
- `lib/run.mjs` — `decorate()` stores the snapshot; `runRecordBatch` checks lane bases and halts on mismatch; `runStart` raises the runtime-worktree advisory banner; corrected comment.
- `bin/interlock-run` — unchanged. `createWorktrees` already reads `step.mergeBase`.
- `workflows/ship.js` — unchanged.
- `lib/host/registry.mjs` — unchanged in this phase. `worktree` stays `'driver' | 'runtime'`.

**Tests**

- `test/spine/run.test.mjs` — snapshot-not-HEAD on a dirty tree, HEAD on a clean tree, the snapshot invariants, the run-state exclusion, the two-batch and wave-2 fixtures driven through the real binary with real git, the mismatch halt, and `mergeBase: null` without the flag.
- `test/spine/merge-lanes-fold.test.mjs` — a fold whose `--base` is a dangling snapshot commit diffs against it, not against HEAD.
- `test/workflows.test.mjs` — the source-text pin on `ctx.deps.headCommit(root)` in `decorate()` is repointed to the snapshot dep, and the snapshot plumbing is pinned in `bin/interlock`.

**Docs**

- `docs/06-why-it-works.md`, `docs/07-cli-and-configuration.md`, `docs/04-when-it-stops.md`, `docs/10-agentic-workflow-ship-and-spec.md` — the base is a snapshot; `git add -A` respects `.gitignore`, so an ignored generated file stays absent from lane trees as today; `--isolate-waves` on the Workflow host halts with a named reason until the follow-up.
- `CHANGELOG.md` — under Unreleased, Fixed.

**Out of scope** (the follow-up change): CLI-created worktrees for every host and `EnterWorktree` on the Workflow host; moving lane worktrees under `.claude/worktrees/`; committing folds mid-run; a `WorktreeCreate` hook, which fails closed for every worktree on the machine.
