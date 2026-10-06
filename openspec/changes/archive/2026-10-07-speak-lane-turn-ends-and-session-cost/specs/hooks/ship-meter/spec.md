## ADDED Requirements

### Requirement: The meter SHALL say when a run agent's turn ends without an answer, in the host's own word

While a run is live, a turn end the host reports for a run agent, carrying the agent's id and a reason, SHALL raise one toast when that reason is not `answer`. The toast SHALL name the lane by its descriptive title where the agent is joined to a dispatched lane, or `lane unknown` where it is not, then the agent id, then the host's reason word repeated verbatim: `aborted`, `refusal`, `error`, or whatever word a host sends. The module SHALL raise at most one such toast per agent per run: every `answer`, and every later abnormal end of the same agent, SHALL raise nothing. The module SHALL name no cause, make no verdict and hand the CLI nothing: the close summary's banner stays the record, and the agent's reason and duration stay on the pane row as before. A turn end with no reason, one outside a live run, and one in a non-interactive session SHALL raise nothing. The event SHALL be passed on as it came in every case, and a toast the host refuses SHALL be named on the debug log and never thrown.

#### Scenario: Happy path — an agent whose turn ends with `error` is named once, by its lane's title

- **GIVEN** a live run whose batch step dispatched `lane-a` with a descriptive title, and whose spawn event joined agent `a1` to that lane by briefing hash
- **WHEN** a turn end for `a1` with reason `error` crosses the module
- **THEN** exactly one toast is shown, reading the lane's title, `agent a1` and `turn ended: error`, and the event resolves to what the engine alone would have done
- **AND** the pane's row for `a1` reads `error` with the turn's duration, and a second turn end for `a1` with reason `error`, and a turn end for `a2` with reason `answer`, add no toast

#### Scenario: Failure — a stop the host reports for an agent nobody joined, and a toast the host refuses

- **GIVEN** a live run on a host that raised no spawn event, so no agent is joined to a lane
- **WHEN** a turn end for `a1` with reason `aborted` crosses the module
- **THEN** one toast reads `lane unknown · agent a1 · turn ended: aborted`, with no cause and no verdict word beside it
- **AND** when the host refuses the toast, one debug-log line names the refusal and the event still resolves as the engine alone would have resolved it

#### Scenario: Edge case — the three declared words, an undeclared word, a missing reason, and a turn outside a live run

- **GIVEN** an interactive session with a live run
- **WHEN** turn ends cross for three agents with reasons `refusal`, `aborted` and `error`, for a fourth with a word the declaration does not name, for a fifth with no reason at all, and, before the launch and again after the close record, for a sixth with reason `error`
- **THEN** the three declared words each raise one toast carrying that word verbatim, and the undeclared word is repeated verbatim in its own toast
- **AND** the missing reason, the turn before the launch and the turn after the close raise nothing, and no toast carries `warn`, `failed`, `stuck` or any word the host did not send

## MODIFIED Requirements

### Requirement: The pane SHALL draw on both surfaces and name the record it is not

`/interlock-meter` SHALL open the pane at any width. At run start the module SHALL open it unasked, and when the engine declines to seat it one toast SHALL say the meter is available by command, with nothing else drawn. The pane SHALL use only elements that draw on the terminal and the Desktop: the change and run id, the current action, the run's last activity time with the quiet word when the cap is reached, the wave table, the per-agent figures, the session's context fill and cost as the engine reports them (the window's size, its fill in tokens and its percent, and the session's cost in dollars, each shown only where the host answered it and said to be unreported where it did not, labelled as the engine's total for the session and not the run's, with no threshold, no colour and no figure the module computed from token counts or a price table), the plan windows the session reports (kind, percent used, reset time) with no threshold and no colour, every banner so far, and after the close or halt the summary the CLI printed, resume card row included. The session's usage SHALL be read as the plain call, with no breakdown requested, and when that read fails the pane SHALL name the failure and its reason on the context, cost and plan-window lines rather than guess a cause. When no run is live it SHALL say so. The module SHALL never close the pane itself: after the session boundary it redraws to the no-run text and the person dismisses it.

#### Scenario: Happy path — the pane mounts on both surfaces

- **GIVEN** a live run with one wave row, one banner, a last activity time, and a session whose usage reports a context of 48210 tokens of a 200000-token window at 24 percent and a cost of 0.4321 dollars
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the wave row, the banner, the `last activity` line, the context line (carrying `48210`, `200000` and `24%`) and the cost line (carrying `$0.4321` and saying it is the engine's total for this session) are found by key
- **AND** the context, cost and plan-window lines carry no colour and no threshold text

#### Scenario: Failure — the engine declines the unasked open

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the run becomes live and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-meter` opens the meter
- **AND** no pane is drawn until the command is typed

#### Scenario: Failure — a usage the host does not answer, and one it cannot

- **GIVEN** a live run whose session usage carries no cost and a context with a window but no fill yet
- **WHEN** the pane is drawn
- **THEN** the cost line says the host reports no cost, and the context line reads the window and says the fill is not yet reported, with no percent computed by the module
- **AND** when the usage read fails instead, the context, cost and plan-window lines each name the failure with its reason, and the header, the action, the last activity, the wave rows, the agent rows and the banners are drawn as before

#### Scenario: Edge case — after a halt, and with no run

- **GIVEN** a run that halted and whose close step crossed the module with its summary
- **WHEN** the pane is drawn
- **THEN** it shows the close summary, including its `resume card:` row when the summary carries one, and no quiet word, and the context and cost lines still read as the engine reports them
- **AND** after a session boundary the same pane shows no ship run is live here, and in a session with no live run it says the same
