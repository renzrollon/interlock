## ADDED Requirements

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
