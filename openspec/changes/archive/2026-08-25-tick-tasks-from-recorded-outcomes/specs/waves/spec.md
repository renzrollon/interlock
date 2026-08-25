## ADDED Requirements

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
