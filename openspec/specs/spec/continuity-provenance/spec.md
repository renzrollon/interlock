# continuity-provenance Specification

## Purpose

Makes the blocker count that decides whether a human reads a specification come from the artifact review's own findings, rather than from a number the reviewed agent wrote down. This is the one number in the loop where the party being gated currently reports its own result.

## Requirements

### Requirement: The readiness gate SHALL derive the blocker count from the review's findings

The readiness gate SHALL accept the artifact review's findings output and compute the blocker count from it using the same evaluation the review gate uses. It SHALL NOT rely on a count transcribed by the agent whose work is being gated.

#### Scenario: Happy path — a findings file with no blockers permits continuity

- **GIVEN** an artifact-review findings file whose findings, after dismissal and the quality band, contain no blockers
- **WHEN** the readiness gate is asked whether the change may skip the human read
- **THEN** the gate computes zero blockers from the findings and the readiness check for review blockers passes

#### Scenario: Failure — a findings file containing a blocker stops continuity

- **GIVEN** an artifact-review findings file containing a surviving blocker
- **WHEN** the readiness gate runs
- **THEN** the gate blocks, names the blocker count it computed, and exits non-zero
- **AND** the count is the one derived from the findings, not one supplied alongside them

#### Scenario: Edge case — a findings file that is absent, empty, or unparseable

- **GIVEN** a findings path that does not exist, or a file that is empty or cannot be parsed
- **WHEN** the readiness gate runs
- **THEN** the review is treated as not having run and the gate blocks
- **AND** an unreadable findings file SHALL NOT resolve to a count of zero

### Requirement: A self-reported count SHALL NOT satisfy the review-blockers check

The gate SHALL stop treating a hand-written count as the review result. Where the previous input form is still accepted for compatibility, using it SHALL be reported as a degradation and SHALL NOT satisfy the check on its own.

#### Scenario: Happy path — the findings-derived input is used and reported

- **GIVEN** a readiness run supplied with a findings file
- **WHEN** the gate reports its checklist
- **THEN** the review-blockers entry states that the count was derived from the findings

#### Scenario: Failure — only a hand-written count is supplied

- **GIVEN** a readiness run supplied only with a transcribed blocker count and no findings file
- **WHEN** the gate runs
- **THEN** the review-blockers check does not pass on that input alone
- **AND** the gate reports that the count's provenance is the gated agent

#### Scenario: Edge case — both inputs supplied and disagreeing

- **GIVEN** a readiness run supplied with both a findings file and a transcribed count, where the two disagree
- **WHEN** the gate runs
- **THEN** the findings-derived count decides the outcome
- **AND** the disagreement is reported rather than resolved silently in either direction

### Requirement: The continuity procedure SHALL NOT instruct an agent to write the gated number

The documented continuity procedure SHALL direct the agent to hand the readiness gate the review's findings output. It SHALL NOT instruct the agent to compose a file containing the blocker count.

#### Scenario: Happy path — the procedure passes the findings path

- **GIVEN** the continuity procedure as documented
- **WHEN** an agent follows it
- **THEN** it passes the artifact review's findings output to the readiness gate
- **AND** it composes no file containing a blocker count

#### Scenario: Failure — a procedure step that transcribes the count is rejected

- **GIVEN** a continuity procedure containing a step that writes a blocker count into a file
- **WHEN** the procedure is checked against this requirement
- **THEN** the check fails and names that step

#### Scenario: Edge case — the artifact review produced no findings file

- **GIVEN** a continuity attempt on a change for which the artifact review wrote no findings output
- **WHEN** the procedure runs
- **THEN** it reports that the review has not run and stops at the human checkpoint
- **AND** it does not synthesize a findings file or a count in order to proceed
