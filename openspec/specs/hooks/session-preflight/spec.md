# hooks/session-preflight Specification

## Purpose

Fires the existing `interlock doctor` preflight automatically at session start, so an un-allowlisted command or missing dependency is reported before a run rather than discovered three waves in.

## Requirements

### Requirement: SessionStart SHALL run the preflight and report

A `SessionStart` hook SHALL invoke `interlock doctor` and surface its failures to the session as advisory output. The hook SHALL NOT block or abort the session — `interlock doctor` is non-mutating and the preflight is guidance, not a gate on whether the human may work.

#### Scenario: Happy path — clean preflight is quiet or confirming
- **GIVEN** a host whose allowlist, Node version, OpenSpec CLI, and run-state directories all pass `interlock doctor`
- **WHEN** a session starts
- **THEN** the hook runs the preflight and the session proceeds
- **AND** surfaces at most a brief confirmation, not a wall of output

#### Scenario: Failure — a failing check is surfaced with its fix
- **GIVEN** an allowlist missing `Bash(npm test:*)`
- **WHEN** a session starts and the hook runs `interlock doctor`
- **THEN** the session receives the failing check and the `fix` string the doctor already emits
- **AND** the session still starts, so the human can apply the fix and continue

#### Scenario: Edge case — interlock binary not on PATH
- **GIVEN** a session where the `interlock` binary cannot be resolved
- **WHEN** the SessionStart hook attempts the preflight
- **THEN** the hook reports that the preflight could not run and why
- **AND** does not abort the session on the absence of its own tool

### Requirement: The preflight's required-command set SHALL cover what the run literally instructs and the host does not auto-approve

The required-command set the preflight checks against the allowlist SHALL include every shell command the run's drivers and briefings literally instruct an agent to run and that the host does not auto-approve as read-only. A test SHALL derive the set of literal commands from the driver and briefing text and fail, naming the file and the command, when one is covered neither by the required set, nor by the project's test profile, nor by a published list of the host's auto-approved read-only commands. A second test SHALL assert that this repository's own project settings cover the derived required set, using the preflight's own matcher against the checked-in files rather than the developer's machine.

#### Scenario: Happy path — the environment probe's commands are required

- **GIVEN** the driver's environment probe instructs `test -f …`, `printenv …` and creating a working directory
- **WHEN** the preflight derives its required set
- **THEN** `test`, `printenv` and `mkdir` are required, each with a reason
- **AND** an allowlist without them reports `permissions: fail` with a fix naming `Bash(test:*)`, `Bash(printenv:*)` and `Bash(mkdir:*)`

#### Scenario: Edge case — a command the host auto-approves is not required

- **GIVEN** a briefing that instructs `echo $PPID` and one that instructs `pwd`
- **WHEN** the drift test runs
- **THEN** neither `echo` nor `pwd` is required, because both are in the published read-only list
- **AND** the list carries the date it was checked against the host's documentation

#### Scenario: Failure — a briefing gains a command nobody allowlisted

- **GIVEN** a briefing text that instructs `chmod +x …`, supplied to the command extractor as a fixture
- **WHEN** the drift test runs
- **THEN** the extractor reports `chmod`, and the coverage assertion fails naming the briefing and `chmod`
- **AND** a backticked span that is not a command (a field name, a placeholder) is not reported

#### Scenario: Happy path — this repository covers its own required set

- **GIVEN** the checked-in `.claude/settings.json`, and this repository's runner commands `npm test` and `node --test` named explicitly because the test profile is not versioned
- **WHEN** the repo-fact test runs the matcher over them
- **THEN** every required command and both runner commands have a covering allow rule
- **AND** the test does not read the developer's user settings, managed settings, or any gitignored file it cannot rely on being present

### Requirement: The preflight SHALL report whether push is configured, as advice

`interlock doctor` SHALL carry a `notify` row: `ok` when a push topic is configured, `skip` when it is not, with the detail naming the environment variable and stating that an unattended run stops silently without it. The row SHALL never be `fail`, because push is optional, and the row SHALL never print the topic value.

#### Scenario: Happy path — configured

- **GIVEN** `INTERLOCK_NTFY_TOPIC` is set
- **WHEN** `interlock doctor` runs
- **THEN** the `notify` row is `ok` and names the server that will be used
- **AND** the topic value does not appear anywhere in the report

#### Scenario: Edge case — unconfigured

- **GIVEN** `INTERLOCK_NTFY_TOPIC` is unset
- **WHEN** `interlock doctor` runs
- **THEN** the `notify` row is `skip`, its detail names `INTERLOCK_NTFY_TOPIC`, and the report's overall verdict is unaffected

### Requirement: The preflight SHALL report prompt-cache lifetime configuration, as advice

`interlock doctor` SHALL carry a `prompt-cache` row reporting whether the host's two prompt-cache lifetime settings are configured: the one governing the main conversation and the one governing subagents and workflows. The row SHALL name both settings keys and SHALL state which of the two governs the wave agents a ship run spawns, because they are different keys with different defaults and setting only one leaves the other on its default.

The row SHALL be `ok` when both are configured and `skip` when either is not, and SHALL never be `fail`. Prompt-cache lifetime is the operator's setting in the operator's own file; Interlock cannot set it, and a run works without it. The detail SHALL name the minimum host version below which the settings are silently ignored, because an operator who sets a key on an older host gets no error and no effect.

#### Scenario: Happy path — both lifetimes configured

- **GIVEN** both prompt-cache lifetime settings are configured in a settings scope the host reads
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row is `ok`
- **AND** the report's overall verdict is unaffected

#### Scenario: Failure — an unset lifetime is advice, never a failing check

- **GIVEN** neither prompt-cache lifetime setting appears in any settings scope
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row is `skip`
- **AND** the row is not `fail`
- **AND** the report's overall verdict and exit code are unaffected

#### Scenario: Edge case — a lifetime set in any readable scope counts as configured

- **GIVEN** the subagent lifetime is set in one settings scope and absent from the others
- **WHEN** `interlock doctor` runs
- **THEN** that setting is reported as configured
- **AND** no scope's value is printed as a recommendation over another's

### Requirement: The prompt-cache row SHALL report configuration, never an effective lifetime

The host exposes no effective prompt-cache lifetime to a hook, a script, or any command's output. The row SHALL therefore report only what the settings files and environment state, and SHALL NOT assert what lifetime a session is actually running under. It SHALL name the detected authentication mode where that mode changes the default lifetime, so an operator can tell whether a default they are relying on applies to them.

Reporting an unverifiable effective lifetime would be a fabricated measurement, which is the failure this requirement exists to prevent.

#### Scenario: Happy path — the row states what is configured and what mode was detected

- **GIVEN** a session whose authentication mode is detectable
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row names the detected authentication mode
- **AND** it does not claim what lifetime the current session's requests are receiving

#### Scenario: Failure — no effective lifetime is asserted

- **GIVEN** neither lifetime setting is configured
- **WHEN** `interlock doctor` runs
- **THEN** the row does not state that any particular lifetime is in force
- **AND** it states only that the settings are unset and what the host's documented defaults depend on

#### Scenario: Edge case — an undetectable authentication mode is named as undetected

- **GIVEN** a session whose authentication mode cannot be determined from the environment
- **WHEN** `interlock doctor` runs
- **THEN** the row says the mode was not determined
- **AND** it does not guess a mode in order to name a default
