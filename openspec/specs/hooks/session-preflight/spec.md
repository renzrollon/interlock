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

### Requirement: The prompt-cache row SHALL report configuration and read no credential, never an effective lifetime

The `prompt-cache` row SHALL report only what the settings files state and SHALL NOT assert what lifetime a session is actually running under, because the host exposes no effective lifetime. It SHALL read no credential variable to determine an authentication mode, and SHALL say that the documented defaults depend on the host build and the authentication mode, which the report does not inspect.

#### Scenario: Happy path — the row reads no credential

- **GIVEN** a credential variable is set in the environment
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row names no authentication mode and no credential variable
- **AND** the variable's value appears nowhere in the report

#### Scenario: Failure — no effective lifetime is asserted

- **GIVEN** neither lifetime setting is configured
- **WHEN** `interlock doctor` runs
- **THEN** the row does not state that any particular lifetime is in force
- **AND** it states only that the settings are unset and what the host's documented defaults depend on

#### Scenario: Edge case — the uninspected mode is said, not guessed

- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row says the documented defaults depend on an authentication mode the report does not inspect
- **AND** it names no default as the one in force

### Requirement: The SessionStart hook process SHALL fail open, and SHALL be registered and tested as a process

The SessionStart preflight hook SHALL exit 0 on every path, including a clean doctor report, a doctor that reports failing checks, an unresolvable `interlock` binary, unparseable doctor output, and an unexpected throw inside the hook. It SHALL surface advisory context on those failure paths rather than aborting the session.

The plugin manifest SHALL register that hook as a SessionStart command. A test SHALL spawn the hook as a child process the way the host would, covering the clean, doctor-fail, and binary-missing paths, and SHALL assert the manifest still names that command. A dropped registration or a non-zero hook exit SHALL fail that test rather than leave the suite green.

#### Scenario: Happy path — clean doctor, hook exits 0 with a brief confirmation

- **GIVEN** a project root whose `interlock doctor` reports no failing checks
- **WHEN** the SessionStart hook is spawned as a child process with that cwd
- **THEN** the process exits 0
- **AND** its advisory output confirms the preflight rather than dumping a wall of output

#### Scenario: Failure — a failing doctor still exits 0 and names the failing check

- **GIVEN** a project root whose `interlock doctor` reports at least one failing check
- **WHEN** the SessionStart hook is spawned as a child process
- **THEN** the process exits 0
- **AND** the session-facing output names the failing check and the doctor's fix string
- **AND** the session is not aborted

#### Scenario: Edge case — missing binary, unparseable output, or an internal throw still exits 0

- **GIVEN** a session where the `interlock` binary cannot be resolved, or the doctor prints non-JSON, or the hook body throws
- **WHEN** the SessionStart hook runs
- **THEN** the process exits 0
- **AND** it reports that the preflight could not run, or that output could not be parsed, or that an internal error was ignored
- **AND** a test that the plugin manifest's SessionStart command still points at this hook fails if that registration is dropped

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

The SessionStart hook SHALL read the interrupted-run notes in the project root and, for each not yet spoken, SHALL add `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` to its advisory output and SHALL mark that note spoken at the same session start, because a session start now reaches the person as well as the model and a note nobody clears must not be said at every session start. A note that cannot be marked SHALL be said so in the report file and SHALL be spoken again at the next session start and the next run start, which is the direction to fail in. The run program's own marking at run start is unchanged, so a note no session start preceded is still spoken there. A note that cannot be read SHALL be named as unreadable. The hook SHALL exit 0 on every path, and a root with no notes SHALL produce the advisory output it produces today.

#### Scenario: Happy path — an unspoken note is surfaced at session start

- **GIVEN** an unspoken note for run `r-1` of change `add-foo` at stage `verify`
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output contains `PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify`
- **AND** the note on disk now carries a spoken time, and the report file records the note with its banner line and its mark as landed
- **AND** a second session start speaks it no more and the report file then records no note

#### Scenario: Failure — an unreadable note is named and the session starts

- **GIVEN** a note file that is not valid JSON
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output says a note could not be read and names the file
- **AND** the hook exits 0

#### Scenario: Failure — a note that cannot be marked is spoken again

- **GIVEN** an unspoken note on a filesystem the hook cannot write
- **WHEN** the SessionStart hook runs twice
- **THEN** the banner is in the advisory output both times
- **AND** the report file records the note with its mark as not landed and the reason, and the hook exits 0 both times

#### Scenario: Edge case — no notes leaves the preflight's output unchanged

- **GIVEN** a root with no `.claude/ship/interrupted/` directory
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output is exactly the preflight's existing confirmation or failure report
- **AND** no notes directory is created

### Requirement: The preflight SHALL report the state home and probe each state directory where it lives

