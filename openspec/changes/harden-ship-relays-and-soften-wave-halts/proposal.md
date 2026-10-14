## Why

Ship run `dccd9199` (beta-rabbitdeploy, `add-viber-analytics-and-dashboards`) halted at wave 2 with every task of that wave done and its tests passing. Three defects stacked, and none of them was in the work:

- **The worker's acknowledgement was one character short.** Lane `2.1+2` finished 2.1, 2.6 and 2.10 and reported its 64-hex briefing hash with the final `f` dropped. `workflows/ship.js` requires an exact match, so the result was nulled. On its own that charges one failure and marks the other two tasks not attempted.
- **The relay recorded wave 1's results against wave 2.** Relay `cli-4` was to write `[null]` to `.claude/ship/results.json` and run `run record-batch`. Its Write was refused ("File has not been read yet": the file still held wave 1's results), and it ran the command anyway. The CLI read task 1.2's single-task result as the three-task lane's, failed all three with "lane result carried no per-task outcomes", crossed the task-failure cap and emitted a halt step.
- **The relay then ran the command a second time.** The sequence guard refused it as out of sequence, the relay copied that stderr line in place of the step, and the run halted on "relayed chars do not parse as JSON" — naming neither cause.

The same class ended two other runs on 2026-10-12: a 27 KB `results.json` retyped with an extra bracket, which the CLI refused while printing nothing to stdout, and a relay that returned an empty copy without running its command. In every case the CLI's own answer was on disk, or the call had never taken effect, and the driver had no way to tell which. Separately, the two beta-rabbitdeploy runs of 2026-10-08 halted on inter-wave checks still red after two fix attempts — a checkpoint whose failures the next wave usually resolves, ahead of a final verification that already refuses to commit a red suite.

## What Changes

- **Every `run` step carries a sequence number.** `seq` is one greater than the last step emitted in the same root, continues across runs, rides the relay whitelist, and is read by the Workflow driver. `run close` also writes its step to `.claude/ship/last-close.json` (it still does not touch `last-step.json`).
- **A relayed input names the step it answers.** The Workflow driver writes `{"answers": <seq>, "value": <payload>}`. A `run` subcommand refuses an envelope that answers any step but the current one — for `run close`, any step outside the current run — with a non-zero exit and no state change, so a stale file or a rerun relay can never be recorded. Bare inputs (the runner host, `wave-state`, existing tests) are read as before.
- **An unreadable relay is recovered before the run halts.** The driver reads the CLI's own record through a read-only relay and continues from it when its `seq` shows the call took effect, re-relays the call once when it did not, and halts otherwise — quoting the start of what the relay copied. The relay is told to run its command once and never rerun a non-zero exit.
- **A briefing acknowledgement tolerates a transcription slip.** A reported hash is accepted when it matches exactly or when at least 16 hex characters are reported and the first 16 match; the result is recorded with the canonical hash and an inexact match raises `BRIEFING ACK INEXACT`. A missing or different hash still fails closed. The bootstrap text is unchanged.
- **Unresolved inter-wave checks warn and never halt.** After the published fix attempts, the errors are recorded, bannered and carried to the next wave's implementer briefings. A checkpoint whose verify agent reported no result is recorded as a skipped verification rather than halting the run. **BREAKING** for a reader of the halt kind `inter-wave-verify`: the state machine no longer emits it. The final verification gate is unchanged.
- **A task whose dependency did not complete is skipped, not dispatched.** A not-yet-dispatched task whose `dependsOn` names a task that failed, was left not attempted, or was already skipped, directly or transitively, is removed from the run, left unchecked, counted in no failure budget and named in a `DEPENDENTS SKIPPED` banner.
- **Left as it is, on purpose.** The task-failure halt (more than two recorded failures) and the lost-agent rule (an agent that returned nothing costs one failure) stay. Those are failures of the work, or of an agent nobody can account for; the changes above stop failures of the transport from becoming either.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship/run-program`: the briefing-acknowledgement requirement accepts a 16-character prefix and canonicalises it; one new requirement for step sequence numbers, step-bound relay inputs and relay recovery.
- `waves`: two new requirements — unresolved inter-wave checks warn, are carried forward and never halt; a task that depends on a task that did not complete is skipped and uncounted.

## Impact

- **Changed:** `workflows/ship.js` (`cli()`, `spawnOne`, the relay prompt); `bin/interlock` (the `run` case's input reading, `seq` stamping, the close's record file); `lib/run.mjs` (`RELAY_STEP_FIELDS`, the sequence stamp, `decorate`, `runJudge`'s unreported inter-wave check, `runRecordBatch`'s banner); `lib/waves.mjs` (`recordVerifyResult`, `recordBatchResult`, `nextStep`, `createRunState`, the run summary); `lib/prompts/implementer.mjs` (the failing-checks section); `lib/limits.mjs` (comment); `docs/04-when-it-stops.md`, `docs/06-why-it-works.md`, `docs/10-agentic-workflow-ship-and-spec.md`, `CHANGELOG.md`.
- **Tests changed because the requirement changed:** `test/spine/waves.test.mjs` (inter-wave cases that expected a halt), `test/spine/run.test.mjs` (the relay whitelist pin), `test/workflows.test.mjs` (the relay prompt pins; the unreadable-relay halt now needs two misses), `test/helpers/ship-harness.mjs` (answers the recovery relay and can simulate a relay that runs before writing or reruns).
- **Hosts:** the runner host (`bin/interlock-run`) sends prompts inline and writes bare inputs; it gains the inter-wave and dependency behaviour through the CLI. One fix of its own, found while verifying this change: once a signal has started the close, the loop's own CLI calls never settle, so the step that was in flight cannot carry the loop on to a second close racing the first for the summary.
- **Dependencies:** none added.
- **Not covered:** an installed plugin reads none of this until a release.
