## Context

See proposal.md for the motivation. What shapes the approach:

- **The module today.** `hooks/mod.mjs` keeps two things. The launch guard's record lives in `$.state` under `interlock.ledger`, which the engine resets at `/clear`, `/resume` and `/branch`. The meter's run (`run = freshRun()`) is module state, reset only in `session.start` and on an accepted launch. `watching()` gates every meter hook on `session.interactive && (run.phase === 'live' || 'closing')`. The status line is set from `applyRecord` on each step and cleared at close and halt. The spinner hook is synchronous and reads `position()`. The pane is drawn on request from the tallies and calls `$.session.usage()` while drawing. The module imports one plugin file, `lib/launch-rule.mjs`, which imports `lib/limits.mjs`; both are Node-free, and `test/spine/mod-pins.test.mjs` walks every import.
- **The engine's clock, from the 2.1.289 declaration.** `$.clock.now()` resolves milliseconds since the epoch. `$.clock.sleep(ms)` is charged to the calling hook's own time budget ("the wait is the hook's own time and its budget runs on through it"). `$.clock.every(ms, fn)` calls `fn` every `ms` until `cancel()`, as one `clock.every` dispatch per period, and "a refused period ends the interval"; the declaration's own example is `$.clock.every(1000, () => $.ui.status("polling"))`. The kit's `mock.clock(on, { now })` has `now()`, `advance(ms)` ("resolving each wait due on the way"), `set(ms)` and `settle()`.
- **The session boundary, from the same declaration.** The classic `SessionStart` input carries `source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork'`. The brief's mods-11 records that the mod-level `session.start` does not fire for `/clear`, `/resume` or `/branch` and that `classic.SessionStart` does. The built-in `diff` mod hooks `command.run` on `clear` and `resume` to close its pane and forget its state.
- **The `Spinner` element** reads `word`, `message` and `suffix` and is raised on the terminal and desktop surfaces. Whether it is drawn while a background workflow holds the session and the person is idle is not established; the first meter change relied on it for the step and wave without recording that.
- **Caps.** Every printed cap has a reader under `lib/`, `bin/`, `workflows/` or CI; `test/spine/limits.test.mjs` pins the launch ledger age's reader in `lib/launch-ledger.mjs` and asserts the hook does not restate it. `hooks/` is outside the sweep.
- **The pane has no close call.** The declaration has a `ui.close` event (`PaneCloseInput`, fired when a pane closes) and no `$.ui.close` method; a pane opened with `closeOnEscape: true` is dismissed by the person.

## Goals / Non-Goals

**Goals:**

- One stamp, one interval, one word: the quiet time is derived from facts the engine already hands the module, and it is shown in the three places the meter already draws.
- One boundary: the module's run resets exactly where the engine resets the module's session state.
- No new number in the module, no new state key, no new kind of engine call beyond the host's own timer.

**Non-Goals:**

- Naming a cause for the quiet (a pause at a plan window, a hung lane, a slow API). The module shows the figure and the windows; the person reads them.
- Re-adopting a run that outlives a `/clear`. Its identity came from a Workflow result the cleared conversation held; the close summary and the receipt remain the record, and the launch guard, reset by the same boundary, already allows a new launch.
- Closing the pane, writing anything, notifying anyone, or touching the settings hooks, the CLI, the drivers or any corpus.
- A stall verdict in the CLI. A halt on quiet would be a run-program decision with its own brief; nothing here moves an exit code.

## Decisions

### D1 — Activity is what the engine reports the run doing, stamped from the engine's clock

`run.lastActivityAt` (milliseconds, or `null`) is set from `await $.clock.now()` at: the accepted launch (the `now` the guard already read), each step record applied from the ping's Bash result, each `turn.step` for a run agent on entry (the request started) and after `yield* next(e)` (the answer arrived), each `turn.complete` for a run agent, and each `agent.spawn` the host raises. A clock read that rejects leaves the stamp unchanged and is named once per run on the debug log. Nothing else counts: the lead session's own requests, prompts, and tool calls outside the driver line are not the run's.

