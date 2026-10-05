## Why

The single most expensive recorded mistake, a model relaunching `/interlock:ship` over leftover checkboxes, is now bounded by `guard-ship-relaunch`: four settings-hook registrations and a file ledger under `.claude/ship/launch-ledger/<session_id>.json`, which denies a second launch when no human prompt has arrived since the last one. That change answered its decisive probe by capture: the completion wake arrives as a `UserPromptSubmit` whose prompt begins with `<task-notification>`, so `lib/launch-ledger.mjs` tells a person from the host's wake by a string prefix on the prompt's text. It works, and `docs/13-the-guards.md` already says what comes next: "When the host can load plugin mods (2.1.287 and later, with no `allowManagedModsOnly` policy), an in-process guard reading the engine's own prompt origin replaces these four registrations, and this page will say which form is active." This change is that guard (Brief 8 of `briefs/claude-code-teams-and-orchestration-briefs.md`, 2026-10-05 addendum).

The mods API answers by construction what the settings form infers. `prompt.submit` fires for every submission with `e.origin.kind`, a closed set the engine stamps: `composer` for the user's own Enter, `bridge` for Remote Control, `sdk` for `claude -p`, `task-notification` for a background task's wake, `scheduled-trigger`, `peer`, `peer-send-message`, a channel's, a coordinator's, an observer's, and a plugin's own (mods-22). The Workflow tool is a built-in tool whose `tool.call` input carries `scriptPath`, `name` and `resumeFromRunId`, and whose result carries `status`, `runId`, `workflowName` and the persisted `scriptPath` (mods-24). A mod that answers a `tool.call` without calling `next` keeps the plugins' `PreToolUse` settings hooks from running (mods-5), so the two forms never double-deny. `$.state` is per session, survives a hot reload and is reset by `/clear`, `/resume` and `/branch` (mods-14): no file in `.claude/ship/` in every repository with the plugin installed, no ledger to sweep, no session id to match. The hook runs in process, with no node process per tool call, and fails open by construction: a hook that throws is skipped and the chain runs (mods-12).

## What Changes

- **The rule moves into one Node-free module both forms read.** `lib/launch-rule.mjs` (new) holds `isShipLaunch`, `isAcceptedLaunch`, `isHumanPrompt`, `SKILL_QUOTE`, `WAKE_MARKER`, `denyReason` and `decideLaunch` over a plain record `{ launches, lastHumanPromptAt }`, importing only `lib/limits.mjs` for the published age. `lib/launch-ledger.mjs` keeps the file transport (`readLedger`, `recordLaunch`, `recordPrompt`, `sweepStale`, `ledgerPath`) and re-exports the rule, so `hooks/guard-relaunch.mjs` and `test/hooks.test.mjs` import what they import today. The rule is a value read by two consumers; it is normalised once, and a test pins that the two exports are the same functions and that the rule module names no `node:` import.
- **Three hooks in `hooks/mod.mjs`.** `prompt.submit`: when `e.origin.kind` is `composer`, `bridge` or `sdk`, the session's `lastHumanPromptAt` becomes now; `task-notification`, `scheduled-trigger`, `peer`, `peer-send-message`, `channel`, `coordinator`, `observer` and a plugin's own never count. It returns `next(e)`; the text is never rewritten and nothing is dropped. `tool.call` on `Workflow` (the hook the previous change added gains a branch before its `next`): a ship launch is `scriptPath` ending in `workflows/ship.js`, `name` matching `interlock:ship`, or a `resumeFromRunId` or `scriptPath` that matches a launch this session recorded; if the rule denies, the hook returns `{ deny }` with `denyReason`'s words, which quote `skills/ship/SKILL.md`'s sentence and name the remedy, and the engine hands them to the model as the tool's error text; otherwise it awaits `next(e)` and, when `isAcceptedLaunch(r.result)`, records `{ at, runId, workflowName, scriptPath }`. `session.receive` on `{ origin: { kind: 'task-notification' } }`: one `$.ui.log` line to the debug log and `next(e)`, never consumed, so the debug log shows the wake the guard then did not count as a prompt.
- **The ledger is session state, declared.** `types/index.d.ts` (new) declares, under `interlock`, `lastHumanPromptAt: number | null` and `launches: Launch[]`; `.claude-plugin/plugin.json` gains `"types": "./types/index.d.ts"`; `package.json`'s `files` gains `types`. Time comes from `$.clock.now()`, so the tests can move it. The record is never loaded from `$.store`, which is machine-wide and would deny one session's launch for another's.
- **Both forms ship, and the page says which is active.** The settings form stays as the only enforcement on a host below 2.1.287 (the Desktop engine on this machine is 2.1.286) and wherever `allowManagedModsOnly`, `disableAllHooks`, `--safe-mode` or `--bare` stops user mods. On a host where the mod loads, the mod runs first: its deny ends the call before the settings hook sees it, and its allow falls through to the settings hook, which reads its own ledger and agrees in every case the capture covered. The one way they differ is named: a `peer` or `scheduled-trigger` prompt is a human prompt to the settings form (its text does not begin with the wake marker) and not to the mod, so on a mods host the stricter reading wins. `docs/13-the-guards.md` names the two forms, which is active where, and that retiring the settings registrations waits on the plugin's version floor reaching the mods floor, which is not this change.
- **A `-p` run is covered the same way.** Hooks run in `-p` (mods-3). `claude -p "/interlock:ship x"` has one `sdk` prompt and then a launch; a second launch in the same run is denied by the same rule.
- **The named hole stays named.** A prompt typed during the run and queued (Desktop "Send now", desk-13) is a human prompt and resets the clock, so a relaunch after the completion wake would then pass. The guard cannot judge whether a prompt "explicitly asks to ship leftover tasks"; that is prose, and `evals/trampoline-launch` keeps measuring whether the model obeys it. The hook bounds the case that cost twenty agents: no human message at all between a run and its relaunch.
- **After `/clear`, `/resume` or `/branch`** the state resets and the next launch is allowed, which is the fail-open direction.
- **The prose, its pin and the eval are unchanged.** The skill sentence, `SKILL_QUOTE`, the token pin in `test/skills.test.mjs` and the eval stand; the mod's deny reason is built by the same `denyReason`, so one string is pinned in both forms.

