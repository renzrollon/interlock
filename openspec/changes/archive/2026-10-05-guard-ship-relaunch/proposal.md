## Why

The single most expensive recorded mistake is enforced only by prose. `skills/ship/SKILL.md` §2 says "Do not call Workflow again in this conversation … Only a new user message that explicitly asks to ship leftover tasks (or `/interlock:ship` again) is a relaunch"; `test/skills.test.mjs` pins the sentence and `evals/trampoline-launch` measures whether the model obeys it, and nothing stops a model that does not. The CHANGELOG records the incident: the parent chat relaunched ship over leftover checkboxes, which cost another 20+ agents including a full review cycle. The host now offers enforcement outside the model: a Workflow call goes through normal permission evaluation including `PreToolUse` command hooks, `UserPromptSubmit` and `UserPromptExpansion` are hook events keyed on the same `session_id`, and a timed-out command hook does not block, which matches this repository's fail-open rule. Source: `briefs/claude-code-teams-and-orchestration-briefs.md`, Brief 3. The addendum's Brief 8 replaces this mechanism with an in-process mod once mods can load; on this machine the installed CLI (2.1.274) and the Desktop engine (2.1.286) are both below the mods floor (2.1.287), so the settings-hook form is the only enforceable one today and is the documented fallback where a user's mods cannot load.

## What Changes

- **A fourth guard, `hooks/guard-relaunch.mjs`**, one script that dispatches on `hook_event_name` and is registered four ways in `.claude-plugin/plugin.json`: `PreToolUse` and `PostToolUse` with matcher `Workflow`, `UserPromptSubmit` and `UserPromptExpansion`.
- **A per-session launch ledger** at `.claude/ship/launch-ledger/<session_id>.json`, holding the recorded ship launches and the time of the last human prompt. `PostToolUse` creates it on the first ship launch the runtime accepted, so a launch the runtime refused never counts. The prompt events record the time of a human prompt only when a ledger for that session already exists; with none, the hook exits after one existence check and creates no file or directory, so every prompt in every unrelated repository with the plugin installed stays free.
- **The deny.** `PreToolUse` denies a ship launch when the ledger holds a launch for this session that is newer than the last recorded human prompt, including the case where no prompt was recorded at all after a launch. The deny goes through the existing `deny()` in `hooks/_shared.mjs`; its reason quotes the skill rule and names the remedy: send a new message asking to ship the leftovers, or type `/interlock:ship` again.
- **Every unknown allows.** No `session_id`, an unreadable or malformed ledger, a ledger older than the published age bound, unrecognised `tool_input`, a non-ship workflow, a host that never wrote a prompt record for a different session, or the hook's own crash. A false deny costs one typed message, which is far cheaper than an unwanted 20-agent run and is still a denial, so the payload capture gates the deny branch.
- **Ledger lifetime is a published bound, not prose.** `lib/limits.mjs` gains `launchLedgerMaxAgeMs`, printed by `interlock limits` and read by `lib/launch-ledger.mjs`: a ledger whose newest entry is older than the bound reads as absent, and a write sweeps sibling ledgers past it, so the directory does not grow without end and no stale session can deny a live one.
- **The decision is a pure module.** `lib/launch-ledger.mjs` holds the ship-launch recogniser, the ledger reader and writer and the allow-or-deny rule with no reference to the hook protocol, so `node --test` covers the rule directly and the hook is plumbing over it, the way the stage guards are plumbing over `lib/ship-stage.mjs`.
- **The prose stays.** The skill sentence, its token pin and the eval are unchanged: the eval measures whether the model obeys, the hook bounds what happens when it does not.
- **`docs/13-the-guards.md`** gains a hook row and a fail-open table row, and says in so many words that with hooks disabled enforcement falls back to the prose and the eval.

## Capabilities

### New Capabilities

- `hooks/launch-guard`: a second ship launch in one session with no human prompt since the last launch is denied; the ledger is per session, created only by a launch the runtime accepted, bounded by a published age, and never created by a prompt alone; every unknown allows; the registrations are asserted.

### Modified Capabilities

None. The three existing guards, the stage marker and the preflight are untouched. The age bound is a new entry under the existing cap-authority rule (`ship/cap-authority`), stated once in `lib/limits.mjs` and read by `lib/launch-ledger.mjs`, and needs no requirement change there.

## Impact

**Code**

- `hooks/guard-relaunch.mjs` (new): the dispatcher and the four branches, importing only existing helpers from `hooks/_shared.mjs` (`readEvent`, `allow`, `deny`, `toolName`, `toolInput`, `projectRoot`) and the pure module. `hooks/_shared.mjs` is not edited.
- `lib/launch-ledger.mjs` (new): `isShipLaunch(toolInput)`, `ledgerPath`, `readLedger`, `recordLaunch`, `recordPrompt`, `decideLaunch`, each collapsing every failure to a value, never an exception.
- `lib/limits.mjs`: `LIMITS.launchLedgerMaxAgeMs`, printed by `formatLimits`.
- `.claude-plugin/plugin.json`: four registrations.

**Tests**

- `test/hooks.test.mjs`: first launch allowed and recorded; second launch in the same session with no prompt between denied with the quoted reason; second launch after a `UserPromptSubmit` allowed; `/interlock:spec --continue` launching ship once inside one human prompt allowed; a different `session_id` allowed; a non-ship workflow allowed and not recorded; a refused launch (error `tool_response`) not recorded; missing `session_id`, malformed ledger and a forced crash allowed with a stderr note; a prompt in a session with no ledger creates no file or directory; a ledger past the age bound reads as absent; the four `plugin.json` registrations asserted.
- `test/spine/launch-ledger.test.mjs` (new): the pure rule over hand-built ledgers.
- `test/spine/limits.test.mjs`: the new cap is printed, and the cap-authority sweep finds its reader in `lib/`.
- `test/fixtures/hooks/` (new): the real payloads captured in the first task: `PreToolUse` and `PostToolUse` for a Workflow call, `UserPromptSubmit` and `UserPromptExpansion` for a typed `/interlock:ship`, and whatever fires when a background workflow's completion wakes the session.
- `test/skills.test.mjs`: unchanged.

**Docs**

- `docs/13-the-guards.md`, `CHANGELOG.md`.

**Dependencies and ordering**

- Technically depends on nothing. Brief 2 (`name-workflow-spawn-overrides-and-stops`) lands first when the two are serialized, for hook-registration order and shared conventions; the two may be implemented in parallel because they edit disjoint new files, neither edits `hooks/_shared.mjs`, and their shared edits to `.claude-plugin/plugin.json`, `test/hooks.test.mjs`, `docs/13-the-guards.md` and `CHANGELOG.md` are additive.
- Brief 8 (`guard-ship-relaunch-in-process`) replaces this mechanism; ship one of the two. This one ships now because no host on this machine can load a mod, and it stays the fallback for a user whose organization sets `allowManagedModsOnly`.

**Out of scope**

- The commit briefing's three nevers (`git push`, `--amend`, `git add -A`), held as the later guard-commit extension.
- Launches across sessions: each session is its own ledger by design.
- A queue of launches registering as one launch; it waits on the ship-queue idea.
- Judging the text of a prompt. The guard cannot tell whether a prompt "explicitly asks to ship leftover tasks"; that stays with the prose and the eval.
