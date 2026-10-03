## ADDED Requirements

### Requirement: Spawn requests SHALL accept an optional effort

A `SpawnRequest` MUST accept an optional `effort` naming the level the step assigned, in addition to `label`, `prompt`, `model`, `schema`, `type` and `tools`. A host MUST apply it where its declared effort capability says it can. A host that cannot apply it MUST still spawn with a fresh context, MUST NOT fail the spawn because of it, and MUST NOT implement the task in the driver process. A request that carries no `effort` MUST leave the host's own default in place.

The Claude Code workflow runtime honors the field by passing it through to `agent()`.

#### Scenario: Happy path — the Workflow runtime passes the effort through

- **GIVEN** a step whose spawn carries `effort: "low"`
- **WHEN** the Workflow script spawns it
- **THEN** the options passed to `agent()` carry `effort: "low"`

#### Scenario: Failure — a host that cannot apply the effort still spawns

- **GIVEN** a host whose declared effort capability is `unsupported` and a spawn request naming an effort
- **WHEN** the host is asked to spawn
- **THEN** the agent runs and returns its result
- **AND** the spawn is not recorded as failed on account of the effort

#### Scenario: Edge case — a request without an effort changes nothing

- **GIVEN** a spawn request with no `effort`
- **WHEN** any host spawns it
- **THEN** no effort flag, option or session setting is sent
- **AND** the agent runs at the host's default

### Requirement: The ACP adapter SHALL apply a named effort through session configuration when the agent advertises it

For every spawn that names an effort, the ACP adapter MUST look for an effort option among the config options the agent most recently returned — after any model negotiation, because the levels a session offers depend on its model. It MUST identify the option by the id `effort` or the category `thought_level`. It MUST select an advertised value only when that value equals the requested level exactly, and MUST apply it with `session/set_config_option` before `session/prompt`.

The adapter MUST NOT choose a nearest, lower or default level, and MUST NOT match by substring or display name: one level's name is contained in another's. It reads only a flat list of advertised values; an effort option of any other shape is treated as not advertising the level. When no effort option is advertised, when the level is not among the advertised values, or when the agent rejects the call, the adapter MUST report that spawn's effort as not applied with the reason, and MUST still run the prompt.

A session that could not be created, or a turn that timed out before the effort was negotiated, is a failed spawn under the adapter's existing rules and raises no effort event, because no effort was attempted. A turn that times out after the effort was negotiated is still a failed spawn, and keeps the effort event it already emitted.

Rationale: ACP defines no effort field, only an advertised option an agent may or may not offer. A level applied by approximation is a wrong effort that ran, which no summary would show.

#### Scenario: Happy path — an advertised level is applied before the prompt

- **GIVEN** an ACP agent whose config options advertise an `effort` select with values `low`, `medium`, `high` and `xhigh`
- **WHEN** the adapter spawns a lane naming the effort `low`
- **THEN** the adapter calls `session/set_config_option` with `configId: "effort"` and `value: "low"` before `session/prompt`
- **AND** the spawn's effort-routing event reports `applied: true` and `via: "set_config_option"`

#### Scenario: Failure — the agent advertises no effort option

- **GIVEN** an ACP agent whose config options carry no effort option
- **WHEN** the adapter spawns a lane naming the effort `low`
- **THEN** the prompt still runs and the spawn returns the agent's result
- **AND** the effort-routing event reports `applied: false` with reason `no effort option advertised`
- **AND** the run summary contains `EFFORT ROUTING UNAVAILABLE (acp)` followed by a line naming that spawn

#### Scenario: Failure — the agent rejects the option

- **GIVEN** an ACP agent that advertises an effort option and answers `session/set_config_option` for it with a JSON-RPC error
- **WHEN** the adapter spawns a lane naming an advertised level
- **THEN** the prompt still runs
- **AND** the effort-routing event reports `applied: false` with reason `agent rejected the effort option`

#### Scenario: Edge case — a level that is not advertised is not approximated

- **GIVEN** an ACP agent whose effort option advertises `low`, `medium` and `high` only
- **WHEN** the adapter spawns a verify step naming the effort `xhigh`
- **THEN** no `session/set_config_option` call is made for the effort
- **AND** `high` is not selected in its place
- **AND** the effort-routing event reports `applied: false` with reason `level not among advertised values`

#### Scenario: Edge case — the option is found by category when its id differs

- **GIVEN** an ACP agent whose effort option has the id `reasoning_effort` and the category `thought_level`
- **WHEN** the adapter spawns a lane naming an advertised level
- **THEN** the adapter applies it with `session/set_config_option` using that option's own id

#### Scenario: Edge case — an option that is not a flat list of values is not read

- **GIVEN** an ACP agent whose effort option groups its values instead of listing them flat
- **WHEN** the adapter spawns a lane naming a level that appears inside a group
- **THEN** no `session/set_config_option` call is made for the effort
- **AND** the effort-routing event reports `applied: false` with reason `level not among advertised values`

#### Scenario: Edge case — a session that was never created raises no effort event

- **GIVEN** an ACP agent process that exits before `session/new` answers
- **WHEN** the adapter spawns a lane naming an effort
- **THEN** the spawn is reported as failed
- **AND** no effort-routing event is emitted for it

#### Scenario: Edge case — the effort is read after the model is set

- **GIVEN** an ACP agent that offers an effort option only once a model that supports effort is selected
- **WHEN** the adapter spawns a lane naming both a model and an effort
- **THEN** the model is negotiated first
- **AND** the effort option is read from the config options the agent returned after that
