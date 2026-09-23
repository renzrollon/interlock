# lanes Specification

## Purpose

Groups tasks that are already forced to run one after another into a single lane executed by one agent, so a chain of edits to one file costs one spawn prefix instead of one per task. A lane is the unit that carries sequential work; lanes are path-disjoint by construction, so they run in parallel safely.

## Requirements

### Requirement: A lane SHALL be formed by a canonical-path collision or by cohesion within one dependency layer

Within one dependency layer, a lane is either a connected component over canonical-path collisions, as before, or a **cohesion lane**: a concatenation of collision components from the same dependency layer of the same section whose hardest tier is at or below the published cohesion tier ceiling.

- Cohesion packing MUST walk components in the planner's hardest-first-then-id order. It appends each eligible component to the open cohesion lane while the lane's per-tier cap allows, and otherwise closes the lane and opens a new one.
- A component whose hardest tier is above the ceiling MUST NOT join a cohesion lane and MUST remain a lane of its own.
- Lane membership MUST still be derived from the single canonical path transform the planner already uses.
- Tasks that omit `paths` MUST NOT be treated as colliding, but MAY join a cohesion lane by tier.

A third kind, the **chain lane**, is formed only after batching, from consecutive single-lane batches of one wave, and is governed by its own requirement. Chain fusion MUST NOT change how collision and cohesion lanes are formed within a layer.

#### Scenario: Happy path — seven small disjoint tasks become one lane

- **GIVEN** section 2 holds seven tier-2 tasks, each claiming a different `evals/*/case.yaml`, and the tier-2 lane cap is at least seven
- **WHEN** the planner builds the wave
- **THEN** all seven tasks occupy one lane, in task-id order, run by one agent
- **AND** the plan reports that lane as a cohesion fold naming every task id

#### Scenario: Failure — judgment-heavy tasks are not packed

- **GIVEN** section 1 holds three path-disjoint tier-4 tasks and the batch width is at least three
- **WHEN** the planner builds the wave
- **THEN** each task is its own lane and the three run in parallel, exactly as before cohesion existed
- **AND** they are not fused into a chain, because their batch holds three lanes

#### Scenario: Edge case — the cap closes a cohesion lane and the remainder opens another

- **GIVEN** ten path-disjoint tier-1 tasks and a tier-1 lane cap of eight
- **WHEN** the planner builds the wave
- **THEN** the first eight tasks in id order form one lane and the remaining two form a second lane
- **AND** the two lanes are path-disjoint and are scheduled in the same batch

### Requirement: Cohesion SHALL stay within one dependency layer of one section, on one side of the test boundary

A cohesion lane MUST contain tasks from exactly one dependency layer of exactly one section group, or from exactly one layer of the trailing test wave. A task in a later layer MUST NOT be packed into a cohesion lane beside a task it depends on. Test tasks MUST be packed by cohesion within the test wave under the same tier ceiling and caps, and MUST NOT be packed with implementation tasks in waves mode.

This bounds cohesion lanes only. A chain lane may hold tasks from several layers and sections of one wave, each after the tasks it depends on, under the chain requirement.

#### Scenario: Happy path — the test wave packs by cohesion

- **GIVEN** sixteen tier-2 test tasks with no edges and a tier-2 cap of eight
- **WHEN** the planner builds the test wave
- **THEN** the test wave holds two lanes of eight rather than sixteen single-task lanes

#### Scenario: Failure — a dependent task stays out of its dependency's cohesion lane

- **GIVEN** section 1 holds tier-2 tasks `1.1`, `1.2` and `1.3`, all path-disjoint, and `1.3` declares `dependsOn: ["1.1"]`
- **WHEN** the planner builds the wave
- **THEN** `1.1` and `1.2` may share a cohesion lane, and `1.3` is never in that cohesion lane
- **AND** `1.3` is never a separate lane of the same batch as `1.1`
- **AND** when `1.1`'s lane and `1.3`'s lane are each alone in consecutive batches, they fuse into one chain lane in which `1.3` runs after `1.1`

#### Scenario: Edge case — two sections never share a cohesion lane

- **GIVEN** section 1 holds one tier-1 task and section 2 holds one tier-1 task
- **WHEN** the planner builds the waves
- **THEN** the two tasks are not packed into one cohesion lane, even though both are cohesion-eligible
- **AND** the section-2 task's singleton wave folds onto section 1's wave as a later batch, and the two single-lane batches fuse into one chain lane that runs the section-1 task first

### Requirement: Every cohesion fold SHALL be reported with its kind

- **Kinds.** Each lane holding more than one task MUST be reported on the plan with its final kind: `collision`, `cohesion`, `chain` or `solo`. The report MUST include the model the lane dispatches on.
- **Preview.** The plan preview MUST print cohesion and chain lanes distinguishably from collision lanes.
- **Warnings.** The warning surface MUST name every cohesion fold with the ids it joined and the tier and cap that bounded it. It MUST name every chain with the ids it joined, the number of batches it replaced, and the cap that bounded it.

