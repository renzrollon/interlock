## ADDED Requirements

### Requirement: The preflight SHALL report whether the host can load the plugin's hooks module, as advice

`interlock doctor` SHALL carry a `mods` row. It SHALL be `ok` when the Claude Code binary the preflight probes reports a version at or above the mods floor, `skip` naming the version and the floor otherwise, and `skip` naming the version as unknown when it could not be read; it SHALL never be `fail`. The row SHALL name which binary it read, because the engine behind a Desktop session is not the `claude` on PATH, and SHALL say that a session whose host cannot load mods runs exactly today's run and prints every banner at close. The floor SHALL be a named constant beside the other host-version floors, never a literal in the row's text.

#### Scenario: Happy path — a host at the floor

- **GIVEN** a `claude` on PATH whose version command reports `2.1.289`
- **WHEN** `interlock doctor` runs
- **THEN** the `mods` row is `ok`, names `2.1.289` and the binary it probed
- **AND** the report's overall verdict is unaffected

#### Scenario: Failure — a host below the floor is advice, never a failing check

- **GIVEN** a `claude` on PATH whose version command reports `2.1.274`
- **WHEN** `interlock doctor` runs
- **THEN** the `mods` row is `skip`, names `2.1.274` and the floor, and says the meter draws nothing on this host and the run is unchanged
- **AND** the row is not `fail` and the exit code is unaffected

#### Scenario: Edge case — an unreadable version, and a Desktop session

- **GIVEN** a host whose version command fails, in a Desktop Code tab session
- **WHEN** `interlock doctor` runs
- **THEN** the row is `skip`, says the version is unknown, and says the engine behind a Desktop session may differ from the binary it probed
- **AND** the row is not `fail`
