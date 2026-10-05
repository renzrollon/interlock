## ADDED Requirements

### Requirement: The preflight SHALL report the Claude Code environment that rewrites a run's routing, as advice

`interlock doctor` SHALL carry a `claude-env` row naming the installed host's version or that it could not be read; whether each of `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set, with its value where set; the version-aware reading of the plain variable on this host; that FORCE forces one model; that the teams variable does not affect Workflow agents; whether a Bedrock variable is set; and the machine's CPU count beside the vendor's default concurrency. The row SHALL be `ok` when none of the four variables is set and the version was read, `skip` otherwise, and never `fail`. The values it prints are model slugs and small integers; it SHALL print no credential.

#### Scenario: Happy path — a clean environment on a readable host

- **GIVEN** none of the four variables set and a host whose version command reports `2.1.288`
- **WHEN** `interlock doctor` runs
- **THEN** the `claude-env` row is `ok` and names version `2.1.288`
- **AND** the report's overall verdict is unaffected

#### Scenario: Failure — a forcing variable is advice, never a failing check

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`
- **WHEN** `interlock doctor` runs
- **THEN** the `claude-env` row is `skip`, names the variable and says every agent runs on one model
- **AND** the row is not `fail` and the exit code is unaffected

#### Scenario: Edge case — an unreadable version is named as unknown, and the teams variable is explained

- **GIVEN** a host whose version command fails and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **WHEN** `interlock doctor` runs
- **THEN** the row is `skip`, says the version is unknown and that the teams variable does not affect Workflow agents
- **AND** the row is not `fail`

### Requirement: The SessionStart preflight SHALL surface unspoken interrupted-run notes

The SessionStart hook SHALL read the interrupted-run notes in the project root and, for each not yet spoken, SHALL add `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` to its advisory output. It SHALL NOT mark a note spoken, because the next run start is the moment that marks it. A note that cannot be read SHALL be named as unreadable. The hook SHALL exit 0 on every path, and a root with no notes SHALL produce the output it produces today.

#### Scenario: Happy path — an unspoken note is surfaced at session start

- **GIVEN** an unspoken note for run `r-1` of change `add-foo` at stage `verify`
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output contains `PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify`
- **AND** the note is still marked not yet spoken afterwards

#### Scenario: Failure — an unreadable note is named and the session starts

- **GIVEN** a note file that is not valid JSON
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output says a note could not be read and names the file
- **AND** the hook exits 0

#### Scenario: Edge case — no notes leaves the preflight's output unchanged

- **GIVEN** a root with no `.claude/ship/interrupted/` directory
- **WHEN** the SessionStart hook runs
- **THEN** its output is exactly the preflight's existing confirmation or failure report
- **AND** no directory is created
