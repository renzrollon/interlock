## REMOVED Requirements

### Requirement: The settle meter SHALL go live only on the plugin's settle skill load that carries `--review` in an interactive session, and SHALL take the change, the pull request and the head from the CLI's lines alone

**Reason**: A settle pass without `--review` still resolves the change, assesses merge confidence, applies labels and publishes, and drew nothing while it did. The meter now goes live on every settle load and records whether `--review` was passed.

**Migration**: Replaced by "The settle meter SHALL go live on every load of the plugin's settle skill in an interactive session, SHALL record whether `--review` was passed, and SHALL take the change, the pull request and the head from the CLI's lines alone". Nothing outside the hooks module reads the old gate; a pass loaded with `--review` starts and draws exactly as before.

## ADDED Requirements

### Requirement: The settle meter SHALL go live on every load of the plugin's settle skill in an interactive session, SHALL record whether `--review` was passed, and SHALL take the change, the pull request and the head from the CLI's lines alone

The module SHALL start a settle run when the plugin's settle skill is loaded in a session whose start reported it interactive, with or without `--review`: a prompt whose first word is `/interlock:settle`, or a Skill call naming `interlock:settle` the engine did not mark errored. The run SHALL record whether its arguments contain the word `--review`. The change, pull request and head SHALL be read only as the earlier rules read them.

Of the prompt and the Skill call, only the first word and the presence of the word `--review` SHALL be read, and both SHALL be passed on exactly as they came. A Skill call naming `interlock:review-code` while a settle run is live SHALL change no section: it lands in the section already open. At the start the status line and the pane SHALL read `change: unknown until named`. The change name SHALL be taken only from the CLI's own argv (`--change <name>` on the settle lines, the positional change on `interlock settle conformance-brief`, `interlock merge-confidence` and `interlock domain-context`, `--metrics <name>` on `interlock review`) or a `change` field in a result's JSON; the pull request number only from `--pr <n>`, a `pr` field, or the positional number on a `gh pr` stage; the head only from `--head <sha>` or a `head` or `head.sha` field. None of them SHALL be taken from a file path, a prompt or a tool input. A second settle load in the same session SHALL start the record over, with its own `--review` reading, and say so once on the debug log. In a non-interactive session every hook this requirement adds SHALL return at its first line.

#### Scenario: Happy path — a load with `--review` starts the run and the brief names the pass

- **GIVEN** an interactive session
- **WHEN** the prompt `/interlock:settle --create --review` is submitted
- **THEN** the status line reads `interlock settle: change: unknown until named`, the pane is opened unasked, it reads `with --review` beneath its header, and the prompt reaches the engine unchanged
- **AND** when `interlock settle remediate-brief --review .claude/ship/settle/review-r0.json --round 1 --change route-prose-spawns-by-role --head a96cb82cedb626d9b6c11c1f6a090b7e52a2afa8 --pr 25 … --json` resolves, the header names `route-prose-spawns-by-role`, `PR #25` and `head a96cb82`

#### Scenario: Happy path — a load without `--review` starts the run and groups its pass under `resolve`

- **GIVEN** an interactive session
- **WHEN** the prompt `/interlock:settle --create` is submitted, then `interlock changes` exits 0, then `interlock pipeline …` and `interlock merge-confidence <change> … --json` resolve with `verdict: 'MERGE', score: 91`, then `gh pr edit 25 --add-label …` and `interlock drift --changed … --json` resolve
- **THEN** the pane opens unasked and reads `without --review` beneath its header, and draws the groups `resolve`, `merge confidence`, `publish` and `drift` in that order, with no `review` and no `round <n>` group
- **AND** the run ends at the drift line, and the status line reads `interlock settle <change> #25: merge confidence · MERGE 91`

#### Scenario: Failure — a non-interactive session draws nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** `/interlock:settle --review` or `/interlock:settle --create` is submitted and the settle lines, spawns and turn events of a pass follow
- **THEN** no status line is set, no pane is opened, no toast is shown and no record is kept
- **AND** every hook resolved to what the engine alone would have done

#### Scenario: Edge case — the review-code skill alone, and a second settle load

- **GIVEN** an interactive session in which the settle skill was not loaded
- **WHEN** a Skill call names `interlock:review-code` and four `general-purpose` agents whose prompts begin `# Dimension: ` are spawned
- **THEN** no status line is set and the pane reads that no settle run is live in this session
- **AND** when a live settle run loaded with `--review` exists and `/interlock:settle` is submitted again without it, the record starts over with `change: unknown until named`, reads `without --review`, the earlier rows are not kept, and one debug-log line says a new settle run replaced the previous one

### Requirement: The settle pane SHALL be drawn as bordered cards with toned words from fields beside unchanged row texts, and SHALL highlight the merge-confidence verdict by the CLI's own word

