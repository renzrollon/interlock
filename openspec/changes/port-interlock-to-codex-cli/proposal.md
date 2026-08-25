## Why

Interlock's guarantees already live in `bin/interlock` and the pure modules under `lib/` — which wave runs next, whether a red suite blocks a commit, when a run halts. Exactly one thing is Claude Code–specific: *where the agents come from*. `lib/host.mjs` already isolates that seam into three functions and `lib/host/acp.mjs` already proves a second host fits behind it. But `README.md` still states plainly that this is a Claude Code plugin, and the one non-Claude host is an experimental ACP driver with **no model routing at all** (`modelRoutingSupported: false`) — so a Codex user today gets either nothing or a degraded run.

Codex is not merely another place to spawn an agent; its harness supplies two things Claude Code does not, and both fix known weaknesses in the ACP host. `codex exec --output-schema` enforces the result schema at the transport, retiring the `parseAgentJson` brace-scan recovery. And `codex exec --sandbox workspace-write` makes an unattended run structurally incapable of stopping on an approval prompt — the exact failure `README.md` currently mitigates with "allowlist the commands its agents use before a long ship run." Codex also exposes `model_reasoning_effort` as a second dial, so the planner's tier 1–5 ladder maps onto Codex with more fidelity than it does onto a three-slug Anthropic ladder.

## What Changes

- **New `lib/host/codex.mjs`** — a third implementation of the `lib/host.mjs` port (`spawn`, `mapPipeline`, `runCli`) backed by one `codex exec` subprocess per spawn. Schema enforcement via `--output-schema`, sandbox via `--sandbox workspace-write` plus `--add-dir`, model and effort via `-m` and `-c model_reasoning_effort=`, machine-readable progress via `--json`, final result via `-o`.
- **New `bin/interlock-ship-codex`** — the lean ship driver on that host (waves → verify → commit), structurally parallel to `bin/interlock-ship-acp`. It **refuses** `--strict`, `--review`, `--handoff` and `--conformance` with exit 2 rather than quietly shipping something smaller than what was asked for.
- **New host-neutral model routing.** `task.model` stops being an Anthropic slug. The plan carries a **tier-derived model class** (`cheap` | `standard` | `deep`), and each host resolves that class to its own concrete model. Claude Code resolves to `haiku` / `sonnet` / `opus`; Codex resolves to `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-5.6-terra` at ascending reasoning effort. **BREAKING** for any consumer reading `model` out of `plan.json`, `wave-state next`, or the run log expecting `haiku|sonnet|opus`.
- **New Codex authoring surface.** `AGENTS.md` at the repo root as the always-on instruction file, and `$CODEX_HOME/prompts/interlock-*.md` custom prompts mirroring `spec`, `explore`, `review-artifacts`, `ship` and `commit`, installed by a documented copy step. This is what makes the loop — not just ship — reachable from Codex.
- **`ship/spawn-prefix` becomes host-scoped.** The plugin-agent-plus-allowlist contract (`interlock:ping`, `interlock:worker`) is Claude Code's mechanism for a slim prefix. Codex has no plugin-agent concept, so the *requirement* becomes "a spawn MUST constrain its tool surface by its host's own mechanism" — sandbox mode, writable-path set and `--ignore-user-config` on Codex — rather than naming Claude Code's mechanism as the only one.
- **Docs stop saying Claude-only.** `README.md`, `docs/04-when-it-stops.md` and `docs/10-agentic-workflow-ship-and-spec.md` gain a host matrix stating exactly what runs where. `docs/10` currently lists "No `AGENTS.md` or `CLAUDE.md`" as a known gap; this closes half of it.
- **Not in scope:** `--strict` on Codex, a Codex plugin-marketplace manifest (`codex plugin add`), Cursor, Copilot, and Code Mode. Each is named as future work, not advertised as supported.

## Capabilities

### New Capabilities

