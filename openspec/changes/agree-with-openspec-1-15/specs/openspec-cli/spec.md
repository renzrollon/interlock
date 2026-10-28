## ADDED Requirements

### Requirement: The doctor SHALL warn when the OpenSpec CLI is older than the published floor

`interlock doctor`'s `openspec` row SHALL compare the version the CLI prints against a floor that is a named constant in the doctor's code. A version below the floor SHALL make the row `warn`. The detail SHALL name the version found, the floor, and the fault that version has: below the first version that syncs nested delta specs, that they read "No deltas found" and archive without syncing; from that version up to the floor, that `validate` passes a change whose MODIFIED block drops a scenario, which `archive` refuses. The fix SHALL be the doctor's own install command. A floor miss SHALL NOT make the row `fail`.

#### Scenario: Happy path — a CLI at or above the floor is ok

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH whose version line carries a version at or above the floor
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `ok`
- **AND** its evidence carries the version line the CLI printed

#### Scenario: Failure — a CLI below the floor warns and names both versions

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH that prints `1.4.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`, not `fail`
- **AND** its detail names `1.4.0`, the floor constant's value, and nested delta specs
- **AND** its fix is the doctor's install command

#### Scenario: Edge case — a CLI that syncs nested deltas but sits below the floor names the validate fault

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH that prints `1.7.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`, not `fail`
- **AND** its detail names `1.7.0`, the floor constant's value, and that `validate` passes a change `archive` refuses
- **AND** its detail does not say nested deltas archive without syncing

#### Scenario: Edge case — a version line with no major.minor.patch is spoken, not passed

- **GIVEN** an `openspec` on PATH whose version probe prints a line with no `x.y.z` in it
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`
- **AND** its detail says the version could not be read and quotes the line

#### Scenario: Edge case — the not-initialised warning still wins its own case

- **GIVEN** an `openspec` on PATH at or above the floor, in a directory with no `openspec/config.yaml`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is the existing not-initialised `warn`, whose fix names `openspec init`

### Requirement: The task reader SHALL count every task line the OpenSpec CLI counts

The tasks.md reader in `lib/artifacts.mjs` SHALL treat a line as a task exactly when OpenSpec 1.15.0's task counter does: any CommonMark list marker, a box holding at most one non-space character, and any description. Only `x` or `X` in the box SHALL read as done. The tick and the plan fingerprint's normaliser SHALL rewrite the box the reader matched, never a fixed literal searched for in the line.

#### Scenario: Happy path — every list marker and box shape OpenSpec counts is a task

- **GIVEN** a tasks.md with one task each under `-`, `*`, `+`, `1.` and `1)`, a nested `  - [ ]` sub-task, and a `- [ ]` with no description
- **WHEN** the reader parses it
- **THEN** it returns one task per line, in document order, each open

#### Scenario: Failure — an unrecognised marker is open work, not a skipped line

- **GIVEN** a tasks.md whose only unchecked task is written `- [~] 2.1 wire the guard`, and every other task is `[x]`
- **WHEN** the change is inspected
- **THEN** the task total counts it and the remaining count is 1
- **AND** drift does not report the change as complete

#### Scenario: Edge case — the tick and the fingerprint rewrite the box they matched

- **GIVEN** a tasks.md with `+ [ ] 1.1 alpha`, `1. [~] 1.2 beta` and `- [ x ] 1.3 gamma`
- **WHEN** `tickTasks` ticks 1.1 and 1.2
- **THEN** the lines read `+ [x] 1.1 alpha` and `1. [x] 1.2 beta`, and 1.3 is reported already done
- **AND** normalising the ticked file rewrites every box to `[ ]` and leaves the rest of each line byte-identical

#### Scenario: Edge case — a link bullet is not a task

- **GIVEN** a tasks.md line `- [A](./notes.md)`
- **WHEN** the reader parses it
- **THEN** it returns no task for that line

### Requirement: The authoring skills SHALL name what `openspec validate` checks

The spec skill SHALL run `openspec validate` with the change's name, and bootstrap SHALL run `openspec validate --specs`. A bare `openspec validate` validates nothing and exits 1. The spec skill SHALL state that a `## MODIFIED` requirement keeps every scenario title its living spec holds. To drop or rename a scenario, the skill SHALL say to remove the requirement and add it back, because OpenSpec refuses to archive a MODIFIED block that omits a living scenario.

#### Scenario: Happy path — the spec skill validates the change it wrote

- **GIVEN** `skills/spec/SKILL.md`
- **WHEN** its fenced command lines are read
- **THEN** its validate step is `openspec validate "<name>"`
- **AND** no fenced line is a bare `openspec validate`

#### Scenario: Happy path — bootstrap validates the specs it wrote

- **GIVEN** `skills/bootstrap/SKILL.md`
- **WHEN** its fenced command lines are read
- **THEN** its validate step is `openspec validate --specs`

#### Scenario: Edge case — the scenario-title rule is pinned by token

- **GIVEN** `skills/spec/SKILL.md`
- **WHEN** the skills test reads it
- **THEN** it finds the tokens `MODIFIED`, `scenario title` and `REMOVED`
