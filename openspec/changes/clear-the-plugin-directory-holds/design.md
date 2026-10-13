## Context

See `proposal.md` — Why for the five findings and the rule each maps to. What shapes the approach:

- **No local command reproduces a policy finding.** `claude plugin validate . --strict` (2.1.296) passes on this tree and lists the session-start hook only as a "gating hook". The portal's Validate on a pushed branch is the one oracle, and it needs a person. So every fix here is pinned by a local test that stands in for the directory's rule, and the directory's own verdict is a by-hand step at the end.
- **The settings hook that writes the preflight report runs inside the classic session-start chain.** The engine's declaration gives the chain as "[managed settings hooks, ...hooks modules, the other settings hooks as core]", so `hooks/preflight.mjs` runs when the module calls its forward. A read of `.claude/ship/preflight.json` before that call gets the previous session's file.
- **A plugin option is visible to hook processes only.** The command that pushes (`interlock run close --notify`, run by a ping agent through the Bash tool, or by `bin/interlock-run`) is not a hook. Something a hook writes has to carry the value across, and the session's environment file is the host's channel for that.
- **The hooks must keep working where the option is unset**, which is nearly every install.

Engine facts probed on 2026-10-13 through `scripts/host-probe.mjs` (`--mode headless`, a scratch plugin, a scratch working directory), on Claude Code 2.1.296 and 2.1.161:

| Probe | 2.1.296 | 2.1.161 |
|---|---|---|
| An exec-form hook (`command: "node"`, `args: [script, …]`) with no option reference | ran | ran |
| An exec-form hook whose `args` name `${user_config.KEY}` for a sensitive option with no saved value | not run, nothing printed | not run |
| The same for a plain option with no saved value | not run, nothing printed | not run |
| The same for an option with a manifest `default` and no saved value | not run; no `CLAUDE_PLUGIN_OPTION_*` exported either | not probed |
| Two exec-form hooks with the same `command` and different `args` in one group | both ran | not probed |
| `CLAUDE_ENV_FILE` in an exec-form hook's environment | present | not probed |

Not probed: the same hook with a saved value. `pluginConfigs` is read from user and managed settings only, and a probe does not write the person's settings. The hooks reference states the behaviour ("the value is substituted into `command` and into each `args` element as a plain string"); D11 checks it by hand before a version is tagged.

## Goals / Non-Goals

**Goals:**

- The session-start hook is in the one shape the directory names, and a local pin keeps it there.
- The option-to-push path uses the reference the directory asks for, without ever stopping the preflight.
- Each change is something a reviewer can confirm from the manifest and the README alone.
- The two file limits that would raise a new hold are measured on every `npm test`.

**Non-Goals:**

- Moving the CLI out of `bin/`. The bare command is named in nine skills' `allowed-tools`, recognised by `hooks/mod.mjs:851` and `lib/doctor.mjs:185-187`, built into a command line at `workflows/ship.js:358` and emitted by `lib/prompts/verify.mjs`. The platform table lists a top-level `bin/` as "Loads" on Claude Code, and a plugin with a mod is listed for Claude Code only.
- Removing the presence checks of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `OPENAI_API_KEY` and `apiKeyHelper`. Three doctor rows and the codex banner depend on them, no value leaves the function that tests it, and the finding's own text says an unrelated read is left for a reviewer to confirm.
- Moving the push into a hook process so the topic never enters the session's environment. `bin/interlock-run` has no hooks on the codex, qwen and ACP hosts, so `lib/notify.mjs` would still read the variable; the redesign would change who can lose a push and is its own change.
- Rewording `shared/TEST-PROFILE.md`. Which of its tokens the asset finding follows is not known (D8), and a skill's prose is a shipped surface.
- Splitting `bin/interlock` or `lib/run.mjs`. Both are inside the limit today; D9's pin says when that stops being true.
- Fixing the shipped README's three `docs/assets/…` image paths, which are absent from the bundle. It is not a finding.

## Decisions

### D1 — The session-start hook returns the forward call; the read after the chain is removed

```js
on('classic.SessionStart', async (meterSessionApi, meterSessionInput, meterSessionForward) => {
  endRunAtBoundary(meterSessionApi, meterSessionInput)
  return meterSessionForward(meterSessionInput)
})
```

The three parameter names stay: `test/spine/mod-pins.test.mjs:161-190` already holds a renamed forward to "called with the hook's own input, and nowhere else". `async` stays so a throw before the return is a rejection the engine skips the hook on, as it is today. `endRunAtBoundary` is synchronous, has its own try/catch and never used the chain's value, so every boundary case in `test/mod/meter.test.ts` and `test/mod/spec-meter.test.ts` holds unchanged. `readPreflightAfterStart` (`hooks/mod.mjs:912-914`) loses its only caller and is deleted.