*Why these and not only steps.* Between two steps the lanes work; a lane on `max` effort can hold one request for minutes. Counting only steps would call a thinking wave quiet. Counting request starts and answers makes the word mean "nothing the run owns has moved".

### D2 — The host's interval is the tick; the spinner and the pane read what it computed

On the accepted launch, after the pane open, the module starts `run.tick = $.clock.every(TICK_MS, fn)`. `fn` reads the clock, computes the word through the pure module (D3), and when the composed status text changed calls `$.ui.status(...)`; when the word itself changed it calls `$.ui.invalidate('ui.render')` so the pane and the spinner redraw. The tick is cancelled in `applyRecord` on a close or halt step, on the close record, and at the boundary (D4). The spinner hook stays synchronous and appends `run.quietWord` to the suffix; the pane prints `last activity <ISO>` from the stamp and the word beside it, and recomputes the word at draw from the clock so a pane opened after a refused period still shows the figure.

*Alternatives.* The `Spinner` render hook as the tick: it fires only while the spinner draws, and nothing establishes that it draws during a background run while the person is idle. A `$.clock.sleep` loop inside a hook: the declaration charges the sleep to the hook's own budget, so a loop would be skipped at ten seconds. `session.measure`: fires after turns and on percent changes, not on time. `$.clock.every` is the host's own periodic dispatch, it is what the declaration's example uses to set a status line, and it costs one dispatch per period.

*The orphan after a hot reload (probe 1).* A reload gives the module fresh bindings; a `fn` from the previous load closes over the old `run`, which still reads `live`. If the engine does not cancel a reloaded module's intervals, the old `fn` would keep setting a status line. Mitigation that costs nothing: a module-level generation counter stamped into each `fn` at start; `fn` returns at once when `run.tick` is no longer its own handle, and `session.start` (which does fire on reload) cancels any handle it finds and clears it. Installed plugins never reload mid-session, so the probe decides whether the guard is belt or braces, not whether it exists.

*Probe 1, answered (2026-10-05, 2.1.289, task 1.1(b)).* The engine cancels a reloaded module's intervals. A scratch mod under the session scratchpad, loaded with `--plugin-dir` into a terminal session through `scripts/host-probe.mjs --mode tty`, started `$.clock.every(2000, fn)` in `session.start`, `fn` writing its generation's tick count to a file. The module was edited from generation `A` to `B` from outside the session; the transcript printed `probereload: reloaded (1 hook: session.start)`, generation `A` stopped at tick 16 (its last write one second before the save) and never wrote again, and generation `B` started from tick 1, through the fresh `session.start`, and kept its period. The 2.1.289 declaration says the same (`a hot reload of the plugin cancels its pending waits with the old environment`), as does the bundled `reference.md` (`the previous environment's timers are dropped`). So the engine's drop is what keeps a reload from leaving an orphan, and the generation guard is the belt beside it. The guard could not reach across a reload in any case: an old `fn` closes over the old environment's `run`, which nothing in the new environment touches. What the guard does catch is a period already under way in the same environment when an accepted launch or the session boundary replaces the run, so it is kept.

### D3 — Two published caps, read under `lib/` by a pure module the hooks module imports

`lib/limits.mjs` gains, beside `launchLedgerMaxAgeMs`:

- `meterQuietAfterMs: 5 * 60 * 1000`. Longer than one model request at the deepest effort ordinarily takes to answer, so a thinking lane is not called quiet on the strength of one slow request; short enough that a person who looks during a run learns within one wave's time that nothing has moved. It is a display threshold with no verdict behind it, so a wrong value costs an early or a late word, never a halt.
- `meterTickMs: 15 * 1000`. The word is in whole minutes; a fifteen-second period keeps the shown minute at most fifteen seconds stale at two hundred and forty dispatches an hour, which is nothing beside the run's own traffic.

