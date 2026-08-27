## MODIFIED Requirements

### Requirement: A shared file is not a reason for a new classified group

The ship classifier prompt MUST tell the model to default `group` to the numbered `tasks.md` section, to put predicted edit paths in `paths`, and to add a new group only when a later numbered section needs an earlier section's output to already exist. Sequential slices of the same file MUST remain in that file's section group. Sharing a file MUST be described as the planner's problem, not a reason to increment `group`.

The prompt MUST additionally tell the model to populate `dependsOn` on a task with the ids of the earlier tasks whose output that task needs, and MUST tell it to prefer a precise `dependsOn` edge over incrementing `group` when a task depends on another task that edits a *different* file. Incrementing `group` to order one cross-file dependency serializes every task independent of it that shares the new group; a `dependsOn` edge orders only the dependent task, so its independent siblings stay parallel. Expressing a cross-file dependency MUST therefore be described as a reason to add an edge, not a reason to increment `group`.

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

#### Scenario: Cross-file dependency is an edge, not a new group

- **GIVEN** an operator inspects the `plan-waves` prompt
- **WHEN** they read how to express that a task depends on another task editing a different file
- **THEN** the prompt tells the model to add a `dependsOn` edge naming that earlier task
- **AND** it tells the model to prefer that edge over incrementing `group` so independent siblings are not serialized

## ADDED Requirements

### Requirement: A task's implementation wave SHALL be its topological depth over section groups and dependency edges

The planner MUST assign each task an implementation wave equal to its topological depth in the combined partial order formed by the union of (a) the numbered section groups, which remain a barrier, and (b) the explicit `dependsOn` edges. A task's depth MUST be strictly greater than the depth of every task it depends on and every task in an earlier section group. Ordering derived from edges MUST be additive: it can only place a task in a later wave than the section model alone would, never an earlier one. Depth ties MUST be broken by ascending task id so the assignment is a pure, reproducible function of the input. The existing wave→batch→lane pipeline, including the fold of a singleton implementation wave onto the previous wave, then runs unchanged over these depths, so a lone dependent task does not buy an extra inter-wave verification.

#### Scenario: Happy path — a cross-file dependency orders without a new section

- **GIVEN** section 1 holds task `1.1` editing `src/a.ts` and task `1.2` editing `src/b.ts`, and `1.2` carries `dependsOn: ["1.1"]`
- **WHEN** `interlock waves` plans them
- **THEN** `1.2` is scheduled in a strictly later batch or wave than `1.1`
- **AND** a third section-1 task `1.3` editing `src/c.ts` with no edge remains free to run in the same batch as `1.1`

#### Scenario: Failure — an edge cannot pull a task earlier than its section

- **GIVEN** task `2.1` in section 2 and task `1.1` in section 1, where section 2 follows section 1
- **WHEN** the plan is built, even if no edge connects them
- **THEN** `2.1`'s wave is still later than `1.1`'s
- **AND** an edge is never able to schedule a later-section task before an earlier-section task

#### Scenario: Edge case — an edge-free plan keeps today's wave assignment

- **GIVEN** a classified task list in which no task carries a non-empty `dependsOn`
- **WHEN** the planner assigns waves
- **THEN** each task's wave equals its section group as before, and the resulting waves, batches, and lanes are byte-identical to the pre-dependency planner

### Requirement: Tasks connected by a dependency edge SHALL NOT be co-scheduled

The planner MUST NOT place a task and any task it depends on — directly or transitively — in the same batch. A dependent task MUST appear only in a batch that runs after its dependency's batch has completed. This guarantee MUST hold whether the two tasks are path-disjoint or share a path: a shared path already forces them into one sequential lane, and a dependency edge forces the same relative order across separate lanes when they are path-disjoint. A dependency edge MUST NOT fold two path-disjoint tasks into one lane; lane membership remains a canonical-path collision component.

#### Scenario: Happy path — dependent path-disjoint tasks run in different batches

- **GIVEN** path-disjoint tasks `1.1` and `1.2` in one section with `1.2` depending on `1.1`
- **WHEN** the wave runs
- **THEN** `1.1` and `1.2` are in different batches, `1.2`'s batch running after `1.1`'s
- **AND** they remain two separate lanes rather than being folded into one agent

#### Scenario: Failure — an edge-connected pair is never placed side by side

- **GIVEN** a candidate schedule that would place `1.1` and its dependent `1.2` in the same concurrent batch
- **WHEN** the planner finalizes the wave
- **THEN** that schedule is not emitted; `1.2` is deferred to a later batch or wave

#### Scenario: Edge case — a diamond dependency serializes only along its edges

- **GIVEN** `1.2` and `1.3` each depend on `1.1`, `1.4` depends on both `1.2` and `1.3`, and all four edit different files
- **WHEN** the plan is built
- **THEN** `1.1` runs first, `1.2` and `1.3` may share a batch after it, and `1.4` runs after both
- **AND** `1.2` and `1.3`, having no edge between them, are not serialized relative to each other
