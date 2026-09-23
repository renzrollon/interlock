## ADDED Requirements

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
