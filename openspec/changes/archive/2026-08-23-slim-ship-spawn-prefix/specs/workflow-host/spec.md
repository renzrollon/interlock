## ADDED Requirements

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
