## ADDED Requirements

### Requirement: A task SHALL NOT run concurrently with a task it depends on

The planner MUST NOT schedule a task concurrently with any task it depends on, directly or transitively.

- **Never concurrent.** Two such tasks MUST NOT be separate lanes of the same batch. A dependent task MUST run only after its dependency has completed: in a later batch, or later in the same lane. This MUST hold whether the two tasks are path-disjoint or share a path.
- **Within a layer.** A shared path already forces two tasks into one sequential lane. A dependency edge between path-disjoint tasks orders them across layers. In waves mode a dependency edge MUST NOT by itself join two path-disjoint tasks when lanes are formed within a layer; that lane membership remains a canonical-path collision component or a cohesion lane.
- **After batching.** A dependent task and its dependency whose lanes are each alone in consecutive batches of one wave MAY be fused into one chain lane, the dependent task positioned after its dependency.
- **Solo mode.** The whole change is one ordered lane, and every edge MUST be honoured by the dependent task's position after its dependency in that lane.

#### Scenario: Happy path — dependent path-disjoint tasks never run concurrently

- **GIVEN** path-disjoint tasks `1.1` and `1.2` form a section on their own, with `1.2` depending on `1.1`
- **WHEN** the wave is planned in waves mode
- **THEN** `1.2` runs after `1.1`: the two single-lane batches the edge produces fuse into one chain lane in which `1.1` precedes `1.2`
- **AND** `1.1` and `1.2` are never two lanes of one batch

#### Scenario: Failure — an edge-connected pair is never placed side by side

- **GIVEN** a candidate schedule that would place `1.1` and its dependent `1.2` as two lanes of the same concurrent batch
- **WHEN** the planner finalizes the wave
- **THEN** that schedule is not emitted; `1.2` is deferred to a later batch or wave, or to a later position in a chain lane after `1.1`

#### Scenario: Edge case — a diamond dependency serializes only along its edges

- **GIVEN** `1.2` and `1.3` each depend on `1.1`, `1.4` depends on both `1.2` and `1.3`, all four are tier 4, and all four edit different files
- **WHEN** the plan is built in waves mode
- **THEN** `1.1` runs first, `1.2` and `1.3` share a batch as two concurrent lanes after it, and `1.4` runs after both
- **AND** `1.2` and `1.3`, having no edge between them, are not serialized relative to each other
- **AND** no chain lane is formed, because the middle batch runs two lanes

#### Scenario: Edge case — a solo lane honours the same diamond by order

- **GIVEN** the same diamond
- **WHEN** the plan is built in solo mode
- **THEN** the single lane orders `1.1` before `1.2` and `1.3`, and both before `1.4`

## MODIFIED Requirements

### Requirement: Singleton implementation waves fold onto the previous wave

After classified groups have been turned into implementation waves and path collisions have been packed into batches, the planner MUST fold every implementation wave that contains exactly one task onto the immediately previous implementation wave, as later batches of that wave, preserving task order.

- **Group number.** The surviving wave keeps the previous wave's group number.
- **Recording.** Each fold MUST be recorded on the plan: `folded` entries, and a warning naming the task id, the group it left, and the group it joined.
- **What never folds.** The trailing test wave MUST NOT fold into an implementation wave, and implementation waves MUST NOT fold into the test wave. A one-task implementation wave with no previous implementation wave remains a wave. Two consecutive implementation waves that each contain two or more tasks MUST stay separate waves.
- **Then fusion.** Once folding is done, the wave's batches are subject to chain fusion, so a folded staircase of single-lane batches ends as chain lanes rather than as one agent per batch.

Rationale: a 1-task wave is ordering, not a checkpoint. Each extra wave still spawns a record ping and, until the cap, an inter-wave verify ping.

#### Scenario: Happy path — a same-file staircase becomes one wave

