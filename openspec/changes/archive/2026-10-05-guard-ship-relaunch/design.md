## Context

See proposal.md for the motivation. The ground as it stands:

- The rule is prose. `skills/ship/SKILL.md` §2 forbids a second `Workflow` call in the conversation and says only a new user message or a typed `/interlock:ship` is a relaunch; `test/skills.test.mjs` pins the sentence by tokens (`Do not call Workflow again`, `not authorization to call Workflow`); `evals/trampoline-launch` asserts `max: 1` on the Workflow tool with leftover boxes placed in front of the model. Nothing runs outside the model.
- The trampoline launches `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/ship.js", args })`. The script's `meta.name` is `ship`, so its namespaced command is `/interlock:ship`. The addendum's reading of the engine's own type declaration (mods-24) says the Workflow tool's input carries `scriptPath`, `name`, `args` and `resumeFromRunId`, and its result carries `status: 'async_launched'`, `taskId`, `workflowName`, `runId` (for a resume) and `transcriptDir`; the completion arrives later as a task-notification prompt (local-4). None of that is verified for the settings-hook payloads (`tool_input`, `tool_response`), which is why the first task captures them.
- Hook plumbing exists: `hooks/_shared.mjs` reads the event, allows by silence and denies in the `PreToolUse` shape with `permissionDecision: 'deny'`; the three guards are Node scripts the host spawns per call; `test/hooks.test.mjs` spawns a guard with a JSON event on stdin and a `cwd`, and pins the manifest registration of the preflight. `.gitignore` excludes `.claude/ship/`.
- Caps live in `lib/limits.mjs` and the cap-authority sweep (`test/spine/limits.test.mjs`) walks `lib/`, `bin/`, `workflows/`, `.github/workflows/` and the eval runners for a reader of every printed cap. It does not walk `hooks/`, so a cap read only by a hook would be a printed cap with no reader.
- The host facts the design relies on: a Workflow call goes through normal permission evaluation including `PreToolUse` hooks (orchestration-5); `UserPromptExpansion` exists beside `UserPromptSubmit` (orchestration-12); a timed-out command hook does not block (orchestration-13); hook payloads share `session_id`. The decisive unknown is whether a background workflow's completion wake fires a prompt event.
- Mods cannot load on this machine today: the CLI on PATH is 2.1.274 and the Desktop engine 2.1.286, both below the 2.1.287 floor (mods-1). Brief 8's in-process guard is therefore unprobeable here, and this change is the form that can ship.

