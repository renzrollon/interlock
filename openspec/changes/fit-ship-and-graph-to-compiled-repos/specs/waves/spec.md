## MODIFIED Requirements

### Requirement: Per-task handoff is a fixed schema

Every implemented task MUST be accounted for by a handoff object with `schema`, `taskId`, `status` (`ok`, `blocked`, or `partial`), `summary`, `evidence` (array of strings), `next`, and `blocker` (string or null). `status=ok` MUST have a null `blocker`. `status=blocked` MUST have a non-empty `blocker`. `evidence` entries MUST be locators (`path` or `path:line` / `path:start-end`), not pasted file bodies. A lane result MUST carry one such packet per task it attempted, keyed by `taskId`, rather than one packet per agent result; a single packet standing in for several tasks MUST be rejected. Tasks the lane did not attempt carry no packet, and that absence MUST NOT be treated as an invalid result. This packet is distinct from the opt-in `--handoff` artifacts (`manual-test-plan.md`, `code-explanation.md`, memory).

A packet that does not meet this schema is rejected, and what a rejected packet does to its task is stated by "A rejected packet SHALL fail closed without failing a task that reported success".

#### Scenario: Successful task reports ok with no blocker

- **WHEN** a task completes and returns `ok:true` with a handoff `{ status: "ok", blocker: null, summary, evidence, next }`
- **THEN** `interlock wave-state record-batch` accepts the task as succeeded and stores the packet on the run

#### Scenario: Blocked task requires a blocker string

- **WHEN** a task returns `ok:true` with a handoff whose `status` is `"blocked"` and whose `blocker` is missing or empty
- **THEN** `record-batch` rejects the packet with an invalid-handoff reason and does not store it
- **AND** the task is recorded as done with a rejected report, not as failed

#### Scenario: Happy path — a lane returns one packet per attempted task

- **GIVEN** a lane of three tasks that all complete
- **WHEN** the lane returns its result
- **THEN** it carries three packets, one per `taskId`, and `record-batch` accepts all three tasks as succeeded

#### Scenario: Failure — one packet cannot stand in for several tasks

- **GIVEN** a lane of three attempted tasks, each reported as succeeded, whose result carries a single packet
- **WHEN** `record-batch` processes the result
- **THEN** the two tasks without their own packet are recorded as done with a rejected report naming the missing packet
- **AND** the lone packet is not applied to more than the task whose `taskId` it names

#### Scenario: Edge case — an unattempted task carries no packet

- **GIVEN** a lane of three tasks in which the second fails, so the third is never attempted
- **WHEN** `record-batch` processes the result
- **THEN** the first task's packet is stored, the second is recorded as failed, and the third's absent packet is not itself an invalid-handoff error

### Requirement: Retaining paths and verdicts SHALL NOT add a way for a run to stop

Storing reported paths and evidence-audit verdicts on the run state SHALL leave every existing halt condition, failure budget, verification cap, and replan rule unchanged. No new field introduced for auditing may be read by a halt decision.

#### Scenario: Happy path — halt conditions are unchanged by the new fields

- **GIVEN** a run whose accumulated task failures are one below the failure-budget halt
- **WHEN** a batch records successfully with unconfirmed audit verdicts on every packet
- **THEN** the run does not halt and the failure count is unchanged

#### Scenario: Failure — an oversized or invalid packet still fails closed as before

- **GIVEN** a task returning a packet whose counted characters exceed the published handoff cap
- **WHEN** the batch result is recorded
- **THEN** the packet is rejected with the over-budget reason exactly as before and is not stored
- **AND** no audit verdict is stored for that task

#### Scenario: Edge case — a state written before these fields existed records normally

- **GIVEN** an in-flight run state written before reported paths and audit verdicts were retained
- **WHEN** a further batch result is recorded against it
- **THEN** the missing containers are initialized rather than treated as a malformed state, and the run continues

### Requirement: A recorded batch SHALL report its per-task outcomes to its caller

Recording a batch result SHALL report, to the caller that recorded it, the outcome the state machine assigned to each task in that batch: the task id, whether it was recorded as succeeded, failed, or not attempted, and the reason when it was not succeeded. For a task recorded as succeeded whose report was rejected, the report SHALL also say so and SHALL carry the rejection reason. The report SHALL describe only the batch just recorded, not the run's accumulated history.

