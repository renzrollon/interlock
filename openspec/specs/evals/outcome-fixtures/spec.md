# evals/outcome-fixtures Specification

## Purpose

Defines the committed fixture repositories an outcome eval ships end to end — what makes one implementable, how each is proved solvable before a model is ever pointed at it, and the isolation rules that keep a fixture run from writing into the corpora of the repository that holds it.

## Requirements

### Requirement: A fixture is a self-contained repository holding an implementable change

Each outcome-eval fixture SHALL be a complete, minimal repository: source and tests runnable by the project's stdlib test runner with no install step, a testing profile naming the unit command, and one OpenSpec change whose artifacts are complete enough that the change validator accepts it as implementable. The fixture SHALL depend on nothing outside itself — no network, no package installation, and no file in the repository that carries it.

The change a fixture carries SHALL require more than one wave: at least one of its tasks SHALL depend on the output of an earlier task, so that a run which collapses the plan into a single sequential pass is distinguishable from one that did not.

#### Scenario: Happy path — the change validator accepts every fixture

- **WHEN** the change validator is run against each fixture's own change, from that fixture's root
- **THEN** it reports the change implementable for every fixture

#### Scenario: Failure — a fixture needing an install step is not a fixture

- **WHEN** a candidate fixture's unit command cannot run on a bare checkout without installing anything
- **THEN** it is rejected as a fixture rather than carried with an install step

#### Scenario: Edge case — a single-wave change is not sufficient

- **WHEN** a fixture's change has no task depending on an earlier task's output
- **THEN** the fixture does not satisfy this requirement, because the wave loop it exists to exercise would never be exercised

### Requirement: Every fixture carries a reference implementation that proves it solvable

Each fixture SHALL carry a known-correct reference implementation of its change, held separately from the starting state so that the starting state remains unimplemented. Applying the reference implementation to the fixture's starting state SHALL make that fixture's own suite green and tick every task the change declares.

A fixture whose reference implementation does not do both SHALL NOT be used, because a fixture nobody has solved cannot distinguish a loop that failed from a task that was impossible.

#### Scenario: Happy path — the reference implementation turns the fixture green

- **WHEN** the reference implementation is applied to a fixture's starting state and that fixture's unit command runs
- **THEN** the suite is green and every task the change declares is satisfied by the result

#### Scenario: Failure — an unsolvable fixture is rejected rather than recorded as a loop failure

- **WHEN** a fixture's reference implementation leaves its suite red
- **THEN** the fixture is not used for grading, and the condition is reported rather than attributed to whatever loop was under test

#### Scenario: Edge case — the starting state is not already solved

- **WHEN** a fixture's unit command is run against its starting state, before any implementation
- **THEN** the suite is not green, so a run that changed nothing cannot be graded as a success

### Requirement: The fixture set covers distinct change shapes

The fixture set SHALL contain more than one fixture, and the fixtures SHALL differ in shape rather than in content: one mixing documentation work with code, one in which a later task consumes an artifact an earlier task produces, and one whose suite stays red until one specific task lands. Each fixture SHALL state, in its own committed description, which shape it is and what a failure on it would mean.

#### Scenario: Happy path — each fixture names the shape it exercises

- **WHEN** a reader opens any fixture
- **THEN** its description names the shape it exercises and what a failure on it would indicate

#### Scenario: Failure — two fixtures of identical shape do not both count

- **WHEN** the set is inspected for coverage
- **THEN** fixtures of the same shape are counted once, because a second copy of one shape adds cost without adding signal

### Requirement: A fixture is never executed inside the repository that carries it

An outcome-eval run SHALL execute a fixture from a scratch root created outside the repository under test, and SHALL refuse to execute against any root located inside it. Every artefact a run produces — run state, trajectories, outcome records, work files, commits — SHALL land in that scratch root and SHALL NOT be copied back.

The committed fixture directories SHALL themselves hold no run state: no trajectory, no outcome corpus, and no ship work directory. Only the fixture's declared inputs are committed.

This exists because the repository's own corpora were once purged after exactly this kind of pollution, and a record written by a fixture is indistinguishable from a record written by a real run unless it never enters the corpus at all.

#### Scenario: Happy path — a completed run leaves the repository's corpora untouched

- **WHEN** an outcome eval runs every fixture to completion
- **THEN** the repository's own outcome corpus, trajectory directory and metrics directory hold exactly the records they held before the run

#### Scenario: Failure — a root inside the repository is refused

- **WHEN** a run is asked to execute a fixture against a root located inside the repository under test
- **THEN** it refuses and states why, rather than running and polluting the corpora

#### Scenario: Edge case — a fixture directory carrying run state is rejected

- **WHEN** a committed fixture directory is found to contain run state left behind by an earlier execution
- **THEN** that is reported as a defect in the fixture set rather than shipped as fixture input

### Requirement: Fixtures are not eval cases and are never discovered as one

A fixture SHALL NOT be discoverable as a model-facing eval case by any case discovery the project performs, and adding the fixture set SHALL NOT change the set of cases discovered. Fixture inputs SHALL NOT be placed where they would shadow a declared plugin component.

#### Scenario: Happy path — case discovery is unchanged by the fixture set

- **WHEN** case discovery runs before and after the fixture set exists
- **THEN** it finds the same cases both times

#### Scenario: Failure — a fixture shaped like a case is reported

- **WHEN** a fixture directory is found to carry the marker files that make a directory a case
- **THEN** the condition is reported as a defect rather than silently adding a case to the suite
