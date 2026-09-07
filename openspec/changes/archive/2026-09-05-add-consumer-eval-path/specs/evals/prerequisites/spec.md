## Purpose
Makes the prerequisites for running the eval suite visible in the preflight without ever letting their absence stop a run — neither the early-access enablement nor a model credential is needed to ship a change, so a preflight that failed on them would block ordinary work to report an unrelated capability.

## ADDED Requirements

### Requirement: The preflight reports eval prerequisites when an eval suite is present

When an eval suite exists at the plugin root, the preflight SHALL report one row for the harness's early-access enablement and one row for a model credential. When no eval suite exists, neither row SHALL appear, because a repository with no suite has no such prerequisite to report.

#### Scenario: Happy path — a plugin root with an eval suite reports both rows

- **WHEN** the preflight runs against a plugin root holding an eval suite
- **THEN** its output carries a row for the early-access enablement and a row for a model credential

#### Scenario: A plugin root with no eval suite reports neither row

- **WHEN** the preflight runs against a plugin root holding no eval suite
- **THEN** neither row appears in its output

### Requirement: An absent eval prerequisite is reported as skipped, never as a failure

An absent prerequisite SHALL be reported with the skipped status and a reason naming what is missing and how to supply it. It SHALL NOT be reported as a failure or as a warning, because neither prerequisite stops a ship run, and a preflight that failed on them would stop unattended work over a capability the run does not use.

This SHALL hold when the check itself cannot run: a probe that throws SHALL degrade to skipped with the reason, on the same fail-open rule the runtime guards follow. A check that reported failure whenever it could not establish its own answer would block exactly the hosts it was least able to inspect.

#### Scenario: Happy path — a present prerequisite is reported as satisfied

- **WHEN** the early-access enablement and a model credential are both present
- **THEN** both rows report satisfied

#### Scenario: Failure — an absent prerequisite is skipped with a reason

- **WHEN** the early-access enablement is absent
- **THEN** its row reports skipped with a reason naming the enablement and how to supply it
- **AND** it does not report a failure

#### Scenario: Edge case — a check that cannot run degrades to skipped

- **WHEN** the eval-prerequisite check itself cannot complete
- **THEN** its rows report skipped with the reason
- **AND** they do not report a failure

### Requirement: The eval-prerequisite rows do not change the preflight's exit status

The preflight's exit status SHALL be unchanged by the presence or absence of the eval prerequisites. A run that would have passed the preflight before these rows existed SHALL still pass it, and a run that would have failed SHALL fail for the same reasons as before.

#### Scenario: Happy path — an otherwise-clean preflight with both prerequisites absent still passes

- **WHEN** every other check passes and both eval prerequisites are absent
- **THEN** the preflight reports success and exits zero

#### Scenario: Failure — an unrelated failing check still fails, with the eval rows present

- **WHEN** another check fails and the eval prerequisite rows are present
- **THEN** the preflight fails for that other check and the eval rows are not among the reported failures

### Requirement: The preflight reads whether a credential is set, never its value

The preflight SHALL determine only whether a model credential is available, and SHALL NOT read, print, record or otherwise surface the credential's value in its output, its structured output, or its evidence lines.

#### Scenario: A present credential is reported without its value

- **WHEN** a model credential is present
- **THEN** the row states that it is present
- **AND** no part of the output contains the credential's value
