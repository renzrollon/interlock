# waves Specification

## Purpose

Stops the wave planner from encoding "these two tasks cannot run at the same time" as a new wave — a new wave is a checkpoint, and a checkpoint is an agent. Path collisions become later batches of the same wave. Verification between waves is a capped, skippable policy, not an automatic consequence of ordering.

## Requirements

### Requirement: Path collisions become later batches, not new groups

When two implementation tasks in the same classified group claim a common path, the planner MUST keep both tasks in that group and MUST place them in different batches of that wave so they do not run concurrently. The later task id yields its slot in the earlier batch. The planner MUST NOT create an overflow group solely because of a path collision. Tasks with disjoint paths in the same group MAY share a batch, subject to `maxParallel`. Tasks that omit `paths` MUST stay in their classified group and MUST NOT be treated as colliding.

#### Scenario: Two tasks on one file stay in one wave

- **WHEN** group 1 contains task `1.1` claiming `src/auth.ts` and task `1.2` claiming `src/auth.ts`
- **THEN** `interlock waves` emits one wave for group 1 with at least two batches, `1.1` in an earlier batch than `1.2`, and does not add a new group number for `1.2`

#### Scenario: Three tasks on one file are three batches of one wave

- **WHEN** group 1 contains three tasks that all claim `src/auth.ts`
- **THEN** the plan has `waveCount` 1 and three batches, each holding one of those tasks

#### Scenario: Disjoint paths still share a batch

- **WHEN** group 1 contains `1.1` claiming `src/a.ts` and `1.2` claiming `src/b.ts`
- **THEN** both tasks are in the same batch of wave 1 when `maxParallel` allows it

### Requirement: A shared file is not a reason for a new classified group

The ship classifier prompt MUST tell the model to default `group` to the numbered `tasks.md` section, to put predicted edit paths in `paths`, and to add a new group only when a later task needs an earlier task's output to already exist. Sharing a file MUST be described as the planner's problem, not a reason to increment `group`.

#### Scenario: Classifier prompt forbids collision-as-group

- **WHEN** an operator inspects the `plan-waves` prompt in `workflows/ship.js`
- **THEN** that prompt states that a shared file is not a reason for a new group and that groups default to numbered `tasks.md` sections

### Requirement: Inter-wave verification is capped and skippable

Finishing a wave MUST NOT unconditionally enter the verify phase. The run MUST skip the checkpoint when every claimed path in the completed wave is documentation (`*.md`/`*.mdx`/`*.txt`/`*.rst`/`*.adoc`, or under `doc/`/`docs/`/`openspec/`/`.claude/`), or when the run has already consumed `LIMITS.interWaveVerifications` checkpoints. A skipped checkpoint MUST be recorded with a non-empty reason and MUST advance to the next wave. A wave whose tasks omit `paths`, or that claims any non-docs path, MUST still be eligible for a checkpoint if the cap has not been spent. Verification MUST still never run after the final wave.

#### Scenario: Docs-only wave skips verify

- **WHEN** wave 1's tasks only claim `docs/foo.md` and `README.md`, and wave 2 follows
- **THEN** `record-batch` of wave 1's last batch advances to wave 2's first batch without a `verify` step, and the skip reason is recorded

#### Scenario: Cap stops further checkpoints

- **WHEN** a run has already completed `LIMITS.interWaveVerifications` inter-wave checks and another impl wave finishes with a following wave
- **THEN** the next step is the following wave's batch, not `verify`, and the skip is recorded

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-run inter-wave verification cap as a positive integer

### Requirement: Plan preview names the agent bill

`formatPlan` MUST print a projected agent count for the wave loop (implementers + record pings + inter-wave verifies) and MUST warn when `waveCount > implCount * 0.5` for a plan with at least two implementation tasks — that shape is effectively serial.

#### Scenario: Serial plan warns

- **WHEN** 10 implementation tasks are classified into 8 waves
- **THEN** `formatPlan` includes a warning that the plan is effectively serial and prints a projected agent count larger than the task count

### Requirement: Next step includes remaining batches of the current wave

