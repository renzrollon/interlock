## Purpose

Records what this repository's own fixtures cost across the Claude models and effort levels a later limits edit would have to choose between, without moving a gate, an effort default, or a lane floor.

## ADDED Requirements

### Requirement: The cost-per-task sweep is a separate run from the outcome eval

The sweep SHALL be a different command from the outcome eval. It SHALL NOT change the outcome eval's default model, SHALL NOT append to the outcome-eval history, and SHALL NOT be a mode flag on the outcome-eval runner. Importing the sweep's modules SHALL leave the outcome eval's default model and request shape as they were.

#### Scenario: Happy path — the outcome eval's default model survives the sweep's presence

- **GIVEN** the cost-per-task modules are loaded in the same process as the outcome eval
- **WHEN** the outcome eval resolves its model with no override
- **THEN** that model is still the outcome eval's own default
- **AND** an outcome-eval request that did not ask for an effort does not send one

#### Scenario: Failure — a matrix row cannot be written into the outcome history

- **GIVEN** a completed cost-per-task cell
- **WHEN** the sweep records it
- **THEN** the row is written to the cost-per-task record
- **AND** the outcome-eval history file is unchanged

#### Scenario: Edge case — the sweep and the outcome eval can both be imported without either taking the other's model

- **GIVEN** a process that imports both runners and sets no model override
- **WHEN** each resolves the model it would call
- **THEN** the outcome eval still resolves its single default
- **AND** the sweep resolves only the model of the cell it was asked to run

### Requirement: A cell is one fixture, one priced model, and one effort

The sweep SHALL run every fixture in the outcome-fixture set and no other task source. For each fixture it SHALL run one cell for each pair of model and effort in this grid: models `claude-opus-5-5` and `claude-sonnet-5-5`; efforts `low`, `medium`, `high`, and `xhigh`. It SHALL NOT add a Haiku cell or a `max` cell.

A model string the current price table does not contain SHALL NOT be called. The sweep SHALL record that cell as not run and SHALL name the table id in the reason. The model string comparison SHALL be exact.

Each cell SHALL run as one agent per fixture task, in task order, with that cell's model and that cell's effort, then the fixture's own graders. It SHALL NOT run the wave loop, the planner, or a verify step. The cell's effort SHALL be sent only on that cell's model requests.

The sweep SHALL execute each cell from a scratch root outside the repository under test and SHALL refuse a root inside it. Nothing the cell writes SHALL be copied back into the repository except the sweep's own result row.

#### Scenario: Happy path — one fixture produces eight cells and each request carries that cell's effort

- **GIVEN** the fixture set contains `docs-and-code` and the price table contains both grid models
- **WHEN** the sweep runs that fixture
- **THEN** it records eight cells, one for each pair of the two models and the four efforts
- **AND** each cell's model requests use that cell's model id and that cell's effort
- **AND** no cell runs a wave loop

#### Scenario: Failure — a model the table does not price is not called

- **GIVEN** a grid model that the current price table does not contain
- **WHEN** the sweep reaches that model
- **THEN** it makes no model request for those cells
- **AND** each such cell is recorded as not run with a reason that names the table id

#### Scenario: Edge case — a root inside the repository is refused, and a name that only resembles a grid model is not one

- **GIVEN** a requested scratch root that resolves inside the repository under test, and a model string `claude-opus-5-5 ` with a trailing space
- **WHEN** the sweep is asked to run
- **THEN** it refuses the root and states why, before any cell starts
- **AND** the trailing-space string is not treated as `claude-opus-5-5`

### Requirement: A cell records measured cost and a judge result without failing the process

Each cell that ran SHALL record: the fixture id, the API model id, the effort, the graders' pass or fail, input tokens, output tokens, cache-read tokens, cache-write tokens by lifetime tier, wall-clock duration, and either a dollar figure with the price-table id that produced it or a reason the figure is absent. Token counts the agent did not measure SHALL be absent, not zero. A measured zero SHALL stay zero.

The dollar figure SHALL be produced by the same pricing the outcome eval uses. The sweep SHALL NOT implement a second price table or a second conversion.

A cell whose graders fail SHALL be recorded as failed and SHALL NOT fail the process. A cell that could not be priced SHALL still record the judge result. The process SHALL fail only when the sweep itself cannot proceed: the scratch root was refused, or the result record could not be written.

#### Scenario: Happy path — a priced cell stores the judge result and the table id

- **GIVEN** a cell that ran, whose graders passed, and whose token counts include a cache read
- **WHEN** the sweep records the cell
- **THEN** the row contains the fixture id, `claude-opus-5-5` or `claude-sonnet-5-5`, the effort, a pass, the token counts, a dollar figure, and the price-table id
- **AND** the process exit is success

#### Scenario: Failure — a red grader is a field, and an unwritable record fails the process

- **GIVEN** a cell whose graders failed, and a later cell whose result record cannot be written
- **WHEN** the sweep handles each
- **THEN** the red cell is stored as a failure and the process is still successful after that cell alone
- **AND** the unwritable record fails the process, and that failure is distinct from the red grader

#### Scenario: Edge case — a measured zero cache read is priced, and an absent cache read is not

- **GIVEN** one cell whose cache-read count was measured as zero, and one whose cache-read count is absent
- **WHEN** both are recorded
- **THEN** the first row's dollar figure prices the cache read at zero and keeps the other measured terms
- **AND** the second row's dollar figure is absent with a reason, and its judge result is still present

### Requirement: The sweep is bounded and gates nothing

The sweep SHALL read its dollar ceiling from the published limits, and SHALL NOT restate that number in the runner, the workflow, or the docs. Before starting a cell it SHALL stop when the priced total of cells already recorded would meet or pass the ceiling. Cells not started SHALL be recorded as not run with the ceiling as the reason. A cell already started SHALL be allowed to finish. The sweep's result SHALL be partial when any cell was not started for that reason, and partial SHALL NOT be reported as a completed grid or as a failing suite.

The sweep SHALL NOT be triggered by a pull request. A result row SHALL NOT be a promotion trial, SHALL NOT change `EFFORT`, and SHALL NOT change the multi-task opus floor. The docs that describe the sweep SHALL name the limits command and SHALL NOT state the ceiling, the effort table, or the opus floor.

#### Scenario: Happy path — the ceiling is the published one, and a finished grid changes no dial

- **GIVEN** a sweep that prices under the ceiling for every cell
- **WHEN** it finishes
- **THEN** the ceiling it enforced is the one the published limits report for this sweep
- **AND** the effort table and the multi-task opus floor are unchanged
- **AND** the documentation of the sweep does not contain that ceiling

#### Scenario: Failure — a pull request does not start the sweep

- **GIVEN** a pull request that touches the sweep's files
- **WHEN** continuous integration runs
- **THEN** no cost-per-task cell is started

#### Scenario: Edge case — the next cell is not started once the priced total has reached the ceiling

- **GIVEN** recorded cells whose priced dollars have reached the published ceiling, and further cells not yet started
- **WHEN** the sweep considers the next cell
- **THEN** it does not start that cell
- **AND** the unstarted cells are recorded as not run because of the ceiling
- **AND** the sweep is partial, and no unstarted cell is recorded as a grader failure
