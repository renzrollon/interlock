## Context

See proposal.md for the motivation. What shapes the approach:

- **The relay today.** `bin/interlock` prints every `run` step through `emitRunStep` (`bin/interlock:1001-1016`), pretty-printed with a two-space indent, and on the Workflow host shapes it through `relayStep` first (`lib/run.mjs:454-468`), which keeps only `RELAY_STEP_FIELDS` (`:431-443`: `schema`, `action`, `then`, `spawns`, `banners`, `change`, `wave`, `reason`, `pingModel`) and each spawn less `prompt`. The exact bytes are also written to `.claude/ship/last-step.json`. Every other host gets the whole step. `test/spine/run.test.mjs:3039-3091` pins the whitelist and the strip; `test/workflows.test.mjs:3012-3031` pins that `workflows/ship.js` reads only whitelisted fields. Neither driver spells `waveIndex`, `batchIndex`, `batchCount`, `skipped`, `recorded` or `plan` today (grep, 2026-10-06).
- **Who reads the relayed bytes.** Two readers, with different exposure. The ship meter reads the ping's `Bash` result `text`, which the 2.1.289 probe found equal to the CLI's stdout less its trailing newline (`openspec/changes/archive/2026-10-05-draw-the-ship-run-live/design.md:137`): what the CLI printed is what the meter parses, whatever its size. The driver reads `cliStdout`, a copy the `interlock:ping` relay model retypes into its structured result (`workflows/ship.js:345-398`); a copy that does not parse is a loud stop, never a guess. A larger step therefore costs the run's relay, not the meter.
- **Where the fields come from.** `waveIndex`, `batchIndex`, `batchCount` and `waveKind` already ride every wave-state step through `PASS_THROUGH` (`lib/run.mjs:1104-1129`). A verify step carries `skipped: true|false` and `reason` from `verifyStep` (`:1342-1372`). `adoptPlan` (`:2519-2589`) creates the run state from the plan and returns the first decorated step at `:2581`; it is reached from `runClassified` (`:2789`) and from the reuse path (`:2488`). `runReplan` (`:3432-3483`) returns the step after a revised plan at `:3482`. `runRecordBatch` (`:2838-3072`) reads one `adjudicateBatches` verdict (`:2064-2095`) for the tally it pushes onto `manifest.waves` (`:3036-3050`) and the ticks (`:3055`), then returns `decorate(ctx, nextRaw, manifest, { banners })` at `:3071`.
- **The plan and the state on disk.** The real halted run's `plan.json` is 21,051 bytes for thirteen tasks; a task carries `id`, `group`, `description` (1,130 characters on average), `tier`, `model`, `isTestTask`, `paths`; batches are `lanes[] → tasks[]`; the plan keeps `deferred: [{ id, group, after }]` (four records) and its tasks carry no `dependsOn`. The same run's `state.json` waves carry `kind`, `group`, `taskCount`, `batches`, its tasks carry `dependsOn`, and it keeps no `deferred` list. Deriving each task's ordered-after ids from `dependsOn` (same task group, placed at an earlier wave or batch) over that state gives exactly the plan's four records, in a different order (measured 2026-10-06). The wave's red marker is `wave.red === true` (`lib/waves.mjs:864`). `dependsOnIds` (`lib/waves.mjs:209-218`) is documented as "THE ONLY READER of `task.dependsOn`".
- **The module today.** `hooks/mod.mjs` (655 lines) keeps one module-level `run` (`freshRun`, `:87-116`). `applyRecord` (`:326-369`) takes `change`, `action`, `wave`, `batchIndex`, `batchCount`, the spawns into `run.rows` keyed by label, and the banners. `drawPane` (`:409-479`) prints the `waves` section as one `wave-row-<label>` Box/Text per spawn seen (`:421-434`), reading no width; it ignores the render event's props. Its imports are `lib/launch-rule.mjs` and `lib/meter-quiet.mjs`, both reading `lib/limits.mjs`. `agent.spawn` did not fire for a Workflow `agent()` on 2.1.289, so the briefing-hash join (`:606-616`) is dormant and agent rows read `lane unknown`.
- **The three mod changes that land first.** `speak-lane-turn-ends-and-session-cost` (context and cost lines, a turn-end toast), `speak-permission-prompts-and-guard-denials` (a refusals section, four new hooked events), `show-preflight-and-interrupted-runs-at-session-start` (a band, two panes, two commands, `$.fs.read` for one schema-stamped file). They touch `hooks/mod.mjs`, `test/mod/meter.test.ts`, `test/spine/mod-pins.test.mjs`, `docs/13-the-guards.md` and `CHANGELOG.md`. This change's line numbers above are today's; the implementer re-reads them after those land.
- **The engine, from the 2.1.286 and 2.1.289 declarations.** The `Pane` render props are `title`, `isFocused`, `bodyColumns` ("Cells across the body, inside the frame. Read-only."), `placement: 'dock' | 'inline'` (dock "the terminal in fullscreen from 110 columns"), `scroll` (`bodyRows` among it) and `view`; a pane is "Raised on every surface", "one shown, the rest tabs". `Text` takes `wrap?: … | 'truncate-end'`. The kit's `$.ui.mount` passes these props in (`test/mod/meter.test.ts:168-175` mounts with `bodyColumns: 100`, `placement: 'dock'`, `scroll.bodyRows: 60`).
- **The sibling renderer.** `draw-wave-plan-and-handoff-graph-from-the-cli` had a `proposal.md` and `specs/` but no `design.md` when this design was written (checked 2026-10-06, twice). Its proposal and spec fix the shape this change needs: `lib/draw-plan.mjs` and `lib/lane.mjs`, pure and Node-free, closure `lib/lane.mjs` and `lib/limits.mjs`; the board returned as an array of lines at a given width, cut with an ellipsis; one spoken line below a published minimum; two published widths. The export names are not fixed anywhere yet (D10).

