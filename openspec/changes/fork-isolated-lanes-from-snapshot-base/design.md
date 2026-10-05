## Context

See proposal.md for the motivation. The wiring as it stands:

- `decorate()` in `lib/run.mjs` reads `mergeBase` from `ctx.deps.headCommit(root)` for an isolated batch and stores it on the step and on `manifest.mergeBase`. `bin/interlock` wires that dep to `git rev-parse HEAD`.
- `bin/interlock-run` `createWorktrees` forks each lane with `git worktree add --detach --force <path> <step.mergeBase>`. The Workflow host passes `isolation: 'worktree'` to `agent()` instead, and the runtime forks from `worktree.baseRef` (`fresh` by default, meaning `origin/<default>`), which a plugin can neither read nor set.
- `runRecordBatch` reads `manifest.mergeBase` back, calls `ctx.deps.runMergeLanes(root, candidates, base)`, then sets `manifest.mergeBase = null`. `runMergeLanes` in `bin/interlock` diffs each lane against the base (`laneDiff`: `git -C <wt> diff --name-status -z <base>` plus untracked files), decides through the pure `mergeDecision`, and applies whole files with `copyFileSync` (`applyLaneDiff`).
- The ship commit is the run's last step, so HEAD never moves while batches fold. Every isolated batch forks from the pre-run commit.

Reproduced on 2026-10-05 against the real `merge-lanes` binary in a scratch repository: batch 1 appended a line to `lib/a.mjs` and folded; batch 2, forked from the unchanged HEAD, edited line 1 and folded with exit 0 and no collision; the appended line was gone. Repeating batch 2 from a hand-built snapshot commit (temporary index, `add -A`, `write-tree`, `commit-tree -p HEAD`) carried both edits. A second scratch check showed that `git add -A` into a temporary index adds a lane worktree left under `.claude/ship/worktrees/` as an embedded-repository entry (mode `160000`) unless that path is excluded.

