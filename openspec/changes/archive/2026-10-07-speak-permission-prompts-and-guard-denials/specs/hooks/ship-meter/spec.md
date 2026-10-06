## ADDED Requirements

### Requirement: The meter SHALL speak the guards' refusals in the guards' own words

A settings guard's denial SHALL be read off the errored result the engine hands the module's tool hooks on `Bash`, `Edit`, `Write` and `Workflow`, when that result's text carries one of the four guard names followed by a colon and a space, wherever in the text the name stands. While a run is live in an interactive session, such a denial SHALL be repeated in one toast carrying the text from the guard's name on, so an engine prefix in front of the reason is not repeated, once per distinct text per run, and SHALL be counted on the pane by guard. An errored result that names no guard, and a result that is not errored, SHALL change nothing and leave no debug-log line, and every result SHALL be returned exactly as it came. The in-process launch guard's own refusal SHALL be toasted in the rule's words in any interactive session the moment the module returns it, and the settings form's `guard-relaunch` refusal read off the Workflow result SHALL be toasted the same way whether or not a run is live. The module SHALL compute no reason of its own, stamp no activity for a denial, name no cause, and write no file.

#### Scenario: Happy path — a guard's denial reaches the person in the guard's words

- **GIVEN** a live run and a settings layer that denies an `Edit` of a test file with a reason beginning `guard-tests:` and a `git commit` Bash call with a reason beginning `guard-commit:`, each reaching the module behind the engine's `PreToolUse:<tool> hook error: ` prefix
- **WHEN** a run agent's `Edit` call and then its `git commit` call cross the module and resolve errored with those texts
- **THEN** one toast repeats each reason from the guard's name on with nothing before the name, the pane reads `guard denials: 2 (guard-tests 1, guard-commit 1)`, and each call's result is returned to the engine exactly as it resolved
- **AND** the same `guard-tests:` text a second time toasts nothing more and the count reads `3`, and a driver-line step crossing between them is still read as a step

#### Scenario: Failure — an errored result that names no guard, and a non-interactive session

- **GIVEN** a live run
- **WHEN** an `Edit` call resolves errored with text naming no guard, a `Bash` call resolves errored because the command failed, a `Write` call resolves without error, and the same guard denial crosses a non-interactive session's module
- **THEN** no toast is shown, the pane carries no guard-denial line, and no debug-log line names a guard
- **AND** every result is returned exactly as it resolved

#### Scenario: Edge case — the launch guard's own refusal is spoken, and the settings form's too

- **GIVEN** an interactive session that recorded one ship launch and no human prompt since, and no live run
- **WHEN** a second ship launch is attempted, and separately a first launch in a fresh session is denied by the settings layer with a reason beginning `guard-relaunch:`
- **THEN** the first attempt is refused with the rule's reason and that reason is toasted once, and the second attempt's errored text is toasted once from `guard-relaunch:` on
- **AND** in a non-interactive session the same refusal is returned with no toast, and no launch is recorded for either

## MODIFIED Requirements

### Requirement: The meter SHALL be inert outside a live ship run and in a non-interactive session

The module SHALL record at session start whether the session is interactive and which surface it draws on. In a non-interactive session every hook SHALL return at its first line for the life of the module. In an interactive session the run SHALL become live only when a Workflow tool call that names the plugin's ship workflow returns a result whose status says it launched, and SHALL stop being live when a close or halt step is observed. The run SHALL also end at the engine's session boundary: a classic session-start event whose source is `clear`, `resume` or `fork` SHALL cancel the interval, reset the run record, clear the status line and redraw the pane to its no-run text, while a source of `startup` or `compact` SHALL leave the run as it is. While no run is live, every tool call, model request and turn SHALL pass through untouched, with no tally, no status line and no toast, with one exception: the launch guard's refusal, the module's own or the settings form's read off the errored result, SHALL be toasted in any interactive session, because a relaunch is by nature attempted after the run it repeats has closed. The first step record that crosses after a boundary SHALL be named once on the debug log and otherwise ignored.

#### Scenario: Happy path — an accepted ship launch makes the run live, and the close ends it

- **GIVEN** an interactive session
- **WHEN** a Workflow call whose `scriptPath` ends in `workflows/ship.js` returns `status: 'async_launched'` with a `runId`
- **THEN** the run is live and the result's `runId`, `workflowName` and `transcriptDir` are kept
- **AND** when a step whose action is `close` or `halt` is later observed, the run is no longer live, the status line is cleared and the interval has ended

#### Scenario: Failure — a non-interactive session records nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** the same launch, Bash results, model requests and turns are raised, and an `Edit` a guard denied crosses
- **THEN** no tally exists, no status line is set, no toast is shown and no interval is started
- **AND** every hook resolved to what the engine would have done alone

#### Scenario: Edge case — a non-ship workflow and a refused launch