A `run-batch` or `test-wave` step MUST include `remainingBatches`: the task arrays from the current `batchIndex` through the end of that wave, in order. `tasks` remains the current batch (the first remaining batch). Callers MAY run those batches sequentially and record them in one ping; they MUST still record through `wave-state record-batch` so halt policy stays in the CLI.

#### Scenario: Mid-wave step lists the rest of the wave

- **WHEN** a wave has three batches and the cursor is on batch 0
- **THEN** `wave-state next` includes `remainingBatches` of length 3 and `tasks` equal to `remainingBatches[0]`

#### Scenario: Wave-entry next logs every remaining implementer once

- **WHEN** a wave has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** the ship-run trajectory contains one `agent-spawn` per task across `remainingBatches`, and a subsequent `record-batch --write-state` of batch 0 does not append duplicate spawns for later batches

#### Scenario: Creating a run does not merge collision batches

- **WHEN** `planWaves` emitted three batches for one file and `wave-state create` starts a run from that plan
- **THEN** the run still has three batches for that wave, even when `maxParallel` is larger than 1

### Requirement: Per-task handoff is a fixed schema

Every implementer result MUST include a handoff object with `schema`, `taskId`, `status` (`ok`, `blocked`, or `partial`), `summary`, `evidence` (array of strings), `next`, and `blocker` (string or null). `status=ok` MUST have a null `blocker`. `status=blocked` MUST have a non-empty `blocker`. `evidence` entries MUST be locators (`path` or `path:line` / `path:start-end`), not pasted file bodies. This packet is distinct from the opt-in `--handoff` artifacts (`manual-test-plan.md`, `code-explanation.md`, memory).

#### Scenario: Successful task reports ok with no blocker

- **WHEN** a task completes and returns `ok:true` with a handoff `{ status: "ok", blocker: null, summary, evidence, next }`
- **THEN** `interlock wave-state record-batch` accepts the task as succeeded and stores the packet on the run

#### Scenario: Blocked task requires a blocker string

- **WHEN** a task returns `status: "blocked"` with `blocker` missing or empty
- **THEN** `record-batch` treats that task as failed with an invalid-handoff reason, even if `ok` was true

### Requirement: Invalid or oversized packets fail closed

The total character count of `summary`, `next`, `blocker`, and joined `evidence` MUST NOT exceed the `maxHandoffChars` cap published by `interlock limits`. Missing handoff, unknown `status`, extra required-field types, or over-budget text MUST fail that task (`ok:false`) rather than passing prose through for the next wave to interpret. The cap MUST live in the limits CLI, not in workflow prompt text.

#### Scenario: Over-budget summary fails the task

- **WHEN** a task returns a valid-shaped handoff whose counted characters exceed `maxHandoffChars`
- **THEN** `record-batch` records the task as failed with an over-budget reason and does not store the packet as a wave handoff

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-task handoff character cap as an integer

### Requirement: Next wave is handed validated packets, not git inference

When the state machine asks for the next `run-batch` or `test-wave` after a prior implementation wave, the step payload MUST include the stored handoff packets from the **immediately previous wave only**. Each implementer prompt for that batch MUST include those packets as structured text and MUST NOT instruct the agent to reconstruct the previous wave from `git log` / `git status` as a substitute for the packet. Fresh-agent isolation is unchanged: one agent per task, no orchestrator-context implementation.

#### Scenario: Wave 2 sees wave 1 packets

- **WHEN** wave 1's tasks recorded valid handoffs and `wave-state next` asks to run wave 2
- **THEN** the step includes those handoff objects, and each wave 2 implementer prompt contains their `status`, `summary`, `evidence`, `next`, and `blocker` fields

#### Scenario: Wave 3 does not accumulate wave 1

- **WHEN** wave 3 starts after wave 2 completed
- **THEN** the injected packets are wave 2's only — wave 1's packets are not appended

#### Scenario: Remaining batches of a wave share the previous wave, not each other

- **WHEN** wave 2 has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** `previousHandoffs` is wave 1's packets on that step, every remaining batch's implementer prompt receives those same packets, and batch 1 does not receive batch 0's handoff