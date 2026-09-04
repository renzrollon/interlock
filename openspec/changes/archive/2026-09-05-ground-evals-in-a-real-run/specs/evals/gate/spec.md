## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The eval job is advisory until a baseline exists

The eval job SHALL report its result without failing the build. No triage verdict SHALL be promoted to a blocking check within this change. Promotion to blocking SHALL require observed run-to-run variance from the suite itself, recorded across more than one run.

#### Scenario: Failing eval does not block a pull request

- **WHEN** the eval job's triage classifies a case as a regression
- **THEN** the job surfaces the result
- **AND** the pull request remains mergeable on that job's account

#### Scenario: Promotion requires evidence

- **WHEN** promoting the gate to blocking is proposed
- **THEN** the proposal cites observed variance from prior runs rather than a chosen number

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
