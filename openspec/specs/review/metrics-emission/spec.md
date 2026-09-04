# review/metrics-emission Specification

## Purpose
Closes the gap between a review-metrics writer that already exists and a review path that never invokes it — so the report's review-finding indicators become observable without loosening the recognizer, without letting bookkeeping influence a verdict, and without leaving the emission as an optional flag that the next caller can silently omit.

## Requirements

### Requirement: Every gated review path can emit review metrics

Each command that evaluates review findings to a verdict SHALL accept a change name and, when given one, write one review-metrics record carrying the counts it computed: findings raised, findings dismissed, findings dropped by the tolerance band, and findings surviving to the verdict.

#### Scenario: The adversarial review path emits when given a change

- **WHEN** the review command evaluates findings against verdicts and is given a change name
- **THEN** a review-metrics record is written carrying that evaluation's raised, dismissed, dropped and surviving counts

#### Scenario: The deterministic gate path emits when given a change

- **WHEN** the gate command evaluates a findings file and is given a change name
- **THEN** a review-metrics record is written carrying that evaluation's raised, dismissed, dropped and surviving counts

#### Scenario: The emitted counts are the counts that produced the verdict

- **WHEN** dismissals and the tolerance band have been applied to reach a verdict
- **THEN** the counts in the record are the ones that produced that verdict, not counts recomputed by a second reading of the input

#### Scenario: A passing evaluation emits as readily as a failing one

- **WHEN** an evaluation reaches a passing verdict with zero surviving findings
- **THEN** a record is still written, carrying zero as an observed count rather than as an absence

### Requirement: The record declares the schema the report recognizes

An emitted record SHALL declare the review-metrics schema the report's classifier recognizes, so it is counted as recognized rather than surfaced as an unrecognized file.

#### Scenario: An emitted record is recognized by the report

- **WHEN** the report classifies a metrics file emitted by a review path
- **THEN** it is counted as recognized and contributes to the review-finding indicators

#### Scenario: Skill-written findings files remain unrecognized

- **WHEN** the metrics corpus also holds a skill-written findings file declaring no recognized schema
- **THEN** that file is still counted as unrecognized and contributes to no indicator, unchanged by this capability

### Requirement: Emission cannot change a verdict, an exit status, or machine-readable output

Emission SHALL be bookkeeping only. It SHALL NOT alter the verdict, the exit status, or the existing machine-readable structure, and a failed write SHALL NOT raise.

#### Scenario: A failed write leaves the verdict intact

- **WHEN** the record cannot be written because the destination is not writable
- **THEN** the command reports the same verdict and the same exit status it would have reported had the write succeeded

#### Scenario: A failed write is reported, not raised

- **WHEN** the record cannot be written
- **THEN** the reason is surfaced to the caller and no exception propagates

#### Scenario: A read-only checkout still yields a verdict

- **WHEN** the repository cannot be written to at all
- **THEN** the evaluation completes and returns its verdict

### Requirement: A record is attributed to a named change, never to an inferred one

A record SHALL be attributed to the change the caller named. When no change name is given, no record SHALL be written and no name SHALL be derived from the findings file's name or path.

#### Scenario: A named change is carried onto the record

- **WHEN** a review path is invoked with a change name
- **THEN** the emitted record is attributed to that change

#### Scenario: An unnamed invocation writes nothing rather than guessing

- **WHEN** a review path is invoked without a change name
- **THEN** no record is written and no name is inferred from the findings file's path

#### Scenario: An empty change name is refused rather than accepted

- **WHEN** a review path is invoked with a change name flag carrying no value
- **THEN** the invocation is refused with a message naming the missing value

### Requirement: The review skills' emission is pinned against silent regression

The command lines the review skills document SHALL carry the change name that triggers emission, and that SHALL be asserted by a test — so a skill that stops requesting metrics fails the suite rather than silently emptying the corpus.

#### Scenario: A skill dropping the change name fails the suite

- **WHEN** a review skill's documented command line no longer carries the change name that triggers emission
- **THEN** the test suite fails and names the skill

#### Scenario: Both review skills are covered

- **WHEN** the pinning test runs
- **THEN** it covers every review skill whose documented command line reaches a gated review path
