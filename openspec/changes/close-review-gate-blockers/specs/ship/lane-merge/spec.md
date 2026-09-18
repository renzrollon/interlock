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
