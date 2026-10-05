## ADDED Requirements

### Requirement: Run start SHALL locate the test profile and the graph through the state home, banner each outcome, and leave no driver probing them

At `run start` the run program SHALL locate the test profile in the working root first and in the state home second, record the path it found and its source on the manifest, and raise exactly one of: the read-through banner `TEST PROFILE FROM MAIN CHECKOUT: <path>`, the existing no-profile line, or nothing. It SHALL locate the graph the same way and raise exactly one of: `GRAPH FROM MAIN CHECKOUT: <path>` with the sentence that it may be stale for this worktree and that a lane without a graph falls back to grep, the existing graph-unavailable line, or nothing. Every later reader of the profile in that run SHALL read the recorded path. No host driver SHALL probe either file or raise either line: the Workflow driver's environment ping SHALL ask only for the effort override and SHALL create the working directory, and the no-policy sweep SHALL fail on a driver that names either banner.

#### Scenario: Happy path — a main checkout with both files raises nothing

- **GIVEN** a working root that holds a test profile and a built graph
- **WHEN** `run start` runs
- **THEN** the manifest records both paths with source `root`
- **AND** the start step carries neither a read-through banner nor a missing-input line

#### Scenario: Failure — neither the root nor the home has them

- **GIVEN** a linked worktree and a main checkout holding neither file
- **WHEN** `run start` runs
- **THEN** the start step carries the no-profile line and the graph-unavailable line
- **AND** the Workflow driver's source names neither line, which the sweep asserts

#### Scenario: Edge case — the root lacks them and the home has them

- **GIVEN** a linked worktree holding neither file and a main checkout holding both
- **WHEN** `run start` runs and a later verify step reads the profile
- **THEN** the start step carries `TEST PROFILE FROM MAIN CHECKOUT` and `GRAPH FROM MAIN CHECKOUT`
- **AND** the verify step builds its plan from the recorded path, and no file is written into the main checkout

### Requirement: Every run subcommand SHALL use the state home its manifest recorded, and a subcommand that finds no manifest SHALL name the home's manifest when one exists there

`run start` SHALL resolve the state home once, record it on the manifest with the surface, and every later `run` subcommand SHALL read corpora from and append corpora to that recorded home without resolving again; a manifest without a recorded home SHALL use the working root. When a `run` subcommand finds no manifest in the working root and the resolved home differs from the root and holds a manifest, the halt SHALL name both paths and say a session that moved into a worktree after run start continues the run from the home.

#### Scenario: Happy path — one home for the whole run

- **GIVEN** a run started in a linked worktree whose manifest recorded state home `/r`
- **WHEN** every later subcommand of the run executes, including the close
- **THEN** each appends to `/r/.claude/ship/runs/<runId>.jsonl` and none runs the resolver again

#### Scenario: Failure — a manifest without a recorded home

- **GIVEN** a manifest written before the home was recorded
- **WHEN** a later subcommand appends to the trajectory
- **THEN** the append goes under the working root

#### Scenario: Edge case — a subcommand run from a worktree whose manifest is in the home

- **GIVEN** a manifest at `/r/.claude/ship/run.json` and a `run record-batch` invoked from a linked worktree of `/r` holding no manifest
- **WHEN** the command runs
- **THEN** it halts naming both manifest paths and the sentence about a session that moved
