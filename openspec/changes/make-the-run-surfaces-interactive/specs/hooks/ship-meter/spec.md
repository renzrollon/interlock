# Spec Delta

## MODIFIED Requirements

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, an empty command reply, or the suggestion rows this capability allows placed ahead of the engine's own, with one exception: the launch guard's `tool.call` branch on the Workflow tool MAY return a deny, and only the deny the shared launch rule produced from recorded facts, with no number and no judgement of its own. The module SHALL return no other deny and no substitute result, register no catch handler, and call no model, prompt submission, command run, tool call, session message, process, network, file write or permission check. It MAY read the prompt box, fill it, copy a line to the clipboard and ask the engine for a notification, each only as the drafting and notification requirements of this capability allow and each from one call site. Its spec-skill observers SHALL read the first word of a submitted prompt and the skill a Skill call names, and pass both on unchanged; its settle-skill observer SHALL read the same two events for the settle skill and the review-code skill, and of the arguments only the presence of `--review`, and pass both on unchanged. The one timer it holds SHALL be the host's own interval, started only for a live ship run and cancelled with it; the settle meter SHALL add none. Its one file read SHALL be `$.fs.read`, used for the preflight file at a human prompt, at the first suggestion request of a session that holds no report, or when one of its two report commands is run, and for a card the file names when `/interlock-handoff` is drawn, and for nothing else: never the trajectory, the spill, a manifest, a wave state, a settle record or a change's artifact. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list, that none of the forbidden tokens appears, that `$.prompt.read(`, `$.prompt.fill(`, `$.ui.copy(` and `$.ui.notify(` are each spelled one time, that the only `deny` it returns is built by the rule module's reason function and that the refusal's toast spells no deny of its own, that the guard names it recognises are exactly the names the four guard scripts print, and that its session-state keys match the plugin's type contract; `claude plugin validate --strict` SHALL list the same hooks, calls and state keys the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs on an engine at or above the mods floor
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.ui.scroll`, `$.ui.notify`, `$.ui.copy`, `$.prompt.read`, `$.prompt.fill`, `$.command.register`, `$.session.usage`, `$.session.version`, `$.clock.now`, `$.clock.every`, `$.fs.read` and the state read and write calls, and nothing the spec meter or the settle meter added
- **AND** its `hooks:` line adds `prompt.submit`, `session.receive`, `classic.SessionStart` and `tool.call` on `Edit` and `Write` to the meter's events, and lists the `AbovePrompt` band, the `interlock-preflight` and `interlock-handoff` panes and their two commands beside the meter's, then `tool.call` on `Skill` and on `Read`, the `interlock-spec` pane and its command, then the `interlock-settle` pane and its command, then `prompt.autocomplete`

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` or `$.fs.list` or `$.clock.sleep` or `$.prompt.submit` or `$.command.run` or `$.tool.call` added anywhere, or a second `$.prompt.fill(`, `$.ui.copy(`, `$.prompt.read(` or `$.ui.notify(`, or a second `deny` not built by the rule's reason function, or a guard name the four guard scripts do not print, or a prompt or Skill hook that returns `{ text }` of its own, or a `$.clock.every` started for a settle run
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token, the name or the call outside the allow-list
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader, the spec line reader or the settle line reader throw, or a state read that throws under the launch guard, or an interval callback whose clock read rejects, or a pane draw whose launch-guard read rejects, or a preflight file read that rejects, or a suggestion request whose row builder throws
- **WHEN** the engine runs the chain
- **THEN** the tool call, the prompt, the session-start event, the draw or the suggestion request resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and the interval keeps its next period

### Requirement: The module SHALL show a halt resume card on request, verbatim and bounded by a published cap