`interlock doctor` SHALL carry a `state-home` row naming the resolved home and the surface, saying on a linked worktree that corpora are written to the home and that the test profile and graph are read from it when the root has none, and reporting `skip` with the reason when the resolver fell back, never `fail`. The state-directory row SHALL probe each directory under the home it belongs to: the trajectory, learning, metrics, handoff and interrupted-note directories under the state home, and the spill and agent-usage directories under the root, where the run writes them. The doctor's machine-readable output SHALL carry the resolved home.

#### Scenario: Happy path — a worktree session

- **GIVEN** the doctor run in a linked worktree of `/r`
- **WHEN** the report is printed
- **THEN** the `state-home` row names `/r` and `linked-worktree`
- **AND** the state-directory row's evidence names `/r/.claude/ship/runs` and the worktree's `.claude/ship/agent-usage`

#### Scenario: Failure — the home's fatal directory is unwritable

- **GIVEN** a main checkout whose `.claude/ship/runs` is read-only and a doctor run from its linked worktree
- **WHEN** the report is printed
- **THEN** the state-directory row fails naming that path, because a failed append there ends a run

#### Scenario: Edge case — the resolver fell back

- **GIVEN** a root where version control cannot be read
- **WHEN** the doctor runs
- **THEN** the `state-home` row is `skip` with the reason and the JSON carries the root as the home

### Requirement: The SessionStart preflight SHALL read interrupted-run notes from the state home the doctor resolved

The preflight SHALL read the home from the doctor's machine-readable output and surface unspoken interrupted-run notes from that home's notes directory, marking each note it speaks in the directory it was read from, so a worktree session reports the notes a worktree run left in the main checkout and marks them there. When the doctor's output carries no home the preflight SHALL read from the working directory as before. A run whose note is in both places SHALL be spoken once and marked in both.

#### Scenario: Happy path — a note in the main checkout is surfaced in the worktree

- **GIVEN** an unspoken note under `/r/.claude/ship/interrupted/` and a session starting in a linked worktree of `/r`
- **WHEN** the preflight runs
- **THEN** its output carries the note's line and the note under `/r` now carries a spoken time
- **AND** the report file under the worktree records the note and names `/r` as the state home

#### Scenario: Failure — the doctor could not run

- **GIVEN** a preflight whose doctor invocation produced no readable output
- **WHEN** the preflight runs
- **THEN** it reads notes from the working directory, marks the ones it speaks there, says the preflight could not run, and exits 0

#### Scenario: Edge case — a note in the worktree itself

- **GIVEN** a note written under the worktree's own `.claude/ship/interrupted/` by a run whose manifest recorded no home
- **WHEN** the preflight runs in that worktree with the doctor resolving `/r`
- **THEN** the note under `/r` is read and the worktree's own note is read too, so neither is lost
- **AND** a run whose note is in both is spoken once and both notes carry a spoken time afterwards

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

### Requirement: The SessionStart preflight SHALL leave this session's report in one schema-stamped file

In a project where a ship run can start, which is one whose working root holds an `openspec/` directory, the SessionStart hook SHALL write the report it computed to `.claude/ship/preflight.json` under the working root, as one JSON object stamped `interlock.preflight/1`, carrying: the time it was written; the session-start source the host named in its event, or null; the working root; the state home and surface the doctor resolved, or null when the doctor could not run; the advisory message the hook folded into the session, verbatim; whether the doctor ran and could be parsed, its overall verdict, its counts, and for every check its id, status, detail and fix; the interrupted-run notes the hook spoke at this session start, each with its banner line and whether its mark landed; the notes it could not read; and the halt resume cards it listed. In any other repository the hook SHALL write nothing and create no directory, and its advisory output SHALL be what it is today. The file is session-shaped working state, not a corpus: it SHALL be written whole, the previous session's file SHALL be removed before the new one is written so a failed write leaves no stale report, and a write that fails SHALL be one line on the hook's error stream with the hook still exiting 0 and still emitting its advisory output. The hook SHALL start no process for the write and SHALL NOT touch the run trajectory.

#### Scenario: Happy path — an OpenSpec project gets this session's report

- **GIVEN** a working root with an `openspec/` directory and a doctor reporting one warning and no failure
- **WHEN** the SessionStart hook runs
- **THEN** `.claude/ship/preflight.json` exists under the working root, stamped `interlock.preflight/1`, carrying the message `interlock preflight OK (1 warning).`, the doctor's verdict and counts, and the warning check's id, status and detail
- **AND** the hook's advisory output is unchanged and the process exits 0

#### Scenario: Failure — the file cannot be written

