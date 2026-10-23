## Purpose

Guarantees that run state written by the previous release, and by the oldest committed run, either resumes under the current CLI or is refused with a reason that names what it found. Proves it against committed snapshots rather than by assertion.

## ADDED Requirements

### Requirement: A committed snapshot of the previous release's run state SHALL resume or be refused by name under the current CLI

The repository SHALL hold at least one snapshot of run state, written by a released CLI earlier than the current version and cut by a committed script. The script SHALL drive the released CLI through a start, a classification, a recorded batch and a halted close. The snapshot SHALL carry no absolute path from the machine that cut it.

The test suite SHALL place each snapshot in a fresh root and require two things:

- `run start` reuses the plan or rebuilds it under a named status;
- the run continues through a recorded batch to a closing receipt.

#### Scenario: Happy path — the previous release's halted run is restarted under a named status

- **GIVEN** the committed snapshot cut from the previous release
- **WHEN** the current CLI runs `run start` for its change
- **THEN** the step names whether the plan was reused or rebuilt, and why
- **AND** a later `run record-batch` and `run close` produce a receipt

#### Scenario: Failure — a snapshot that still holds a machine path fails

- **GIVEN** a snapshot file that contains the absolute scratch path it was cut in
- **WHEN** the suite runs
- **THEN** it fails naming the file

### Requirement: The oldest committed run SHALL be readable by the current CLI

The halted pre-1.0 run committed as a drawing fixture SHALL also be fed to the current CLI's `run start`, `wave-state next` and `run-log check`. The suite SHALL assert three outcomes: a rebuild named for its missing fingerprint, a `task-failures` halt from the wave state, and a reconstructable trajectory.

#### Scenario: Happy path — the 6e9d0b02 run

- **WHEN** the suite feeds the committed halted run to the current CLI
- **THEN** `run start` names the rebuild as `no-fingerprint`, `wave-state next` returns a halt for task failures, and `run-log check` passes

### Requirement: The current ship driver SHALL be exercised against the previous release's CLI where one is installed

When the environment names a previous release's `interlock` binary, the suite SHALL run the current ship driver against that binary. It SHALL assert that the run closes and that the close carries the unknown-CLI-version banner. When no such binary is named, the case SHALL skip with a reason saying where it runs.

#### Scenario: Edge case — the case outside the upgrade job

- **GIVEN** no previous-release binary is named in the environment
- **WHEN** the suite runs
- **THEN** the case is reported skipped with its reason, not passed
