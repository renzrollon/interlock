# ship/diagrams Specification

## Purpose

Draws what a ship run already records and nothing it does not: the wave plan as a board and as a Mermaid flowchart, and a run's handoff graph from its trajectory. Every node and edge is a fact the planner, the wave state or the trajectory wrote down, keyed the way those records key it — waves by position, lanes by the label their agents run under, events by sequence number — and every place a record does not force an attribution is said so in the drawing rather than guessed. The renderers compute no verdict, no threshold and no colour, read no file and no clock, and are shaped to be read by the CLI today and by the ship meter's pane tomorrow.

## Requirements

### Requirement: The wave board SHALL be keyed by wave position and SHALL name each lane as its agent is named

The wave board SHALL draw one bordered block per wave of a plan, in plan order, each labelled with the wave's position, its group number, its kind (`impl` or `test`), its batch count and, when the plan marks it so, a `RED` marker. Two waves that carry the same group number SHALL be two blocks, told apart by position: dependency layering emits a later layer under the same section number, and a board keyed by group would fold them into one.

Each lane SHALL be one row carrying the batch it runs in, the lane's title, the ids of its tasks, the model it dispatches on, its hardest tier, its effort (or the word for an inherited effort), the ids it was ordered after (from the plan's own deferral records, never recomputed from task fields) and, with an overlay, its state word. The lane's title SHALL be the same text its spawn carries as a title (`task 1.1 · <gist>`, or `tasks 1.1+2 · <gist>` for a lane of several tasks), built from the label its briefing file is named by and its trajectory line is keyed by — one naming rule, written once — so a reader can join a board row to a spawn, a briefing and a trajectory line by eye. A board row SHALL print the label in its own cell and the title's gist after the fixed cells, so the role word is not repeated on every row; a Mermaid node SHALL carry the title whole.

A row SHALL be composed at full length and then cut at the board's width with a visible ellipsis, the lane's title giving way first and the fixed fields last, so a narrow board loses words of prose before it loses an id, a model or a state word. The board SHALL end with a tail line naming the gates the run program reaches after the last wave.

#### Scenario: Happy path — a two-wave plan with a test wave draws three blocks and a tail

- **GIVEN** a plan with two implementation waves and a test wave, the second wave in five batches
- **WHEN** the board is drawn at a width at or above the published minimum
- **THEN** it holds three blocks in plan order, headed `wave 1 · idx 0`, `wave 2 · idx 1` and `test wave`, the second naming `5 batches`
- **AND** every lane row of the second wave starts with its batch, `b0` through `b4`
- **AND** a lane ordered after another carries `←` followed by the ids the plan's deferral record names
- **AND** the last line names the gates after the last wave: verify-final, commit and close

#### Scenario: Failure — a plan with no waves is still a board, not an exception

- **GIVEN** a plan object whose wave list is empty and whose test wave is absent
- **WHEN** the board is drawn
- **THEN** the header line states that the plan holds no waves
- **AND** no block and no lane row is drawn, and the tail line is still present
- **AND** the renderer returns lines rather than throwing

#### Scenario: Edge case — two waves sharing a group are two blocks

- **GIVEN** the stored plan of the real halted run, whose two implementation waves both carry `group: 1`
- **WHEN** the board is drawn
- **THEN** two blocks are drawn, headed `wave 1 · idx 0 · group 1` and `wave 2 · idx 1 · group 1`
- **AND** the five lanes of the first and the six of the second are in different blocks
- **AND** no block is headed by a group alone

#### Scenario: Edge case — a title longer than the width is cut after the fixed fields are kept

- **GIVEN** a lane whose title is longer than the width leaves for it
- **WHEN** the board is drawn at that width
- **THEN** the row ends in `…` and is exactly as wide as the board
- **AND** the row still carries the lane's model, tier, effort and state word in full

### Requirement: The overlay SHALL show only recorded facts and SHALL name each attribution the state does not force

