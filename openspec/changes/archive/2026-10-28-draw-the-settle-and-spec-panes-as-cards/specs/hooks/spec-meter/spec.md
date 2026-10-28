## ADDED Requirements

### Requirement: The spec pane SHALL be drawn as titled cards with toned words from fields beside unchanged row texts

Each spec pane line SHALL keep the text it reads today. Beside it, each line SHALL carry its section — `header`, `artifacts`, `explore`, `gates`, `writes` or `record` — and coloured spans whose concatenation is exactly the text. At or above the card floor (`wave board min width (columns)` from `interlock limits`), the module SHALL draw the lines as a header card and titled cards, using `borderStyle: 'single'` alone. Below the floor, or with no width reported, it SHALL draw the same lines flat with no border.

Tones:
- An artifact status word: `done` the ok colour, `ready` the current colour, `blocked` dim.
- A field the gate, ledger, validate or readiness line printed as `true` or `false`: the ok colour when the CLI's own field reads it ready, passed or not blocking; the alarm colour otherwise.
- `not run yet`, and the record line: dim.
- A result not read: the warn colour.
- The checkpoint and hand-over lines: the accent colour.

A card's title SHALL be drawn from the line's section and SHALL never be a keyed row. With no spec run live the pane SHALL draw its one no-run text and nothing else, and SHALL add no tick, glyph or word of its own.

#### Scenario: Happy path — a stopped run reads as cards with its gate coloured

- **GIVEN** a spec run at its checkpoint whose status shows four artifacts `done`, whose ledger line printed `blocking false`, whose validate line printed `ready true` and whose gate line printed `passed false`
- **WHEN** the pane is drawn at 120 columns on the terminal and on the desktop
- **THEN** the header card is followed by the cards titled `artifacts`, `explore`, `gates`, `writes` and `record`, each with a single border
- **AND** each `done` takes the ok colour, `blocking false` and `ready true` take the ok colour, `passed false` takes the alarm colour, the checkpoint line takes the accent colour, and every keyed row reads exactly the text it read before this change

#### Scenario: Edge case — a run before any line has crossed

- **GIVEN** a live spec run in which no keyed line has crossed yet
- **WHEN** the pane is drawn
- **THEN** every `not run yet` is dim, the `artifacts` card holds the `status: not run yet` row, and no card is titled for a section with no line
- **AND** the no-run pane, drawn in a session with no spec run, is one text and no card

#### Scenario: Failure — a narrow pane draws flat

- **GIVEN** a live spec run with its status read
- **WHEN** the pane is drawn at 40 columns
- **THEN** no Box has a border, no card title is drawn, and every keyed row still reads its text

## MODIFIED Requirements

### Requirement: The pane SHALL draw the run on both surfaces by field, count writes and spawns without reading them as validity, and name the record it is not

`/interlock-spec` SHALL open the pane at any width. At the spec skill's load the module SHALL open it unasked. When the engine declines to seat it, one toast SHALL say the meter is available by command, and nothing else is drawn.

The pane SHALL use only elements that draw on the terminal and the Desktop. It SHALL draw, in this order:
- the change (or `unknown until named`) and the schema the last status named
- the artifact table exactly as the last `openspec status … --json` printed it, `id · status · outputPath`, with `applyRequires` named, or `status: not run yet`
- the explore line: `<n> investigators spawned`, from the `agent.spawn` events whose `subagentType` is `Explore` during the run (or that the host reported none), and the brief's path from the last Write under `.claude/handoff/explore-*.md`, or `no brief written yet`
- the drift counts
- the notes line, `notes: <n> matched · omitted <k> · unreadable <u>`, or `not run yet`
- the ledger, validate, gate and readiness lines by field, or `not run yet`
- the autonomy command last run, or `not run yet`
- the advisor-consults line: `advisor consults seen: session <a> · subagents <b>`, where each count is the number of distinct entries named `advisor` in the `serverToolUses` of the `turn.step` events during the run, keyed by entry id. `<a>` counts events with no `agentId` and `<b>` counts events with one. The line is drawn from the run's first such entry onward; before it, the pane has no advisor-consults line
- a writes section listing:
  - each artifact file under `openspec/changes/<name>/` written through the Write or Edit tool, with a count and the last time
  - the findings file's path, from the last Write under `.claude/metrics/review-artifacts-<name>-*.json`
  - no status word beside any of them
- `last activity <ISO>` from the engine's clock, or `last activity unknown`
- one line reading `the artifacts on disk, the findings file and the gate's exit are the record`

Rules:
- A write whose result the engine marked errored SHALL not be counted.
- The advisor-consults count SHALL be drawn and never compared, and its word SHALL be `seen`. The meter does not read settings, so it cannot tell a tool that is off from an engine that never reports server tool uses. Neither SHALL draw a line that reads as a measured zero.
- When no spec run is live, the pane SHALL say so.
- The module SHALL never close the pane itself.
- No pane text SHALL contain the word `complete`.
- A row SHALL carry no colour of the meter's own: a tone SHALL only name what a word the CLI or the engine printed means — an artifact's status word, a field the CLI printed as `true` or `false`, `not run yet` — and SHALL leave the row's text unchanged.

#### Scenario: Happy path — the pane mounts on both surfaces with the table, the counts and the writes

- **GIVEN** a live spec run named `add-the-thing` after:
  - three `Explore` spawns
  - a Write to `.claude/handoff/explore-add-the-thing-20261006-120000.md`
  - one status call
  - two Writes to `openspec/changes/add-the-thing/proposal.md`
  - a Write to `.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json`
  - two `turn.step` events with no `agentId` and one with an `agentId`, whose `serverToolUses` each carry one entry named `advisor`, with distinct ids
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface these are found by key: the artifact rows, the explore line (`3 investigators spawned`, the brief's path), the writes line for `proposal.md` (`written 2×` with its last time), the findings path, the line `advisor consults seen: session 2 · subagents 1`, and the `last activity` line
- **AND** no row carries a tick, a threshold or the word `complete`, and a row's colour is only a tone naming a word the CLI printed

#### Scenario: Failure — the engine declines the unasked open, and a denied write is not counted

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the spec skill is loaded and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-spec opens the spec meter`, and no pane is drawn until the command is typed
- **AND** when a later Write to `openspec/changes/add-the-thing/tasks.md` resolves with `isError: true`, the writes section does not count it
- **AND** when a `turn.step` event repeats an advisor entry id already counted, the advisor-consults line does not change

#### Scenario: Edge case — no run, and a run that has not named its change

- **GIVEN** a session in which the spec skill was not loaded
- **WHEN** `/interlock-spec` is typed
- **THEN** the pane reads that no spec run is live in this session, and nothing else
- **AND** in a live run before any name crossed, the pane's header reads `change: unknown until named`, every result line reads `not run yet`, no advisor-consults line is drawn, and a Write under `openspec/changes/<some-name>/` does not name the change
- **AND** when every `turn.step` event in a live run lacks `serverToolUses`, or carries none named `advisor`, no advisor-consults line is drawn, no pane text contains `none seen`, and no other line changes

