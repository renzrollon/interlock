## Context

See proposal.md for the motivation. The wiring as it stands:

- **The settings form.** `hooks/guard-relaunch.mjs` is one script registered four ways in `.claude-plugin/plugin.json` (`PreToolUse` and `PostToolUse` with matcher `Workflow`, `UserPromptSubmit`, `UserPromptExpansion`). It is plumbing: the rule and its words live in `lib/launch-ledger.mjs`, which exports `SKILL_QUOTE`, `WAKE_MARKER`, `isShipLaunch(toolInput, ledger)`, `isAcceptedLaunch(toolResponse)`, `isHumanPrompt(prompt)`, `denyReason(lastLaunchAt)` and `decideLaunch(ledger, now, maxAgeMs)` beside the file transport `ledgerPath`, `readLedger`, `recordLaunch`, `recordPrompt` and `sweepStale`. The module imports `node:fs`, `node:path`, `./limits.mjs` and `./ship-stage.mjs` (for `SHIP_DIR`), so a hooks module cannot import it. The ledger record is `{ schema: 'interlock.launch-ledger/1', launches: [{ at: <ISO>, runId, workflowName, scriptPath }], lastHumanPromptAt: <ISO> | null }`; `decideLaunch` reads ISO strings and compares milliseconds against `LIMITS.launchLedgerMaxAgeMs`. `isHumanPrompt` tells a person from the host's completion wake by the prompt text's `<task-notification>` prefix, the fact the previous change captured. The deny goes through `deny()` in `hooks/_shared.mjs` (the `PreToolUse` deny shape with `permissionDecisionReason`); `test/hooks.test.mjs` pins the reason's tokens (`Leftover`, `not authorization`, `new message`) and that `skills/ship/SKILL.md` still contains `SKILL_QUOTE`. `docs/13-the-guards.md` says the in-process form will replace the four registrations and that the page will say which form is active.
- **The hooks module** (`draw-the-ship-run-live`): `hooks/hooks.json` names `hooks/mod.mjs`; the module already hooks `tool.call` on `Workflow` to detect a ship launch from the input's two handles and the result's status, keeps module-level state, imports only Node-free modules, and is pinned by `test/spine/mod-pins.test.mjs` (allow-list, forbidden tokens including `deny`, resolvable imports) and tested by `test/mod/*.test.ts` under `claude plugin test`. Its task 1 recorded what an older host does with a `types` manifest key.
- **What the engine stamps.** `prompt.submit` carries `text`, `context?`, `turnId?`, `wait` and `origin.kind` from a closed set: `composer`, `bridge`, `sdk`, `task-notification`, `scheduled-trigger`, `peer`, `peer-send-message`, `projects-relay`, `channel` (with `server`), `coordinator`, `observer`, an observer digest, and a plugin's own; no hook may set an origin. `session.receive` fires for an inbound delivery before it is queued with `origin.kind` and `text`; `{ consumed }` would keep it from Claude. The Workflow tool's input carries `scriptPath`, `name`, `args`, `resumeFromRunId`; its result `status`, `taskId`, `runId`, `workflowName`, `scriptPath` (the persisted script), `error?`. A mod that answers `tool.call` without `next` keeps the plugins' `PreToolUse` settings hooks from running; a deny reaches the model as the tool's error text. `$.state` values are declared under the plugin's name in `interface PluginState` in a `types/index.d.ts` the manifest names with `types`, used through `atom`, `read` and `update` imported from the bare `claude-code`; a write is refused inside `ui.render`; `claude plugin validate` fails an undeclared key. `$.clock.now()` is the module's clock, which the test kit can move. `$.store` is machine-wide.
- **Where mods do not load.** Below 2.1.287 (the Desktop engine on this machine is 2.1.286; the `claude` on PATH is 2.1.274), and under `disableAllHooks`, `--safe-mode`, `--bare` or an organisation's `allowManagedModsOnly`. There, only the settings form runs.

Constraints inherited: the mod observes and the CLI decides, with this change's one deny being a binary rule read off recorded facts; no `.catch`, no `tool.check`; no `$.store` as a session ledger; the published age is `LIMITS.launchLedgerMaxAgeMs`, printed by `interlock limits`; a new skill instruction is pinned by tokens, and here the skill is unchanged; `openspec/` is written through the CLI.

