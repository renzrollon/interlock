# hooks/ship-meter Specification

## Purpose

Shows a ship run while it runs: a status line, toasts for each degradation banner the moment the CLI raises it, and a pane with the wave rows, the per-agent figures and the plan windows, drawn by a hooks module that observes the run's own step records and decides nothing.

## Requirements

### Requirement: The plugin SHALL ship a hooks module beside its settings hooks, and the settings hooks SHALL be unchanged by it

The plugin SHALL carry `hooks/hooks.json` naming exactly one hooks module under `modules` and carrying an empty `hooks` record beside it, because a host inside the plugin's floor reads that path as the legacy settings-hooks file and refuses it without one. The module SHALL be an ES module that exports `register(on)`, imports only modules inside the plugin that themselves import no `node:` module, and is named with a suffix the host loads. The manifest's inline `hooks` registrations (the guards, the preflight and the recorder) SHALL be unchanged, and on a host that cannot load mods every settings hook SHALL run exactly as before.

#### Scenario: Happy path — one module, present and loadable

- **GIVEN** the plugin checkout
- **WHEN** the pin test reads `hooks/hooks.json`
- **THEN** its `modules` array names exactly one path, that file exists, and its source exports `register`
- **AND** every relative import in the module resolves to a file inside the plugin whose own imports name no `node:` module
- **AND** its `hooks` key is present and an empty object

#### Scenario: Failure — a host below the mods floor still runs every settings hook

- **GIVEN** a Claude Code binary below the mods floor loading the plugin through `--plugin-dir`
- **WHEN** a session starts and a ship launch is attempted twice without a prompt between
- **THEN** the preflight runs and the relaunch guard denies, as they do without the hooks module
- **AND** the registration pins over the manifest's inline `hooks` pass with `hooks/hooks.json` present

#### Scenario: Failure — a file without the legacy `hooks` record fails the pin

- **GIVEN** `hooks/hooks.json` reduced to `{ "modules": ["./mod.mjs"] }`, which Claude Code 2.1.161 refuses with `hooks: Invalid input: expected record, received undefined`
- **WHEN** the pin test reads it
- **THEN** it fails naming the missing `hooks` key
- **AND** a `hooks` record that registers any settings hook fails the pin too, because the settings hooks live in the manifest

#### Scenario: Edge case — a module that reaches Node fails the pin

- **GIVEN** a hooks module that imports `lib/ship-stage.mjs`, which imports `node:fs`
- **WHEN** the pin test walks the module's imports
- **THEN** it fails naming the import and the `node:` module it reaches

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

### Requirement: Per-agent figures SHALL be display-only, labelled live, and never invented

While a run is live, each model request that carries an agent id SHALL add its reported usage and the model that answered to that agent's tally, and each agent's turn end SHALL keep its reason and duration. A request that reports no usage SHALL count as a request with unknown tokens, marking the agent's total partial, never as zero. When the host raises the spawn event for the runtime's agents, the module SHALL map the resolved agent id to the briefing hash in the spawn's prompt so the row carries its lane label; otherwise the row SHALL be keyed by agent id and say its lane is unknown. Every figure SHALL be presented as live, with a line saying the close summary and the receipt are the record.

#### Scenario: Happy path — two agents tally separately with the model each reported

- **GIVEN** a live run
- **WHEN** model requests resolve for agent ids `a1` (twice, served by `claude-sonnet-5-5`) and `a2` (once, served by `claude-opus-5-5`)
- **THEN** the pane shows two rows, each with its own token totals and the model it reported
- **AND** no figure from one agent appears in the other's row

#### Scenario: Failure — a request without a usage figure marks the tally partial

- **GIVEN** a live run and agent `a1` with one request that resolved with `usage: null`
- **WHEN** the pane is drawn
- **THEN** that agent's token figures read as partial, with the request counted and its tokens unknown
- **AND** nothing reads `0` for the missing request

#### Scenario: Edge case — a second model in one agent's requests, and an agent with no spawn event

