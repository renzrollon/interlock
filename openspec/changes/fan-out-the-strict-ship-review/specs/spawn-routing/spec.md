# Spec Delta

## ADDED Requirements

### Requirement: The run program SHALL route its review and skeptic spawns from the same table through the routing module

A strict ship run's review spawns SHALL carry the `review-dimension` row at the strict depth and its skeptic spawns the `review-skeptic` row, each resolved by the routing module's resolver, never by indexing the table. The run program SHALL name no model slug and no effort level for them, SHALL raise no `ROUTING UNAVAILABLE` line because it imports the resolver and cannot lose it, and SHALL carry any environment-override banner the resolver returns on the step.

#### Scenario: Happy path — a strict run's reviewers and skeptics carry the table's values

- **GIVEN** an environment with neither override variable set, and the published table
- **WHEN** a strict run emits its review step and later its skeptics step
- **THEN** every `review-<dimension>` spawn carries the `model` and `effort` `interlock routing review-dimension --depth strict --json` prints, and every skeptic spawn those `interlock routing review-skeptic --json` prints, with `null` as a spawn field the drivers omit

#### Scenario: Failure — an override is spoken on the step

- **GIVEN** `CLAUDE_CODE_EFFORT_LEVEL=high` in the run's environment
- **WHEN** the review step is emitted
- **THEN** the step's `banners` carries `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=high` once, and the spawns still carry the table's values

#### Scenario: Failure — the run program indexes the table itself

- **GIVEN** a `lib/run.mjs` into which `SPAWN_ROUTING[` has been written
- **WHEN** the reader pin over the routing tables runs
- **THEN** it fails naming `lib/run.mjs`, because the only module that may index `SPAWN_ROUTING` or `REVIEW_DEPTH` is the routing module

#### Scenario: Edge case — the six roles are unchanged

- **GIVEN** the published table after this change
- **WHEN** `interlock routing --json` runs
- **THEN** `roles` holds the same six roles, and `interlock routing not-a-role` still names six on standard error
