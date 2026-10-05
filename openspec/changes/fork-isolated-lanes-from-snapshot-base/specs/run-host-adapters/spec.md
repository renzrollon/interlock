## MODIFIED Requirements

### Requirement: Every runner host SHALL get driver-owned worktree isolation under `--isolate-waves`

For an isolated batch, the run program MUST emit a merge base and one worktree path per lane. The merge base MUST be the snapshot of the shared tree that the lanes capability describes — never HEAD while the shared tree differs from it — so that a later batch forks from the tree every earlier fold produced. The runner MUST create each worktree from that base, spawn the lane with the worktree as its working directory, and hand the results to `run record-batch`, which MUST verify that each clean lane's worktree was forked from that base and halt with `LANE BASE MISMATCH` when it was not, MUST fold ok lanes, halt on a real collision naming the path and the lanes, and leave a failed lane's worktree in place and named. The runner MUST remove folded worktrees. The runner MUST NOT choose, derive or substitute a base of its own: it reads the base off the step and interprets.

#### Scenario: Happy path — two disjoint lanes fold on the Qwen host

- **GIVEN** `interlock-run <change> --host qwen --isolate-waves` and a batch of two lanes that write different files
- **WHEN** the batch completes
- **THEN** both lanes ran in separate worktrees created from the batch's merge base, both folded into the shared tree, and both worktrees were removed

#### Scenario: Failure — a real collision halts

- **GIVEN** an isolated batch in which two lanes wrote the same file despite disjoint predictions
- **WHEN** `run record-batch` folds
- **THEN** the run halts naming the path and both lane labels
- **AND** both worktrees remain on disk and are named in the summary

#### Scenario: Edge case — an ACP agent's session runs in the worktree

- **GIVEN** `interlock-run <change> --host acp --isolate-waves`
- **WHEN** a lane is spawned
- **THEN** the ACP session is created with the lane's worktree as its cwd
- **AND** the agent's writes land in the worktree, not the shared tree

#### Scenario: Edge case — a second isolated batch forks from the folded tree, not from the pre-run commit

- **GIVEN** `interlock-run <change> --host qwen --isolate-waves`, where batch 0 has folded an edit to `lib/a.mjs` into the shared tree and the ship commit has not yet happened
- **WHEN** batch 1's step is emitted and the runner creates its lane worktree from the step's merge base
- **THEN** that merge base is a commit whose tree holds the folded edit, and the lane's worktree holds the edit before the lane's agent starts
- **AND** `run record-batch` accepts the lane's base as the snapshot and folds it
