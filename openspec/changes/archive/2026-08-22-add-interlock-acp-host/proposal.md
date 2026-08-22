## Why

Interlock's guarantees come from a Claude Code dynamic workflow (`workflows/ship.js` + plugin `Workflow()` trampoline). `.docs/COMPETITIVE-ANALYSIS.md` already calls Claude-Code-only the strategic P0 exposure: Spec Kit has 30+ hosts; Interlock scores near the bottom on portability. DeepSeek-harness shows ACP can host agents without becoming Cordis. This change adds ACP as a **second host adapter** so the spawn/CLI boundary is host-agnostic, while the ship loop, caps, and gates stay Interlock's.

## What Changes

- Define a **workflow host contract** at the spawn and CLI boundary: spawn one labeled agent with prompt/model/schema; run `interlock` and branch on exit codes. Hosts MUST NOT reimplement `wave-state`, `verify`, `limits`, or `gate`.
- Keep the Claude Code dynamic workflow as the **default host**. `skills/ship/SKILL.md` still launches `workflows/ship.js` and still halts when the Workflow tool is missing (no conversational fallback).
- Add an **ACP adapter** (Agent Client Protocol) as a second host: a Node driver that can `import()`, execs the same CLI, and spawns agents over ACP. This is an adapter, not a rewrite of Interlock into Cordis or dsh.
- Document **Code Mode as out of scope / future** unless Interlock owns a runtime — it does not today.
- Do **not** block inspectability or wave-handoff changes on this host work. Those land on the CLI/`ship.js` path independently.

## Capabilities

### New Capabilities

- `workflow-host`: How Interlock is hosted — Claude Code workflow today, ACP as a second adapter, host-agnostic spawn/CLI boundary. New because `openspec/specs/` has no portability/host capability.

### Modified Capabilities

- (none — `openspec/specs/` has no existing capabilities; do not wait on `ship-run` / `waves` from sibling changes)

## Impact

- New host-contract module and fake-host tests (no live ACP server required for CI).
- New ACP driver entry (Node, may `import()` — unlike `ship.js`).
- `bin/interlock` unchanged as the policy engine; any host shells out to it.
- Docs: README portability sentence, `docs/04-when-it-stops.md` (ACP host vs Workflow missing), `.docs/COMPETITIVE-ANALYSIS.md` P0 note that the bet is now a second host rather than an apology.
- Out of scope: Cordis, plugin-everything, replacing `ship.js` with a dsh orchestrator, Code Mode, leaving OpenSpec, making ACP the default in 0.x.
