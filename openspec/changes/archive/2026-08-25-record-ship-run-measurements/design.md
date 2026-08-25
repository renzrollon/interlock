## Context

See proposal.md — Why. Two fields, two different problems.

**`durationMs`.** Declared at `lib/run-log.mjs:166` (`durationMs: source => nullableCount(source.durationMs)`), never supplied by any caller, `null` in all 481 recorded `cli-exit` events plus every event of a live run. The question is not "how do we fill it" but "what can honestly fill it":

| Party | Observes agent turn duration? | Can write? |
|---|---|---|
| `bin/interlock` (CLI) | ✗ — runs *between* agent turns | ✅ |
| `workflows/ship.js` (script) | ✅ — awaits `agent()` | ✗ — no fs access |
| the agent | approximately | ✅ — but self-reported |

Observed timestamp deltas across consecutive events are ~1 ms (`22.560 → 22.561`), confirming that CLI self-time is the only interval the writer can see.

**Token spend.** Nothing records it. `projectedWaveLoopAgents(plan)` (`lib/waves.mjs:699`) already computes a projected agent bill, so the plan states an expectation the run never reconciles. `workflows/ship.js` does not reference `budget`, which the workflow runtime exposes as `{total, spent(), remaining()}`.

## Goals / Non-Goals

**Goals:**

- Stop `durationMs` asserting an absence it never measured, and document what it does measure.
- Record output-token spend per wave and per run, from the runtime's own accounting.
- Make the host difference in token availability a declared fact rather than an inference from missing data.

**Non-Goals:**

- No agent-turn duration. Excluded on provenance grounds (Decision 1).
- No new recorded field for wave elapsed time — derived from timestamps instead.
- **No per-agent or per-lane token attribution.** The runtime exposes a process-wide cumulative counter; splitting it would be fabrication.
- No cost-per-task metric, no efficiency score, no threshold. This records the inputs.

## Decisions

**Decision 1: fill `durationMs` with CLI self-time, and say so in the spec.**

The append sites measure their own command's execution and pass it. The spec states that this is CLI execution time and explicitly not agent turn duration.

Alternatives considered:

- *Have the agent report its turn duration.* Rejected. It would make a timing measurement self-reported, creating a third instance of the provenance defect that `derive-outcome-record-from-receipt` exists to remove — in the same change set. A number that looks like a measurement but is a claim is worse than no number, because it invites analysis it cannot support.
- *Add a `wave-duration` event or field written by the script.* Rejected: the script has the observation but no write path, so it would travel by agent transport for a value already fully recoverable from timestamps. Recording a derivable value creates a second source that can disagree with the first.
- *Leave `durationMs` null and remove the field.* Considered seriously. Rejected because ~1 ms of CLI self-time is at least honest, and the field's existence with documented semantics is more useful than its absence — a future host that *can* time agent turns has somewhere to put a differently-named field, and this one no longer looks like the place.

**Decision 2: wave and run elapsed time are derived by the reader, not recorded.**

Two consecutive event timestamps bound a wave. The reader subtracts. No new field.

Recording it would create the possibility that the recorded duration and the timestamps disagree, which is the same failure class as computing the degradation list twice (see `add-ship-run-receipt` Decision 3). One source.

**Decision 3: token spend is a script-computed delta, transported like every other script-authored field.**

The script reads `budget.spent()` at wave boundaries and at close, computes deltas, and includes them in the payload the closing step transports. `TYPE_FIELDS` whitelists them through `nullableCount`.

This is not a self-report: the script computed the number and the agent only carried it. The distinction holds **only** if the prompt does not invite the carrier to adjust it — so the closing prompt must not ask the agent to sanity-check, correct, or re-derive spend. Stated here because that is exactly the sentence that caused the defect in `recordOutcome`.

**Decision 4: `nullableCount`, not `count`, for every spend field.**

