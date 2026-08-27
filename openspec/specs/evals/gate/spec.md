# evals/gate Specification

## Purpose
Defines how the eval suite runs in continuous integration — what triggers it, what it may not do to a contributor's pull request, and the posture it holds until enough observed results exist to justify a blocking threshold.

## Requirements

### Requirement: The eval job is advisory until a baseline exists

The eval job SHALL report its result without failing the build. No score threshold SHALL be promoted to a blocking check within this change. Promotion to blocking SHALL require observed run-to-run variance from the suite itself, recorded across more than one run.

#### Scenario: Failing eval does not block a pull request

- **WHEN** the eval job records a case below the reporting threshold
- **THEN** the job surfaces the result
- **AND** the pull request remains mergeable on that job's account

#### Scenario: Promotion requires evidence

- **WHEN** promoting the gate to blocking is proposed
- **THEN** the proposal cites observed variance from prior runs rather than a chosen number

### Requirement: The eval job runs separately from the existing CI workflow

The eval job SHALL live in its own workflow definition with its own trigger filter, so that filtering it by path does not narrow the triggers of the existing unit, validation and smoke jobs.

#### Scenario: Existing jobs keep running on every change

- **WHEN** a change touches no model-facing file
- **THEN** the unit, plugin-validation and CLI-smoke jobs still run
- **AND** the eval job is skipped

#### Scenario: Model-facing change triggers evals

- **WHEN** a change touches a skill, a shared contract, an agent definition, the ship workflow, or the plugin manifest
- **THEN** the eval job is triggered

### Requirement: The trigger surface covers every file that steers a model

The trigger filter SHALL include the skill directory, the shared contract directory, the agent definition directory, the workflow directory, and the plugin manifest. It SHALL NOT include vendored copies generated for other hosts, which are untracked and cannot appear in a diff.

#### Scenario: A shared contract edit triggers the gate

- **WHEN** a file under the shared contract directory changes
- **THEN** the eval job runs, because skills read those contracts at runtime

#### Scenario: Vendored host copies do not trigger the gate

- **WHEN** an untracked, generated copy under the host-integration directory changes
- **THEN** no eval run is triggered by it

### Requirement: Pull requests from forks skip the eval job rather than failing it

Because repository secrets are unavailable to a fork-originated pull request, the eval job SHALL be skipped for those pull requests. It SHALL NOT fail, and it SHALL NOT be configured as a required check that would leave a fork pull request unmergeable.

#### Scenario: Fork pull request skips cleanly

- **WHEN** a pull request originates from a fork
- **THEN** the eval job is skipped
- **AND** the pull request is not blocked by its absence

#### Scenario: Same-repository branch runs the job

- **WHEN** a pull request originates from a branch in the repository itself
- **THEN** the eval job runs

### Requirement: The eval job does not publish reports to an external service

The eval run in CI SHALL keep its report local to the run. Report publication to an external account SHALL be explicitly disabled, because an unattended job has no one to consent to publication.

#### Scenario: CI run keeps its report local

- **WHEN** the eval job completes
- **THEN** no report is published to an external service
- **AND** the report is retained as a build artifact instead

### Requirement: Enablement is supplied by the environment, not committed to the repository

The eval harness requires an early-access enablement variable. The job SHALL supply it through the CI environment. The repository SHALL NOT carry it in project-level settings, and the requirement SHALL be documented as a local prerequisite for contributors.

#### Scenario: CI supplies enablement

- **WHEN** the eval job runs
- **THEN** the enablement variable is present in the job environment

#### Scenario: Repository settings do not carry enablement

- **WHEN** the repository's committed settings are inspected
- **THEN** they do not set the enablement variable

#### Scenario: Contributor is told the prerequisite

- **WHEN** a contributor reads the project documentation for running evals locally
- **THEN** the enablement variable is stated as a prerequisite

### Requirement: The job skips cleanly when no model credential is available

The eval job SHALL be skippable without failing when no model credential is present in its environment, so that the suite can be merged and maintained before a credential is provisioned, and so that provisioning becomes a configuration action rather than a prerequisite for landing the change.

#### Scenario: No credential provisioned

- **WHEN** the eval job runs in an environment with no model credential
- **THEN** the job is skipped and reports why
- **AND** it does not fail, and does not report a score regression

#### Scenario: Credential later provisioned

- **WHEN** a credential is added to the environment
- **THEN** the job runs on the next triggering change with no change to the workflow definition

### Requirement: A cost ceiling bounds every metered run

Any eval run that consumes metered model calls SHALL carry an explicit cost ceiling. A run that breaches the ceiling SHALL be reported as partial rather than as a pass.

#### Scenario: Breached ceiling reports partial

- **WHEN** a run reaches its cost ceiling before every case has run
- **THEN** the result is reported as partial, naming the ceiling as the reason
- **AND** the partial result is not reported as a passing suite

#### Scenario: Unattended run always carries a ceiling

- **WHEN** the eval job is configured
- **THEN** a cost ceiling is set

### Requirement: The gate distinguishes a failing suite from a suite that could not run

The job SHALL interpret an infrastructure outcome — exhausted budget, interrupted run, or rejected credential — as "no signal", distinctly from a completed run in which cases scored below threshold.

#### Scenario: Rejected credential is not reported as a regression

- **WHEN** the run aborts because its credential was rejected
- **THEN** the job reports that evals could not run
- **AND** it does not report a score regression

#### Scenario: Completed run below threshold is reported as a regression

- **WHEN** a run completes and one or more cases score below the reporting threshold
- **THEN** the job names those cases as regressions

#### Scenario: Empty suite is a configuration problem

- **WHEN** a run discovers no cases, or its tag filter matches none
- **THEN** the job reports a configuration problem
- **AND** it does not report a regression or a clean pass
