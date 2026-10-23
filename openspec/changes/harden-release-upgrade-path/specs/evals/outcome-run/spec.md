## RENAMED Requirements

- FROM: `### Requirement: The eval is scheduled, bounded, and never runs on a pull request`
- TO: `### Requirement: The eval is manually invoked, bounded, and never runs on a pull request`

## MODIFIED Requirements

### Requirement: The eval is manually invoked, bounded, and never runs on a pull request

The metered outcome eval is the sweep that invokes a model and grades a fixture on disk. It SHALL be triggered on explicit manual invocation. It SHALL carry no schedule while the repository provisions no model credential, because a scheduled run without one does no work and reports green. Adding a schedule SHALL be the edit that records a credential's arrival. The eval SHALL NOT be triggered by a pull request, by a push, or by any path filter, because it consumes metered model calls and its result may not influence whether a change merges.

This requirement does not forbid the model-free prepare path from running on a pull request or a push. That path is specified separately and MUST NOT be read as a metered outcome eval run.

Every metered run SHALL carry a cost ceiling obtained from the project's published limits rather than restated in the job definition or in any prose. A run that reaches its ceiling SHALL be reported as partial, naming the ceiling as the reason, and SHALL NOT be reported as a completed run.

#### Scenario: Happy path — a scheduled run carries a ceiling read from the published limits

- **WHEN** the metered eval runs, on manual invocation or on a schedule once a credential is provisioned
- **THEN** the ceiling it enforces is the one the published limits report
- **AND** the number appears in no other place

#### Scenario: Failure — no schedule without a credential

- **GIVEN** a repository with no model credential provisioned
- **WHEN** the workflow's triggers are read
- **THEN** they hold manual invocation and no schedule

#### Scenario: Failure — a pull request never triggers the eval

- **WHEN** a pull request touches any file this change adds
- **THEN** no metered outcome eval run is triggered
- **AND** a model-free prepare on that pull request is not a metered outcome eval run

#### Scenario: Edge case — a breached ceiling is partial, not a failing loop

- **WHEN** a metered run reaches its ceiling before every fixture and arm has run
- **THEN** the result is reported as partial with the ceiling named
- **AND** the fixtures that did not run are not recorded as failures
