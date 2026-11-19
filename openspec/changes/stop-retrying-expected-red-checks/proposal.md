# Proposal

## Why

A plan that leads with a failing-test wave skips only that wave's own check. When the implementation that turns those tests green spans several later waves, every check before the last is red by construction, and each still buys the full fix budget at the highest verify effort. In dial run `5f2097f6`, three waves produced nine red checks with identical failures, and six `xhigh` Opus fix attempts edited no file. Separately, every verify step runs on the session model at `high` or above, although 24 of the 26 first checks with a readable transcript only ran the suite and reported.

## What Changes

- An inter-wave check is skipped, under its own recorded reason and without spending a verification slot, while a test-first run still owes implementation after the current wave. This holds on a re-run that reuses the stored plan after the failing-test wave is complete, which the run state records for that purpose.
- The first check after the last implementation wave keeps the ordinary check and the full fix budget. A plan with no such check is gated by the final verification, as today.
- The projected agent bill and the plan preview agree with the new skip, and the planner's warning names the real gate.
- The first inter-wave check runs on a published model, Sonnet, at `medium`.
- An inter-wave fix attempt stays on the session model at its current `xhigh`. With expected failures gone, it runs only on real ones.
- The final check stays on the session model at `high`, under its own published effort.
- `interlock limits` and `interlock limits --json` publish the verify model and all three verify efforts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `waves`: inter-wave checks wait for the implementation a failing-test wave is owed.
- `effort-routing`: a verify spawn's model and effort depend on which check it is, and the limits surface publishes them.

## Impact

- Code: `lib/waves.mjs`, `lib/run.mjs`, `lib/limits.mjs`, `cli/interlock`.
- Tests: `test/spine/waves.test.mjs`, `test/spine/run.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/cli.test.mjs`, `test/workflows.test.mjs`, `test/skills.test.mjs`.
- Prose: `skills/spec/SKILL.md`, `docs/04-when-it-stops.md`, `docs/10-agentic-workflow-ship-and-spec.md`.
- Runs: a real regression in an early implementation wave of a test-first plan is reported at the last check or the final verification instead of at its own wave. The run state gains one optional key, present only for a test-first plan. No plan format or dependency changes.
