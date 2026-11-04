## Context

`hooks/notify-option.mjs` exists because the host gives a plugin option to hook processes only, and the push runs from a Bash command or `interlock-run`, not a hook. The hook appends one `export` line to `$CLAUDE_ENV_FILE`, the host's channel from a hook to later commands. That stays. What changes is where the hook gets the value.

## Decisions

### D1. Read the host's option variables, not arguments

The plugins reference lists two ways an option reaches a hook: `${user_config.KEY}` in exec-form `args`, and `CLAUDE_PLUGIN_OPTION_<KEY>`, "exported to hook processes for every option, with `<KEY>` uppercased". The directory's command-path rule refuses the first ("a variable other than `${CLAUDE_PLUGIN_ROOT}`"), and its remedy names the second. Rejected: dropping the plugin options and asking for a shell variable. That reads a value already set in the user's environment, which is the credential rule's own example.

### D2. One hook entry, both options

The two entries existed because the host does not run a hook whose `args` name an unsaved option (old design D4). With no option in the command, one entry runs for everyone and exports whichever of the two variables holds a value. The `topic`/`url` argument and the unsubstituted-reference case go away: the value comes from the environment, so nothing can arrive as `${user_config.…}`. `publishable()` in `lib/session-env.mjs` keeps its check for that text, because it costs nothing and covers a host that exports a reference it did not substitute.

### D3. Pin the rule, not the finding

The finding text is not in the local binary, so a test cannot run the portal's check. The manifest pin reads every hook in `plugin.json` and `hooks/hooks.json`. It names a hook whose `command` or `args` hold a `${` not followed by `CLAUDE_PLUGIN_ROOT}`, a `$(`, a backtick, a glob character or a brace pattern, and it names a hook whose command is not `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` with no `args`, the shape every hook now has.

## Risks

- **The credential hold.** The rule is "don't read a credential that is already set in the user's environment … ask for it through `userConfig` instead". `CLAUDE_PLUGIN_OPTION_<KEY>` is the `userConfig` value, set by the host. The 1.5.1 hold, when the preflight read these variables, also had the doctor's key presence reads that PR #32 removed, so it does not implicate them. What stays unknown is the scanner's matching, as for any route.
- **The host's export is unprobed for a sensitive option on the current host.** The old preflight read it on 1.5.x hosts. Task 2.2 is that check, in a real session (an agent probe cannot save an option).
