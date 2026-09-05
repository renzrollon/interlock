## MODIFIED Requirements

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
