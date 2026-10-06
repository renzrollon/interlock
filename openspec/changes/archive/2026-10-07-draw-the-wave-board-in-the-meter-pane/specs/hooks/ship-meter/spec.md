## MODIFIED Requirements

### Requirement: The meter SHALL read the run from the CLI's own step records, never from prose

While a run is live, a Bash tool call whose command begins with `interlock ` SHALL be let through, and the CLI's stdout in the resolved result SHALL be read as a step record when it parses as JSON carrying an `action`. From that record the module SHALL take the action, the wave and batch position (the wave's group, the wave's position, the batch's index and the batch count, each where the step carries it), the spawns (label, kind, routed model, effort, briefing hash), the banners and the notes, set the status line to the change, the action and the positions, show one toast per banner text not yet shown in this run, and keep every banner for the pane. The module SHALL also keep, as state of the run that is reset with it: the plan summary carried by the latest step that carries one, replacing any earlier summary; the ids each recorded batch names as ok, failed and not attempted, accumulated across the run; each skipped verification a verify step reports, with its reason and its wave position; the position of the last batch dispatched; and the halt step's reason. It SHALL read none of these from a file. A result that does not parse, or carries no `action`, SHALL change nothing and leave one debug-log line, and a `plan` or `recorded` field that does not have the shape the run program states SHALL be ignored and named once on the debug log while the rest of the step is applied. The module SHALL recognise no banner by its wording; it displays the list the CLI emitted.

#### Scenario: Happy path — a batch step sets the status line and the wave rows

- **GIVEN** a live run
- **WHEN** a Bash call `interlock run next --results … --json` resolves with a step record whose action is `run-batch`, wave group 2, batch index 0 of a batch count of 2, and two spawns labelled `lane-a` (sonnet, low) and `lane-b` (opus, high)
- **THEN** the status line reads the change, `run-batch`, `wave 2` and `batch 1/2`, and a relayed step from a CLI that carries no batch position reads the change, the action and `wave 2` alone
- **AND** the pane's wave section carries one row per spawn with its label, routed model and effort

#### Scenario: Happy path — the plan summary, the recorded ids and a skipped verification are kept from the steps

- **GIVEN** a live run
- **WHEN** a step carrying a `plan` summary of three waves crosses, then a `record-batch` step whose `recorded` lists `1.7` and `1.4` ok, `1.5` failed and `1.6` not attempted, then a verify step at wave position 0 carrying `skipped: true` and a reason
- **THEN** the run holds that summary, the four ids under their three outcomes, and one skipped verification at wave position 0 with the step's reason
- **AND** no file was read to obtain any of them

#### Scenario: Failure — a result that is not a step changes nothing

- **GIVEN** a live run
- **WHEN** a Bash call `interlock run next --json` resolves with text that is not JSON, or JSON without an `action`
- **THEN** the status line, the tallies and the banner list are unchanged
- **AND** one line naming the problem reaches the debug log and nothing reaches the transcript

#### Scenario: Failure — a malformed summary is ignored and the step still applies

- **GIVEN** a live run that holds a plan summary from its adoption step
- **WHEN** a step crosses whose `plan` is a string, or an object with no array of waves, and whose `recorded` is a list rather than three named lists
- **THEN** the run keeps the summary it held and its recorded ids are unchanged
- **AND** the step's action, positions, spawns and banners are applied as for any step, and one debug-log line names each field it ignored

#### Scenario: Edge case — a banner carried across two steps toasts once, and other Bash calls are untouched

- **GIVEN** a live run and a step carrying `banners: ['GRAPH UNAVAILABLE: never built …']`, followed by a step carrying the same banner again
- **WHEN** both results cross the module
- **THEN** exactly one toast with that text is shown and the pane lists it once
- **AND** a Bash call whose command is `npm test` is passed through at the first line, its result unread

#### Scenario: Edge case — a replan's summary replaces the adopted one, and the run boundary drops both

- **GIVEN** a live run holding an adopted summary and the recorded ids of its first batch
- **WHEN** the step after a replan crosses carrying a revised summary
- **THEN** the run holds the revised summary in place of the adopted one, and the recorded ids of the first batch stand
- **AND** after a classic session-start event with source `clear`, no summary, no recorded id and no skipped verification is held

### Requirement: The pane SHALL draw on both surfaces and name the record it is not

`/interlock-meter` SHALL open the pane at any width. At run start the module SHALL open it unasked, and when the engine declines to seat it one toast SHALL say the meter is available by command, with nothing else drawn. The pane SHALL use only elements that draw on the terminal and the Desktop: the change and run id, the current action, the run's last activity time with the quiet word when the cap is reached, the wave section, the per-agent figures, the session's context fill and cost as the engine reports them (the window's size, its fill in tokens and its percent, and the session's cost in dollars, each shown only where the host answered it and said to be unreported where it did not, labelled as the engine's total for the session and not the run's, with no threshold, no colour and no figure the module computed from token counts or a price table), the plan windows the session reports (kind, percent used, reset time) with no threshold and no colour, every banner so far, a refusals section, and after the close or halt the summary the CLI printed, resume card row included. The session's usage SHALL be read as the plain call, with no breakdown requested, and when that read fails the pane SHALL name the failure and its reason on the context, cost and plan-window lines rather than guess a cause. The refusals section SHALL carry the permission-prompt count and the auto-mode-denial count with its tool names in the close summary's words, one line per prompt still waiting with its tool, its thread and its time, the guard-denial count by guard when any was seen, and a launch-guard line reading `launch guard: next launch allowed`, `launch guard: next launch refused: <reason>` in the rule's words, or `launch guard: facts unreadable; the next launch is allowed`, decided by the same rule and the same state read the guard's branch uses.

