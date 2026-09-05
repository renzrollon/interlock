# workflow-host Specification

## Purpose

Lets Interlock run as a workflow on more than one agent host by fixing the spawn and CLI boundary, without replacing the ship loop or turning the plugin into a generic orchestrator.

## Requirements

### Requirement: Hosts share a spawn and CLI boundary

A workflow host MUST provide: (1) spawn of a single labeled agent given prompt, model, and result schema; (2) parallel spawn up to the planner's batch width; (3) execution of the `interlock` CLI with the repo as cwd. A host MUST obtain every step of a run — including every agent briefing, its model, effort, agent type, tools and result schema, and the argv to call next — from `interlock run`, and MUST branch on that CLI's exit codes and step records alone. The host MUST NOT reimplement wave ordering, verify judgement, limits, the review gate, briefing assembly or loop control in host-specific code.

#### Scenario: Fake host drives a batch through the CLI

- **WHEN** a test host that cannot talk to a model is asked to record a two-task batch against a real `interlock wave-state` binary
- **THEN** the next step still comes from the CLI JSON, and the host has not computed halt reasons itself

#### Scenario: Host-specific verify judgement is forbidden

- **WHEN** a host implementation is reviewed or tested for policy duplication
- **THEN** red-unit / typecheck halt behaviour is only observed via `interlock verify judge` exit status, not via a second copy of those rules in the host

#### Scenario: Happy path — a fake host interprets a whole lean run from step records

- **GIVEN** a test host whose spawn returns canned results and whose CLI is the real binary
- **WHEN** it starts at `interlock run start` and follows each step's `then.argv` until the continuation is null
- **THEN** the run reaches `close` with a summary, and the host's own code contains no reference to any action name, flag or verdict

#### Scenario: Failure — a host that hardcodes the next command is caught

- **GIVEN** a host that calls `run record-batch` after a batch without reading the step's `then.argv`
- **WHEN** a step whose continuation is `run judge` is emitted
- **THEN** the host's call is rejected by the CLI as out of sequence with a reason naming the expected continuation

### Requirement: Claude Code remains the default host

`/interlock:ship` MUST keep launching `workflows/ship.js` on the Claude Code Workflow runtime. When that runtime is unavailable, the trampoline MUST halt and MUST NOT implement the loop in the parent conversation. Default 0.x installs MUST NOT switch users onto the runner or any of its adapters without an explicit invocation of `interlock-run`, and the runner MUST refuse the Workflow host id. The documentation MUST state the reason the Workflow runtime stays the default: inside an interactive session it is the path exempted from Anthropic's paused programmatic-use billing change, while the runner is the flagged path and says so.

#### Scenario: Missing Workflow tool still halts

- **WHEN** a user runs `/interlock:ship` on a surface with no Workflow tool
- **THEN** the skill stops, explains the version/workflow requirement, and does not start implementing tasks inline

#### Scenario: ACP is opt-in

- **WHEN** a user runs `/interlock:ship` with no ACP flags in a working Claude Code session
- **THEN** the run uses `workflows/ship.js` and does not start an ACP session

#### Scenario: Happy path — the runner is never started by the skill

- **GIVEN** a Claude Code session with the plugin installed and the runner on PATH
- **WHEN** the user runs `/interlock:ship`
- **THEN** the skill launches the Workflow and never invokes `interlock-run`
- **AND** the README names the billing exemption as the reason the default stays

### Requirement: ACP is a second host adapter

The system MUST offer an Agent Client Protocol (ACP) adapter for the runner that implements the same spawn/CLI boundary and interprets the same step records as the workflow script and every other adapter. The ACP adapter MAY `import()` Node modules. It MUST NOT rewrite Interlock as Cordis, a plugin bus, or a dsh session host. It MUST spawn one agent per lane (fresh context) rather than implementing tasks in the driver process, and under isolation MUST create each session with the lane's worktree as its cwd.

#### Scenario: ACP driver shells out to interlock

