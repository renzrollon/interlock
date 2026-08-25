## Purpose

Lets a ship run reach a model through the Codex CLI's non-interactive mode, using that harness's schema enforcement and sandbox instead of re-solving either, while keeping every halt decision in the `interlock` CLI where the other hosts already leave it.

## ADDED Requirements

### Requirement: The Codex host SHALL implement the shared spawn and CLI boundary and nothing more

The Codex host SHALL provide the same three ports every host provides: spawn of a single labeled agent given prompt, model and result schema; parallel spawn up to the width the planner already decided; and execution of the `interlock` CLI with the repo as its working directory. It SHALL branch on that CLI's exit codes and SHALL NOT reimplement wave ordering, verify judgement, caps, or the review gate. It SHALL spawn one fresh-context agent per lane and SHALL NOT implement a task in the driver process.

#### Scenario: Happy path — the next action comes from the CLI

- **GIVEN** a Codex-hosted run that has just finished a batch
- **WHEN** the driver needs the next action
- **THEN** the action, including any halt, comes from the `interlock` CLI's output and exit status
- **AND** the driver has computed no halt reason of its own

#### Scenario: Failure — a batch of three lanes is not implemented in-process

- **GIVEN** a next action of `run-batch` carrying three lanes
- **WHEN** the driver executes it
- **THEN** three separate Codex agents are started
- **AND** the driver process makes no edit to the repository itself

#### Scenario: Edge case — a red unit suite halts by exit status, not by a second copy of the rule

- **GIVEN** a verification whose unit suite is red
- **WHEN** the driver decides whether to continue
- **THEN** the decision is observed only through the `interlock` verify judgement's exit status
- **AND** no red-unit or typecheck rule is restated in the Codex host

### Requirement: A spawn expecting a schema SHALL enforce it at the transport

When a spawn carries a result schema, the Codex host SHALL constrain the agent's final message to that schema using the CLI's own schema mechanism rather than by asking for JSON in prose and recovering it afterwards. A final message that does not satisfy the schema SHALL be treated as a spawn that produced no result.

Rationale: this is the concrete advantage of this host over the ACP adapter, whose transport has no schema enforcement and which therefore must scan for a balanced object in free text.

#### Scenario: Happy path — a schema-carrying spawn returns a validated object

- **GIVEN** a spawn request with a result schema
- **WHEN** the agent completes its turn
- **THEN** the host returns an object satisfying that schema
- **AND** no prose-recovery scan of the agent's text was needed to obtain it

#### Scenario: Failure — an unsatisfiable turn yields no result rather than a partial object

- **GIVEN** a spawn whose agent ends its turn without producing a message matching the schema
- **WHEN** the host reads the result
- **THEN** the spawn resolves as having produced no result
- **AND** the `interlock` CLI, not the host, decides what that costs the run

#### Scenario: Edge case — a spawn carrying no schema is not given one

- **GIVEN** a spawn request with no result schema
- **WHEN** the host builds the invocation
- **THEN** no schema constraint is applied
- **AND** the agent's final message is returned as text without a validation failure being manufactured

### Requirement: Unattended runs SHALL be sandboxed to the workspace and SHALL NOT be able to prompt for approval

Every spawn the Codex host makes SHALL run under a sandbox mode that permits writes inside the repository and denies them outside it, except for directories the operator explicitly added. The host SHALL NOT use the CLI's bypass-all mode. A spawn SHALL be structurally unable to stop the run waiting for a human approval.

Rationale: a zero-touch run that can be blocked by an approval prompt is not zero-touch, and on this host the guarantee comes from the harness rather than from an operator's allowlist.

#### Scenario: Happy path — an agent writes inside the repo and is denied outside it

- **GIVEN** a Codex-hosted implementer lane operating in a repository
- **WHEN** the agent writes a file inside the repository and attempts a write outside it
- **THEN** the in-repo write succeeds
- **AND** the out-of-repo write is denied by the sandbox rather than by a prompt

#### Scenario: Failure — the bypass-all sandbox mode is refused

- **GIVEN** configuration that asks the Codex host to disable approvals and sandboxing entirely
- **WHEN** the driver starts
- **THEN** it halts naming the refused mode
- **AND** it does not start the wave loop in an unsandboxed state

#### Scenario: Edge case — an operator-added writable directory is honored and reported

- **GIVEN** an operator who has added one extra writable directory outside the repository
- **WHEN** a spawn is made
- **THEN** that directory is writable to the agent
- **AND** the run's own record names every writable path in effect, so the sandbox is auditable after the fact

### Requirement: The host SHALL dispatch a resolved model and reasoning effort per spawn

For each spawn, the Codex host SHALL resolve the lane's model class to a concrete Codex model and resolve the lane's tier to a reasoning effort, and SHALL pass both to the CLI. It SHALL NOT rely on the operator's ambient CLI configuration to supply either, and SHALL run each agent without loading that ambient configuration so a run is reproducible across machines.

#### Scenario: Happy path — class and tier both reach the invocation

- **GIVEN** a tier-5 lane whose model class is the deepest class
- **WHEN** the host builds the spawn
- **THEN** the invocation names the concrete model that class resolves to on this host
- **AND** it names the reasoning effort that tier 5 resolves to
- **AND** it does not inherit the model or effort from the operator's own configuration

#### Scenario: Failure — an unavailable model surfaces as a named halt

- **GIVEN** a resolved model that the operator's Codex authentication cannot reach
- **WHEN** the first spawn is attempted
- **THEN** the run halts naming the model and the authentication mode
- **AND** it does not silently continue on whatever model the CLI would otherwise pick

#### Scenario: Edge case — every mechanical ping runs on the cheapest class

- **GIVEN** the mechanical steps of a run that only execute CLI commands and write JSON files
- **WHEN** each is spawned
- **THEN** each is dispatched on the cheapest class at the lowest effort the host permits
- **AND** none is dispatched on the deepest class

### Requirement: A spawn that cannot produce a result SHALL fail closed within a bounded wall clock

A spawn SHALL be subject to a wall-clock budget. Exceeding it, failing to start, or exiting without a usable result SHALL all resolve as a spawn that produced no result, never as an exception that unwinds the run and never as an indefinite wait. The budget SHALL be a transport timeout only and SHALL NOT be presented among the caps the loop obeys.

#### Scenario: Happy path — a completed spawn is unaffected by the budget

- **GIVEN** a spawn that finishes well inside its wall-clock budget
- **WHEN** the host returns
- **THEN** the result is the agent's validated result
- **AND** no timeout is recorded

#### Scenario: Failure — a wedged agent is killed and reported

- **GIVEN** a spawned agent that stops producing output and never ends its turn
- **WHEN** the wall-clock budget elapses
- **THEN** the process is terminated and the spawn resolves as having produced no result
- **AND** the run's record names the label that timed out

#### Scenario: Edge case — a missing Codex CLI halts before any wave runs

- **GIVEN** an environment where the Codex CLI is absent or below the required minimum version
- **WHEN** the driver starts
- **THEN** it halts naming the requirement and the version it found
- **AND** it does not begin a run that would fail on every spawn
