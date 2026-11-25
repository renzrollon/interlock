# Spec Delta

## ADDED Requirements

### Requirement: `interlock verify exec` SHALL append what it observed to the file `--record` names, and a record it cannot write SHALL NOT change the exit code

With `--record <file>`, `interlock verify exec` (`lib/verify-exec.mjs`) SHALL append one JSON line `{ kind, command, exitCode, durationMs, at }` to that file after the command ends, creating the file's directories: the timing line it already records, byte for byte. Its exit code SHALL stay the command's. A record it cannot write, and a `--record` with no file, SHALL be said on standard error and SHALL change nothing else. Without `--record` it SHALL write no such file.

#### Scenario: Happy path — a command that exits 0

- **GIVEN** `--kind unit`, a command that exits 0, and `--record` naming a file in a directory that does not yet exist
- **WHEN** the command runs
- **THEN** the file holds one line that parses to an object with `kind: "unit"`, the command as given, `exitCode: 0`, a non-negative integer `durationMs` and an `at` timestamp
- **AND** the process exits 0

#### Scenario: Failure — a command that exits 3

- **GIVEN** a command that exits 3 and `--record` naming a file
- **WHEN** the command runs
- **THEN** the appended line holds `exitCode: 3`
- **AND** the process exits 3

#### Scenario: Failure — a record path that cannot be written

- **GIVEN** `--record` naming a path under an existing regular file, and a command that exits 0
- **WHEN** the command runs
- **THEN** standard error says the record was not written and names the path
- **AND** the process exits 0, and the timing it already records is still appended

#### Scenario: Edge case — no `--record`

- **GIVEN** the same command with no `--record`
- **WHEN** the command runs
- **THEN** no record file is written anywhere under `.claude/ship/settle/`
- **AND** its exit code and its timing line are what they were before the flag existed

#### Scenario: Edge case — two runs append two lines

- **GIVEN** the same `--record` file and two runs of one command, the first exiting 1 and the second exiting 0
- **WHEN** both have run
- **THEN** the file holds two lines in the order the runs ended, with `exitCode` 1 and then 0
- **AND** the first line is unchanged by the second run

#### Scenario: Edge case — a `--record` with no file

- **GIVEN** `--record` followed by another flag, or by a blank value, and a command that exits 2
- **WHEN** the command runs
- **THEN** standard error says `--record` needs a file, no record file is written, the process exits 2 and the timing line is still appended
