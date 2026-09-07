# lanes Specification

## Purpose

Groups tasks that are already forced to run one after another into a single lane executed by one agent, so a chain of edits to one file costs one spawn prefix instead of one per task. A lane is the unit that carries sequential work; lanes are path-disjoint by construction, so they run in parallel safely.

## Requirements

### Requirement: A lane SHALL be formed by a canonical-path collision or by cohesion within one dependency layer

A lane is either a connected component over canonical-path collisions, as before, or a **cohesion lane**: a concatenation of collision components from the same dependency layer of the same section whose hardest tier is at or below the published cohesion tier ceiling. Cohesion packing MUST walk components in the planner's hardest-first-then-id order and append each eligible component to the open cohesion lane while the lane's per-tier cap allows it, closing the lane and opening a new one otherwise. A component whose hardest tier is above the ceiling MUST NOT join a cohesion lane and MUST remain a lane of its own. Lane membership MUST still be derived from the single canonical path transform the planner already uses. Tasks that omit `paths` MUST NOT be treated as colliding, but MAY join a cohesion lane by tier.

#### Scenario: Happy path — seven small disjoint tasks become one lane

- **GIVEN** section 2 holds seven tasks of tier 2 or 3, each claiming a different `evals/*/case.yaml`, and the tier-3 lane cap is at least seven
- **WHEN** the planner builds the wave
- **THEN** all seven tasks occupy one lane, in task-id order, run by one agent
- **AND** the plan reports that lane as a cohesion fold naming every task id

#### Scenario: Failure — judgment-heavy tasks are not packed

- **GIVEN** section 1 holds three path-disjoint tier-4 tasks
- **WHEN** the planner builds the wave
- **THEN** each task is its own lane and the three run in parallel, exactly as before cohesion existed

#### Scenario: Edge case — the cap closes a cohesion lane and the remainder opens another

- **GIVEN** ten path-disjoint tier-1 tasks and a tier-1 lane cap of eight
- **WHEN** the planner builds the wave
- **THEN** the first eight tasks in id order form one lane and the remaining two form a second lane
- **AND** the two lanes are path-disjoint and are scheduled in the same batch

### Requirement: Cohesion SHALL NOT cross a dependency layer, a section, or the implementation/test boundary

A cohesion lane MUST contain tasks from exactly one dependency layer of exactly one section group, or from exactly one layer of the trailing test wave. A task in a later layer MUST NOT be packed beside a task it depends on. Test tasks MUST be packed by cohesion within the test wave under the same tier ceiling and caps, and MUST NOT be packed with implementation tasks in waves mode.

#### Scenario: Happy path — the test wave packs by cohesion

- **GIVEN** sixteen tier-2 test tasks with no edges and a tier-2 cap of eight
- **WHEN** the planner builds the test wave
- **THEN** the test wave holds two lanes of eight rather than sixteen single-task lanes

#### Scenario: Failure — a dependent task stays out of its dependency's lane

- **GIVEN** section 1 holds tier-2 tasks `1.1`, `1.2` and `1.3`, all path-disjoint, and `1.3` declares `dependsOn: ["1.1"]`
- **WHEN** the planner builds the wave
- **THEN** `1.1` and `1.2` may share a cohesion lane, and `1.3` is in a later batch or wave
- **AND** `1.3` is never in the same lane or batch as `1.1`

#### Scenario: Edge case — two sections never share a lane

- **GIVEN** section 1 holds one tier-1 task and section 2 holds one tier-1 task
- **WHEN** the planner builds the waves
- **THEN** the two tasks are in different waves and are not packed into one lane, even though both are cohesion-eligible

### Requirement: Every cohesion fold SHALL be reported with its kind

Each lane holding more than one task MUST be reported on the plan with a kind of `collision`, `cohesion` or `solo`. The plan preview MUST print cohesion lanes distinguishably from collision lanes, and the warning surface MUST name every cohesion fold with the ids it joined and the tier and cap that bounded it.

#### Scenario: Happy path — a cohesion lane is named in the preview

- **GIVEN** a plan in which four tier-2 tasks were packed into one lane
- **WHEN** `formatPlan` renders it
- **THEN** the preview lists that lane as a cohesion fold with its four ids and the tier-2 cap

#### Scenario: Failure — a collision lane is not relabelled as cohesion

- **GIVEN** a plan in which two tasks share a canonical path and were joined by collision, and a third path-disjoint tier-2 task was then packed with them by cohesion
- **WHEN** the plan is reported
- **THEN** the lane is reported as `cohesion` and the collision itself is still reported in the serialized-path report

#### Scenario: Edge case — a lane of one is not reported as a fold

- **GIVEN** a plan in which no component could be packed and every lane holds one task
- **WHEN** `formatPlan` renders it
- **THEN** no cohesion fold is listed, rather than a fold of size one

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

The number of tasks one agent may execute in a lane MUST be bounded by a per-tier cap table stated once in the limits module and read from that statement: a lane's cap is the entry for the highest tier among its tasks, and an untiered lane uses the tier-1 entry. A component larger than its cap MUST be split into multiple lanes that remain sequential relative to one another; tasks MUST NOT be dropped, reordered across the split, or scheduled concurrently as a result. A uniform override supplied to the planner MUST act as a ceiling over every tier's cap, so an override of 1 reproduces one agent per task exactly, including for cohesion. The table MUST be printed by `interlock limits` and MUST have a reader in the implementation — a test that only asserts a cap's value does not count as a reader.

#### Scenario: Happy path — a lane at the cap runs as one agent

- **GIVEN** the tier-3 cap is 6 and a cohesion lane of tier-3 tasks holds exactly 6
- **WHEN** the wave runs
- **THEN** one agent executes all 6 tasks in order

#### Scenario: Failure — an over-cap component is split, not truncated

- **GIVEN** the tier-4 cap is 4 and a collision component of tier-4 tasks holds 6
- **WHEN** the planner builds the wave
- **THEN** the component becomes two lanes of 4 and 2 tasks that run one after another
- **AND** all 6 tasks appear in the plan exactly once, in their original relative order

#### Scenario: Edge case — a cap of 1 reproduces one agent per task

- **GIVEN** the planner is given a uniform lane-cap override of 1
- **WHEN** it builds a wave from three cohesion-eligible disjoint tasks and one 3-task collision component
- **THEN** every lane holds exactly one task
- **AND** the resulting agent count matches the pre-lane behaviour

### Requirement: Tasks within a lane SHALL run in authored order at the lane's highest tier

Within a lane, tasks MUST execute in ascending task-id order, because sequential same-file work is ordered work, and a solo lane MUST execute in section, layer and id order. The hardest-first heuristic MUST apply only to placing lanes relative to one another, never to reordering tasks inside a lane. The lane MUST be dispatched on the model implied by the highest tier among its tasks, so that a lane containing a demanding task is never executed on a model chosen for a trivial one. The one exception is a solo lane, whose tasks the planner has promoted to opus and reported as promoted; it dispatches on opus because the decision to hand one agent the whole change is the planner's, not the classifier's.

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

#### Scenario: Edge case — a solo lane dispatches on opus whatever its tiers

- **GIVEN** a solo lane holding only tier-2 tasks
- **WHEN** the lane is dispatched
- **THEN** it runs on opus, with every promotion recorded in the plan
- **AND** the lane's recorded tier is still 2, so its effort is the published tier-2 effort

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