Each pane line SHALL keep the text it reads today, and SHALL carry beside it its kind, its section, coloured spans whose concatenation is exactly the text, and, on a verdict row, the verdict word. A span's tone SHALL only name what a word the CLI, the engine or the clock supplied means. The module SHALL draw single-border cards from those fields alone, never by parsing a text.

The pane SHALL draw, at or above the card floor (`wave board min width (columns)` from `interlock limits`):
- a header card whose border takes the accent colour, holding the header line and the `with --review` or `without --review` line
- one card per section in the order it opened, its border in the current colour while that section is the open one of a live run and dim otherwise, its heading's section word bold in the accent colour and its times dim
- CLI rows with their clock dim; `exit 0` in the ok colour; any other own exit, a `STOP: ` line and the word `(unparsed)` in the alarm colour; `exit not its own` and `result not seen` dim
- role rows indented under their section, and each agent's row indented beneath its role, its name in the name colour and its end word coloured as the ship meter colours a turn word
- the merge-confidence verdict row inside a card of its own within its section, whose border and verdict word take the verdict's tone: `MERGE` the ok colour, `HUMAN` the warn colour, `BLOCK` the alarm colour; a verdict word outside those three SHALL be drawn uncoloured
- the banners in the warn colour

Indentation SHALL be layout, never characters in a text. Below the card floor, or with no width reported, the same lines SHALL be drawn flat with no border. With no settle run live the pane SHALL draw its one no-run text and nothing else. The pane SHALL use only `borderStyle: 'single'`, theme keys and the element props the ship meter already draws with, and SHALL add no tick, cross, glyph or word of its own.

#### Scenario: Happy path — the PR #25 pass draws as cards and the verdict stands out

- **GIVEN** a done settle run whose groups are `review`, `round 1`, `round 2`, `conformance`, `verify`, `checks`, `merge confidence`, whose verdict row reads `HUMAN 58 · head 161f955` and whose round 2 carries a `STOP: ` row
- **WHEN** the pane is drawn at 144 columns on the terminal and on the desktop
- **THEN** each group is one single-border card with a dim border, the header card's border is the accent colour, and the verdict row sits in its own card whose border and the word `HUMAN` take the warn colour
- **AND** the keyed rows read, in order, exactly the texts the pane drew before this change, and every line's spans join to its text

#### Scenario: Edge case — the open round's card is marked while the run is live

- **GIVEN** a live settle run in round 1 whose fixer is running
- **WHEN** the pane is drawn
- **THEN** round 1's card border takes the current colour, the review card's border is dim, the fixer's row is indented beneath the round's rows and its end word `live` takes the colour of a running turn
- **AND** once the drift line ends the run, no card's border takes the current colour

#### Scenario: Failure — a narrow pane draws flat, and an unknown verdict stays uncoloured

- **GIVEN** a done settle run whose verdict row's word is one the meter does not know
- **WHEN** the pane is drawn at 40 columns, and then at 144 columns
- **THEN** at 40 columns no Box has a border and every keyed row still reads its text
- **AND** at 144 columns the verdict card is drawn with a dim border and its word uncoloured, and no pane text contains a tick, a cross, `passed`, `failed` or `halted` that the CLI did not print

## MODIFIED Requirements

### Requirement: The pane SHALL group the run by the settle skill's sections and rounds as a timeline on both surfaces, and SHALL toast only the CLI's STOP line, the verdict, a turn's non-answer end and a declined placement

The pane SHALL be registered as `interlock-settle` with the command `/interlock-settle` at any width, opened unasked when a settle run starts, and drawn by field on the terminal and desktop surfaces from the same keyed lines: a header (`interlock settle — <change> · PR #<n> · <depth> · head <sha7> · <elapsed>`), then one group per section word of the settle skill in the order the pass runs them — `review` (or `resolve` in a pass loaded without `--review`), `round <n>` for each round seen, `ready`, `conformance`, `verify`, `checks`, `merge confidence`, `publish`, `drift` — each with the clock time it opened, the clock time of its last line and the span between them, its agent rows grouped by role (dimensions, skeptics, fixer, worker) with `<k> spawned · <m> <reason>` counts, the dimensions row drawing the routing listing and the engine's count as two labelled facts (`review dimensions <names> · <k> spawned`), and its CLI rows with their clock times; then a banners area repeating the routing lines' banners verbatim or reading `none`. A group not yet reached SHALL not be drawn; a group the pass skipped SHALL not be invented. Below `settle pane full width (columns)` from `interlock limits` an agent row SHALL keep its role, served model, elapsed time and reason. A row, a group heading or the header the clock could not time SHALL read `time unknown` where its time would be. The pane SHALL raise a toast only for: a `STOP: ` line (its text verbatim), a merge-confidence verdict (`merge-confidence: <verdict> <score>`), a settle agent's turn ending with a reason other than `answer` (`<role>: <reason>`), and an unasked open the surface declined (`/interlock-settle opens the settle meter`). With no settle run live the pane SHALL read that no settle run is live in this session.

