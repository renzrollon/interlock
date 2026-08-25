# waves Specification

## Purpose

Stops the wave planner from encoding "these two tasks cannot run at the same time" as a new wave — a new wave is a checkpoint, and a checkpoint is an agent. Path collisions become later batches of the same wave. Verification between waves is a capped, skippable policy, not an automatic consequence of ordering.

## Requirements

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

### Requirement: A recorded batch SHALL retain the paths each task changed

Recording a batch result SHALL store, per task, the set of paths that task reported changing, alongside the task's handoff packet. This set is currently requested from every implementer and discarded; it MUST be retained, because it is the cross-check against the packet's own evidence and it cannot be recovered later once the working tree moves on.

The retained set MUST be treated as a report, distinct from an observed path set, and MUST NOT be presented as evidence that those paths changed.

#### Scenario: Happy path — reported paths survive the recording

- **GIVEN** a task result reporting `filesChanged: ["lib/export.mjs", "test/export.test.mjs"]` with a valid packet
- **WHEN** the batch result is recorded
- **THEN** the stored state carries both paths for that task alongside its packet

#### Scenario: Failure — a task reporting no paths is recorded without inventing any

- **GIVEN** a task result with a valid `ok` packet and no reported changed paths
- **WHEN** the batch result is recorded
- **THEN** the stored entry carries an empty reported-path set for that task
- **AND** the recording does not substitute the packet's evidence locators for the missing report

#### Scenario: Edge case — a task not attempted retains no path set

- **GIVEN** a lane of three tasks in which the second fails and the third is never attempted
- **WHEN** the batch result is recorded
- **THEN** the third task has no reported-path entry, and that absence is not itself an error

### Requirement: Retaining paths and verdicts SHALL NOT add a way for a run to stop

Storing reported paths and evidence-audit verdicts on the run state SHALL leave every existing halt condition, failure budget, verification cap, and replan rule unchanged. No new field introduced for auditing may be read by a halt decision.

#### Scenario: Happy path — halt conditions are unchanged by the new fields

- **GIVEN** a run whose accumulated task failures are one below the failure-budget halt
- **WHEN** a batch records successfully with unconfirmed audit verdicts on every packet
- **THEN** the run does not halt and the failure count is unchanged

#### Scenario: Failure — an oversized or invalid packet still fails closed as before

- **GIVEN** a task returning a packet whose counted characters exceed the published handoff cap
- **WHEN** the batch result is recorded
- **THEN** the task is recorded as failed with the over-budget reason exactly as before, and no audit verdict is stored for it

#### Scenario: Edge case — a state written before these fields existed records normally

- **GIVEN** an in-flight run state written before reported paths and audit verdicts were retained
- **WHEN** a further batch result is recorded against it
- **THEN** the missing containers are initialized rather than treated as a malformed state, and the run continues
### Requirement: A recorded batch SHALL report its per-task outcomes to its caller

Recording a batch result SHALL report, to the caller that recorded it, the outcome the state machine assigned to each task in that batch: the task id, whether it was recorded as succeeded, failed, or not attempted, and the reason when it was not succeeded. The report SHALL describe only the batch just recorded, not the run's accumulated history.

This exists because the recorded verdict and the reported claim can differ, and today only the claim reaches the caller. A batch result may be adjudicated on arrival — an invalid or over-budget handoff packet fails its task, a lane result that omits an outcome fails every task in the lane — and a caller that receives only the next action has no way to learn that a task it was told succeeded was recorded as failed. Every downstream decision that asks "what did this task do" is then made against the wrong answer.

The reason SHALL be a short adjudication reason, not a transcript: it MUST be safe to place in a machine-copied payload, and MUST NOT carry handoff bodies, suite output, or diffs.

#### Scenario: Happy path — a fully succeeded batch reports each task as recorded

- **GIVEN** a batch of two tasks whose results are both valid and successful
- **WHEN** the batch result is recorded
- **THEN** the caller receives an outcome for each of the two task ids, both recorded as succeeded, alongside the next action

#### Scenario: Failure — an adjudicated task reports as failed with its reason

- **GIVEN** a batch of two tasks in which one reports success with a handoff packet whose status is outside the accepted set
- **WHEN** the batch result is recorded
- **THEN** the caller receives that task's id as recorded-failed, with the adjudication reason naming the invalid status
- **AND** the other task's id is reported as recorded-succeeded, so one bad packet does not blur the batch into a single verdict

#### Scenario: Edge case — a batch whose tasks were all not attempted reports them as such

- **GIVEN** a lane whose first task failed, leaving the two behind it reported as not attempted
- **WHEN** the batch result is recorded
- **THEN** the two tasks are reported as recorded not-attempted, distinct from recorded-failed
- **AND** the report distinguishes them from tasks absent from the batch entirely, which are not reported at all
