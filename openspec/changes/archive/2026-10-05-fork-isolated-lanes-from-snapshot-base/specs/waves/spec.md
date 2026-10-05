## ADDED Requirements

### Requirement: An isolated lane SHALL see every earlier fold of the run

Under `--isolate-waves`, the tree a lane is forked from MUST include the folded writes of every earlier batch and every earlier wave of the same run, including files those lanes created and files that are still untracked in the shared tree. A batch deferred because it shares a path with an earlier batch therefore edits the current file, and its fold MUST carry both its own edit and the earlier batch's. This is why no cross-batch collision check exists: the whole-file fold is correct because the file it copies already holds the earlier work.

#### Scenario: Happy path — a collision-deferred batch keeps the earlier batch's edit

- **GIVEN** a wave whose batch 0 holds a lane that appends a line to `lib/a.mjs` and whose batch 1 holds a lane deferred for sharing `lib/a.mjs`
- **WHEN** batch 0 folds, batch 1 is forked, edits the first line of `lib/a.mjs`, and folds
- **THEN** the shared tree's `lib/a.mjs` holds both the appended line and the edited first line
- **AND** no collision is reported, because the two batches never ran concurrently

#### Scenario: Happy path — a wave-2 lane finds the file a wave-1 lane created

- **GIVEN** an isolated run in which a wave-1 lane creates `lib/new.mjs` and the fold applies it to the shared tree, where it is untracked
- **WHEN** the first wave-2 batch is emitted
- **THEN** the tree of that batch's merge base lists `lib/new.mjs`
- **AND** a lane worktree forked from that base contains it

#### Scenario: Failure — a lane forked from the pre-run commit is refused, and the earlier edit survives

- **GIVEN** the same two-batch wave, where batch 1's lane worktree was created from the pre-run HEAD instead of the batch's merge base
- **WHEN** batch 1 is recorded
- **THEN** the run halts with `LANE BASE MISMATCH` naming the lane, HEAD's sha and the snapshot's sha
- **AND** `lib/a.mjs` in the shared tree still holds batch 0's appended line, unchanged by batch 1

#### Scenario: Edge case — the first isolated batch of a run on a clean tree has nothing earlier to see

- **GIVEN** an isolated run started on a working tree identical to HEAD
- **WHEN** the first isolated batch is emitted
- **THEN** its merge base is HEAD and a lane forked from it holds exactly the committed tree
