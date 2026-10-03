## ADDED Requirements

### Requirement: Effort control SHALL be a separately declared host capability

Each host adapter SHALL declare how it applies a named effort as its own capability, with exactly one of three values:

- `flag` — the adapter passes the level to its vendor CLI;
- `negotiated` — the adapter asks the agent at session creation;
- `unsupported` — the adapter has no effort channel it is verified to use on this host. That covers a host with no per-spawn channel at all, and a host whose channel the adapter does not route.

The declaration SHALL be recorded in the run manifest alongside the host's other declared capabilities, and in the run's receipt, so a reader of past runs can tell a run whose effort was applied from one where it could not be. The Workflow host's assumed declaration SHALL be `flag`.

A declaration SHALL be made from what the vendor binary is known to accept. An adapter MUST NOT pass an effort flag that its vendor CLI is not verified to accept, and MUST NOT translate a level into another vendor's vocabulary.

The `claude` adapter SHALL apply a named effort with the CLI's effort flag, and SHALL pass no effort flag for a spawn that named none. It SHALL establish once, when the host is created, whether the installed CLI accepts that flag, from the CLI's own help. When the CLI does not, or when that cannot be established, the adapter SHALL declare `unsupported` for the run and SHALL pass no effort flag on any spawn.

Rationale: a capability that is merely implied by an adapter's code is a capability nothing can banner. Effort levels are not comparable across vendors' models, so a guessed flag or a translated label is a wrong effort that ran — invisible in a summary, where an `unsupported` declaration is not. A CLI that does not know the flag rejects the whole invocation, which would turn a missing capability into a failed run.

#### Scenario: Happy path — the Claude host applies a named effort by flag

- **GIVEN** `interlock-run <change> --host claude`, a CLI whose help lists the effort flag, and a lane spawn naming the effort `low`
- **WHEN** the adapter starts the agent
- **THEN** the argv carries `--effort low`
- **AND** the manifest records `effort: flag` among the host's declared capabilities

#### Scenario: Happy path — the receipt records the declaration

- **GIVEN** a run whose host declared `effort: unsupported`
- **WHEN** the run closes
- **THEN** the receipt's host block records `effort: unsupported`
- **AND** a receipt written before this capability existed reads as not recorded, never as `flag` or `unsupported`

#### Scenario: Failure — an unsupported host is given no invented flag

- **GIVEN** `interlock-run <change> --host codex` and a lane spawn naming an effort
- **WHEN** the adapter starts the agent
- **THEN** the argv is identical to the argv for the same spawn with no effort named
- **AND** the manifest records `effort: unsupported`

#### Scenario: Failure — a Claude CLI without the effort flag degrades instead of failing

- **GIVEN** `--host claude` and a CLI whose help does not list the effort flag
- **WHEN** the host is created and a lane spawn naming an effort is started
- **THEN** the host's effort capability is `unsupported` for that run
- **AND** the argv carries no effort flag, so the CLI does not reject the invocation
- **AND** the lane runs and returns its result

#### Scenario: Failure — an adapter that omits the declaration is caught

- **GIVEN** an adapter registered without an effort declaration, or with a value outside the three legal ones
- **WHEN** the registry test sweeps every declared capability over every adapter
- **THEN** it fails naming the adapter and the capability

#### Scenario: Edge case — a CLI whose help cannot be read is treated as unable

- **GIVEN** `--host claude` and a CLI whose help invocation fails or times out
- **WHEN** the host is created
- **THEN** the host's effort capability is `unsupported` for that run
- **AND** host creation does not fail because of it

#### Scenario: Edge case — a spawn that names no effort adds no flag

- **GIVEN** `--host claude` and a spawn whose effort is null
- **WHEN** the adapter starts the agent
- **THEN** the argv carries no effort flag
- **AND** the agent runs at the CLI's own default

### Requirement: An unapplied effort SHALL be bannered per spawn, and the spawn SHALL still run

For every spawn that names an effort and whose agent the adapter got as far as starting, the adapter MUST emit an effort-routing event stating the level requested, whether it was applied, by which method, and if not, why. An adapter MUST emit no such event for a spawn that named none. A spawn that fails before the adapter could attempt the effort is a failed spawn, reported as one, and is counted neither as applied nor as unapplied.

The reason MUST be true of that host. A host with no effort channel at all, a host whose channel the adapter does not route, and a CLI that lacks the flag MUST each give a different reason.

The runner MUST forward the step's effort to the adapter, and MUST read whether it was applied from the adapter's event alone — it MUST NOT compute that verdict itself. The runner MUST print `EFFORT ROUTING UNAVAILABLE (<host>)` when at least one spawn's effort was not applied, followed by one line per such spawn naming its label, the level it requested and the reason. When every spawn that named an effort had it applied, the runner MUST say so instead. A run in which no spawn named an effort MUST print neither.

Each banner line MUST state the level as the one requested, so that a host which could not apply an effort cannot be read as a host that ran at that effort. A spawn whose effort was not applied MUST still run, and its result MUST be recorded as any other spawn's is.

Rationale: on the Workflow host the plan's effort is applied; on a host that cannot apply it, the run is weaker in a way a green summary hides. A host that could not be bannered is a run that degraded silently.

#### Scenario: Happy path — every named effort was applied

- **GIVEN** `--host claude` and a run in which three spawns named an effort
- **WHEN** the run closes
- **THEN** the summary states that effort routing was applied on 3 of 3 spawns
- **AND** the summary does not contain `EFFORT ROUTING UNAVAILABLE`

#### Scenario: Failure — a host with no effort control is bannered and the lane still runs

- **GIVEN** `--host qwen` and a lane spawn naming the effort `low`
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING UNAVAILABLE (qwen)` followed by a line naming that lane's label, `low` as the level requested, and the reason that the host has no effort control
- **AND** the lane ran and its result was recorded

#### Scenario: Failure — a host whose channel is not routed says that, not that it has none

- **GIVEN** `--host codex` and a lane spawn naming an effort
- **WHEN** the run closes
- **THEN** the banner line for that lane gives the reason that effort is not routed on this host
- **AND** it does not say the host has no effort control

#### Scenario: Failure — a driver that decides application itself is caught

- **GIVEN** a runner that derives whether an effort was applied from the host id or the step, rather than from the adapter's event
- **WHEN** the driver test inspects how the unapplied set is built
- **THEN** the test fails because the verdict is not read from the event

#### Scenario: Edge case — a run in which no spawn named an effort says nothing about effort

- **GIVEN** a run whose only spawns carry a null effort
- **WHEN** the run closes
- **THEN** the summary contains neither the applied line nor `EFFORT ROUTING UNAVAILABLE`

#### Scenario: Edge case — a partly applied run names only the spawns that missed

- **GIVEN** `--host acp` and a run in which one spawn's effort was applied and another's was not
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING UNAVAILABLE (acp)` with exactly one line, naming the spawn that missed
- **AND** it does not also claim that effort routing was applied on every spawn

#### Scenario: Edge case — a spawn that names no effort raises no event

- **GIVEN** a run with a spawn whose effort is null, on any host
- **WHEN** that spawn runs
- **THEN** the adapter emits no effort-routing event for it
- **AND** it is not counted in the applied total
