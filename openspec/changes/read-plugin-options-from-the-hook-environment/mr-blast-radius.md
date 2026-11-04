## 💥 Blast radius review — business logic changes (PR #34)

> **Scope of this comment:** this is a separate, specific **blast radius** review. It does **not** cover this PR's own plumbing: the docs and comment rewording, the OpenSpec change folder, the CHANGELOG entry, and the new command-path test pin itself. It looks only at the **business logic changes** this PR makes to get past the plugin directory's "Command path can't be followed" finding, and at which existing features they can affect. The general code review, regression and performance findings are in the earlier comment.

Scope: `27be006...b1467fc`. Static analysis only. Nothing was run, and no DB was touched.

⚠️ **Important:** no test has ever had a real Claude Code host hand a saved option to this hook. Every `notify-option` case in `test/hooks.test.mjs` spawns the script with a hand-built environment through the `runNotifyOption` helper, which sets `CLAUDE_PLUGIN_OPTION_NTFY_*` itself. The manifest checks are text assertions. That the host exports `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` for a `sensitive: true` option is taken from the plugins reference ("exported to hook processes for every option"), not observed. **The first session after install, with a saved `ntfy topic`, is the first real run.**

**Sub-repos: no impact.**
- npm `@renzrollon/interlock`: `files` and `bin` are unchanged. An npm install has no Claude Code host, so no option and no hook. It reads only shell `INTERLOCK_NTFY_*`.
- Marketplace `release` branch: still 1.13.0 (`37dec61`) with the argument-form manifest. Installed users change only when the next release mirrors this. The release job's tarball contents were not checked.
- Other hosts (`acp`, `codex`, `qwen` adapters, and `cli/interlock-run` outside Claude Code): they run no Claude Code `SessionStart` hook and never received a plugin option. They read only shell `INTERLOCK_NTFY_*`, which is unchanged.
- `claude-cli` lane children: `lib/host/claude-cli.mjs:102` only checks that `plugin.json` exists. A `claude -p` child that loads the plugin will now fire this hook on its own session start. That is harmless, but it was not checked in a real run.

### 🔴 High

| # | Change | Affected | Why high | Tests |
|---|---|---|---|---|
| B1 | `hooks/notify-option.mjs` value source (`hooks/notify-option.mjs:33-54`). Before: `node notify-option.mjs <topic\|url> <value>`, with the value in argv as the host substituted `${user_config.ntfy_*}`. After: no arguments. The hook reads `process.env.CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` and `_NTFY_URL` and exports `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` through the unchanged `appendExport`. | Every push a plugin-option user gets: `interlock run close --notify` (passed unconditionally by `workflows/ship.js:682` and `cli/interlock-run:642`, reaching `lib/run.mjs:5273`), `interlock notify` and the spec checkpoint push (`cli/interlock:3671`, `skills/spec/SKILL.md:293`), and the `interlock doctor` notify row (`lib/doctor.mjs:1228,1238`). There are 4 production readers of `INTERLOCK_NTFY_*`; none is changed, and none reads the option variable. **This hook is the only path from a saved plugin option to those commands.** A shell `INTERLOCK_NTFY_*` is the only other path, and it wins. | If the host does not export the variable for a sensitive option, or names it differently, the push is off for every plugin-option user with **no error**. `appendExport` returns false silently for an absent value, `readNotifyConfig` treats a missing topic as unconfigured, and the doctor row reads `skip` with advice to set the option the user already set. The export format, quoting, `publishable()` and operator precedence (`lib/session-env.mjs`) are unchanged. See the first ❓ item in the earlier comment. | `hooks` (real process spawn with a stubbed environment, real `sh` sourcing), `spine/package` (text), `spine/doctor` (stubbed env). No real host. |

### 🟡 Medium