- **GIVEN** a live run where agent `a1` reports `claude-sonnet-5-5` on one request and `claude-sonnet-4-5` on the next, and no spawn event was raised for it
- **WHEN** the pane is drawn
- **THEN** `a1`'s row lists both models and its lane reads unknown
- **AND** the row makes no verdict about substitution

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

### Requirement: The mod's tests SHALL run under `claude plugin test` and SHALL never be collected by `npm test`

The module's tests SHALL live under `test/mod/`, be named `*.test.ts` or `*.test.tsx`, exercise the hooks through the engine's own test kit on both surfaces, and run in CI after the strict validate. `npm test` SHALL collect only `*.test.mjs`, so the one `.test.ts` exception never reaches the Node runner. A host on which mods cannot load SHALL fail the test step, never pass it silently.

#### Scenario: Happy path — the kit runs the mod's tests

- **GIVEN** a host at or above the mods floor and the plugin checkout
- **WHEN** `claude plugin test .` runs
- **THEN** every file under `test/mod/` runs and the command exits `0`
- **AND** the CI `validate-plugin` job runs that command after `claude plugin validate . --strict`

#### Scenario: Failure — a host that cannot load mods fails the step

- **GIVEN** a host where hooks modules are turned off
- **WHEN** `claude plugin test .` runs
- **THEN** it prints the line saying hooks modules are turned off and exits `1`
- **AND** CI reads that as a failed job, not a skipped one

#### Scenario: Edge case — the Node runner never sees the kit's tests

- **GIVEN** `test/mod/meter.test.ts` present
- **WHEN** `npm test` runs on Node 18, 20 or 22
- **THEN** no `.test.ts` file is collected and the suite's count is unchanged by the file
- **AND** a pin asserts the `test` script's file pattern names `*.test.mjs` only

### Requirement: The meter SHALL say how long a live run has been quiet, from a published cap

While a run is live the module SHALL keep the time of the run's last activity, as the engine reports it: the accepted launch, each step record the CLI printed, each model request a run agent started and each answer it received, each run agent's turn end, and each spawn. The quiet time SHALL be the time now less that stamp, never negative. Once it reaches the cap `interlock limits` prints as the meter's quiet threshold, the status line, the spinner suffix and the pane SHALL carry the word `quiet <n> min`, `<n>` the whole minutes, and the next activity SHALL clear it. The figure SHALL be recomputed on an interval the host runs for the module at the period `interlock limits` prints as the meter's tick, started when the run becomes live and ended at the close, the halt and the session boundary. The module SHALL name no cause for the quiet: the plan windows stay beside it on the pane as the host reported them, with no threshold text. A time the module could not read SHALL leave the stamp as it was and the word absent, never a guessed figure. Both caps SHALL be keys in the limits definition, printed by `interlock limits`, read under `lib/` by the pure module the hooks module imports, and restated nowhere.

#### Scenario: Happy path — the word appears at the cap and the next step clears it

- **GIVEN** an interactive session whose run became live at time T and whose last step crossed at T
- **WHEN** the mocked clock advances to T plus the quiet threshold
- **THEN** the status line ends in `quiet <n> min` with the position before it, the spinner suffix ends the same way, and the pane carries the word beside `last activity` and its time
- **AND** when a later step record crosses the module, the word is gone from all three and the pane's `last activity` is the new time

#### Scenario: Failure — a clock that cannot be read guesses nothing

- **GIVEN** a live run whose clock read rejects from the second step on
- **WHEN** steps and model requests keep crossing the module and the interval fires
- **THEN** the stamp stays at the last time the clock answered, the word is absent, the pane says `last activity unknown` when no time was ever read, and every hook resolved to what the engine alone would have done
- **AND** the interval's failure is named once on the debug log and never thrown

#### Scenario: Edge case — the boundary of the cap, and a lane that thinks without a step

- **GIVEN** a live run whose last activity was at T
- **WHEN** the clock reads T plus the threshold less one millisecond
- **THEN** no word is shown
- **AND** at T plus the threshold exactly the word reads `quiet <n> min` with `<n>` the threshold in whole minutes, and under one minute it reads `quiet <1 min`
- **AND** a run agent's model request that answers with no step record between counts as activity, so a lane that is thinking is never called quiet

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
