## Context

`hooks/notify-option.mjs` exists because the host gives a plugin option to hook processes only, and the push runs from a Bash command or `interlock-run`, not a hook. The hook appends one `export` line to `$CLAUDE_ENV_FILE`, the host's channel from a hook to later commands. That stays. What changes is where the hook gets the value.

## Decisions

### D1. Read the host's option variables, not arguments

The plugins reference lists two ways an option reaches a hook: `${user_config.KEY}` in exec-form `args`, and `CLAUDE_PLUGIN_OPTION_<KEY>`, "exported to hook processes for every option, with `<KEY>` uppercased". The directory's command-path rule refuses the first ("a variable other than `${CLAUDE_PLUGIN_ROOT}`"), and its remedy names the second. Rejected: dropping the plugin options and asking for a shell variable. That reads a value already set in the user's environment, which is the credential rule's own example.

### D2. One hook entry, both options

The two entries existed because the host does not run a hook whose `args` name an unsaved option (old design D4). With no option in the command, one entry runs for everyone and exports whichever of the two variables holds a value. The `topic`/`url` argument and the unsubstituted-reference case go away: the value comes from the environment, so nothing can arrive as `${user_config.…}`. `publishable()` in `lib/session-env.mjs` keeps its check for that text, because it costs nothing and covers a host that exports a reference it did not substitute.

Because the entry now runs at every session start of every installation, and most of them saved neither option, the hook exits before importing `lib/session-env.mjs` when neither option variable holds a value (PR #34 review M4). That path loads nothing, writes nothing and says nothing: there is nothing to export, so there is nothing to degrade.

### D3. Pin the rule, not the finding

The finding text is not in the local binary, so a test cannot run the portal's check. The manifest pin reads every hook in `plugin.json` and `hooks/hooks.json`. It names a hook whose `command`, `args`, `url`, header values or `env` values hold a `${` not followed by `CLAUDE_PLUGIN_ROOT}`, a `$(`, a backtick, a glob character or a brace pattern, and it names every hook, whatever its `type` says or omits, whose command is not `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` with no `args`, the shape every hook now has (PR #34 review M2: the shape check does not wait for `type: "command"`).

### D4. A lost export is one line per variable, and the doctor names the hook

With both options in one process, a module that cannot be imported costs both exports. Each saved option is named on its own stderr line, so neither loss hides behind the other's (PR #34 blast radius B3). Those lines reach the host's debug log only: a hook that exits 0 shows nothing to the person (hooks reference, exit code 0). The hook cannot tell an unsaved option from one the host did not export, so the one place a person can see that difference is `interlock doctor`'s `notify` row run from the session: when it still reads `skip`, its detail now says that an option already saved was handed to no hook, naming `hooks/notify-option.mjs`. The row still spells no `CLAUDE_PLUGIN_OPTION_` name (the package pin), and the session-preflight requirement's clauses are all kept.

## Risks

- **The credential hold.** The rule is "don't read a credential that is already set in the user's environment … ask for it through `userConfig` instead". `CLAUDE_PLUGIN_OPTION_<KEY>` is the `userConfig` value, set by the host. The 1.5.1 hold, when the preflight read these variables, also had the doctor's key presence reads that PR #32 removed, so it does not implicate them. What stays unknown is the scanner's matching, as for any route.
- **The host's export is unprobed for a sensitive option on the current host.** The old preflight read it on 1.5.x hosts. Task 2.2 is that check, in a real session (an agent probe cannot save an option). What the installed host's code says (Claude Code 2.1.318, read from the binary during the PR #34 review): the hook-environment builder iterates every entry of the plugin's resolved option map and sets `CLAUDE_PLUGIN_OPTION_<KEY>` with the key uppercased, with no `sensitive` test, and that same map is what substituted `${user_config.KEY}` into the 1.6.0 to 1.13.0 arguments (`nYt`); the only sensitive filter is in skill and agent content substitution (`Bro`), which the hook never used. The hooks reference adds that the variables are not present in Bash tool commands, which is why the environment file is the channel.