| # | Change | Affected | Data / concurrency | Tests |
|---|---|---|---|---|
| B2 | `SessionStart` registration (`.claude-plugin/plugin.json:46-49`). Before: preflight plus two exec-form entries, each skipped by the host when its option was unsaved. After: preflight plus one plain `node "${CLAUDE_PLUGIN_ROOT}/hooks/notify-option.mjs"`. | **Every session start of every plugin user:** `startup`, `resume`, `clear`, `compact` and `fork`. The group has no matcher, and the hooks doc says Claude's first reply waits for all `SessionStart` hooks. Nothing in `lib/`, `cli/`, `hooks/`, `workflows/` or `.github/` enumerates the hook list. Its only readers are three test assertions (`test/hooks.test.mjs:663`, `:1187`, `:2512`), all updated. | Hooks in one event run in parallel, so the preflight (PATH and `INTERLOCK_PLUGIN_DATA`) and this hook append to `$CLAUDE_ENV_FILE` concurrently, as the two old entries did. Option writers drop from 2 processes to 1. Each line is one `appendFileSync` of under one page, and each line has one writer per start. The exact-line dedup is check-then-act but never races, because repeated starts are sequential. A topic edited mid-session appends a second export on the next `/clear`, and the last one wins when sourced, as before. Cost is in M4 of the earlier comment. | `hooks` (manifest text asserts; real spawn of the hook). None runs the preflight and the hook against one file concurrently. |

### 🟢 Low – Medium

| # | Change | Note |
|---|---|---|
| B3 | `hooks/notify-option.mjs` failure shape (`hooks/notify-option.mjs:37-62`) | One process now carries both options. If `lib/session-env.mjs` cannot be imported, both exports are lost behind one stderr line, "the options … was not exported". Before, there were two processes, each with its own line. An unwritable file with both options saved now prints two lines, but the test sets only the topic and asserts one. Per-option tries keep one option's failure from costing the other. Whether the host shows an exit-0 hook's stderr outside debug output is the second ❓ item in the earlier comment. |

### ↩️ Rollback

Reverting is safe for data. The new code persists nothing: it writes only `export INTERLOCK_NTFY_*='…'` lines into the session-scoped `$CLAUDE_ENV_FILE`. The lines have the same names and quoting the old hook writes, and the old hook's exact-line dedup tolerates them in a session that spans a downgrade. `userConfig` keys, types and sensitivity are unchanged, so saved values survive both an upgrade from 1.13.0 and a revert, with no re-prompt. No record schema, corpus or manifest field other than the hook list changes. **One exception:** a revert restores the `${user_config.…}` arguments, which brings back the portal's "Command path can't be followed" refusal.

### ✅ Manual checks for UAT

1. **Saved topic reaches the session (B1):** in Claude Code with this build installed, save the plugin's `ntfy topic` (and optionally `ntfy server`) under `/plugin` → Interlock → configure. Start a new session and run `echo ${#INTERLOCK_NTFY_TOPIC} "$INTERLOCK_NTFY_URL"` in a Bash call. Expected: the topic's length (not `0`), and the saved server or an empty string. Then run `interlock notify --title uat --body b1` and expect one message on that topic.
2. **Operator variable wins (B1):** with the topic still saved, launch `INTERLOCK_NTFY_TOPIC=from-shell claude`, then `echo "$INTERLOCK_NTFY_TOPIC"`. Expected: `from-shell`.
3. **Nothing saved (B2):** clear both options, start a session, and run `echo "${INTERLOCK_NTFY_TOPIC-unset}"`. Expected: `unset`. Also expected: no new text at session start, and no noticeable delay before the first reply compared with 1.13.0.
4. **Repeated starts (B2):** with the topic saved, run `/clear`, then `/compact` in a longer session, re-running check 1's `echo` after each. Expected: the same value each time. If `$CLAUDE_ENV_FILE` is readable from Bash, `grep -c INTERLOCK_NTFY_TOPIC "$CLAUDE_ENV_FILE"` should print `1`.
5. **Ship close push (B1, B3):** finish or halt a small ship run with the topic saved. Expected: one ntfy message naming the change and run id, at `high` priority on a halt, and no `PUSH FAILED` banner.
6. **Directory (all):** pack this branch to `temp/plugin-scan` and run the portal's Validate on it. Expected: no "Command path can't be followed" finding. Also record whether "Uses a credential from the user's machine" appears.
