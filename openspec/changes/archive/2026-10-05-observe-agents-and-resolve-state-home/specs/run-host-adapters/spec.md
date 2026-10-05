## MODIFIED Requirements

### Requirement: Cache accounting SHALL be a separately declared host capability

Reporting cache tokens is not implied by reporting token usage: a host may expose a cumulative spend scalar while exposing no cache decomposition at all. Each host adapter SHALL therefore declare cache accounting as its own capability, separate from the usage capability it already declares, and the declaration SHALL be recorded in the run manifest alongside the host's other declared capabilities.

The capability SHALL admit three values: `true`, `false`, and the observed value `hook`, which means the figures were recorded by the plugin's recorder hooks rather than reported by the host's own envelope. No adapter SHALL declare `hook`; only the closing step SHALL set it, and only when every briefed spawn of the run was recorded. The receipt SHALL carry whichever of the three the run ended with, and a receipt written before `hook` existed SHALL read unchanged.

The run program SHALL branch on the declared capability rather than on the host's id or name, so that a host gaining or losing cache accounting changes one declaration and nothing else. A run on a host that does not declare it, and whose recorder observed nothing, SHALL be bannered — a host that could not be bannered is a run that degraded silently.

#### Scenario: Happy path — a host that reports cache fields declares the capability and records figures

- **GIVEN** an adapter whose vendor CLI returns a usage envelope carrying cache-read and cache-creation fields
- **WHEN** a run starts on that host
- **THEN** the manifest records cache accounting among that host's declared capabilities
- **AND** the run's recorded cache figures are present

#### Scenario: Happy path — a complete recorder join is recorded as hook-observed

- **GIVEN** the Workflow host, which declares `false`, and a run whose every briefed spawn was recorded by the recorder hooks
- **WHEN** the run closes
- **THEN** the manifest's observed cache accounting is `hook` and the receipt records `hook`
- **AND** the run is not bannered as lacking cache figures

#### Scenario: Failure — a host without the capability is bannered, not silently empty

- **GIVEN** an adapter whose runtime exposes only a cumulative spend scalar, and no recorded agent usage
- **WHEN** a run executes on that host
- **THEN** the manifest records cache accounting as undeclared for that host
- **AND** the run banners that cache figures are unavailable on this host
- **AND** the banner is carried into the run's summary

#### Scenario: Edge case — the capability is read from the declaration, never from the host's identity

- **GIVEN** two adapters, one declaring cache accounting and one not
- **WHEN** the run program decides whether to expect cache figures
- **THEN** the decision reads the declared capability
- **AND** no branch is taken on the adapter's id or display name

#### Scenario: Edge case — no adapter may declare the observed value

- **GIVEN** the registry as shipped
- **WHEN** a test reads every adapter's declaration
- **THEN** each declares `true` or `false`, the registry's value list admits `hook`, and a test fails if an adapter declares it

## ADDED Requirements

### Requirement: The claude adapter SHALL read the whole result envelope whatever the exit code and SHALL report a host record beside the result and the usage

The claude adapter SHALL parse the CLI's result envelope on every spawn, including one whose process exited non-zero or timed out, and SHALL report a host record carrying: whether the envelope parsed; its subtype, error flag and terminal reason; its errors, bounded in count and length; its permission denials as a count and the tool names; its session identifier and turn count; the identifiers of every model the session called, read from the envelope's per-model breakdown and recorded as session-scoped because the breakdown includes the host's own internal calls; the identifiers of the models that served the lane's own turns, read from the lane session's transcript after the process exits and recorded as absent with the reason when it cannot be read; its cost estimate, labelled a client-side estimate and never summed with any price table; the exit code; whether it timed out; and whether it reported success with no structured result. Every field SHALL be copied by name and recorded as absent when the envelope omits it, never as zero or false. The result and the usage SHALL be reported exactly as before.

#### Scenario: Happy path — a success envelope yields a full host record

- **GIVEN** an envelope reporting subtype `success`, a session identifier, three turns, a per-model breakdown with one model, no denials and a cost estimate
- **WHEN** the adapter reads it
- **THEN** the host record carries that subtype, session identifier, turn count, one session-scoped model, a denial count of zero and the estimate
- **AND** when the lane's transcript holds two assistant turns served by one model, the record carries that one model as turn-scoped
- **AND** the result and usage are reported as they were before

#### Scenario: Failure — a non-zero exit still yields the envelope's facts

- **GIVEN** a process that exited non-zero with an envelope of subtype `error_max_turns` on stdout
- **WHEN** the adapter reads it
- **THEN** the spawn still reports no result
- **AND** the host record carries `error_max_turns`, the exit code and the envelope's errors, and the spawn-failed event carries that record

#### Scenario: Edge case — unparseable stdout, an omitted breakdown, and a success without a structured result

