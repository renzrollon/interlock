## Purpose

Every PreToolUse guard allows on anything it cannot establish.

## Requirements

### Requirement: Every guard SHALL fail open

A guard that cannot establish the stage, resolve a path or read its profile MUST allow the tool call and never block it, so that installing the plugin does not break ordinary work.

#### Scenario: Happy path — an unknown stage allows

- **GIVEN** a session with no stage marker
- **WHEN** a guard runs
- **THEN** the tool call is allowed

### Requirement: A guard SHALL NOT block a commit outside a ship run

Outside a ship run no stage marker exists, so the commit guard SHALL NOT deny a commit on the grounds that the marker is absent.

#### Scenario: Failure — no marker, a commit

- **GIVEN** a repository with no ship run
- **WHEN** a commit is attempted
- **THEN** the commit guard allows it