#### Scenario: Happy path — a cohesion lane is named in the preview

- **GIVEN** a plan in which four tier-2 tasks were packed into one lane
- **WHEN** `formatPlan` renders it
- **THEN** the preview lists that lane as a cohesion fold with its four ids and the tier-2 cap

#### Scenario: Happy path — a chain lane is named in the preview

- **GIVEN** a plan in which three consecutive single-lane batches of one wave were fused
- **WHEN** `formatPlan` renders it
- **THEN** the preview lists that lane as a chain with its ids in run order and its model
- **AND** a warning names the ids, the three batches it replaced and the cap that bounded it

#### Scenario: Failure — a collision lane is not relabelled as cohesion

- **GIVEN** a plan in which two tasks share a canonical path and were joined by collision, and a third path-disjoint tier-2 task was then packed with them by cohesion
- **WHEN** the plan is reported
- **THEN** the lane is reported as `cohesion` and the collision itself is still reported in the serialized-path report

#### Scenario: Edge case — a lane of one is not reported as a fold

- **GIVEN** a plan in which no component could be packed, no batches could be fused, and every lane holds one task
- **WHEN** `formatPlan` renders it
- **THEN** no fold or chain is listed, rather than a fold of size one

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

The number of tasks one agent may execute in a lane MUST be bounded by a per-tier cap table stated once in the limits module and read from that statement.

- **Which entry.** A lane's cap is the entry for the highest tier among its tasks. An untiered lane uses the tier-1 entry. A chain lane is bounded the same way as any other lane.
- **Over-cap components.** A component larger than its cap MUST be split into multiple lanes that stay sequential relative to one another. Tasks MUST NOT be dropped, reordered across the split, or scheduled concurrently as a result. Chain fusion MUST NOT re-join the parts of such a split beyond the cap.
- **Uniform override.** A uniform override supplied to the planner MUST act as a ceiling over every tier's cap, so an override of 1 reproduces one agent per task exactly, including for cohesion and chain fusion.
- **Publication.** The table MUST be printed by `interlock limits` and MUST have a reader in the implementation. A test that only asserts a cap's value does not count as a reader.

#### Scenario: Happy path — a lane at the cap runs as one agent

- **GIVEN** the tier-3 cap is 6 and a cohesion lane of tier-3 tasks holds exactly 6
- **WHEN** the wave runs
- **THEN** one agent executes all 6 tasks in order

#### Scenario: Failure — an over-cap component is split, not truncated

- **GIVEN** the tier-4 cap is 4 and a collision component of tier-4 tasks holds 6
- **WHEN** the planner builds the wave
- **THEN** the component becomes two lanes of 4 and 2 tasks that run one after another
- **AND** all 6 tasks appear in the plan exactly once, in their original relative order
- **AND** chain fusion does not re-join the two lanes into one lane of 6

#### Scenario: Edge case — a cap of 1 reproduces one agent per task

- **GIVEN** the planner is given a uniform lane-cap override of 1
- **WHEN** it builds a wave from three cohesion-eligible disjoint tasks and one 3-task collision component
- **THEN** every lane holds exactly one task
- **AND** no chain lane is formed
- **AND** the resulting agent count matches the pre-lane behaviour

### Requirement: Tasks within a lane SHALL run in authored order at the lane's highest tier

- **Order inside a lane.**
  - A collision or cohesion lane MUST execute its tasks in ascending task-id order, because sequential same-file work is ordered work.
  - A chain lane MUST execute in the batch order it was fused from, each fused lane keeping its own order.
  - A solo lane MUST execute in section, layer and id order.
- **Hardest-first.** The hardest-first heuristic MUST apply only to placing lanes relative to one another, never to reordering tasks inside a lane.
- **Tier.** A lane's briefing tier and its effort MUST be taken from the highest tier among its tasks, so a lane containing a demanding task is never briefed or run at a trivial task's tier.
- **Model.** The model a lane dispatches on is governed by the requirement that a lane's model follows its shape. A solo lane dispatches on opus because the planner promoted its tasks and reported each promotion: handing one agent the whole change is the planner's decision, not the classifier's.

#### Scenario: Happy path — a lane preserves task-id order

- **GIVEN** a lane holds tasks `1.4`, `1.1` and `1.3` as discovered
- **WHEN** the lane is dispatched
- **THEN** the agent is instructed to implement `1.1`, then `1.3`, then `1.4`

#### Scenario: Failure — hardest-first does not reorder inside a lane

- **GIVEN** a lane holds tier-2 task `1.1` and tier-4 task `1.2`
- **WHEN** the lane is dispatched
- **THEN** `1.1` is still executed before `1.2`
- **AND** the tier-4 task is not promoted ahead of the tier-2 task it depends on

