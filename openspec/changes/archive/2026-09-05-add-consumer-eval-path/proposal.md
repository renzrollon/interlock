## Why

Interlock runs no model evals in a consumer's CI, and should not: the model-facing surface is identical in every consumer, so a consumer re-running Interlock's prompt evals would measure Interlock, at their expense, behind an early-access flag they do not control. What a consumer needs instead is deterministic per-run outcome grading, a way to file a failure, and a stated posture — and three of those four pieces are missing today. `interlock report` declares its sharpest indicator, "did the merged diff match the plan", **not computable**; the only route from a consumer's failed run to an Interlock regression case is a human pasting a transcript into a chat; and nothing in the docs tells a consuming repository what is checked on their run, what is recorded, or that none of it moves a gate.

## What Changes

- The ship-run receipt records two bounded path sets: the paths the run's commit touched, and the paths the executed plan predicted. Both are copied by name like every other receipt field, both are tri-state, and a run that made no commit leaves the touched set **unobserved, not empty** — collapsing that distinction would turn "we did not measure" into "we measured zero".
- `interlock report` computes `diffMatchesPlan` from those sets with its denominator, and stops declaring the indicator uncomputable. Runs whose sets are unobserved, incomplete or truncated are excluded from the denominator and reported by name and count, never silently absorbed.
- A new `interlock evals capture --run <runId> [--task <id>]` emits an eval-case skeleton from a recorded trajectory into a caller-named directory. It writes nothing into `evals/`, refuses a run that is not reconstructable (reusing the existing `run-log check` decision rather than inventing a second notion of reconstructable), and quotes the observed out-of-enum or fabricated value from the trajectory as its grader pattern, marked as unconfirmed. It never fabricates a prompt or a pattern.
- The `interlock:evals` skill accepts a captured skeleton as the observed-failure evidence its authoring rule requires — the skeleton *is* a run artifact, which that rule already names.
- A new documentation page states the consumer posture: which properties of a run are checked and by which command's exit code, what is recorded and where, that none of it changes a gate, that Interlock runs no model evals in the consumer's CI and why, and how to file a failure. Its key claims are pinned by a test, following the existing doc-claim assertion precedent.
- `interlock doctor` gains two eval-prerequisite rows — the early-access variable and a model credential — with status `skip` and a reason when absent, **never** `fail`, because neither stops a ship run. The exit code is unchanged by them.

## Capabilities

### New Capabilities
- `evals/capture`: turning a recorded ship-run trajectory into an eval-case skeleton with provenance — what it refuses, what it may quote, and where it may write.
- `evals/consumer-posture`: what a repository that runs `/interlock:spec` and `/interlock:ship` is told about checking, recording, gating, and filing a failure — and that the statement is asserted rather than trusted to survive a docs edit.
- `evals/prerequisites`: how eval prerequisites are reported by the preflight without ever stopping a run.

### Modified Capabilities
- `ship-run`: the receipt gains the touched-path and predicted-path sets, with the tri-state and bounding rules the rest of the receipt already follows.
- `report/indicators`: `diffMatchesPlan` becomes a computed indicator with a denominator and stated exclusions, replacing the declared gap.
- `evals/authoring`: a captured skeleton counts as the observed-failure evidence the skill requires before authoring.

## Impact

- `lib/run-log.mjs` — two new receipt fields plus their completeness and truncation markers, a nullable array coercer, and their rendering.
- `lib/report.mjs` — the plan-fidelity indicator group; the module header paragraph that declares the gap.
- `lib/doctor.mjs` — one new check contributing only `ok` or `skip`.
- New: a deterministic reader for a commit's touched paths, a reader for the executed plan's predicted paths, and the capture module.
- `bin/interlock` — `evals capture`, the paths readers, help text and the exit-code table.
- `workflows/ship.js` and `bin/interlock-ship-acp` — the receipt gains the two sets at close, or records them unobserved with a stated reason.
- `skills/evals/SKILL.md` §1, `docs/`, `README.md`.
- Tests: `test/spine/`, `test/skills.test.mjs`, `test/workflows.test.mjs`.
- No new runtime dependency; no new published cap in `lib/limits.mjs`.