- `codex-host`: The `codex exec` host adapter — argv construction, schema enforcement, sandbox and writable-path policy, per-spawn model and reasoning effort, timeout and failure semantics, and the rule that it may not reimplement wave ordering, verify judgement, caps or the review gate.
- `model-routing`: A host-neutral tier → model-class mapping, resolved to a concrete model (and, where the host supports it, a reasoning effort) by exactly one function per host. Covers the clamp, the lane's dispatch class, and the requirement that every reader consumes the canonical class rather than a raw slug.
- `codex-surface`: The Codex authoring and distribution surface — `AGENTS.md`, `$CODEX_HOME/prompts/interlock-*.md`, the install step, and the honest-degradation rule that a Codex invocation asking for an unsupported tail halts instead of silently running lean.

### Modified Capabilities

- `workflow-host`: Codex becomes a third host adapter behind the same three-function port. "Claude Code remains the default host" survives unchanged, but the requirement gains a clause that a new host MUST NOT be reachable from `/interlock:ship`, and the existing spawn `type`/`tools` requirement gains the Codex branch (a host with no plugin-agent concept honors the intent through its sandbox rather than ignoring the fields).
- `ship/spawn-prefix`: The requirement is restated so the tool-surface constraint is mandatory on every host while the *mechanism* is the host's own. Claude Code's plugin agents and allowlists stay exactly as specified; Codex's sandbox mode and writable-path set become the equivalent obligation.
- `ship/prompt-integrity`: Two requirements change. The classifier's assembled-prompt scenario stops asserting the literal string `haiku` and asserts the canonical model class instead, and the cross-host tier-policy comparison covers three drivers rather than two so a Codex driver cannot carry a divergent copy of classifier policy.

`waves` is deliberately **not** listed. The per-task `model` field's enum is enforced in `lib/waves.mjs` but no requirement in `openspec/specs/waves/spec.md` constrains it, so the class contract is an ADDED requirement under `model-routing` rather than a `waves` delta. Inventing a `waves` requirement to hold a value it never specified would move the contract away from the capability that owns it.

## Impact

**New files:** `lib/host/codex.mjs`, `bin/interlock-ship-codex`, `AGENTS.md`, `prompts/codex/interlock-*.md` (source for the `$CODEX_HOME/prompts` copy), `test/spine/codex-host.test.mjs`.

**Modified — the model invariant sweep.** `task.model` is a shared value read in nine places; every one moves to the canonical class or the port is half-done:
`lib/waves.mjs` (`MODELS` set, `clampModel`, plan validation, `laneModel`, plan build, plan preview, agent bill) · `bin/interlock` (`laneModelOf`, `wave-state next` payload) · `lib/run-log.mjs` (`model` field) · `workflows/ship.js` (`agent({ model })` and the classifier prompt's tier ladder, which names `haiku` as literal text) · `bin/interlock-ship-acp` (`laneModel` import, `_meta` slug) · `lib/host.mjs` (`SpawnRequest.model`, `spawnPrefix`) · `test/fixtures/prompts/implementer-lane-tier-*.txt` snapshots · `test/spine/waves.test.mjs`, `test/spine/cli.test.mjs`, `test/spine/plan-fingerprint.test.mjs`, `test/spine/run-log.test.mjs`, `test/helpers/ship-harness.mjs`.

**Modified — docs and packaging:** `README.md`, `CHANGELOG.md`, `docs/04-when-it-stops.md`, `docs/08-harness-landscape.md`, `docs/10-agentic-workflow-ship-and-spec.md`, `package.json` (`bin` entry for the new driver).

**Dependencies:** adds an *optional runtime* dependency on the `codex` CLI, pinned at `@openai/codex@0.149.0` as the minimum. Not an npm dependency — the driver shells out to it, exactly as it shells out to `openspec` and `git`. Claude Code installs are unaffected and gain no new requirement.

**Auth and cost:** the Codex host inherits whatever `codex login` established; Interlock stores no OpenAI credential and passes none. `gpt-5.6-terra` at `xhigh` effort on a tier-5 lane is the most expensive path this change can produce, and the plan preview's agent bill must say so before the run starts.

**Risk:** the model-class rename touches the plan schema, so a `plan.json` written by the current version and read by the new one is a fingerprint mismatch. `lib/plan-fingerprint.mjs` and `plan-reuse` must reject the stale plan rather than reuse it under a changed schema.
