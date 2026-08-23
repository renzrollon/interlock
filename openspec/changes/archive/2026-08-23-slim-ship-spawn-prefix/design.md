## Context

See `proposal.md`. Constraints:

- `workflows/ship.js` still cannot `import()`, touch `fs`, or run a shell. The four spawn-prefix literals are restated next to `agent()` and pinned equal to `lib/host.mjs` by test.
- Named plugin agents live at the plugin root (`agents/`), auto-discovered. They are not for `@`-mention from chat; descriptions say so.
- Isolation stays one agent per task. This change slims the prefix, it does not inline work into the orchestrator.
- `collapse-singleton-waves` is a sibling: it cuts spawn *count*. This cuts spawn *weight*. Do not merge them.

## Goals / Non-Goals

**Goals:**

- Every ship spawn passes `type` + `tools` so the inherited catalog is not the default.
- Ping vs worker split matches the mechanical / judgement split already in `cheap()` vs `step()`.
- ACP forwards `--agent` for Claude Code binaries only.
- Tests catch a spawn that drops `tools` without needing a live Claude Code session.

**Non-Goals:**

- Shrinking the parent session's 10k skill listing (user + plugin + project skills in the Skill tool).
- Giving `ship.js` filesystem access so pings are not agents.
- Passing `agentType` with a custom slug (built-in enum risk).
- Preloading Interlock skills into workers; the implementer prompt is the contract.
- Merging with `collapse-singleton-waves`.

## Decisions

### D1 — Dual-write `type` and `tools`; do not pass `agentType`

Documented `agent()` options: `label`, `phase`, `schema`, `model` ([workflows cookbook](https://code.claude.com/docs/en/workflows)). The same docs' prompt-cache fingerprint also names **agent type** and **tools**. Community write-ups use `agentType` and warn that custom `.claude/agents/` types may be ignored by workflow `agent()`. GitHub [anthropics/claude-code#63762](https://github.com/anthropics/claude-code/issues/63762) (closed stale 2026-07) reported that workflow spawns ignored a named agent's `tools:` allowlist and asked for `tools` on the `agent()` call itself.

**Resolution.** Pass `type: 'interlock:ping' | 'interlock:worker'` (plugin-scoped id, also the ACP `--agent` value) and `tools: [...]`. Do **not** pass `agentType` with those slugs: if the runtime enums built-in types only (`Explore`, `Plan`, `general-purpose`), a custom value fails the spawn closed (`null`), which is worse than an ignored key. `tools` on the call is the script-side request from #63762. Unknown keys are ignored.

A live `/interlock:ship` token view was not available in the implementation session. Operator confirmation: a ping's first-request input in `/workflows` should drop from tens of thousands toward the CLI prompt. If it does not, the runtime is still ignoring `tools` and the next lever is host-side, not more prompt text.

### D2 — Two agents, not five

Ping = `cheap()` (Bash, Read, Write). Worker = everything else, including validate (`step()`, not `cheap()`, because it uses a different schema). Fewer types share a cache prefix among siblings. Reviewers get Write/Edit they rarely need; that is cheaper than a third prefix and a third cache write.

### D3 — Plugin agents still ship even if workflow `type` is ignored

ACP `claude --agent interlock:ping` is the path that actually replaces the Claude Code system prompt today ([subagents docs](https://code.claude.com/docs/en/sub-agents)). Workflow `agent()` may only honor `tools`. Both files earn their keep.

### D4 — CLAUDE.md does not ride along

Named agents receive the markdown body plus environment, not the full Claude Code system prompt and not project CLAUDE.md. Intended: the implementer prompt plus artifact reads are the contract. Do not inject CLAUDE.md into workers.

## Risks / Trade-offs

- **[Runtime ignores `tools`] →** Dual-write; ACP `--agent` still slims Claude Code ACP. Document the `/workflows` check. Do not pretend a unit test can see the billed prefix.
- **[Custom `type` fails the spawn] →** Using `type` not `agentType`. If a live run returns null on the first ping, drop `type` and keep `tools`.
- **[Claude auto-invokes ping/worker from chat] →** Descriptions start with "Never invoke from a user conversation".
- **[npx / wrapper ACP commands skip --agent] →** Honest. Only `claude` and `claude-code` binaries get the flag.

## Migration Plan

- No state-file bump. In-flight `state.json` is unaffected.
- Operators: `/reload-plugins` (or restart Claude Code) so `agents/` is picked up. Plugin agent changes do not hot-reload.
