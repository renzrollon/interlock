## Purpose

Ensures a ship run reaches a commit only when the verification it depends on was judged green, and that every degradation the run accepted on the way is named in its summary. A run that commits on an unread verdict, or that reports no degradation while having skipped a checkpoint, is indistinguishable from a clean run — which is the failure mode the summary block exists to remove.

## ADDED Requirements

### Requirement: The run SHALL branch on the verification verdict, not only on a self-reported halt

Before committing, the run SHALL read the verification result's success and unit-suite fields and refuse to commit when either indicates failure. The run SHALL NOT depend on the verifying agent additionally volunteering a halt signal in order to stop.

#### Scenario: Happy path — a green verification proceeds to commit

- **GIVEN** a verification result reporting success and a green unit suite
- **WHEN** the run evaluates the completion gate
- **THEN** the run proceeds to the commit step

#### Scenario: Failure — a red unit suite stops the run even without a halt flag

- **GIVEN** a verification result reporting failure and a red unit suite, and no halt flag set
- **WHEN** the run evaluates the completion gate
- **THEN** the run halts and names the verification verdict as the reason
- **AND** no commit is created

#### Scenario: Edge case — the verification result omits a verdict field

- **GIVEN** a verification result in which the success field or the unit-suite field is absent rather than false
- **WHEN** the run evaluates the completion gate
- **THEN** the absent field is treated as "not verified" and the run halts
- **AND** an absent verdict SHALL NOT be read as a passing verdict

### Requirement: Task-completion recording SHALL surface its own failure

Marking a completed task as done SHALL report failure through a non-zero exit status, and the run SHALL branch on that status. A task that finished successfully SHALL NOT be able to remain unmarked without the run saying so.

#### Scenario: Happy path — succeeded task ids are marked and confirmed

- **GIVEN** a batch in which three tasks succeeded
- **WHEN** their ids are recorded as complete
- **THEN** the recording exits zero and reports the three ids it marked

#### Scenario: Failure — an unmarkable id halts or is reported

- **GIVEN** a succeeded task id that cannot be marked complete, because no matching checkbox exists
- **WHEN** the recording runs
- **THEN** it exits non-zero and names the id it could not mark
- **AND** the run surfaces that failure rather than discarding the result

#### Scenario: Edge case — an empty id set

- **GIVEN** a batch in which no task succeeded
- **WHEN** the recording step is reached
- **THEN** nothing is marked, the step exits zero, and the run continues
- **AND** an empty set is distinguished in the summary from a failed marking

### Requirement: The summary SHALL name every degradation the run accepted

The summary's degradation block SHALL report cap-exhausted verifications, verification steps skipped for any reason, unresolved errors carried past a wave, and the closing step's own reported outcome. The block SHALL state that no degradation occurred only when none of those conditions arose.

#### Scenario: Happy path — a clean run says so truthfully

- **GIVEN** a run in which no verification was skipped, no cap was exhausted, and no error went unresolved
- **WHEN** the summary is printed
- **THEN** the degradation block reports that there were none
- **AND** that statement is derived from the recorded conditions, not from an empty banner list

#### Scenario: Failure — a cap-exhausted verification is named

- **GIVEN** a run that reached the inter-wave verification cap and therefore skipped a later checkpoint
- **WHEN** the summary is printed
- **THEN** the degradation block names the exhausted cap and the checkpoint that was skipped
- **AND** the summary SHALL NOT report that there were no degradations

#### Scenario: Edge case — a run that halts before the closing step

- **GIVEN** a run that halts partway, so the closing step never reports its own outcome
- **WHEN** the summary is printed
- **THEN** the degradation block is still printed
- **AND** the missing closing outcome is named as unknown rather than omitted or treated as clean
