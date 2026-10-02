## Why

Opus 5.5 and Sonnet 5.5 are chosen by cost per task, not by list price, and the same effort label is not the same amount of thinking on the two models. Interlock's dials still encode the older recommendation: tiers 3 and 4 inherit the session, tier 5 is `xhigh`, and a multi-task lane reaches Opus at `LANE_CAPS.opusMinTier` (4). Nothing in the eval suite crosses `{opus, sonnet}` with effort on this repo's own fixtures and records the dollars. The next edit to `EFFORT` or the opus floor would be a guess. This change records the matrix. It does not apply a new table.

## What Changes

- Add a cost-per-task sweep beside the outcome eval, not a mode of it. It reuses the three committed ship fixtures (`docs-and-code`, `dependent-export`, `red-until-task`), their graders, and `priceUsage`. It does not fork a pricer and it does not overwrite `DEFAULT_MODEL`.
- Each cell is one fixture, one API model id, and one effort. The grid is `claude-opus-5-5` and `claude-sonnet-5-5` crossed with `low`, `medium`, `high`, and `xhigh`. Haiku is not a cell. `max` is not a cell. A model the price table does not contain is skipped and named, not run on a guessed id.
- A cell runs the control-arm procedure: one agent per task, the fixture's unit command, a scratch root outside this repository. It does not run the wave loop. The loop arm is the ACP host, which does not apply per-tier model routing, and varying implementer effort inside `lib/run.mjs` would be a second dial. Verify-at-published-effort stays the job of `dispatch-published-effort`.
- Each row records the fixture, the API model id, the effort, the judge result, input and output tokens, cache read tokens, cache write tokens by lifetime tier, the dollar figure and price-table id from `priceUsage`, and wall clock. A missing cache field stores the cell unpriced with a reason. A measured zero stays zero. A failed judge is a field on the row. It does not fail the process.
- The sweep reads a new published ceiling, `EVAL_CAPS.matrixCostUsd`, and stops before starting the next cell when the priced total would pass it. Cells not started are recorded as not run, with the ceiling as the reason. The ceiling is a first guess, printed by `interlock limits`, and it gates nothing.
- Rows go to their own append-only file. They are not appended to `ship-outcomes.jsonl`, they are not promotion trials, and they do not run on a pull request.
- `EFFORT` and `LANE_CAPS.opusMinTier` are unchanged by this change. A later limits edit may cite these rows. This change's tasks do not make that edit.

## Capabilities

### New Capabilities

- `evals/cost-per-task`: a non-gating matrix of model × effort on the committed ship fixtures. Records tokens, cache, dollars under the current price-table id, and pass/fail. Issues no verdict and moves no gate, no effort table, and no lane floor.

### Modified Capabilities

None. The outcome eval's "one model, held constant" rule stays in `evals/outcome-run`. This sweep is a different run so that rule does not have to be relaxed. Promotion, the pull-request gate, and `ship-outcomes.jsonl` are untouched; the new spec states that the matrix does not write to them.

## Impact

- `evals/ship/matrix.mjs` (new) and a small runner entry beside `evals/ship/run.mjs`. Reuses `runControlArm`-shaped execution, fixture isolation, graders, and `priceUsage`.
- `evals/ship/agent/model.mjs` — the Messages request for a cell carries `output_config.effort`. The outcome eval's client stays on its current request shape when no effort is passed, so a cell cannot change the default run by import.
- `lib/limits.mjs` — `EVAL_CAPS.matrixCostUsd` only. `EFFORT` and `LANE_CAPS` are not edited. The new cap is printed and has a reader in the matrix runner.
- `lib/eval-history.mjs` — a separate file and schema for matrix rows, not a new arm inside `interlock.ship-outcome-eval/1`.
- `docs/14-evals.md` — the sweep exists, how to run it, and that a dial change cites its rows. The doc names `interlock limits` and does not restate the ceiling or the effort table.
- `CHANGELOG.md`.
- Depends on `price-the-claude-5-5-list` for the table `priceUsage` reads. A matrix run before that change prices `claude-opus-5-5` as absent and says so.
- No new dependency. No change to ship-loop dispatch, skills, or `interlock report`.
