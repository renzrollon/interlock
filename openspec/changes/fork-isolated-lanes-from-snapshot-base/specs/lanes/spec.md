## ADDED Requirements

### Requirement: An isolated batch SHALL fork its lanes from a snapshot of the shared tree

Before an isolated batch is dispatched, the run MUST capture the shared tree as it stands — every tracked change and every untracked file that is not ignored — as a commit object, and MUST record that commit as the batch's merge base. Every lane worktree the batch dispatches MUST be forked from that base, and every lane diff at fold time MUST be taken against it. HEAD MUST NOT be used as the base while the shared tree differs from it, because HEAD does not move during a run and a lane forked from it edits a copy that lacks every earlier fold.

- **Clean tree.** When the captured tree is identical to HEAD's tree, the base MUST be HEAD itself and no snapshot commit is created.
- **Run state excluded.** The snapshot MUST NOT contain Interlock's own run state under `.claude/ship/`, nor any linked git worktree that lies inside the repository root, whatever the repository's ignore rules say. A checkout of a tree that carried such an entry would hold an empty directory where a sibling lane's worktree stands, and the fold would read that as a deletion.
- **Ignore rules respected.** A file the repository ignores MUST remain absent from the snapshot and therefore from every lane tree, exactly as it is today.
- **Unisolated batches unchanged.** A batch dispatched without `--isolate-waves` MUST carry a null merge base and run exactly as before.

#### Scenario: Happy path — a dirty tree forks from a snapshot, not from HEAD

- **GIVEN** a run started with `--isolate-waves` in a repository whose working tree holds an uncommitted edit to `lib/a.mjs` and an untracked, non-ignored `lib/new.mjs`
- **WHEN** the first isolated batch is emitted
- **THEN** the step's merge base is a commit that is not HEAD, and the tree of that commit lists `lib/a.mjs` with the uncommitted edit and lists `lib/new.mjs`
- **AND** a lane worktree forked from that base contains both files as the shared tree has them

#### Scenario: Failure — a snapshot that cannot be captured halts before any lane is dispatched

- **GIVEN** a run started with `--isolate-waves` in a repository whose HEAD cannot be resolved
- **WHEN** an isolated batch would be emitted
- **THEN** the run halts with the reason that the shared-tree base commit could not be captured before an isolated batch
- **AND** no lane is dispatched and no worktree path is named

#### Scenario: Edge case — a clean tree resolves the base to HEAD and creates nothing

- **GIVEN** a run started with `--isolate-waves` in a repository whose working tree is identical to HEAD, with no untracked non-ignored file
- **WHEN** the first isolated batch is emitted
- **THEN** the step's merge base equals HEAD
- **AND** the repository's object count is unchanged by the capture

#### Scenario: Edge case — the run's own state and a leftover lane worktree stay out of the snapshot

- **GIVEN** a repository that does not ignore `.claude/`, holding Interlock's run state under `.claude/ship/` and a preserved lane worktree under `.claude/ship/worktrees/` from a failed lane
- **WHEN** the next isolated batch's snapshot is captured
- **THEN** the snapshot's tree has no entry under `.claude/ship/`
- **AND** it has no embedded-repository entry for the preserved worktree

### Requirement: Capturing the snapshot SHALL leave the repository as it found it

The capture MUST move no ref — no branch, no tag, no HEAD, no reflog entry — MUST leave the repository's index unchanged, and MUST change no working-tree file. The commit object it creates is reachable only through the lane worktrees forked from it, and is left to git's own expiry once the batch has folded. The capture MUST NOT depend on, or write, the user's git identity.

#### Scenario: Happy path — HEAD, refs, index and working tree are identical before and after

- **GIVEN** a repository with a dirty working tree, a staged change in its index and several refs
- **WHEN** an isolated batch's snapshot is captured
- **THEN** HEAD, the full ref list, the staged change and the working tree's status are byte-identical to what they were before the capture

#### Scenario: Failure — a repository with no git identity still snapshots

- **GIVEN** a repository with no `user.name` or `user.email` configured and none in the environment
- **WHEN** an isolated batch's snapshot is captured
- **THEN** a snapshot commit is produced
- **AND** no identity has been written to the repository's configuration

#### Scenario: Edge case — the snapshot survives the batch without a ref

- **GIVEN** an isolated batch whose lanes were forked from a snapshot that is not HEAD
- **WHEN** the lanes are still on disk and the batch has not yet folded
- **THEN** the snapshot commit is reachable from each lane worktree's HEAD and no ref under the repository's `refs/` names it

### Requirement: A lane whose base is not the batch's snapshot SHALL halt the run before anything folds

For every lane whose result is clean and whose worktree is still on disk, the fold MUST read the worktree's own HEAD through git and compare it to the stored merge base. Any lane whose base differs, or whose base cannot be read while the lane reported changed files, MUST halt the run with `LANE BASE MISMATCH: <lane> forked from <sha>, expected <snapshot>`, and no lane of that batch MUST be folded. A lane whose worktree is gone and which reported no changed files is an empty-write lane and MUST NOT fail this check. The check MUST trust only what git reports from the worktree, never a base the lane's agent reported for itself. On a host whose runtime creates the lane worktrees, the halt reason MUST additionally name `worktree.baseRef` and say that `--isolate-waves` on that host needs the follow-up change.

#### Scenario: Happy path — lanes forked from the stored snapshot fold

- **GIVEN** an isolated batch of two clean lanes whose worktrees were both created from the step's merge base
- **WHEN** the batch is recorded
- **THEN** no mismatch is raised and both lanes' writes land in the shared tree

#### Scenario: Failure — a lane forked from HEAD while the tree differs halts the whole batch

- **GIVEN** an isolated batch of two clean lanes in a repository whose shared tree differs from HEAD, where lane A's worktree was created from the merge base and lane B's was created from HEAD
- **WHEN** the batch is recorded
- **THEN** the run halts with `LANE BASE MISMATCH: B forked from <HEAD sha>, expected <snapshot sha>`
- **AND** neither lane's writes are applied to the shared tree
- **AND** both worktrees remain on disk and are named in the halt

#### Scenario: Edge case — an empty-write lane whose worktree the runtime removed passes

- **GIVEN** an isolated batch in which one clean lane reported no changed files and its worktree is no longer on disk
- **WHEN** the batch is recorded
- **THEN** that lane is not a base mismatch and the remaining lanes fold normally

#### Scenario: Edge case — on a runtime-worktree host the halt names the setting that chose the base

- **GIVEN** a run on a host whose `worktree` capability is `runtime`, and an isolated batch whose lane base is not the snapshot
- **WHEN** the batch is recorded
- **THEN** the halt reason carries `LANE BASE MISMATCH` and additionally names `worktree.baseRef` and the follow-up change that `--isolate-waves` on this host needs