- **GIVEN** an OpenSpec project whose `.claude/ship/` cannot be created or written
- **WHEN** the SessionStart hook runs
- **THEN** the hook names the failed write and its reason on its error stream
- **AND** it exits 0 and its advisory output still carries the preflight's verdict
- **AND** no earlier session's file is left in place for the write that failed

#### Scenario: Edge case — a repository with no OpenSpec project writes nothing

- **GIVEN** a working root with no `openspec/` directory
- **WHEN** the SessionStart hook runs
- **THEN** no `.claude/ship/preflight.json` exists and no directory was created
- **AND** the advisory output is exactly what the hook emits today for that root

#### Scenario: Edge case — a doctor that could not run is still reported in the file

- **GIVEN** an OpenSpec project in which the `interlock` binary cannot be resolved
- **WHEN** the SessionStart hook runs
- **THEN** the file is written with the doctor marked as not run, no checks, a null state home, and the message saying the preflight could not run
- **AND** the hook exits 0

### Requirement: The SessionStart preflight SHALL list the halt resume cards of open changes

The SessionStart hook SHALL list the halt resume cards under the handoff directory of the state home the doctor resolved and, when the working root differs from it, under the working root's handoff directory too, reading each card's first-line stamp for its change and run id. A card whose change still has a directory under the working root's `openspec/changes/` SHALL be recorded in the report file with its absolute path, change, run id and modification time; the cards of changes no longer under `openspec/changes/` SHALL be counted, not listed; a file in the handoff directory without a readable card stamp SHALL be named as unreadable with its reason. A card is a record and never a trigger: the hook SHALL NOT read past the stamp, SHALL NOT mark, move or delete a card, and SHALL NOT change its advisory output on account of a card. An absent handoff directory is no cards and no error.

#### Scenario: Happy path — one open change has a card

- **GIVEN** a state home whose `.claude/handoff/` holds `ship-add-foo-r-1.md` stamped `interlock.resume-card/1 change=add-foo run=r-1`, and `openspec/changes/add-foo/` in the working root
- **WHEN** the SessionStart hook runs
- **THEN** the report file lists one card with that path, change `add-foo`, run `r-1` and the file's modification time
- **AND** the card's content is unchanged and the advisory output does not mention it

#### Scenario: Failure — a card without a readable stamp is named

- **GIVEN** a handoff directory holding `ship-x-y.md` whose first line is not a card stamp
- **WHEN** the SessionStart hook runs
- **THEN** the report file names that file as unreadable with the reason
- **AND** the hook exits 0

#### Scenario: Edge case — an archived change's card is counted, not listed

- **GIVEN** a card for change `old-thing` and no `openspec/changes/old-thing/` directory
- **WHEN** the SessionStart hook runs
- **THEN** the report file lists no card for `old-thing` and counts one card of an archived change
- **AND** a root with no handoff directory lists no card, counts none and creates nothing

### Requirement: The preflight SHALL name a CLI whose version differs from the plugin's

The doctor SHALL resolve the `interlock` binary the session's `PATH` serves to its real path, and read that binary's version from its own package or by asking it. It SHALL then compare the version with the version of the plugin the doctor belongs to, and report:

- **an older version, or a binary that cannot report one:** a failing row reading `CLI VERSION SKEW: interlock on PATH is <x> (<path>), plugin is <y>`, with a fix naming the command that installs the plugin's version;
- **a newer version:** an advisory row;
- **equal versions:** a passing row.

The resolved path and both versions SHALL be carried in the row's evidence and SHALL be written into the session's preflight file. The hook SHALL still exit 0.

#### Scenario: Failure — an npm copy one release behind the plugin

- **GIVEN** a plugin at `1.8.0` and an `interlock` on `PATH` that resolves to a `1.7.0` npm install
- **WHEN** the session starts
- **THEN** the session receives `CLI VERSION SKEW: interlock on PATH is 1.7.0 (<path>), plugin is 1.8.0` with the install command as its fix
- **AND** the preflight file records the path and both versions

#### Scenario: Edge case — a binary too old to report its version

- **GIVEN** an `interlock` on `PATH` that answers `--version` with `Unknown command`
- **WHEN** the doctor runs
- **THEN** the row fails and says the binary predates version reporting

#### Scenario: Happy path — the plugin's own binary

- **GIVEN** the only `interlock` on `PATH` is the plugin's own
- **WHEN** the doctor runs
- **THEN** the row passes

### Requirement: The doctor's test-profile row SHALL apply the same validation a run applies

The doctor's test-profile row SHALL fail, naming the problem, for any profile the run's verification would reject. A profile the doctor passes SHALL NOT be rejected by a run's verification.

#### Scenario: Failure — a timeout written as a string

- **GIVEN** a test profile whose unit timeout is the string `"120000"`
- **WHEN** the doctor runs
- **THEN** the test-profile row fails naming the timeout field

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
