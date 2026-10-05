## ADDED Requirements

### Requirement: A forced subagent model SHALL be recorded as the observed model-selection kind `forced`

The legal values of the model-selection capability SHALL gain `forced`: an environment variable forces one model onto every spawned agent, so the per-spawn channel the host otherwise offers is ignored. No adapter MAY declare `forced`; the registry test SHALL fail an adapter that does. The value SHALL be observed only by `interlock run start` on the Workflow host, when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set and the host version is at or above the version that introduced the variable or cannot be read, and SHALL be recorded on the run manifest in place of the assumed kind. A run on a runner host SHALL keep the model-selection kind its adapter declared, because its lanes are separate processes whose top-level model the variable does not govern.

#### Scenario: Happy path — FORCE on the Workflow host refines the manifest

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the manifest's host records model selection `forced`
- **AND** `forced` is among the registry's legal values for that capability

#### Scenario: Failure — an adapter that declares the observed-only value is caught

- **GIVEN** an adapter registered with model selection `forced`
- **WHEN** the registry test sweeps every adapter's declared capabilities
- **THEN** it fails naming the adapter and the capability

#### Scenario: Edge case — the runner's host keeps its declaration

- **GIVEN** `interlock-run <change> --host claude` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` in the environment
- **WHEN** the run starts
- **THEN** the manifest's host records the model selection the adapter declared
- **AND** no `forced` value is recorded

### Requirement: The runner SHALL close the run when it receives SIGINT or SIGTERM

`interlock-run` SHALL trap `SIGINT` and `SIGTERM` and route each through its existing halting close exactly once, so a killed runner leaves a receipt, a terminal trajectory event and a resume card like any other halt. A second signal during the close SHALL NOT start a second close. A signal that arrives before the run program has returned its first step SHALL still reach the close, which reports that no manifest exists and exits non-zero.

#### Scenario: Happy path — SIGTERM during a lane leaves a receipt and a card

- **GIVEN** a runner with a lane in flight on a fixture host that holds its answer
- **WHEN** the runner process receives `SIGTERM`
- **THEN** the trajectory carries a `run-halt` whose reason names the signal
- **AND** a resume card is written and the runner exits non-zero

#### Scenario: Failure — a second signal during the close is ignored

- **GIVEN** a runner that has begun its close after `SIGINT`
- **WHEN** it receives `SIGTERM` before the close returns
- **THEN** exactly one close runs and exactly one `run-halt` is recorded

#### Scenario: Edge case — a signal before the first step still closes truthfully

- **GIVEN** a runner that receives `SIGTERM` before `run start` has returned
- **WHEN** the close runs
- **THEN** it reports that there is no run manifest and nothing was recorded
- **AND** the runner exits non-zero
