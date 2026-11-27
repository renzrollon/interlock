# Spec Delta

## MODIFIED Requirements

### Requirement: Every interlock subcommand SHALL accept only the flags it declares, and SHALL refuse any other flag by name

`interlock` SHALL hold, as code, the set of flags each subcommand accepts, plus a set accepted by every subcommand. Before running a subcommand it SHALL check every flag it parsed against that subcommand's set. A flag in neither set SHALL be refused:

- the process SHALL write a line naming the flag, the subcommand and the CLI's version to stderr, followed by that subcommand's help;
- when `--json` was passed, it SHALL also write a JSON object to stdout carrying `error`, `unknownFlag`, `subcommand` and `cliVersion`;
- it SHALL exit 2, and SHALL run nothing.

An unknown subcommand SHALL keep its exit code 1 and SHALL keep `Unknown command: <name>` as the first line it writes to stderr; what follows that line is the closest-command requirement's. The set accepted by `run start` SHALL include every run flag the run records, without restating them.

#### Scenario: Happy path — a documented invocation runs

- **GIVEN** a usage line documenting `interlock gate --findings <file>`
- **WHEN** `interlock gate --findings f.json --json` runs
- **THEN** the gate runs and exits on its verdict

#### Scenario: Failure — a misspelled flag is refused, never ignored

- **WHEN** `interlock autonomy record review-artifacts --blocker 2` runs
- **THEN** it exits 2 having written nothing to the autonomy record
- **AND** stderr names `--blocker`, `autonomy record` and the CLI version

#### Scenario: Edge case — the refusal reaches a relay that copies stdout only

- **WHEN** `interlock run start --change c --strcit --json` runs
- **THEN** stdout carries a JSON object whose `unknownFlag` is `--strcit` and whose `cliVersion` is the CLI's version
- **AND** the process exits 2 and writes no run manifest

## ADDED Requirements

### Requirement: Bare interlock SHALL print a grouped index of every command, not the full usage

`interlock` with no arguments, and `interlock help` with no command, SHALL print an index to stdout and exit 0. The index SHALL name every top-level command the full usage documents, grouped by the part of the loop it serves, and SHALL name `interlock help <command>` and `interlock --help --all` as the ways to read more. It SHALL be at most 30 lines. The index, the `help` subcommand and the unknown-command refusal SHALL be held in `lib/help-cli.mjs`.

#### Scenario: Happy path — a first run sees the index

- **WHEN** `interlock` runs with no arguments
- **THEN** stdout carries at most 30 lines and the process exits 0
- **AND** every top-level command named in the full usage's synopsis appears in it

#### Scenario: Edge case — the full text is still one flag away

- **WHEN** `interlock --help` runs
- **THEN** it prints the full usage, as before, and exits 0

### Requirement: interlock help SHALL print one command's usage, and --all SHALL print the full usage

`interlock help <command>` SHALL print what `interlock <command> --help` prints and exit 0. `interlock help --all`, `interlock --help --all` and `interlock -h --all` SHALL print the full usage and exit 0. `--all` SHALL change help output ONLY when no subcommand leads; when a subcommand leads, the help-after-subcommand requirement holds and prints that subcommand's usage lines. `interlock help <name>` for an unknown name SHALL be refused as an unknown subcommand is.

#### Scenario: Happy path — help for one command

- **WHEN** `interlock help doctor` runs
- **THEN** its stdout equals the stdout of `interlock doctor --help`
- **AND** it exits 0 and runs no preflight check

#### Scenario: Happy path — the full text on request

- **WHEN** `interlock help --all` runs
- **THEN** its stdout equals the stdout of `interlock --help`

#### Scenario: Edge case — --all after a subcommand keeps that subcommand's help

- **WHEN** `interlock review-policy suggest --all --help` runs
- **THEN** its stdout equals the stdout of `interlock review-policy --help` and does not print the full usage
- **AND** it exits 0 and runs no suggestion check

#### Scenario: Failure — help for a command that does not exist

- **WHEN** `interlock help valdiate` runs
- **THEN** stderr starts with `Unknown command: valdiate`, names `validate` as the closest command and names `interlock help`
- **AND** stderr does not print the full usage, stdout is empty, and the process exits 1

### Requirement: An unknown subcommand SHALL name the closest command instead of printing the full usage

After its `Unknown command: <name>` line, the refusal SHALL name the closest command when one is near the name typed, and SHALL point at `interlock help`. It SHALL NOT print the full usage. It SHALL write to stderr only and run nothing.

#### Scenario: Happy path — a typo gets a suggestion

- **WHEN** `interlock valdiate` runs
- **THEN** stderr starts with `Unknown command: valdiate`
- **AND** stderr names `validate` as the closest command and names `interlock help`
- **AND** stderr does not print the full usage, stdout is empty, and the process exits 1

#### Scenario: Failure — nothing is near

- **WHEN** `interlock xyzzy-plugh` runs
- **THEN** stderr starts with `Unknown command: xyzzy-plugh`, names no closest command and names `interlock help`
- **AND** stderr does not print the full usage, stdout is empty, and the process exits 1

#### Scenario: Edge case — an older-CLI probe still recognises the refusal

- **GIVEN** a reader that detects a pre-1.8 CLI by an `Unknown command` answer on stderr and a non-zero exit
- **WHEN** it reads this refusal
- **THEN** it still finds both
