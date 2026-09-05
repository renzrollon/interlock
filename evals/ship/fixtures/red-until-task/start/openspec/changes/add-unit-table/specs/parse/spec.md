## ADDED Requirements

### Requirement: Duration units live in a table the parser reads

The package SHALL hold its duration units and their lengths in milliseconds in
one exported table, and the duration parser SHALL obtain a unit's length from
that table rather than branching on the unit.

#### Scenario: Happy path — every unit in the table parses

- **WHEN** a duration is parsed for each unit the table carries
- **THEN** it returns that unit's length in milliseconds times the numeric part

#### Scenario: Edge case — the accepted units and the table cannot drift

- **WHEN** a unit is added to the table
- **THEN** the parser accepts it without a second edit naming it

### Requirement: A parser names the value it could not handle

Where a parser cannot handle its input, the error it raises SHALL carry that
input.

#### Scenario: Failure — an unparseable duration is named

- **WHEN** a value that is not a duration is parsed
- **THEN** the raised error carries the value that was given

### Requirement: A comma-separated list parses to trimmed, non-empty entries

The package SHALL parse a comma-separated string into a list, trimming each
entry and dropping empty ones.

#### Scenario: Happy path — entries are split and trimmed

- **WHEN** `a, b ,c` is parsed
- **THEN** the result is `a`, `b`, `c`

#### Scenario: Edge case — doubled and trailing commas yield no empty entries

- **WHEN** a value with doubled or trailing commas is parsed
- **THEN** no empty entry appears in the result