- **GIVEN** six tier-2 implementation tasks in groups 2 through 7, each group holding one task, all claiming `src/planet_wars_engine/match_runner.py`
- **WHEN** `interlock waves` plans them
- **THEN** the plan has `waveCount` 1, and `folded` lists the five tasks that left groups 3–7
- **AND** the wave's six single-lane batches fuse into one chain lane that runs the six tasks in task-id order
- **AND** `formatPlan` does not include an "effectively serial" warning for that collapsed staircase

#### Scenario: Failure — a singleton is not allowed to stay a checkpoint after a previous impl wave

- **GIVEN** group 9 holds two implementation tasks and group 12 holds one implementation task, with group 12 following group 9
- **WHEN** `interlock waves` plans them
- **THEN** group 12 is not a separate wave
- **AND** its task runs after group 9's tasks inside the wave whose group is 9: as a later batch, or, when group 9's tasks occupy one lane, as the last task of the chain lane fused from them

#### Scenario: Edge case — the test wave and a leading singleton are not folded away

- **GIVEN** one implementation task in group 1, no other implementation groups, and sixteen test tasks
- **WHEN** `interlock waves` plans them
- **THEN** the plan has one implementation wave (group 1) and a trailing test wave that still contains every test task
- **AND** two consecutive implementation waves that each contain two or more tasks remain two waves, even when a test wave follows

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop: implementers, record pings and inter-wave verifies.

- **Serial warning.** It MUST warn that a plan is effectively serial when the plan holds at least two implementation lanes before chain fusion and its wave count exceeds half that pre-fusion lane count. A chain the planner has already fused MUST NOT by itself trigger the warning.
- **Implementer count.** The implementer count MUST be the number of lanes the plan dispatches, after fusion, not the number of tasks it contains, because one lane is one agent however many tasks it carries.
- **Folds.** Every lane holding more than one task MUST be reported in the plan preview with its kind — collision, cohesion, chain or solo — and the model it dispatches on, alongside the existing collision reporting, so a fold is visible rather than inferred from a smaller agent count.
- **Mode and promotions.** The preview MUST open by naming the plan's mode and the source of that decision, and MUST print every model promotion a solo plan made beside the existing clamp report.

#### Scenario: Serial plan warns

- **WHEN** 10 implementation tasks are classified into 8 waves with no lane folding possible
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the lane count

#### Scenario: Happy path — the bill counts lanes, not tasks

- **GIVEN** a plan whose single wave holds one lane of 4 tasks and two lanes of 1 task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count is 3
- **AND** the preview names the 4-task lane as a fold with its kind and the model opus

#### Scenario: Happy path — a fused chain lowers the bill

- **GIVEN** a wave planned as four consecutive single-lane batches that fuse into one chain lane
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count for that wave is 1, not 4
- **AND** the preview names the lane as a chain on opus

#### Scenario: Edge case — a plan in which every lane holds one task

- **GIVEN** a plan with no path collisions, no cohesion-eligible siblings and no consecutive single-lane batches, so every lane holds exactly one task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count equals the task count
- **AND** no fold is reported, rather than a fold of size one being listed

#### Scenario: Solo preview names the mode and the bill

- **GIVEN** a solo plan of twelve tasks decided by the classifier
- **WHEN** `formatPlan` renders it
- **THEN** its first line names the mode as solo with source `classifier` and the reason
- **AND** the projected agent count is one implementer plus one record ping and no verify pings
- **AND** every promoted task is listed beside the clamp report

## REMOVED Requirements

### Requirement: Tasks connected by a dependency edge SHALL NOT be co-scheduled

**Reason**: It required that a dependency edge never place two path-disjoint tasks in one lane, and its happy-path scenario said they "remain two separate lanes rather than being folded into one agent". Chain fusion now deliberately runs a dependent task after its dependency inside one chain lane, when their batches hold one lane each. OpenSpec cannot drop a scenario from a MODIFIED block, so the requirement is replaced rather than edited.

**Migration**: The guarantee that matters — a dependent task never runs concurrently with its dependency — is restated in full as "A task SHALL NOT run concurrently with a task it depends on". Within-layer lane formation is unchanged. Joining the two tasks in one lane after batching is governed by the `lanes` requirement "Serial single-lane batches SHALL fuse into one chain lane".
