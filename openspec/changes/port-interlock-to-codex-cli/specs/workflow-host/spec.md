## MODIFIED Requirements

### Requirement: Claude Code remains the default host

`/interlock:ship` MUST keep launching `workflows/ship.js` on the Claude Code Workflow runtime. When that runtime is unavailable, the trampoline MUST halt and MUST NOT implement the loop in the parent conversation. Default 0.x installs MUST NOT switch users onto ACP or Codex without an explicit invocation. No slash command MUST start a non-default host, and adding a host MUST NOT add a reachable path from `/interlock:ship` to that host — a non-default host is invoked by the user from a terminal, as its own binary.

#### Scenario: Missing Workflow tool still halts

- **WHEN** a user runs `/interlock:ship` on a surface with no Workflow tool
- **THEN** the skill stops, explains the version/workflow requirement, and does not start implementing tasks inline

#### Scenario: ACP is opt-in

- **WHEN** a user runs `/interlock:ship` with no ACP flags in a working Claude Code session
- **THEN** the run uses `workflows/ship.js` and does not start an ACP session

#### Scenario: Failure — a missing Workflow tool does not fall back to Codex

- **GIVEN** a Claude Code surface with no Workflow tool and a working Codex CLI on PATH
- **WHEN** a user runs `/interlock:ship`
- **THEN** the skill halts on the workflow requirement
- **AND** it does not start the Codex driver as a substitute

#### Scenario: Edge case — a third host does not become reachable from the slash command

- **WHEN** the set of paths by which `/interlock:ship` can reach a host is enumerated
- **THEN** the only one is the Claude Code Workflow runtime
- **AND** neither the ACP driver nor the Codex driver appears among them

### Requirement: Spawn requests may name a plugin agent and a tools allowlist

A `SpawnRequest` MUST accept optional `type` (plugin agent id) and `tools` (tools allowlist) in addition to `label`, `prompt`, `model`, and `schema`. A host MUST record those fields when present. A host that cannot honor them MUST still spawn with a fresh context per task, MUST NOT implement the task in the driver process, and MUST constrain the agent's tool surface by whatever mechanism its own harness provides rather than treating the fields as satisfied by being recorded. The Claude Code workflow runtime honors them by passing them through to `agent()`. The ACP adapter MUST prepend `--agent <type>` to the subprocess argv when the configured command is the Claude Code CLI (`claude` or `claude-code`) and `type` is set, unless the command already contains `--agent`. Other ACP commands MUST ignore `type` and keep their configured argv. The Codex adapter MUST NOT invent a plugin agent id; it honors the intent through its sandbox mode, its writable-path set, and by not loading the operator's ambient configuration.

#### Scenario: Happy path — Claude Code ACP spawn forwards --agent

- **GIVEN** `INTERLOCK_ACP_COMMAND` is `claude --acp` and a spawn request has `type: interlock:ping`
- **WHEN** the ACP host starts the agent process
- **THEN** the argv includes `--agent` `interlock:ping` before the existing `--acp`
- **AND** the spawn is still one process and one session

#### Scenario: Failure — a non-Claude ACP command is not rewritten

- **GIVEN** `INTERLOCK_ACP_COMMAND` is `npx some-acp-agent --acp` and a spawn request has `type: interlock:worker`
- **WHEN** the ACP host starts the agent process
- **THEN** argv is unchanged from the parsed command
- **AND** `--agent` is not inserted

#### Scenario: Edge case — an operator --agent flag is not overridden

- **GIVEN** `INTERLOCK_ACP_COMMAND` is `claude --agent other --acp` and a spawn request has `type: interlock:ping`
- **WHEN** the ACP host starts the agent process
- **THEN** the existing `--agent` is kept
- **AND** `interlock:ping` is not inserted as a second `--agent`

#### Scenario: Edge case — a host with no plugin-agent concept still constrains the tool surface

- **GIVEN** a spawn request carrying `type` and `tools` dispatched on a host whose harness has no plugin-agent concept
- **WHEN** the spawn is made
- **THEN** the agent runs with a tool surface constrained by that host's own mechanism
- **AND** the spawn is not treated as compliant merely because `type` and `tools` were recorded

## ADDED Requirements

### Requirement: The Codex CLI is a third host adapter

The system MUST offer a Codex host that implements the same spawn/CLI boundary and drives the same `interlock` subcommands as the workflow script and the ACP driver. The Codex adapter MAY `import()` Node modules and MAY do mechanical work — writing plan files, appending trajectory events, assembling a verify result — with no model in the loop, exactly as the ACP driver may. It MUST spawn one agent per lane with a fresh context and MUST NOT implement a lane in the driver process. It MUST NOT rewrite Interlock as a runtime, a plugin bus or a session host, and MUST NOT grow a second copy of wave ordering, verify judgement, cap or gate logic.

#### Scenario: Happy path — the Codex driver shells out to interlock for the next action

- **WHEN** the Codex driver needs the next wave action
- **THEN** it runs the CLI's wave-state query and obeys the returned action, including a halt
- **AND** it does not derive the action from the model's output

#### Scenario: Failure — the driver does not implement a batch itself

- **GIVEN** a next action of `run-batch` with two lanes
- **WHEN** the driver executes it
- **THEN** two Codex agents are spawned with the implementer prompt
- **AND** the driver process edits no file in the repository

#### Scenario: Edge case — a test host proves the halt came from the CLI

- **GIVEN** a test host that cannot reach a model but runs the real `interlock` binary
- **WHEN** it records a batch whose accumulated failures exhaust the budget
- **THEN** the halt is observed through the CLI's exit status
- **AND** no halt condition is evaluated inside the host