Constraints this design inherits (see `CLAUDE.md` and the brief's "Repository constraints every brief inherits"): zero runtime dependencies, so git is driven with `execFileSync`; thresholds live in the CLI, and this change adds none; drivers interpret and the CLI decides; degradation is spoken; guards are untouched; a test pin that names the replaced mechanism is repointed in the red wave, never deleted.

## Goals / Non-Goals

**Goals:**

- Close the silent revert on both hosts with stdlib git plumbing: a later isolated batch forks from the tree every earlier fold produced.
- Turn a fold against the wrong base into a named halt on every host, decided by the CLI from what git reports.
- Leave the unisolated path byte-for-byte unchanged, and leave `bin/interlock-run`, `workflows/ship.js` and `lib/host/registry.mjs` untouched.

**Non-Goals:**

- Making `--isolate-waves` work on the Workflow host beyond the first isolated batch of a clean-tree run. That needs CLI-created worktrees on every host and is the follow-up change.
- Moving lane worktrees under `.claude/worktrees/`, committing folds mid-run, or a `WorktreeCreate` hook (fails closed for every worktree on the machine).
- A cross-batch collision check. The snapshot makes it unnecessary.

## Decisions

### D1 — The snapshot is a commit object built through a temporary index

`snapshotTree(root)` is a new dep in `bin/interlock`, wired beside `headCommit`, and the only thing `decorate()` reads for an isolated batch's base. It runs, in order, each through `execFileSync` with `stdio: ['ignore', 'pipe', 'ignore']` and returns `null` on any failure:

1. `mkdtemp` a directory under `os.tmpdir()` and point `GIT_INDEX_FILE` at a file inside it for every git call below. The repository's own index is never opened for writing.
2. `git read-tree HEAD` — seed the temporary index from HEAD. This keeps tracked-but-ignored files at their committed content; an empty index plus `add -A` would drop them, which would be a silent difference from today's HEAD base.
3. `git worktree list --porcelain` — collect every linked worktree path that lies inside `root`.
4. `git add -A -- . ':(exclude).claude/ship' ':(exclude)<each linked worktree path, relative to root>'` — stage the working tree as it stands: tracked edits, deletions and every untracked file `.gitignore` does not exclude. The two exclusions are the run's own state (where `bin/interlock-run` also puts lane worktrees) and any linked worktree inside the root (where the Workflow runtime puts its own, under `.claude/worktrees/`). Without them a leftover worktree becomes a `160000` entry, a lane's checkout of the snapshot holds an empty directory there, and `laneDiff` reports that directory as deleted — a fold that would `rmSync` a sibling lane's worktree. The exclusion is computed at capture time, not a hard-coded list, so a host that moves its worktrees is still covered.
5. `git write-tree` → the snapshot tree. Compare it to `git rev-parse HEAD^{tree}`. **If equal, return HEAD** and create no commit. This is the brief's "accept a lane forked from HEAD when the trees are equal" refinement, done once at capture rather than as a second comparison at fold time, so D3 stays a plain string equality.
6. Otherwise `git commit-tree <tree> -p HEAD -m 'interlock: shared-tree snapshot (<change>)'` with `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` set to a fixed Interlock identity in that call's environment only. `commit-tree` refuses to write without an identity, a CI checkout often has none, and the snapshot's identity is nobody's: it is never written to config.
7. Remove the temporary directory in `finally`.

`decorate()` stores the result as `manifest.mergeBase` and on the step exactly where it stores HEAD today, keeps the existing halt text when the result is `null`, and its comment says the base is a snapshot of the shared tree including earlier folds, not HEAD. `createWorktrees`, `laneDiff`, `applyLaneDiff` and `runMergeLanes` are unchanged: a dangling commit is a valid argument to `git worktree add` and to `git diff`.

*Alternatives considered.* `git stash create` writes no ref but captures tracked changes only, as a two-parent merge commit; untracked files, the thing a wave-1 lane creates, would still be missing. Committing each fold on the branch gives the same base and ends the single feature-level ship commit. Copying the shared tree into each lane directory without git makes `laneDiff` impossible.

### D2 — The snapshot is pinned by nothing; the lane worktrees keep it alive

No ref is written under any namespace. Between fork and fold, every lane worktree's HEAD points at the snapshot, and git's reachability for `gc` and `prune` includes every linked worktree's HEAD. Once the batch folds, `manifest.mergeBase` is cleared and the commit is spent; it expires under `gc.pruneExpire` (two weeks by default) like any other unreachable object.

*Alternative considered: pin under `refs/interlock/<runId>` and delete at `run close`.* Rejected. It adds a ref namespace, a close-time cleanup whose failure needs a banner, and a stale-ref class for interrupted runs (Brief 2's territory), all to cover the sub-second window between `commit-tree` and the first `worktree add`. An explicit `git gc --prune=now` in that window is unsupported, and its outcome is already the right one: `createWorktrees` fails naming the lane, or `laneDiff` returns `null` and the lane is unresolved. Both are halts; neither is a revert.

### D3 — The CLI reads each lane's base from its worktree; no schema field

`worktreeHead(worktreePath)` is a second new dep in `bin/interlock`: `git -C <path> rev-parse HEAD`, `null` on any failure, including a missing directory. `runRecordBatch` calls it for every fold candidate before `runMergeLanes` is invoked, and decides:

| git reports | lane reported changed files | verdict |
|---|---|---|
| the stored base | any | fold |
| a different sha | any | halt: `LANE BASE MISMATCH: <lane> forked from <sha>, expected <snapshot>` |
| nothing (unreadable or gone) | none | empty-write lane, as today; fold proceeds |
| nothing (unreadable or gone) | some | halt, with `(unreadable)` in the sha slot |

Failed lanes (`laneWorktreesPreserved`) are not checked; nothing folds from them. On a mismatch the halt is returned before any fold, so no lane of the batch is applied, and the halt names every surviving worktree the way the collision halt does. A `laneBase` schema field reported by the agent is rejected for the same reason `observedChangedPaths` is read by the CLI: the lane's own report is the thing being audited. The existing `MERGE BASE RE-READ AFTER THE BATCH` fallback and its banner are unchanged; `headCommit` stays for it.

### D4 — The Workflow host halts at the first mismatch and is warned at start

`run start` with `--isolate-waves` on a host whose `worktree` capability resolves to `runtime` pushes one banner: `ISOLATION BASE NOT CONTROLLED (workflow): the runtime forks lane worktrees from worktree.baseRef, not from the run's snapshot — an isolated batch whose lanes did not fork from the snapshot halts with LANE BASE MISMATCH`. The run proceeds. When a mismatch halts on that host, the reason gains a second sentence: `the Workflow runtime chose this base through worktree.baseRef, which a plugin cannot set; --isolate-waves on this host needs the follow-up change that creates lane worktrees from the CLI`.

*Alternative considered: refuse `--isolate-waves` at `run start` on the Workflow host.* Rejected for this phase. With `worktree.baseRef: head` in the user's own settings and a clean tree, the first isolated batch forks from HEAD, which D1 makes the base, and passes. Refusing would waste that run; halting at the mismatch wastes only the batch that would otherwise have been folded wrongly.

### D5 — Untracked, non-ignored files now reach lane trees, and that is the fix

Today an isolated lane cannot see an untracked file in the shared tree. With the snapshot it can, which is exactly what a wave-2 lane needs from a wave-1 lane's new file. `.gitignore` is still honoured by `add -A`, so an ignored generated file stays absent, as today. The docs say both.

### D6 — Tests are fixtures through the real binary and real git

The run-level fixtures live in `test/spine/run.test.mjs` and use its `repo()`, `startWithHost(root, change, 'qwen', { worktree: 'driver' }, ['--isolate-waves'])` and `run()` helpers, playing the driver the way `createWorktrees` does: `git worktree add --detach --force <spawn.worktree.path> <step.mergeBase>` for each lane, write into the lane, then `run record-batch --results`.

- **Two-batch fixture.** Tasks `1.1` (paths `lib/a.mjs`, tier 4), `1.2` (paths `lib/b.mjs`, tier 4) and `2.1` (paths `lib/a.mjs`), so wave 1 holds batch 0 of two lanes and batch 1 of one deferred lane, and chain fusion cannot fuse them. Batch 0's `1.1` lane appends a line to `lib/a.mjs`; batch 1's lane edits line 1. After both folds `lib/a.mjs` holds both.
- **Wave-2 fixture.** Two sections of two tasks each. A wave-1 lane creates `lib/new.mjs`; the wave-2 step's `mergeBase` lists it in `git ls-tree -r`, and a worktree forked from it contains the file.
- **Mismatch fixture.** The driver forks the deferred lane from HEAD instead of the base; `run record-batch` returns a halt step whose reason matches `LANE BASE MISMATCH: 2.1 forked from <HEAD>, expected <base>`, `lib/a.mjs` still holds only batch 0's edit, and both worktrees exist.
- **Capture invariants.** Dirty tree → `mergeBase !== HEAD` and `git ls-tree -r <mergeBase>` lists the uncommitted edit and the untracked file; clean tree → `mergeBase === HEAD` and `git count-objects` unchanged; before/after `rev-parse HEAD`, `for-each-ref`, `diff --cached` and `status --porcelain` identical; a repo with `user.name` and `user.email` unset and `GIT_*` identity scrubbed from the child env still captures; `.claude/ship/` and a planted linked worktree inside the root absent from `git ls-tree -r -d`.
- **Fold level.** One case in `test/spine/merge-lanes-fold.test.mjs`: `merge-lanes --base <dangling snapshot>` diffs the lane against that snapshot, so an edit present in the snapshot but not in HEAD is not reported as the lane's write.
- **Pins.** `test/workflows.test.mjs` currently asserts `mergeBase = ctx.deps.headCommit(root)` in `lib/run.mjs`. That pin names the mechanism this change replaces; it is repointed to `ctx.deps.snapshotTree(root)` in the red wave, and new pins assert `'write-tree'` and `'commit-tree'` appear in `bin/interlock` and that `step.mergeBase` is still only read, never assigned, in both drivers. This is a replaced pin, not a weakened one, and the test's own comment says so.

### D7 — Nothing else moves

No new limits key: there is no number to publish. No registry key or value: `worktree` stays `'driver' | 'runtime'`, and the `'cli'` value is the follow-up's. No new `claude` flag, so the one-time `--help` probe is untouched. No skill prose mentions the merge base, so `test/skills.test.mjs` gains no pin. No dependency is added.

## Risks / Trade-offs

- [`git add -A` into a temporary index scans the working tree on every isolated batch] → it is one `git status`-class walk, the same order of cost as the `observedChangedPaths` read `record-batch` already performs; isolation already pays 200–500 ms per worktree.
- [A dangling snapshot is pruned by an explicit `git gc --prune=now` between fork and fold] → the lane worktrees' HEADs keep it reachable; a prune that still removes it makes `laneDiff` return `null`, the lane is unresolved and the run halts naming it. A halt, never a revert.
- [An untracked, non-ignored secret enters a dangling commit object] → only files `git add -A` would stage at the ship commit anyway; the object is local, never pushed, and unreachable after the fold. `.gitignore` is the control, as it is for the commit.
- [On the Workflow host, every multi-batch isolated run halts in this phase] → intended and spoken: bannered at `run start`, named at the halt, and the follow-up change is named in both.
- [Excluding `.claude/ship/` hides a tracked file there] → the index is seeded from HEAD first, so a tracked file under that path keeps its committed content; only working-tree changes under Interlock's own directory are left out, and Interlock owns it.
- [The nested-worktree exclusion misses a worktree the runtime created elsewhere] → the list comes from `git worktree list --porcelain` at capture time, which names every linked worktree of the repository wherever it lives.

## Migration Plan

No state or schema changes: `manifest.mergeBase` and `step.mergeBase` remain a commit sha, and a run that started on the previous version folds its in-flight batch against the sha it stored. Rollback is reverting the commit. Nothing is written outside the repository's object store and `os.tmpdir()`.

## Open Questions

- Whether the Workflow runtime honours `worktree.baseRef: head` for an `agent({ isolation: 'worktree' })` spawned from a plugin workflow, and whether `EnterWorktree` into a CLI-created path runs without a prompt there. Both are the follow-up's design-day probes; neither changes this change's specs or tasks, because this change halts on mismatch either way.