## Goals / Non-Goals

**Goals:**

- One stated contract: six named relay fields, each sized, each pinned, the schema identifier unchanged.
- One summary module, imported by the CLI to build the field and by the tests to prove the board draws the summary exactly as the plan.
- One renderer drawn in two places: the meter adds no layout, no state word and no width rule of its own.
- Every absence spoken: an old CLI, a narrow pane, a malformed field, a renderer that throws.

**Non-Goals:**

- Reading `plan.json`, `state.json`, the trajectory or any file for the board. `$.fs.read` stays the preflight's alone.
- Re-joining host agents to lanes. The briefing-hash join stays as it is; this change neither repairs nor removes it.
- Colour, `Svg`, `Raster`, `Markdown`, Mermaid or any element beyond `Box` and `Text` in the pane.
- A second pane, a new command, a new hooked event, a new engine call, a new `$.state` key, a new limits key.
- Changing what either driver reads, or anything the runner hosts receive.
- The handoff graph in the pane. `lib/draw-run.mjs` reads the trajectory, which the module never reads.

## Decisions

### D1 — Six relay fields, their shapes, and what each costs per step

`RELAY_STEP_FIELDS` gains, in this order after `pingModel`: `waveIndex`, `batchIndex`, `batchCount`, `skipped`, `recorded`, `plan`. `relayStep` keeps its loop: a field absent from the step is absent from the relay. Shapes:

- `waveIndex`, `batchIndex`, `batchCount`: non-negative integers, already on every batch, test-wave and verify step (`PASS_THROUGH`). About 55 bytes at the step's indent.
- `skipped`: boolean, already on every verify step. About 19 bytes.
- `recorded`: `{ ok: string[], failed: string[], notAttempted: string[] }`, on the step `run record-batch` returns after the batch was recorded (D2). About 12 bytes per id plus 60 for the keys.
- `plan`: the summary (D3), on two steps of a run at most.

*Measured, not estimated.* The proposal's "about 110 bytes per task … under 3 KB for a twenty-task change" is the compact figure. `emitRunStep` pretty-prints with a two-space indent, and a task sits six levels deep (`plan → waves → batches → lanes → task`), so each task costs about 300 bytes on the relayed step. The real thirteen-task plan summarises to 1,642 bytes compact and 3,877 bytes as printed, against the plan's 21,051. A twenty-task change prints about 6 KB on its adoption step. Every other step grows by the three integers (55 bytes), a verify step by 19 more, a recording step by its ids. The step is not compacted for this field: the indent is `emitRunStep`'s for every step and the forensic copy in `last-step.json`, and a field printed in a second format would be a second thing to pin. Probe 1 (D12) measures whether a step of that size crosses the relay intact; the fallback shape is in D12.

*Why these and not `lanes`.* The summary's batches already list each lane's ids, and `laneLabel` derives the spawn's label from a lane, so a spawn joins its planned lane by label with no second list. `lanes` and the other carried state (`remainingBatches`, `previousHandoffs`, `changed`, `mergeBase`) stay stripped; `waveKind` stays stripped because the summary carries each wave's kind by position.

*Alternatives.* Relaying the whole wave state: the carried state is what the whitelist exists to drop. A side file the module reads: closed by the briefs and by the preflight pin (proposal, Why). A second step record printed beside the first: two JSON documents on stdout break `JSON.parse(text)` for both readers.

### D2 — `recorded` is the verdict the tick reads, put on the step record-batch returns

In `runRecordBatch`, after the verdict (`:3036`), the step returned at `:3071` gets `recorded: { ok: verdict.tickIds, failed: <every failedIds of verdict.waves, in order>, notAttempted: <the same union the manifest tally pushes: the lanes the host stopped early, then the verdict's not-attempted ids not already listed> }`. One expression serves the tally and the field, so they cannot disagree. A step that halts before the verdict (a merge halt, a trajectory append failure) carries no `recorded`: those ids are on disk and in the close summary, and the board draws them as the state would without them (`not recorded` once the cursor has passed). The field is set on the decorated step object, never inside `decorate`, so no other subcommand can emit it.