`/interlock-handoff` SHALL open a pane on both surfaces that lists every card the preflight file recorded and renders each one through the `Markdown` element, newest written first, reading each card from the absolute path the file named at draw time. A card longer than the cap `interlock limits` prints as `handoff pane chars` SHALL be cut to that cap with a visible line inside the rendered text saying how many characters were left out and naming the file, so the element is never refused for its length; the cap SHALL be a key in the limits definition, read under `lib/` by the pure module the hooks module imports, and restated nowhere in the module. A card that cannot be read SHALL be named with its path and the reason. With no card recorded the pane SHALL say so and name the directories the preflight looked in; with no preflight file it SHALL say so and name the path. Beneath each card it read, the pane SHALL carry one control for each command line the card printed, taken from the card's whole text before the cut, as the drafting requirement of this capability defines; a card that could not be read SHALL carry none. The module SHALL NOT act on a card: no control runs a command or submits a prompt, nothing is marked, moved or deleted, and the card's own sentence that nothing reads it back to decide is shown as written.

#### Scenario: Happy path — a card renders on both surfaces

- **GIVEN** a preflight file recording one card for change `add-foo`, run `r-1`, and a card file whose first line is its stamp and whose body carries `# Ship halted — add-foo`
- **WHEN** `/interlock-handoff` is typed and the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the pane carries the card's listing line with `add-foo`, `r-1` and the written time, and the card's body is rendered as markdown with its heading and its record-not-trigger sentence
- **AND** no element of the pane runs a command or writes anything

#### Scenario: Failure — a card that cannot be read is named

- **GIVEN** a preflight file recording a card whose path no longer exists
- **WHEN** the pane is drawn
- **THEN** it carries one line naming that path and the reason the read failed, and no control for that card
- **AND** the other cards, if any, are rendered as before

#### Scenario: Edge case — a card over the cap is cut visibly, and no card says so

- **GIVEN** a card whose text is longer than the published cap
- **WHEN** the pane is drawn
- **THEN** the rendered text is no longer than the cap and ends with a line naming how many characters were left out and the card's path
- **AND** a command line the card printed after the cut still has its control
- **AND** with no card recorded the pane says no card is on disk and names the directories looked in, and with no preflight file it names the file's path

#### Scenario: Edge case — a card's printed lines become controls, in the order printed

- **GIVEN** a card for run `r-1` of change `add-foo` whose fenced block prints `interlock run-log show r-1` and `interlock run-log query --run r-1 --halted`, and whose last step prints `/interlock:ship add-foo` in a code span
- **WHEN** the pane is drawn on `terminal` and on `desktop`
- **THEN** beneath the card, in that order, are the controls `Draft: interlock run-log show r-1`, `Draft: interlock run-log query --run r-1 --halted` and `Draft: /interlock:ship add-foo`
- **AND** a line the card printed twice has one control

## ADDED Requirements

### Requirement: A pane control SHALL draft a line the pane printed, and SHALL never submit it or replace a typed draft

A control's line SHALL be one `printedCommands` (`lib/run-actions.mjs`) returned from text the pane renders: a fenced line or code span beginning `interlock `, `/interlock:` or `claude --resume `. A line holding an angle-bracket placeholder SHALL get no control. A press SHALL fill the prompt box with the line only when the box reads empty; otherwise, and always for a `claude --resume` line, it SHALL copy it and toast that it did. No press SHALL submit a prompt, run a command or call a tool.

#### Scenario: Happy path — an empty box is filled with the printed line

- **GIVEN** a halt card drawn in `/interlock-handoff` whose fenced block prints `interlock run-log show r-1`, and an empty prompt box
- **WHEN** the control labelled `Draft: interlock run-log show r-1` is pressed
- **THEN** the prompt box is filled with exactly `interlock run-log show r-1`
- **AND** no prompt was submitted, no command was run, and nothing was copied

#### Scenario: Failure — a typed draft is kept and the line is copied

- **GIVEN** the same card and a prompt box holding `half a thought`
- **WHEN** the control is pressed
- **THEN** the box is not filled, the copy call is handed `interlock run-log show r-1`, and one toast says the line was copied because the box holds a draft
- **AND** when the engine answers the copy with `isCopied: false`, or the copy rejects, one toast spells the line and says it could not be copied

#### Scenario: Edge case — a placeholder line, a resume line and a refused read

