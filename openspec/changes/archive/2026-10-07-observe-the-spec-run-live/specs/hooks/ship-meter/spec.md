## MODIFIED Requirements

### Requirement: The meter SHALL be inert outside a live ship run and in a non-interactive session

The module SHALL record at session start whether the session is interactive and which surface it draws on. In a non-interactive session every hook SHALL return at its first line for the life of the module. In an interactive session the run SHALL become live only when a Workflow tool call that names the plugin's ship workflow returns a result whose status says it launched, and SHALL stop being live when a close or halt step is observed. The run SHALL also end at the engine's session boundary: a classic session-start event whose source is `clear`, `resume` or `fork` SHALL cancel the interval, reset the run record, clear the status line and redraw the pane to its no-run text, while a source of `startup` or `compact` SHALL leave the run as it is. While no ship run is live, every tool call, model request and turn SHALL pass through untouched by the ship meter, with no tally, no ship status line and no toast, with one exception: the launch guard's refusal, the module's own or the settings form's read off the errored result, SHALL be toasted in any interactive session, because a relaunch is by nature attempted after the run it repeats has closed. The first step record that crosses after a boundary SHALL be named once on the debug log and otherwise ignored. Outside a live run, besides that refusal toast, the meter pane's no-run text with its launch-guard line, and the spec meter's status line and pane while a spec run is live or stopped at its checkpoint (`hooks/spec-meter`), the module SHALL draw exactly two things, both from the preflight file the SessionStart hook wrote for this session start: the session-start band with its `/interlock-preflight` pane, and the `/interlock-handoff` pane, read from that file and from the cards it names and from nothing else. Everything else SHALL stay inert: in a repository with no preflight file the module reads at each human prompt, finds nothing, names it once on the debug log and draws nothing. The module SHALL own one status line, composed in one place: the ship position while a ship run is live, otherwise the spec meter's line while a spec run is live or stopped at its checkpoint, otherwise nothing; an accepted ship launch SHALL end any spec run before the ship run becomes live, so the two never write the line at once.

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
- **THEN** the status line is cleared, the pane says no ship run is live in this session, and the interval is cancelled
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

#### Scenario: Edge case — the session-start band is the one thing drawn with no run

- **GIVEN** an interactive session with no ship launch and a preflight file carrying one `warn` check
- **WHEN** the person submits a prompt and the band, the meter pane and the spinner are mounted
- **THEN** the band carries the warning, the meter pane says no ship run is live, the spinner is passed through unchanged and no status line is set
- **AND** in a repository with no preflight file the same session draws nothing anywhere and leaves one debug-log line naming the file

#### Scenario: Edge case — a spec run holds the line until a ship launch takes it

- **GIVEN** an interactive session with a live spec run whose status line reads `interlock spec: add-the-thing · ready true`
- **WHEN** a Workflow call naming `workflows/ship.js` returns `status: 'async_launched'` with a `runId`
- **THEN** the status line reads the ship position and never both lines, the ship run is live and the spec run is not
- **AND** while no ship run is live and no spec run is live, the status line is cleared

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. Its spec-skill observers SHALL read the first word of a submitted prompt and the skill a Skill call names, and pass both on unchanged. The one timer it holds SHALL be the host's own interval, started only for a live ship run and cancelled with it. Its one file read SHALL be `$.fs.read`, used for the preflight file at a human prompt or a session start and for a card the file names when `/interlock-handoff` is drawn, and for nothing else: never the trajectory, the spill, a manifest or a wave state. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function and that the refusal's toast spells no deny of its own, that the guard names it recognises are exactly the names the four guard scripts print, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every`, `$.fs.read` and the state read and write calls, and nothing the spec meter added
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive`, `classic.SessionStart` and `tool.call` on `Edit` and `Write` to the meter's events, and lists the `AbovePrompt` band, the `interlock-preflight` and `interlock-handoff` panes and their two commands beside the meter's, then `tool.call` on `Skill`, the `interlock-spec` pane and its command

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` or `$.fs.list` or `$.clock.sleep` added anywhere, or a second `deny` not built by the rule's reason function, or a guard name the four guard scripts do not print, or a prompt or Skill hook that returns `{ text }` of its own
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token, the name or the call outside the allow-list
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader or the spec line reader throw, or a state read that throws under the launch guard, or an interval callback whose clock read rejects, or a pane draw whose launch-guard read rejects, or a preflight file read that rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the prompt, the session-start event or the draw resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and the interval keeps its next period
