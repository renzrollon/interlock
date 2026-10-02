## ADDED Requirements

### Requirement: A dollar figure is the published price table applied to measured tokens

The outcome eval SHALL convert measured tokens into a dollar figure only by applying the price table published in the project limits. The table SHALL carry an id, and a revision of any rate SHALL be a new id. The id this change publishes is `anthropic-list-2026-10`.

That table SHALL price exactly these models, in US dollars per million tokens: `claude-opus-5-5` at 4 input and 20 output, `claude-sonnet-5-5` at 2 input and 10 output, and `claude-haiku-4-5` at 1 input and 5 output. It SHALL NOT contain `claude-opus-5` or `claude-sonnet-5`.

Cache reads SHALL be priced per model as a multiplier on that model's input rate: 0.05 for `claude-opus-5-5`, and 0.1 for `claude-sonnet-5-5` and `claude-haiku-4-5`. Cache writes SHALL be priced by lifetime tier, shared across those models: `ephemeral_5m` at 1.25 times the model's input rate, and `ephemeral_1h` at 2 times the model's input rate. The two write tiers SHALL NOT be summed into one write price.

The input term SHALL be the uncached input count alone. Cache-read tokens SHALL NOT also be multiplied by the base input rate.

A model the table does not contain, or a listed model with no read multiplier, SHALL yield no dollar figure. The reason SHALL name the table id. The figure SHALL NOT be zero and SHALL NOT be guessed from the model name.

When the uncached input count, the output count, the cache-read count, or the cache-write record is absent, the dollar figure SHALL be absent and the reason SHALL name the missing field. A count that was measured and is zero SHALL be priced as zero. Inside a present cache-write record, a lifetime tier the record omits SHALL be priced as zero. A tier the record carries as absent SHALL make the whole dollar figure absent.

The dollar figure SHALL be recorded with the table id that produced it. It SHALL NOT change the eval's exit status, and it SHALL NOT be a bill.

#### Scenario: Happy path — uncached input, a cache read, and a five-minute write price at the published rates

- **GIVEN** one million uncached input tokens, one million cache-read tokens, one million `ephemeral_5m` write tokens, zero `ephemeral_1h` write tokens, and zero output tokens, for `claude-opus-5-5`
- **WHEN** the eval prices that usage against `anthropic-list-2026-10`
- **THEN** the dollar figure is 9.2, which is 4 plus 0.2 plus 5
- **AND** the recorded figure names the table id `anthropic-list-2026-10`

#### Scenario: Failure — a missing cache field or an unknown model yields no dollars

- **GIVEN** a usage whose uncached input and output counts are present and whose cache-read count is absent
- **WHEN** the eval prices it
- **THEN** the dollar figure is absent
- **AND** the reason names the missing cache-read field
- **AND** the same usage for a model named `claude-opus-5` is also absent, and that reason names the table id rather than a guessed rate

#### Scenario: Edge case — a measured zero is priced, and a stale name that only looks like a priced model is not

- **GIVEN** a `claude-sonnet-5-5` usage whose cache-read count and both write tiers are measured zeros, and a second usage whose model string is `Claude-Sonnet-5-5` or `claude-sonnet-5-5 ` with a trailing space
- **WHEN** the eval prices each
- **THEN** the first figure prices the cache terms at zero and still prices input and output
- **AND** the second figure is absent, because the lookup is the exact model string

### Requirement: The outcome eval's default model is a key in the current price table

When no model override is set, the outcome eval SHALL call `claude-opus-5-5` and SHALL record that id on the result. The override, when set, SHALL be recorded as given and SHALL be priced only when it is an exact key in the current table. An override the table does not contain SHALL still run, and its dollar figure SHALL be absent with a reason that names the table id.

#### Scenario: Happy path — an unconfigured run calls the priced default

- **GIVEN** an outcome-eval run with no model override
- **WHEN** the run calls the model and prices its usage
- **THEN** the recorded model is `claude-opus-5-5`
- **AND** that id is a key in `anthropic-list-2026-10`

#### Scenario: Failure — an override the table does not contain still runs, unpriced

- **GIVEN** the model override is `claude-opus-5`
- **WHEN** the outcome eval runs
- **THEN** the run proceeds and records `claude-opus-5`
- **AND** the dollar figure is absent with a reason that names `anthropic-list-2026-10`

#### Scenario: Edge case — an override that differs from a priced key only by surrounding whitespace is not that key

- **GIVEN** the model override is ` claude-opus-5-5`
- **WHEN** the eval prices the run
- **THEN** the recorded model is the override as given
- **AND** the dollar figure is absent, because the priced key has no leading space