What a person sees: on a host that raises the classic event to a module, the band appears at the first prompt they submit, and after `/clear`, `/resume` or `/branch` the module holds no report until the next prompt. `/interlock-preflight` and `/interlock-handoff` read the file themselves and are unaffected. This is what `docs/13-the-guards.md:45` already says happens on 2.1.291.

Alternatives considered:

- **`return forward(input).finally(() => read())`.** Breaks no test and no spec text, and is the only shape not yet tried. It is still a continuation on the forward call; the finding names one accepted shape, and two versions have already been spent on shapes that preserve the read.
- **`const r = await forward(input); await read(); return r`.** The documented "act after" shape. It was in scan bundle `fd9ebb2` on `origin/temp/plugin-scan` and was replaced the same hour.
- **Reading before the return.** Draws the previous session's report as this one's, the failure `show-preflight-and-interrupted-runs-at-session-start` design D2 exists to prevent.
- **A deferred re-read on a timer.** The observe-only requirement allows one timer, "started only for a live ship run".
- **Removing the hook.** Ends the boundary reset, which `show-quiet-time-and-reset-the-meter-on-clear` design D4 ties to the engine emptying the launch ledger on the same event.

### D2 — A static pin stands in for the directory's reader

`test/spine/mod-pins.test.mjs` gains one case that cuts the hook's source from `on('classic.SessionStart'` to its closing `})` and asserts, on tokens:

- the body holds a single `return`, and that statement is the forward parameter called with the input parameter and nothing after the closing parenthesis on that line;
- the body holds none of `.then(`, `.finally(`, `await `, `const ` or `let `;
- the forward parameter's name occurs in the body one time.

The same file's `.catch(` ban already covers the remaining continuation. The pin reads parameter names from the hook's own signature, so a later rename does not break it.

### D3 — The kit cases change with the requirement, as tasks and not as repairs

Two cases in `test/mod/session-start.test.ts` assert the behaviour D1 removes:

- `:125-135` asserts one read and a drawn band straight after `$.classic.SessionStart({ source: 'startup' })`. It becomes: the event resolves to `CLASSIC_BENEATH`, `w.reads` is empty and the band is empty on both surfaces; then one `prompt($)` reads the file once and draws the same rows.
- `:267-268` asserts the band straight after a `clear`. It becomes: the event resolves to `CLASSIC_BENEATH` and the band is empty; then one `prompt($)` draws `interlock preflight OK (1 warning).`.

`.claude/CLAUDE.md` says a failing test means the code is wrong. These four assertions are the old requirement written down, and the delta for `hooks/ship-meter` replaces that requirement. They are listed as tasks in the red section so the edit happens in the implementing stage, where `hooks/guard-tests.mjs` allows it, and so no later stage is left to "fix" them. `:222-233` (non-interactive) and `:263-264` (compact) hold as written.

### D4 — One exec-form hook per option, beside an untouched preflight entry

```json
"SessionStart": [
  { "hooks": [
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/preflight.mjs\"" },
    { "type": "command", "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/notify-option.mjs", "topic", "${user_config.ntfy_topic}"] },
    { "type": "command", "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/notify-option.mjs", "url", "${user_config.ntfy_url}"] }
  ] }
]
```

The layout follows from the probe table, not from taste:

- The reference cannot go in the preflight's arguments. The host would stop running the preflight for everyone who has not saved a topic, and print nothing about it.
- Topic and server cannot share a hook. A person who saves a topic and leaves the server at its default would have the shared hook skipped.
- A manifest `default` for the server does not help: the probe shows a default is not a saved value.

What falls out is the property the directory's wording asks for: a hook that handles the value exists, for the host, only when the person chose to save one.

Alternative considered: keep reading `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` in the preflight, which the manifest reference documents as an equal form. It is what the held version does, and the finding's remedy names the other form.

### D5 — `hooks/notify-option.mjs`: one argument in, at most one line out

`node hooks/notify-option.mjs <topic|url> <value>`. It reads nothing from standard input and prints nothing to standard output, because a session-start hook's output becomes context. On every path it exits 0.