This exists because the recorded verdict and the reported claim can differ, and today only the claim reaches the caller. A batch result may be adjudicated on arrival — an invalid or over-budget handoff packet has its report rejected, a lane result that omits an outcome fails every task in the lane — and a caller that receives only the next action has no way to learn that a task it was told succeeded was recorded as failed, or that a task recorded as succeeded left no usable report. Every downstream decision that asks "what did this task do" is then made against the wrong answer.

The reason SHALL be a short adjudication reason, not a transcript: it MUST be safe to place in a machine-copied payload, and MUST NOT carry handoff bodies, suite output, or diffs.

#### Scenario: Happy path — a fully succeeded batch reports each task as recorded

- **GIVEN** a batch of two tasks whose results are both valid and successful
- **WHEN** the batch result is recorded
- **THEN** the caller receives an outcome for each of the two task ids, both recorded as succeeded, alongside the next action
- **AND** neither outcome is marked as having a rejected report

#### Scenario: Failure — an adjudicated task reports as failed with its reason

- **GIVEN** a batch of two lanes in which one lane's result omits an outcome for a task it was given
- **WHEN** the batch result is recorded
- **THEN** the caller receives every task of that lane as recorded-failed, with the adjudication reason naming the omitted task
- **AND** the other lane's task is reported as recorded-succeeded, so one bad lane does not blur the batch into a single verdict

#### Scenario: Edge case — a rejected report travels with a succeeded outcome

- **GIVEN** a batch of two tasks in which one reports success with a handoff packet whose status is outside the accepted set
- **WHEN** the batch result is recorded
- **THEN** the caller receives that task's id as recorded-succeeded and marked as having a rejected report, with the reason naming the invalid status
- **AND** the other task's id is reported as recorded-succeeded with no such mark

#### Scenario: Edge case — a batch whose tasks were all not attempted reports them as such

- **GIVEN** a lane whose first task failed, leaving the two behind it reported as not attempted
- **WHEN** the batch result is recorded
- **THEN** the two tasks are reported as recorded not-attempted, distinct from recorded-failed
- **AND** the report distinguishes them from tasks absent from the batch entirely, which are not reported at all

## REMOVED Requirements

### Requirement: Invalid or oversized packets fail closed

**Reason**: It bound two things together that this change separates. It required a missing, malformed or over-budget packet to fail its task (`ok:false`), so a task whose work was finished and whose report was malformed was recorded as a failed task and counted toward the task-failure halt. Run `wf_ac5c7e4e-c74` halted two waves short of its commit on four such packets, with 14 finished tasks left unticked. The packet half of the rule is kept and the task half is retired.

**Migration**: Replaced by "A rejected packet SHALL fail closed without failing a task that reported success", which keeps every guarantee about the packet (never stored, never truncated, never passed through as prose, cap read from `interlock limits`) and records the task as done with a rejected report. Whether such a task counts toward the halt is stated by "A rejected report SHALL NOT count toward the task-failure halt". A run state in which an earlier version recorded such a task as failed is read as it was recorded.

## ADDED Requirements

### Requirement: A rejected packet SHALL fail closed without failing a task that reported success

The total character count of `summary`, `next`, `blocker`, and joined `evidence` MUST NOT exceed the `maxHandoffChars` cap published by `interlock limits`. A missing handoff, an unknown `status`, a wrong field type, an entry that is not a locator, or over-budget text MUST reject the packet. A rejected packet MUST NOT be stored, MUST NOT be truncated to fit, and MUST NOT be passed through as prose for the next wave to interpret. The cap MUST live in the limits CLI, not in workflow prompt text.

What a rejected packet does to its task depends on what the task reported about itself. A task that reported success MUST be recorded as done with a rejected report carrying the validation reason; it MUST NOT be recorded as failed. A task that reported failure MUST be recorded as failed with its own reason, and a rejected or absent packet MUST NOT replace that reason.

It is the packet that fails closed, not the task. A packet's shape was never evidence that the work was done: a well-formed packet is recorded on the same claim a rejected one arrives with, and the evidence audit is recorded without gating anything. Failing the task for the shape of its report threw away finished work and told the reader it had not been done.

#### Scenario: Happy path — an over-budget packet is rejected and its task stays done

- **GIVEN** a task that reports success with a valid-shaped handoff whose counted characters exceed `maxHandoffChars`
- **WHEN** `record-batch` records the result
- **THEN** the packet is rejected with an over-budget reason and is not stored as a wave handoff
- **AND** the task is recorded as done with a rejected report carrying that reason

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-task handoff character cap as an integer

