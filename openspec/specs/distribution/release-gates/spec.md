# distribution/release-gates Specification

## Purpose

Defines what continuous integration and a scheduled canary prove about what users actually install: the packed tarball, the bundle on the `release` branch, an install over the previous release, the oldest supported engine, and the platforms the CLI runs on.

## Requirements

### Requirement: The installed tarball SHALL run every command the shipped surfaces call

Continuous integration SHALL pack the tarball, install it into a throwaway prefix and run, from that prefix, a smoke inventory. The inventory SHALL include every subcommand that a skill, the ship driver, the run program's steps or a hook calls. For each command it SHALL assert the exit code and the JSON keys the caller reads. The same inventory SHALL run against the repository's own binaries in the unit suite. A failure SHALL name the command and the assertion that failed.

#### Scenario: Happy path — every inventory command passes from the prefix

- **WHEN** the smoke runs against the installed prefix
- **THEN** every command exits with an expected code and carries the keys its caller reads

#### Scenario: Failure — a recovery command that does not run fails the gate

- **GIVEN** a CLI whose `tasks tick <change>` form reads the subcommand word as the change
- **WHEN** the smoke runs
- **THEN** it fails naming `tasks tick`

### Requirement: Every subcommand a shipped surface calls SHALL be in the smoke inventory

The test suite SHALL fail when a subcommand invoked by a skill, shared prose, an agent, the ship driver, the run program's argv, the resume card or a hook is absent from the smoke inventory. The failure SHALL name the subcommand and the file that calls it.

#### Scenario: Failure — a new skill line without smoke coverage

- **GIVEN** a skill that newly runs `interlock spec-audit --json`, and a smoke inventory without it
- **WHEN** the suite runs
- **THEN** it fails naming `spec-audit` and the skill file

### Requirement: Continuous integration SHALL install the release over the previous one before smoking it

A job SHALL perform these steps:

1. install the latest published release into a prefix and prove it runs;
2. install the packed tarball over the same prefix;
3. run the smoke inventory and the doctor from that prefix.

The job SHALL print the previous version it installed.

#### Scenario: Happy path — an over-install leaves a working prefix

- **WHEN** the job installs the tarball over the previous release
- **THEN** the smoke inventory passes from the prefix and the log names the previous version

### Requirement: A scheduled canary SHALL re-validate the shipped bundle under the newest engine

A workflow SHALL run on a daily schedule and on manual invocation, holding no write token. It SHALL:

- install the newest Claude Code;
- fetch the `release` branch;
- run the plugin's strict validation and its module tests against that bundle;
- run the doctor and the smoke inventory from binaries installed from that bundle.

The module tests, the smoke inventory and its fixtures SHALL come from the tag the bundle was cut from, not from the default branch. When the bundle predates a check, the canary SHALL skip that check and write the reason into the run summary. Its failure SHALL fail the scheduled run, which is the notification.

#### Scenario: Failure — an engine update breaks the shipped bundle between releases

- **GIVEN** a newly published engine under which the shipped bundle fails strict validation
- **WHEN** the canary next runs
- **THEN** the run fails naming the validation step

#### Scenario: Edge case — the default branch is ahead of the shipped bundle

- **GIVEN** the default branch has added a smoke inventory entry the shipped release does not have
- **WHEN** the canary next runs
- **THEN** it runs the shipped release's own inventory and passes

#### Scenario: Edge case — a bundle older than a check

- **GIVEN** a shipped bundle from before the doctor's `cli-version` row and the smoke script existed
- **WHEN** the canary runs
- **THEN** those two steps are skipped, with their reason in the run summary

### Requirement: The plugin SHALL be validated under the oldest engine the CLI supports, read from code

Plugin validation SHALL run under the newest engine and under the minimum engine version the CLI declares as a code constant. The workflow SHALL read that version from the constant and SHALL NOT spell a version itself. When a validation step does not exist at the floor engine, the floor run SHALL say so in its summary rather than pass silently.

#### Scenario: Happy path — the floor follows the constant

- **GIVEN** the declared minimum engine version is raised in code
- **WHEN** continuous integration next runs
- **THEN** the floor leg installs the new minimum with no edit to the workflow

### Requirement: The suite SHALL run on every supported and current Node major, and the smoke on macOS

The unit suite SHALL run on Node 18, 20, 22 and 24. The tarball smoke SHALL run on Linux and on macOS. Every check name the repository's required-checks ruleset names SHALL be reported by some job. A matrix whose legs report under suffixed names SHALL be gated by a job that reports the bare name. That gate SHALL run even when a leg fails, and SHALL pass only when every leg passed.

#### Scenario: Happy path — a macOS-only path defect is caught

- **GIVEN** a defect that appears only under macOS path resolution in an installed binary
- **WHEN** continuous integration runs
- **THEN** the macOS smoke fails

#### Scenario: Failure — a matrix renames a required check

- **GIVEN** a required check named `cli-smoke` and a matrix whose legs report as `cli-smoke (<os>)`
- **WHEN** no job reports the bare name
- **THEN** the suite fails naming `cli-smoke`
