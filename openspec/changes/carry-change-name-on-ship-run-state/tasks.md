## 1. Reproduce the defect

- [x] 1.1 Add a failing test in `test/spine/run-log.test.mjs` (or `test/spine/cli.test.mjs`, wherever `wave-state` append coverage lives) that creates a run state for a named change, invokes a wave-state mutation **without** any per-invocation change argument, and asserts the appended `wave-action` and `cli-exit` events carry that change name. It must fail today with `unnamed`.
- [x] 1.2 Add a second failing test asserting the same for `agent-spawn` events emitted by `logAgentSpawns` on a `run-batch` step.
- [x] 1.3 Audit existing tests for assertions that expect `'unnamed'` as correct behavior rather than as the absent-name case. List them in the commit body; they are asserting the bug and will be updated in 4.1.

## 2. Carry the name on the state

- [x] 2.1 In `lib/waves.mjs`, extend `createRunState(plan, opts)` to accept `opts.change` and store it as `state.change` on the frozen state, next to `runId`. Reuse the bounded-text discipline already applied to names elsewhere; do not add a new length constant if one exists.
- [x] 2.2 Verify `mutable` → `cloneState` → `finalize` preserves `state.change` across `recordBatchResult`, `recordVerifyResult`, and `applyReplan`. Add a test asserting the name survives all three mutation paths.
- [x] 2.3 Add a test that `createRunState` called with no `opts.change` produces a state with no name, and that this is not an error.

## 3. Read from the state at every append site

- [x] 3.1 Add a `changeOf(state)` helper in `bin/interlock` alongside the existing `runIdOf(state)`, reading defensively so a malformed state cannot crash the CLI.
- [x] 3.2 In `logWaveMutation`, resolve the name as `changeOf(state) ?? flags.change`. State wins on disagreement (design.md — Decision 2). Add a test for the disagreement case.
- [x] 3.3 Apply the same resolution in `logAgentSpawns` and in the `verify judge` append site.
- [x] 3.4 Update `emitRecordedState` to forward the state-resolved name rather than the flag it currently passes through.
- [x] 3.5 In the `wave-state create` handler, pass `flags.change` into `createRunState` as `opts.change`.

## 4. Reconcile tests and fixtures

- [x] 4.1 Update the assertions found in 1.3 so `'unnamed'` is asserted only where no name is available from either source.
- [x] 4.2 Confirm the tests from 1.1 and 1.2 now pass.
- [x] 4.3 Add the edge-case test from the spec: a state with no name plus an invocation with no flag appends events carrying the absent-name placeholder, and the append succeeds.

## 5. Wire the default host

- [x] 5.1 In `workflows/ship.js`, add `--change` to the two `wave-state create` invocations (the plan-reuse path and the plan-rebuild path). Leave the other nine `wave-state` invocations untouched — they now inherit the name from the state, and that is the point of the change.
- [x] 5.2 Check `test/spine/prompt-integrity.test.mjs` and any prompt-snapshot tests for the two edited prompts and update the pinned text.
- [x] 5.3 In `bin/interlock-ship-acp`, confirm `--change` is passed at `create`. The redundant per-call flags at the other sites may stay; do not remove them in this change.

## 6. Verify end to end

- [x] 6.1 Run the full unit suite and confirm green.
- [x] 6.2 Run a ship workflow against a scratch change and inspect the resulting `.claude/ship/runs/<runId>.jsonl`: every event must carry the real change name, with no `unnamed` lines.
- [x] 6.3 Confirm `interlock run-log list --change <name>` filters correctly, and that it is now filtering on names recorded at source rather than on `summarizeRunLog`'s fallback.
- [x] 6.4 Confirm `interlock run-log check` still passes on the produced run — this change must not affect reconstructability.