The record SHALL hold one open section, and a line SHALL either open a section or append to the one open. Sections SHALL only move forward in the order below; a line whose kind opens an earlier section SHALL append to the section already open.

| section | opened by | also appends here while it is open |
|---------|-----------|------------------------------------|
| `review` | the run's first keyed line, Skill load or spawn | review-code's lines, `interlock review --out …review-r0.json`, `interlock settle comment --round 0`, dimension and skeptic spawns |
| `resolve` | in a pass loaded without `--review`, the run's first keyed line that has no section of its own, in place of `review` | every later line with no section of its own, until a later section opens |
| `round <r>` | `interlock settle tree-check` after `review-r<r-1>.json` has crossed, or `interlock settle remediate-brief --round <r>` when no such tree-check did | the brief, `interlock routing settle-fixer`, the fixer spawn, `fixer-result`, `test-paths`, `git commit`, `git push`, the nested review-code load, its lines and its dimension and skeptic spawns, `interlock review --out …review-r<r>.json`, `interlock settle replies` |
| `ready` | `gh pr ready <n>` / `glab mr update <iid> --ready` | — |
| `conformance` | `interlock settle conformance-brief`, `interlock routing settle-conformance` | the conformance worker's spawn |
| `verify` | `interlock verify plan`, `exec`, `judge`, `coverage` | — |
| `checks` | `gh pr checks <n> --watch` / `glab ci get --merge-request <iid>` | — |
| `merge confidence` | `interlock pipeline`, `interlock merge-confidence <c> … --json` or `--markdown` | — |
| `publish` | a label add or remove line, `interlock merge-confidence --label-names` | any later `merge-confidence` row |
| `drift` | `interlock drift --changed` | — |

In a pass loaded without `--review`, `review` and `round <n>` SHALL never be opened, and every line that would have opened `review` opens or appends to `resolve` instead. A line with no round of its own (`surface`, `domain-context`, `routing`, `gate`, `test-paths`, a `tree-check` before any review record, the nested review-code Skill load) and an unattributed spawn SHALL append to the section open.

#### Scenario: Happy path — the pass reads as a grouped timeline on both surfaces

- **GIVEN** a settle run in which the review lines, two rounds, the conformance brief, the verify lines, the pipeline line, `interlock merge-confidence … --json` resolving with `verdict: 'HUMAN', score: 58, head: { sha: '161f955…' }` and then the same command with `--markdown` in place of `--json` exiting 0 have crossed
- **WHEN** the pane is drawn on the terminal and on the desktop
- **THEN** both draw the groups `review`, `round 1`, `round 2`, `conformance`, `verify`, `checks`, `merge confidence` in that order, each with its open time, last time and span, the review group with a dimensions row, a skeptics row, the review record row and the comment row, round 1 with tree-check, brief, fixer, result, commit, re-review and replies rows, round 2 with its tree-check and STOP rows, and the merge-confidence group with the pipeline row, the verdict row `HUMAN 58 · head 161f955` and after it the row `merge-confidence --markdown · exit 0`
- **AND** one toast read `merge-confidence: HUMAN 58`, and the status line reads `interlock settle route-prose-spawns-by-role #25: merge confidence · HUMAN 58`

#### Scenario: Edge case — a re-review's fan-out lands in its round, not in review

- **GIVEN** a live settle run whose review group drew four dimension spawns and the `review-r0.json` record, and in which round 1's `tree-check` and `interlock settle remediate-brief --round 1 …` have crossed
- **WHEN** a Skill call names `interlock:review-code`, then `interlock routing --json` resolves, then an agent whose prompt begins `# Dimension: blast-radius` is spawned, then `interlock review … --out .claude/ship/settle/review-r1.json --json` resolves
- **THEN** the dimension agent, the routing row and the review record are drawn in round 1 as its re-review, and the review group still shows four dimension spawns
- **AND** the status line reads `round 1 · …` throughout and never `review · …`

#### Scenario: Failure — the unasked open is declined, and the command answers with no run

- **GIVEN** an interactive session whose surface answers `isPlaced: false` to an unasked open
- **WHEN** `/interlock:settle --review` is submitted
- **THEN** one toast reads `/interlock-settle opens the settle meter` and the status line is still set
- **AND** when `/interlock-settle` is run in a session with no settle run, the pane opens and reads that no settle run is live in this session, and the command replies with an empty result

#### Scenario: Edge case — a narrow terminal, a skipped group and a running fixer

- **GIVEN** a live settle run in round 1 whose fixer has stepped 18 times over 6m 10s and not ended
- **WHEN** the pane is drawn at 90 columns
- **THEN** the fixer row reads `fixer · claude-opus-5-5 · 6m 10s · live` and the status line reads `interlock settle route-prose-spawns-by-role #25: round 1 · fixer 6m 10s · 18 req`
- **AND** no `ready` group is drawn because no `gh pr ready` or `glab mr update --ready` line crossed, and no row reads any word the CLI, the engine or the clock did not supply
