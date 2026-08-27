## Purpose

Gives the stateless `PreToolUse` guards a deterministic reading of the current ship stage, so a test edit during remediation is denied while the same edit during implementation is allowed — without either decision depending on a model's cooperation.

## ADDED Requirements

### Requirement: The ship run SHALL publish a stage marker readable by hooks

A ship run SHALL write a stage marker to a fixed path derived from the change name before entering each gated stage, so that a `PreToolUse` hook running in a separate process can determine the current stage without access to workflow state.

The marker SHALL record at minimum: the stage identifier (one of `implement`, `verify`, `review`, `remediation`, `commit`), the change name, and a monotonically ordered write index so a stale marker from a prior run is distinguishable from the current one.

#### Scenario: Happy path — stage marker written on transition
- **GIVEN** a ship run for change `add-foo` that has finished its implementation waves
- **WHEN** `workflows/ship.js` enters the remediation stage
- **THEN** the stage marker at the change-derived path records stage `remediation` and change `add-foo`
- **AND** a subsequent read of the marker by a hook returns stage `remediation`

#### Scenario: Failure — marker unwritable
- **GIVEN** the marker directory cannot be created or written (permission or disk error)
- **WHEN** the ship run attempts to publish the stage marker
- **THEN** the failure is recorded on the run trajectory as a non-fatal warning
- **AND** the run continues, since the marker is a guard input, not a gate the run itself depends on

#### Scenario: Edge case — stale marker from an abandoned prior run
- **GIVEN** a marker on disk whose write index predates the current run's first write
- **WHEN** a guard reads the marker during the current run
- **THEN** the guard treats the stage as unknown rather than trusting the stale stage
- **AND** applies its documented marker-absent behavior

### Requirement: The stage marker SHALL be cleared when a run ends

A ship run SHALL remove or invalidate the stage marker on any terminal outcome — commit, halt, or abort — so that a later editing session outside any ship run does not read a stage left behind by a completed run.

#### Scenario: Happy path — marker cleared on commit
- **GIVEN** a ship run that reaches the commit stage and commits
- **WHEN** the run closes
- **THEN** the stage marker is removed or marked ended
- **AND** a guard reading it afterward sees no active stage

#### Scenario: Failure — run halts mid-remediation
- **GIVEN** a ship run that halts during remediation
- **WHEN** the run reaches its halt terminal state
- **THEN** the stage marker is cleared as part of halt handling
- **AND** does not persist a `remediation` stage into the next session

#### Scenario: Edge case — process killed before cleanup
- **GIVEN** a marker left on disk because the run process was killed before it could clear the marker
- **WHEN** a guard reads that orphaned marker in a later session
- **THEN** the guard detects the marker is not backed by a live run via the write-index/staleness check and treats the stage as unknown

### Requirement: Guards SHALL fail open when the stage is unknown

When a guard cannot determine the current stage — marker absent, unreadable, malformed, or stale — the edit guards (`guard-tests`, `guard-tasks`) SHALL allow the tool call. Blocking every edit whenever the marker is missing would brick ordinary editing outside a ship run, a cost strictly larger than the guard's benefit. The commit guard's marker-absent behavior is defined in `hooks/tool-guards`.

#### Scenario: Happy path — editing outside a ship run
- **GIVEN** no active ship run and therefore no current stage marker
- **WHEN** a developer edits a test file directly
- **THEN** `guard-tests` allows the Edit
- **AND** does not emit a deny decision

#### Scenario: Failure — malformed marker
- **GIVEN** a stage marker whose contents are not parseable
- **WHEN** `guard-tests` reads it during a tool call
- **THEN** the guard treats the stage as unknown and allows the call
- **AND** records that the marker was unreadable

#### Scenario: Edge case — marker present but stage value unrecognized
- **GIVEN** a marker whose stage field holds a value outside the known set
- **WHEN** a guard reads it
- **THEN** the guard treats the stage as unknown rather than matching it to the nearest known stage
