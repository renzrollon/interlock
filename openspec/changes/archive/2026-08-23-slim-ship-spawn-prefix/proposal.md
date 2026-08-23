## Why

Claude Code's workflow `agent()` starts a clean *conversation*, not a clean *prefix*. Every ship spawn inherits the parent tool catalog (~30k tokens of system and MCP schemas) and the Skill listing (~10k tokens of project, user, and plugin skill descriptions). A 24-task lean run is ~30 agents × ~40k = ~1.2M input tokens of overhead before any task prompt. `collapse-singleton-waves` reduces how many agents boot; this change reduces what each boot pays. Isolation today is clean of other *tasks*, not of the host catalog.

## What Changes

- **Two plugin agents.** `agents/ping.md` (Bash, Read, Write) for mechanical CLI pings. `agents/worker.md` (Read, Write, Edit, Grep, Glob, Bash) for implementers, plan-waves, verify, review, commit, handoff. Neither lists `Skill` or `Agent`. Both set `disallowedTools: Skill, Agent, mcp__*`. Bodies stay short; they replace the default Claude Code system prompt when the runtime honors the type.
- **Every `agent()` call dual-writes `type` and `tools`.** `cheap()` / `pingExtra` is `interlock:ping`. `step()` defaults and the implementer `pipeline()` are `interlock:worker`. An unknown key is ignored; an omitted tools list is the 40k floor.
- **Host port.** `SpawnRequest` carries optional `type` and `tools`. The ACP adapter prepends `--agent <type>` when the configured command is the Claude Code CLI. Other ACP agents ignore `type`. One process per task is unchanged.

No **BREAKING** CLI flags. Operator hygiene (disable unused MCP, prune `~/.claude/skills`) still helps the parent window; it is not the ship fix.

## Capabilities

### New Capabilities

- `ship/spawn-prefix`: Every workflow spawn names a plugin agent and passes a tools allowlist that excludes Skill, Agent, and MCP. Ping vs worker split as above.

### Modified Capabilities

- `workflow-host`: `SpawnRequest` includes optional `type` and `tools`. ACP MAY forward `--agent` when the command is Claude Code.

## Impact

- `agents/ping.md`, `agents/worker.md` — new plugin agents, auto-discovered next to `skills/` and `workflows/`.
- `workflows/ship.js` — `pingExtra` / `workerExtra` on every `agent()` call.
- `lib/host.mjs` — spawn prefix constants and `SpawnRequest` fields; `bin/interlock-ship-acp` passes them.
- `lib/host/acp.mjs` — `--agent` forwarding for Claude Code binaries.
- Tests: `test/workflows.test.mjs`, `test/spine/plugin-agents.test.mjs`, host/ACP tests.
- `docs/06-why-it-works.md`, CHANGELOG.

Out of scope: shrinking the parent session's skill listing; giving `ship.js` filesystem access; merging with `collapse-singleton-waves`; preloading Interlock skills into workers; passing `agentType` with a custom slug (built-in enum risk).