#### Scenario: Failure — a task that reported failure keeps its own reason

- **GIVEN** a task that reports `ok:false` with the error `could not resolve the build` and no packet
- **WHEN** `record-batch` records the result
- **THEN** the task is recorded as failed with `could not resolve the build`
- **AND** no rejected report is recorded for it

#### Scenario: Edge case — the cap is a boundary, not a neighbourhood

- **GIVEN** two tasks that report success, one whose counted characters equal `maxHandoffChars` exactly and one whose counted characters exceed it by one
- **WHEN** `record-batch` records the result
- **THEN** the first packet is stored whole and the second is rejected
- **AND** neither packet is shortened

### Requirement: A rejected report SHALL NOT count toward the task-failure halt

Rejected reports SHALL be kept on the run state in a record of their own, apart from task failures, each naming its task, its wave and the rejection reason. The task-failure halt SHALL count only tasks recorded as failed, and SHALL NOT read the record of rejected reports. A run SHALL NOT halt because of rejected reports, however many accumulate.

A run state that carries no such record SHALL have it initialized when the next batch is recorded, and SHALL NOT be treated as malformed. A task that an earlier version recorded as failed for an invalid packet SHALL remain the failure it was recorded as.

The failure cap exists because a run that has lost several tasks is not producing a coherent change. A rejected report loses a packet, not a task, and whether the work is sound is established by verification, which gates the commit either way.

#### Scenario: Happy path — three green tasks with malformed packets do not halt the run

- **GIVEN** a batch of three tasks that each report success, the first with an evidence entry `src/DeviceMetricSource.cs:31-73,89`, the second with a packet of 3562 counted characters, and the third with an empty `next`
- **WHEN** the batch result is recorded
- **THEN** the run does not halt and all three tasks are recorded as done
- **AND** three rejected reports are recorded, one per task, each with its own reason
- **AND** the run's count of task failures is zero

#### Scenario: Failure — real failures still halt, and rejected reports do not move the count

- **GIVEN** a run holding as many recorded task failures as the published cap tolerates, and four rejected reports
- **WHEN** one more task reports failure and its batch is recorded
- **THEN** the run halts on the task-failure cap
- **AND** the halt reason counts the failed tasks alone, not the rejected reports

#### Scenario: Edge case — a state from an earlier version is read as it was recorded

- **GIVEN** an in-flight run state written before rejected reports were recorded, whose failures include two tasks failed for invalid packets
- **WHEN** a further batch result is recorded against it
- **THEN** the record of rejected reports is initialized rather than the state being treated as malformed
- **AND** the two earlier failures remain failures and remain counted toward the halt

### Requirement: The next wave SHALL be told which previous-wave tasks filed no usable report

When the state machine asks for the next `run-batch` or `test-wave` after a prior wave, the step payload MUST name each task of the **immediately previous wave** whose report was rejected: its task id, the rejection reason, and the paths that task reported changing. Each implementer prompt for that batch MUST state those tasks as having filed no validated report, in a block separate from the validated packets, and MUST NOT carry any text of a rejected packet. When the previous wave holds no rejected report, the step and every prompt assembled from it MUST be what they would have been before this requirement existed.

A task whose report was rejected is otherwise absent from what the next wave is handed, and a silent absence reads as a task that had nothing to say.

#### Scenario: Happy path — the next wave is told a task left no report

- **GIVEN** wave 1 in which task `1.2` reported success, reported changing `src/a.cs`, and had its packet rejected as over budget
- **WHEN** `wave-state next` asks to run wave 2
- **THEN** the step names `1.2`, its rejection reason and `src/a.cs`
- **AND** each wave 2 implementer prompt names `1.2` as having filed no validated report, apart from the validated packets of wave 1

#### Scenario: Failure — nothing of a rejected packet reaches the next wave

- **GIVEN** wave 1 in which task `1.2`'s rejected packet carried a `summary` of a known distinctive sentence
- **WHEN** wave 2's step and implementer prompts are assembled
- **THEN** that sentence appears in neither the step nor any prompt

#### Scenario: Edge case — no rejection leaves the prompt as it was, and only the previous wave is named

- **GIVEN** a run in which wave 1 held one rejected report and wave 2 held none
- **WHEN** wave 3's step and implementer prompts are assembled
- **THEN** the step names no rejected report, because wave 1's is not carried forward
- **AND** each wave 3 prompt is byte-identical to the prompt assembled for the same lane with no rejected report anywhere in the run