#### Scenario: Edge case — a chain runs in batch order, not id order

- **GIVEN** a wave planned as a batch holding one cohesion lane of `1.1` and `1.3`, followed by a batch holding the single lane `1.2`, where `1.2` depends on `1.3`
- **WHEN** the two batches are fused and the chain lane is dispatched
- **THEN** the agent is instructed to implement `1.1`, then `1.3`, then `1.2`

#### Scenario: Edge case — a mixed-tier lane runs at the maximum tier

- **GIVEN** a lane holds a tier-1 task and a tier-5 task
- **WHEN** the lane is dispatched
- **THEN** the lane is briefed and run at tier 5's effort, not tier 1's, and dispatches on opus
- **AND** the tier used for the lane is recorded in the plan

#### Scenario: Edge case — a solo lane dispatches on opus whatever its tiers

- **GIVEN** a solo lane holding only tier-2 tasks
- **WHEN** the lane is dispatched
- **THEN** it runs on opus, with every promotion recorded in the plan
- **AND** the lane's recorded tier is still 2, so its effort is the published tier-2 effort

### Requirement: A lane SHALL report an outcome for every task it was given

A lane result MUST carry a per-task outcome of `ok`, `failed`, or `not-attempted`.

- **Not-attempted tasks.** Tasks positioned after a failed task in the same lane MUST be reported as `not-attempted`, which is distinct from `failed`. A `not-attempted` task MUST NOT be marked complete and MUST NOT be counted toward the accumulated task-failure budget that halts a run.
- **Handoff packets.** Every attempted task MUST carry its own handoff packet. `not-attempted` tasks MUST carry none, and their absence MUST NOT be treated as an invalid result.
- **Omitted outcomes.** A lane result that omits outcomes for tasks it was given MUST fail every task in that lane closed rather than being interpreted.
- **No result at all.** A multi-task lane whose agent returns no result — because it crashed, timed out, or never acknowledged its briefing — MUST record its first task as failed with that reason and every later task as `not-attempted`. One lost agent therefore costs the failure budget one failure, and none of its tasks is marked complete.

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

#### Scenario: Edge case — a lane whose agent returns nothing costs one failure

- **GIVEN** a chain lane of four tasks whose agent returns no result at all
- **WHEN** the lane result is recorded
- **THEN** the first task is recorded as failed with a no-result reason, and the other three are recorded as `not-attempted`
- **AND** the accumulated failure count increases by one
- **AND** no task in the lane is marked complete

### Requirement: Serial single-lane batches SHALL fuse into one chain lane

After implementation waves are formed and singleton waves are folded, and within the trailing test wave, the planner MUST fuse every maximal run of two or more consecutive batches of one wave that each hold exactly one lane into **chain** lanes.

- **Order.** A chain lane MUST hold the fused lanes' tasks in the order the batches would have run them: batch order, then each fused lane's own order. It MUST NOT be re-sorted by task id.
- **Packing.** Fusion MUST pack next-fit. A lane is appended to the open chain while the chain's length stays within the lane cap for the hardest tier across the chain and the appended lane. That cap is read off the effective cap table, so a uniform override bounds chains too, and an override of 1 fuses nothing. When the cap would be exceeded, the open chain closes and the lane opens the next one.
- **Parallel batches.** A batch that holds two or more lanes MUST NOT be fused, and MUST close any open chain. Lanes planned to run concurrently are therefore never serialized.
- **Wave boundaries.** Fusion MUST NOT cross a wave boundary. It never joins lanes of two waves, including the red wave and the wave after it, or an implementation wave and the test wave.
- **Solo and replan.** A solo plan MUST NOT be affected. A replanned group MUST be fused by the same rule, under the lane caps the run was planned with.

Rationale: a batch holding one lane buys no parallelism. Its boundary expresses ordering, and a position inside one agent's lane expresses the same ordering. Each separate agent pays its own spawn prefix and starts without the previous batch's context, because handoffs cross waves, not batches.

#### Scenario: Happy path — a serial staircase inside one wave becomes one agent

- **GIVEN** wave 1 plans as four consecutive single-lane batches holding `1.1`, `1.2`, `1.3` and `2.1` (dependency layers plus a folded singleton), of tiers 2, 4, 2 and 3, and the tier-4 lane cap is 4
- **WHEN** the planner builds the plan
- **THEN** wave 1 holds one batch with one chain lane that runs `1.1`, `1.2`, `1.3`, `2.1` in that order
- **AND** the plan reports that chain lane with its four ids

#### Scenario: Failure — a batch of parallel lanes is never fused

