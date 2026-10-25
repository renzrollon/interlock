## ADDED Requirements

### Requirement: The run-start event and the receipt SHALL record the CLI and plugin versions

The `run-start` event SHALL carry the CLI's version and path, and the plugin's version and root when the run was given one. The receipt SHALL carry the CLI version and the plugin version. A trajectory read without its repository SHALL therefore say which release produced it.

#### Scenario: Happy path — a trajectory names its release

- **GIVEN** a run started by CLI `1.8.0` with a plugin root at `1.8.0`
- **WHEN** its trajectory is read
- **THEN** the `run-start` event and the receipt both carry `1.8.0` for the CLI and the plugin

### Requirement: A trajectory line with a schema this CLI does not read SHALL be named, never folded in

A trajectory reader SHALL skip and count a line whose schema tag is present and is not the one this CLI writes. Such a line SHALL never be interpreted as a current event. The reconstructability check SHALL fail a trajectory holding any such line, naming the count and the first foreign tag. The show and query forms SHALL print a note with the count. A line with no schema tag SHALL be read as today.

#### Scenario: Failure — a newer release's event in the file

- **GIVEN** a trajectory with one line tagged `interlock.ship-run/2`
- **WHEN** `interlock run-log check` runs over it
- **THEN** it fails naming one foreign line and `interlock.ship-run/2`

#### Scenario: Edge case — summaries skip the line

- **GIVEN** the same trajectory
- **WHEN** the run list or the report reads it
- **THEN** the foreign line contributes to no tally
