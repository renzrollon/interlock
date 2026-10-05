## 1. Probes and failing tests first (TDD, red)

- [x] 1.1 Probe the two facts design D2 and D6 lean on, with a scratch mod under `$TMPDIR` (never under `~/.claude/dev-mods/`): (a) under `claude plugin test <scratch>`, whether `mock.clock(on).advance(ms)` runs a `$.clock.every` callback, or whether a test must stub `on('clock.every', …)` and call the captured `fn`; (b) in a `claude --plugin-dir <scratch>` terminal session driven by hand (the launch recipe is `scripts/host-probe.mjs --mode tty`), whether an interval started by `session.start` keeps firing after the module file is edited and hot-reloaded, i.e. whether the engine cancels a reloaded module's intervals. Record both answers in design.md D2 and D6; if (b) cannot be run, say so there and keep the generation guard. (spec: hooks/ship-meter — the quiet figure; observe-only)
- [x] 1.2 RED kit cases in `test/mod/meter.test.ts`, under the existing `world()` plus `mock.clock(on, { now: T0 })` in the form 1.1(a) found: the boundary repro (a live run with a status line and a wave row, then `classic.SessionStart` with `source` `clear`, then `resume`, then `fork`: the status line is cleared, the pane on both surfaces reads the no-run text, a later driver-line Bash result sets no status and leaves exactly one debug line naming a step with no live run); the pass-through (`compact`, `startup`, and a missing `source` leave the status line, the rows, the tallies and the interval unchanged, and the event resolves as the stub beneath answered); the quiet word (advance to `LIMITS.meterQuietAfterMs` less one: no word on status, spinner suffix or pane; to the cap: `quiet <n> min` on all three with the position before it and `last activity` plus its ISO time on the pane; a later step clears it; a `turn.step` answer for a run agent with no step between also clears it); and the clock failure (a `clock.now` stub that rejects from the second read: the stamp stays, the word is absent, one debug line, every hook resolved as the engine alone would; and a run whose clock never answered shows `last activity unknown`). Assert the kit is RED before §2 and §3. (spec: hooks/ship-meter — the quiet figure; inert outside a live run; the pane)
- [x] 1.3 RED Node cases: a new `test/spine/meter-quiet.test.mjs` (`quietMs` returns `null` for a `null` or non-numeric stamp or now, `0` when the clock went backwards, the difference otherwise; `quietWord` is `null` below the cap and at `null`, `quiet <n> min` at the cap exactly with `<n>` the floored minutes, `quiet <1 min` under a minute, and a large value floors; `TICK_MS` equals the published cap); in `test/spine/limits.test.mjs`, `meter quiet after (ms)` and `meter tick (ms)` are printed with their values, `lib/meter-quiet.mjs` reads both keys, and `hooks/mod.mjs` restates neither (no `meterQuietAfterMs`, `meterTickMs`, `5 * 60 * 1000` or `15 * 1000`); in `test/spine/mod-pins.test.mjs`, `ALLOWED_CALLS` gains `$.clock.every`, `HOOKED_EVENTS` gains `classic.SessionStart`, the forbidden tokens gain `$.clock.sleep`, and the existing cases read as before. Assert `npm test` is RED before §2 and §3. (spec: hooks/ship-meter — the quiet figure; observe-only)

## 2. The caps and the pure rule (make §1's Node cases green)

- [x] 2.1 In `lib/limits.mjs` add `meterQuietAfterMs` and `meterTickMs` beside `launchLedgerMaxAgeMs` with doc comments carrying design D3's derivation, and print them from `formatLimits` as `meter quiet after (ms)` and `meter tick (ms)`. Create `lib/meter-quiet.mjs`, pure and Node-free, importing only `./limits.mjs`, exporting `quietMs(lastActivityAt, now)`, `quietWord(ms)` and `TICK_MS` as design D3 states them. `node --test test/spine/meter-quiet.test.mjs test/spine/limits.test.mjs` goes green; the mod-pins cases stay red until §3. (spec: hooks/ship-meter — the quiet figure)

## 3. The hooks module (make §1's kit cases green; needs §2)