- **GIVEN** a spawn whose stdout is not an envelope, one whose envelope omits the per-model breakdown, and one reporting success with exit 0 and no structured result
- **WHEN** the adapter reads each
- **THEN** the first record says the envelope did not parse and carries the exit code and nothing invented
- **AND** the second carries session-scoped models as absent, not as an empty list meaning none
- **AND** a lane whose transcript cannot be found carries turn-scoped models as absent with the reason, and its session-scoped models unchanged
- **AND** the third marks the structured result as missing

### Requirement: The runner SHALL forward host records to the CLI apart from the agents' results, and SHALL decide none of the lane banners

`interlock-run` SHALL collect the host record of every spawn from the adapter's events and pass them to the CLI on every record path beside, never inside, the results file, and the CLI SHALL decide every lane banner from them. The runner SHALL print no lane verdict of its own. A driver that passes no host records SHALL leave every lane unobserved.

#### Scenario: Happy path — records travel beside results

- **GIVEN** a batch of two lanes on `--host claude`
- **WHEN** the runner records the batch
- **THEN** the CLI receives two results and two host records on separate channels
- **AND** the results carry no host field

#### Scenario: Failure — a lane with no record

- **GIVEN** a runner whose adapter emitted no record for one lane
- **WHEN** the batch is recorded
- **THEN** that lane raises no lane banner and increments no count

#### Scenario: Edge case — the no-policy sweep

- **GIVEN** `bin/interlock-run` as shipped
- **WHEN** the driver source is swept for policy
- **THEN** it contains none of the lane banner texts and no comparison of a served model

### Requirement: The claude adapter SHALL suppress permission prompts only behind the help probe and outside bypass mode, SHALL never disable session persistence, and SHALL always name the plugin directory

The adapter SHALL pass `--permission-prompts none` when and only when the installed CLI's help lists that option and the configured permission mode is not `bypassPermissions`; when the mode is not bypass and the help does not list it, the run SHALL banner once that prompts are not suppressed on this CLI. The adapter SHALL never pass `--no-session-persistence`, so every lane's session stays resumable, and a test SHALL fail on any argv or source line that does. The adapter SHALL pass `--plugin-dir` naming the checkout whenever the checkout is the plugin, and SHALL rely on no implicit plugin, hook or instruction-file loading.

#### Scenario: Happy path — a non-bypass mode on a CLI that lists the flag

- **GIVEN** `INTERLOCK_CLAUDE_PERMISSION_MODE=acceptEdits` and a CLI whose help lists `--permission-prompts`
- **WHEN** a spawn's argv is built
- **THEN** it carries `--permission-prompts none` and `--plugin-dir <checkout>`
- **AND** it carries no `--no-session-persistence`

#### Scenario: Failure — the CLI does not list the flag

- **GIVEN** a non-bypass mode and a CLI whose help omits `--permission-prompts`
- **WHEN** the host is created and a spawn runs
- **THEN** the argv carries no `--permission-prompts`
- **AND** the run's banners say prompts are not suppressed on this CLI

#### Scenario: Edge case — the default mode and the source pin

- **GIVEN** the default `bypassPermissions` mode on a CLI that lists the flag
- **WHEN** a spawn's argv is built
- **THEN** it carries no `--permission-prompts`, so an ordinary unattended run's argv is unchanged
- **AND** a test asserts the adapter's source never names `--no-session-persistence` as an argument

### Requirement: The agents-file workaround for a success without a structured result SHALL ship only on a passing probe and SHALL stay in parity with the plugin agent

The adapter MAY pass a per-run agents file whose worker definition carries the plugin worker's prompt and disallowed tools and no tools allowlist, restricting tools through the existing allowed-tools argument, only when a recorded probe shows that configuration returns a structured result where the plugin agent does not. When adopted, a test SHALL pin the generated definition to the plugin's worker file so the two cannot drift, and the adapter SHALL still name the plugin directory for its hooks. When not adopted, the named schema-result-missing failure SHALL remain the mitigation.

#### Scenario: Happy path — adopted on evidence

- **GIVEN** a recorded probe showing the agents-file configuration returns a structured result
- **WHEN** the adapter builds a worker spawn
- **THEN** the argv names the generated agents file and the plugin directory
- **AND** the generated definition's prompt and disallowed tools equal the plugin worker's

#### Scenario: Failure — not adopted

- **GIVEN** a recorded probe showing no difference
- **WHEN** the adapter builds a worker spawn
- **THEN** the argv carries no agents file and the plugin agent is named as before

#### Scenario: Edge case — the parity pin

- **GIVEN** the workaround adopted and a later edit to the plugin worker's prompt
- **WHEN** the parity test runs
- **THEN** it fails until the generated definition matches again
