## Why

The plugin directory's Validate now refuses the manifest with **Command path can't be followed** (reported by the owner on 2026-11-04). Its rule, in the pre-submission checklist: "In the command of a hook or an MCP server, write each path in full from `${CLAUDE_PLUGIN_ROOT}`, with no other variable, command substitution, wildcard, or inline program". The finding's own remedy: "a hook's script can read a value it needs … from its environment instead of taking it on the command line."

Every hook in `.claude-plugin/plugin.json` is `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` except two: the `SessionStart` entries that run `hooks/notify-option.mjs` with `${user_config.ntfy_topic}` and `${user_config.ntfy_url}` as arguments. They are the only variables other than `${CLAUDE_PLUGIN_ROOT}` in any command the loader runs. No skill has a `` !`…` `` line, no agent declares a hook, there is no MCP, LSP or monitor entry, and `hooks/hooks.json` names only the mod. The local `claude plugin validate . --strict` (2.1.318) passes and does not carry this finding, so the portal is the only reproduction.

That argument route came from `clear-the-plugin-directory-holds` (archived 2026-10-19), which moved off the host's option variables on the guess that reading them tripped `MCP_FORWARDS_CREDENTIAL_ENV`. The hold stayed after the move (that change's tasks.md, the 1.6.0 scan), so the guess never paid for itself, and it now costs a refusal.

## What Changes

- **One option hook, no arguments.** The two `notify-option.mjs` entries become one, `node "${CLAUDE_PLUGIN_ROOT}/hooks/notify-option.mjs"`, the same shape as every other hook. It reads `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` and `CLAUDE_PLUGIN_OPTION_NTFY_URL`, which the plugins reference says the host exports "to hook processes for every option", and exports them as `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` as before.
- **Only that hook reads the host's option variables.** The pin that no shipped file spells `CLAUDE_PLUGIN_OPTION_` becomes a pin that `hooks/notify-option.mjs` is the only one.
- **A manifest pin for the directory's rule.** A test fails naming the hook when any hook's `command` or `args` holds a `${…}` other than `${CLAUDE_PLUGIN_ROOT}`, or a `$(`, a backtick, a `*`, a `?` or a brace pattern.
- The push itself, the variables `lib/notify.mjs` and `lib/doctor.mjs` read, and the preflight are unchanged.

## Capabilities

### Modified Capabilities

- `ship/close-notification`: the requirement on how a plugin option reaches the push is replaced.

## Impact

- `.claude-plugin/plugin.json`, `hooks/notify-option.mjs`, `lib/session-env.mjs` (comment), `test/hooks.test.mjs`, `test/spine/package.test.mjs`, `README.md`, `docs/13-the-guards.md`, `docs/07-cli-and-configuration.md`, `hooks/preflight.mjs` and `lib/notify.mjs` (comments), `CHANGELOG.md`.
- `remove-every-credential-read` (PR #32, `75ce095`) is untouched: the doctor and the codex adapter still read no credential, and its pin still holds. The host's option variables are the `userConfig` channel the credential rule asks for, not a value already in the user's environment. Neither PR #32 nor this change has been scanned yet (`release` is 1.13.0); one portal Validate of a pack of this branch answers both.
