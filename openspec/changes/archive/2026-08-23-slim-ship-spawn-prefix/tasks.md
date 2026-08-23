A `## N.` boundary here is a **dependency boundary**: groups run in order, tasks in one group are independent and may run in parallel.

## 1. Plugin agents and spawn prefix

- [x] 1.1 Add `agents/ping.md` and `agents/worker.md` with slim `tools`, no Skill/Agent, `disallowedTools` including `mcp__*`. Bodies stay short and tell the agent not to invoke skills or spawn children.
- [x] 1.2 Export `PING_AGENT`, `WORKER_AGENT`, `PING_TOOLS`, `WORKER_TOOLS`, and `spawnPrefix(kind)` from `lib/host.mjs`. Extend `SpawnRequest` with optional `type` and `tools`.
- [x] 1.3 Dual-write `type` + `tools` on every `agent()` in `workflows/ship.js`: `pingExtra` for `cheap()`, `workerExtra` as `step()` default and on the implementer `pipeline()`. Mutating `pingExtra.model` must not drop `type`/`tools`.
- [x] 1.4 ACP: `spawnArgsForAgent` prepends `--agent <type>` only for `claude` / `claude-code` binaries when `type` is set and `--agent` is not already present. `createAcpHost` uses it. `bin/interlock-ship-acp` spreads `spawnPrefix(kind)` onto every spawn.

## 2. Tests and docs

- [x] 2.1 `test/spine/plugin-agents.test.mjs`: agent files exist, frontmatter tools match host constants, disallowedTools includes mcp__*, ship.js literals equal host constants, every `agent()` in ship.js includes type and tools, pingExtra is ping, implementer call is worker, neither tools list contains Skill or Agent.
- [x] 2.2 Host/ACP tests: fake spawn records `type`/`tools`; `isClaudeCodeBinary` / `spawnArgsForAgent` cover Claude Code forward, non-Claude ignore, existing `--agent` kept; one-session-per-task still holds.
- [x] 2.3 `docs/06-why-it-works.md` names the prefix floor and the two agents. CHANGELOG entry under Unreleased.
