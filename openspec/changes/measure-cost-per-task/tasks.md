## 1. Model client

- [x] 1.1 Add an optional `effort` argument to `createModelClient`. When it is set, the Messages body includes `output_config.effort` at that level. When it is omitted, the body has no `output_config`. Verify a unit test for `low` and for the omitted case, and that loading this client does not change the outcome eval's default model.
- [x] 1.2 Verify an outcome-eval request built the way `evals/ship/run.mjs` builds one still has no effort field after the argument exists.

## 2. Result record

- [x] 2.1 Add an append-only `cost-per-task.jsonl` writer, schema `interlock.cost-per-task/1`, copying only the named fields in design D4. A failed append fails the caller. A torn last line is skipped and counted. Verify a test that a fat input writes only those fields, that `ship-outcomes.jsonl` is untouched, and that a second append does not rewrite the first line.

## 3. Sweep

- [x] 3.1 Add `EVAL_CAPS.matrixCostUsd` with value 40, print it from `interlock limits`, and read it in the sweep from `interlock limits --json`. Verify the limits test shows the cap and the cap-authority check finds the sweep as its reader.
- [x] 3.2 Implement the sweep over `listFixtureIds()`, models `claude-opus-5-5` and `claude-sonnet-5-5`, and efforts `low`, `medium`, `high`, `xhigh`. Each cell runs the control-arm procedure with that model and effort, on a scratch root outside the repository. Refuse a root inside it before any cell starts. Do not call `appendShipOutcome` and do not run the wave loop. Verify a test that one fixture yields eight cells, a trailing-space model id is not called, and an in-repo root is refused with a stated reason.
- [x] 3.3 Price each finished cell with `priceUsage` and the cell's model id. Store a measured zero cache read as a priced row and an absent cache read as an unpriced row that still carries the judge result. A failed grader is a failed row and exit success. A model the current table does not contain is not-run, names the table id, and makes no request. Verify those three cases with fixture usage, no network.
- [x] 3.4 Before starting a cell, stop when the sum of priced dollars already recorded in this invocation meets `matrixCostUsd`. Record the rest as not run because of the ceiling, and mark the invocation partial. Do not kill a cell already started. An unpriced row adds nothing to the sum. Verify a test that a total already at the cap does not start the next cell and does not record it as a grader failure.

## 4. Boundaries

- [x] 4.1 Document the sweep in `docs/14-evals.md`: what it runs, that it is not the outcome eval, and that a dial change cites its rows. Name `interlock limits` and do not state `matrixCostUsd`, the effort table, or `opusMinTier`. Verify a test or a doc assertion that the page does not contain the ceiling digits.
- [x] 4.2 Confirm the sweep is not referenced from a pull-request workflow, and that `EFFORT` and `LANE_CAPS.opusMinTier` are unchanged. Verify `git diff` on `lib/limits.mjs` shows only the new cap, and no workflow under `.github` starts the sweep on `pull_request`.
- [x] 4.3 Add a `CHANGELOG.md` entry that the sweep records rows and changes no routing default. Verify the entry does not claim a new effort table.
- [x] 4.4 Run `npm test` and verify the suite passes.
