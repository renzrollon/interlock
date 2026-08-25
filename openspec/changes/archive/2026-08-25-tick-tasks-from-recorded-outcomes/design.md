## Context

See proposal.md — Why for the defect and its evidence.

Three constraints shape every option below.

**The recorded verdict exists but does not travel.** `recordBatchResult` in `lib/waves.mjs` already adjudicates each task: an invalid or over-budget handoff fails it, a lane result missing an outcome fails the whole lane, and the results land in `state.completed` / `state.failures`. But `wave-state record-batch --write-state` emits `nextStep(state)` — the next action and its cursor — so the caller learns what to do next and never learns what was just decided.

**The two hosts reach the CLI differently.** `bin/interlock-ship-acp` is ordinary Node: it spawns the CLI and reads its stdout directly. `workflows/ship.js` runs in a runtime with no filesystem, no `import()`, and no shell; it reaches the CLI only by asking a cheap ping agent to run commands and copy stdout back. Anything the workflow host must learn has to fit in a small payload an agent copies verbatim. This is the seam `lib/host.mjs` exists to isolate, and neither host may carry policy of its own.

**One tick site, one tally site, per host.** Both hosts compute a `succeeded` id list and push a `summary.waves` entry from the agent's `ok` field, both *before* the `record-batch` loop runs — `bin/interlock-ship-acp:683` and `workflows/ship.js:1200`. Everything downstream inherits from those two expressions.

## Goals / Non-Goals

**Goals:**

- One authority for "what did this task do", reaching both hosts by the same contract.
- Divergence between claim and verdict is reported, not silently corrected — a run that had to override an agent says so.
- No agent judgement in the path: an agent may copy the verdict, never re-derive or reconcile it.
- The unit suite can express a run where claim and verdict differ, which today it cannot.

**Non-Goals:**

- Recording the agent's claim as a receipt field. The claim is already in the trajectory as the spawn and handoff record; a second copy beside the verdict invites a reader to average them.
- Changing the state file's shape, the event schema, or any existing CLI output field.
- Revisiting what makes a task fail. The adjudication rules in `waves` are correct and untouched; only their reporting changes.
- Re-scoring historical trajectories. Receipts are append-only history.

## Decisions

**Decision 1 — the verdict rides back on the step `record-batch` already emits, as an additive field.**

`emitRecordedState` gains a `recorded` array on the emitted step for the `record-batch` source: `[{ id, outcome, reason? }]`, describing only the batch just recorded.

*Alternatives considered.* Hosts read `state.json` themselves — impossible on the workflow host, which has no filesystem, so the two hosts would need different mechanisms for the same fact and only one could be tested. A new `wave-state outcomes` subcommand — correct but it costs the workflow host an extra agent turn per batch, and the information is a byproduct of a call it already makes. Have the closing step read the final state and back-fill the tallies — too late for the tick, which happens per batch mid-run, and it would put an agent in the middle of a per-wave count.

**Decision 2 — the delta is derived by comparing two states, not stored on one.**

A new pure function in `lib/waves.mjs` takes the state before and the state after and returns the batch's outcomes. `recordBatchResult` appends to `completed` and `failures`, so the delta is the tail of each, plus the not-attempted ids that appear in neither.

*Alternatives considered.* Change `recordBatchResult` to return `{ state, recorded }` — a signature change across every existing caller for one caller's benefit. Persist `lastBatchOutcomes` on the state — derived data in a durable file, and a resumed run would carry a stale one that reads as current. Deriving it keeps the recorder's contract intact and makes the derivation itself unit-testable against two hand-written states.

**Decision 3 — the tick list is the recorded-succeeded ids, and ticking stays after recording.**

Both hosts already tick after the record loop; only the id list changes. A task recorded failed or not-attempted is not in it.

**Decision 4 — the workflow host's ping concatenates, and concatenation is all it does.**

The catch-up loop can run several `record-batch` commands in one step. The ping is instructed to copy each command's `recorded` array into one reported array, in command order, and to copy the field verbatim. It is explicitly told not to merge duplicates, drop entries, or reconcile an outcome against what it believes happened — the same verbatim-transport discipline `add-ship-run-receipt` established for the receipt payload, for the same reason: a value an agent adjusted in transit is indistinguishable downstream from the value the run measured.

Today the ping copies only the *last* command's stdout. That is why the field must be accumulated rather than read from the final step: a catch-up loop of three batches would otherwise report one batch's outcomes as the whole wave's.