- **WHEN** the ACP adapter needs the next wave action
- **THEN** the runner runs `interlock run next` (or the step's continuation) and obeys the returned `action`, including `halt`

#### Scenario: ACP driver does not inline implementation

- **WHEN** the next action is `run-batch` with three lanes
- **THEN** the runner spawns three ACP agents with the lane briefings and does not edit the repo itself

#### Scenario: Happy path — the runner selects the ACP adapter

- **GIVEN** `interlock-run <change> --host acp` with `INTERLOCK_ACP_COMMAND` set
- **WHEN** the run starts
- **THEN** the ACP adapter is created from the registry and the manifest records `host.id = acp` with `modelSelect: negotiated`

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

### Requirement: Every host SHALL run the strict tail from the same step records, and no host SHALL refuse a tail flag

A host driver MUST pass the review, handoff, conformance and strict flags to `interlock run start` and MUST interpret the `review`, `remediate` and `handoff` steps exactly as it interprets a batch step: spawn what the step names, write the results, call the continuation. A host MUST NOT exit with a not-supported code for any tail flag, and MUST NOT carry its own review, remediation or handoff text.

#### Scenario: Happy path — the ACP driver runs a strict run

- **GIVEN** `interlock-run <change> --host acp --strict` with an agent that returns canned review counts
- **WHEN** the driver runs
- **THEN** it reaches the `review`, `remediate` and `handoff` steps and closes with exit code `0` or `1` from the run's own verdict
- **AND** it never exits `2`

#### Scenario: Failure — a driver that still refuses is caught

- **GIVEN** a driver containing a refusal branch for `--strict`
- **WHEN** the driver test passes `--strict`
- **THEN** the test fails because the exit code is `2`

#### Scenario: Edge case — a tail flag on a host whose agent cannot review

- **GIVEN** an ACP agent that returns no findings file for the `review` step
- **WHEN** `run reviewed` runs
- **THEN** the review is recorded as not completed with the reason, the run continues to final verification as it does on the Workflow runtime today, and the summary names the incomplete review

### Requirement: The ACP adapter SHALL apply the planner's model through session configuration when the agent advertises it

For every spawn that carries a model slug, the ACP adapter MUST inspect the `configOptions` returned by `session/new`, MUST select an advertised value for the slug by exact value, then case-insensitive substring of value or display name, then an operator-supplied map, and MUST apply it with `session/set_config_option` before `session/prompt`, falling back to `session/set_model` once on error. The adapter MUST NOT choose a nearest or default model when no rule matches. The adapter MUST report per spawn whether the model was applied, by which method, and if not, why. The driver MUST print `MODEL ROUTING UNAVAILABLE (acp)` only when at least one spawn that requested a model was not applied, naming each such spawn and its reason, and MUST otherwise state that routing was applied. The `_meta['interlock/model']` hint MUST keep travelling.

#### Scenario: Happy path — the agent advertises a model option and the planner's slug is applied

- **GIVEN** an ACP agent whose `session/new` response advertises a `model` select with values `haiku`, `sonnet` and `opus`
- **WHEN** the adapter spawns a lane whose planner model is `sonnet`
- **THEN** the adapter calls `session/set_config_option` with `configId: "model"` and `value: "sonnet"` before `session/prompt`
- **AND** the spawn's routing event reports `applied: true` and `via: "set_config_option"`
- **AND** the run summary does not contain `MODEL ROUTING UNAVAILABLE (acp)`

#### Scenario: Failure — the agent advertises no model option and rejects the legacy method

- **GIVEN** an ACP agent whose `session/new` response carries no `configOptions` and whose `session/set_model` returns JSON-RPC error `-32601`
- **WHEN** the adapter spawns a lane whose planner model is `haiku`
- **THEN** the prompt still runs and the spawn returns the agent's result
- **AND** the spawn's routing event reports `applied: false` with reason `no model option advertised`
- **AND** the run summary contains `MODEL ROUTING UNAVAILABLE (acp)` followed by a line naming that spawn's label and reason

#### Scenario: Edge case — the advertised values share no text with the slug

- **GIVEN** an ACP agent whose model option advertises values `gpt-a` and `gpt-b` and no display name containing `sonnet`
- **AND** `INTERLOCK_ACP_MODEL_MAP` is unset
- **WHEN** the adapter spawns a lane whose planner model is `sonnet`
- **THEN** no `session/set_config_option` call is made for the model
- **AND** the routing event reports `applied: false` with reason `slug not among advertised values`
- **AND** when `INTERLOCK_ACP_MODEL_MAP` is set to `{"sonnet":"gpt-b"}` the adapter applies `gpt-b` and reports `applied: true`