*Why carry `notAttempted` the board does not colour.* The sibling's overlay has no word for it, and a not-attempted id reads `not recorded`, which is true. The three lists are the outcome classes the run records for a batch; carrying two of three would make the field a partial copy of the tally a second reader could misread as complete. It costs about 12 bytes per id on a rare step.

### D3 — `plan` is built by `lib/plan-summary.mjs` from the state that will run

A new `lib/plan-summary.mjs`, pure and Node-free, importing only `./lane.mjs`, exports `summarizePlan(source, { deferred } = {})`. `source` is a plan (`waves` plus `testWave`) or a run state (`waves`, the test wave among them with `kind: 'test'`). The result has the plan's shape, so the renderer needs no second input form:

```
{ waves:    [{ index, group, kind: 'impl', red?, batches: [[[{ id, tier, model, description }]]] }],
  testWave: { index, batches: [...] } | null,
  deferred: [{ id, group, after: [id] }] }
```

- `index` is the wave's position, the test wave's `waves.length`, so the overlay's cursor and a skip's `waveIndex` place by position with no counting.
- `red` is copied only when `true`.
- A task keeps `id`, `tier`, `model` and `description` cut by the lane title rule's own word function: `lib/lane.mjs` exports the gist the title is built from (`laneTitle` reads the first six words of the first task's description, stripped of `` ` ``, `*`, `_` and trailing punctuation, `lib/waves.mjs:538-546`), and the summary stores that gist. The gist is a fixed point of the rule, so `laneTitle` of a summarised lane equals `laneTitle` of the planned lane. A field the task lacks is left out, never filled.
- `deferred`: the `deferred` option when given, else the source's own `deferred` when it carries one (a plan), each reduced to `{ id, group, after }`; else derived from the tasks' dependency fields: for each task, the ids `dependsOnIds(task)` returns that name a task of the same `group` placed at an earlier `(index, batch)`; a record only when that list is non-empty. `dependsOnIds` moves from `lib/waves.mjs` to `lib/lane.mjs` and `lib/waves.mjs` imports it, so it stays the only reader of `task.dependsOn`.

`lib/run.mjs` imports `summarizePlan`. `adoptPlan` sets `first.plan = summarizePlan(state, { deferred: plan.deferred })` on the step at `:2581` when that step is not a halt: the state's waves are what will run (`createRunState` re-chunks under `maxParallel`), and the plan's own records are the planner's words where it has them. `runReplan` sets `plan = summarizePlan(after)` on the step at `:3482`. The declined-replan step (`:3458`) and every `run next` carry none.

*The spec delta's correction.* The `ship/diagrams` delta first said the summary derives its edges from the tasks' dependency fields. The real plan's tasks carry no `dependsOn`, so a summary of that plan would have drawn no `←` ids while the plan's board draws four, and the requirement's own happy path could not hold. The delta now says: a plan's own deferral records where the input carries them, derived records for a run state, which keeps none. The derivation is the planner's (same group, earlier layer, here an earlier position), and over the real state it yields the plan's four records.

*What the equality test asserts for a run state (2026-10-07).* The fixture state carries no `deferred`, so the state drawn directly as a plan shows no `←` ids (and titles its test wave as an ordinary wave), while its summary derives the four records. The two cannot be equal, and the summary is the one that is right. `test/spine/plan-summary.test.mjs` therefore asserts that the state's summary draws line for line as the plan the state adopted, with and without the state as overlay, which is the claim the meter relies on.

*Alternatives.* Building from the plan at adoption: the state's batches are what the cursor walks, and a `maxParallel` override re-chunks them. Building inside `lib/draw-plan.mjs`: the CLI would then import the renderer to emit a step field, and the summary's purpose (a small, pinned contract) would hide inside a drawing module. Restating `dependsOnIds` in the summary module: a second reader of `task.dependsOn` is the drift the planner's comment forbids.

### D4 — The schema stays `interlock.run-step/1`

Every new field is additive and absent where it does not apply; a reader that ignores unknown fields reads today's step, and `bin/interlock-run` and `workflows/ship.js` ignore them. A version bump would make every reader that checks the string (the meter's fixtures, `test/spine/run.test.mjs:3041`) fail on a change that removed nothing. The `banners` precedent is the same: `draw-the-ship-run-live` added a field as "a stated contract of `ship/run-program`" without a bump. The pins assert the string where they assert it today.

### D5 — One pane: the board is the `waves` section of `/interlock-meter`

The board replaces the flat rows inside the existing pane. No `/interlock-board`.

*Why one.* A second pane needs a second `command.run` matcher and a second `ui.render` matcher (two new `hooks:` entries), and an unasked open of it would be a second unasked open the engine seats as a tab the person must find ("one shown, the rest tabs"). The lanes would be drawn in two places, with two width rules to keep equal. The meter already owns the run's lifecycle (live, closing, closed, the boundary reset); a second pane would need the same lifecycle or show a board of a run the meter has dropped. The preflight change's two panes are different in kind: they are opened on request for files, not drawn for a live run.

*What it costs.* The board pushes the agents, context, plan-window, refusals and banners sections down; a twenty-task board is about thirty lines. The pane scrolls (`scroll.bodyRows`), and the person reaches them with the arrows. Accepted: the board is the section a person opens the meter during a run to see.

### D6 — The overlay is built from the steps alone, in the wave state's own shape

`freshRun()` gains `plan: null`, `recorded: { ok: [], failed: [], notAttempted: [] }`, `skips: []`, `cursor: null`, `dispatched: null`, `halt: null`, `planNamed: false`. `applyRecord` takes:

- `plan`, when it is an object whose `waves` is an array: replaces `run.plan`. Anything else is named once on the debug log and ignored.
- `waveIndex` and `batchIndex`, when integers: `run.cursor = { waveIndex, batchIndex, phase }`, `phase` `batch` for `run-batch` and `test-wave`, `verify` for `verify`; on a batch step also `run.dispatched` (the same pair).
- `recorded`, when it has the three arrays: each id appended to its list once. Otherwise named once and ignored.
- `skipped === true` on a verify step with an integer `waveIndex`: one skip `{ waveIndex, wave, reason }`.
- `action === 'halt'`: `run.halt = { reason }`.

At draw the module builds the overlay the renderer takes in place of a wave state: `{ waves: <the summary's wave count>, cursor, completed: ok ids, failures: failed ids as { id, wave, waveKind, error: null } with `wave` and `waveKind` read from the summary at `run.dispatched.waveIndex`, skippedVerifications: skips with their `waveIndex`, halt }`, and the lane notes keyed by label: for each row whose spawn label a planned lane carries, `served <models or ?>` and, when the briefing-hash join found its agent, ` · <turn reason or running>`. `notAttempted` ids are held and not placed. The wave count is the summary's, so the renderer never takes the id-only branch for a count mismatch the module created.

Nothing is read from disk. The boundary reset (`freshRun()`) drops every one of these with the run, as it drops the rows.

*As implemented (2026-10-07).* Three small additions to the list above. A failed id's `wave` and `waveKind` are read from the summary at `run.dispatched` when the `recorded` block is applied (kept in `run.failedAt`), not at draw, because by the next batch `run.dispatched` names another wave; the recorded ids are taken before the step's own position for the same reason. `recordedNamed` sits beside `planNamed`, so each malformed field is named once. And each row remembers whether a batch step spawned it (`batch`), which is how D8's third case tells a relayed batch with no positions from a lone verify spawn without a new run field.

*Why the overlay is state-shaped.* The renderer's overlay rules (`ship/diagrams`) are written against the wave state's fields; feeding it the same shape from steps means one overlay rule, tested once against the real state and once against the steps that state's run printed.

### D7 — Width is the pane's `bodyColumns`, cut by the renderer, `truncate-end` behind it

The `Pane` render hook passes `e.props.bodyColumns` to the renderer when it is a positive integer, else the sibling's published default width, read by key from `LIMITS` (the module restates no number; `test/spine/limits.test.mjs` already pins that `hooks/mod.mjs` restates no cap). Each returned line is one `h(Box, { key }, h(Text, { wrap: 'truncate-end' }, line))`; the renderer has already cut it to the width, and `truncate-end` is the backstop if the engine's body is narrower than its prop said. The keys: `lane:<label>` → `wave-row-<label>`, so every existing kit case that finds a lane by key holds; `wave:<i>` → `wave-block-<i>`, `verify:<i>` → `wave-verify-<i>`, `header` → `wave-board-header`, `tail` → `wave-board-tail`.

Below the minimum the renderer returns one spoken line; the module tells that from a board by the rows: every board ends in a row keyed `tail` (the sibling's spec keeps the tail even for a plan with no waves), and the spoken line is a single row without it. The module then draws that line and the flat rows. So the published minimum is the renderer's decision alone, and the module holds neither width.

*Alternatives.* The module comparing `bodyColumns` with the minimum key: a second place that decides the cut. A fixed width: the dock and the inline pane differ by tens of columns.

### D8 — What draws when a field is absent

In order, inside `drawPane`'s `waves` section:

1. No spawn seen and no plan: `no lanes dispatched yet`, as today.
2. A plan held: the board (D7), then a flat row for every spawn whose label no planned lane carries (verify, commit and review agents), each keyed `wave-row-<label>` and reading as today.
3. No plan held, a batch dispatched (`run.dispatched` set, or a `run-batch`/`test-wave` spawn seen): `plan structure not relayed by this CLI`, then the flat rows exactly as today.
4. The renderer's spoken line: that line, then the flat rows.
5. The renderer throws: the flat rows beneath `wave board could not be drawn`, and one debug line naming the error. A `try` statement around the call, not a `.catch(` (a forbidden token).

A malformed `plan` or `recorded` is named once per run on the debug log and ignored (D6); the step is applied otherwise. The words in 3 are the proposal's; they name the likeliest cause and not the only one, and the debug log carries whatever the module saw.

### D9 — The status line and the spinner are unchanged in code, and now show the batch on the Workflow host

`position()` already prints `batch <j>/<k>` when the step carries both integers. With them relayed, the Workflow host's status line gains the batch position it has lacked since `draw-the-ship-run-live`, with no code change. `docs/07-cli-and-configuration.md:74` says the opposite today and is corrected. The kit case for the relayed shape without them (`RELAYED_TEST_WAVE`) stays: an old CLI still relays that shape.

### D10 — The renderer surface this change uses

The sibling's design (`draw-wave-plan-and-handoff-graph-from-the-cli`, D2, D3 and D8) fixes the names; this change uses them as follows:

- `lib/draw-plan.mjs` exports `drawPlanBoard(plan, { columns, state, stateNote })` returning `string[]`, and builds internal rows keyed `header`, `wave:<i>`, `lane:<label>`, `verify:<i>` and `tail`. This change adds the rows form as a second export, `drawPlanBoardRows(plan, { columns, state, stateNote, notes })` returning `{ key, text }[]`, with `drawPlanBoard` returning its texts (the second `ship/diagrams` requirement this change adds). Of the plan the renderer reads only `waves`, `testWave` and `deferred`, and of a task only `id`, `tier`, `model` and `description`, which is what lets the plan summary (D3) stand in for the plan.
- `lib/lane.mjs` exports `laneLabel`, `laneTitle`, `laneTier`, `laneModel`, `laneEffort` and the row cut `fitRow(text, columns)`; this change adds `titleGist` (D3) and moves `dependsOnIds` (D3).
- `lib/limits.mjs` holds `waveBoardMinColumns` and `waveBoardDefaultColumns`, printed by `interlock limits` as `wave board min width (columns)` and `wave board default width (columns)`; this change reads the default by its key name and restates neither value.
- The overlay is the `state` option, a wave-state-shaped object; the meter builds it from the relayed steps. This change adds a skip record placed by `waveIndex` and per-label notes (`notes: { [label]: text }`), per the second added requirement.

*Checked against the merged code, 2026-10-07.* `drawPlanBoard`, `fitRow`, `laneLabel`/`laneTitle`/`laneTier`/`laneModel`/`laneEffort`, `waveBoardMinColumns` and `waveBoardDefaultColumns` are as named. The sibling built the rows internally (`boardRows`) with two keys beyond the five above, `wave:<i>:end` for a block's bottom rule and `unplaced:<n>` for what the overlay could not place; this change exports that function as `drawPlanBoardRows`, and the pane keys the two as `wave-block-<i>-end` and `wave-unplaced-<n>`. The notes are the `notes` option beside `state`, as stated above. Below the minimum the renderer's one row is keyed `header`, which is what D7's tail test tells apart. A positioned skip whose position has no boundary after it is spoken as an `unplaced:` row rather than dropped.

If the sibling's code lands a different name, §1 and §3 use that name. Whatever of the second added requirement the sibling has not built (the rows form and its keys, the per-label notes, a skip placed by `waveIndex`), this change builds in `lib/draw-plan.mjs` in §2, test first in the sibling's `test/spine/draw-plan.test.mjs`; nothing else in that file or in `lib/lane.mjs` moves beyond D3.

### D11 — Tests: the Node runner holds the contract, the kit holds the pane

- `test/spine/run.test.mjs`: the relay pin keeps the strip of `remainingBatches`, `previousHandoffs`, `changed`, `lanes`, `mergeBase` and `prompt`, and asserts the six fields reach the relay with their values; `run classified` emits a first step carrying `plan` equal to `summarizePlan(state, { deferred: plan.deferred })`; a revised `run replan` carries `plan` from the revised state; `run next`, a declined replan and `run record-batch` carry none; `run record-batch` carries `recorded` with the verdict's lists and the halting record-batch paths carry none; every step's `schema` is `interlock.run-step/1`; a relayed non-adoption batch step grows by exactly the three integers over today's relayed shape.
- `test/spine/plan-summary.test.mjs` (new): the summary's task keys are exactly `id`, `tier`, `model`, `description`, and a test fails naming `paths`, `group` on a task, `isTestTask`, a description longer than the gist, `prompt`, `remainingBatches` or `previousHandoffs` if found; built from the sibling's fixture plan and from its fixture state, both draw line for line as their source through the renderer, at the published default width, with no overlay and with the fixture state as overlay; the derived deferral records over the fixture state equal the fixture plan's as a set; a replanned state summarises its revised waves; a task with no description, tier or model summarises without one; the summary's printed size is under a quarter of the plan's; the module's import closure is `lib/lane.mjs` and `lib/limits.mjs`, through the shared walker.
- `test/fixtures/mod/steps.mjs`: `ADOPTION_BATCH` (a relayed `run-batch` at `waveIndex: 0`, `batchIndex: 0`, `batchCount: 1`, its spawns labelled as the fixture plan's lanes, carrying a literal `plan` summary of the fixture plan), `RECORD_BATCH` (with `recorded`), `VERIFY_SKIPPED` (`skipped: true`, `waveIndex: 0`, a reason), `REPLAN_BATCH` (a revised `plan`). The kit has no filesystem, so the summary is a literal; `test/spine/plan-summary.test.mjs` asserts it equals `summarizePlan(<fixture plan>)`, so the literal cannot drift.
- `test/mod/meter.test.ts`: the mount helper takes a width; cases on both surfaces for the board (lines equal to `drawPlanBoard` of the fixture summary with the overlay the steps imply, at `LIMITS`' default width), the overlay words after `RECORD_BATCH` and `VERIFY_SKIPPED`, a replan's summary replacing the adopted one, the old-CLI line above the flat rows, `no lanes dispatched yet` before any batch, the narrow body (one below the published minimum), a verify spawn drawn flat beneath the board, a malformed `plan` named once and ignored, and the boundary dropping the plan. Every existing case runs unchanged: none of today's fixtures carries `plan`.
- `test/spine/draw-plan.test.mjs` (the sibling's): the second added `ship/diagrams` requirement's three scenarios, over the fixture plan: rows keyed `header`, `wave:<i>`, `lane:<label>`, `verify:<i>`, `tail`, the lines form equal to the rows' texts; a note appended verbatim after the state word and cut with the row; a note for an unknown label drawn nowhere; a skip carrying `waveIndex` placed by it with no ambiguity text.
- `test/spine/mod-pins.test.mjs`: one new case, the module imports `drawPlanBoardRows` from `'../lib/draw-plan.mjs'`, spells none of `plan.json`, `state.json`, `ship/runs`, and its board-drawing function contains no `$.fs.`. `ALLOWED_CALLS`, `HOOKED_EVENTS`, `FORBIDDEN_TOKENS` and `GUARD_REFUSAL` do not move; the walker covers the new imports by construction.
- `test/workflows.test.mjs`: one new case, neither driver's source spells `step.plan`, `step.recorded`, `step.skipped`, `step.waveIndex`, `step.batchIndex` or `step.batchCount`. The relay-read scan only proves the drivers read whitelisted fields; once the six are whitelisted it no longer proves the drivers ignore them, which the `ship/run-program` delta asserts. This file is not in the proposal's Impact list; the pin is what makes the delta's sentence true.

### D12 — The probes, and what each decides

Both run through `scripts/host-probe.mjs` on the 2.1.289 binary with scratch plugins and a scratch repository under the session scratchpad, never `~/.claude/dev-mods/`. A `--plugin-dir <repo>` session leaves a root `tsconfig.json`, `.claude-plugin/types/` and a launch-ledger file, which are removed afterwards; `npm test` is not run beside a probe.

- **Probe 1 — the fields survive the Workflow relay.** A scratch repository holding a copy of the plugin with §2 applied (or the working tree once §2 lands), a scratch change of twenty tasks across three sections with two `dependsOn` edges, and its classified file. A stand-in `workflows/ship.js` in a scratch plugin, launched through `--mode tty` (the memory recipe: the launch rule matches the path), runs exactly the real `cli()` relay for `run start --host workflow` and `run classified`, through one mechanical `interlock:ping` each, and writes each relayed `cliStdout` to a scratch file. Recorded here: whether the relayed copy of the adoption step parses and equals `.claude/ship/last-step.json` byte for byte; whether `plan`, `waveIndex`, `batchIndex` and `batchCount` are present and equal; the step's byte count; the ping's model and its turn's duration. *Decides:* intact → the shape stands. Altered or unparseable → the summary drops `description` (a lane's row then reads its label where the title would be, the third `ship/diagrams` scenario) and the probe reruns; still failing → `plan` is removed from this change, the board is drawn only on hosts that relay whole steps, and the Workflow host keeps the spoken line. The meter's own read is not at stake (Context: it reads the CLI's bytes); the driver's is.
- **Probe 2 — the pane's props on both surfaces.** (a) In the kit: a scratch mod whose `Pane` render hook returns one `Text` per prop it was given, mounted on `terminal` and `desktop` with `bodyColumns`, `placement` and `scroll.bodyRows`; recorded here whether both surfaces hand the hook the props the mount passed, which decides that the width cases run on both surfaces. (b) In one `--mode tty` session with the repository as `--plugin-dir` and the probe-1 stand-in: the harness's tmux window resized to 144 columns (`tmux resize-window -x 144` on the harness's session), the pane seated unasked, then `/interlock-meter` typed; recorded here the `placement` and `bodyColumns` each open received, and whether the board's lines arrived uncut at each. The Desktop Code tab is probed only if its engine is at or above the mods floor that day (it was 2.1.286 on 2026-10-05); otherwise this section says so and the kit's desktop surface stands for it.

**Recorded 2026-10-07** (Claude Code 2.1.291 at the 2.1.289 path, `scripts/host-probe.mjs`, every scratch file under the session scratchpad).

*Order.* Probe 1 ran once §2 had landed, against the real CLI rather than a hand-built step file, so it answers task 1.1 and the rerun task 5.1 asks for in one pass. It decided nothing the code depended on, because the shape it tested is the one D1 states.

- **Probe 1, the relay.** The scratch change has twenty tasks in three sections (the third a test section) with two `dependsOn` edges (`1.5 → 1.2`, `2.4 → 2.1`). The probe ran headless with the scratch repository as cwd, because the Workflow tool accepts a `scriptPath` only inside the working directory and a tty session needs a trusted cwd. A stand-in carrying `cli()`'s relay prompt and schema verbatim relayed `run start --host workflow` and `run classified` through one `interlock:ping` each, the command spelled with an absolute path. The first pass named no model, and the ping ran on `claude-opus-5-5`. The real driver sets the ping's model from the run's `pingModel`, which was `haiku`, so the probe was rerun on `haiku`, and that run is what decides. The relayed adoption step's `cliStdout` (read from the ping's own transcript) **parses and equals `.claude/ship/last-step.json` byte for byte less its trailing newline**: 11,859 bytes against 11,860. `plan` (deep-equal), `waveIndex: 0`, `batchIndex: 0` and `batchCount: 2` all arrived. The ping was `claude-haiku-4-5-20251001`, and its turn took 24.9 s (the `run start` relay 8.8 s). Measured sizes: the summary is 2,189 bytes compact and about 4.85 KB as printed in the step, against D1's ~6 KB estimate; the step without it is 7.0 KB; the three integers print at 58 bytes. *Decision: intact, so the shape stands.* No field is dropped, and the fallback is not taken.
- **Probe 2(a), the kit.** A scratch mod echoing its `Pane` render props, mounted with `bodyColumns: 77`, `placement: 'inline'` and `scroll.bodyRows: 12`, received exactly `title`, `isFocused`, `bodyColumns`, `placement` and `scroll` with those values on both `terminal` and `desktop`. The width cases therefore run on both surfaces. The same probe found the mount's `findAll({ type: 'Box' })`, which lists keyed boxes in drawn order with their children's `Text` props, and that is how the kit cases compare the whole section and check `wrap`.
- **Probe 2(b), the real terminal.** One tty session with the repository and a scratch props logger as plugin dirs, cwd the repository, the tmux window resized to 144×60 before any launch. The typed prompt states exactly what the agent does: a stand-in at `.claude/ship/probe-wb/workflows/ship.js`, whose one haiku ping runs `interlock limits >/dev/null 2>&1; cat <probe 1's relayed adoption step>`. That command starts with `interlock `, so the meter reads it, and it touches no run state. A first attempt whose prompt began "run sleep 25" was obeyed by the agent instead of the script, as the memory notes warn. Recorded:
  - **Unasked:** the pane seated as `placement: 'dock'`, `bodyColumns: 102`, with `scroll.bodyRows` between 49 and 51 across draws. The board drew in full: the header (`plan · 3 waves · 20 tasks · run ? · cursor idx 0 b0`), three blocks with their rules drawn to the body width, the cursor's lanes reading `current served ?`, the `←1.2` and `←2.1` edges, both verify cells and the tail. Rows longer than 102 ended in the renderer's `…` and none wrapped.
  - **Typed `/interlock-meter`:** the pane was already docked and stayed docked with the same props, and the board was unchanged.
  - **Confirmed on the Workflow host:** the status line reads `run-batch · wave 1 · batch 1/2`, the batch position D9 said the relay now carries.
  - **Noticed, not changed here:** the relayed adoption step carries no `change`, so the status line and the pane header name none until a later step does. The engine prefixes the status text with the plugin's name, so it reads `interlock: interlock: …`. The board's header says `run ?`, because no step carries the interlock run id. All three predate this change or are outside its scope.
  - **The Desktop** cannot be launched through the harness, so the kit's `desktop` surface stands for it, and probe 2(a) shows that surface receives the props the mount passed.
  - **Leftovers removed:** the root `tsconfig.json`, `.claude-plugin/types/`, two launch-ledger files and the stand-in directory. `npm test` was not run beside either session.

### D13 — The validate lines this change records

Baseline: the lines `show-preflight-and-interrupted-runs-at-session-start` records in its D11 after implementation. Those are the archived quiet-time D7 lines (`openspec/changes/archive/2026-10-05-show-quiet-time-and-reset-the-meter-on-clear/design.md`, the `hooks:` line ending `… classic.SessionStart, ui.render{component=Spinner}, ui.render{component=Pane, requestId=interlock-meter}, command.run{command=interlock-meter}` and the `calls:` line of thirteen methods), plus `speak-lane-turn-ends-and-session-cost` D8 (no change but attribution), plus `speak-permission-prompts-and-guard-denials` D8 (`hooks:` gains `tool.call{tool=Edit}`, `tool.call{tool=Write}`, `classic.PermissionRequest`, `classic.PermissionDenied`), plus the preflight's D11 (`hooks:` gains `ui.render{component=AbovePrompt}`, `ui.render{component=Pane, requestId=interlock-preflight}`, `ui.render{component=Pane, requestId=interlock-handoff}`, `command.run{command=interlock-preflight}`, `command.run{command=interlock-handoff}`; `calls:` gains `$.fs.read (via …)`, fourteen methods). `state reads:` and `state writes:` are `interlock.ledger` throughout.

Expected after implementation, to be pasted below by the implementer from `claude plugin validate . --strict` and diffed against the same command on the tree with the three siblings landed:

- `hooks:` identical.
- `calls:` the same fourteen methods. Attribution may change only on `$.ui.resolve`, `$.ui.log` and `$.ui.invalidate`, where a named board helper may appear in a `via`. `$.fs.read`'s `via` list is exactly the preflight's: a board or overlay helper under it is a defect.
- `state reads:` and `state writes:` identical.
- No other finding (`.claude/CLAUDE.md` since `c72cac2`). If the root `CLAUDE.md` warning reappears, it is the known pre-existing failure and the only one allowed.

**Recorded 2026-10-07** (task 3.1, `claude plugin validate . --strict` on Claude Code 2.1.291, the three siblings landed in the same tree): `✔ Validation passed`, with no finding beyond the module's usual `gating hook without .catch` notes.

```
❯ ./mod.mjs hooks: session.start, prompt.submit, session.receive{origin has {kind=task-notification}}, tool.call{tool=Workflow}, tool.call{tool=Bash}, tool.call{tool=Edit}, tool.call{tool=Write}, turn.step, turn.complete, agent.spawn, classic.SessionStart, ui.render{component=Spinner}, ui.render{component=Pane, requestId=interlock-meter}, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=interlock-preflight}, ui.render{component=Pane, requestId=interlock-handoff}, command.run{command=interlock-meter}, command.run{command=interlock-preflight}, command.run{command=interlock-handoff}
❯ ./mod.mjs calls: $.clock.every (via startTick), $.clock.now (via changeRecord, clockNow, guardFacts), $.command.register, $.fs.read (via drawHandoffPane, readPreflight), $.session.usage (via drawPane), $.session.version, $.state.get (via changeRecord, guardFacts), $.state.set (via changeRecord), $.ui.invalidate, $.ui.log, $.ui.open (via openPane), $.ui.resolve, $.ui.status, $.ui.toast
❯ ./mod.mjs state writes: interlock.ledger
❯ ./mod.mjs state reads: interlock.ledger
```

Against `show-preflight-and-interrupted-runs-at-session-start` D11's recorded lines, all four are byte-identical: `hooks:` gains nothing, `calls:` holds the same fourteen methods with the same attribution (the board's `$.ui.resolve` and `$.ui.log` are unattributed, as before), and `$.fs.read` stays `via drawHandoffPane, readPreflight` — no board or overlay helper reads a file. The root `CLAUDE.md` warning did not appear.

## Risks / Trade-offs

- [A 6 KB adoption step mis-copied by the relay ping halts the run at its first batch] → probe 1 measures it before any code depends on it; the step is still printed once or twice per run; the driver's existing guard turns a bad copy into a loud stop naming the relayed length; the fallback shape drops descriptions first.
- [Every relayed step grows by the three integers] → about 55 bytes against steps that already carry each spawn's schema and briefing path; the whitelist stays a whitelist and the pin names all fifteen fields.
- [The summary drifts from what the renderer reads] → the line-for-line equality test through the real renderer on the real fixture, with and without overlay, and the forbidden-field test.
- [`plan structure not relayed by this CLI` shown for another cause (the adoption step's result failed to parse)] → the parse failure is on the debug log; the words are the proposal's and stay; the flat rows still show every lane.
- [A long board pushes the refusals and banners below the fold] → the pane scrolls; the status line and the toasts carry the same banners; accepted (D5).
- [The sibling's export names, row keys or overlay shape differ from D10] → named in one decision; §1 asserts RED against whatever names the sibling's merged design states, and §3 depends on the sibling landing first.
- [The meter misses the adoption step (a reload, a `/clear` before it)] → the run is not drawn after either by design (the meter's run ends at the boundary); within a live run, a replan re-sends the summary.
- [`notAttempted` carried and not drawn] → a few bytes on a rare step; the field mirrors the tally's three outcome classes rather than a partial copy.
- [Probe sessions write into the repository] → the known three files are removed after each; `npm test` is not run beside a probe.

## Migration Plan

- **A newer plugin with an older `interlock`.** The older CLI relays none of the six fields. The meter draws the flat rows beneath `plan structure not relayed by this CLI`; the status line reads `wave <w>` without a batch, as today. Nothing else changes.
- **An older plugin with a newer `interlock`.** The older module ignores the new fields; an old `drawPane` draws the flat rows. Both drivers ignore them by construction and by the new pin. The adoption step is larger; probe 1 is what says that is safe.
- **The runner hosts.** They already receive the whole step; `plan` and `recorded` are two more fields they do not read.
- **Rollback.** Revert the whitelist entries, the two step fields, the summary module and the pane section; no file, state or trajectory format changes, and `dependsOnIds` moving back is an import change.

## Open Questions

- Resolved: the sibling renderer's export names, row keys and limits keys are taken from its design (D10). If its merged code differs, §1 and §3 follow the code.
- Probe 1's byte count and whether the adoption step relays intact (D12). Deferrable: the fallback shape is decided above and changes no spec sentence.
- Probe 2's `bodyColumns` at 144 columns unasked and docked, and whether the Desktop can be probed that day (D12). Recorded here; it changes no code path, since the module reads the prop whatever its value.
