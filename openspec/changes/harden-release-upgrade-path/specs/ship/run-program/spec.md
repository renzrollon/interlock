## ADDED Requirements

### Requirement: A run subcommand SHALL refuse a run that has already closed

Every `run` subcommand other than `run start` and `run close` SHALL halt when the run manifest records a halt or a completed close. The halt SHALL name the run id, say whether the run halted (with its reason) or closed, and say that `interlock run start` begins a new run. Such a refusal SHALL NOT append to the trajectory, SHALL NOT rewrite the last-step record, and SHALL NOT write any state, plan or briefing file.

#### Scenario: Failure — stepping a halted run

- **GIVEN** a manifest for run `R` that a close recorded as halted with reason `task-failures`
- **WHEN** `interlock run next --json` runs
- **THEN** it halts naming `R`, `halted` and `task-failures`, and the trajectory of `R` is byte-identical afterwards

#### Scenario: Happy path — a new run after a halt

- **GIVEN** the same halted manifest
- **WHEN** `interlock run start --change c --json` runs
- **THEN** a new run starts as before

### Requirement: A run manifest the CLI cannot read SHALL be named for what it is

When a `run` subcommand finds a manifest whose schema tag is not one this CLI reads, it SHALL halt naming:

- the file;
- the tag the file carries and the tag this CLI reads;
- the CLI's version;
- the remedy: close the run with the CLI that started it, or begin a new run.

It SHALL NOT say the subcommand was reached without `run start`. A manifest that exists and cannot be parsed SHALL be named as unreadable, not as absent. `run close` against a foreign manifest SHALL say the same, SHALL leave the manifest and any stage marker unchanged, and SHALL name the stage marker that still blocks a commit.

#### Scenario: Failure — a manifest from a newer CLI

- **GIVEN** `.claude/ship/run.json` carrying schema `interlock.run/2`
- **WHEN** `interlock run next --json` runs
- **THEN** the halt names `interlock.run/2`, `interlock.run/1` and the CLI's version
- **AND** the reason does not say `reached without interlock run start`

#### Scenario: Edge case — closing a foreign run

- **GIVEN** the same manifest and a stage marker for its change
- **WHEN** `interlock run close --halt x --json` runs
- **THEN** the close names the foreign tag and the stage marker's path, and both files are unchanged

### Requirement: Run start SHALL remove a classification left by an earlier run and say so

When the default classification file exists at `run start`, the start SHALL remove it and raise `STALE CLASSIFICATION REMOVED`, naming the file and when it was written. A classify step whose planner then writes nothing SHALL halt with the existing reason naming the unreadable classification.

#### Scenario: Failure — a planner that returns nothing over a leftover file

- **GIVEN** a `.claude/ship/classified.json` left by an earlier run
- **WHEN** a new run starts and its planner writes no classification
- **THEN** the start step carries `STALE CLASSIFICATION REMOVED`
- **AND** the classification step halts naming `.claude/ship/classified.json`, and no batch is dispatched from the old file

### Requirement: Run start SHALL name a rebuilt plan on the start step

When a stored plan existed and was not reused, `run start` SHALL raise `PLAN REBUILT (<status>): <reason>`. The banner SHALL say that tasks the earlier run finished but did not tick will be dispatched again. A first run with no stored plan and a reused plan SHALL raise no such banner. The closing summary's plan line SHALL be unchanged.

#### Scenario: Failure — a plan from an older format

- **GIVEN** a stored plan whose fingerprint records an earlier plan format
- **WHEN** `interlock run start --json` runs
- **THEN** the start step carries `PLAN REBUILT (plan-format-changed)`

#### Scenario: Edge case — a first run

- **GIVEN** no stored plan
- **WHEN** a run starts
- **THEN** the start step carries no `PLAN REBUILT` banner

### Requirement: The test profile SHALL be validated before a run starts and before a batch is recorded

`run start` SHALL halt, naming the profile's path and its first problem, when the test profile is present and invalid. `run record-batch` SHALL apply the same check before it changes the run state, the task list or the trajectory. A profile that became invalid mid-run SHALL therefore halt naming the profile, with nothing recorded for that batch.

#### Scenario: Failure — a profile edited mid-run

- **GIVEN** a running run whose test profile is edited so that its unit timeout is a string
- **WHEN** `interlock run record-batch --results r.json --json` runs
- **THEN** the step halts naming the profile and the timeout field
- **AND** no task is ticked, the run state is unchanged, and the next call is the close

### Requirement: A manifest field an earlier release did not write SHALL be defaulted out loud

When a `run` subcommand reads a manifest that lacks its inter-wave verify budget or its state home, it SHALL use the default it uses today. It SHALL raise `MANIFEST FIELD DEFAULTED` naming the field and the default, once per run per field.

#### Scenario: Failure — a manifest written before the verify budget existed

- **GIVEN** a running run whose manifest has no verify budget
- **WHEN** the next `run` subcommand reads it
- **THEN** the step carries `MANIFEST FIELD DEFAULTED` naming the verify budget and the default used
- **AND** later subcommands of the same run do not raise it again

### Requirement: Every run SHALL record the CLI and plugin that produced it, and SHALL banner a mismatch

The run manifest SHALL record the CLI's version and path, and the plugin's version and root when a plugin root was given. Every step SHALL carry the CLI's version, and the relay to the Workflow host SHALL carry it too. `run start` SHALL accept a plugin root. When the CLI's version differs from that plugin's version, it SHALL raise `CLI VERSION SKEW` naming both versions and paths.

The Workflow skill SHALL pass the plugin root to the driver, and the driver SHALL forward it to `run start`. When the start step carries no CLI version, the driver SHALL raise `CLI VERSION UNKNOWN` to the close. When `run start` cannot be read after its retry, the driver's halt reason SHALL suggest checking the CLI's version.

#### Scenario: Failure — the PATH CLI is a release behind the plugin

- **GIVEN** a plugin at `1.9.0` and a CLI at `1.8.0` that reports its version
- **WHEN** `/interlock:ship` starts a run
- **THEN** the start step carries `CLI VERSION SKEW` naming `1.8.0` and `1.9.0`
- **AND** the manifest records both

#### Scenario: Edge case — a CLI that predates version reporting

- **GIVEN** an `interlock` on PATH that emits steps without a CLI version
- **WHEN** the driver reads the start step
- **THEN** the close carries `CLI VERSION UNKNOWN`