No breaking change: the settings form's behaviour on every host is byte-for-byte today's; the manifest's `types` key is recognised on current hosts and, on an older host, is what the previous change's task 1 measured.

## Capabilities

### New Capabilities

None. The in-process guard is a second form of an existing capability.

### Modified Capabilities

- `hooks/launch-guard`: adds that the launch rule lives in one Node-free module both forms import; adds the in-process form (prompt origins that count as a person, the ship-launch identifiers including a recorded resume, the deny through the Workflow tool's error text, the session-state ledger and its lifetime, the debug line for the wake); adds which form is active on which host and that the mod's deny preempts the settings hook; modifies "The guard SHALL be registered on four events and tested as a process" so the four registrations are the settings form's and the in-process form is tested through `claude plugin test`.
- `hooks/ship-meter`: modifies the observe-only requirement so the one deny the module may return is the launch guard's, from `decideLaunch`, and no other; the allow-list gains `$.clock` and the `$.state` reads and writes the contract declares.
- `distribution/npm-package`: adds that the manifest's `types` path is covered by `files`, because a published plugin whose contract is missing fails `claude plugin validate` at install.

## Impact

**Code**

- `lib/launch-rule.mjs` (new), `lib/launch-ledger.mjs` (file transport only, re-exporting the rule), `hooks/mod.mjs` (three hooks, one a branch in the Workflow hook), `types/index.d.ts` (new), `.claude-plugin/plugin.json` (`types`), `package.json` (`files`).

**Tests**

- `test/mod/relaunch.test.ts` (new, `claude plugin test`): first launch allowed and recorded with the stubbed `runId`; a second launch with no prompt between is denied with the reason quoting the rule; a `composer` or `bridge` or `sdk` prompt between two launches allows; a `task-notification` prompt between denies; a resume naming the recorded `runId` or the persisted `scriptPath` is a launch; a `Workflow` call on another script is allowed and not recorded; a launch whose stubbed result is a deny or an error is not recorded; `session.receive` with origin `task-notification` is passed on and nothing is consumed; a hook made to throw lets the launch through.
- `test/spine/launch-ledger.test.mjs`: the rule module imports nothing from `node:`; the ledger module's rule exports are the rule module's functions; `decideLaunch` over a plain record behaves as over a read ledger.
- `test/spine/mod-pins.test.mjs`: the module's `$.state` keys match the contract; the deny reason contains the skill's sentence tokens; the allow-list grows by exactly `$.clock` and the state calls.
- `test/hooks.test.mjs` and `test/skills.test.mjs`: unchanged.

**Docs**

- `docs/13-the-guards.md` (the in-process row, the fail-open table entry, which form is active, the hole in words), `docs/07-cli-and-configuration.md` (the `types` key beside the other manifest facts), `CHANGELOG.md`.

**Dependencies and ordering**

- Depends on `draw-the-ship-run-live`: the module, its test convention, the CI step, the static pin, and task 1's record of what an older host does with `hooks/hooks.json` and a `types` manifest key. This change's first task reads that record and stops if the older host refused the manifest.
- Serialised with any other change that edits `hooks/mod.mjs`, `test/spine/mod-pins.test.mjs` or `docs/13-the-guards.md`.
- No registry edit, no new limits key: the published age `LIMITS.launchLedgerMaxAgeMs` is read by both forms.

**Out of scope**

- Retiring the four settings registrations; that waits on the plugin's version floor.
- The commit briefing's three nevers as a mod hook (`guard-commit` stays a settings hook).
- Launches across sessions, a queue of launches registering as one launch, judging the text of a prompt, and a plan-window ceiling on launch.