When a wave state is laid over a plan, each task's state word SHALL come from the state and from nothing else: `ok` when the state lists the id as completed, `failed` when it lists it as a failure, `current` when the task's wave and batch are the cursor's, `pending` when they lie after the cursor in a run that has not halted, `not reached` when they lie after the cursor in a halted run, and `not recorded` when they lie before the cursor and the state lists the id nowhere. The cursor SHALL be placed by wave position, never by group.

A skipped verification is recorded by group. The verify cell between two waves SHALL show the recorded reason only when exactly one such boundary carries that group; when two waves share a group and the records do not cover both boundaries, the cell SHALL say which boundaries the state does not distinguish rather than place the record on one of them.

A failure whose id names no task in the plan SHALL be listed under the board, by the wave and kind the state recorded for it and with its recorded error or the statement that none was recorded. It SHALL NOT be dropped, and it SHALL NOT be placed on a lane.

An overlay whose wave count differs from the plan's SHALL be applied by task id only: state words still join, the cursor and the verify cells are not placed, and the header SHALL say so. A board drawn without an overlay SHALL say `plan only` in its header.

#### Scenario: Happy path — the real halted state overlays the real plan

- **GIVEN** the stored plan and state of the real halted run, with four completed ids, three failures, one skipped verification for group 1, a cursor at wave position 1 and a halt
- **WHEN** the board is drawn with the state as overlay
- **THEN** `1.7`, `1.4`, `1.2` and `1.3` read `ok`, `1.6` reads `not recorded`, `1.5` and `1.1` read `failed`
- **AND** the lanes in the batches after the cursor and the test wave's lanes read `not reached`
- **AND** the header names the cursor by position, and the tail carries the recorded halt reason

#### Scenario: Failure — a failure id that names no planned task is listed, never dropped

- **GIVEN** the real halted state, whose failures include `task-1.6-verify-settings` with no recorded error, an id no planned lane carries
- **WHEN** the board is drawn with that state as overlay
- **THEN** a line under the board names `task-1.6-verify-settings`, its recorded wave and kind, and states that no error was recorded
- **AND** no lane row carries that id

#### Scenario: Edge case — a skip recorded by group over two waves of that group

- **GIVEN** a plan whose two implementation waves both carry group 1, and a state recording one skipped verification for group 1
- **WHEN** the board is drawn with that state as overlay
- **THEN** the verify cell after the first wave reads that one skip is recorded for group 1 and that the state does not say which of the two boundaries it belongs to
- **AND** neither verify cell reads as a plain skip with that reason

#### Scenario: Edge case — an overlay with a different wave count is applied by id only

- **GIVEN** a plan with three waves and a state with two
- **WHEN** the board is drawn with that state as overlay
- **THEN** the header states the two counts and that the overlay is applied by task id only
- **AND** task ids the state lists as completed or failed still carry their state words
- **AND** no lane reads `current`, and no verify cell carries a skip

#### Scenario: Edge case — no overlay is a plan-only board

- **GIVEN** a plan and no state
- **WHEN** the board is drawn
- **THEN** the header carries `plan only`
- **AND** no lane row carries a state word

### Requirement: The Mermaid plan SHALL be generated from the plan, and the documented block SHALL be pinned to it

The Mermaid form of a plan SHALL be a `flowchart LR` whose first body line is a comment naming its source, with one subgraph per wave (and one per batch inside a wave of more than one batch), one node per lane, dotted edges labelled `dependsOn` from the plan's deferral records, a hexagon verify-gate node at each wave boundary and subroutine nodes for the final verification, the commit and the close. Node identifiers SHALL be derived from lane labels so the same plan renders to the same text, and two waves sharing a group SHALL be two subgraphs identified by position.

The repository's agentic-workflow document SHALL carry one such block, generated from a fixture plan, and a test SHALL re-render that fixture and compare the fence body for equality, so the documented diagram cannot drift as a hand-drawn one would.

#### Scenario: Happy path — the real plan renders to a flowchart with gates and dependsOn edges

