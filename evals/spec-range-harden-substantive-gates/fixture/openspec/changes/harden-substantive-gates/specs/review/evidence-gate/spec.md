## Purpose

Makes a verdict that dismisses a review finding carry a citation whose shape can be mechanically checked, and makes a finding's severity either a recognized value or a rejection. Both are the same rule applied twice: a claim about a model's own work is audited, and an unsubstantiated claim is treated as unresolved rather than accepted.

## ADDED Requirements

### Requirement: A dismissing verdict SHALL carry a checkable citation

A verdict that a finding is not real SHALL cite a source location in a checkable form — a path with a line number, or a path with a line range. A verdict whose evidence does not match that form SHALL NOT dismiss the finding.

Rationale: the check is a shape predicate deliberately, not a semantic one. A semantic check would relocate the judgement to another model; a shape check is deterministic and testable.

#### Scenario: Happy path — a cited dismissal removes the finding

- **GIVEN** a blocker finding and a verdict that it is not real, citing a path and a line number
- **WHEN** the review is resolved
- **THEN** the finding is counted as dismissed and does not survive to the gate

#### Scenario: Failure — an uncited dismissal does not dismiss

- **GIVEN** a blocker finding and a verdict that it is not real, whose evidence is prose, a bare filename with no line, a single word, or a single emoji
- **WHEN** the review is resolved
- **THEN** the verdict is recorded as a non-vote and the finding survives
- **AND** the verdict is not deleted, so its quality score still reaches the tolerance band

#### Scenario: Edge case — evidence in an accepted but unusual form

- **GIVEN** dismissal evidence expressed as a path with a line range, a path with a column suffix after the line, a path containing spaces, and the same path written with a leading `./`
- **WHEN** each verdict is resolved
- **THEN** each is accepted as a citation on the strength of its shape
- **AND** evidence naming a path absent from the reviewed diff is rejected even though its shape is valid

### Requirement: A finding's severity SHALL be a recognized value or be rejected

A finding whose severity is outside the defined set SHALL be rejected rather than mapped to an unrecognized bucket that the gate does not block on.

#### Scenario: Happy path — an in-enum blocker blocks

- **GIVEN** a surviving finding whose severity is the blocker value
- **WHEN** the gate counts findings
- **THEN** the blocker count includes it and the gate blocks

#### Scenario: Failure — an out-of-enum severity does not pass the gate

- **GIVEN** a surviving finding whose severity is a plausible but undefined value such as a higher-sounding word than the defined maximum
- **WHEN** the gate counts findings
- **THEN** the finding is rejected and reported as malformed
- **AND** it SHALL NOT be silently counted into a bucket the gate ignores

#### Scenario: Edge case — a severity differing only in casing or surrounding whitespace

- **GIVEN** findings whose severity values match a defined value except for letter casing or leading and trailing whitespace
- **WHEN** the gate counts findings
- **THEN** each resolves to the one canonical severity value and is counted there
- **AND** a value that is not a casing or whitespace variant of a defined value is rejected

### Requirement: The evidence rule SHALL be applied in the direction that fails closed

The requirement to cite SHALL apply to the verdict direction that removes a finding. A verdict that a finding is real SHALL NOT be required to cite, because that direction already resolves toward a human reading the finding.

#### Scenario: Happy path — an uncited confirming verdict still keeps the finding

- **GIVEN** a finding and a verdict that it is real, carrying no citation
- **WHEN** the review is resolved
- **THEN** the finding survives and reaches the gate

#### Scenario: Failure — a citation requirement is not extended to confirmations

- **GIVEN** an implementation that rejects uncited confirming verdicts
- **WHEN** a real finding is reported without a citation
- **THEN** requiring a citation there would drop the finding, which is the expensive error
- **AND** the specified behavior is that the confirmation stands

#### Scenario: Edge case — a finding with one cited dismissal and one uncited confirmation

- **GIVEN** two verdicts on one finding: a cited dismissal and an uncited confirmation
- **WHEN** the review is resolved
- **THEN** the outcome follows the stated survival rule with the non-vote excluded from the count
- **AND** the resulting counts of dismissed, surviving and non-voting verdicts are all reported
