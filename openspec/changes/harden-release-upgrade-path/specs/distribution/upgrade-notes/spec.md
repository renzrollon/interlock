## Purpose

Makes a release's breaking changes plannable for the people who upgrade: a breaking entry forces at least a minor version and carries upgrade instructions, and a user-facing page says what persists across versions.

## ADDED Requirements

### Requirement: A breaking CHANGELOG entry SHALL NOT ship in a patch release and SHALL carry an Upgrading subsection

For every released CHANGELOG section at version 1.8.0 or later, the suite SHALL fail when either holds:

- the section carries a breaking entry and its patch number is greater than zero;
- the section carries a breaking entry and has no `### Upgrading` subsection.

The unreleased section SHALL be held to the Upgrading rule only. Sections earlier than 1.8.0 SHALL NOT be judged. Versions SHALL be compared numerically.

#### Scenario: Failure — a breaking entry in a patch

- **GIVEN** a section `## [1.8.1]` with a bullet marked breaking
- **WHEN** the suite runs
- **THEN** it fails naming `1.8.1`

#### Scenario: Failure — a breaking entry without upgrade notes

- **GIVEN** an unreleased section with a breaking bullet and no `### Upgrading` subsection
- **WHEN** the suite runs
- **THEN** it fails naming the unreleased section

#### Scenario: Edge case — history is not rewritten

- **GIVEN** the 1.6.1 section, which carries a breaking bullet
- **WHEN** the suite runs
- **THEN** that section is not judged

### Requirement: The documentation SHALL say what an upgrade keeps and how to check both versions

A user-facing page SHALL state four things: what persists under the run-state and graph directories, what a resume across versions does, how to read the CLI and plugin versions in a session, and how to keep a separately installed CLI at the plugin's version. The installation instructions that recommend a separate CLI install SHALL point to it.

#### Scenario: Happy path — a user with an older npm copy finds the fix

- **GIVEN** a user whose session-start preflight reports a CLI version skew
- **WHEN** they open the upgrading page
- **THEN** it names the command that installs the CLI at the plugin's version
