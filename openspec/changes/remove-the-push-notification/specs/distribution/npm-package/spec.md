## ADDED Requirements

### Requirement: No shipped file SHALL name a credential variable, a credential file or the host's option variables, and the changelog SHALL NOT ship

No file in the published bundle SHALL spell a credential variable or file name from the package test's list, the host's option-variable prefix `CLAUDE_PLUGIN_OPTION_`, or the retired push variables `INTERLOCK_NTFY_`. No file is excepted, and `CHANGELOG.md` SHALL NOT be listed in `files` or ship. No shipped file SHALL carry the removed push's residue.

#### Scenario: Failure — a shipped file names a credential variable

- **GIVEN** a shipped file spells `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `.credentials.json`, `CLAUDE_PLUGIN_OPTION_` or `INTERLOCK_NTFY_`, the changelog included were it shipped
- **WHEN** `npm test` runs
- **THEN** the package test fails naming the file and the name

#### Scenario: Failure — the changelog is shipped again

- **GIVEN** a `files` whitelist that lists `CHANGELOG.md`
- **WHEN** `npm test` runs
- **THEN** the package test fails naming `CHANGELOG.md`

#### Scenario: Failure — the removed push leaves residue

- **GIVEN** a shipped file that still mentions `ntfy` in any case, `notify-option`, `notifyTimeoutMs`, `postNtfy` or `push timeout`
- **WHEN** `npm test` runs
- **THEN** the package test fails naming the file and the word

### Requirement: No shipped code SHALL open a network connection

No shipped JavaScript file SHALL call `fetch`, import a Node network module or `undici`, or construct a `WebSocket`, an `EventSource` or an `XMLHttpRequest`. Requests made by the tools a run spawns are their own, and the README SHALL name those tools. The check SHALL be a named function with a self-test over synthetic files.

#### Scenario: Happy path — the bundle as shipped opens no connection

- **GIVEN** the working tree's `files` whitelist
- **WHEN** the package test runs
- **THEN** it passes

#### Scenario: Failure — a module reaches for the network

- **GIVEN** a synthetic shipped file that calls `fetch(`, imports `node:https`, `node:net` or `undici` by `import`, `import()` or `require`, or constructs a `WebSocket`
- **WHEN** the check reads it
- **THEN** it returns one problem naming the file and the construct
- **AND** a file that only spells the word in a string that is not a call, such as `'fetch'` in an argv list, is not reported

### Requirement: Every hook command SHALL be a plain path from the plugin root, and a sensitive option SHALL reach only a server's env or headers

Every hook the manifest registers SHALL be `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` with no arguments. A `sensitive` `userConfig` option SHALL appear as `${user_config.<key>}` only in an `mcpServers` or `lspServers` entry's `env` or `headers`, no shipped file but the manifest SHALL spell `${user_config.`, and no declared option SHALL go unused. Each check SHALL be a named function with a self-test.

#### Scenario: Happy path — the shipped manifest passes

- **GIVEN** the manifest as shipped, which declares no option
- **WHEN** the package test runs
- **THEN** both the hook-command check and the option check pass

#### Scenario: Failure — a sensitive option is handed to a hook

- **GIVEN** a synthetic manifest whose sensitive `token` option appears as `${user_config.token}` in a hook's `args`, or is declared and never referenced
- **WHEN** the option check reads it
- **THEN** it returns a problem naming the option and where it appeared, or that nothing consumes it
- **AND** the same option referenced only in an MCP server's `env` returns none

#### Scenario: Failure — a hook command names a variable the directory cannot follow

- **GIVEN** a manifest whose hook carries `${user_config.token}` in its arguments, a `$(…)`, a `*`, or a `${CLAUDE_PROJECT_DIR}`
- **WHEN** the registration pin reads it
- **THEN** it fails naming the event and the hook

## REMOVED Requirements

### Requirement: No shipped file but the changelog SHALL name a credential variable or file

**Reason**: Its changelog exception was the gap: the changelog shipped, and its entries named the key variables an earlier doctor read.

**Migration**: Replaced by "No shipped file SHALL name a credential variable, a credential file or the host's option variables, and the changelog SHALL NOT ship", which has no exception.