- **GIVEN** a card printing `interlock tasks tick add-foo --ids <the ids above you verified are done>` in a fenced block and `claude --resume s-9 --fork-session` in a code span
- **WHEN** the pane is drawn
- **THEN** no control carries the `tasks tick` line, and the resume line's control is labelled `Copy: claude --resume s-9 --fork-session`
- **AND** pressing it copies the line whatever the box holds and fills nothing
- **AND** a press whose prompt read rejects, or whose fill answers `isFilled: false`, copies the line and toasts that it did

### Requirement: The meter pane SHALL draw the plan as a diagram above the board where the surface draws SVG, and SHALL keep the board on every surface

On a surface other than `terminal`, whenever the meter pane draws a plan board it SHALL draw one `Svg` element above it, built by `lib/draw-plan-svg.mjs` from the rows the board is drawn from, with `alt` equal to those rows' text. The terminal SHALL draw no `Svg`. When the renderer answers that the document is over the published bound, the pane SHALL draw one line saying so in the diagram's place. The board itself SHALL be drawn as it is today on every surface.

#### Scenario: Happy path — the desktop draws the diagram above the unchanged board

- **GIVEN** a live ship run whose relayed plan holds two waves, the second with a lane ordered after a lane of the first
- **WHEN** the meter pane is drawn on `desktop`
- **THEN** it holds one `Svg` element placed before the board's first row, whose `alt` is the text of the board's rows
- **AND** every board row reads the text it reads on `terminal`

#### Scenario: Failure — a plan over the bound says so and keeps the board

- **GIVEN** a plan whose diagram would be longer than the cap `interlock limits` prints for the plan diagram
- **WHEN** the meter pane is drawn on `desktop`
- **THEN** no `Svg` element is drawn, one line says the diagram was left out and names the cap by its limits label
- **AND** the board is drawn in full

#### Scenario: Edge case — the terminal draws no diagram, and a run with no plan draws none

- **GIVEN** the same live run with its plan
- **WHEN** the meter pane is drawn on `terminal`
- **THEN** no `Svg` element is drawn and the board is the first thing in the wave section
- **AND** on `desktop`, a run whose plan has not been relayed draws no `Svg` and no line about one
- **AND** on `desktop`, a board below its minimum width draws its one spoken line, no `Svg` and no second line about the diagram

### Requirement: The module SHALL tell a halt, a close, a quiet run and a checkpoint one time each, and SHALL toast the same words when no notification was sent

In an interactive session the module SHALL ask the engine for one notification when a ship run halts, when a run that did not halt closes, when the quiet word first appears in a quiet stretch, and when a spec run reaches its checkpoint. `lib/run-tell.mjs` SHALL build the words from fields the module holds and SHALL add no verdict. When the engine answers that none was sent, or the call rejects, the module SHALL toast the same words. A state already told SHALL NOT be told again.

#### Scenario: Happy path — a halt is told when it happens and not again at the close

- **GIVEN** an interactive session with a live ship run for `add-foo`, and an engine that answers the notification call `isSent: true`
- **WHEN** a halt step naming the reason `unit failures after 2 fix attempts` crosses the module, and then the run's close record
- **THEN** one notification is asked for, whose text names `add-foo`, the word `halted` and that reason
- **AND** the close record asks for none, and no toast repeats the words
- **AND** a run that closes with no halt step is told one time at its close record, with `add-foo` and that record's exit code

#### Scenario: Failure — an engine that sends nothing gets a toast in the same words

- **GIVEN** an interactive session and an engine that answers the notification call `isSent: false` with reason `no-channel`
- **WHEN** a spec run for `add-the-thing` reaches its checkpoint
- **THEN** one toast reads the status line's text, `interlock spec: add-the-thing · checkpoint`
- **AND** a notification call that rejects gets the same toast, and the run record is unchanged

#### Scenario: Edge case — quiet is told per stretch, and a session that is not interactive is told nothing

- **GIVEN** an interactive session with a live ship run whose quiet word appears, stays for four more ticks, clears when a tool call crosses, and appears again
- **WHEN** the ticks cross the module
- **THEN** two notifications are asked for, one at each first appearance, each reading the status line's text at that tick
- **AND** in a session the engine reported as not interactive, no notification is asked for and no toast is raised for any of the four states