- [x] 3.1 In `hooks/mod.mjs`: import `quietMs`, `quietWord` and `TICK_MS` from `../lib/meter-quiet.mjs`; add `lastActivityAt`, `quietWord`, `tick`, `generation`, `clockFailed` and `idleStepNamed` to `freshRun()`; stamp `lastActivityAt` from `$.clock.now()` at the accepted launch (the guard's `now`), in `applyRecord`, at `turn.step` entry and after `yield* next(e)`, in `turn.complete` and in `agent.spawn`, a rejected read leaving the stamp and logging once (design D1); start `run.tick = $.clock.every(TICK_MS, fn)` after the pane open, `fn` returning at once when `run.tick` is not its own handle, else reading the clock, recomputing the word, calling `$.ui.status` only when the composed text changed and `$.ui.invalidate('ui.render')` only when the word changed (design D2); cancel the tick in `applyRecord` on close, halt and the close record, and in `session.start` when a handle exists; add `on('classic.SessionStart', …)` resetting on `clear`, `resume` and `fork` and passing `startup`, `compact` and a bad source through, inside a `try` that logs and still returns `next(e)` (design D4); append the word to the status line and the spinner suffix and add the keyed `last activity` line to the pane (design D5); and in the Bash hook, when a driver-line step crosses with no live run, log the one idle-step line and set `idleStepNamed`. `claude plugin test .` and `npm test` go green. (spec: hooks/ship-meter — all four requirements)
- [x] 3.2 Run `claude plugin validate . --strict` and paste its `hooks:`, `calls:`, `state reads:` and `state writes:` lines into design.md D7; confirm the only differences from the archived `draw-the-ship-run-live` lines are `classic.SessionStart` and `$.clock.every`. (spec: hooks/ship-meter — observe-only)

## 4. Docs, changelog and the brief (needs §3)

- [x] 4.1 `docs/07-cli-and-configuration.md`: under the ship meter, the `quiet <n> min` word (what it counts as activity, that it names no cause, that the two caps are in `interlock limits`) and that `/clear`, `/resume` and `/branch` end the run the meter holds while a compaction does not. `docs/13-the-guards.md`: add `classic.SessionStart` to the module's row and to the hooks list in the ship-meter section, with the sentence on why `compact` is not a boundary and that the launch ledger resets on the same event. `CHANGELOG.md` Unreleased: one entry for the quiet word and one for the boundary fix, in the file's voice. `briefs/claude-code-teams-and-orchestration-briefs.md`: a short dated note after the rejected-mechanisms list recording what reading the built-in mods' source added (the `diff` mod's boundary reset, now this change; the version-only `mods` doctor row on a managed machine; the inline-dialog fallback) and that Brief 9's recording half is retired because Brief 4's probe passed. (spec: hooks/ship-meter — inert outside a live run; the pane)
- [x] 4.2 Final verification: `npm test`, `claude plugin test .`, `claude plugin validate . --strict` (the root `CLAUDE.md` warning is the known pre-existing failure and the only one allowed), and one `claude --plugin-dir .` terminal session that launches `/interlock:ship` on a ready change and records in design.md D7 whether the status line and the spinner carried the word while the person was idle (probe 2); paste the three commands' tails into the change's closing note. (spec: hooks/ship-meter — the mod's tests)

## Closing note (2026-10-05, Claude Code 2.1.289)

`npm test`, run outside the sandbox: the notify-relay cases in `test/spine/cli.test.mjs` and `test/spine/run.test.mjs` bind a local port, which the sandbox refuses with `EPERM`. A first run beside probe 2 failed `root-isolation` on the probe session's launch-ledger write into this repository and `host-adapters` on one temp-dir cleanup under load. With nothing running beside it:

```
ℹ tests 2577
ℹ suites 14
ℹ pass 2573
ℹ fail 0
ℹ cancelled 0
ℹ skipped 4
ℹ todo 0
ℹ duration_ms 73843.721958
```

`claude plugin test .`:

```
 39 pass
 0 fail
Ran 39 tests across 2 files. [0.68s]
```

`claude plugin validate . --strict` (the root `CLAUDE.md` warning is the known pre-existing failure and the only finding):

```
⚠ Found 1 warning:

  ❯ root: CLAUDE.md at the plugin root is not loaded as project context. To ship context with your plugin, use a skill (skills/<name>/SKILL.md) instead.

Validating hooks: /Users/caro/IdeaProjects/specflow/hooks/hooks.json

  ❯ ./mod.mjs hooks: session.start, prompt.submit, session.receive{origin has {kind=task-notification}}, tool.call{tool=Workflow}, tool.call{tool=Bash}, turn.step, turn.complete, agent.spawn, classic.SessionStart, ui.render{component=Spinner}, ui.render{component=Pane, requestId=interlock-meter}, command.run{command=interlock-meter}
  ❯ ./mod.mjs calls: $.clock.every (via startTick), $.clock.now (via changeRecord, clockNow, guardFacts), $.command.register, $.session.usage (via drawPane), $.session.version, $.state.get (via changeRecord, guardFacts), $.state.set (via changeRecord), $.ui.invalidate, $.ui.log, $.ui.open (via openPane), $.ui.resolve (via drawPane), $.ui.status, $.ui.toast
  ❯ ./mod.mjs state writes: interlock.ledger
  ❯ ./mod.mjs state reads: interlock.ledger

✘ Validation failed (--strict treats warnings as errors)
```

Probe 2 ran against a zero-agent stand-in for the ship workflow, not `/interlock:ship` on a ready change; why, and what the status line, the spinner and the pane showed, is in design.md D7.
