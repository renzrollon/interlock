## ADDED Requirements

### Requirement: The preflight reports the harness enablement when an eval suite is present

When an eval suite exists at the plugin root, the preflight SHALL report one row for the harness's early-access enablement. When no eval suite exists, the row SHALL NOT appear, because a repository with no suite has no such prerequisite to report. The preflight SHALL report no row about a model credential and SHALL read no credential variable.

#### Scenario: Happy path — a plugin root with an eval suite reports the enablement row

- **WHEN** the preflight runs against a plugin root holding an eval suite
- **THEN** its output carries a row for the early-access enablement

#### Scenario: A plugin root with no eval suite reports no row

- **WHEN** the preflight runs against a plugin root holding no eval suite
- **THEN** no eval row appears in its output

#### Scenario: Failure — a credential in the environment produces no row and no mention

- **GIVEN** a model credential variable is set
- **WHEN** the preflight runs against a plugin root holding an eval suite
- **THEN** no row reports a credential
- **AND** neither the variable's name nor its value appears in the output or the structured output

### Requirement: An absent harness enablement is reported as skipped, never as a failure

An absent enablement SHALL be reported with the skipped status and a reason naming what is missing and how to supply it. It SHALL NOT be reported as a failure or as a warning, because the enablement stops no ship run, and a preflight that failed on it would stop unattended work over a capability the run does not use.

This SHALL hold when the check itself cannot run: a probe that throws SHALL degrade to one skipped row with the reason, on the same fail-open rule the runtime guards follow.

#### Scenario: Happy path — a present enablement is reported as satisfied

- **WHEN** the early-access enablement is present
- **THEN** its row reports satisfied

#### Scenario: Failure — an absent enablement is skipped with a reason

- **WHEN** the early-access enablement is absent
- **THEN** its row reports skipped with a reason naming the enablement and how to supply it
- **AND** it does not report a failure

#### Scenario: Edge case — a check that cannot run degrades to one skipped row

- **WHEN** the eval-prerequisite check itself cannot complete
- **THEN** one row reports skipped with the reason
- **AND** it does not report a failure

### Requirement: The harness enablement row does not change the preflight's exit status

The preflight's exit status SHALL be unchanged by the presence or absence of the enablement. A run that would have passed the preflight without the row SHALL still pass it, and a run that would have failed SHALL fail for the same reasons.

#### Scenario: Happy path — an otherwise-clean preflight with the enablement absent still passes

- **WHEN** every other check passes and the enablement is absent
- **THEN** the preflight reports success and exits zero

#### Scenario: Failure — an unrelated failing check still fails, with the enablement row present

- **WHEN** another check fails and the enablement row is present
- **THEN** the preflight fails for that other check and the enablement row is not among the reported failures

## REMOVED Requirements

### Requirement: The preflight reports eval prerequisites when an eval suite is present

**Reason**: It required a model-credential row, a credential read. One environment row also could not be right for both harnesses: `claude plugin eval` runs on the session login and needs no variable.

**Migration**: Replaced by "The preflight reports the harness enablement when an eval suite is present".

### Requirement: An absent eval prerequisite is reported as skipped, never as a failure

**Reason**: Its scenarios cover two rows; one remains.

**Migration**: Replaced by "An absent harness enablement is reported as skipped, never as a failure".

### Requirement: The eval-prerequisite rows do not change the preflight's exit status

**Reason**: Its scenarios cover two rows; one remains.

**Migration**: Replaced by "The harness enablement row does not change the preflight's exit status".

### Requirement: The preflight reads whether a credential is set, never its value

**Reason**: The preflight reads no credential at all, so a rule about how it reads one has nothing to govern.

**Migration**: The no-mention guarantee moves into "The preflight reports the harness enablement when an eval suite is present".
