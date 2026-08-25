## MODIFIED Requirements

### Requirement: Task-completion recording SHALL surface its own failure

Marking a completed task as done SHALL report failure through a non-zero exit status, and the run SHALL branch on that status. A task that finished successfully SHALL NOT be able to remain unmarked without the run saying so.

A task SHALL be marked complete only when the run **recorded** it as succeeded. The set of ids a run marks MUST be derived from the outcomes the state machine recorded for that batch, never from the outcome the implementing agent reported for itself. Where the two disagree, the recorded outcome SHALL be the one the run acts on: the agent's claim is the input that was adjudicated, not a second opinion of equal standing.

Consequently a task the run recorded as failed, or as not attempted, MUST NOT be marked complete. Marking such a task is a more serious defect than failing to mark a succeeded one, because an unticked success is visible to the next reader and a ticked failure is not — it presents unimplemented work as finished.

#### Scenario: Happy path — succeeded task ids are marked and confirmed

- **GIVEN** a batch in which three tasks succeeded and the run recorded all three as succeeded
- **WHEN** their ids are recorded as complete
- **THEN** the recording exits zero and reports the three ids it marked

#### Scenario: Failure — an unmarkable id halts or is reported

- **GIVEN** a succeeded task id that cannot be marked complete, because no matching checkbox exists
- **WHEN** the recording runs
- **THEN** it exits non-zero and names the id it could not mark
- **AND** the run surfaces that failure rather than discarding the result

#### Scenario: Failure — a task the run recorded as failed is not marked

- **GIVEN** a task whose agent reported success but whose result the state machine recorded as failed, because its handoff packet carried a status outside the accepted set
- **WHEN** the run reaches its completion recording
- **THEN** that task's id is not among the ids marked complete
- **AND** its checkbox is left unchecked, so the task is still visible as outstanding work

#### Scenario: Edge case — an empty id set

- **GIVEN** a batch in which no task succeeded
- **WHEN** the recording step is reached
- **THEN** nothing is marked, the step exits zero, and the run continues
- **AND** an empty set is distinguished in the summary from a failed marking

#### Scenario: Edge case — a not-attempted task is neither marked nor counted failed

- **GIVEN** a lane in which the first task failed and the second was reported as not attempted
- **WHEN** the run records completion for that batch
- **THEN** the not-attempted task is not marked complete
- **AND** it is not reported as a failure either, so the run's failure budget is unchanged by it
