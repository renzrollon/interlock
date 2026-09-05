## Context

See proposal.md — Why. The constraints that shape the how:

- **The adapter is "prompt in, JSON out" and nothing else** (`lib/host/acp.mjs:1-10`). One agent process per spawn, one session, one prompt turn (`promptOnce`, `lib/host/acp.mjs:160-330`). Anything added must sit between `session/new` and `session/prompt` inside that one turn.
- **`spawn()` returns the agent's JSON object only** (`lib/host.mjs` `WorkflowHost.spawn`). Host metadata cannot ride on the result without polluting a schema the loop validates; the adapter already has an `onEvent` channel for telemetry (`lib/host/acp.mjs:170-178`), and the driver already prints from it under `--verbose`.
- **The banner string is a contract.** `MODEL ROUTING UNAVAILABLE (ACP host)` is asserted verbatim by `test/workflows.test.mjs` and documented in `docs/04-when-it-stops.md:204-208`. It may become conditional; it may not be reworded.
- **The fixture agent is the only agent `npm test` sees** (`test/fixtures/acp/agent.mjs`, `test/spine/acp-host.test.mjs:1-15`). Every new wire path must be provable against it; the live-agent test stays opt-in behind `INTERLOCK_ACP_COMMAND`.
- **Protocol facts this design relies on** (agentclientprotocol.com, "Session Config Options"; `claude-agent-acp` changelog): `session/new` and `session/load` responses may carry `configOptions: [{ id, name, category, type: 'select', currentValue, options: [{ value, name, description }] }]`; `session/set_config_option { sessionId, configId, value }` replies with the full option list; `session/set_model { sessionId, modelId }` is the legacy method some agents still accept. The Claude Code adapter's model option has id `model`, category `model`, and values like `haiku`, `sonnet`, `opus`.

No new library. Nothing to pin.

## Goals / Non-Goals

**Goals:**

- The planner's tier ladder is in effect on the ACP host whenever the agent can be told which model to use.
- A model that could not be applied is said aloud per spawn, with the reason, and never guessed.
- The adapter proves every path against the fixture agent; the live test stays opt-in.

**Non-Goals:**

- Setting the `mode` option (permission mode). The driver already answers permission requests mechanically; see D5.
- Changing the host port, the loop, or any `interlock` subcommand.
- Per-tier *effort* on ACP. No agent advertises an effort option consistently; effort keeps riding in `_meta` as a hint.
- Model negotiation on the Claude Code Workflow runtime, which already honours `model:` natively.

## Decisions

### D1 — Negotiate once per session, between `session/new` and `session/prompt`

`promptOnce` gains one step: read `configOptions` off the `session/new` result, and if `pickModelValue` (D2) finds a value for the requested slug, call `session/set_config_option { sessionId, configId, value }` before the prompt. Because every spawn is a fresh process and a fresh session, the option cannot leak between lanes and nothing has to be reset afterwards.

*Alternative rejected:* passing the model on the agent's command line (`claude --model`). That is one agent's flag, not a protocol, and the adapter would be back to special-casing binaries the way it already special-cases `--agent`.

### D2 — Slug mapping is exact, then substring, then an explicit map, never nearest

Given the planner slug (`haiku` | `sonnet` | `opus`), the advertised model option's `options[]`, and an optional map:

1. If the map names the slug, use that value; it must still be among the advertised values, otherwise it is reported as `mapped value not advertised` and not applied.
2. Else the option whose `value` equals the slug.
3. Else the first option whose `value` or `name` contains the slug case-insensitively (`claude-opus-4-6` matches `opus`).
4. Else not applied, reason `slug not among advertised values`.

`pickModelValue(slug, option, map)` is a pure exported function with table tests. The map comes from `INTERLOCK_ACP_MODEL_MAP`, a JSON object; a malformed value fails `createAcpHost` at startup rather than three waves in, matching `assertWorkflowHost`'s posture.

*Why never nearest:* a wrong model that ran is invisible in the summary; a banner is not.

### D3 — Fallback order is config option, then `session/set_model`, then not applied

If `session/set_config_option` returns a JSON-RPC error of any code, the adapter tries `session/set_model { sessionId, modelId: value }` once. If that errors too, the model is not applied, reason `set_config_option and set_model both failed`. If the agent advertises no model option at all, `session/set_model` is still attempted once with the raw slug (agents predating config options accept it), and a `-32601` there means reason `no model option advertised`. Every attempt is emitted as an event.

### D4 — The truth travels on events; the driver aggregates and the banner is conditional

The adapter emits `{ type: 'model-routing', label, requested, applied: boolean, via: 'set_config_option' | 'set_model' | null, value, reason }` per spawn that carried a model. `host.modelRouting` is the string `'negotiated'` (replacing the boolean `modelRoutingSupported: false`, whose meaning was "never"). The driver collects the events; at the summary it prints `MODEL ROUTING UNAVAILABLE (ACP host)` followed by `— <label>: <reason>` lines only when at least one `applied: false` was seen, and otherwise the note `model routing: applied on N/N spawns via ACP session config`. The `ACP HOST (experimental)` banner is unchanged.

### D5 — `mode` is left alone

The Claude adapter advertises a permission-mode option whose `bypassPermissions` value would remove the `session/request_permission` round trips the driver answers today. It is not set in this change: whether a PreToolUse guard's `deny` survives that mode is unverified, and `hooks/guard-tests.mjs` is the mechanism that stops a remediation agent weakening a test. Trading a known mechanism for an unverified shortcut is a follow-on with its own test, not a side effect here.

### D6 — The `_meta` hint stays

Removing it would regress agents that honour it and advertise nothing. It costs a few bytes per prompt.

## Risks / Trade-offs

- **An agent that echoes the full option list slowly.** `session/set_config_option` replies with every option; on a large list that is one extra round trip per spawn (~ms). Acceptable.
- **An agent that accepts the option and ignores it** (the Cursor ACP bug class). The adapter cannot detect this; the event says `applied: true` because the protocol said so. The summary note names the mechanism, not a guarantee, so a reader knows what was asserted.
- **Substring matching two values** (`sonnet` inside both `claude-sonnet-4` and `claude-sonnet-4-5`). First advertised wins, deterministically; an operator who cares sets the map.

## Migration Plan

Additive. Agents that advertise nothing produce today's banner with a reason attached. `host.modelRoutingSupported` is removed; its one reader is the driver and one test, both updated in this change.

## Open Questions

None that block. Whether to set `mode` (D5) is a follow-on.