- **GIVEN** a wave whose batch 0 holds two path-disjoint single-task lanes `1.1` and `1.2`, and whose batch 1 holds the single-task lane `1.3`
- **WHEN** the planner builds the plan
- **THEN** batch 0 still holds two lanes that run concurrently, and `1.3` is still in a later batch
- **AND** no chain lane is reported for that wave

#### Scenario: Edge case — the cap closes a chain and opens the next

- **GIVEN** a wave of consecutive single-lane batches: a tier-3 cohesion lane of `4.2`, `4.3` and `4.4`, then `5.1` at tier 3, `5.2` at tier 2 and `6.1` at tier 4, with a tier-3 cap of 6 and a tier-4 cap of 4
- **WHEN** the planner fuses the wave
- **THEN** the first chain lane runs `4.2`, `4.3`, `4.4`, `5.1`, `5.2`, and `6.1` is a lane of its own in the next batch
- **AND** no lane in the wave exceeds the cap for its own hardest tier

#### Scenario: Edge case — an override of 1 fuses nothing

- **GIVEN** the planner is given a uniform lane-cap override of 1
- **WHEN** it plans a wave of three consecutive single-lane batches
- **THEN** the wave still holds three batches of one single-task lane each
- **AND** no chain lane is reported

#### Scenario: Edge case — fusion stops at a wave boundary

- **GIVEN** implementation wave 1 ends with a single-lane batch and implementation wave 2 begins with a single-lane batch
- **WHEN** the planner builds the plan
- **THEN** no lane holds tasks from both waves
- **AND** the checkpoint between the two waves is unchanged

#### Scenario: Edge case — dependent test tasks fuse inside the test wave

- **GIVEN** test tasks `2.1` and `2.2`, path-disjoint, with `2.2` depending on `2.1`
- **WHEN** the planner builds the trailing test wave
- **THEN** the test wave holds one chain lane that runs `2.1` then `2.2`
- **AND** no implementation task is in that lane

#### Scenario: Edge case — a replanned group fuses the same way

- **GIVEN** a run whose remaining group is replanned into path-disjoint tasks `2.1` and `2.2`, with `2.2` depending on `2.1`
- **WHEN** the revision is laned
- **THEN** `2.1` and `2.2` occupy one chain lane in that order
- **AND** the chain is bounded by the lane caps the run was planned with

### Requirement: A lane's model SHALL follow its shape

- **Multi-task lanes.** A lane of two or more tasks — collision, cohesion or chain — MUST dispatch on opus.
- **Single-task lanes.** A lane of one task MUST dispatch on that task's model as clamped by the planner: haiku or sonnet. It dispatches on opus only when the task is a tier-5 task the classifier assigned opus, or a task a solo plan promoted.
- **One derivation everywhere.** The rule MUST be derived from the lane's tasks alone at every point that reads it: the dispatched spawn, the plan's lane report, the preview, and the trajectory's `agent-spawn` record. These MUST agree, including for a reused, narrowed or replanned plan.
- **No task rewriting.** The rule MUST NOT rewrite any task's recorded model.
- **Clamp first.** Every task that enters a lane, including a replanned task, MUST have been clamped first.
- **Not disclosed.** The classifier prompt MUST NOT describe this rule.

Rationale: a lane holding several tasks is the work agent the planner chose not to split. A lane holding one task exists because it runs beside others, which is what a cheaper per-task model is for. The per-task clamp still stops the classifier from escalating its own model.

#### Scenario: Happy path — a multi-task lane runs on opus

- **GIVEN** a chain lane of a tier-2 task and a tier-4 task, each clamped to sonnet
- **WHEN** the lane is dispatched
- **THEN** the spawn requests opus
- **AND** each task's recorded model is still sonnet
- **AND** the trajectory's `agent-spawn` record for that lane names opus

#### Scenario: Failure — a single-task lane is not promoted

- **GIVEN** a batch holding two path-disjoint single-task tier-4 lanes, each clamped to sonnet
- **WHEN** the batch is dispatched
- **THEN** both spawns request sonnet and run concurrently

#### Scenario: Edge case — haiku and tier-5 single-task lanes keep their model

- **GIVEN** a single-task lane of a tier-1 task classified haiku, and a single-task lane of a tier-5 task classified opus
- **WHEN** each is dispatched
- **THEN** the first requests haiku and the second requests opus

#### Scenario: Edge case — a replanned task is clamped before it is laned

- **GIVEN** a replan revision holding one tier-3 task that carries model opus
- **WHEN** the revision is laned and dispatched
- **THEN** the task's model is clamped to sonnet, and its single-task lane requests sonnet

#### Scenario: Edge case — narrowing a lane to one task returns it to the task's model

- **GIVEN** a reused plan whose two-task lane has its first task already ticked
- **WHEN** the plan is narrowed and the remaining lane is dispatched
- **THEN** the remaining single-task lane requests that task's clamped model, not opus
