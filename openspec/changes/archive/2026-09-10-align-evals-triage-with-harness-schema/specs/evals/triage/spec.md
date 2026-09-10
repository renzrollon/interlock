## ADDED Requirements

### Requirement: Triage accepts both the harness results shape and the legacy unit-test shape

Triage SHALL classify each case from either the results shape `claude plugin eval` writes at `schemaVersion` 1, or the legacy shape the offline unit tests construct. It SHALL NOT require a results file to carry both. The two shapes are:

- **Harness `schemaVersion` 1:** case identity is `name`; scored trials are `arms.with` when that list is non-empty, otherwise `arms['with-only']`. The baseline comparison list `arms.without`, when present, is not the scored trial list.
- **Legacy unit-test shape:** case identity is `id`; scored trials are `runs`.

When more than one trial list is present, triage SHALL take the first non-empty of `runs`, then `arms.with`, then `arms['with-only']`. Case identity SHALL be `name` when that field is a non-empty string, otherwise `id` when that field is a non-empty string. Grader classification — deterministic failure is a regression on one trial, judged-only dip on one trial is variance, indicators never score — SHALL apply to the trials so obtained and SHALL NOT change.

Triage SHALL remain computable from the results file alone, SHALL NOT call a model, SHALL NOT reach the network, and SHALL keep the existing verdict map: pass, regression, no signal, configuration. It SHALL NOT introduce a further verdict.

#### Scenario: Harness schemaVersion 1 case with arms.with

- **WHEN** a case carries `name` and a non-empty `arms.with` trial list, and no `runs`
- **THEN** triage uses `name` as the case identity
- **AND** it classifies that case from the graders on those `arms.with` trials

#### Scenario: Harness case with only the with-only arm

- **WHEN** a case carries `name` and a non-empty `arms['with-only']` trial list, and neither `runs` nor `arms.with` is a non-empty list
- **THEN** triage classifies that case from the graders on those `arms['with-only']` trials

#### Scenario: Baseline without arm is not the scored trial list

- **WHEN** a case carries both `arms.with` and `arms.without`
- **THEN** triage classifies the case from `arms.with`
- **AND** it does not treat `arms.without` as the case's scored trials

#### Scenario: Legacy id and runs shape still classifies

- **WHEN** a case carries `id` and a `runs` trial list in the shape the offline unit tests construct
- **THEN** triage classifies that case from those runs

#### Scenario: Dual-read does not drop either shape

- **WHEN** the offline test suite runs
- **THEN** at least one assertion classifies a case from the harness shape
- **AND** at least one assertion classifies a case from the legacy `id` / `runs` shape

## MODIFIED Requirements

### Requirement: Triage's reading of the results schema is pinned by a real results file

Triage reads a results file produced by an external harness whose schema is not published. At least one triage test SHALL therefore load a results file the harness actually produced — committed to the repository, with credentials and transcripts removed — and SHALL assert the verdict that run produced. Hand-constructed inputs alone SHALL NOT be the only evidence that triage reads the schema correctly.

#### Scenario: A committed harness results file is triaged

- **WHEN** the offline test suite runs
- **THEN** at least one triage assertion is made against a results file produced by the harness rather than constructed in the test

#### Scenario: A harness field is renamed

- **WHEN** a field triage depends on is renamed or removed in the results schema
- **THEN** the assertion against the committed results file fails

#### Scenario: The committed file exercises only part of the schema

- **WHEN** the committed results file comes from a run that exercised only some grader kinds or some outcome branches
- **THEN** the parts of the schema it does not exercise are named as unpinned rather than presumed correct

#### Scenario: Triage disagrees with the run's own report

- **WHEN** the verdict triage computes from the committed file contradicts what the run itself reported
- **THEN** the disagreement is recorded as a defect
- **AND** the assertion is not adjusted to match the contradicting behaviour

#### Scenario: The 2026-09-04 smoke fixture is a regression

- **WHEN** triage is run over the committed harness results file from the 2026-09-04 smoke run
- **THEN** the verdict is a regression
- **AND** the exit status is the regression status
- **AND** the output names the case `tier-read-scope`
- **AND** the output names the failed graders `no-design-read` and `no-spec-read`
