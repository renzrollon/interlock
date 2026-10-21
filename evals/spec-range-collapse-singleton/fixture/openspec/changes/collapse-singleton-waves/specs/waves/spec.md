## ADDED Requirements

### Requirement: Singleton implementation waves fold onto the previous wave

After classified groups have been turned into implementation waves and path collisions have been packed into batches, the planner MUST fold every implementation wave that contains exactly one task onto the immediately previous implementation wave as later batches of that wave, preserving task order. The surviving wave keeps the previous wave's group number. Each fold MUST be recorded on the plan (`folded` entries and a warning naming the task id, the group it left, and the group it joined). The trailing test wave MUST NOT fold into an implementation wave, and implementation waves MUST NOT fold into the test wave. A one-task implementation wave with no previous implementation wave remains a wave. Two consecutive implementation waves that each contain two or more tasks MUST stay separate waves.

Rationale: a 1-task wave is ordering, not a checkpoint. Each extra wave still spawns a record ping and, until the cap, an inter-wave verify ping.

#### Scenario: Happy path — a same-file staircase becomes one wave

- **GIVEN** six implementation tasks in groups 2 through 7, each group holding one task, all claiming `src/planet_wars_engine/match_runner.py`
- **WHEN** `interlock waves` plans them
- **THEN** the plan has `waveCount` 1, that wave has six batches in task-id order, and `folded` lists the five tasks that left groups 3–7
- **AND** `formatPlan` does not include an "effectively serial" warning for that collapsed staircase

#### Scenario: Failure — a singleton is not allowed to stay a checkpoint after a previous impl wave

- **GIVEN** group 9 holds two implementation tasks and group 12 holds one implementation task, with group 12 following group 9
- **WHEN** `interlock waves` plans them
- **THEN** group 12 is not a separate wave
- **AND** its task is a later batch of the wave whose group is 9

#### Scenario: Edge case — the test wave and a leading singleton are not folded away

- **GIVEN** one implementation task in group 1, no other implementation groups, and sixteen test tasks
- **WHEN** `interlock waves` plans them
- **THEN** the plan has one implementation wave (group 1) and a trailing test wave that still contains every test task
- **AND** two consecutive implementation waves that each contain two or more tasks remain two waves, even when a test wave follows

### Requirement: Creating a run does not merge planned batches

When `interlock wave-state create` starts a run from a plan, it MUST keep the plan's batch boundaries. It MAY split a batch whose width exceeds this run's `maxParallel`. It MUST NOT move a task into an earlier batch than the plan assigned, including when that later batch was created by folding a disjoint-path singleton and `maxParallel` is large enough that a flatten-and-repack would have co-scheduled them.

#### Scenario: Happy path — collision batches stay collision batches

- **GIVEN** `interlock waves` emitted three batches for one file
- **WHEN** `wave-state create` starts a run from that plan with `maxParallel` larger than 1
- **THEN** the run still has three batches for that wave

#### Scenario: Failure — a folded disjoint-path later batch is not pulled forward

- **GIVEN** a plan wave whose batch 0 claims `src/match_runner.py` and whose batch 1 (a folded singleton) claims `scripts/run_match.py`
- **WHEN** `wave-state create` starts a run with `maxParallel` at least 2
- **THEN** those two tasks remain in different batches, with the `run_match.py` task in a later batch
- **AND** they are not placed in the same concurrent batch

#### Scenario: Edge case — a batch wider than the runtime cap is split, not merged with its neighbor

- **GIVEN** a planned batch of 10 disjoint-path tasks followed by a later planned batch of 1 task, and the run's `maxParallel` is 8
- **WHEN** `wave-state create` starts the run
- **THEN** the first planned batch is split to fit 8
- **AND** the later planned task is still not in the first runtime batch

## MODIFIED Requirements

### Requirement: A shared file is not a reason for a new classified group

The ship classifier prompt MUST tell the model to default `group` to the numbered `tasks.md` section, to put predicted edit paths in `paths`, and to add a new group only when a later numbered section needs an earlier section's output to already exist. Sequential slices of the same file MUST remain in that file's section group. Sharing a file MUST be described as the planner's problem, not a reason to increment `group`.

#### Scenario: Classifier prompt forbids collision-as-group

- **GIVEN** an operator inspects the `plan-waves` prompt
- **WHEN** they read the grouping rules in `workflows/ship.js`
- **THEN** that prompt states that a shared file is not a reason for a new group and that groups default to numbered `tasks.md` sections

#### Scenario: Failure — sequential same-file slices are not a new group

- **GIVEN** the same `plan-waves` prompt
- **WHEN** an operator searches it for how to increment `group`
- **THEN** the prompt says a new group is only for a later numbered section that needs an earlier section's output
- **AND** it does not tell the model to increment `group` for the next slice of the same file

#### Scenario: Edge case — `paths` spelling still does not create a group

- **GIVEN** two tasks in section 2 that claim `src/a.ts` and `./src/a.ts`
- **WHEN** the classifier follows the prompt
- **THEN** both tasks keep group 2
- **AND** the planner, not a new group number, is what serializes the two spellings

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop (implementers + record pings + inter-wave verifies) from the collapsed wave list. It MUST warn when post-fold `waveCount > implCount * 0.5` for a plan with at least two implementation tasks. It MUST also report every fold. A staircase of one-task groups that the fold collapsed into one wave MUST NOT produce the effectively-serial warning.

#### Scenario: Serial plan warns

- **WHEN** after folding, 10 implementation tasks still occupy 8 implementation waves
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the task count

#### Scenario: Failure — a collapsed staircase is not called serial waves

- **GIVEN** 10 implementation tasks classified into 10 one-task groups
- **WHEN** `interlock waves` plans them and `formatPlan` renders the plan
- **THEN** `waveCount` is 1
- **AND** the output reports the folds and does not include an "effectively serial" warning

#### Scenario: Edge case — projected record pings follow the collapsed waves

- **GIVEN** six one-task implementation groups followed by a trailing test wave
- **WHEN** the projected wave-loop agent count is computed
- **THEN** the record-ping count is 2 (one implementation wave + one test wave), not 7
- **AND** the implementer count remains 6 plus the test-task count
