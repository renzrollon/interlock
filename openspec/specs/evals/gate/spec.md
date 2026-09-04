# evals/gate Specification

## Purpose
Defines how the eval suite runs in continuous integration — what triggers it, what it may not do to a contributor's pull request, and the posture it holds until enough observed results exist to justify a blocking threshold.

## Requirements

### Requirement: The eval job is advisory until a baseline exists

The eval job SHALL report its result without failing the build for any case that has not been promoted. Whether the job tolerates a failing verdict SHALL be derived from the promotion decision rather than fixed by hand in the workflow definition, so that promotion is a computed change of posture and not an edit a reviewer argues for in a pull request. No case SHALL be treated as blocking until the promotion decision reports it promotable, and the values the promotion rule turns on SHALL be read from the published limits surface rather than restated in this specification, in a skill, or in the workflow definition.

#### Scenario: Failing eval does not block a pull request

- **WHEN** the eval job records a failing verdict for a case that has not been promoted
- **THEN** the job surfaces the result
- **AND** the pull request remains mergeable on that job's account

#### Scenario: Promotion requires evidence

- **WHEN** promoting a case to blocking is proposed
- **THEN** the promotion decision is consulted over the recorded history of prior runs
- **AND** the posture follows that decision rather than a number chosen in the proposal

#### Scenario: Posture is derived, not hand-edited

- **WHEN** the eval job runs
- **THEN** its tolerance of a failing verdict is computed from the promotion decision
- **AND** no threshold or blocking flag is written directly into the workflow definition

#### Scenario: No history yields the advisory posture

- **WHEN** no recorded history of prior runs is available to the job
- **THEN** the job stays advisory and states that promotion could not be evaluated
- **AND** it does not fail the build on that account

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

The job SHALL interpret an infrastructure outcome — exhausted budget, interrupted run, or rejected credential — as "no signal", distinctly from a completed run in which cases were classified as regressions.

#### Scenario: Rejected credential is not reported as a regression

- **WHEN** the run aborts because its credential was rejected
- **THEN** the job reports that evals could not run
- **AND** it does not report a score regression

#### Scenario: Completed run below threshold is reported as a regression

- **WHEN** a run completes and triage classifies one or more cases as regressions
- **THEN** the job names those cases as regressions
- **AND** the classification comes from the triage verdict, not from a published score threshold

#### Scenario: Empty suite is a configuration problem

- **WHEN** a run discovers no cases, or its tag filter matches none
- **THEN** the job reports a configuration problem
- **AND** it does not report a regression or a clean pass

### Requirement: The first metered run is recorded as an observed baseline

The suite's baseline record SHALL contain either scores observed from a completed metered run or an explicit statement that no run has occurred. It SHALL NOT contain invented, estimated or expected scores. When a run is recorded, the record SHALL name the cost the run reported and the run parameters that produced it, so a later run is comparable to it rather than merely later.

#### Scenario: A run is recorded with its cost

- **WHEN** the suite completes a metered run and its baseline record is updated
- **THEN** the record carries a score per case that ran
- **AND** it carries the cost the run reported and the parameters the run used

#### Scenario: No run has occurred

- **WHEN** no metered run has completed
- **THEN** the baseline record states that no scores exist
- **AND** it does not carry a score for any case

#### Scenario: A partial run is recorded as partial

- **WHEN** a metered run ends before every selected case has run
- **THEN** the record names the cases that did run and states that the run was partial
- **AND** the cases that did not run carry no score

### Requirement: The eval workflow definition is tracked in version control

The continuous-integration definition that runs the eval suite SHALL be tracked in version control, and its tracking SHALL be asserted by the offline test suite. An ignore rule covering the directory it lives in SHALL NOT be sufficient reason for it to be untracked, because an untracked definition never runs on the remote and its absence is otherwise silent.

#### Scenario: The definition is tracked

- **WHEN** the offline test suite runs in a version-controlled checkout
- **THEN** it asserts that the eval workflow definition is tracked

#### Scenario: The definition is lost

- **WHEN** the eval workflow definition stops being tracked
- **THEN** the offline test suite fails and names the file

#### Scenario: Not a version-controlled checkout

- **WHEN** the offline test suite runs where version-control status cannot be determined
- **THEN** the assertion is skipped with its reason stated
- **AND** it is not reported as having passed

### Requirement: The scheduled full-suite run reads its runs-per-case from the published limits

The scheduled full-suite run SHALL obtain the number of runs per case from the published limits surface rather than restating it in the workflow definition or leaving it to each case's own value. A case MAY pin a lower value for the fast per-change subset, which runs under its own single-run posture.

#### Scenario: The scheduled run passes the published value

- **WHEN** the scheduled full-suite job runs
- **THEN** it resolves the runs-per-case from the published limits surface and passes it to the harness

#### Scenario: The published value changes

- **WHEN** the published runs-per-case is changed
- **THEN** the next scheduled run uses the new value with no edit to the workflow definition

