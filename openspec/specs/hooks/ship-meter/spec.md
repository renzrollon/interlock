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

The module SHALL record at session start whether the session is interactive and which surface it draws on. In a non-interactive session every hook SHALL return at its first line for the life of the module. In an interactive session the run SHALL become live only when a Workflow tool call that names the plugin's ship workflow returns a result whose status says it launched, and SHALL stop being live when a close or halt step is observed. While no run is live, every tool call, model request and turn SHALL pass through untouched, with no tally, no status line and no toast.

#### Scenario: Happy path — an accepted ship launch makes the run live, and the close ends it

- **GIVEN** an interactive session
- **WHEN** a Workflow call whose `scriptPath` ends in `workflows/ship.js` returns `status: 'async_launched'` with a `runId`
- **THEN** the run is live and the result's `runId`, `workflowName` and `transcriptDir` are kept
- **AND** when a step whose action is `close` or `halt` is later observed, the run is no longer live and the status line is cleared

#### Scenario: Failure — a non-interactive session records nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** the same launch, Bash results, model requests and turns are raised
- **THEN** no tally exists, no status line is set and no toast is shown
- **AND** every hook resolved to what the engine would have done alone

#### Scenario: Edge case — a non-ship workflow and a refused launch

- **GIVEN** an interactive session
- **WHEN** a Workflow call names another script, or a ship launch returns an error or a deny
- **THEN** the run is not live
- **AND** a later Bash result carrying a step record changes nothing

### Requirement: The meter SHALL read the run from the CLI's own step records, never from prose

While a run is live, a Bash tool call whose command begins with `interlock ` SHALL be let through, and the CLI's stdout in the resolved result SHALL be read as a step record when it parses as JSON carrying an `action`. From that record the module SHALL take the action, the wave and batch position, the spawns (label, kind, routed model, effort, briefing hash), the banners and the notes, set the status line to the change, the action and the positions, show one toast per banner text not yet shown in this run, and keep every banner for the pane. A result that does not parse, or carries no `action`, SHALL change nothing and leave one debug-log line. The module SHALL recognise no banner by its wording; it displays the list the CLI emitted.

#### Scenario: Happy path — a batch step sets the status line and the wave rows

- **GIVEN** a live run
- **WHEN** a Bash call `interlock run next --results … --json` resolves with a step record whose action is `run-batch`, wave group 2, batch index 0 of a batch count of 2, and two spawns labelled `lane-a` (sonnet, low) and `lane-b` (opus, high)
- **THEN** the status line reads the change, `run-batch`, `wave 2` and `batch 1/2`, and a relayed step that carries no batch position reads the change, the action and `wave 2` alone
- **AND** the pane's wave table carries one row per spawn with its label, routed model and effort

#### Scenario: Failure — a result that is not a step changes nothing

- **GIVEN** a live run
- **WHEN** a Bash call `interlock run next --json` resolves with text that is not JSON, or JSON without an `action`
- **THEN** the status line, the tallies and the banner list are unchanged
- **AND** one line naming the problem reaches the debug log and nothing reaches the transcript

#### Scenario: Edge case — a banner carried across two steps toasts once, and other Bash calls are untouched

- **GIVEN** a live run and a step carrying `banners: ['GRAPH UNAVAILABLE: never built …']`, followed by a step carrying the same banner again
- **WHEN** both results cross the module
- **THEN** exactly one toast with that text is shown and the pane lists it once
- **AND** a Bash call whose command is `npm test` is passed through at the first line, its result unread

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

`/interlock-meter` SHALL open the pane at any width. At run start the module SHALL open it unasked, and when the engine declines to seat it one toast SHALL say the meter is available by command, with nothing else drawn. The pane SHALL use only elements that draw on the terminal and the Desktop: the change and run id, the current action, the wave table, the per-agent figures, the plan windows the session reports (kind, percent used, reset time) with no threshold and no colour, every banner so far, and after the close or halt the summary the CLI printed, resume card row included. When no run is live it SHALL say so.

#### Scenario: Happy path — the pane mounts on both surfaces

- **GIVEN** a live run with one wave row and one banner
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the wave row and the banner are found by key
- **AND** the plan-window lines carry no colour and no threshold text

#### Scenario: Failure — the engine declines the unasked open

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the run becomes live and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-meter` opens the meter
- **AND** no pane is drawn until the command is typed

#### Scenario: Edge case — after a halt, and with no run

- **GIVEN** a run that halted and whose close step crossed the module with its summary
- **WHEN** the pane is drawn
- **THEN** it shows the close summary, including its `resume card:` row when the summary carries one
- **AND** in a session with no live run the pane says no ship run is live here

### Requirement: The hooks module SHALL observe only, and the guarantee SHALL be pinned statically

Every hook in the module SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply. The module SHALL return no deny and no substitute result, register no catch handler, and call no model, prompt submission, session message, process, network, file write or permission check. A `node --test` case SHALL read the module as text and assert its engine calls are a subset of a recorded allow-list and that none of the forbidden tokens appears; `claude plugin validate --strict` SHALL list the same hooks and calls the design records.

#### Scenario: Happy path — the recorded calls and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `calls:` line names only `$.ui.status`, `$.ui.toast`, `$.ui.log`, `$.ui.open`, `$.ui.invalidate`, `$.ui.resolve`, `$.command.register`, `$.session.usage` and `$.session.version`
- **AND** its `hooks:` line names `session.start`, `tool.call` (`Workflow`, `Bash`), `turn.step`, `turn.complete`, `agent.spawn`, `ui.render` (`Spinner`, `Pane`) and `command.run`

#### Scenario: Failure — a forbidden token fails the pin

- **GIVEN** the module with `.catch(` or `$.model.complete` or `tool.check` or `$.fs.write` added anywhere
- **WHEN** `node --test test/spine/mod-pins.test.mjs` runs
- **THEN** it fails naming the token
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the run continues

- **GIVEN** a Bash result that makes the step reader throw
- **WHEN** the engine runs the chain
- **THEN** the tool call resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working

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
