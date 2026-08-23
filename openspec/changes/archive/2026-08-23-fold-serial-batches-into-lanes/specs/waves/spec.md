## MODIFIED Requirements

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop (implementers + record pings + inter-wave verifies) and MUST warn when `waveCount > implCount * 0.5` for a plan with at least two implementation tasks — that shape is effectively serial. The implementer count MUST be the number of lanes the plan dispatches, not the number of tasks it contains, because one lane is one agent regardless of how many tasks it carries. Every lane holding more than one task MUST be reported in the plan preview, alongside the existing collision reporting, so that a fold is visible rather than inferred from a smaller agent count.

#### Scenario: Serial plan warns

- **WHEN** 10 implementation tasks are classified into 8 waves with no lane folding possible
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the lane count

#### Scenario: Happy path — the bill counts lanes, not tasks

- **GIVEN** a plan whose single wave holds one lane of 4 tasks and two lanes of 1 task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count is 3
- **AND** the preview names the 4-task lane as a fold

#### Scenario: Edge case — a plan in which every lane holds one task

- **GIVEN** a plan with no path collisions at all, so every lane holds exactly one task
- **WHEN** `formatPlan` renders the plan
- **THEN** the projected implementer count equals the task count
- **AND** no fold is reported, rather than a fold of size one being listed

### Requirement: Next step includes remaining batches of the current wave

A `run-batch` or `test-wave` step MUST include `remainingBatches`: the lane arrays from the current `batchIndex` through the end of that wave, in order. `tasks` remains the current batch (the first remaining batch). Each entry of a batch is a lane — an ordered list of tasks executed by one agent — so a caller fans out one agent per lane, not one per task. Callers MAY run those batches sequentially and record them in one ping; they MUST still record through `wave-state record-batch` so halt policy stays in the CLI.

#### Scenario: Mid-wave step lists the rest of the wave

- **WHEN** a wave has three batches and the cursor is on batch 0
- **THEN** `wave-state next` includes `remainingBatches` of length 3 and `tasks` equal to `remainingBatches[0]`, and each entry of each batch is a lane rather than a bare task

#### Scenario: Wave-entry next logs every remaining implementer once

- **WHEN** a wave has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** the ship-run trajectory contains one `agent-spawn` per lane across `remainingBatches`, and a subsequent `record-batch --write-state` of batch 0 does not append duplicate spawns for later batches

#### Scenario: Creating a run does not merge collision batches

- **WHEN** `planWaves` emitted three batches for one wave and `wave-state create` starts a run from that plan
- **THEN** the run still has three batches for that wave, even when `maxParallel` is larger than the number of lanes, and no lane is moved into an earlier batch than the planner assigned it

#### Scenario: Failure — spawns are counted per lane, not per task

- **GIVEN** a wave whose batches hold one lane of 3 tasks and one lane of 1 task
- **WHEN** the trajectory for that wave is read
- **THEN** it contains two `agent-spawn` records, not four

### Requirement: Per-task handoff is a fixed schema

Every implemented task MUST be accounted for by a handoff object with `schema`, `taskId`, `status` (`ok`, `blocked`, or `partial`), `summary`, `evidence` (array of strings), `next`, and `blocker` (string or null). `status=ok` MUST have a null `blocker`. `status=blocked` MUST have a non-empty `blocker`. `evidence` entries MUST be locators (`path` or `path:line` / `path:start-end`), not pasted file bodies. A lane result MUST carry one such packet per task it attempted, keyed by `taskId`, rather than one packet per agent result; a single packet standing in for several tasks MUST be rejected. Tasks the lane did not attempt carry no packet, and that absence MUST NOT be treated as an invalid result. This packet is distinct from the opt-in `--handoff` artifacts (`manual-test-plan.md`, `code-explanation.md`, memory).

#### Scenario: Successful task reports ok with no blocker

- **WHEN** a task completes and returns `ok:true` with a handoff `{ status: "ok", blocker: null, summary, evidence, next }`
- **THEN** `interlock wave-state record-batch` accepts the task as succeeded and stores the packet on the run

#### Scenario: Blocked task requires a blocker string

- **WHEN** a task returns `status: "blocked"` with `blocker` missing or empty
- **THEN** `record-batch` treats that task as failed with an invalid-handoff reason, even if `ok` was true

#### Scenario: Happy path — a lane returns one packet per attempted task

- **GIVEN** a lane of three tasks that all complete
- **WHEN** the lane returns its result
- **THEN** it carries three packets, one per `taskId`, and `record-batch` accepts all three tasks as succeeded

#### Scenario: Failure — one packet cannot stand in for several tasks

- **GIVEN** a lane of three attempted tasks whose result carries a single packet
- **WHEN** `record-batch` processes the result
- **THEN** the tasks without their own packet are treated as failed with an invalid-handoff reason
- **AND** the lone packet is not applied to more than the task whose `taskId` it names

#### Scenario: Edge case — an unattempted task carries no packet

- **GIVEN** a lane of three tasks in which the second fails, so the third is never attempted
- **WHEN** `record-batch` processes the result
- **THEN** the first task's packet is stored, the second is recorded as failed, and the third's absent packet is not itself an invalid-handoff error

## REMOVED Requirements

### Requirement: Path collisions become later batches, not new groups

**Reason**: Superseded by the `lanes` capability. The rule that a path collision must not create a new classified group is preserved there, but the consequence changes: colliding tasks now join one lane executed sequentially by a single agent, rather than being spread across single-task batches that each pay their own agent spawn. Keeping a requirement here that specifies "different batches of that wave" would contradict the lane requirements.

**Migration**: The guarantees this requirement provided are carried by `lanes` — "A lane SHALL contain only tasks joined by a canonical-path collision" preserves the no-new-group rule and the canonical comparison, and "Lanes scheduled together SHALL be path-disjoint" preserves the guarantee that two tasks claiming one file never run concurrently. The requirement that a shared file is not a reason for a new classified group remains in this capability, unchanged.