It writes nothing when: the kind is neither `topic` nor `url`; the value is empty after trimming, carries `\0`, `\r` or `\n`, or contains `${user_config.` (a host that passed the reference through); `CLAUDE_ENV_FILE` is unset; or the matching `INTERLOCK_NTFY_*` variable is already set in its own environment (the operator's shell value wins, as `test/hooks.test.mjs:608-625` pins today). Otherwise it appends `export INTERLOCK_NTFY_TOPIC='…'` or `export INTERLOCK_NTFY_URL='…'` with the single-quote escaping `hooks/preflight.mjs:287-289` uses now. A write that throws is one line on standard error.

It does not judge the topic's or the server's shape. `readNotifyConfig` does that where the value is used, and names the variable without the value.

`shellQuote` and `publishable` move here from `hooks/preflight.mjs` with `publishNotifyOptions`; the preflight keeps none of the three and no longer touches the environment file.

### D6 — Shipped code reads the two `INTERLOCK_NTFY_*` variables and nothing else for this

- `lib/notify.mjs`: `NOTIFY_TOPIC_OPTION` and `NOTIFY_URL_OPTION` are removed. `readNotifyConfig` reads `INTERLOCK_NTFY_TOPIC`, then `INTERLOCK_NTFY_URL` or the default server, and an `{ invalid }` result names one of those two. This is what `ship/close-notification` — "Configuration SHALL come from the environment" has said throughout; the option precedence was added in `44860b1` without a delta.
- `lib/doctor.mjs` `checkNotify`: D7.
- A pin in `test/spine/package.test.mjs` walks the shipped file set and fails on any file containing `CLAUDE_PLUGIN_OPTION_`. The token appears today only at `lib/notify.mjs:47-48`, `lib/doctor.mjs:920,934,943` and `hooks/preflight.mjs:308-309`. New comments and the changelog entry must say "the host's option variables" and not spell the prefix, or the pin fails on them.

In the Bash-tool process nothing changes: the host does not export option variables there (`hooks/preflight.mjs:298`), so the option precedence in `readNotifyConfig` only ever mattered inside a hook.

### D7 — The doctor's `notify` row reports the environment it ran in

Hooks in one group run in parallel, so the preflight's `interlock doctor --json` cannot see what the option hooks are about to export. A person who set only the option gets `skip` in the session-start report, where 1.5.1 said `ok`. The row stays truthful by saying what it measured:

> `no topic in this environment: set the plugin's ntfy topic option (it reaches the session's commands at session start, so a check that runs beside it cannot see it) or INTERLOCK_NTFY_TOPIC; optional, but an unattended run that stops will not reach you`

`interlock doctor` typed in the session after start reads the exported variable and reports `ok` with the server. A `skip` row draws no band (`hooks/ship-meter` draws `fail` and `warn` only), so the cost is one row in `/interlock-preflight`.

Alternatives considered: a presence-only read of the option variable in the doctor (keeps the read D6 removes); a marker file the option hook writes (`ship/close-notification` forbids a file under `.claude/` for this configuration, and the two hooks race).

### D8 — The listing image is declared with the documented key

`plugin.json` gains `"icon": "./assets/icon.png"`. The manifest reference: "Set `icon` to the path of an image file inside the plugin, such as `./logo.png`", accepted without a warning from 2.1.281; a probe manifest with the key passes `--strict` on 2.1.296. `68a8512` removed the key for a layout reason and pinned "the directory finds assets/icon.png itself", which no document says. The 1.2.1 and 1.3.0 manifests had the key as `.claude-plugin/icon.png`, without the `./` and inside the manifest folder.

The package test's icon case is rewritten: the key is present, starts `./`, resolves to a file `files` covers, and that file is the square PNG the case already measures. Its "no shipped text names the file" loop goes, since the manifest now names it on purpose.

Whether this clears `UNREAD_ASSET_REFERENCED` is not known. The finding is attributed to `shared/TEST-PROFILE.md`, which never names the image; the rule is about image paths "in backticks or a code block", and the file's candidates are its four `"cwd": "."` values and `go test ./…` (tokens that occur in no other shipped file) and its nine backticked `package.json` mentions. D11 says what to do if the hold remains.

### D9 — The directory's two file limits are pinned in the package test

One case in `test/spine/package.test.mjs` over the shipped file set (the `files` whitelist walked as the closure test walks it, plus `package.json`, `README.md`, `LICENSE`, which npm always ships): every file whose extension is not one of `png jpg jpeg gif webp svg ttf otf woff woff2` is under 262,144 bytes, and the set holds 512 files or fewer. The two numbers are constants in that case with the checklist's name in a comment beside them. They are the directory's numbers, not caps of a run, so they do not belong in `lib/limits.mjs`.

At `d26e2c6` the largest are `bin/interlock` 233,141, `lib/run.mjs` 225,951 and `CHANGELOG.md` 183,909, and the set holds 165 files, so the case passes when written.

### D10 — The README states everything the plugin sends and has the model run

`README.md:119` is the paragraph a reviewer and the security scan read. Three sentences change:

- The server is named by the plugin's `ntfy server` option or `INTERLOCK_NTFY_URL`.
- "Session start copies a set option into the session's environment when the variable is not already set" becomes: each option has a session-start hook of its own that the host runs only when that option is saved, and the hook writes the variable for the session's commands.
- After "Interlock makes no other request": `/interlock:mr` has the model run `gh`, `glab` and `git fetch` under the person's own sign-in to read and write a merge request, and those requests are those tools'.

`docs/07-cli-and-configuration.md:303`, `docs/13-the-guards.md` (the count of settings hooks, a row for `hooks/notify-option.mjs`, the preflight's row, the `classic.SessionStart` bullet at `:45`) and `CHANGELOG.md` Unreleased follow. The changelog entry marks the band's timing **Breaking** and says what was left alone.

### D11 — The directory's verdict is read before a version is tagged

1.5.1 was tagged before the portal had read its fix. This change ends with two by-hand steps, in this order, on a scratch branch and never on `release`:

1. **A saved option reaches the hook.** With a build of this tree loaded and the topic option saved, start a session and run `interlock doctor`: the `notify` row is `ok`. With the option cleared, the row is `skip` and the preflight still reports. If the saved value does not arrive, D4 is wrong for a reason the probe could not see: stop, and do not tag.
2. **The portal's Validate.** Pack the working tree with `npm pack`, replace the content of `temp/plugin-scan` with the unpacked `package/` tree (the branch already holds four such commits from 2026-10-07), push, run Validate against that branch in the portal's Source step, record the report in the closing note, and point the tracked ref back at `release`.

What each remaining finding means:

| Still reported | What to do |
|---|---|
| `MOD_ANSWERS_PERMISSION` at the session-start hook | The hook is the docs' own example shape. Report it to the directory with that example; do not write a sixth shape. |
| `MOD_ANSWERS_PERMISSION` at another line | The reader has moved on to `agent.spawn` (`.then`, needs the spawn's result) or a `command.run` (`return {}`, the plugin's own commands). Record the line and decide then; neither can become a pass-through. |
| `MCP_FORWARDS_CREDENTIAL_ENV` | The related pair now uses the documented reference. What is left are the presence checks under Non-Goals, which a reviewer confirms. |
| `UNREAD_ASSET_REFERENCED` | Bisect on the scratch branch only: replace the four `"cwd": "."` values and `go test ./…` and re-validate; then the backticked `package.json` mentions. Whichever clears it becomes its own change, with the skill pins it touches. For certainty over an icon, drop `assets` from `files` and the `icon` key. |
| `BUNDLES_BINARIES`, `UNKNOWN_KEY` for `types`, `MOD_PRESENT`, `USES_HOOKS` | Expected. Nothing to do. |
| Anything new | Record it and stop. |

## Risks / Trade-offs

- [The band appears one prompt later on a host that raises the classic event to a module] → It is the behaviour 2.1.291 already has and `docs/13` already describes; both commands still show the report before any prompt. The changelog marks it **Breaking**.
- [A person who set only the option reads `skip` for `notify` in the session-start report] → D7's wording says why and where to look; the row is advice and draws no band.
- [The topic is in the option hook's argument list for the life of that process] → It was in the same process's environment before, and is in the environment file after, as it is today. The README keeps "treat it as a secret".
- [A later host runs a hook with the reference unsubstituted, or with an empty string, for an unset option] → D5 writes nothing for either, and the spec has the scenario.
- [A saved value does not reach the hook as documented] → D11 step 1 checks it before a tag. The shell variables are unaffected either way.
- [The directory still holds on a rule this design guessed at] → D11's table; the mod hook is the one finding whose accepted shape the directory states outright.
- [A comment or the changelog spells the option prefix and fails D6's pin] → Named in the tasks that write them.
- [Two option hooks append to one file at once] → Each appends one short line in a single write.

## Open Questions

- Whether Claude Code 2.1.296 raises `classic.SessionStart` to a module in a real session. The mods docs say it fires at startup and after `/clear`, `/resume` and `/branch`; the repository's only probe (2.1.291) found none. It decides how many people notice D1's change, and nothing in the specs or tasks.
- Whether the declared icon is what the listing shows. Only the portal's listing preview answers it.
