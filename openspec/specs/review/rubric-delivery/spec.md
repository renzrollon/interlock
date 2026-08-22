# rubric-delivery Specification

## Purpose

Delivers each review dimension's written criteria to the agent reviewing that dimension, so a reviewer works from a rubric rather than from the name of a rubric. Findings produced without criteria are what the adversarial skeptics then spend their budget verifying, so an undelivered rubric degrades every downstream stage of the review.

## Requirements

### Requirement: A dimension reviewer SHALL receive that dimension's written criteria

When the loop fans out one reviewer per dimension, each reviewer's instructions SHALL include the criteria defined for its dimension. A reviewer SHALL NOT be given only the dimension's name.

#### Scenario: Happy path — each reviewer gets its own rubric

- **GIVEN** a review run fanning out reviewers for the always-on dimensions
- **WHEN** each reviewer's instructions are assembled
- **THEN** each contains the criteria text for exactly its own dimension
- **AND** no reviewer receives another dimension's criteria

#### Scenario: Failure — a dimension with no criteria available is reported

- **GIVEN** a dimension named in the fan-out for which no criteria can be found
- **WHEN** the reviewer's instructions are assembled
- **THEN** the run reports that the dimension's criteria were unavailable
- **AND** the degradation is named in the summary rather than the reviewer proceeding silently on the name alone

#### Scenario: Edge case — a dimension known by two names

- **GIVEN** a dimension whose criteria are stored under one identifier while another surface refers to it by a different label
- **WHEN** a reviewer for that dimension is dispatched, and when a caller selects that dimension by name
- **THEN** both names resolve to the same criteria
- **AND** a name that resolves to no criteria is rejected at the point of selection rather than silently matching nothing

### Requirement: Re-review after remediation SHALL use the same criteria as the first pass

A dimension re-reviewed after a remediation round SHALL receive the same criteria it received on the first pass.

#### Scenario: Happy path — a re-reviewed dimension gets its rubric again

- **GIVEN** a remediation round that re-reviews a subset of dimensions
- **WHEN** each re-reviewer's instructions are assembled
- **THEN** each contains the criteria for its dimension

#### Scenario: Failure — a re-review dispatched without criteria

- **GIVEN** a re-review whose instructions omit the dimension criteria
- **WHEN** the rubric-delivery check runs over the assembled instructions
- **THEN** the check fails and names the re-review stage

#### Scenario: Edge case — a re-review list naming a dimension that did not run in the first pass

- **GIVEN** a remediation plan naming a dimension that was not part of the original fan-out
- **WHEN** the re-review is dispatched
- **THEN** that dimension's criteria are still delivered, or the dimension is rejected as not applicable to this run
- **AND** it is not dispatched with an empty rubric
