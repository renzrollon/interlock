## ADDED Requirements

### Requirement: A plugin option SHALL reach the push as a value the manifest passes, and no shipped code SHALL read the host's option variables

Each of the plugin's two push options SHALL be handed to a session-start hook of its own as an argument the manifest writes as a `${user_config.…}` reference, one option to a hook, so that the host runs a hook only for an option the person has saved a value for. Such a hook SHALL append one export of the matching variable (`INTERLOCK_NTFY_TOPIC` for the topic, `INTERLOCK_NTFY_URL` for the server) to the session's environment file, SHALL leave a variable the operator already provided as it is, SHALL print nothing to standard output, and SHALL exit 0 on every path. A value that is empty, that carries a line break or a NUL, or that still reads as an unsubstituted reference SHALL be written nowhere. The manifest's preflight entry SHALL name no option, because the host does not run a hook whose arguments name an option with no saved value. No file the package ships SHALL read a `CLAUDE_PLUGIN_OPTION_` variable, and a test SHALL fail naming the file when one does.

#### Scenario: Happy path — a saved topic reaches the session's commands

- **GIVEN** the topic hook run with the argument `my-topic`, an environment file, and no `INTERLOCK_NTFY_TOPIC` in the hook's environment
- **WHEN** the hook exits
- **THEN** the file gains one line that exports `INTERLOCK_NTFY_TOPIC` as a single-quoted shell word, and a shell that sources the file reads `my-topic`
- **AND** nothing is printed to standard output and the exit code is `0`

#### Scenario: Happy path — a value with a quote survives the shell

- **GIVEN** the topic hook run with the argument `topic'name` and the server hook run with `https://example.invalid`
- **WHEN** a shell sources the environment file both wrote
- **THEN** `INTERLOCK_NTFY_TOPIC` reads `topic'name` and `INTERLOCK_NTFY_URL` reads `https://example.invalid`
- **AND** no other variable is defined by the file

#### Scenario: Failure — an unsubstituted reference is never exported

- **GIVEN** the topic hook run with the literal argument `${user_config.ntfy_topic}`, or with an empty argument, or with a value that carries a line break
- **WHEN** the hook exits
- **THEN** the environment file is unchanged
- **AND** the exit code is `0` and nothing is printed to standard output

#### Scenario: Failure — a shipped file reads the host's option variable

- **GIVEN** any file the package ships that contains the text `CLAUDE_PLUGIN_OPTION_`
- **WHEN** the pin test runs
- **THEN** it fails naming that file
- **AND** it does not pass on the grounds that the manifest also passes the value

#### Scenario: Edge case — the operator's own variable wins

- **GIVEN** `INTERLOCK_NTFY_TOPIC=from-the-shell` in the hook's environment and the argument `from-the-plugin`
- **WHEN** the topic hook exits
- **THEN** the environment file is unchanged
- **AND** the push still reads `from-the-shell`

#### Scenario: Edge case — an unset option leaves the preflight running

- **GIVEN** the manifest as shipped
- **WHEN** the registration test reads its session-start entries
- **THEN** the preflight's entry names no `${user_config.` reference, and each of the two option entries names one such reference and no second one, for two different options
- **AND** the test fails naming the entry when the preflight's command or arguments gain a reference

#### Scenario: Edge case — no environment file

- **GIVEN** the topic hook run with a valid argument and no environment file path in its environment
- **WHEN** the hook exits
- **THEN** nothing is written anywhere
- **AND** the exit code is `0`