- **GIVEN** the stored plan of the real halted run
- **WHEN** the Mermaid form is drawn
- **THEN** the first line is `flowchart LR` and the second is a `%% source:` comment
- **AND** there are subgraphs for wave positions 0 and 1 and for the test wave, the second wave holding one subgraph per batch
- **AND** the main chain runs wave 0, a verify gate, wave 1, a verify gate, the test wave, then verify-final, commit and close
- **AND** the deferral records appear as dotted edges labelled `dependsOn`, from each ordered-after id to the ordered id

#### Scenario: Failure — the documented block no longer matches the fixture

- **GIVEN** the documented Mermaid block edited by hand so one line differs from what the fixture renders to
- **WHEN** the pinning test runs
- **THEN** it fails naming the document and the first differing line
- **AND** it passes once the block is regenerated from the fixture

#### Scenario: Edge case — an overlay annotates nodes and adds no colour

- **GIVEN** a plan and a state as overlay
- **WHEN** the Mermaid form is drawn
- **THEN** each lane node's label ends with its state word
- **AND** the output carries no style, class or colour directive

### Requirement: The handoff graph SHALL be drawn from the trajectory in sequence order and SHALL state its two caveats

The handoff graph of a run SHALL be drawn from the run's trajectory records ordered by their sequence number, as a text board and as a `flowchart TD`: one node per CLI ping (a wave action joined to the CLI exit that followed it, carrying the exit code and the measured duration), one node per spawned agent labelled with its sequence number, edges from one wave to the next labelled with the source that produced the transition, the halt as its own node and the receipt as the last. A wave-to-wave edge SHALL carry each handoff packet's status and audit verdict, and each implementer node its briefing hash, when the run's own state and manifest are given and name the same run; a source that is absent or names another run SHALL be named as such in the header and not used.

The graph SHALL state two caveats where they apply: that implementer spawn times are the time the step was emitted, not the time the host started the agent; and, for each spawn with no recorded result, that its result is `not recorded`. A spawn without a result SHALL NOT be drawn as finished.

#### Scenario: Happy path — the real trajectory draws as a board and as a flowchart

- **GIVEN** the 26-record trajectory of the real halted run, with its state and no manifest
- **WHEN** the handoff graph is drawn
- **THEN** the header names the run, the change, the record count, `state.json: this run` and `run.json: absent`
- **AND** the nodes appear in sequence order: the ping that created the wave state, the run start, the ping that emitted wave position 0, five implementers, the record ping, the verify gate with its skip reason, the transition to wave position 1 labelled `record-verify` and carrying the four packets' statuses and verdicts, six implementers, the tick ping, the halt node with the recorded exit code and reason, and the receipt
- **AND** the Mermaid form is a `flowchart TD` opening with a `%% source:` comment

#### Scenario: Failure — a state or manifest naming another run is named and not joined

- **GIVEN** a trajectory for one run and a state whose run id is another's
- **WHEN** the handoff graph is drawn
- **THEN** the header reads `state.json: another run` with that run's id
- **AND** no edge carries a packet status and no lane carries ids from that state

#### Scenario: Edge case — a trajectory with no agent-result records says so on every spawn

- **GIVEN** the real trajectory, which predates the agent-result recorder
- **WHEN** the handoff graph is drawn
- **THEN** every implementer node reads `result: not recorded`
- **AND** the header states how many spawns have no recorded result
- **AND** the spawn-time caveat is stated once

#### Scenario: Edge case — records out of order or with a torn line draw in sequence order

- **GIVEN** trajectory records handed over in file order with one sequence number out of place
- **WHEN** the handoff graph is drawn
- **THEN** the nodes appear by sequence number, not by file order
- **AND** a record of a type the renderer does not draw is counted in the header and skipped

### Requirement: The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits

Both renderers SHALL take their inputs as objects and a width as a number, return an array of lines, and read nothing else: no file, no environment, no terminal, no clock, no module from the Node runtime and no module outside the plugin. The lane naming rule they share with the planner SHALL live in a module with the same closure, so the ship meter's hooks module can import the board without importing the planner.

The board's minimum and default widths SHALL be published by `interlock limits` as `wave board min width (columns)` and `wave board default width (columns)`, read from the limits module by the renderers and the CLI, and restated nowhere. Below the minimum the renderer SHALL return one spoken line naming the width given and the minimum, instead of a board.