**Decision 5 — an overridden claim is a degradation, printed and recorded.**

When any task's recorded outcome differs from what the agent claimed, the run pushes a banner naming the ids and the adjudication reason. It therefore reaches the receipt's degradation list by the existing path, with no new receipt field.

This is the decision that turns a silent correction into a finding. A run that quietly fixed up five bad handoffs looks identical to a clean run; a run that says "I overrode five claims" tells its reader that the implementer prompt or the handoff contract needs attention.

**Decision 6 — an unavailable verdict falls back to the claim, loudly.**

If the `recorded` field is absent or malformed — an older CLI, a ping that lost it — the host tallies from the claim as it does today **and** pushes a banner saying the tallies are claim-derived. Silent fallback would reintroduce the defect in the one case nobody would think to check, and the receipt's own rule is that an unread value is reported as unknown rather than as clean.

**Decision 7 — the harness gains the ability to disagree.**

`test/helpers/ship-harness.mjs` currently derives its stubbed CLI responses from the same fixtures as its agent responses, so claim and verdict cannot differ and the defect is unreachable in tests. `stepResult()` gains an optional recorded-outcomes argument, and the divergence case becomes a first-class scenario rather than something only a live run can produce.

**No new dependencies.** This change adds no library, tool, or image, so there is no version to pin. Every mechanism above is existing standard-library code in this repo.

## The invariant and every reader of it

The shared value is *a task's recorded outcome*. The unit of work is that invariant, not the files it touches — normalize once, at the boundary where the state machine decides, and make every consumer read the canonical form. Enumerated:

| Reader | Today | After |
| --- | --- | --- |
| Tick id list — both hosts | agent claim | recorded-succeeded ids |
| `summary.waves` tallies — both hosts | agent claim | recorded outcomes |
| Printed per-wave lines | `summary.waves` | unchanged, now correct at the source |
| Receipt `waves` | `summary.waves` | unchanged, now correct at the source |
| Receipt `leftoverTaskIds` | unticked boxes | unchanged; correct once the tick is |
| `run-complete` event leftovers | unticked boxes | unchanged; same |
| Failure budget and halt | recorded outcomes | already canonical, untouched |
| Handoff packets to the next wave | recorded state | already canonical, untouched |
| Degradation list | banners | gains the overridden-claim banner |

The two rows already reading the canonical form are why the halt reason was right while the tallies were wrong — the defect is exactly the set of readers that took the shortcut.

## Risks / Trade-offs

- **The workflow host's ping drops or mangles the `recorded` field** → schema-validate it on arrival; on absent or malformed, Decision 6's loud fallback applies. The prompt-shape test asserts the verbatim instruction, and an executed-script test asserts the fallback banner appears rather than a clean-looking summary.
- **An additive step field breaks a strict consumer** → the field is additive and every existing field keeps its meaning; tests assert the pre-existing step shape is unchanged. `nextStep` itself is not modified.
- **More runs now finish with unticked boxes** → intended. Those boxes were ticked on unverified claims; a run that reports leftovers it previously hid is a run telling the truth for the first time. Worth saying plainly in the change's summary so it is not read as a regression.
- **Ordering against `add-ship-run-receipt`** → the `ship-run` delta here is ADDED because the receipt requirement still lives in that change's unarchived delta. If this change archives first, the tally requirement stands on its own terms (it speaks of the summary and the receipt), but archiving `add-ship-run-receipt` first keeps the main spec's history readable.
- **A repo whose tasks.md has no ids for some lines** → `parseTasks` already reports `null` for such a line and the tick already reports ids it could not match. Unchanged behavior; the recorded-outcome list is keyed by the ids the plan carried, not by checkbox text.

## Migration Plan

No state-file, event-schema, or CLI-flag change, so there is nothing to migrate and nothing to roll forward. An in-flight `state.json` written before this change works unchanged, because the delta is computed from two in-memory states rather than read from a persisted field.

Deploy order: land the CLI reporting first (it is inert until a host reads it), then each host, then the harness and tests. Rollback is a revert; a reverted host simply stops reading a field the CLI still emits.

## Open Questions

- Whether `record-verify` should report its adjudication the same way. It has the same shape of problem — the caller learns the next action, not what the judge concluded — but nothing currently ticks or tallies from a verify verdict, so the answer does not change these specs, this approach, or the task breakdown.
