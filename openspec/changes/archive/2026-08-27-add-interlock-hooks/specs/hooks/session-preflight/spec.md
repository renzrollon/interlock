## Purpose

Fires the existing `interlock doctor` preflight automatically at session start, so an un-allowlisted command or missing dependency is reported before a run rather than discovered three waves in.

## ADDED Requirements

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