Constraints inherited (`CLAUDE.md`, the briefs' "Repository constraints every brief inherits"): guards fail open on every unknown; command handlers only, never a prompt or agent handler; every plugin hook runs in every session in every repository and exits before any write when no ledger exists; thresholds live in `lib/limits.mjs` and are printed by `interlock limits`; a new skill instruction is pinned by tokens, and this change adds none; zero runtime dependencies.

## Goals / Non-Goals

**Goals:**

- Bound the one recorded relaunch mistake with a host-side deny that fails open on everything it cannot establish.
- Keep the decision pure and testable without a host: the rule lives in `lib/`, the hook is plumbing.
- Ship nothing that depends on an unverified payload shape: the capture gates the deny.
- Stay independent of `name-workflow-spawn-overrides-and-stops` so the two can be implemented in parallel.

**Non-Goals:**

- Judging whether a prompt "explicitly asks to ship leftover tasks". The guard counts a human prompt; the prose and the eval keep judging its content.
- A cross-session ledger, a launch queue, or the commit briefing's three nevers.
- Replacing Brief 8. When mods load, the in-process guard supersedes this one; the handover is a documentation sentence, not a migration.

## Decisions

### D1 — What identifies a ship launch

`isShipLaunch(toolInput)` in `lib/launch-ledger.mjs` returns true when the event's tool is `Workflow` and either `tool_input.scriptPath`, with path separators normalised, ends in `workflows/ship.js`, or `tool_input.name` matches `/(^|[^A-Za-z0-9_])interlock:ship$/` (a hyphen may precede `interlock`, so the marketplace-prefixed `…-interlock:ship` form is accepted; a letter, digit or underscore may not). The path test survives any install location because the plugin's file name does; the name test accepts `interlock:ship` and a marketplace-prefixed form while refusing another plugin's `:ship`. A call carrying `resumeFromRunId` is still a launch: a resume replays every agent that started after a failed one (orchestration-4), which is the cost the guard exists to prevent. The field names are confirmed by the task-1 capture and the recogniser is pinned against those fixtures; if the real payload names the fields differently, the recogniser changes and nothing else does.

*Amended by the task-1 capture (2026-10-05, CLI 2.1.274).* A typed `/interlock:ship` reaches the plugin's workflow command, not the skill: the manifest's `workflows` entry registers `ship.js` as `interlock:ship`, the expansion tells the model to call `Workflow({ name: "interlock:ship", args })`, and the `PreToolUse` `tool_input` is exactly `{ name, args }`. By `PostToolUse` the engine has added the resolved `script` source to `tool_input`. The completion wake's own `<diagnostics>` then names a resume: `Workflow({ scriptPath: '<transcripts>/workflows/scripts/ship-<runId>.js', resumeFromRunId: '<runId>', args })`. That path does not end in `workflows/ship.js` and the call carries no `name`, so neither test above recognises the relaunch the wake itself suggests. So `isShipLaunch(toolInput, ledger)` also accepts a call whose `resumeFromRunId` equals a launch's recorded `runId`, or whose `scriptPath` equals a launch's recorded `scriptPath`; the ledger records both from the accepted launch's `tool_response`. Matching against the session's own ledger, not against the `ship-wf_` file-name shape, keeps another plugin's workflow named `ship` out.

### D2 — The ledger: one file per session, created only by an accepted launch

`.claude/ship/launch-ledger/<session_id>.json` holds `{ schema: 'interlock.launch-ledger/1', sessionId, launches: [{ at, taskId, runId, workflowName, scriptPath }], lastHumanPromptAt: null | <iso> }`. The `session_id` is admitted as a filename only when it passes the same safe-id rule the trajectory applies to a run id (`^[A-Za-z0-9._-]{1,128}$`, no `..`); anything else is an unknown and allows.

Only the `PostToolUse` branch creates the file, and only for a launch the runtime accepted: a `tool_response` that carries an error, or marks itself an error, records nothing, so a refused launch never counts against the next one. The capture found the refusal earlier still: an unknown workflow name is rejected at input validation, before `PreToolUse`, and neither `PostToolUse` nor `PostToolUseFailure` fires for it. So the recorder's own test is positive, not negative: it records only a `tool_response` object whose `status` is `async_launched` or `remote_launched` (the captured accepted launch carries the former) and that carries no error mark. Anything else records nothing, which is the allow direction. The two prompt branches perform one existence check and return when the file is absent; they never create the directory. That is the rule that keeps every prompt in every unrelated repository with the plugin installed from writing anything.

### D3 — The rule, and the words of the deny

`decideLaunch(ledger, now, maxAgeMs)` is pure: no ledger → allow; a ledger whose newest launch is older than `maxAgeMs` → allow (stale); any launch recorded later than `lastHumanPromptAt`, including every launch when `lastHumanPromptAt` is null → deny; otherwise allow. The hook's `PreToolUse` branch calls it and, on deny, goes through `deny()` in `hooks/_shared.mjs` with the reason:

> `guard-relaunch: a ship workflow was already launched in this session at <at> and no human prompt has arrived since. skills/ship/SKILL.md: "Leftover \`- [ ]\` boxes after a run are a report, not authorization to call Workflow again." Send a new message that asks to ship the leftovers, or type /interlock:ship again, and the next launch is allowed.`

and the detail `{ guard: 'guard-relaunch', sessionId, lastLaunchAt, lastHumanPromptAt }`. The reason quotes the skill sentence verbatim so one token pin covers both files: `test/hooks.test.mjs` asserts the tokens `Leftover`, `not authorization` and `new message` in the reason, and `test/skills.test.mjs` is unchanged.

### D4 — Which prompt events record, and the probe that gates the deny

Both `UserPromptSubmit` and `UserPromptExpansion` are registered and both record `lastHumanPromptAt = max(existing, now)`, which is idempotent, so it does not matter which of the two fires for a typed `/interlock:ship` or whether both do. The task-1 capture answers three questions in order:

1. Does a typed `/interlock:ship` fire at least one of the two? If neither, no human prompt is ever recorded, every second launch would be denied, and the deny branch does not ship.
2. Does a background workflow's completion wake fire either? If it does, and the payload is distinguishable — a `prompt` body that is a task notification, say — the branch excludes it by a marker pinned from the fixture. If it fires and is indistinguishable, the deny branch does not ship.
3. What do `tool_input` and `tool_response` carry for a Workflow call? These settle D1 and D2's field names.

When the deny branch does not ship, the recorder half ships with the four registrations, the ledger is still written, and a test asserts the `PreToolUse` branch allows everything; the guards page says the deny waits on the in-process form (Brief 8). The decision is recorded in this file after task 1.

*Settled by the task-1 capture (2026-10-05, CLI 2.1.274, two scratch sessions with the plugin loaded through `--plugin-dir` and a logging hook on the four events plus `PostToolUseFailure` and `Stop`; fixtures under `test/fixtures/hooks/`):*

1. A typed `/interlock:ship no-such-change` fires **both** events: `UserPromptExpansion` first (`expansion_type: 'slash_command'`, `command_name: 'interlock:ship'`, `command_source: 'plugin'`), then `UserPromptSubmit`, sharing one `prompt_id`. A plain typed prompt fires `UserPromptSubmit` alone.
2. The background workflow's completion wake **does** fire `UserPromptSubmit` (and not `UserPromptExpansion`), in the same `session_id`, with a fresh `prompt_id`. Its `prompt` is the notification itself and begins with `<task-notification>`. That is distinguishable, so both prompt branches ignore a prompt whose text, leading whitespace trimmed, begins with `<task-notification>`; the marker is pinned from `completion-wake.json`. Without that exclusion the wake would reset the clock and the guard would allow exactly the relaunch it exists to deny.
3. `tool_input` and `tool_response` are as amended under D1 and D2. A fresh launch's `tool_response` carries both `taskId` and `runId`.

**Decision: the deny branch ships.** 1.3 and 2.2 take their full form, not the recorder-only one. Another machine-originated prompt the guard does not recognise (a cron or loop firing, a peer message) still resets the clock, which errs toward allow.

### D5 — Ledger lifetime is a published bound read by `lib/`

`LIMITS.launchLedgerMaxAgeMs` is added to `lib/limits.mjs`, printed by `formatLimits` as `launch ledger max age (ms)`, and read in `lib/launch-ledger.mjs`: `readLedger` treats a ledger whose newest launch is older than the bound as absent, and every write sweeps sibling ledger files whose modification time is past the bound. The value is 24 hours (`24 * 60 * 60 * 1000`): longer than any run the published step cap and the runaway backstop allow, so a live session's launch is never aged out while its run could still be in flight; shorter than the host's transcript retention, so the directory never outlives the sessions it names; and it widens only the allow direction. Because the reader is in `lib/`, the cap-authority sweep finds it without being taught to walk `hooks/`.

*Alternatives considered.* `run close` deleting the ledger would defeat the guard: the dangerous relaunch follows the close. Brief 2's SessionEnd recorder deleting `launch-ledger/<session_id>.json` is exact but couples the two changes, which this design avoids so they can land in either order; it may be added later as a courtesy and changes nothing here. A ledger with no lifetime grows one file per session forever.

### D6 — Every unknown allows, and only one branch may ever deny

The `PreToolUse` branch denies only when `decideLaunch` says deny. It allows on a missing or unsafe `session_id`, a ledger that is missing, unreadable, malformed or stale, a `tool_input` the recogniser does not accept, a tool that is not `Workflow`, and its own crash, with a stderr note on the crash path exactly as the stage guards do. The `PostToolUse` and prompt branches print nothing on any path and never return a decision. A hook that times out does not block (orchestration-13), which is the fail-open direction by host rule.

### D7 — A pure module under a thin hook

`lib/launch-ledger.mjs` holds `isShipLaunch`, `ledgerPath`, `readLedger`, `recordLaunch`, `recordPrompt`, `sweepStale` and `decideLaunch`, every function collapsing failure to a value. `hooks/guard-relaunch.mjs` reads the event, dispatches on `hook_event_name`, calls the module and speaks through `allow`/`deny`. This is the shape `hooks/guard-tests.mjs` has over `lib/ship-stage.mjs`: `node --test` covers the rule over hand-built ledgers in `test/spine/launch-ledger.test.mjs`, and `test/hooks.test.mjs` covers the process end to end. The hook imports only the helpers `hooks/_shared.mjs` already exports; the file is not edited.

### D8 — Four registrations, one pin

`.claude-plugin/plugin.json` registers `node "${CLAUDE_PLUGIN_ROOT}/hooks/guard-relaunch.mjs"` under `PreToolUse` with matcher `Workflow`, under `PostToolUse` with matcher `Workflow`, and under `UserPromptSubmit` and `UserPromptExpansion` without a matcher. `test/hooks.test.mjs` asserts all four name the script, on the pattern of the preflight's registration pin.

### D9 — Fixtures and tests

Task 1 captures the real payloads with a logging hook in a scratch session and pins them under `test/fixtures/hooks/`: `workflow-pretooluse.json`, `workflow-posttooluse.json`, `userpromptsubmit.json`, `userpromptexpansion.json`, and whatever the completion wake produced, or a note that it produced nothing. The hook tests build their events from those fixtures with the `session_id` and `cwd` rewritten, so a payload field the host renames fails a fixture-driven test rather than silently stopping the guard.

### D10 — Living beside `name-workflow-spawn-overrides-and-stops`

The two changes touch disjoint new files (`hooks/guard-relaunch.mjs`, `lib/launch-ledger.mjs` here; `hooks/recorder.mjs`, `lib/interrupted.mjs` there), neither edits `hooks/_shared.mjs`, and their shared edits add entries to `.claude-plugin/plugin.json`, cases to `test/hooks.test.mjs`, rows to `docs/13-the-guards.md` and paragraphs to `CHANGELOG.md`. When serialized, Brief 2 lands first for registration order; when parallel, the merge is additive.

### D11 — The handover to Brief 8

When mods load (host 2.1.287+ and no `allowManagedModsOnly`), Brief 8's `prompt.submit`/`tool.call` hooks replace this guard: the in-process form reads the engine's own `origin.kind` and needs no file. Both forms would deny the same call harmlessly, but two ledgers for one rule is a maintenance mistake, so Brief 8 removes these four registrations when it lands and `docs/13` says which form is active. Nothing in this change anticipates that removal beyond keeping the rule in one module.

## Risks / Trade-offs

- [The completion wake fires a prompt event that cannot be told from a typed prompt] → the deny branch does not ship (D4); the recorder half still lands, and the guards page says the deny waits on the in-process form.
- [A prompt typed and queued during the run resets the clock, so a relaunch after the completion wake passes] → named hole, not solved here; the prose and the eval keep measuring the model, and the guard still bounds the case that cost twenty agents: no human message at all between a run and its relaunch.
- [A false deny] → one typed message, which is the remedy the reason names.
- [`session_id` absent on some surface] → allow, by D6.
- [Two branches write the same ledger close together] → whole-file writes of a small document; a launch append and a timestamp max are both monotonic, and a torn read is malformed and allows.
- [The ledger directory grows] → the sweep on write under the published bound.
- [The payload shape differs from the addendum's reading of the type declaration] → the fixtures from task 1 are the contract; the recogniser and the recorder follow them, and a renamed field fails a test.

## Migration Plan

Additive: a new hook, a new pure module, four manifest registrations and one published cap. The ledger lives in a new gitignored directory under `.claude/ship/`; deleting it resets the guard. Rollback is reverting the commit, which also drops the registrations.

## Open Questions

- ~~Which field of the Workflow tool's `tool_response` carries the run's identity on a fresh launch (`taskId`, `runId`, or both).~~ Answered by the task-1 capture: both (`taskId: 'w…'`, `runId: 'wf_…'`), plus `workflowName`, `transcriptDir` and the persisted `scriptPath`. The recorder stores `taskId`, `runId`, `workflowName` and `scriptPath`; only the resume match under D1 branches on `runId` and `scriptPath`.