### Requirement: The module SHALL suggest open change names and recent run ids for the plugin's own commands, and SHALL leave every other draft to the engine

On `prompt.autocomplete` in an interactive session the module SHALL add rows only when `lib/prompt-rows.mjs` reads the token under the cursor as the change-name or run-id argument of a plugin command. The rows SHALL be the held report's names that begin with the token, at most the published row cap, ahead of the engine's rows when its answer has the pinned shape; otherwise it SHALL return `next(e)` unchanged. With no report held it SHALL read the preflight file once per session.

#### Scenario: Happy path — a ship command is offered the open changes that match

- **GIVEN** an interactive session holding a preflight report whose open changes are `add-foo`, `add-bar` and `fix-baz`, and a draft `/interlock:ship add-` with the cursor at its end
- **WHEN** the engine asks for suggestions
- **THEN** the answer's first rows are `add-foo` and `add-bar`, each with the description that it is an open change, followed by whatever rows the engine's own answer held
- **AND** a draft `interlock run-log show r-` is offered the report's recent run ids that begin `r-`, and no change name

#### Scenario: Failure — no list, no rows

- **GIVEN** an interactive session whose preflight report holds `null` for its open changes, or a session with no report whose one file read gave none
- **WHEN** the engine asks for suggestions on the draft `/interlock:ship add-`
- **THEN** the answer is the engine's own, unchanged, and no further file read is made for a later request in that session
- **AND** the first such request in the session writes one debug-log line naming which input was missing, `no preflight report` or the list that is `null`, and a later request writes none
- **AND** when the engine's own answer is not a list of rows, the answer is the engine's own, unchanged, with no row of the module's added, and one debug-log line says so

#### Scenario: Edge case — another command, another argument, and more names than the cap

- **GIVEN** a held report with twenty open changes that begin `add-`
- **WHEN** the engine asks for suggestions on `/interlock:ship add-`
- **THEN** the module adds no more rows than the cap `interlock limits` prints for suggestion rows, the newest first as the report lists them
- **AND** the drafts `fix the tests in add-`, `/interlock:ship add-foo --str` and `/interlock:shi` get the engine's own answer unchanged
- **AND** every command the row table names is a verb in the CLI's inventory or a skill the plugin ships, and a test fails naming one that is neither

### Requirement: Below the mods floor a loaded module SHALL draw, tell and suggest nothing, SHALL say so one time, and SHALL keep the launch guard

At `session.start`, when the engine reports a version below `MODS_MIN_HOST_VERSION`, the module SHALL treat the session as not interactive for every pane, band, status line, notification and suggestion, and SHALL toast one line naming that version and the floor if the engine reported the session interactive. The launch guard SHALL work as before. An unreadable version SHALL leave the module on. The floor SHALL be read from `lib/host/claude-env.mjs`, never spelled in the module's code.

#### Scenario: Happy path — an engine at the floor draws everything

- **GIVEN** an engine whose version call answers the value of `MODS_MIN_HOST_VERSION`, in an interactive session
- **WHEN** the session starts and a ship run goes live
- **THEN** the status line, the panes, the notification and the suggestions work as this capability describes
- **AND** no toast names a version

#### Scenario: Failure — an engine below the floor is told one time and the guard still denies

- **GIVEN** an engine whose version call answers a version one patch below the floor, in an interactive session
- **WHEN** the session starts, a ship run's steps cross the module, and a second ship launch follows with no human prompt since the first
- **THEN** one toast names that version and the floor and says the panes are off on this engine, and no status line, pane, notification or suggestion row is drawn for the run
- **AND** the second launch is denied with the launch rule's own reason

#### Scenario: Edge case — an unreadable version leaves the module on

- **GIVEN** an engine whose version call rejects, or answers a text that is not a version
- **WHEN** the session starts
- **THEN** the module treats the session as the engine reported it, and one debug-log line says the version could not be read
- **AND** a test fails when a non-comment line of the module spells a version number, and a version named in a `//` comment does not fail it
