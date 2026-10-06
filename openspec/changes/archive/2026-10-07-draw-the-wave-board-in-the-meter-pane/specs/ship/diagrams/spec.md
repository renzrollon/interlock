## ADDED Requirements

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

Beside the array of lines, the board renderer SHALL offer the same drawing as an array of rows, each carrying its text and a key: `wave:<position>` for a block's header, `lane:<label>` for a lane row with the lane's label as its agents are named, `verify:<position>` for a verify cell, `tail` for the tail line, and `header` for the header line, so a drawer that keys what it draws can address a lane by the label its spawn, its briefing and its trajectory line carry. The lines form SHALL be those rows' texts in order.

The overlay MAY carry, keyed by lane label, host-observed text for a lane; the renderer SHALL append it verbatim to that lane's row after the state word, cut with the rest of the row, and SHALL append nothing for a label it does not carry. A skipped-verification record that carries a wave position SHALL be placed by that position, with no group ambiguity; one that carries a group alone SHALL be placed as the group rule states.

#### Scenario: Happy path — rows are keyed by label and carry the appended text

- **GIVEN** the fixture plan, an overlay whose host-observed text for lane `1.5` reads `served claude-sonnet-5-5 · running`, and a skipped-verification record carrying wave position 0
- **WHEN** the board is drawn as rows
- **THEN** the row keyed `lane:1.5` ends with `served claude-sonnet-5-5 · running` after its state word, and every other lane row ends with its state word
- **AND** the row keyed `verify:0` carries the skip's reason and no ambiguity text, and the lines form equals the rows' texts in order

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
