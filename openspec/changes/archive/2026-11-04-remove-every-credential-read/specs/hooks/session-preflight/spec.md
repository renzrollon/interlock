## ADDED Requirements

### Requirement: The prompt-cache row SHALL report configuration and read no credential, never an effective lifetime

The `prompt-cache` row SHALL report only what the settings files state and SHALL NOT assert what lifetime a session is actually running under, because the host exposes no effective lifetime. It SHALL read no credential variable to determine an authentication mode, and SHALL say that the documented defaults depend on the host build and the authentication mode, which the report does not inspect.

#### Scenario: Happy path — the row reads no credential

- **GIVEN** a credential variable is set in the environment
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row names no authentication mode and no credential variable
- **AND** the variable's value appears nowhere in the report

#### Scenario: Failure — no effective lifetime is asserted

- **GIVEN** neither lifetime setting is configured
- **WHEN** `interlock doctor` runs
- **THEN** the row does not state that any particular lifetime is in force
- **AND** it states only that the settings are unset and what the host's documented defaults depend on

#### Scenario: Edge case — the uninspected mode is said, not guessed

- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row says the documented defaults depend on an authentication mode the report does not inspect
- **AND** it names no default as the one in force

## REMOVED Requirements

### Requirement: The prompt-cache row SHALL report configuration, never an effective lifetime

**Reason**: It required the row to name an authentication mode detected from two credential variables. Any read of a credential that could reach a server holds the plugin in the directory, and the hold's own remedy is to remove every such read.

**Migration**: Replaced by "The prompt-cache row SHALL report configuration and read no credential, never an effective lifetime", which keeps the no-effective-lifetime rule and says the mode is not inspected.

### Requirement: The preflight SHALL report whether a bare headless run would have a credential, as advice

**Reason**: The row's only content was whether a key variable or a settings helper was present: a credential read, for advice about a default that has not changed.

**Migration**: None in the plugin. A `--host claude` lane with nothing to authenticate with fails at spawn and is bannered through the spawn failure.