`formatLimits` prints `meter quiet after (ms)` and `meter tick (ms)`. The new `lib/meter-quiet.mjs` is pure and Node-free, imports `LIMITS`, and exports `quietMs(lastActivityAt, now)` (`null` unless both are finite numbers, else `max(0, now - last)`), `quietWord(ms)` (`null` when `ms` is `null` or below `LIMITS.meterQuietAfterMs`, else `quiet <n> min` with `<n>` the floored minutes and `<1` under a minute), and `TICK_MS`. `test/spine/limits.test.mjs` asserts both caps are printed and that `lib/meter-quiet.mjs` reads them, and that `hooks/mod.mjs` restates neither, as the ledger-age pins do. The hooks module imports the three names from `../lib/meter-quiet.mjs`; the pins' import walker already proves the file is inside the plugin and Node-free.

### D4 — The boundary is the classic session-start event with a reset source, not the command

`on('classic.SessionStart', …)`: when `e.source` is `clear`, `resume` or `fork`, the module cancels the tick, sets `run = freshRun()`, calls `$.ui.status(undefined)` and `$.ui.invalidate('ui.render')`, logs one debug line naming the source, and returns `next(e)`. When the source is `startup`, `compact`, missing or not a string, it returns `next(e)` and touches nothing. The hook body sits in a `try` so a failure is a debug line and the event still resolves as the engine would alone. After a boundary, the Bash hook's existing `watching()` gate drops step records; the first such record sets `run.idleStepNamed` and logs one debug line, `a step crossed with no live run (the session was cleared, resumed or branched since the launch)`, so the silence has a reason in the log.

*Why not `command.run` on `clear` and `resume`, as the `diff` mod does.* The command fires when it is typed; `/resume` opens a picker the person can leave, and a reset then would forget a run that is still the session's. The classic event fires when the boundary has happened, it names `fork` (`/branch`) too, and it is the same boundary on which the engine empties `$.state`: the guard's ledger and the meter's run are reset by one event, which is the invariant this change exists to hold. *Why `compact` is not a boundary.* A compaction keeps the session, its tasks and its `$.state`; the run is still the session's run.

*Why the pane is not closed.* The module has no close call to make, and a pane reading the existing `no ship run is live in this session` text is true. Adding a close would widen the allow-list for a cosmetic.

### D5 — What the three places say

- Status line: `interlock: <position>` as today, then ` · quiet <n> min` while the word is set. Cleared at close, halt and the boundary as today.
- Spinner suffix: `<position>` as today, then ` · quiet <n> min` while the word is set; `next(e)` when nothing is live.
- Pane: a new keyed line after the action line, `last activity <ISO>` or `last activity unknown`, with ` · quiet <n> min` while the word is set. The plan-window lines are unchanged and keep no threshold text. The close summary section shows no word.

No colour, no cause, no number in the text that is not the figure itself.

### D6 — Tests: the kit drives the clock, the Node runner holds the rule and the pins

- `test/mod/meter.test.ts` gains, under the existing `world()` plus `mock.clock(on, { now: T0 })`: the boundary repro (a live run, then `classic.SessionStart` with each of `clear`, `resume`, `fork`; status cleared, pane at no-run, a later step named once and ignored), the pass-through (`compact`, `startup`, a missing source), the quiet word (advance to the cap less one, no word; to the cap, the word on status, suffix and pane; a step clears it; a `turn.step` answer with no step clears it), and the clock failure (a `clock.now` stub that rejects after the first read: stamp unchanged, word absent, `last activity unknown` when never read, one debug line). If `advance` does not drive `$.clock.every` in this build, the test stubs `on('clock.every', …)` to capture `fn` and calls it, which is the kit's own pattern for answering in the engine's place; task 1 records which.

  *Task 1.1(a), answered (2026-10-05, 2.1.289).* `mock.clock(on, { now }).advance(ms)` drives `$.clock.every`: a scratch mod's `every(1000, fn)` ran four times across an advance of 4,500 ms, and each `$.clock.now()` inside `fn` read its own period's time. With no mocked clock an interval never fires and nothing fails. The quiet-word cases therefore use `mock.clock` and `advance`. The clock-failure cases cannot: the kit refuses a test's second `on('clock.now')` beside `mock.clock` (`on("clock.now") registered twice`), and a `clock.now` stub that throws is skipped. So those cases answer the clock themselves: `on('clock.now')` returns `{ value: T0 }` and then `{ deny }`, which rejects the plugin's read with the reason, and `on('clock.every')` holds each period in a promise the test resolves, so the test lets one period through at a time. Also found: a module's `classic.SessionStart` hook receives `source` exactly as raised (a missing one is `undefined`, a number stays a number), and the kit needs a test `on('classic.SessionStart')` beneath it.
