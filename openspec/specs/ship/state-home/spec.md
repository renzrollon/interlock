# ship/state-home Specification

## Purpose
Where a ship run keeps what it records when the working tree is a linked worktree: the append-only corpora go to the main checkout so the report reads them, the per-run working state stays where the run is, and every reader and writer says which home it used.

## Requirements

### Requirement: The state home SHALL be resolved from the working root, ignoring Interlock's own lane worktrees, falling back to the root with a spoken reason, and overridden only by an explicit setting

For a working root that is a linked worktree of a repository, the state home SHALL be that repository's main checkout, read from version control's common directory; for a main checkout it SHALL be the root itself. A root under Interlock's own lane-worktree directory SHALL resolve to itself and SHALL NOT be treated as a session worktree. When the repository cannot be read, version control is missing or times out, or the common directory has no working tree beside it, the state home SHALL be the root and the run SHALL banner `STATE HOME UNRESOLVED: <reason>`. An explicit state home given by flag or environment SHALL replace the resolved home. The resolution SHALL write nothing, SHALL compare real paths so a symlinked root and its target resolve alike, and SHALL record which surface the root is: `main`, `linked-worktree`, `lane-worktree` or `unknown`.

#### Scenario: Happy path — a linked worktree resolves to its main checkout

- **GIVEN** a repository at `/r` and a linked worktree of it at `/r/.claude/worktrees/w1`
- **WHEN** the state home is resolved for root `/r/.claude/worktrees/w1`
- **THEN** the home is `/r` and the surface is `linked-worktree`
- **AND** resolving for root `/r` gives home `/r` and surface `main`

#### Scenario: Failure — version control cannot answer

- **GIVEN** a root that is not inside a repository, or a `git` that fails or hangs past the probe's timeout
- **WHEN** the state home is resolved
- **THEN** the home is the root and the surface is `unknown`
- **AND** the run banners `STATE HOME UNRESOLVED` with the reason

#### Scenario: Edge case — a lane worktree, a bare common directory, a symlinked root and an explicit home

- **GIVEN** a root at `/r/.claude/ship/worktrees/wave-1/lane-a` that is a linked worktree, a linked worktree whose common directory belongs to a bare repository, a root reached through a symlink, and an explicit state home `/elsewhere`
- **WHEN** each is resolved
- **THEN** the lane root resolves to itself with surface `lane-worktree` and runs no version-control command
- **AND** the bare case falls back to its root with a reason naming the missing working tree
- **AND** the symlinked root resolves to the same home as its real path
- **AND** the explicit case records home `/elsewhere` while the surface still describes the root

### Requirement: Append-only corpora SHALL be written to and read from the state home, and per-run working state SHALL stay in the working root

The run trajectory, the outcome corpus, the review metrics, the resume cards, the interrupted-run notes and the autonomy ledger SHALL be written under the state home and read from it by every reader, including the report, the run-log commands, the outcome commands and the session-start preflight. The run manifest, the wave state, the briefings, the plan and its fingerprint, the review files, the spill, the verify timings, the lane worktrees, the stage marker, the launch ledger and the agent-usage sidecar SHALL stay in the working root. A run SHALL resolve its state home once at start and record it on the manifest, every later step of that run SHALL use the recorded home, and a manifest without a recorded home SHALL use the working root. Two concurrent runs in two worktrees of one repository SHALL therefore never share a cursor, a marker or a ledger, and SHALL share only append-only files.

#### Scenario: Happy path — a linked-worktree run lands its records in the main checkout

- **GIVEN** a run started in a linked worktree of `/r`
- **WHEN** the run halts
- **THEN** its trajectory, its outcome line, its review metrics and its resume card exist under `/r/.claude/`
- **AND** its manifest, wave state and stage marker exist under the worktree's `.claude/ship/` and not under `/r/.claude/ship/`

#### Scenario: Failure — a run whose manifest predates the recorded home

- **GIVEN** a manifest written without a recorded state home
- **WHEN** a later step of that run appends to the trajectory
- **THEN** the append goes under the working root, as it did before

#### Scenario: Edge case — two runs in two worktrees append to one corpus

- **GIVEN** two linked worktrees of `/r` each running a ship at once
- **WHEN** both close
- **THEN** `/r/.claude/learning/outcomes.jsonl` holds one intact line per run and no torn record
- **AND** each worktree holds its own manifest and marker

### Requirement: The test profile and the graph SHALL be read through from the state home when the working root has none, with a banner, and SHALL never be written there by the run

At run start the run SHALL locate the test profile in the working root first and the state home second, record the path it found and where, banner `TEST PROFILE FROM MAIN CHECKOUT: <path>` on a read-through and the existing no-profile line when neither has one, and every reader of the profile in that run, including the test-edit guard when the working root has no profile, SHALL read the recorded path. The run SHALL locate the graph the same way, banner `GRAPH FROM MAIN CHECKOUT: <path>` saying it may be stale for this worktree and that a lane without a graph falls back to grep, or the existing graph-unavailable line, and the graph query command SHALL answer from the state home's graph when the root has none, saying so on its error stream. The drivers SHALL NOT probe either file. Nothing SHALL copy or write either file into the state home.

#### Scenario: Happy path — a worktree without a profile reads the main checkout's

- **GIVEN** a linked worktree with no `.claude/testing/profile.json` and a main checkout that has one
- **WHEN** the run starts and reaches its verify step
- **THEN** the start step carries `TEST PROFILE FROM MAIN CHECKOUT: <path>`
- **AND** the verify plan is built from the main checkout's profile, and the main checkout's file is unchanged

#### Scenario: Failure — neither root has a profile or a graph

