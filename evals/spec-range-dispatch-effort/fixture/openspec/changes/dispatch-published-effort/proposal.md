## Why

`lib/limits.mjs` publishes the effort the adversarial steps run at, `interlock limits` prints it, and the `effort-routing` spec requires it. The verify step does not get it: `lib/run.mjs` emits the verify spawn with `effort: null`, and nothing anywhere reads `EFFORT.verify`. The step whose job is catching what an implementer missed runs at whatever the host happens to default to, and the hosts do not default alike. Opus 5.5 defaults to `medium`, Sonnet 5.5 to `high`.

The runner has the same gap one level down. `bin/interlock-run` drops the `effort` every step already carries, no adapter could apply one if it arrived, and nothing banners the difference from the Workflow host. That is a silent degradation. An operator who exports `CLAUDE_CODE_EFFORT_LEVEL` overrides every effort the plan assigned, on either host, and nothing says so.

The spec is also behind the code. It still requires a `laneEffort` mirror in `workflows/ship.js` that was deleted, while a test pins the mirror's absence.

Effort is the primary cost dial on the 5.5 models, so this change comes before any retune: it makes the published table reach the agent. It does not edit the table.

Source: `briefs/claude-5-5-improvement-briefs.md`, Brief 1. Discovery: `.claude/handoff/explore-dispatch-published-effort-20260930-222029.md`.

## What Changes

- **Both verify spawns carry the published verify effort.** The inter-wave check and the final check are emitted by one site; both read `EFFORT.verify`. The level is never written at the call site. The `interlock limits` row is relabelled to cover both checks; its value does not change.
- **Review and remediation stay on `EFFORT.skeptic`.** They already are. This change adds the runtime assertion that keeps them there.
- **Four spawns inherit on purpose, and the spec now says so:** the replan ping, the wave planner, handoff and commit. Inheritance there becomes the requirement, so a later reader does not "fix" it.
- **One derivation, two forwarders.** The mirror requirement is removed. The run program is the only place an effort is derived; each driver forwards the step's `effort` when the step named one and passes no key when it did not.
- **The runner forwards effort.** `bin/interlock-run` passes `effort` into `host.spawn` the way it passes `model`.
- **Effort control is a declared host capability** with three values:
  - `flag` — `claude` passes `--effort <level>`, the flag Claude Code 2.1.285 documents and accepts. The Workflow host's assumed value is also `flag`.
  - `negotiated` — `acp` applies the level through an `effort` config option when the agent advertises one, by exact value, with `session/set_config_option`.
  - `unsupported` — the adapter has no effort channel it is verified to use: `codex` and `qwen`. Neither gets an invented flag.
- **An older `claude` binary degrades instead of failing.** The Claude adapter reads the CLI's help once when the host is created. If the effort flag is not there, or the help cannot be read, the host declares `unsupported` for that run and passes no flag. A CLI that does not know the flag rejects the whole invocation, so without this every lane would fail.
- **The receipt records the capability.** The manifest is overwritten by every run; the receipt's host block gains `effort`, so a later reader can tell a run whose effort was applied from one where it could not be.
- **An unapplied effort is spoken, per spawn.** Every adapter reports, for each spawn that named an effort, whether it was applied and why not. The reason is true of the host: Qwen has no effort control, Codex has a channel this change does not route, and each says so in its own words. The runner prints `effort routing: applied on N/N spawns`, or `EFFORT ROUTING UNAVAILABLE (<host>)` with one line per spawn naming its label, the level it asked for and the reason. The spawn always still runs.
- **An environment override is spoken.** When `CLAUDE_CODE_EFFORT_LEVEL` is set, both drivers print `EFFORT ROUTING OVERRIDDEN`, because that variable outranks the flag and every per-agent effort. The runner recognises Claude by its command name, so an ACP wrapper around Claude is not covered; the docs say so.
- **`EFFORT` joins the cap-authority sweep**, so a published effort with no reader fails the suite. A second sweep forbids an effort level written beside an `effort` key in the run program, the wave planner and both drivers, and a test keeps the plugin's agent definitions free of an effort of their own.
- **Unchanged on purpose:**
  - `EFFORT.byTier`, `EFFORT.verify`, `EFFORT.skeptic`. No value moves.
  - `LANE_CAPS.opusMinTier` and the model clamp.
  - The verify spawn's model, which stays the session model.
  - Every briefing. Effort is a parameter, never a sentence telling a model how hard to think.
  - Every skill.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `effort-routing`:
  - The dispatch requirement covers both verify checks and both drivers, and reads the level from the published table.
  - The planner/runtime mirror requirement is removed and replaced by a forward-only requirement on the drivers.
  - A new requirement names the spawns that inherit.
  - The published-not-restated requirement gains a reader check for every published effort.
  - A new requirement banners an environment override of effort.
- `run-host-adapters`:
  - Effort control is a declared capability, recorded on the manifest with the others.
  - A spawn whose named effort was not applied is bannered with a reason true of that host, and still runs.
  - The Claude adapter establishes from the CLI's help whether the effort flag exists, and the receipt records the declared capability.
- `workflow-host`:
  - A spawn request may name an effort, and a host that cannot apply it still spawns.
  - The ACP adapter applies a named effort through session configuration when the agent advertises it.

## Impact

**Code**

- `lib/run.mjs` — both verify spawns read `EFFORT.verify`; the four inheriting spawns gain a comment citing the requirement; `ASSUMED_CAPABILITIES` gains `effort`; the receipt's host block carries it.
- `lib/receipt.mjs`, `lib/run-log.mjs` — the receipt's host block writes and reads `effort`.
- `lib/limits.mjs` — the verify row's label only.
- `lib/host/effort.mjs` (new) — the one effort resolver the adapters share, the ACP value picker, and the override variable's name.
- `lib/host/registry.mjs` — the capability key, its legal values, four declarations.
- `lib/host/claude-cli.mjs`, `lib/host/acp.mjs`, `lib/host/codex.mjs`, `lib/host/qwen.mjs` — apply or decline, and report. The Claude adapter also probes `--help` once per host.
- `lib/host.mjs` — `SpawnRequest` gains `effort`.
- `bin/interlock-run` — forward, collect, banner.
- `workflows/ship.js` — the environment probe reads the override variable and banners it. The effort forward is already there.
- `lib/doctor.mjs` — the `printenv` allowlist reason names the new variable.

**Tests** — `test/spine/run.test.mjs`, `limits.test.mjs`, `host-registry.test.mjs`, `host.test.mjs`, `host-adapters.test.mjs`, `acp-host.test.mjs`, `plugin-agents.test.mjs`, `run-log.test.mjs`, a new `host-effort.test.mjs`, `test/workflows.test.mjs`, `test/helpers/ship-harness.mjs`, and the Claude and ACP fixtures.

**Docs** — `docs/04-when-it-stops.md` (three banners), `docs/07-cli-and-configuration.md` (the capability and the variable), `docs/06` and `docs/10` (the override beside its model twin), `CHANGELOG.md`.

**Spend.** Verify agents move from the session default to the published verify effort on the Workflow host. On `--host claude`, lanes start receiving the effort the plan already assigned them. Both are the point of the change, and both move cost.

**Dependencies.** None added.

**Base.** The opus-floor lanes work is in the working tree, uncommitted. These deltas are written against the working-tree specs and assume that work lands first.
