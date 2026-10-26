# review/blast-radius-dimension Specification

## Purpose
An eighth bundled review dimension for `review-code`: what a diff changes for the callers, data and rollback of the code it touches, enumerated through the codebase graph when one exists, skipped aloud when none does, and the skip recorded where the verdict reads it.

## Requirements

### Requirement: `review-code` SHALL bundle a `blast-radius` dimension that runs when a graph exists and is skipped aloud and on the record when none does

The skill SHALL list `blast-radius` in its dimension table with the brief `dimensions/blast-radius.md` and the condition that `.claude/graph/graph.json` exists. Without the graph the skill SHALL run no `blast-radius` reviewer and SHALL print `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`. The skill SHALL write a dimension record `{ selected, ran, unavailable, skipped }` beside its findings whenever it runs, naming a skipped dimension and its reason under `skipped`, and SHALL hand it to its `interlock review` line with `--dimensions`, so the skip reaches the verdict as the `blast-radius-skipped` flag rather than as a line in the session. A dimension name that resolves to no brief SHALL be reported with `list the eight`.

#### Scenario: Happy path — the table row and the brief

- **GIVEN** the shipped `skills/review-code/SKILL.md` and `skills/review-code/dimensions/blast-radius.md`
- **WHEN** the skill suite runs
- **THEN** the table carries a `blast-radius` row naming `dimensions/blast-radius.md` and the graph file, and the brief names `interlock-graph consumers`, callers outside the diff, data and concurrency effects, and rollback
- **AND** the skill's prose carries `list the eight` and not `list the seven`

#### Scenario: Failure — no graph

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** it finds `BLAST RADIUS SKIPPED` followed by `/interlock:graph`
- **AND** the paragraph says the other dimensions still run and that the skip is written to the dimension record under `skipped` with its reason

#### Scenario: Edge case — the dimension named explicitly without a graph

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the paragraph on `--dimensions`
- **THEN** it says a `blast-radius` named without a graph is reported with the skip line rather than silently run
- **AND** the review still names every dimension it did run

#### Scenario: Edge case — the record reaches the review line

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** it finds a fenced line writing the dimension record with the keys `selected`, `ran`, `unavailable` and `skipped`, before the `interlock review` line
- **AND** the `interlock review` line carries `--dimensions` naming that file, with or without `--out`

### Requirement: The dimension's findings SHALL use the shared schema and SHALL be raised only for an observer outside the diff

The brief SHALL instruct the reviewer to emit findings in the schema every dimension uses, under `dimension: "blast-radius"`, with the shared severity rubric, and to raise a finding only when a caller, a reader of stored data, or a rollback outside the diff would observe a change in behaviour. A symbol the graph reports with no consumer outside the diff SHALL raise nothing.

#### Scenario: Happy path — the schema and the rubric

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `"dimension": "blast-radius"`, names the three severities, and tells the reviewer to name the observing caller's file in each finding
- **AND** it tells the reviewer to query the graph before reading code

#### Scenario: Failure — a finding about the diff's own plumbing

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** it finds the instruction that a change observed only by code inside the diff is not a finding
- **AND** the instruction names additive plumbing as the usual case

#### Scenario: Edge case — no consumers

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** it finds the instruction that a symbol with no consumer outside the diff raises nothing
- **AND** the reviewer is told to say so in its summary rather than invent a caller