- **GIVEN** a linked worktree and a main checkout with no profile and no graph
- **WHEN** the run starts
- **THEN** the start step carries the no-profile line and the graph-unavailable line, raised by the run program and not by a driver

#### Scenario: Edge case — the worktree has its own copy

- **GIVEN** a linked worktree with its own profile and graph and a main checkout with older ones
- **WHEN** the run starts and a lane queries the graph
- **THEN** the worktree's profile and graph are used and no read-through banner is raised

### Requirement: A run SHALL record its surface and state home on the manifest, the opening trajectory event and the receipt, and SHALL name the state home wherever it names the working directory

The run manifest, the `run-start` event and the receipt SHALL carry the surface and the state home; the `run-start` event SHALL also carry the working directory, so a reader in the main checkout can find a worktree run's spill and marker. The close summary SHALL print a `state home: <path>` row directly under the `cwd:` row whenever the two differ, and no such row when they are equal. A linked-worktree run SHALL note at start that its corpora are written to the main checkout, naming it.

#### Scenario: Happy path — a linked-worktree run names both directories

- **GIVEN** a run in a linked worktree of `/r`
- **WHEN** it closes
- **THEN** the summary carries `cwd: /r/.claude/worktrees/w1` and `state home: /r`
- **AND** the receipt and the `run-start` event carry surface `linked-worktree` and state home `/r`

#### Scenario: Failure — an unresolved home is still recorded honestly

- **GIVEN** a run whose state home could not be resolved
- **WHEN** it closes
- **THEN** the receipt carries surface `unknown` and the state home equal to the working root
- **AND** the summary carries `STATE HOME UNRESOLVED` among its degradations

#### Scenario: Edge case — a main-checkout run prints exactly what it printed before

- **GIVEN** a run in a main checkout
- **WHEN** it closes
- **THEN** the summary carries no `state home:` row and no new note
- **AND** every path it wrote is the path a run wrote before this capability existed

### Requirement: Corpus-loss semantics SHALL be unchanged by the home, and the suite SHALL guard the home

A failed trajectory append under the state home SHALL halt the step or make the close exit non-zero exactly as a failed append under the root does; a failed outcome, metrics, resume-card, interrupted-note or autonomy write under the state home SHALL be reported and SHALL NOT change the exit code. The test suite's corpus-isolation guard SHALL snapshot the corpora under the repository and, when the repository is itself a linked worktree, under its resolved state home, so a test that reaches the binary unpinned fails whichever side it wrote to.

#### Scenario: Happy path — the fatal class is fatal in the home

- **GIVEN** a linked-worktree run whose main checkout's runs directory becomes unwritable
- **WHEN** a record path appends to the trajectory
- **THEN** the step halts naming the append, as it would under the root

#### Scenario: Failure — the outcome class only reports in the home

- **GIVEN** a linked-worktree run whose main checkout's learning directory cannot be created
- **WHEN** the run closes
- **THEN** the close reports the outcome write failure and its exit code is unchanged

#### Scenario: Edge case — the suite run from a worktree

- **GIVEN** the repository's test suite run from a linked worktree of it
- **WHEN** a test spawns the binary without a pinned root
- **THEN** the isolation guard fails, naming the corpus file created under the main checkout

### Requirement: A missing manifest SHALL be named beside the state home's manifest when one exists there

When a `run` subcommand finds no manifest in the working root, and the resolved state home differs from the root and holds a manifest, the halt SHALL name both paths and say that a session which moved into a worktree after run start continues the run from the home. When the home holds none, the halt SHALL read as it does today.

#### Scenario: Happy path — a run continued from the wrong directory is told where it is

- **GIVEN** a manifest at `/r/.claude/ship/run.json` and a `run record-batch` invoked from `/r/.claude/worktrees/w1` with no manifest there
- **WHEN** the command runs
- **THEN** it halts naming both `/r/.claude/worktrees/w1/.claude/ship/run.json` and `/r/.claude/ship/run.json`

#### Scenario: Failure — no manifest anywhere

- **GIVEN** no manifest in the root or the home
- **WHEN** the command runs
- **THEN** it halts naming the root's manifest path alone, as before

#### Scenario: Edge case — the home cannot be resolved

- **GIVEN** no manifest in the root and a state home that falls back to the root
- **WHEN** the command runs
- **THEN** it halts naming the root's manifest path alone

### Requirement: The doctor SHALL name the resolved state home and SHALL probe each state directory where it now lives

`interlock doctor` SHALL carry a `state-home` row naming the home, the surface and, on a linked worktree, that corpora go to the home and the profile and graph are read from it; it SHALL report `skip` with the reason when the resolver fell back and never `fail`. The state-directory probe SHALL test the fatal and outcome-class directories under the home they belong to, so an unwritable main checkout is found from a worktree session before a run. The doctor's machine-readable output SHALL carry the resolved home so the preflight reads interrupted-run notes from it.

#### Scenario: Happy path — a worktree session's doctor names the main checkout

- **GIVEN** `interlock doctor` run in a linked worktree of `/r`
- **WHEN** the report is printed
- **THEN** its `state-home` row names `/r` and surface `linked-worktree`
- **AND** its state-directory row probed `/r/.claude/ship/runs` rather than the worktree's

#### Scenario: Failure — the fatal directory in the home is unwritable

- **GIVEN** a linked worktree whose main checkout's `.claude/ship/runs` is read-only
- **WHEN** the doctor runs
- **THEN** the state-directory row fails naming that path under the home

#### Scenario: Edge case — the resolver fell back

- **GIVEN** a root where version control cannot be read
- **WHEN** the doctor runs
- **THEN** the `state-home` row is `skip` with the reason, and the doctor's exit status is unchanged by it
