## Why

Two measurement fields in the ship-run corpus are dishonest in opposite directions.

**`durationMs` is always `null`.** Every `cli-exit` event in every recorded run — 481 in this repo's fixtures, and all of them in a live run from `planet-wars-simulation` — carries `durationMs: null`. The field is declared in `TYPE_FIELDS` (`lib/run-log.mjs:166`) and nothing ever fills it. A declared field that is never written reads to a later analyst as "this run had no measurable duration", which is a claim, not an absence.

**Token spend is not recorded at all.** `agent-spawn` records the model a lane ran on but nothing about what it cost. Cost per shipped task — arguably the single most actionable number for tuning tier assignment, lane folding, and `maxTasksPerAgent` — is invisible. Meanwhile `projectedWaveLoopAgents(plan)` (`lib/waves.mjs:699`) already computes a *projection*, so the plan says what it expects to spend and the run never says what it did.

## What Changes

- `durationMs` is filled with the CLI's own measured execution time at every append site that has one. This is honest and cheap. **It is also low-value and the spec says so**: the measured interval is CLI self-time, observed at ~1 ms in real logs (`22.560 → 22.561`), not agent-turn wall clock.
- Wave and run duration are derived from `ts` deltas between events in the reader, not recorded as a new field. The data is already there; nothing needs to be written to get it.
- Output-token spend is recorded per wave and per run, sourced from the workflow runtime's `budget.spent()`, which `workflows/ship.js` does not currently reference.
- **The host asymmetry is declared, not hidden.** `budget` is a workflow-runtime global. The ACP host has no equivalent source, so a token figure is `null` there — recorded as unknown, never as zero.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ship-run`: `durationMs` gains a requirement stating what it measures (CLI self-time) and what it does not (agent turn duration), so a reader cannot mistake one for the other. Token spend gains a requirement stating that it is per-wave and per-run, that its source is host-dependent, and that an unavailable source records `null` rather than `0`.

## Impact

**Why agent-turn duration is not attempted.** The duration worth having is how long an implementer took. Three parties could observe it and none can record it:

| Party | Sees agent duration? | Can write? |
|---|---|---|
| `bin/interlock` (CLI) | no — it runs *between* agent turns | yes |
| `workflows/ship.js` (script) | yes — it awaits `agent()` | **no** — no fs access |
| the agent itself | approximately | yes, but it is a self-report |

Routing agent duration through the agent would make a timing measurement self-reported, which is the provenance defect `derive-outcome-record-from-receipt` exists to remove. Deriving wave duration from `ts` deltas costs nothing and stays observed. So: fill `durationMs` with what the CLI can honestly measure, document the limit in the spec, and get wave timing from timestamps.

**Why token spend can be recorded despite the same constraint.** `budget.spent()` returns a cumulative figure the *script* reads, so a per-wave delta is script-authored. It reaches disk by the same script-authored / agent-transported / CLI-validated path as every other event field, with the `TYPE_FIELDS` whitelist as the boundary. A number the script computed and an agent merely carried is not a self-report, provided the closing prompt does not invite the carrier to adjust it.

**Affected code.**

- `lib/run-log.mjs` — `durationMs` semantics documented at the field; token fields added to the relevant `TYPE_FIELDS` entries, coerced through the existing `nullableCount` so an unavailable source stays `null` and a malformed one does not become `0`.
- `bin/interlock` — append sites measure their own execution and pass it; `run-log show` renders duration and spend.
- `workflows/ship.js` — reads `budget.spent()` at wave boundaries and at close, transports the deltas. Guarded: `budget.total` is `null` when no target was set, but `spent()` is still meaningful, and a runtime without `budget` at all must degrade to `null` rather than throw.
- `bin/interlock-ship-acp` — records `null` for token fields and says so, rather than omitting them silently.

**Sequencing.** Independent of the other changes in this set. It touches the same `TYPE_FIELDS` table as `add-ship-run-receipt`, so landing them in either order is fine but landing them simultaneously will conflict on that one table.

**Non-goal.** No per-agent attribution. `budget.spent()` is a process-wide cumulative counter, so a wave delta covers everything that ran during the wave, including the orchestrator's own turns. Attributing spend to an individual lane would need runtime support that does not exist, and estimating it would put a fabricated number in a corpus whose value is that it does not contain any.