## Goals / Non-Goals

**Goals:**

- One rule, two transports: the decision and its words are defined once in a Node-free module that the settings hook, the hooks module and both test suites import.
- The in-process form reads the engine's own prompt origin, keeps its ledger in declared session state, and denies before the engine runs the call.
- Both forms ship and the guards page says which is active where; on a mods host the two never double-deny.

**Non-Goals:**

- Retiring the four settings registrations, which waits on the plugin's version floor reaching the mods floor.
- Judging the text of a prompt, counting launches across sessions, or treating a queue of launches as one.
- Any threshold: there is no number in the module beyond the published age it imports.

## Decisions

### D1 — Extract the rule into `lib/launch-rule.mjs`; the ledger module re-exports it

`lib/launch-rule.mjs` (new) holds `LEDGER_SCHEMA`, `SKILL_QUOTE`, `WAKE_MARKER`, `SHIP_SCRIPT`, `SHIP_NAME`, `LAUNCHED`, `isShipLaunch`, `isAcceptedLaunch`, `isHumanPrompt`, `denyReason`, `newestLaunch`, `promptMs`, `decideLaunch`, and a new `emptyRecord()` returning `{ schema, launches: [], lastHumanPromptAt: null }`, plus `withLaunch(record, { at, runId, workflowName, scriptPath })` and `withPrompt(record, at)` as pure record transforms (bounded: `launches` keeps the newest `LIMITS.launchLedgerMaxAgeMs`-window entries, dropping those past the age, the same sweep the file form applies on write). It imports only `./limits.mjs`. `lib/launch-ledger.mjs` imports the rule from it, re-exports every rule name unchanged (`export { … } from './launch-rule.mjs'`), and keeps the file transport, with `recordLaunch` and `recordPrompt` now applying `withLaunch` and `withPrompt` before writing so the file and the state record are transformed by the same functions. `hooks/guard-relaunch.mjs` and `test/hooks.test.mjs` import what they import today. A test in `test/spine/launch-ledger.test.mjs` asserts the rule module's source has no `node:` import and that each re-exported name is the same function object (`assert.equal(ledger.decideLaunch, rule.decideLaunch)`).

This is the invariant sweep of `_shared/INVARIANT-SWEEP.md`: the rule is a value two consumers read; it is normalised once, and each consumer is asserted to read the canonical form. The readers, enumerated: (1) `hooks/guard-relaunch.mjs` through `lib/launch-ledger.mjs`; (2) `hooks/mod.mjs` through `lib/launch-rule.mjs`; (3) the two test suites. Nothing else decides a launch, and the pins test asserts the module's only `deny` is `{ deny: denyReason(...) }`.

*Alternative considered.* Copying the rule into the module: two sentences to keep aligned, and the first reword of `SKILL_QUOTE` would pass one pin and fail the other.

### D2 — The state record mirrors the file record, as ISO strings

The `$.state` value under `interlock` is `ledger: LaunchRecord`, one atom holding the whole record `{ schema, launches, lastHumanPromptAt }` with ISO-string times, exactly the file form, so `decideLaunch`, `isShipLaunch`, `withLaunch` and `withPrompt` run unchanged over it. The proposal's `number | null` for `lastHumanPromptAt` is realised as the ISO string the rule already reads; `$.clock.now()` gives the milliseconds and `new Date(ms).toISOString()` the string. `types/index.d.ts` declares `interface PluginState { interlock: { ledger: LaunchRecord } }` with `LaunchRecord` and `Launch` exported types; `.claude-plugin/plugin.json` gains `"types": "./types/index.d.ts"`; `package.json`'s `files` gains `types`. One key, not two, so a half-written pair (a launch recorded, the prompt time not) cannot exist between two `update` calls.

*Amended after task 1.1.* The key is read and written with `$.state.get` and `$.state.set` (with `ifVersion`, retried on a miss as `update` would) inside a function declared in `hooks/mod.mjs`, under a module-level `{ plugin: 'interlock', key: 'ledger' }` literal, not through `atom`, `read` and `update`: 2.1.274's validator refuses a module that passes `$` to a function imported from `claude-code`, and that would unload the meter there too (Open Questions, probe results).