- **GIVEN** an interactive session
- **WHEN** a Workflow call names another script, or a ship launch returns an error or a deny
- **THEN** the run is not live
- **AND** a later Bash result carrying a step record changes nothing

#### Scenario: Happy path — a clear, a resume or a branch ends the run the module holds

- **GIVEN** a live run with a status line set, a wave row and the interval running
- **WHEN** a classic session-start event with source `clear`, `resume` or `fork` crosses the module
- **THEN** the status line is cleared, the pane says no ship run is live in this session and the interval is cancelled
- **AND** a step record that crosses afterwards sets no status line and is named once on the debug log as a step with no live run

#### Scenario: Failure — a boundary event the module cannot act on leaves the engine's behaviour alone

- **GIVEN** a live run and a classic session-start event whose source is missing or not a string
- **WHEN** the event crosses the module
- **THEN** the run is left as it was and the event resolves to what the engine alone would have done
- **AND** nothing is thrown out of the hook

#### Scenario: Edge case — a compaction and the session's first start are not boundaries

- **GIVEN** a live run with a status line set
- **WHEN** a classic session-start event with source `compact` crosses, and separately one with source `startup`
- **THEN** the status line, the wave rows, the tallies and the interval are unchanged after each
- **AND** the next step record is applied as before

#### Scenario: Edge case — a guard's denial with no live run passes through, and the launch guard still speaks

- **GIVEN** an interactive session with no live run
- **WHEN** an `Edit` a settings guard denies crosses the module, and then a ship launch is refused by the launch guard
- **THEN** the `Edit` draws nothing, counts nothing and resolves to the errored result the engine gave
- **AND** the refusal is toasted once in the rule's words

### Requirement: The pane SHALL draw on both surfaces and name the record it is not

`/interlock-meter` SHALL open the pane at any width. At run start the module SHALL open it unasked, and when the engine declines to seat it one toast SHALL say the meter is available by command, with nothing else drawn. The pane SHALL use only elements that draw on the terminal and the Desktop: the change and run id, the current action, the run's last activity time with the quiet word when the cap is reached, the wave table, the per-agent figures, the plan windows the session reports (kind, percent used, reset time) with no threshold and no colour, every banner so far, a refusals section, and after the close or halt the summary the CLI printed, resume card row included. The refusals section SHALL carry the guard-denial count by guard when any was seen, and a launch-guard line reading `launch guard: next launch allowed`, `launch guard: next launch refused: <reason>` in the rule's words, or `launch guard: facts unreadable; the next launch is allowed`, decided by the same rule and the same state read the guard's branch uses. When no run is live the pane SHALL say so and SHALL still carry the launch-guard line, because the guard runs in every session. The module SHALL never close the pane itself: after the session boundary it redraws to the no-run text and the person dismisses it.

#### Scenario: Happy path — the pane mounts on both surfaces

- **GIVEN** a live run with one wave row, one banner, a last activity time and one guard denial
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the wave row, the banner, the `last activity` line, the `guard denials: 1 (guard-tests 1)` line and the `launch guard:` line are found by key
- **AND** the plan-window lines carry no colour and no threshold text, and no line carries a tool input

#### Scenario: Failure — the engine declines the unasked open

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the run becomes live and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-meter` opens the meter
- **AND** no pane is drawn until the command is typed

#### Scenario: Edge case — after a halt, and with no run

- **GIVEN** a run that halted and whose close step crossed the module with its summary
- **WHEN** the pane is drawn
- **THEN** it shows the close summary, including its `resume card:` row when the summary carries one, no quiet word, and the guard-denial count the run reached
- **AND** after a session boundary the same pane shows no ship run is live here with the launch-guard line beneath, and in a session with no live run it says the same

#### Scenario: Edge case — the launch-guard line follows the session's record

- **GIVEN** an interactive session with no live run
- **WHEN** the pane is drawn before any launch, then after one accepted ship launch, then after a human prompt, and then with a session-state read that rejects
- **THEN** the line reads `launch guard: next launch allowed`, then `launch guard: next launch refused: ` followed by the rule's reason, then `launch guard: next launch allowed`, then `launch guard: facts unreadable; the next launch is allowed`
- **AND** the state read that rejected is named once on the debug log and nothing is thrown out of the draw

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. The one timer it holds SHALL be the host's own interval, started only for a live run and cancelled with it. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function and that the refusal's toast spells no deny of its own, that the guard names it recognises are exactly the names the four guard scripts print, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every` and the state read and write calls
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive`, `classic.SessionStart` and `tool.call` on `Edit` and `Write` to the meter's events

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` or `$.clock.sleep` added anywhere, or a second `deny` not built by the rule's reason function, or a guard name the four guard scripts do not print
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token or the name
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader throw, or a state read that throws under the launch guard, or an interval callback whose clock read rejects, or a pane draw whose launch-guard read rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the event or the draw resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and the interval keeps its next period
