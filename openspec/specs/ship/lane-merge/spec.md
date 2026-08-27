# lane-merge Specification

## Purpose

Folds the per-lane git worktrees of a completed batch back into the shared working tree, deterministically, and states the one conflict policy: a batch whose lanes actually wrote the same file is a prediction miss and halts, naming the contended path and lanes, rather than resolving one write away.

## Requirements

### Requirement: A batch of disjoint lane worktrees SHALL fold cleanly

After a batch completes, each lane having run in its own git worktree, `merge-lanes` SHALL fold every lane worktree's writes into the shared working tree. When the lanes' actual writes touch pairwise-disjoint canonical paths, the fold SHALL apply every write and SHALL report success, leaving the shared tree holding the union of the lanes' changes.

Rationale: the planner already makes lanes in a batch path-disjoint by canonical-path collision components, so a correct prediction is a zero-conflict fold by construction. This requirement fixes that as the normal, observable outcome.

#### Scenario: Happy path — two lanes that wrote different files both land

- **GIVEN** a completed batch of two lanes, one worktree having written `lib/waves.mjs` and the other `lib/limits.mjs`
- **WHEN** `merge-lanes` folds the batch into the shared tree
- **THEN** the shared tree contains both lanes' edits
- **AND** the command reports a clean fold naming each lane and the files it contributed
- **AND** the command exits reporting no conflict

#### Scenario: Failure — a lane worktree that cannot be located halts the fold

- **GIVEN** a completed batch whose recorded lane label resolves to no worktree on disk
- **WHEN** `merge-lanes` attempts the fold
- **THEN** it SHALL halt and name the lane label whose worktree is missing
- **AND** it SHALL NOT record the batch as folded, because a batch missing one lane's writes has told us nothing about that lane's file

#### Scenario: Edge case — a lane worktree wrote nothing

- **GIVEN** a completed batch where one lane's worktree is unchanged from the shared tree (the lane made no edits)
- **WHEN** `merge-lanes` folds the batch
- **THEN** the empty lane contributes no writes and is reported as contributing none
- **AND** the fold of the other lanes still completes and is reported clean

### Requirement: A real path collision at merge time SHALL halt, never auto-resolve

When two lanes in a batch actually wrote the same canonical path — a prediction the planner made disjoint but that turned out to contend — `merge-lanes` SHALL halt the run. The halt SHALL name the contended canonical path(s) and the two lane labels that wrote them. `merge-lanes` SHALL NOT apply last-writer-wins, SHALL NOT attempt a textual auto-merge, and SHALL NOT record the batch as folded.

Rationale: a silent overwrite is the exact lost-write defect `wave-isolation` exists to prevent. Resolving the collision away would report success over a discarded write — strictly worse than the shared-tree race, which at least the collision check tried to narrow. The command fails closed in one direction only: an uncertain fold is a halt, never an applied guess.

#### Scenario: Happy path — a genuinely disjoint batch is not treated as a collision

- **GIVEN** a batch whose two lane worktrees wrote canonical paths that share no member
- **WHEN** `merge-lanes` checks for contention
- **THEN** no collision is reported and the fold proceeds

#### Scenario: Failure — two lanes wrote one file despite a disjoint prediction

- **GIVEN** a batch of lanes A and B whose predicted paths were disjoint, but where A's worktree and B's worktree both wrote `lib/risk.mjs`
- **WHEN** `merge-lanes` folds the batch
- **THEN** it SHALL halt without modifying the shared tree
- **AND** the halt report SHALL name `lib/risk.mjs` as the contended canonical path
- **AND** the halt report SHALL name lanes A and B as the contenders
- **AND** neither lane's version of `lib/risk.mjs` SHALL be applied over the other

#### Scenario: Edge case — contention only under canonicalization

- **GIVEN** lane A wrote `src/a.ts` and lane B wrote `./src/a.ts`
- **WHEN** `merge-lanes` compares the lanes' actual writes
- **THEN** both spellings resolve to one canonical path and the batch SHALL halt as a collision
- **AND** last-writer-wins keyed on the raw spelling — which would have admitted the overwrite — SHALL NOT be used

### Requirement: Worktree location and fold SHALL be deterministic across replays

`merge-lanes` SHALL locate each lane's worktree from the lane label alone, using the same stable label the implementer spawn used (`laneLabel`), so a resumed run folds the same worktree it wrote. The fold decision SHALL be a pure function of the lanes and the shared-tree state — it SHALL NOT read a clock, a random source, or ambient environment that would make a replay decide differently than the first pass.

#### Scenario: Happy path — a resumed run folds the worktree it already wrote

- **GIVEN** a run that wrote lane worktrees, then resumed from cached agent results
- **WHEN** `merge-lanes` runs on the resumed pass
- **THEN** it locates each lane's worktree by its stable label
- **AND** it produces the same fold decision the first pass would have produced

#### Scenario: Failure — a nondeterministic input is refused rather than folded

- **GIVEN** a lane whose label is absent or empty so no worktree path can be derived
- **WHEN** `merge-lanes` runs
- **THEN** it SHALL halt naming the lane whose label could not be resolved to a worktree
- **AND** it SHALL NOT fall back to scanning the filesystem for a best-guess worktree

#### Scenario: Edge case — two lanes in one batch that resolve to the same label

- **GIVEN** a malformed batch containing two lanes whose labels collide
- **WHEN** `merge-lanes` derives worktree paths
- **THEN** it SHALL halt naming the duplicated label rather than folding one worktree twice

### Requirement: Lane worktrees SHALL be cleaned up deterministically, and survivors named on halt

After a clean fold, `merge-lanes` SHALL remove the batch's lane worktrees. On a halt (collision, missing worktree, or unresolved label), the surviving lane worktrees SHALL NOT be silently discarded; the halt report SHALL name them and their filesystem locations so a human can inspect the contended writes.

#### Scenario: Happy path — worktrees removed after a clean fold

- **GIVEN** a batch that folded cleanly
- **WHEN** `merge-lanes` finishes
- **THEN** the batch's lane worktrees are removed
- **AND** an unchanged lane worktree is removed the same as a changed one (the runtime already auto-removes unchanged worktrees; this makes the post-fold state uniform)

#### Scenario: Failure — a halt preserves the evidence

- **GIVEN** a batch that halted on a path collision
- **WHEN** the halt report is written
- **THEN** the contending lane worktrees are left on disk
- **AND** the report names each surviving worktree's location

#### Scenario: Edge case — worktree removal itself fails

- **GIVEN** a clean fold whose subsequent worktree removal fails (for example, a locked path)
- **WHEN** `merge-lanes` handles the removal error
- **THEN** the fold is still reported as applied (the writes are in the shared tree)
- **AND** the un-removed worktree is reported as a cleanup warning rather than treated as a fold failure
