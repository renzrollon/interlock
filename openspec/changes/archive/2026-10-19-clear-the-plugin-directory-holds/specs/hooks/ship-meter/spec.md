## MODIFIED Requirements

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. Its spec-skill observers SHALL read the first word of a submitted prompt and the skill a Skill call names, and pass both on unchanged. The one timer it holds SHALL be the host's own interval, started only for a live ship run and cancelled with it. Its one file read SHALL be `$.fs.read`, used for the preflight file at a human prompt or when one of its two report commands is run, and for a card the file names when `/interlock-handoff` is drawn, and for nothing else: never the trajectory, the spill, a manifest or a wave state. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function and that the refusal's toast spells no deny of its own, that the guard names it recognises are exactly the names the four guard scripts print, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every`, `$.fs.read` and the state read and write calls, and nothing the spec meter added
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive`, `classic.SessionStart` and `tool.call` on `Edit` and `Write` to the meter's events, and lists the `AbovePrompt` band, the `interlock-preflight` and `interlock-handoff` panes and their two commands beside the meter's, then `tool.call` on `Skill` and on `Read`, the `interlock-spec` pane and its command

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

### Requirement: The module SHALL draw the session start's report from the preflight file, and decide nothing from it

In an interactive session, at each prompt a person submits, the module SHALL read `.claude/ship/preflight.json` under the session's working directory and hold the newest report it read, a report being new when its written time differs from the one held. A prompt from any other origin SHALL read nothing, and the engine's classic session-start event SHALL read nothing: the settings hook that writes the file runs inside that event's chain, and the module's hook on the event returns the chain's call as it is. After a classic session boundary (`clear`, `resume`, `fork`) the module SHALL hold no report until the next prompt a person submits. When the file carries a check whose status is `fail` or `warn`, a doctor that did not run or could not be parsed, or an interrupted-run note spoken at that session start, the module SHALL draw the `AbovePrompt` band on both the terminal and the Desktop: the preflight message's first line verbatim; one line per such check reading the doctor's own `status`, `id` and `detail`; each note's banner line verbatim; and a last line with the time the report was written and the `/interlock-preflight` command. A halt resume card SHALL NOT draw the band and SHALL NOT be one of its lines, whether or not the band is drawn for another reason, because a card stays on disk until its change is archived and would otherwise hold the band at every session start in that repository; the two panes show it on request. The band SHALL carry a `Hide` control that collapses it for the rest of the session; a re-read of the report already held SHALL keep the band hidden; a new report the file says was written for a `startup`, `resume` or `clear`, a classic session boundary (`clear`, `resume`, `fork`) and a fresh start SHALL show the next report's band again, while a new report written for a `compact` SHALL keep the band hidden if it was. The module SHALL keep the other plugins' band content beneath its own and SHALL yield the band while a survey holds it. A report that is all ok with no note SHALL draw nothing, whatever cards it lists. A file that is absent, unreadable, or not stamped `interlock.preflight/1` SHALL draw nothing, SHALL drop any report held before it, and SHALL be named once on the debug log until a report is read again. `/interlock-preflight` SHALL open a pane on both surfaces showing the message verbatim, every check with its fix lines, the notes spoken at that session start with whether each mark landed, the cards and the count of cards for archived changes, and every note the hook could not read; with no file it SHALL say so and name the path. The module SHALL compute no verdict, restate no threshold and name no cause: every word it draws is the doctor's, the hook's or the card's, and the time is a date, never a staleness verdict.

#### Scenario: Happy path — a failing check and a spoken note draw the band on both surfaces

- **GIVEN** an interactive session whose preflight file carries a `fail` check `permissions` with its detail, a `warn` check `openspec` with its detail, and one note spoken this session for run `r-1` of change `add-foo`
- **WHEN** the person submits a prompt and the band is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the band carries the preflight's first line, `fail permissions: <detail>`, `warn openspec: <detail>`, the note's `PREVIOUS RUN INTERRUPTED: add-foo run r-1 …` line verbatim, and the report's time
- **AND** pressing `Hide` leaves the band drawing nothing, a second prompt over the same file keeps it so, and `/interlock-preflight` opens a pane listing the two checks with their fix lines and the note with its mark

