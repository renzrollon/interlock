## Why

Transcript evals grade one briefing. Outcome evals grade disk (ticks, suite, commit, receipt). Nothing grades the reconstructable ship JSONL: did the loop emit the event types the run program contracts, was every recorded `action` in the allowed set, did it halt when unit was red. That is the process/trajectory layer Anthropic would call transcript analysis; Interlock's transcript is `.claude/ship/runs/*.jsonl` events, not chat messages. Slice C of `docs/evals-agentic-workflow.md` names this gap; closing it needs no new model call.

## What Changes

- **The outcome eval's loop arm also grades the scratch run-log as process**, beside the existing disk criteria. After a loop arm terminates, a deterministic stdlib walker over `interlock run-log` events checks: required event types are present, no event carries an unknown `action`, and a unit-red judgement the CLI already recorded is closed with `run-halt` rather than `run-complete`.
- **`interlock run-log check` stays the reconstructability criterion.** The new checks sit beside it. They do not duplicate sequence-gap / missing-start / missing-close / unpaired-cli-exit, and they do not change that command's in-run gate.
- **The control arm stays without a trajectory-failure verdict.** Process criteria are not-applicable there, matching ticks / reconstructability / receipt today.
- **Planted JSONL fixtures prove the walker offline.** No live ship, no network, no model. The metered outcome job is unchanged in trigger and ceiling; it simply records additional named criterion statuses on loop-arm rows.
- **Spoken host limits stay spoken.** This still does not pretend ACP is Workflow.

## Capabilities

### New Capabilities

None. Process grading is additional criteria on the existing outcome eval, not a second eval. A sibling `evals/outcome-trajectory` would split "what the outcome runner grades" and restate the control-arm not-applicable rule in a second spec. The existing `evals/outcome-run` identity ("environment, not chat") can honestly absorb JSONL process checks once its "every grader is an existing CLI decision" and "SHALL NOT read a transcript" requirements are modified to distinguish chat transcripts from the run-log the reconstructability check already reads.

### Modified Capabilities

- `evals/outcome-run`: the loop arm SHALL grade the scratch run-log as process (required event types present, no unknown `action`, halt when the CLI already recorded unit red) in addition to disk outcome; reconstructability remains `interlock run-log check`; the walker is not a new policy judgement, an LLM-as-judge, or a gate; the control arm SHALL NOT receive a trajectory-failure verdict for these criteria.

`evals/outcome-history` is unchanged: new criterion ids travel as additional named entries in the existing criteria array (counts and statuses only). The record still MUST NOT carry event bodies or a JSONL dump. Schema `interlock.ship-outcome-eval/1` stays; the shape does not change.

`evals/outcome-fixtures` is unchanged: no new fixtures, no new eval cases under `evals/`.

## Impact

- **Modified**: `evals/ship/graders.mjs` (loop-arm process criteria; control-arm not-applicable); `evals/ship/run.mjs` only if `gradeArm` composition needs a hook — the runner already grades after the loop; `evals/ship/README.md` (what the loop arm grades, still naming ACP limits).
- **New**: `evals/ship/trajectory.mjs` (stdlib walker over run-log records) and planted JSONL fixtures under `evals/ship/sample/` (or equivalent test fixtures) for the failing directions.
- **Tests**: `test/spine/ship-graders.test.mjs` and/or a sibling offline test; README token pins if new coverage vocabulary is added.
- **Not modified**: `lib/run.mjs`, `lib/run-log.mjs` `checkRunLog`, `bin/interlock` `run-log check`, `workflows/ship.js`, `bin/interlock-ship-acp`, `interlock ready`, `interlock gate`, the ship loop, `lib/limits.mjs`, CI job triggers, `evals/` plugin-eval cases.
- **Dependencies**: none. No agentevals, Harbor, Braintrust, LangSmith. Stdlib Node only.
- **Cost**: zero on the walker; the scheduled outcome job is already metered and is not re-triggered by this change.
- **Not a gate**: no outcome-eval result, including the new process criteria, feeds ready, gate, promotion, or any workflow step.
