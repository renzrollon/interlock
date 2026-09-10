## ADDED Requirements

### Requirement: The preflight SHALL report prompt-cache lifetime configuration, as advice

`interlock doctor` SHALL carry a `prompt-cache` row reporting whether the host's two prompt-cache lifetime settings are configured: the one governing the main conversation and the one governing subagents and workflows. The row SHALL name both settings keys and SHALL state which of the two governs the wave agents a ship run spawns, because they are different keys with different defaults and setting only one leaves the other on its default.

The row SHALL be `ok` when both are configured and `skip` when either is not, and SHALL never be `fail`. Prompt-cache lifetime is the operator's setting in the operator's own file; Interlock cannot set it, and a run works without it. The detail SHALL name the minimum host version below which the settings are silently ignored, because an operator who sets a key on an older host gets no error and no effect.

#### Scenario: Happy path — both lifetimes configured

- **GIVEN** both prompt-cache lifetime settings are configured in a settings scope the host reads
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row is `ok`
- **AND** the report's overall verdict is unaffected

#### Scenario: Failure — an unset lifetime is advice, never a failing check

- **GIVEN** neither prompt-cache lifetime setting appears in any settings scope
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row is `skip`
- **AND** the row is not `fail`
- **AND** the report's overall verdict and exit code are unaffected

#### Scenario: Edge case — a lifetime set in any readable scope counts as configured

- **GIVEN** the subagent lifetime is set in one settings scope and absent from the others
- **WHEN** `interlock doctor` runs
- **THEN** that setting is reported as configured
- **AND** no scope's value is printed as a recommendation over another's

### Requirement: The prompt-cache row SHALL report configuration, never an effective lifetime

The host exposes no effective prompt-cache lifetime to a hook, a script, or any command's output. The row SHALL therefore report only what the settings files and environment state, and SHALL NOT assert what lifetime a session is actually running under. It SHALL name the detected authentication mode where that mode changes the default lifetime, so an operator can tell whether a default they are relying on applies to them.

Reporting an unverifiable effective lifetime would be a fabricated measurement, which is the failure this requirement exists to prevent.

#### Scenario: Happy path — the row states what is configured and what mode was detected

- **GIVEN** a session whose authentication mode is detectable
- **WHEN** `interlock doctor` runs
- **THEN** the `prompt-cache` row names the detected authentication mode
- **AND** it does not claim what lifetime the current session's requests are receiving

#### Scenario: Failure — no effective lifetime is asserted

- **GIVEN** neither lifetime setting is configured
- **WHEN** `interlock doctor` runs
- **THEN** the row does not state that any particular lifetime is in force
- **AND** it states only that the settings are unset and what the host's documented defaults depend on

#### Scenario: Edge case — an undetectable authentication mode is named as undetected

- **GIVEN** a session whose authentication mode cannot be determined from the environment
- **WHEN** `interlock doctor` runs
- **THEN** the row says the mode was not determined
- **AND** it does not guess a mode in order to name a default
