# cli/arguments Specification

## Purpose

Defines how Interlock's command-line binaries treat the arguments they are given: which flags a subcommand accepts, what an unknown flag does, how help and version are asked for, and where a two-word subcommand reads its change name.

## Requirements

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

### Requirement: Every flag the CLI reads, documents or is passed by a shipped surface SHALL be in a declared set

The test suite SHALL fail when any of the following is missing from the declared sets:

- a flag the `interlock` source reads, missing from every declared set;
- a flag a usage line documents for a subcommand, missing from that subcommand's set;
- a flag a shipped surface passes to a subcommand, missing from that subcommand's set.

The shipped surfaces are the skills, shared prose, agents, the ship driver, the run program's emitted argv, the resume card and the hooks. Each failure SHALL name the flag and where it was found.

#### Scenario: Failure — a skill adds a flag the CLI does not declare

- **GIVEN** a skill line `interlock review --findings f --since b --json`
- **WHEN** the suite runs
- **THEN** it fails naming `--since`, `review` and the skill file

### Requirement: Help SHALL be honoured after a subcommand and SHALL run nothing

When `-h` or `--help` appears anywhere in an `interlock` invocation, the CLI SHALL print the usage lines for the leading subcommand, or the full usage when it has none, and SHALL exit 0 without running the subcommand. `interlock-run -h` SHALL print its usage and exit 0, never reading `-h` as a change name.

#### Scenario: Happy path — doctor's help does not run the doctor

- **WHEN** `interlock doctor --help` runs
- **THEN** it prints the doctor's usage lines and exits 0
- **AND** no preflight check runs

#### Scenario: Edge case — a subcommand with no usage lines of its own

- **WHEN** `interlock verify --help` runs
- **THEN** it prints usage and exits 0, rather than reporting an unknown subcommand

### Requirement: Each binary SHALL report its own version

`interlock --version` SHALL print the version of the package the running binary belongs to and exit 0. `interlock version --json` SHALL print an object carrying `version` and the resolved path of the running binary. `interlock-graph --version` and `interlock-run --version` SHALL print the same version and exit 0.

#### Scenario: Happy path — the installed tarball reports its version

- **GIVEN** the tarball of version `V` installed into a prefix
- **WHEN** `<prefix>/bin/interlock --version` runs
- **THEN** it prints `V` and exits 0

### Requirement: A two-word subcommand SHALL read its change name from the positional that follows it

`interlock tasks tick <change> --ids …` and `interlock tasks coverage <change> …` SHALL resolve `<change>` as the change, with `--change` taking precedence when both are given. Neither SHALL ever read the subcommand word as the change.

#### Scenario: Happy path — the halt card's command form ticks the boxes

- **GIVEN** an active change `c` whose `tasks.md` has unchecked task `1.1`
- **WHEN** `interlock tasks tick c --ids 1.1 --json` runs
- **THEN** task `1.1` is checked and the command exits 0

#### Scenario: Failure — the subcommand word is never a change name

- **WHEN** `interlock tasks tick c --ids 1.1` runs in a repository with no change named `tick`
- **THEN** the output never says `change "tick" not found`

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
