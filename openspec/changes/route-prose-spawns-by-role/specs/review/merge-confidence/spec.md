## ADDED Requirements

### Requirement: The ran signal's evidence SHALL name the depth the review record carries

When the review input's dimension record carries `depth`, the ran signal (`review.ran`) SHALL carry `depth: <value>` in its evidence, whatever its band. A record without `depth` SHALL be read exactly as before, with no depth line. The depth SHALL move no band and raise no flag: the lean depth is the published default, not a degradation, and the evidence is what lets a reader of a `MERGE` ask for the strict one.

Rationale: a verdict that does not say how thorough its review was is a verdict a reader cannot calibrate; a verdict that scored every default review lower would be a threshold stated as a flag.

#### Scenario: Happy path — a lean record is named and green

- **GIVEN** a review input with no surviving blocker, warnings under the cap, and a dimension record showing every selected dimension ran and carrying `depth: lean`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with no flag and its evidence carries `depth: lean`
- **AND** the score equals the score of the same input with `depth: strict`

#### Scenario: Failure — an incomplete lean review is amber and still named

- **GIVEN** a review input whose dimension record carries `depth: lean` and names a selected dimension that neither ran nor was unavailable
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber with the reason naming that dimension
- **AND** its evidence carries `depth: lean`

#### Scenario: Edge case — a record without a depth reads as before

- **GIVEN** a review input whose dimension record carries no `depth`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal's band, flags and reason are what they were before this requirement
- **AND** no evidence line names a depth
