## Why

A ship run ticks checkboxes and tallies waves from what the implementing agent **claimed**, not from what the CLI **recorded**. When the two disagree the run believes the agent, so a task the state machine failed still gets its box ticked — which is how a task ships unimplemented behind a `- [x]`.

This is not hypothetical. A live ACP-host run in this repo (2026-08-24, scratch fixture, five tasks) returned handoffs whose `status` was outside the accepted set, so `record-batch` failed all five tasks exactly as `waves` §"Invalid or oversized packets fail closed" requires. The run then ticked all five boxes anyway:

```
$ node -e "s=require('./.claude/ship/state.json'); ..."
state completed: []
state failures : ['1.1', '1.2', '2.1', '2.2', '3.1']
  each: invalid handoff: status must be one of ok|blocked|partial, got "done"
$ grep -c '^- \[x\]' openspec/changes/add-greeting-formatter/tasks.md
5
```

The printed summary and the run receipt agreed with the agent too — `wave 1 (run-batch): 2 ok, 0 failed` / `wave ? (test-wave): 3 ok, 0 failed` — beside a halt reading `5 task failures accumulated across waves`. One record, two irreconcilable stories.

Two things make this load-bearing now. The checkbox has just become the authority for the run receipt's `leftoverTaskIds` (`add-ship-run-receipt`, task 7.3), so a wrong tick now propagates into the corpus rather than staying local to one tasks.md. And the whole unit suite passes over this defect, because the ship harness stubs a host whose agent claims and CLI verdicts always agree — the divergence is unreachable in tests and routine in production, where an agent that misformats one field is ordinary.

## What Changes

- `interlock wave-state record-batch` reports the per-task outcomes it just recorded — id, outcome, and failure reason — to its caller. Today the caller receives only the next step, so the recorded verdict is written to the state file and never surfaces to the host that has to act on it.
- Both ship hosts tick from those recorded outcomes instead of from the agent's `ok` field. A task the CLI recorded as failed, `not-attempted`, or invalid is not ticked.
- Both hosts build their per-wave tallies (`ok`, `failed`, `notAttempted`) from the same recorded outcomes, so the printed summary and the `run-receipt` event report what the run recorded.
- The agent's own claim stays visible where it belongs — as the input the CLI adjudicated — and stops being the thing anything downstream counts.
- No new CLI subcommand, no new event type, and no change to the state file's shape.

## Capabilities

### New Capabilities

<!-- None. This is a conformance fix: the behavior is already required, in three
     places, and the implementation does not deliver it. -->

### Modified Capabilities

- `ship/completion-gate`: "Task-completion recording SHALL surface its own failure" guarantees a succeeded task cannot silently stay unmarked. It needs its converse, which is the half this defect lives in: a task the run recorded as failed or not-attempted MUST NOT be marked complete, and "succeeded" MUST mean recorded-succeeded rather than agent-reported.
- `waves`: a recorded batch MUST report its per-task outcomes back to the caller that recorded it, so a host has an authority to tick and tally from. Today `record-batch` fails a task correctly and tells its caller nothing but the next action.
- `ship-run`: the receipt's per-wave tallies MUST be the recorded outcomes. The requirement already says the receipt carries "what it observed"; it does not yet name which of two disagreeing observations is the run's.

## Impact

- `bin/interlock` — the `record-batch` branch of `wave-state` gains the recorded-outcome delta in its emitted JSON. Additive: existing readers take `action` and the cursor fields and are unaffected.
- `lib/waves.mjs` — `recordBatchResult` already computes the verdict per task; it needs to return it identifiably rather than only appending it to `completed` / `failures`.
- `workflows/ship.js` — the `record-batch` step's ping copies the recorded outcomes out of the last command's stdout; `summary.waves` and the tick id list are built from them. This host reaches the CLI through an agent, so the payload it copies must stay small and mechanical.
- `bin/interlock-ship-acp` — same two call sites, no agent in the path.
- `test/workflows.test.mjs`, `test/spine/cli.test.mjs`, `test/helpers/ship-harness.mjs` — the harness must be able to express a run where the agent's claim and the CLI's verdict **differ**, which it currently cannot. That gap is why this defect was invisible; closing it is part of the change.
- Corpus: existing trajectories keep whatever tallies they recorded. Receipts are append-only history and are not rewritten.