*Validate, recorded (task 2.2, 2026-10-05, after §3).* `claude plugin validate . --strict` on 2.1.289, this checkout:

```
  ❯ types ./types/index.d.ts declares on $: nothing (no EngineInterface member)
  ❯ types ./types/index.d.ts declares state: interlock.ledger
  ❯ ./mod.mjs hooks: session.start, prompt.submit, session.receive{origin has {kind=task-notification}}, tool.call{tool=Workflow}, tool.call{tool=Bash}, turn.step, turn.complete, agent.spawn, ui.render{component=Spinner}, ui.render{component=Pane, requestId=interlock-meter}, command.run{command=interlock-meter}
  ❯ ./mod.mjs calls: $.clock.now (via changeRecord, guardFacts), $.command.register, $.session.usage (via drawPane), $.session.version, $.state.get (via changeRecord, guardFacts), $.state.set (via changeRecord), $.ui.invalidate, $.ui.log, $.ui.open (via openPane), $.ui.resolve (via drawPane), $.ui.status (via applyRecord), $.ui.toast
  ❯ ./mod.mjs state writes: interlock.ledger
  ❯ ./mod.mjs state reads: interlock.ledger
```

The run still ends `✘ Validation failed (--strict treats warnings as errors)` on the pre-existing root `CLAUDE.md` warning (`draw-the-ship-run-live` D10, a separate fix), and on nothing this change adds. On the repository root 2.1.274 and 2.1.161 validate only the marketplace manifest and pass. On a copy of the plugin without `marketplace.json`, 2.1.274 passes `--strict` listing the same hooks and calls (it prints no state lines), and 2.1.161 fails `--strict` on the `types` warning alone.

*Alternative considered.* Two atoms, as the brief sketched: two writes per event and a window where they disagree.

### D3 — Three hooks, one branch