#### Scenario: Happy path — the two widths are printed and read

- **WHEN** `interlock limits` runs
- **THEN** its output carries `wave board min width (columns)` and `wave board default width (columns)`, each with its value
- **AND** the board renderer and the CLI read both keys from the limits module

#### Scenario: Failure — a renderer that imports a Node module fails the purity pin

- **GIVEN** either renderer, or the lane module, edited to import a `node:` module or a file outside the plugin
- **WHEN** the purity test walks its import closure
- **THEN** the test fails naming the file and the specifier
- **AND** the walk it uses is the same one that pins the hooks module's closure

#### Scenario: Edge case — a width below the minimum is one spoken line

- **GIVEN** a plan and a width one column below the published minimum
- **WHEN** the board is drawn
- **THEN** the result is exactly one line
- **AND** it names the width given and the minimum, and no box-drawing character appears

### Requirement: The CLI SHALL expose both diagrams behind flags that leave every exit code as it is

`interlock waves` SHALL accept `--format board|mermaid`, `--plan <file>` (a stored plan to render instead of planning from `--classified`), `--state <file>` (an overlay) and `--columns <n>`. `interlock run-log show <runId>` SHALL accept `--format board|mermaid` and `--columns <n>`, reading the run's state and manifest from the state home beside the trajectory when they exist. `--format` SHALL be mutually exclusive with `--json`, an unknown format SHALL be a usage error, and `--state` or `--columns` without `--format` SHALL be a usage error, each exiting non-zero with a message naming the flag.

The width SHALL come from `--columns` when given, else from the terminal's reported width, else from the published default. A plan, state or trajectory file that does not exist SHALL be spoken on standard output — `no plan at <path>`, `no state at <path>` beside a plan-only board, or the existing line for a run never recorded — and SHALL exit 0, as `run-log show` does today for a run that was never recorded. The text and JSON outputs of `interlock waves` and `interlock run-log show` without `--format` SHALL be unchanged.

#### Scenario: Happy path — a stored plan and state draw as a board at a chosen width

- **GIVEN** the fixture plan and state copied to a scratch directory
- **WHEN** `interlock waves --plan <plan> --state <state> --format board --columns 80` runs
- **THEN** it exits 0 and every output line is at most 80 characters wide
- **AND** the header names the cursor by position and the lanes carry state words
- **AND** `--format mermaid` on the same inputs prints a flowchart whose first line is `flowchart LR`

#### Scenario: Failure — the flags that contradict each other are refused

- **WHEN** `interlock waves --plan <plan> --format board --json` runs
- **THEN** it exits non-zero and standard error names `--format` and `--json` as mutually exclusive
- **AND** `--format wat` exits non-zero naming the two formats that exist
- **AND** `--columns 80` without `--format` exits non-zero naming `--format`

#### Scenario: Edge case — a missing plan or state is spoken and exits 0

- **WHEN** `interlock waves --plan missing.json --format board` runs
- **THEN** standard output reads `no plan at missing.json` and the exit code is 0
- **AND** `interlock waves --plan <plan> --state missing.json --format board` prints a plan-only board whose header carries `no state at missing.json` and exits 0

#### Scenario: Edge case — run-log show draws a run and keeps its exit code for a run never recorded

- **GIVEN** a state home holding the fixture trajectory, state and no manifest
- **WHEN** `interlock run-log show <runId> --format board` runs
- **THEN** it exits 0 and prints the handoff board with `state.json: this run` and `run.json: absent` in the header
- **AND** `interlock run-log show never-recorded --format board` prints the existing none-recorded line and exits 0
- **AND** `interlock run-log show <runId>` without `--format` prints exactly what it printed before

### Requirement: The board SHALL draw a plan summary exactly as the plan it summarises

