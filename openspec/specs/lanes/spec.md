# lanes Specification

## Purpose

Groups tasks that are already forced to run one after another into a single lane executed by one agent, so a chain of edits to one file costs one spawn prefix instead of one per task. A lane is the unit that carries sequential work; lanes are path-disjoint by construction, so they run in parallel safely.

## Requirements

### Requirement: A lane SHALL contain only tasks joined by a canonical-path collision

A lane is a connected component over the canonical-path collisions the planner already detects. Two tasks belong to the same lane if and only if they claim a common canonical path, directly or transitively through another task in the lane. A task deferred out of a batch because the batch reached `maxParallel` — and not because of a path collision — is path-disjoint from that batch and MUST remain its own lane. Lane membership MUST be derived from the single canonical path transform the planner already uses; a second path-comparison form MUST NOT be introduced. Tasks that omit `paths` MUST NOT be treated as colliding and MUST each form their own lane.

#### Scenario: Happy path — a same-file chain becomes one lane

- **GIVEN** group 1 contains tasks `1.1`, `1.3` and `1.4`, each claiming `src/auth.ts`
- **WHEN** the planner builds the wave
- **THEN** those three tasks occupy a single lane in wave 1, in that order
- **AND** the wave reports one lane for them rather than three single-task batches

#### Scenario: Failure — a width-deferred task does not join a lane

- **GIVEN** `maxParallel` is 2 and group 1 contains `1.1` claiming `src/a.ts`, `1.2` claiming `src/b.ts`, and `1.3` claiming `src/c.ts`, all disjoint
- **WHEN** the planner builds the wave
- **THEN** `1.3` is its own lane and is NOT appended to the lane holding `1.1` or `1.2`
- **AND** `1.3` runs in a later batch of parallel lanes rather than sequentially inside another lane's agent

#### Scenario: Edge case — spellings that differ only in a path-syntax artifact

- **GIVEN** task `1.1` claims `src/auth.ts` and task `1.2` claims `./src/auth.ts`
- **WHEN** the planner builds the wave
- **THEN** both tasks land in the same lane, because the two spellings canonicalize to one path
- **AND** each task is still reported using the spelling its author wrote

### Requirement: Lanes scheduled together SHALL be path-disjoint

Lanes placed in the same batch run concurrently, so the planner MUST guarantee that no two of them claim a common canonical path. A task claiming two paths that each already belong to a different lane MUST cause those lanes to merge into one lane rather than be scheduled side by side. A predicted path that is absolute or escapes the repository root MUST be rejected and reported, exactly as it is today, and MUST NOT be normalized into scope in order to place a lane.

#### Scenario: Happy path — disjoint lanes run concurrently

- **GIVEN** lane A holds two tasks claiming `src/auth.ts` and lane B holds one task claiming `src/billing.ts`
- **WHEN** the wave runs
- **THEN** both lanes are dispatched in the same batch and run in parallel

#### Scenario: Failure — two lanes sharing a path are not scheduled side by side

- **GIVEN** a candidate schedule places lane A (claiming `src/auth.ts`) and lane B (also claiming `src/auth.ts`) in one batch
- **WHEN** the planner finalizes the wave
- **THEN** that schedule is not emitted; the two lanes are merged into one sequential lane instead
- **AND** no batch is emitted in which two lanes share a canonical path

#### Scenario: Edge case — one task bridges two existing chains

- **GIVEN** task `1.1` claims `src/a.ts`, task `1.2` claims `src/b.ts`, and task `1.3` claims both `src/a.ts` and `src/b.ts`
- **WHEN** the planner builds the wave
- **THEN** all three tasks occupy one lane, because `1.3` connects the two chains
- **AND** they are not emitted as two lanes running in parallel

### Requirement: Lane length SHALL be bounded by a published cap

The number of tasks one agent may execute in a lane MUST be bounded by a cap stated once in the limits module and read from that statement. A component larger than the cap MUST be split into multiple lanes that remain sequential relative to one another; tasks MUST NOT be dropped, reordered across the split, or scheduled concurrently as a result. The cap MUST be printed by `interlock limits` and MUST have a reader in the implementation — a test that only asserts the cap's value does not count as a reader.

