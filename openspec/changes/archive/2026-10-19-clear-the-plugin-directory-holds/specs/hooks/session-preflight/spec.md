## MODIFIED Requirements

### Requirement: The preflight SHALL report whether push is configured, as advice

`interlock doctor` SHALL carry a `notify` row computed from the environment the check runs in: `ok` when `INTERLOCK_NTFY_TOPIC` is set there, `skip` when it is not. The `skip` detail SHALL name that variable and the plugin's topic option, SHALL say that an option reaches the session's commands at session start and so cannot be seen by a check that runs beside it, and SHALL state that an unattended run stops silently without a topic. The row SHALL never be `fail`, because push is optional, the row SHALL never print the topic value, and the check SHALL read no `CLAUDE_PLUGIN_OPTION_` variable.

#### Scenario: Happy path — configured

- **GIVEN** `INTERLOCK_NTFY_TOPIC` is set
- **WHEN** `interlock doctor` runs
- **THEN** the `notify` row is `ok` and names the server that will be used
- **AND** the topic value does not appear anywhere in the report

#### Scenario: Failure — only the host's option variable is set

- **GIVEN** `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC=from-plugin` in the environment and `INTERLOCK_NTFY_TOPIC` unset
- **WHEN** `interlock doctor` runs
- **THEN** the `notify` row is `skip`, and its detail names `INTERLOCK_NTFY_TOPIC` and the plugin's topic option
- **AND** the text `from-plugin` does not appear anywhere in the report

#### Scenario: Edge case — unconfigured

- **GIVEN** `INTERLOCK_NTFY_TOPIC` is unset
- **WHEN** `interlock doctor` runs
- **THEN** the `notify` row is `skip`, its detail names `INTERLOCK_NTFY_TOPIC`, and the report's overall verdict is unaffected
