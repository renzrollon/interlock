## Why

`bin/interlock-ship-acp` prints `MODEL ROUTING UNAVAILABLE (ACP host)` on every run, because when the adapter was written ACP v1 had no per-prompt model selector: the planner's slug travels only as `_meta['interlock/model']`, a hint an agent may ignore (`lib/host/acp.mjs:354-359`, `docs/04-when-it-stops.md:204-208`). The tier ladder — haiku pings, sonnet implementers, opus only at tier 5 — is the cost story, and on the second host it is not in effect.

ACP has since standardised session configuration: `session/new` may return `configOptions`, and `session/set_config_option` sets one; the Claude Code ACP adapter advertises a `model` option (values such as `haiku`, `sonnet`, `opus`) and a `mode` option, `codex-acp` advertises a model option, and the older `session/set_model` method is still accepted by several agents. The gap is closable inside the adapter with no change to the host contract or to the loop.

## What Changes

- **Negotiate the model per session.** After `session/new`, the adapter reads the advertised `configOptions`; when one is a model selector, it maps the planner's slug onto one of the advertised values and calls `session/set_config_option` before `session/prompt`. On a JSON-RPC error it falls back to `session/set_model`. The `_meta` hint keeps travelling for agents that honour it.
- **Deterministic slug mapping, never a guess.** An advertised value is chosen only by exact match, then by case-insensitive substring of the value or its display name; an optional `INTERLOCK_ACP_MODEL_MAP` JSON maps `haiku`/`sonnet`/`opus` to explicit values for agents whose model ids share no text with the slugs. No match means not applied — a silently wrong model is worse than the banner.
- **The banner becomes conditional and specific.** `MODEL ROUTING UNAVAILABLE (ACP host)` keeps its verbatim string and prints only when at least one spawn that asked for a model could not have it applied, naming the labels and the reason. A run on which every model was applied prints a summary note saying so.
- **The `mode` option is left untouched.** The driver keeps answering `session/request_permission` itself.
- **The fixture agent grows modes** that advertise config options, accept only `session/set_model`, or reject both, so every path is proven without a live agent.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `workflow-host`: gains a requirement that the ACP adapter apply the planner's model through session configuration when the agent advertises it, and report per spawn whether it did.

## Impact

- **Code**: `lib/host/acp.mjs` (config-option negotiation, `pickModelValue`, `parseModelMap`, `model-routing` events, `modelRouting: 'negotiated'` replacing `modelRoutingSupported: false`), `bin/interlock-ship-acp` (aggregate the events, conditional banner, summary note), `test/fixtures/acp/agent.mjs` (new modes).
- **Tests**: `test/spine/acp-host.test.mjs`, `test/workflows.test.mjs` (the banner string stays pinned; a driver-level test proves the banner is absent on a fixture that applies the model and present on one that cannot).
- **Docs**: `docs/04-when-it-stops.md` banner section, `README.md` Experimental bullet, `CHANGELOG.md`.
- **Dependencies**: none. No new library; nothing to pin.
- **Compatibility**: agents that advertise nothing behave exactly as today, banner included. Independent of every other change in flight.