The board SHALL read of a task only its id, its tier, its model and its description as the lane title rule reads it, and of a wave only its position, its group, its kind, its red marker and its batches, so that a plan summary carrying those fields and nothing else draws line for line as the full plan or run state it was built from. The summary SHALL be built by one pure, Node-free module both the CLI and the ship meter's hooks module can import, from a plan or from a run state's adopted waves, and SHALL carry the ordered-after edges in the form the plan's deferral records take: a plan's own deferral records where the input carries them, and, for a run state, which keeps none, records derived from the tasks' own dependency fields as the planner derives them (each id the task depends on that belongs to its own group and is placed at an earlier wave or batch). The summary SHALL carry no task paths, no full description, no briefing and no carried wave state, and a test SHALL fail naming any such field found in it.

#### Scenario: Happy path — the fixture plan and its summary draw the same lines

- **GIVEN** the stored plan of the real halted run and the summary built from it
- **WHEN** both are drawn as a board at the same width, with no overlay and then with the real state as overlay
- **THEN** the two line arrays are equal in both cases
- **AND** the summary's task entries carry only `id`, `tier`, `model` and `description`, and its byte length is a fraction of the plan's

#### Scenario: Failure — a summary built from a run state after a replan draws the revised waves

- **GIVEN** a run state whose waves were revised by a replan, so they differ from the stored plan's
- **WHEN** the summary is built from the state and drawn
- **THEN** the blocks are the state's waves in position order, not the stored plan's
- **AND** a summary built from a state with no waves draws the no-waves board

#### Scenario: Edge case — a task with no description, no tier or no model summarises without one

- **GIVEN** a plan whose task carries no description and whose model and tier are absent
- **WHEN** the summary is built and drawn
- **THEN** the lane row carries the label alone where the title would be, and the model and tier cells carry the renderer's word for an absent value
- **AND** the summary does not throw and carries no invented field

### Requirement: The board SHALL key its rows and carry host-observed lane text for a second drawer

Beside the array of lines, the board renderer SHALL offer the same drawing as an array of rows, each carrying its text and a key: `wave:<position>` for a block's header, `lane:<label>` for a lane row with the lane's label as its agents are named, `verify:<position>` for a verify cell, `tail` for the tail line, and `header` for the header line, so a drawer that keys what it draws can address a lane by the label its spawn, its briefing and its trajectory line carry. The lines form SHALL be those rows' texts in order. A wave-header row SHALL also carry `parts.title`, and a lane row SHALL also carry `parts` with the batch, label, model, tier, effort, state word, gist, host-observed note, task ids, the ids it was ordered after, and each task's id with its own state word as separate fields, so a drawer can colour the state word without searching the cut line.

The overlay MAY carry, keyed by lane label, host-observed text for a lane; the renderer SHALL append it verbatim to that lane's row after the state word, cut with the rest of the row, and SHALL append nothing for a label it does not carry. A skipped-verification record that carries a wave position SHALL be placed by that position, with no group ambiguity; one that carries a group alone SHALL be placed as the group rule states.

#### Scenario: Happy path — rows are keyed by label and carry the appended text

- **GIVEN** the fixture plan, an overlay whose host-observed text for lane `1.5` reads `served claude-sonnet-5-5 · running`, and a skipped-verification record carrying wave position 0
- **WHEN** the board is drawn as rows
- **THEN** the row keyed `lane:1.5` ends with `served claude-sonnet-5-5 · running` after its state word, and every other lane row ends with its state word
- **AND** the row keyed `verify:0` carries the skip's reason and no ambiguity text, and the lines form equals the rows' texts in order
- **AND** that lane row's `parts.state` is the state word in its text

#### Scenario: Failure — text for a label no lane carries is not drawn

- **GIVEN** an overlay whose host-observed text is keyed by a label no planned lane carries
- **WHEN** the board is drawn as rows
- **THEN** no row carries that text and no row is added for it
- **AND** the renderer returns rows rather than throwing

#### Scenario: Edge case — appended text is cut with the row, the fixed fields kept

- **GIVEN** a lane row whose title, fixed fields, state word and appended text together exceed the width
- **WHEN** the board is drawn as rows at that width
- **THEN** the row ends in `…` and is exactly as wide as the board, the title giving way first
- **AND** the row still carries the lane's model, tier, effort and state word in full
