# Spec Delta

## MODIFIED Requirements

### Requirement: The preflight SHALL report whether the host can load the plugin's hooks module, as advice

`interlock doctor` SHALL carry a `mods` row. It SHALL be `ok` when the Claude Code binary the preflight probes reports a version at or above the mods floor, `skip` naming the version and the floor otherwise, and `skip` naming the version as unknown when it could not be read; it SHALL never be `fail`. The row SHALL name which binary it read, because the engine behind a Desktop session is not the `claude` on PATH, and SHALL say that a session whose host cannot load mods runs exactly today's run and prints every banner at close. The floor SHALL be a named constant beside the other host-version floors, never a literal in the row's text; it is the lowest engine on which the module's hooked events and calls validate, and a change that raises it SHALL say why in its changelog entry.

#### Scenario: Happy path — a host at the floor

- **GIVEN** a `claude` on PATH whose version command reports `2.1.295`
- **WHEN** `interlock doctor` runs
- **THEN** the `mods` row is `ok`, names `2.1.295` and the binary it probed
- **AND** the report's overall verdict is unaffected

#### Scenario: Failure — a host below the floor is advice, never a failing check

- **GIVEN** a `claude` on PATH whose version command reports `2.1.289`
- **WHEN** `interlock doctor` runs
- **THEN** the `mods` row is `skip`, names `2.1.289` and the floor, and says the meter draws nothing on this host and the run is unchanged
- **AND** the row is not `fail` and the exit code is unaffected

#### Scenario: Edge case — an unreadable version, and a Desktop session

- **GIVEN** a host whose version command fails, in a Desktop Code tab session
- **WHEN** `interlock doctor` runs
- **THEN** the row is `skip`, says the version is unknown, and says the engine behind a Desktop session may differ from the binary it probed
- **AND** the row is not `fail`

## ADDED Requirements

### Requirement: The SessionStart preflight SHALL list open change names and recent run ids in its report, from directory listings alone

The report file SHALL carry `openChanges`, the directory names under `openspec/changes/` other than `archive` and dot-names, and `recentRuns`, the run ids of the trajectory files under the state home's runs directory. Each SHALL be newest first by modification time and cut at the cap `interlock limits` prints for preflight list names, with the number left out. The hook SHALL open no file and start no process for them. A directory that cannot be listed SHALL make its list `null`, never empty.

#### Scenario: Happy path — two open changes and three recorded runs

- **GIVEN** a working root whose `openspec/changes/` holds `add-foo`, `fix-baz`, `archive` and `.claude`, and a state home whose runs directory holds the trajectories of runs `r-1`, `r-2` and `r-3`, `r-3` written last
- **WHEN** the SessionStart hook runs
- **THEN** the report file's `openChanges` names `add-foo` and `fix-baz`, newest first, with none left out, and its `recentRuns` names `r-3`, `r-2`, `r-1`
- **AND** no trajectory and no artifact was opened, and the hook's advisory output is what it was

#### Scenario: Failure — a directory that cannot be listed is null, and the hook still exits 0

- **GIVEN** a state home whose runs directory cannot be listed
- **WHEN** the SessionStart hook runs
- **THEN** the report file's `recentRuns` is `null`, its `openChanges` is listed as usual, and the hook exits 0
- **AND** a runs directory that does not exist is an empty list, not `null`

#### Scenario: Edge case — more names than the cap, and a report written before this change

- **GIVEN** a runs directory holding more trajectories than the published cap
- **WHEN** the SessionStart hook runs
- **THEN** `recentRuns` holds the newest names up to the cap and the number left out
- **AND** a report file written without the two fields is read as holding `null` for both, under the same schema stamp
