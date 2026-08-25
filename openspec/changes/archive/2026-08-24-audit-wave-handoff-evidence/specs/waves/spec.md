## ADDED Requirements

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