#### Scenario: Happy path — a lane at the cap runs as one agent

- **GIVEN** the cap is 4 and a collision component holds exactly 4 tasks
- **WHEN** the wave runs
- **THEN** one agent executes all 4 tasks in order

#### Scenario: Failure — an over-cap component is split, not truncated

- **GIVEN** the cap is 4 and a collision component holds 6 tasks
- **WHEN** the planner builds the wave
- **THEN** the component becomes two lanes of 4 and 2 tasks that run one after another
- **AND** all 6 tasks appear in the plan exactly once, in their original relative order

#### Scenario: Edge case — a cap of 1 reproduces one agent per task

- **GIVEN** the cap is set to 1
- **WHEN** the planner builds a wave from a 3-task collision component
- **THEN** the wave holds three single-task lanes that run sequentially
- **AND** the resulting agent count matches the pre-lane behaviour

### Requirement: Tasks within a lane SHALL run in authored order at the lane's highest tier

Within a lane, tasks MUST execute in ascending task-id order, because sequential same-file work is ordered work. The hardest-first heuristic MUST apply only to placing lanes relative to one another, never to reordering tasks inside a lane. The lane MUST be dispatched on the model implied by the highest tier among its tasks, so that a lane containing a demanding task is never executed on a model chosen for a trivial one.

#### Scenario: Happy path — a lane preserves task-id order

- **GIVEN** a lane holds tasks `1.4`, `1.1` and `1.3` as discovered
- **WHEN** the lane is dispatched
- **THEN** the agent is instructed to implement `1.1`, then `1.3`, then `1.4`

#### Scenario: Failure — hardest-first does not reorder inside a lane

- **GIVEN** a lane holds tier-2 task `1.1` and tier-4 task `1.2`
- **WHEN** the lane is dispatched
- **THEN** `1.1` is still executed before `1.2`
- **AND** the tier-4 task is not promoted ahead of the tier-2 task it depends on

#### Scenario: Edge case — a mixed-tier lane runs at the maximum tier

- **GIVEN** a lane holds a tier-1 task and a tier-5 task
- **WHEN** the lane is dispatched
- **THEN** the lane runs on the model assigned to tier 5, not the model assigned to tier 1
- **AND** the tier used for the lane is recorded in the plan

### Requirement: A lane SHALL report an outcome for every task it was given

A lane result MUST carry a per-task outcome of `ok`, `failed`, or `not-attempted`. Tasks positioned after a failed task in the same lane MUST be reported as `not-attempted`, which is distinct from `failed`: a `not-attempted` task MUST NOT be marked complete and MUST NOT be counted toward the accumulated task-failure budget that halts a run. Every attempted task MUST carry its own handoff packet; `not-attempted` tasks MUST carry none, and their absence MUST NOT be treated as an invalid result. A lane result that omits outcomes for tasks it was given MUST fail every task in that lane closed rather than being interpreted.

#### Scenario: Happy path — a fully successful lane ticks every task

- **GIVEN** a lane of three tasks that all succeed
- **WHEN** the lane result is recorded
- **THEN** all three task ids are marked complete
- **AND** three handoff packets are stored, one per task

#### Scenario: Failure — a mid-lane failure does not fail the tasks behind it

- **GIVEN** a lane of three tasks in which the first succeeds and the second fails
- **WHEN** the lane result is recorded
- **THEN** the first task is marked complete, the second is recorded as failed with its blocker, and the third is recorded as `not-attempted`
- **AND** the accumulated failure count increases by one, not by two
- **AND** the third task is not marked complete

#### Scenario: Edge case — a lane result with no per-task outcomes

- **GIVEN** a lane of two tasks whose agent returns a result carrying no per-task outcomes
- **WHEN** the lane result is recorded
- **THEN** both tasks are recorded as failed with an invalid-result reason
- **AND** neither task is marked complete
