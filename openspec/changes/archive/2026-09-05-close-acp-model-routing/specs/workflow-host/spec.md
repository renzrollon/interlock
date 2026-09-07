## ADDED Requirements

### Requirement: The ACP adapter SHALL apply the planner's model through session configuration when the agent advertises it

For every spawn that carries a model slug, the ACP adapter MUST inspect the `configOptions` returned by `session/new`, MUST select an advertised value for the slug by exact value, then case-insensitive substring of value or display name, then an operator-supplied map, and MUST apply it with `session/set_config_option` before `session/prompt`, falling back to `session/set_model` once on error. The adapter MUST NOT choose a nearest or default model when no rule matches. The adapter MUST report per spawn whether the model was applied, by which method, and if not, why. The driver MUST print `MODEL ROUTING UNAVAILABLE (ACP host)` only when at least one spawn that requested a model was not applied, naming each such spawn and its reason, and MUST otherwise state that routing was applied. The `_meta['interlock/model']` hint MUST keep travelling.

#### Scenario: Happy path — the agent advertises a model option and the planner's slug is applied

- **GIVEN** an ACP agent whose `session/new` response advertises a `model` select with values `haiku`, `sonnet` and `opus`
- **WHEN** the adapter spawns a lane whose planner model is `sonnet`
- **THEN** the adapter calls `session/set_config_option` with `configId: "model"` and `value: "sonnet"` before `session/prompt`
- **AND** the spawn's routing event reports `applied: true` and `via: "set_config_option"`
- **AND** the run summary does not contain `MODEL ROUTING UNAVAILABLE (ACP host)`

#### Scenario: Failure — the agent advertises no model option and rejects the legacy method

- **GIVEN** an ACP agent whose `session/new` response carries no `configOptions` and whose `session/set_model` returns JSON-RPC error `-32601`
- **WHEN** the adapter spawns a lane whose planner model is `haiku`
- **THEN** the prompt still runs and the spawn returns the agent's result
- **AND** the spawn's routing event reports `applied: false` with reason `no model option advertised`
- **AND** the run summary contains `MODEL ROUTING UNAVAILABLE (ACP host)` followed by a line naming that spawn's label and reason

#### Scenario: Edge case — the advertised values share no text with the slug

- **GIVEN** an ACP agent whose model option advertises values `gpt-a` and `gpt-b` and no display name containing `sonnet`
- **AND** `INTERLOCK_ACP_MODEL_MAP` is unset
- **WHEN** the adapter spawns a lane whose planner model is `sonnet`
- **THEN** no `session/set_config_option` call is made for the model
- **AND** the routing event reports `applied: false` with reason `slug not among advertised values`
- **AND** when `INTERLOCK_ACP_MODEL_MAP` is set to `{"sonnet":"gpt-b"}` the adapter applies `gpt-b` and reports `applied: true`
