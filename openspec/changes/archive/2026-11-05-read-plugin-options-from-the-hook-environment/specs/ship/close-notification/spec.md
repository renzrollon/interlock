## ADDED Requirements

### Requirement: A plugin option SHALL reach the push through one hook that reads the host's option variables

The session-start hook `hooks/notify-option.mjs` SHALL take no argument and SHALL export `INTERLOCK_NTFY_TOPIC` from `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` from `CLAUDE_PLUGIN_OPTION_NTFY_URL` into the session's environment file. It SHALL keep an operator's own variable, SHALL print nothing to standard output, SHALL exit 0, and SHALL write no value that is blank, multi-line or an unsubstituted reference.

#### Scenario: Happy path — a saved topic reaches the session's commands

- **GIVEN** the hook run with `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC=my-topic`, an environment file, and no `INTERLOCK_NTFY_TOPIC` in its environment
- **WHEN** the hook exits
- **THEN** the file gains one line that exports `INTERLOCK_NTFY_TOPIC` as a single-quoted shell word, and a shell that sources the file reads `my-topic`
- **AND** nothing is printed to standard output and the exit code is `0`

#### Scenario: Happy path — a topic with a quote and a server survive the shell in one run

- **GIVEN** the hook run once with `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC=topic'name` and `CLAUDE_PLUGIN_OPTION_NTFY_URL=https://example.invalid`
- **WHEN** a shell sources the environment file
- **THEN** `INTERLOCK_NTFY_TOPIC` reads `topic'name` and `INTERLOCK_NTFY_URL` reads `https://example.invalid`
- **AND** no other variable is defined by the file

#### Scenario: Failure — an unusable value is never exported

- **GIVEN** the hook run with `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` unset, empty, holding a line break, or holding the literal text `${user_config.ntfy_topic}`
- **WHEN** the hook exits
- **THEN** the environment file is unchanged
- **AND** the exit code is `0` and nothing is printed to standard output

#### Scenario: Edge case — the operator's own variable wins

- **GIVEN** `INTERLOCK_NTFY_TOPIC=from-the-shell` and `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC=from-the-plugin` in the hook's environment
- **WHEN** the hook exits
- **THEN** the environment file gains no topic line
- **AND** the push still reads `from-the-shell`

#### Scenario: Edge case — no environment file

- **GIVEN** the hook run with a saved topic and no environment file path in its environment
- **WHEN** the hook exits
- **THEN** nothing is written anywhere
- **AND** the exit code is `0`

### Requirement: No hook command SHALL name a variable other than the plugin root, and only the option hook SHALL read the host's option variables

Every hook the manifest registers SHALL be the command `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` with no arguments, so that no hook's command holds another variable, a command substitution, a wildcard or a brace pattern. No shipped file but `hooks/notify-option.mjs` SHALL spell `CLAUDE_PLUGIN_OPTION_`, and a test SHALL fail naming the file when one does.

#### Scenario: Failure — a hook command names a variable the directory cannot follow

- **GIVEN** a manifest whose hook carries `${user_config.ntfy_topic}` in its arguments, a `$(…)`, a `*`, or a `${CLAUDE_PROJECT_DIR}`
- **WHEN** the registration pin reads it
- **THEN** it fails naming the event and the hook
- **AND** the shipped manifest passes it

#### Scenario: Failure — another shipped file reads the host's option variable

- **GIVEN** a file the package ships, other than `hooks/notify-option.mjs`, that contains the text `CLAUDE_PLUGIN_OPTION_`
- **WHEN** the pin test runs
- **THEN** it fails naming that file

## REMOVED Requirements

### Requirement: A plugin option SHALL reach the push as a value the manifest passes, and no shipped code SHALL read the host's option variables

**Reason**: The plugin directory's Validate refuses a hook whose command or arguments hold a variable other than `${CLAUDE_PLUGIN_ROOT}` (**Command path can't be followed**), and the `${user_config.…}` arguments this requirement asked for are such variables. The credential hold it was written against stood under it anyway. The one-hook requirement above replaces it; the export, the quoting, the operator's precedence and the silence on standard output are carried unchanged.
