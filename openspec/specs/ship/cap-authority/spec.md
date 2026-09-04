# ship/cap-authority Specification

## Purpose

Keeps every cap the loop obeys stated in exactly one place, and keeps every cap that place advertises actually enforced by code. A cap restated in a second location drifts; a cap printed but unread is the same failure as a cap written in prose, which is the failure the limits module was created to end.

## Requirements

### Requirement: A cap SHALL be stated once and read from that statement

No loop, bound, or round budget SHALL restate a cap as a literal value. Every such bound SHALL be derived at use from the single limits definition, including bounds that are the cap plus or minus a constant.

#### Scenario: Happy path — raising a cap changes the loop that obeys it

- **GIVEN** a remediation round budget stated once in the limits definition
- **WHEN** that budget is raised by one
- **THEN** the remediation loop runs one additional fixing round
- **AND** the final verdict round remains the round after the last fixing round

#### Scenario: Failure — a restated cap is detected

- **GIVEN** a loop bound written as a literal number equal to a defined cap, or to that cap plus a constant
- **WHEN** the cap-authority check runs
- **THEN** the check fails and names the site and the cap it duplicates

#### Scenario: Edge case — a cap is lowered to its minimum meaningful value

- **GIVEN** the remediation round budget lowered so that only a verdict round remains
- **WHEN** the remediation phase runs
- **THEN** no fixing round runs, the verdict round runs exactly once, and the phase terminates
- **AND** the loop does not run zero rounds or fail to close the budget

### Requirement: Recorded cap consumption SHALL reflect what the run consumed

A field recording how much of a cap a run used SHALL be computed from the run's actual progression. Such a field SHALL NOT be able to hold the same value on every run regardless of what happened.

#### Scenario: Happy path — a run that used one round records one

- **GIVEN** a run whose blockers cleared after a single fixing round
- **WHEN** the outcome is recorded
- **THEN** the recorded round consumption is one

#### Scenario: Failure — a constant-valued consumption field is rejected

- **GIVEN** two runs that consumed different numbers of rounds
- **WHEN** each records its outcome
- **THEN** the two recorded values differ
- **AND** a field that yields the same value for both is a defect

#### Scenario: Edge case — a run in which the phase never executed

- **GIVEN** a lean run in which the remediation phase never ran
- **WHEN** the outcome is recorded
- **THEN** the consumption field is absent or explicitly zero, distinguishably from "ran and used none"

### Requirement: Every advertised cap SHALL be enforced by code

A cap that the limits surface prints SHALL be read by the code path it governs. A cap with no reader SHALL be either wired to its governing path or removed from the definition and from the printed surface together.

This SHALL hold for every group of caps the limits surface prints, not only the loop-iteration group. A cap group SHALL NOT be exempted from the check on the grounds that its readers live outside the directories the check searches; the search SHALL instead cover every location a reader may legitimately live, including the continuous-integration definitions that read caps from the published limits surface.

A reader SHALL count when it reads the cap by name, whether it names the cap through the definition it is exported from or through the field name the published limits surface exposes. A reference that merely passes a whole cap group through to the printed surface SHALL NOT count as a reader of any cap within it.

#### Scenario: Happy path — each printed cap has a reader

- **GIVEN** the set of caps the limits surface prints
- **WHEN** each is traced to the code that reads it
- **THEN** every printed cap has at least one reader outside the limits definition and its own tests

#### Scenario: Failure — a printed cap with no reader

- **GIVEN** a cap that appears in the printed limits output and is referenced nowhere else in the implementation
- **WHEN** the cap-authority check runs
- **THEN** the check fails and names the unenforced cap
- **AND** documentation citing that cap as enforced is treated as incorrect

#### Scenario: Edge case — a cap whose only reference is a test asserting its value

- **GIVEN** a cap referenced solely by a test that asserts the cap equals a number
- **WHEN** the cap-authority check runs
- **THEN** that reference does not count as a reader, and the check fails
- **AND** the test is recognized as pinning a value rather than exercising a behavior

#### Scenario: A cap whose only reader is a continuous-integration definition

- **GIVEN** a cap read solely by a continuous-integration definition, through the field name the published limits surface exposes
- **WHEN** the cap-authority check runs
- **THEN** that reference counts as a reader and the check passes for that cap
- **AND** the cap is not exempted from the check

#### Scenario: A whole cap group forwarded to the printed surface

- **GIVEN** a site that forwards an entire cap group to the published output without naming any cap in it
- **WHEN** the cap-authority check runs
- **THEN** that site does not count as a reader for any cap in the group

### Requirement: The oversized-result check SHALL cover every text-bearing result field

The check that rejects an oversized verification result field SHALL apply to every field of a result that can carry free text, not to an incomplete list of them.

#### Scenario: Happy path — an oversized field is rejected before judgement

- **GIVEN** a verification result whose detail field exceeds the character ceiling
- **WHEN** the result is checked
- **THEN** the check reports a violation naming the field and its length
- **AND** the result is rejected rather than judged

#### Scenario: Failure — an oversized field outside the previous allowlist is rejected

- **GIVEN** a verification result whose summary, message, error or notes field exceeds the ceiling
- **WHEN** the result is checked
- **THEN** the check reports a violation for that field
- **AND** the result SHALL NOT pass because the field was absent from an earlier allowlist

#### Scenario: Edge case — a field exactly at the ceiling

- **GIVEN** a text field whose length equals the ceiling exactly
- **WHEN** the result is checked
- **THEN** the field passes, and a field one character longer fails
- **AND** the boundary is asserted in both directions