#### Scenario: Failure — an absent or unreadable file draws nothing and is named once

- **GIVEN** an interactive session whose file read rejects, or resolves to text that is not JSON, or to JSON with another schema
- **WHEN** the person submits a prompt and the band is mounted
- **THEN** the band draws nothing of the module's and the other plugins' content beneath is what it was
- **AND** exactly one debug-log line names the path and the reason, and `/interlock-preflight` says no report is held and names the path

#### Scenario: Edge case — all ok draws nothing, and the boundary redraws

- **GIVEN** a file whose checks are all `ok` or `skip`, with no note and no card
- **WHEN** the person submits a prompt
- **THEN** the band draws nothing of the module's
- **AND** after a `Hide` on a later report, a prompt over a new file with one `warn` check written for a `clear` draws that report again, while a new file written for a `compact` keeps the band hidden

#### Scenario: Edge case — halt resume cards alone draw nothing, and the panes still show them

- **GIVEN** a file whose checks are all `ok` or `skip`, with no note, listing two halt resume cards of open changes
- **WHEN** the person submits a prompt and the band is mounted on `terminal` and then on `desktop`
- **THEN** the band draws nothing of the module's on either surface
- **AND** `/interlock-handoff` renders each card newest first, and `/interlock-preflight` lists both

#### Scenario: Edge case — the classic session-start event reads nothing, and the next prompt draws

- **GIVEN** an interactive session whose preflight file carries one `warn` check, and a report already drawn from an earlier prompt
- **WHEN** the classic session-start event is raised with source `startup`, and then with source `clear`
- **THEN** neither event reads the file, and after the `clear` the band draws nothing of the module's
- **AND** the next prompt a person submits reads the file once and draws that report's band again

#### Scenario: Edge case — a non-interactive session reads nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** a prompt is submitted and the classic session-start event resolves
- **THEN** no file is read and no band or pane is drawn
- **AND** the event resolves to what the engine would have done alone

## ADDED Requirements

### Requirement: The classic session-start hook SHALL return the forward call itself, and the shape SHALL be pinned statically

The module's hook on the engine's classic session-start event SHALL do its boundary work before the chain and SHALL return the call of the next handler on the event it was given, with nothing bound to that call, awaited on it or chained after it, so that the event's result (its context, its first message, its block and its stop reason) is the chain's own and never the module's. The hook SHALL read no file, SHALL change no field of the event, and SHALL add no field to the result. A `node --test` case SHALL read the hook as text and fail when its return is any other shape, because the plugin directory holds a version whose session-start hook it cannot read as leaving the session's first message alone, and no local command reproduces that reading.

#### Scenario: Happy path — every source resolves to the chain's own result

- **GIVEN** an interactive session and a handler beneath the module that answers a result carrying a context line and a first message
- **WHEN** the classic session-start event is raised with source `startup`, `clear`, `resume`, `fork` and `compact` in turn
- **THEN** each resolves to that handler's result, field for field
- **AND** no file is read by any of the five, and the three boundary sources end the run the module held before the handler beneath is called

#### Scenario: Failure — any other return shape fails the pin

- **GIVEN** the hook rewritten to continue the forward call with `.then(` or `.finally(`, or to await the call into a variable and return the variable, or to return an object of its own, or to return nothing
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the classic session-start hook and the shape it found
- **AND** no session and no directory scan is needed to find it

#### Scenario: Edge case — a non-interactive session passes the event on and resets nothing

- **GIVEN** `session.start` reporting `isInteractive: false`, and a handler beneath that answers a result
- **WHEN** the classic session-start event is raised with source `clear`
- **THEN** it resolves to that handler's result
- **AND** no status line is set, no draw is requested and no file is read
