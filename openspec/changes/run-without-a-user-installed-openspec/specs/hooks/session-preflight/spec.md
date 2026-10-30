# Spec Delta

## ADDED Requirements

### Requirement: The SessionStart preflight SHALL put the plugin's CLI and the provisioned OpenSpec on the session's PATH

When the host gives the SessionStart hook a session environment file, the preflight SHALL append one line that extends `PATH` after its current value with the plugin's `cli/` directory and, when a plugin data directory is known, `<data>/openspec/<pinned version>`. It SHALL write the line before it runs the doctor, SHALL NOT append it twice, SHALL print nothing about it, and SHALL still exit 0 when the write fails.

#### Scenario: Happy path — the CLI and the OpenSpec directory are appended to PATH

- **GIVEN** the preflight of a plugin installed at `/p`, run with `CLAUDE_PLUGIN_DATA=/d` and `CLAUDE_ENV_FILE` naming a writable file
- **WHEN** the preflight runs
- **THEN** the file gains the line `export PATH="$PATH":'/p/cli':'/d/openspec/<pinned version>'`
- **AND** the hook's standard output does not mention it

#### Scenario: Happy path — a later Bash command finds the plugin's CLI by its bare name

- **GIVEN** a shell with `PATH=/usr/bin:/bin` that sources the file the preflight wrote, for a plugin root holding `cli/interlock`
- **WHEN** the shell runs `interlock --version`
- **THEN** it runs the plugin's `cli/interlock`
- **AND** `PATH` still begins with `/usr/bin:/bin`

#### Scenario: Edge case — no data directory appends only the CLI

- **GIVEN** a hook process with `CLAUDE_ENV_FILE` set and neither `INTERLOCK_PLUGIN_DATA` nor `CLAUDE_PLUGIN_DATA`
- **WHEN** the preflight runs
- **THEN** the line holds the plugin's `cli/` and no `openspec` entry

#### Scenario: Edge case — a second run in the same session appends nothing

- **GIVEN** an environment file that already holds the PATH line this preflight would write
- **WHEN** the preflight runs again
- **THEN** the file gains no second copy of that line

#### Scenario: Failure — the doctor cannot run, and the PATH line is still written

- **GIVEN** a hook process whose doctor exits non-zero with unparseable output
- **WHEN** the preflight runs
- **THEN** the environment file holds the PATH line
- **AND** the hook reports that the preflight could not run and exits 0

#### Scenario: Failure — an unwritable environment file does not fail the hook

- **GIVEN** `CLAUDE_ENV_FILE` naming a path whose directory does not exist
- **WHEN** the preflight runs
- **THEN** the hook still prints its preflight report and exits 0

#### Scenario: Edge case — an entry holding a line break is dropped

- **GIVEN** a `CLAUDE_PLUGIN_DATA` whose value holds a line break
- **WHEN** the preflight runs
- **THEN** the PATH line holds the plugin's `cli/` and no `openspec` entry, and no other line is written for it

### Requirement: The SessionStart preflight SHALL hand the plugin's data directory to the session's commands

When the host gives the SessionStart hook both `CLAUDE_PLUGIN_DATA` and a session environment file, the preflight SHALL append one line, `export INTERLOCK_PLUGIN_DATA=` followed by the value single-quoted, unless the session already has `INTERLOCK_PLUGIN_DATA`. It SHALL write nothing when either is absent or the value holds a line break or a NUL, SHALL print nothing about it, and SHALL still exit 0.

#### Scenario: Happy path — the data directory is exported to the session

- **GIVEN** a SessionStart hook process with `CLAUDE_PLUGIN_DATA=/home/u/.claude/plugins/data/interlock-interlock` and `CLAUDE_ENV_FILE` naming a writable file
- **WHEN** the preflight runs
- **THEN** the file gains the line `export INTERLOCK_PLUGIN_DATA='/home/u/.claude/plugins/data/interlock-interlock'`
- **AND** the hook's standard output does not mention it

#### Scenario: Edge case — an operator's own value is kept

- **GIVEN** a hook process that already has `INTERLOCK_PLUGIN_DATA=/srv/d` set, and `CLAUDE_PLUGIN_DATA` set to a different path
- **WHEN** the preflight runs
- **THEN** it appends no `INTERLOCK_PLUGIN_DATA` line
- **AND** the PATH line's OpenSpec entry is under `/srv/d`

#### Scenario: Edge case — a missing input writes nothing

- **GIVEN** a hook process with `CLAUDE_PLUGIN_DATA` set and no `CLAUDE_ENV_FILE`, or `CLAUDE_ENV_FILE` set and no `CLAUDE_PLUGIN_DATA`
- **WHEN** the preflight runs
- **THEN** no `INTERLOCK_PLUGIN_DATA` line is written and the hook exits 0

### Requirement: A skill SHALL speak a session whose PATH has no plugin CLI

A bare `interlock` answers `command not found` in a session started before the plugin was enabled. The spec, bootstrap and dispatch skills SHALL then say so and, until a new session, run `node "${CLAUDE_PLUGIN_ROOT}/cli/interlock"`, saying that those calls ask for approval. The ship skill SHALL NOT fall back, because its workers run the bare name: it SHALL ask for a new session and not launch again.

#### Scenario: Happy path — spec, bootstrap and dispatch name the full-path form

- **GIVEN** `skills/spec/SKILL.md`, `skills/bootstrap/SKILL.md` and `skills/dispatch/SKILL.md`
- **WHEN** the skills test reads them
- **THEN** each holds `${CLAUDE_PLUGIN_ROOT}/cli/interlock` beside the words `command not found`

#### Scenario: Failure — ship stops instead of falling back

- **GIVEN** `skills/ship/SKILL.md`
- **WHEN** the skills test reads it
- **THEN** it holds `command not found` and `new session`
- **AND** it does not hold `${CLAUDE_PLUGIN_ROOT}/cli/interlock`

#### Scenario: Edge case — no skill names the retired directory

- **GIVEN** every `skills/**/*.md` file
- **WHEN** the skills test reads them
- **THEN** none contains `bin/interlock`
