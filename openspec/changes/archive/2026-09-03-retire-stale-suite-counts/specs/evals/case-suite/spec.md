## ADDED Requirements

### Requirement: A documented count of a suite SHALL be derived or absent

Published documentation SHALL NOT state how many tests a suite contains unless that number is asserted by a test that derives it from the suite itself. Where no such assertion exists, the claim SHALL be expressed without a number. A count written once and maintained by hand is a claim nobody asserts, and drifts silently.

#### Scenario: Happy path — the claim survives without its number

- **WHEN** documentation describes the unit suite as dependency-free and names no count
- **THEN** the claim remains true regardless of how many tests the suite collects
- **AND** no maintenance step is required when a test is added or removed

#### Scenario: Failure — a hand-written count is reintroduced

- **WHEN** a documented sentence describing the size of the unit suite states a literal count that no test derives
- **THEN** the doc-claim check fails and names the file and the count it found

#### Scenario: Edge case — a derived count is permitted

- **WHEN** a documented count is accompanied by an assertion that reads the number from the suite at test time
- **THEN** the doc-claim check permits it, because the number cannot go stale without the suite going red

#### Scenario: Edge case — numbers that do not describe suite size are untouched

- **WHEN** documentation states a number that describes something other than how many tests a suite contains
- **THEN** the doc-claim check leaves it alone

### Requirement: The zero-dependency claim SHALL be read from the manifest

Where documentation claims that the suite runs without dependencies, that claim SHALL be asserted against the package manifest rather than trusted to prose. The claim is exactly derivable at no cost, and it is the claim a reader acts on when they clone the repository.

#### Scenario: Happy path — a dependency-free manifest satisfies the claim

- **WHEN** the package manifest declares no runtime dependencies
- **THEN** the assertion passes and the documented claim stands

#### Scenario: Failure — a runtime dependency is added without updating the claim

- **WHEN** a runtime dependency is declared in the package manifest
- **THEN** the assertion fails and names the documented claim it contradicts

### Requirement: Documentation of the eval suite SHALL name it and state its coverage boundary

Documentation that describes evaluation of this project SHALL name the model-in-the-loop suite at `evals/`, SHALL state which model-facing surfaces it exercises, and SHALL state which surfaces it does not. It SHALL NOT present the unit suite as the eval suite, and it SHALL NOT claim coverage the suite does not have on the day the sentence is written.

#### Scenario: Happy path — a reader learns the suite exists and where it stops

- **WHEN** a reader reaches the documentation's evaluation section
- **THEN** the text names `evals/`, names the surfaces its cases exercise, and names the surfaces with no cases
- **AND** the text does not describe the unit suite as an eval of the workflow's outcomes

#### Scenario: Failure — the eval suite is described but its gap is omitted

- **WHEN** documentation names the eval suite without stating which surfaces it leaves uncovered
- **THEN** the doc-claim check fails, because a coverage claim with no stated boundary reads as full coverage

### Requirement: Documentation of the eval suite SHALL carry no threshold value and no case count

Documentation describing the eval suite SHALL NOT state the value of any cap, cost ceiling, run budget, or score threshold, and SHALL NOT state how many cases the suite contains. Where a cap is relevant to the reader, the documentation SHALL name the command that prints it rather than repeat the value.

#### Scenario: Happy path — a cap is pointed to, not restated

- **WHEN** documentation needs to tell a reader that a cost ceiling bounds a metered eval run
- **THEN** it states that the ceiling exists and names the command that prints it
- **AND** it states no number

#### Scenario: Failure — a threshold value is written into prose

- **WHEN** documentation states the numeric value of an eval cap or score threshold
- **THEN** the doc-claim check fails and names the site

#### Scenario: Failure — a case count is written into prose

- **WHEN** documentation states how many cases the eval suite contains
- **THEN** the doc-claim check fails, because that number goes stale the next time a case is authored
