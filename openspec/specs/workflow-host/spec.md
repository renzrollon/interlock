# workflow-host Specification

## Purpose

Lets Interlock run as a workflow on more than one agent host by fixing the spawn and CLI boundary, without replacing the ship loop or turning the plugin into a generic orchestrator.

## Requirements

### Requirement: Hosts share a spawn and CLI boundary

A workflow host MUST provide: (1) spawn of a single labeled agent given prompt, model, and result schema; (2) parallel spawn up to the planner's batch width; (3) execution of the `interlock` CLI with the repo as cwd. The host MUST branch on that CLI's exit codes for `validate`, `wave-state`, `verify`, `gate`, and `ready`. The host MUST NOT reimplement wave ordering, verify judgement, limits, or the review gate in host-specific code.

#### Scenario: Fake host drives a batch through the CLI

- **WHEN** a test host that cannot talk to a model is asked to record a two-task batch against a real `interlock wave-state` binary
- **THEN** the next step still comes from the CLI JSON, and the host has not computed halt reasons itself

#### Scenario: Host-specific verify judgement is forbidden

- **WHEN** a host implementation is reviewed or tested for policy duplication
- **THEN** red-unit / typecheck halt behaviour is only observed via `interlock verify judge` exit status, not via a second copy of those rules in the host

### Requirement: Claude Code remains the default host

`/interlock:ship` MUST keep launching `workflows/ship.js` on the Claude Code Workflow runtime. When that runtime is unavailable, the trampoline MUST halt and MUST NOT implement the loop in the parent conversation. Default 0.x installs MUST NOT switch users onto ACP without an explicit invocation.

#### Scenario: Missing Workflow tool still halts

- **WHEN** a user runs `/interlock:ship` on a surface with no Workflow tool
- **THEN** the skill stops, explains the version/workflow requirement, and does not start implementing tasks inline

#### Scenario: ACP is opt-in

- **WHEN** a user runs `/interlock:ship` with no ACP flags in a working Claude Code session
- **THEN** the run uses `workflows/ship.js` and does not start an ACP session

### Requirement: ACP is a second host adapter

The system MUST offer an Agent Client Protocol (ACP) driver that implements the same spawn/CLI boundary and drives the same `interlock` subcommands as the workflow script. The ACP driver MAY `import()` Node modules. It MUST NOT rewrite Interlock as Cordis, a plugin bus, or a dsh session host. It MUST spawn one agent per task (fresh context) rather than implementing tasks in the driver process.

#### Scenario: ACP driver shells out to interlock

- **WHEN** the ACP driver needs the next wave action
- **THEN** it runs `interlock wave-state next` (or record with `--write-state`) and obeys the returned `action`, including `halt`

#### Scenario: ACP driver does not inline implementation

- **WHEN** the next action is `run-batch` with three tasks
- **THEN** the driver spawns three ACP agents with the implementer prompt and does not edit the repo itself

### Requirement: Code Mode is out of scope

This change MUST NOT add a Code Mode host, a Code Mode runtime, or a requirement that ship run inside Code Mode. Documentation MUST list Code Mode as future work contingent on Interlock owning a runtime.

#### Scenario: Docs do not advertise Code Mode ship

- **WHEN** a reader opens the README or the host design notes shipped with this change
- **THEN** Code Mode is named only as out of scope or future, not as a supported ship host

### Requirement: Spawn requests may name a plugin agent and a tools allowlist

A `SpawnRequest` MUST accept optional `type` (plugin agent id) and `tools` (tools allowlist) in addition to `label`, `prompt`, `model`, and `schema`. A host MUST record those fields when present. A host that cannot honor them MUST still spawn with a fresh context per task and MUST NOT implement the task in the driver process. The Claude Code workflow runtime honors them by passing them through to `agent()`. The ACP adapter MUST prepend `--agent <type>` to the subprocess argv when the configured command is the Claude Code CLI (`claude` or `claude-code`) and `type` is set, unless the command already contains `--agent`. Other ACP commands MUST ignore `type` and keep their configured argv.

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