## Why

A measured `/interlock:ship` run of `add-ship-run-inspectability` turned 24 tasks into 11 implementation waves plus a test wave. Seven of those waves held one task. The wave loop then spawned 47 agents — 24 implementers plus 12 `record-batch` pings plus 11 `inter-wave-verify` pings — because every forced serialization was encoded as a **wave boundary**, and a wave boundary always bought a verification cycle.

The serialization was real: nine tasks edit `bin/interlock` and cannot run concurrently. The verification charged for it was not. `record-batch` and `inter-wave-verify` each paid a ~65k-token subagent floor to write a 200-byte JSON file and run a CLI command, and `cheap()` inherited Sonnet because haiku was omitted "just in case" Bedrock could not reach it.

The original `gsd-wave-apply` did tick/metrics/pack-append in the orchestrator's own context. Interlock cannot — `ship.js` has no filesystem — but it can stop treating "not concurrent" as "new wave + new verify", and it can stop booting a fresh agent for every state transition.

## What Changes

- **Classifier prompt:** one group per numbered `tasks.md` section; a shared file is named in `paths` and is **not** a reason for a new group; a new group is only for a true output-exists dependency.
- **Collisions become batch lanes**, not overflow groups. Tasks that claim the same path stay in their group and run in successive batches of that wave. Ordering stays; the checkpoint does not multiply.
- **Checkpoint policy** is separate from ordering. Inter-wave verify is capped by `LIMITS.interWaveVerifications`. Docs-only waves skip the checkpoint. The verify **plan** (not the agent) decides typecheck-only vs skip when `--changed` and `--budget-ms` say so.
- **Fewer agent boots for bookkeeping.** `record-batch` fuses a following `verify` into the same ping. Batches of one wave accumulate and are recorded in one ping (N CLI calls, one boot). Cheap pings use haiku when a one-time probe says it is reachable.
- **Plan preview names the bill.** `formatPlan` prints projected agent count and warns when the plan is effectively serial.
- **Entry-point hygiene (operator machine, not the plugin):** stale `wave-apply.js` and `.bak.*` skill dirs inflated every spawn; `/gsd-wave-apply` must not infer `--strict`.

## Capabilities

### New Capabilities

- `waves`: Wave planning and the wave-state machine — grouping, batching, path-collision scheduling, and when an inter-wave checkpoint runs. New because `openspec/specs/` has no archived waves capability yet; `add-wave-handoff-and-prompt-snapshots` proposes a different `waves` delta (handoff packets) and has not been archived.
- `verify`: Inter-wave verification **planning** — `--changed`, `--context inter-wave`, `--budget-ms`, docs-only skip. Complements `add-ship-run-inspectability`'s spill requirements; this change does not implement spill.

### Modified Capabilities

- (none — `openspec/specs/` has no archived capabilities)

## Impact

- `lib/waves.mjs`: collision-aware batcher; checkpoint skip; `remainingBatches` on `nextStep`; projected-cost in `formatPlan`.
- `lib/limits.mjs`: `interWaveVerifications`.
- `lib/verify.mjs` + `bin/interlock`: `verify plan --changed --context --budget-ms` is structural.
- `workflows/ship.js`: classifier prompt; fused record+verify ping; haiku probe; accumulate-then-record.
- Tests: `test/spine/waves.test.mjs`, `test/spine/verify.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/cli.test.mjs`, `test/workflows.test.mjs`.
- Out of scope: finishing `add-ship-run-inspectability` or `add-wave-handoff-and-prompt-snapshots`; giving `ship.js` filesystem access; changing the one-agent-per-task isolation rule.
