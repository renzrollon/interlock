## ADDED Requirements

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
