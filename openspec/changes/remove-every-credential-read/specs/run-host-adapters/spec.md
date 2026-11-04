## MODIFIED Requirements

### Requirement: The runner SHALL name the billing path it runs on

Every runner summary MUST print `RUNNER HOST: <id> (experimental)`. A run whose adapter drives the Claude binary, directly or through ACP, MUST print a `SUBSCRIPTION PATH: programmatic` banner pointing at the documentation; a Codex run that `codex login status`, read once when the host is created, reports as a ChatGPT login MUST print a `CHATGPT PLAN PATH (codex)` banner; a Codex run whose login status could not be read or recognised MUST print `CODEX LOGIN NOT INSPECTED (codex)`; the adapter MUST read no credential variable or file to decide either. A host without hooks MUST print `HOOKS NOT IN FORCE (<host>)`. The receipt MUST record the host id, its billing path and its hook availability.

#### Scenario: Happy path — a Claude run names its path

- **GIVEN** `--host claude`
- **WHEN** the run closes
- **THEN** the summary contains `RUNNER HOST: claude (experimental)` and the `SUBSCRIPTION PATH: programmatic` banner
- **AND** the receipt records `host.billing = claude-subscription-programmatic`

#### Scenario: Failure — a Codex run without credentials guidance

- **GIVEN** `--host codex` and `codex login status` reporting a ChatGPT login
- **WHEN** the run closes
- **THEN** the summary contains the `CHATGPT PLAN PATH` banner and `HOOKS NOT IN FORCE (codex)`

#### Scenario: Edge case — ACP over a non-Claude agent

- **GIVEN** `--host acp` with `INTERLOCK_ACP_COMMAND` naming a non-Claude agent
- **WHEN** the run closes
- **THEN** no `SUBSCRIPTION PATH` banner is printed
- **AND** `RUNNER HOST: acp (experimental)` is

#### Scenario: Happy path — a Codex run on an API-key login prints no plan banner

- **GIVEN** `--host codex` and `codex login status` reporting an API-key login
- **WHEN** the run closes
- **THEN** the summary contains neither `CHATGPT PLAN PATH` nor `CODEX LOGIN NOT INSPECTED`
- **AND** a key variable set or unset in the environment changes neither banner

#### Scenario: Edge case — a login status that cannot be read is said so, not guessed

- **GIVEN** `--host codex` and `codex login status` that fails, hangs past its bound, or answers in words the adapter does not recognise
- **WHEN** the run closes
- **THEN** the summary contains `CODEX LOGIN NOT INSPECTED (codex)`
- **AND** it does not contain `CHATGPT PLAN PATH`
