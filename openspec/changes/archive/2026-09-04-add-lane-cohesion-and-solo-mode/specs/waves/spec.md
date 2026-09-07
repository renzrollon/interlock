## MODIFIED Requirements

### Requirement: A shared file is not a reason for a new classified group

The ship classifier prompt MUST tell the model to default `group` to the numbered `tasks.md` section, to put predicted edit paths in `paths`, and to add a new group only when a later numbered section needs an earlier section's output to already exist. Sequential slices of the same file MUST remain in that file's section group. Sharing a file MUST be described as the planner's problem, not a reason to increment `group`.

The prompt MUST additionally tell the model to populate `dependsOn` on a task with the ids of the earlier tasks whose output that task needs, and MUST tell it to prefer a precise `dependsOn` edge over incrementing `group` when a task depends on another task that edits a *different* file. Incrementing `group` to order one cross-file dependency serializes every task independent of it that shares the new group; a `dependsOn` edge orders only the dependent task, so its independent siblings stay parallel. Expressing a cross-file dependency MUST therefore be described as a reason to add an edge, not a reason to increment `group`.

The prompt MUST additionally tell the model to emit a top-level `recommendedMode` of `solo` or `waves` with a one-line `modeReason`, describing solo as one agent implementing the whole change in order, and MUST tell it that the planner enforces a published envelope on that recommendation rather than stating the envelope's value.

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

#### Scenario: Mode recommendation is requested without its bound

- **GIVEN** an operator inspects the assembled `plan-waves` prompt
- **WHEN** they read how the classifier is told to recommend a mode
- **THEN** the prompt asks for `recommendedMode` and `modeReason` at the top level
- **AND** it names the published envelope as the planner's to enforce and does not state its numeric value

### Requirement: Tasks connected by a dependency edge SHALL NOT be co-scheduled

The planner MUST NOT place a task and any task it depends on — directly or transitively — in the same batch. A dependent task MUST appear only in a batch that runs after its dependency's batch has completed. This guarantee MUST hold whether the two tasks are path-disjoint or share a path: a shared path already forces them into one sequential lane, and a dependency edge forces the same relative order across separate lanes when they are path-disjoint. In waves mode a dependency edge MUST NOT fold two path-disjoint tasks into one lane; lane membership remains a canonical-path collision component or a cohesion lane within one dependency layer. In solo mode the whole change is one ordered lane, and every edge MUST be honoured by the dependent task's position after its dependency in that lane.

#### Scenario: Happy path — dependent path-disjoint tasks run in different batches

- **GIVEN** path-disjoint tasks `1.1` and `1.2` in one section with `1.2` depending on `1.1`
- **WHEN** the wave runs in waves mode
- **THEN** `1.1` and `1.2` are in different batches, `1.2`'s batch running after `1.1`'s
- **AND** they remain two separate lanes rather than being folded into one agent

#### Scenario: Failure — an edge-connected pair is never placed side by side

- **GIVEN** a candidate schedule that would place `1.1` and its dependent `1.2` in the same concurrent batch
- **WHEN** the planner finalizes the wave
- **THEN** that schedule is not emitted; `1.2` is deferred to a later batch or wave

#### Scenario: Edge case — a diamond dependency serializes only along its edges

- **GIVEN** `1.2` and `1.3` each depend on `1.1`, `1.4` depends on both `1.2` and `1.3`, and all four edit different files
- **WHEN** the plan is built in waves mode
- **THEN** `1.1` runs first, `1.2` and `1.3` may share a batch after it, and `1.4` runs after both
- **AND** `1.2` and `1.3`, having no edge between them, are not serialized relative to each other

#### Scenario: Edge case — a solo lane honours the same diamond by order

- **GIVEN** the same diamond
- **WHEN** the plan is built in solo mode
- **THEN** the single lane orders `1.1` before `1.2` and `1.3`, and both before `1.4`

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop (implementers + record pings + inter-wave verifies) and MUST warn when `waveCount > implCount * 0.5` for a plan with at least two implementation tasks — that shape is effectively serial. The implementer count MUST be the number of lanes the plan dispatches, not the number of tasks it contains, because one lane is one agent regardless of how many tasks it carries. Every lane holding more than one task MUST be reported in the plan preview with its kind — collision, cohesion or solo — alongside the existing collision reporting, so that a fold is visible rather than inferred from a smaller agent count. The preview MUST open by naming the plan's mode and the source of that decision, and MUST print every model promotion a solo plan made beside the existing clamp report.

#### Scenario: Serial plan warns

- **WHEN** 10 implementation tasks are classified into 8 waves with no lane folding possible
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the lane count

#### Scenario: Happy path — the bill counts lanes, not tasks

- **GIVEN** a plan whose single wave holds one lane of 4 tasks and two lanes of 1 task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count is 3
- **AND** the preview names the 4-task lane as a fold with its kind

#### Scenario: Edge case — a plan in which every lane holds one task

- **GIVEN** a plan with no path collisions and no cohesion-eligible siblings, so every lane holds exactly one task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count equals the task count
- **AND** no fold is reported, rather than a fold of size one being listed

#### Scenario: Solo preview names the mode and the bill

- **GIVEN** a solo plan of twelve tasks decided by the classifier
- **WHEN** `formatPlan` renders it
- **THEN** its first line names the mode as solo with source `classifier` and the reason
- **AND** the projected agent count is one implementer plus one record ping and no verify pings
- **AND** every promoted task is listed beside the clamp report