The wave section SHALL be the wave board once a plan summary has crossed the module: one text element per line the shared board renderer returns for that summary, in the renderer's order, keyed by the renderer's row keys with a lane's row keyed `wave-row-<label>`, cut by the renderer at the pane's own body width and drawn with `truncate-end`, with no colour and no element other than a box and a text. The board's state words, cursor, verify cells and halt SHALL come from an overlay the module built from the steps alone, and the host-observed figures of a lane joined to its agent SHALL be appended to that lane's row; the module SHALL add no state word, cause or verdict of its own. A spawn whose label no planned lane carries SHALL be drawn as a flat row beneath the board, never dropped. Until a summary has crossed, the section SHALL be the flat rows, one per spawn seen, as before; once a batch has been dispatched with no summary crossed, the words `plan structure not relayed by this CLI` SHALL stand above them. When the renderer returns its one spoken line for a body narrower than its published minimum, the section SHALL be that line and then the flat rows; when the renderer throws, the section SHALL be the flat rows beneath a line saying the board could not be drawn, and the failure SHALL be named on the debug log. When no run is live the pane SHALL say so and SHALL still carry the launch-guard line, because the guard runs in every session. The module SHALL never close the pane itself: after the session boundary it redraws to the no-run text and the person dismisses it.

#### Scenario: Happy path — the pane mounts on both surfaces

- **GIVEN** a live run with one wave row, one banner, a last activity time, one waiting prompt, one guard denial, and a session whose usage reports a context of 48210 tokens of a 200000-token window at 24 percent and a cost of 0.4321 dollars
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the wave row, the banner, the `last activity` line, the context line (carrying `48210`, `200000` and `24%`), the cost line (carrying `$0.4321` and saying it is the engine's total for this session), the `permission prompts: 1` line, the waiting line, the `guard denials: 1 (guard-tests 1)` line and the `launch guard:` line are found by key
- **AND** the context, cost and plan-window lines carry no colour and no threshold text, and no line carries a tool input

#### Scenario: Happy path — a relayed plan draws as the board on both surfaces

- **GIVEN** a live run whose adoption step relayed a summary of two implementation waves and a test wave, whose batch step placed the cursor at wave position 0 batch 0, and whose `record-batch` step recorded `1.7` ok
- **WHEN** the pane is mounted on `terminal` and then on `desktop` with a body width at or above the board's published default
- **THEN** on each surface the wave section holds exactly the lines the renderer returns for that summary, that overlay and that width, in order, none wider than the body
- **AND** the row keyed `wave-row-1.7` carries `ok`, a lane of the cursor's batch carries `current`, and no element in the section is other than a box or a text or carries a colour

#### Scenario: Failure — the engine declines the unasked open

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the run becomes live and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-meter` opens the meter
- **AND** no pane is drawn until the command is typed

#### Scenario: Failure — a usage the host does not answer, and one it cannot

- **GIVEN** a live run whose session usage carries no cost and a context with a window but no fill yet
- **WHEN** the pane is drawn
- **THEN** the cost line says the host reports no cost, and the context line reads the window and says the fill is not yet reported, with no percent computed by the module
- **AND** when the usage read fails instead, the context, cost and plan-window lines each name the failure with its reason, and the header, the action, the last activity, the wave section, the agent rows and the banners are drawn as before

#### Scenario: Failure — a CLI that relays no plan is named, and the flat rows stay

- **GIVEN** a live run whose batch steps carry spawns and no `plan`, as an older `interlock` relays them
- **WHEN** a batch step has crossed and the pane is drawn
- **THEN** the wave section reads `plan structure not relayed by this CLI` above one flat row per spawn, keyed `wave-row-<label>` and reading as it did before this change
- **AND** before any batch has been dispatched the section reads that no lanes are dispatched yet, with no such line

#### Scenario: Edge case — after a halt, and with no run

- **GIVEN** a run that halted and whose close step crossed the module with its summary
- **WHEN** the pane is drawn
- **THEN** it shows the close summary, including its `resume card:` row when the summary carries one, no quiet word, the counts the run reached and no waiting prompt, and the context and cost lines still read as the engine reports them
- **AND** after a session boundary the same pane shows no ship run is live here with the launch-guard line beneath, and in a session with no live run it says the same

#### Scenario: Edge case — the launch-guard line follows the session's record

- **GIVEN** an interactive session with no live run
- **WHEN** the pane is drawn before any launch, then after one accepted ship launch, then after a human prompt, and then with a session-state read that rejects
- **THEN** the line reads `launch guard: next launch allowed`, then `launch guard: next launch refused: ` followed by the rule's reason, then `launch guard: next launch allowed`, then `launch guard: facts unreadable; the next launch is allowed`
- **AND** the state read that rejected is named once on the debug log and nothing is thrown out of the draw

#### Scenario: Edge case — a narrow body, and a spawn no planned lane carries

- **GIVEN** a live run holding a plan summary, whose last verify step spawned an agent labelled `inter-wave-verify-7`
- **WHEN** the pane is drawn with a body one column below the board's published minimum, and then at the published default
- **THEN** at the narrow width the wave section is the renderer's one spoken line followed by the flat rows, and no box-drawing character appears in it
- **AND** at the default width the board is drawn and `inter-wave-verify-7` is a flat row beneath it, keyed `wave-row-inter-wave-verify-7`
