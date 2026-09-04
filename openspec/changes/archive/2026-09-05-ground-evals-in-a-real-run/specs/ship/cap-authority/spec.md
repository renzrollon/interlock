## MODIFIED Requirements

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
