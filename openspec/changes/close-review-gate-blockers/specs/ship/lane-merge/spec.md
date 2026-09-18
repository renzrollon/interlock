## ADDED Requirements

### Requirement: Fold contention SHALL include every path the fold will mutate

When `merge-lanes` builds the per-lane changed-path set for collision detection, that set SHALL contain every canonical path the fold would create, modify, or delete for that lane — not only the destination path git reports as `path`. A rename's source path is a mutation (the fold deletes it). A copy's source path is not a mutation (the fold does not delete it) and SHALL NOT be entered as a contention key solely because it was the copy source.

Rationale: `lane-merge` already forbids last-writer-wins on a shared canonical path. Keying only on the rename destination makes an edit of the source and a rename of the source look disjoint; the fold then restores or deletes the source depending on order.

#### Scenario: Happy path — a rename whose source nobody else touched folds cleanly

- **GIVEN** a completed batch of two lanes, lane A having renamed `lib/a.mjs` to `lib/b.mjs` and lane B having edited `lib/c.mjs`
- **WHEN** `merge-lanes` folds the batch
- **THEN** the shared tree contains `lib/b.mjs`, does not contain `lib/a.mjs`, and contains lane B's edit of `lib/c.mjs`
- **AND** the command reports a clean fold and does not report a collision

#### Scenario: Failure — an edit of a path another lane renamed SHALL halt

- **GIVEN** a completed batch where lane A renamed `lib/a.mjs` to `lib/b.mjs` and lane B edited `lib/a.mjs`
- **WHEN** `merge-lanes` checks for contention
- **THEN** it SHALL halt without modifying the shared tree
- **AND** the halt report SHALL name the canonical source path `lib/a.mjs` as contended
- **AND** the halt report SHALL name lanes A and B as the contenders
- **AND** last-writer-wins keyed only on destination `path` — which would have treated the lanes as disjoint — SHALL NOT be used

#### Scenario: Edge case — a copy's source is not a contention key

- **GIVEN** a completed batch where lane A copied `lib/a.mjs` to `lib/b.mjs` (source still present, unmodified) and lane B edited `lib/a.mjs`
- **WHEN** `merge-lanes` checks for contention
- **THEN** no collision is reported on `lib/a.mjs` solely because it was the copy source
- **AND** the fold MAY complete, applying the copy at `lib/b.mjs` and lane B's edit at `lib/a.mjs`

## MODIFIED Requirements

### Requirement: A real path collision at merge time SHALL halt, never auto-resolve

When two lanes in a batch mutate the same canonical path — a prediction the planner made disjoint but that turned out to contend — `merge-lanes` SHALL halt the run. Mutating means creating, modifying or deleting: a lane that renames a file away mutates the source path it deletes, so it contends with a lane that edits that source, and "wrote" is too narrow a test. The halt SHALL name the contended canonical path(s) and the two lane labels that mutate them. `merge-lanes` SHALL NOT apply last-writer-wins, SHALL NOT attempt a textual auto-merge, and SHALL NOT record the batch as folded.

Rationale: a silent overwrite is the exact lost-write defect `wave-isolation` exists to prevent. Resolving the collision away would report success over a discarded write — strictly worse than the shared-tree race, which at least the collision check tried to narrow. The command fails closed in one direction only: an uncertain fold is a halt, never an applied guess.

#### Scenario: Happy path — a genuinely disjoint batch is not treated as a collision

- **GIVEN** a batch whose two lane worktrees mutate canonical paths that share no member
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
- **WHEN** `merge-lanes` compares the lanes' actual mutations
- **THEN** both spellings resolve to one canonical path and the batch SHALL halt as a collision
- **AND** last-writer-wins keyed on the raw spelling — which would have admitted the overwrite — SHALL NOT be used
