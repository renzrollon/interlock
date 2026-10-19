## Why

The Claude plugin directory read 1.5.1 (`release` at `a944fe3`, 2026-10-11) and holds it for a reviewer on four policy findings, with one validation warning. A held version cannot go live until an Anthropic reviewer clears it, and the scan raises the same hold on every later version until its cause is gone. The rules behind the findings are published in the directory's pre-submission checklist (`claude.com/docs/plugins/pre-submission-checklist`); the report's codes are not, so each cause below is read from the rule and from the code.

- **`MOD_ANSWERS_PERMISSION`, `hooks/mod.mjs:2136`.** The `classic.SessionStart` hook returns `meterSessionForward(meterSessionInput).then(async started => { …; return started })` (`:2134-2140`). The event's result carries `initialUserMessage`, the session's first message, so the reader wants proof that what the hook returns is the chain's own result, and it reads only a literal `return next(e)`. Four other shapes have been written for this hook: await and return a variable, `.then(helper)`, a held promise variable (1.3.0 to 1.5.0, held), and the `.then` that 1.5.1 shipped as the fix (`23703d9`, still held at the same line). The docs' own example of this hook ends in `return next(e)`.
- **`MCP_FORWARDS_CREDENTIAL_ENV`, `plugin.json`.** The checklist asks for a credential through `userConfig` and to "refer to it as `${user_config.KEY}`". The plugin declares `ntfy_topic` as a sensitive option (`.claude-plugin/plugin.json:21-27`) and then reads it from the hook's environment (`hooks/preflight.mjs:308`, `lib/notify.mjs:89`, `lib/doctor.mjs:934`). `${user_config.` appears nowhere in the repository.
- **`UNREAD_ASSET_REFERENCED`, `shared/TEST-PROFILE.md`.** The only image in the bundle is `assets/icon.png`. `plugin.json` has a documented `icon` field the directory reads for the listing; the repository dropped that key in `68a8512` and pins its absence (`test/spine/package.test.mjs:251`) on a claim no document supports.
- **`BUNDLES_BINARIES`** and the **`types`** warning need no change. A top-level `bin/` is reviewer-checked by rule, and `types` is in the manifest reference's field table.

One limit in the same checklist is close: any non-image file over 256 KiB is held, and `bin/interlock` is 233,141 bytes at `d26e2c6` (153,952 at 1.5.1), `lib/run.mjs` 225,951. Nothing in the repository watches it.

## What Changes

- **The session-start hook returns the forward call and nothing else.** `hooks/mod.mjs` keeps `endRunAtBoundary` before the chain and returns `meterSessionForward(meterSessionInput)` with no continuation. The read of the preflight report after the chain is removed, because it needs the chain's promise and cannot move ahead of it: the settings hook that writes the report runs inside the chain. The report is still read at every prompt a person submits (`hooks/mod.mjs:1937-1945`) and by the two commands. **BREAKING** for a host that raises the classic event to a module: the band appears at the first prompt, where it used to appear before it. On Claude Code 2.1.291, where no classic event reaches a module, nothing changes.
- **A static pin stands in for the directory's reader.** `test/spine/mod-pins.test.mjs` reads the hook as text and fails when its return is anything but the forward call on the hook's own input.
- **A plugin option reaches the session as a value the manifest passes.** Two exec-form `SessionStart` entries, one per option, hand `${user_config.ntfy_topic}` and `${user_config.ntfy_url}` to a new `hooks/notify-option.mjs`, which appends the matching `INTERLOCK_NTFY_*` export to the session's environment file. The preflight no longer copies anything. Probed on 2.1.296 and 2.1.161: the host does not run a hook whose arguments name an option with no saved value, so each hook runs only for a person who set that option, and the preflight's own entry stays as it is.
- **No shipped code reads the host's option variables.** `lib/notify.mjs` and `lib/doctor.mjs` read `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` only; `CLAUDE_PLUGIN_OPTION_` is pinned out of every shipped file.
- **The doctor's `notify` row says what it can see.** At session start the check runs beside the option hooks, so an unset variable reads as "no topic in this environment" and names both ways to set one.
- **The listing image is declared.** `plugin.json` gains `"icon": "./assets/icon.png"`. The package test pins the key to a shipped, square PNG in place of pinning its absence.
- **The bundle is held to the directory's two file limits.** The package test fails when a shipped non-image file exceeds 262,144 bytes or the bundle exceeds 512 files, naming the file and its size.
- **The README says everything the plugin sends and runs.** The network paragraph names the server option, how an option reaches the session, and that `/interlock:mr` has the model run `gh`, `glab` and `git fetch` under the person's own sign-in. `docs/07`, `docs/13` and `CHANGELOG.md` follow.
- **Left as they are, on purpose.** `bin/` stays: the bare `interlock` command is the plugin's invocation contract, and a mod is listed for Claude Code only. `types` stays. The doctor's presence checks of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY` and `OPENAI_API_KEY` stay: no value leaves them, and the finding says an unrelated read is confirmed by a reviewer. The copy into the environment file stays, because the command that pushes is not a hook.
- **What only the portal can confirm.** No local command reproduces a policy finding. The last task section is done by hand: pack the working tree into a scratch branch, run the portal's Validate on it, and record the report. The design names what to do for each finding that remains.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hooks/ship-meter`: the session-start report requirement reads the file at a person's prompt only; the observe-only requirement's file-read sentence follows; one new requirement fixes the classic session-start hook's return to the forward call and pins it.
- `ship/close-notification`: one new requirement for how a plugin option reaches the push (a value the manifest passes to a hook that runs only when the option is set) and that no shipped code reads the host's option variables.
- `hooks/session-preflight`: the `notify` row requirement is reworded for what the check can see at session start.
- `distribution/npm-package`: two new requirements: the declared listing image ships and is an image, and the bundle stays inside the directory's file limits.

## Impact

- **Changed:** `hooks/mod.mjs` (the hook, its comment, the header paragraph, `readPreflightAfterStart` removed); `hooks/preflight.mjs` (`publishNotifyOptions` and its helpers removed); `lib/notify.mjs` (the two option constants and their precedence removed); `lib/doctor.mjs` (`checkNotify`); `.claude-plugin/plugin.json` (two `SessionStart` entries, `icon`); `README.md`, `docs/07-cli-and-configuration.md`, `docs/13-the-guards.md`, `CHANGELOG.md`.
- **New:** `hooks/notify-option.mjs`.
- **Tests changed because the requirement changed:** `test/mod/session-start.test.ts` (the classic event reads nothing; the band follows a prompt); `test/hooks.test.mjs` (the option cases move to the new hook; the registration list gains two rows); `test/spine/doctor.test.mjs` (the option variables are ignored); `test/spine/package.test.mjs` (the icon pin, the two limits); `test/spine/mod-pins.test.mjs` (the return pin).
- **Dependencies:** none added. The plugin stays at zero runtime dependencies.
- **Hosts:** exec-form hooks ran on 2.1.161, the oldest binary on this machine. A host that does not substitute an option does not run that option's hook, which leaves the shell variables as the only source there, as before 1.3.0.
- **Not established locally:** that an option with a saved value reaches the hook as its argument (the docs state it; a saved value needs the person's own settings), and that the directory clears any hold. Both are checked by hand in the last task section.