- `prompt.submit`: `if (HUMAN_ORIGINS.has(e.origin?.kind)) await update($, ledger, r => withPrompt(r, nowIso($)))`; `return next(e)`. `HUMAN_ORIGINS = new Set(['composer', 'bridge', 'sdk'])`. Every other kind, and a missing origin, counts nothing. The text is never read and never rewritten; `e.context` is untouched. Decisions 1 and 2 of the brief: `sdk` counts (it is the `-p` caller's instruction) and `bridge` counts (the user on a phone).
- `tool.call` on `{ tool: 'Workflow' }`, the meter's existing hook, gains a branch before its `next`: `const record = await read($, ledger)`; `if (isShipLaunch(e, record)) { const verdict = decideLaunch(record, $.clock.now()); if (verdict.decision === 'deny') return { deny: verdict.reason } }`. Otherwise `const r = await next(e)`; when `isShipLaunch(e, record) && isAcceptedLaunch(r.result)` the record gains `withLaunch(record, { at: nowIso($), runId: r.result.runId ?? null, workflowName: r.result.workflowName ?? null, scriptPath: r.result.scriptPath ?? null })`. The meter's live-flag logic follows, unchanged, on `r`. `isShipLaunch` reads `e.scriptPath`, `e.name` and `e.resumeFromRunId` directly: the tool.call input's fields are the tool's arguments, the same names the settings hook reads from `tool_input`.
- `session.receive` on `{ origin: { kind: 'task-notification' } }`: `$.ui.log('interlock guard: completion wake received; not a human prompt', { to: 'debug' })`; `return next(e)`. Never `{ consumed }`.

*Amended after task 1.1.* `read($, ledger)` and `update($, ledger, fn)` above are spelled as the module's own `readLedger($)` and `changeLedger($, fn)` over `$.state.get` and `$.state.set` (D2's amendment). A `prompt.submit` whose origin does not count writes one debug line naming its kind (`interlock guard: <kind> prompt is not a human prompt; not counted`), because the probe found the completion wake arrives there and not at `session.receive`; the `session.receive` hook keeps its line for the relayed deliveries that do arrive there. A state read that throws is caught in the hook, read as `emptyRecord()` and named on the debug log (the allow direction, the meter's branch still runs), and a write that throws after `next` resolved is caught and named the same way, so a failed record never makes the engine re-run a launch it already started.

`deny` is a reserved token in the meter's pins; the pins test's forbidden list is amended so the one permitted form is `{ deny: verdict.reason }` where `verdict` is `decideLaunch`'s result, asserted by a source-level check that every `deny` occurrence in the module is that literal shape.

### D4 — Precedence and the two forms

On a mods host the engine runs the module's `tool.call` hook before the plugins' `PreToolUse` settings hooks. A deny returns without `next`, so `guard-relaunch.mjs` never starts; an allow calls `next`, the settings hook runs over its own file ledger, and the two agree whenever their records agree. They differ in exactly one classification: the settings form counts any `UserPromptSubmit` whose text does not begin with the wake marker as a person, so a `peer`, `peer-send-message`, `scheduled-trigger` or `channel` prompt re-arms it; the mod counts none of them. On a mods host the mod's stricter reading decides first, so the effective rule is the mod's; on an older host the settings reading stands. Both are stated in `docs/13`, with the fail-open table row for the in-process form (a throw is skipped and the launch proceeds to the settings hook) and the sentence that retiring the four registrations waits on the plugin's floor. The settings form's own tests, fixtures and ledger are untouched.

*Alternative considered.* Removing the four registrations now: raises the plugin's floor to 2.1.287 and leaves the Desktop 2.1.286 engine on this machine with prose only, a regression for the very host the operator uses.

### D5 — Fail-open in process

No `.catch` handler. A thrown hook is skipped by the engine and the chain runs, which is the allow direction; the test kit case makes `state.get` reject and asserts the launch proceeds. (As amended in D3, the state read and the record write are themselves wrapped, so the guard's failure is named on the debug log and leaves the meter's branch of the same hook running; a throw anywhere else in the hook is still the engine's skip.) A missing or malformed state record (`read` returning a value that is not an object with a `launches` array) is treated as `emptyRecord()`, the allow direction. An `origin` the module does not know counts nothing, also allow. The published age is applied on read by `decideLaunch`, so an aged launch allows without a sweep.

### D6 — Tests

`test/mod/relaunch.test.ts` under `claude plugin test`: the cases the proposal lists, driven through the kit's `$.tool.call` for `Workflow` with stubbed results (`status: 'async_launched'`, `runId`, `scriptPath`; a deny; an error), `prompt.submit` with each origin kind, `session.receive` with a `task-notification`, the mocked clock advanced past `LIMITS.launchLedgerMaxAgeMs`, and `state.get` made to reject. `test/spine/launch-ledger.test.mjs` gains the rule-module pins and `withLaunch`/`withPrompt` cases (bounded, aged entries dropped, the file form's `recordLaunch` producing the same record as `withLaunch` over the read file). `test/spine/mod-pins.test.mjs` gains: the `$.state` keys the module names (`{ plugin: 'interlock', key: 'ledger' }`) match `types/index.d.ts`; the allow-list grows by exactly `$.clock.now` and the state calls; the only `deny` is the rule's. `test/spine/package.test.mjs` gains the `types` coverage case. `test/hooks.test.mjs` and `test/skills.test.mjs` are unchanged.

### D7 — The hole stays named, in the same words

A prompt typed and queued during the run (Desktop "Send now") is `composer` and resets the clock, so a relaunch after the completion wake would pass. The settings form has the same hole, named in the previous change's CHANGELOG entry; `docs/13` keeps the sentence and adds that the in-process form shares it. The eval `evals/trampoline-launch` keeps measuring the prose.

## Risks / Trade-offs

- [An older host refuses the `types` manifest key] → the previous change's task 1 measured it; if refused, this change's first task stops and records that the state must stay module-level until the floor rises.
- [`e.origin` is absent on some host build] → counts nothing, the allow direction; the debug line names the kind it saw.
- [The engine changes an origin kind's name] → the set is three literals in one place; a renamed kind allows, never denies, and the kit's test over each kind catches the drift when the type file changes.
- [Two forms, one rule, two ledgers] → one rule module with identity-pinned re-exports; the ledgers are the transports, and the precedence makes the mod's reading decisive on a mods host.
- [A false deny] → one typed message, the same remedy as the settings form, in the same words.
- [The `deny` token now appears in a module whose pins forbid it] → the pin narrows to the one literal shape rather than being dropped.

## Migration Plan

Additive. New `lib/launch-rule.mjs`, `types/index.d.ts`, `test/mod/relaunch.test.ts`; `lib/launch-ledger.mjs` re-exports; three hooks in `hooks/mod.mjs`; `types` in the manifest and in `files`. The settings form's behaviour on every host is unchanged. Rollback is reverting the commit; the file ledger is untouched and the session state is the host's and empties with the session.

## Open Questions

- **Whether `sdk` should count as a human prompt.** Recommended and implemented as yes; a `-p` caller that wants a second launch sends a second prompt. Changing it is one literal.
- **Whether a channel's message (`channel`) should count.** Implemented as no, with the other relayed origins. Reopen if a Slack-driven ship becomes a real pattern.

### Probe results (task 1.1, 2026-10-05)

All runs through `scripts/host-probe.mjs` (clean login env, unsandboxed), scratch plugins in the session scratchpad.

- **The `types` key on older hosts: safe; the change keeps it.** `draw-the-ship-run-live`'s Open Questions recorded the validate half: 2.1.274 and 2.1.289 pass `--strict` with `"types": "./types/index.d.ts"`; 2.1.161 warns `types: Unknown field 'types'. Claude Code ignores it at load time.`, which `--strict` alone turns into a failure. Re-measured on a scratch plugin with the dual-shape `hooks/hooks.json`, a contract declaring `PluginState`, and the manifest's `SessionStart` and `PreToolUse` settings hooks: the same three results. The runtime half, not measured before, on 2.1.161 headless (`--model claude-haiku-4-5-20251001`): the `SessionStart` hook ran (the model quoted `SessionStart hook additional context: PROBE-SESSIONSTART-RAN`) and the `PreToolUse` deny reached the model (`PROBE-DENY-REACHED`). 2.1.161 neither refuses the manifest nor drops the settings hooks beside `types`, so D2 stands with the key. The one cost: `claude plugin validate . --strict` on 2.1.161 fails this checkout on the warning; the plugin's install-time load does not.
- **2.1.274 refuses `$` passed to `read` or `update`.** A module that calls `read($, atom)` or `update($, atom, fn)` imported from `claude-code` fails validation on 2.1.274: `$ is passed to "read", imported from "claude-code": $ is followed only into a function declared in this same file, never across an import`. 2.1.289 accepts it. The same state access spelled `$.state.get(LEDGER)` and `$.state.set(LEDGER, value, { ifVersion })`, with `LEDGER` a module-level `{ plugin, key }` literal and the calls inside a function declared in the module, passes both (2.1.274 lists `$.state.get (via …)`; 2.1.289 also prints `state reads:` and `state writes:` naming the key). The hooks module therefore imports nothing from `claude-code` and calls `$.state` directly (D2, D3 amended), so the meter that 2.1.274 already loads is not refused for the guard's sake.
- **`prompt.submit` origins on 2.1.289: as the type file says.** Interactive session in tmux, a scratch logger mod hooking `prompt.submit`, `session.receive` and `tool.call` on `Workflow`; the typed prompt launched a zero-agent workflow. The typed prompt arrived as `{ text, wait: false, origin: { kind: 'composer' } }` with no `turnId`. The completion wake arrived as `prompt.submit` with `origin: { kind: 'task-notification' }`, a `turnId`, and text beginning `<task-notification>` (the settings form's wake marker). Pinned, scrubbed, as `test/fixtures/mod/prompt-submit-composer.json` and `test/fixtures/mod/prompt-submit-task-notification.json`.
- **`session.receive` did not fire for the completion wake.** The logger saw no `session.receive` event in that session: the wake reaches a hooks module through `prompt.submit` only. The type file describes `session.receive`'s `task-notification` as "a relay's event or a trigger". D3 is amended so the guard's debug line for a wake is written from `prompt.submit` (every origin that does not count names its kind); the `session.receive` hook stays for the relayed deliveries the type file names, logging and passing them on.