`count()` floors non-numbers to `0`; `nullableCount()` preserves `null`. A host without accounting, a runtime that stops exposing it mid-run, and a malformed value must all read as unknown. A `0` would assert a wave that spent nothing — which is never true of a wave that ran agents, so the error would be silent and systematic.

Same reasoning as `lib/outcomes.mjs`'s tri-state `bool`: *"`null` means 'nobody said', which is different from 'no'. Coercing an unknown to false would invent data in a corpus whose whole job is to be honest about what happened."*

**Decision 5: declare the host asymmetry in the spec, do not paper over it.**

The workflow host has `budget`; the ACP host does not. The ACP host records the fields as absent and its inability is visible. The spec carries this as a named requirement rather than leaving a reader to notice that one host's runs never have spend data.

Alternatives considered:

- *Estimate ACP spend from agent count × a per-agent constant.* Rejected outright. `workflows/ship.js:333` already carries a comment estimating *"roughly 285 tokens per agent"* for a different purpose, so the temptation is concrete. Putting an estimate in this corpus would make the one file whose value is that it contains no fabricated numbers contain one.
- *Skip token recording until both hosts can do it.* Rejected: withholds a real signal from the default host indefinitely, for symmetry's sake.

**Decision 6: guard `budget` defensively.**

`budget.total` is `null` when no target was set, but `spent()` is still meaningful — so the guard is on `budget` and `budget.spent` existing, not on `budget.total` being set. A runtime without `budget` at all must degrade to `null`, not throw. A script crash in bookkeeping would fail a run for a measurement, which every impure module in `lib/` is written to prevent.

**Decision 7: the invariant is "a recorded measurement states what it measured"; both fields are in scope, and so is anything that renders them.**

| Consumer | Change |
|---|---|
| `TYPE_FIELDS` (`cli-exit`) | `durationMs` documented; semantics stated |
| `TYPE_FIELDS` (spend-carrying types) | spend fields added, `nullableCount` |
| `formatRunLog` | renders duration and spend; must render `null` as unknown, not as `0` or blank |
| `formatRunLogList` | unchanged |
| `summarizeRunLog` | out of scope — summary is identity and outcome, not cost |
| `checkRunLog` | unchanged — a missing measurement is not a reconstructability problem |

The `formatRunLog` row is the one that can leak the defect back into a reader's eyes: printing `null` as `0ms` or as an empty column would undo Decision 4 at the presentation layer.

## Risks / Trade-offs

**`durationMs` is nearly worthless as a signal** → Stated in the spec rather than mitigated. The value is honesty about a declared field, not analytical power. Wave timing comes from Decision 2.

**Wave-scoped spend includes the orchestrator's own turns** → A wave's delta covers everything in that span, including orchestration. Not mitigated — narrowing it needs runtime support that does not exist. The spec states the figure is an aggregate so no reader treats it as implementer cost.

**Wave boundaries in the script may not align with wave boundaries in the log** → The script's notion of "wave close" is where it takes the delta; the trajectory's is the `wave-action` sequence. If they drift, spend is attributed to the wrong wave. Mitigated by taking the delta at the same point the script pushes to `summary.waves`, so the two derive from one place.

**Someone divides run spend by task count and calls it a metric** → Will happen, and is a reasonable thing to want. The risk is that the divisor is wrong (tasks not attempted, folded lanes) and the result gets treated as calibrated. Not preventable in schema; the spec's aggregate framing is the available lever.

**`TYPE_FIELDS` collision with `add-ship-run-receipt`** → Both edit that table. Sequencing note; land in either order and expect one conflict there if simultaneous.

## Migration Plan

Additive. `RUN_LOG_SCHEMA` does not move — new optional fields on existing types, absent on old lines, which reads correctly as unknown.

No data migration. Old `cli-exit` events keep `durationMs: null`, now indistinguishable from a new event whose duration could not be measured. Accepted: retrofitting timing is impossible and the ambiguity is small.

Rollback is a revert. Lines carrying spend fields stay parseable; the reverted `TYPE_FIELDS` would stop writing them and `readRunLog` ignores unrecognized keys.
