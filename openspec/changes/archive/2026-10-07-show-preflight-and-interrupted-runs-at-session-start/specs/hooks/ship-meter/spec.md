## ADDED Requirements

### Requirement: The module SHALL draw the session start's report from the preflight file, and decide nothing from it

In an interactive session, at each prompt a person submits, and once the engine's classic session-start event has run the settings hooks wherever the engine raises that event to a module, the module SHALL read `.claude/ship/preflight.json` under the session's working directory and hold the newest report it read, a report being new when its written time differs from the one held. A prompt from any other origin SHALL read nothing. When the file carries a check whose status is `fail` or `warn`, a doctor that did not run or could not be parsed, an interrupted-run note spoken at that session start, or a halt resume card, the module SHALL draw the `AbovePrompt` band on both the terminal and the Desktop: the preflight message's first line verbatim; one line per such check reading the doctor's own `status`, `id` and `detail`; each note's banner line verbatim; each card's path with its change, run id and written time and the `/interlock-handoff` command; and a last line with the time the report was written and the `/interlock-preflight` command. The band SHALL carry a `Hide` control that collapses it for the rest of the session; a re-read of the report already held SHALL keep the band hidden; a new report the file says was written for a `startup`, `resume` or `clear`, a classic session boundary (`clear`, `resume`, `fork`) and a fresh start SHALL show the next report's band again, while a new report written for a `compact` SHALL keep the band hidden if it was. The module SHALL keep the other plugins' band content beneath its own and SHALL yield the band while a survey holds it. A report that is all ok with no note and no card SHALL draw nothing. A file that is absent, unreadable, or not stamped `interlock.preflight/1` SHALL draw nothing, SHALL drop any report held before it, and SHALL be named once on the debug log until a report is read again. `/interlock-preflight` SHALL open a pane on both surfaces showing the message verbatim, every check with its fix lines, the notes spoken at that session start with whether each mark landed, the cards and the count of cards for archived changes, and every note the hook could not read; with no file it SHALL say so and name the path. The module SHALL compute no verdict, restate no threshold and name no cause: every word it draws is the doctor's, the hook's or the card's, and the time is a date, never a staleness verdict.

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

#### Scenario: Edge case — a non-interactive session reads nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** a prompt is submitted and the classic session-start event resolves
- **THEN** no file is read and no band or pane is drawn
- **AND** the event resolves to what the engine would have done alone

### Requirement: The module SHALL show a halt resume card on request, verbatim and bounded by a published cap

`/interlock-handoff` SHALL open a pane on both surfaces that lists every card the preflight file recorded and renders each one through the `Markdown` element, newest written first, reading each card from the absolute path the file named at draw time. A card longer than the cap `interlock limits` prints as `handoff pane chars` SHALL be cut to that cap with a visible line inside the rendered text saying how many characters were left out and naming the file, so the element is never refused for its length; the cap SHALL be a key in the limits definition, read under `lib/` by the pure module the hooks module imports, and restated nowhere in the module. A card that cannot be read SHALL be named with its path and the reason. With no card recorded the pane SHALL say so and name the directories the preflight looked in; with no preflight file it SHALL say so and name the path. The module SHALL NOT act on a card: no button runs a command, nothing is marked, moved or deleted, and the card's own sentence that nothing reads it back to decide is shown as written.

#### Scenario: Happy path — a card renders on both surfaces

- **GIVEN** a preflight file recording one card for change `add-foo`, run `r-1`, and a card file whose first line is its stamp and whose body carries `# Ship halted — add-foo`
- **WHEN** `/interlock-handoff` is typed and the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the pane carries the card's listing line with `add-foo`, `r-1` and the written time, and the card's body is rendered as markdown with its heading and its record-not-trigger sentence
- **AND** no element of the pane runs a command or writes anything

#### Scenario: Failure — a card that cannot be read is named

- **GIVEN** a preflight file recording a card whose path no longer exists
- **WHEN** the pane is drawn
- **THEN** it carries one line naming that path and the reason the read failed
- **AND** the other cards, if any, are rendered as before

#### Scenario: Edge case — a card over the cap is cut visibly, and no card says so

- **GIVEN** a card whose text is longer than the published cap
- **WHEN** the pane is drawn
- **THEN** the rendered text is no longer than the cap and ends with a line naming how many characters were left out and the card's path
- **AND** with no card recorded the pane says no card is on disk and names the directories looked in, and with no preflight file it names the file's path

## MODIFIED Requirements

### Requirement: The meter SHALL be inert outside a live ship run and in a non-interactive session

The module SHALL record at session start whether the session is interactive and which surface it draws on. In a non-interactive session every hook SHALL return at its first line for the life of the module. In an interactive session the run SHALL become live only when a Workflow tool call that names the plugin's ship workflow returns a result whose status says it launched, and SHALL stop being live when a close or halt step is observed. The run SHALL also end at the engine's session boundary: a classic session-start event whose source is `clear`, `resume` or `fork` SHALL cancel the interval, reset the run record, clear the status line and redraw the pane to its no-run text, while a source of `startup` or `compact` SHALL leave the run as it is. While no run is live, every tool call, model request and turn SHALL pass through untouched, with no tally, no status line and no toast, and the first step record that crosses after a boundary SHALL be named once on the debug log and otherwise ignored. Outside a live run the module SHALL draw exactly two things, both from the preflight file the SessionStart hook wrote for this session start: the session-start band with its `/interlock-preflight` pane, and the `/interlock-handoff` pane, read from that file and from the cards it names and from nothing else. Everything else SHALL stay inert: in a repository with no preflight file the module reads at each human prompt, finds nothing, names it once on the debug log and draws nothing.

#### Scenario: Happy path — an accepted ship launch makes the run live, and the close ends it

- **GIVEN** an interactive session
- **WHEN** a Workflow call whose `scriptPath` ends in `workflows/ship.js` returns `status: 'async_launched'` with a `runId`
- **THEN** the run is live and the result's `runId`, `workflowName` and `transcriptDir` are kept
- **AND** when a step whose action is `close` or `halt` is later observed, the run is no longer live, the status line is cleared and the interval has ended

#### Scenario: Failure — a non-interactive session records nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** the same launch, Bash results, model requests and turns are raised
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

#### Scenario: Edge case — the session-start band is the one thing drawn with no run

- **GIVEN** an interactive session with no ship launch and a preflight file carrying one `warn` check
- **WHEN** the person submits a prompt and the band, the meter pane and the spinner are mounted
- **THEN** the band carries the warning, the meter pane says no ship run is live, the spinner is passed through unchanged and no status line is set
- **AND** in a repository with no preflight file the same session draws nothing anywhere and leaves one debug-log line naming the file

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. The one timer it holds SHALL be the host's own interval, started only for a live run and cancelled with it. Its one file read SHALL be `$.fs.read`, used for the preflight file at a human prompt or a session start and for a card the file names when `/interlock-handoff` is drawn, and for nothing else: never the trajectory, the spill, a manifest or a wave state. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that the only `deny` it returns is built by the rule module's reason function, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every`, `$.fs.read` and the state read and write calls
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive` and `classic.SessionStart` to the meter's events, and lists the `AbovePrompt` band, the `interlock-preflight` and `interlock-handoff` panes and their two commands beside the meter's

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` or `$.fs.list` or `$.clock.sleep` added anywhere, or a second `deny` not built by the rule's reason function
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token or the call outside the allow-list
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader throw, or a state read that throws under the launch guard, or an interval callback whose clock read rejects, or a preflight file read that rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the prompt or the session-start event resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and the interval keeps its next period