- `test/spine/meter-quiet.test.mjs` (Node): `quietMs` with `null`, non-numbers, a clock that went backwards (never negative), equal stamps; `quietWord` at the cap, one below, under a minute, large values; `TICK_MS` is the published cap.
- `test/spine/mod-pins.test.mjs`: `ALLOWED_CALLS` gains `$.clock.every`; `HOOKED_EVENTS` gains `classic.SessionStart`; `$.clock.sleep` joins the forbidden tokens, so the budget-charged form cannot creep in; the import walker covers `lib/meter-quiet.mjs` by construction.
- `test/spine/limits.test.mjs`: the two printed caps, and the reader pin on `lib/meter-quiet.mjs` with the no-restatement check on `hooks/mod.mjs`.

### D7 — The validate lines this change records

Expected after implementation, to be pasted into this section by the implementer from `claude plugin validate . --strict`:

- `hooks:` adds `classic.SessionStart` to today's list.
- `calls:` adds `$.clock.every (via …)` to today's list.
- `state reads:` and `state writes:` unchanged: `interlock.ledger`.

*Recorded (2026-10-05, Claude Code 2.1.289, task 3.2).* `claude plugin validate . --strict` on the implemented tree prints:

```
  ❯ ./mod.mjs hooks: session.start, prompt.submit, session.receive{origin has {kind=task-notification}}, tool.call{tool=Workflow}, tool.call{tool=Bash}, turn.step, turn.complete, agent.spawn, classic.SessionStart, ui.render{component=Spinner}, ui.render{component=Pane, requestId=interlock-meter}, command.run{command=interlock-meter}
  ❯ ./mod.mjs calls: $.clock.every (via startTick), $.clock.now (via changeRecord, clockNow, guardFacts), $.command.register, $.session.usage (via drawPane), $.session.version, $.state.get (via changeRecord, guardFacts), $.state.set (via changeRecord), $.ui.invalidate, $.ui.log, $.ui.open (via openPane), $.ui.resolve (via drawPane), $.ui.status, $.ui.toast
  ❯ ./mod.mjs state writes: interlock.ledger
  ❯ ./mod.mjs state reads: interlock.ledger
```

Diffed against the same command on `git archive HEAD` (commit 4a1c06f, whose lines are the archived `draw-the-ship-run-live` lines plus the archived `guard-ship-relaunch-in-process` additions), the `hooks:` line gains exactly `classic.SessionStart` and the `calls:` line gains exactly `$.clock.every (via startTick)`. The other two differences are attribution, not new calls: `$.clock.now` gains `clockNow` among its callers, and `$.ui.status` loses its `(via applyRecord)`, because the boundary hook and the interval now call it too. The state lines are unchanged. The only other finding is the known root `CLAUDE.md` warning, which `--strict` turns into the pre-existing failure.

*Probe 2, recorded (2026-10-05, 2.1.289, task 4.2).* One terminal session, `claude --plugin-dir .` in the repository, driven through `scripts/host-probe.mjs --mode tty` (Haiku, 200×60 tmux). It launched a stand-in, not `/interlock:ship` on a ready change. That stand-in was a zero-agent Workflow script at `<scratchpad>/probe2/workflows/ship.js`, which the launch rule's `workflows/ship.js` match counts as a ship launch. Three reasons. The only change in `openspec list` was this one, mid-apply. A real run ends in a commit on the current branch. And a healthy run is continuously active, so the word would show only if the run happened to stall for the threshold; with no step ever crossing, the stand-in is quiet by construction. What it showed, with the person idle and no turn running:

- At launch (15:36:54.809Z) the meter logged `interlock meter: engine 2.1.289, drawing on terminal`, the pane seated unasked at 200 columns, and it read `last activity 2026-10-05T15:36:54.809Z` with no word.
- At 15:42:15Z, one threshold and a period later, the status line under the prompt read `⚠ interlock: interlock: quiet 5 min`, and the pane, redrawn by the interval's invalidate, read `last activity 2026-10-05T15:36:54.809Z · quiet 5 min`. At the capture's end (15:44:07Z) both read `quiet 7 min`: the interval kept recomputing the minute with nobody at the keyboard. The plan-window lines beside it (`five_hour 26% used · resets …`, `seven_day 26% used · resets …`) carried no threshold text.
- The spinner was not drawn at all while the person was idle and no turn ran, so it carried nothing. The risk above anticipated this: the status line, which the interval sets, is the place the word is seen during a background run; the spinner suffix shows it only while a turn is drawing.
- The engine prefixes a plugin's status line with the plugin's name (`⚠ interlock:`), so the meter's own `interlock: ` prefix reads twice. That predates this change: the step status line from `draw-the-ship-run-live` carries the same prefix. It is recorded here, not changed, because that text is pinned by both changes' kit cases.

The session also left three files in the repository that the engine writes for a `--plugin-dir` session and a launch: a root `tsconfig.json` and `.claude-plugin/types/` (the engine's declarations, self-ignored), and the settings-form guard's `.claude/ship/launch-ledger/<session>.json`. They were removed after the probe. The ledger write, landing while `npm test` ran beside the probe, is what `test/spine/root-isolation.test.mjs` caught on that run; the suite was rerun once the probe had ended.

## Risks / Trade-offs

- [An interval from a previous load keeps ticking after a hot reload] → the generation guard in D2 and `session.start` cancelling any handle it finds; probe 1 in task 1 says whether the engine already cancels it. Installed plugins do not reload.
- [A refused `clock.every` period ends the interval silently, and the callback never runs to say so] → the pane recomputes the word at every draw from the clock, so `/interlock-meter` still answers; the status line would then stop updating the word. Accepted: the engine's refusal is logged by the engine, and the module cannot observe what never dispatches.
- [The spinner may not draw during a background run] → the status line, which the tick sets, is pinned under the prompt regardless; the spinner suffix is a second place, not the only one. Probe 2 records what draws.
- [A fifteen-second tick for the life of a run] → one dispatch per period, a clock read and a string compare; `$.ui.status` only on change, `invalidate` only when the word changes.
- [`quiet <n> min` read as a verdict] → the text names no cause; the pane keeps the plan windows beside it as reported; the docs say what the word means and does not mean.
- [A wrong cap value] → it is a display threshold; the cost is an early or a late word. `interlock limits` prints it, and it changes in one place.

## Migration Plan

None. The change is additive on a mods host and inert below the mods floor. Rollback is reverting the module, the two limits keys and the pure module; no file or state format changes.

## Open Questions

- Whether this build's `mock.clock().advance` drives `$.clock.every` or only `sleep` and `after`. Either way the tests are written; task 1 records which form they take. *Answered in D6: it does.*
- Whether the engine cancels a module's intervals on hot reload (probe 1). The guard in D2 is written regardless; the probe decides whether the design note calls it belt or braces. *Answered in D2: the engine cancels them; the guard is the belt.*
