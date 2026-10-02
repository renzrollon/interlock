## Context

See proposal.md for why the matrix exists. The outcome eval (`evals/ship/run.mjs`) copies a fixture to a scratch root, runs two arms, and appends to `ship-outcomes.jsonl` under schema `interlock.ship-outcome-eval/1`. Its loop arm is `bin/interlock-ship-acp` because `workflows/ship.js` cannot be driven from a shell. That host does not apply per-tier model routing. The control arm (`runControlArm` in `evals/ship/arms.mjs`) is one agent per task, then the fixture's unit command. Both arms are required to use the same model. The committed agent (`evals/ship/agent/model.mjs`) already accepts a model id and does not send `output_config.effort`.

`price-the-claude-5-5-list` is the table this sweep prices with. This change does not vendor a copy of those rates.

No new dependency.

## Goals / Non-Goals

**Goals:**

- A grid of the existing fixtures × two model ids × four efforts, recorded as rows a later limits edit can cite.
- Isolation, grading, and pricing reused from the outcome eval. One pricer.
- A published dollar ceiling that stops the sweep between cells.
- The outcome eval's default model, history file, and request shape unchanged when no cell is running.

**Non-Goals:**

- Editing `EFFORT` or `LANE_CAPS.opusMinTier`. Citing a row to do that is a later change.
- Running the wave loop, or adding an eval-only effort override inside `lib/run.mjs`.
- `max`, Haiku, a planner-versus-implementer split, compaction, or TTL changes.
- Putting the sweep on the pull-request path or in the promotion history.
- A keep-warm between cells.

## Decisions

### D1 — Control arm, not the wave loop

Each cell calls the control-arm procedure with two inputs that procedure does not vary today: the cell's API model id and the cell's effort. The loop arm cannot answer the question. It runs on the ACP host, which does not assign opus to one spawn and sonnet to another, and the product derives implementer effort from `EFFORT` rather than from the caller. Adding a matrix override in `lib/run.mjs` would be a second dial next to the table this sweep is supposed to inform.

The brief's sentence that verify stays at `EFFORT.verify` inside the cell is not how this sweep is built. Verify-at-published-effort is `dispatch-published-effort`. A verify step inside every cell would add a second model call at a fixed effort and confound the cost being compared.

Alternative: eighteen full ship loops. Rejected for the routing reason above, and because the cost would mostly be the orchestrator.

### D2 — The grid includes `xhigh` and excludes `max`

Efforts are `low`, `medium`, `high`, and `xhigh`. The hypothesis a later edit would test is tier 5 at `high` versus today's `xhigh`, so a grid that stops at `high` cannot support that edit. `max` stays out. Haiku stays out. Models are the API ids `claude-opus-5-5` and `claude-sonnet-5-5`, stored on the row as those ids, not as the planner slugs `opus` and `sonnet`.

The fixture set is whatever `listFixtureIds` returns. Today that is `docs-and-code`, `dependent-export`, and `red-until-task`. A fixture added to the outcome set joins this grid. The sweep does not grow a private list that can drift from the outcome set.

That is 3 × 2 × 4 = 24 cells on the current set. The ceiling is allowed to stop the grid early.

### D3 — Effort is an argument to the model client, omitted by every other caller

`createModelClient` gains an optional `effort`. When the matrix passes one, the Messages body includes `output_config.effort` set to that level. When the argument is omitted, the body does not contain `output_config`. The outcome eval does not pass it. A test imports both and asserts the outcome path's request has no effort field.

The cell's agent is the committed agent. An operator `INTERLOCK_ACP_COMMAND` is not used for this sweep: an external command is not version-keyed and may ignore effort. The row records the committed agent's identity. If the credential is missing, the sweep records the cell as not run with that reason and does not invent a grader failure. Same posture as the outcome eval.

### D4 — Own history file

Rows append to `cost-per-task.jsonl` under the eval history directory, schema `interlock.cost-per-task/1`. The writer copies named fields only: fixture id, model, effort, judge pass/fail, token counts, cache tier counts, `usd`, `pricesId`, `usdReason`, duration, version, timestamp. No transcript, prompt, or diff. A failed append fails the sweep. A torn last line costs that line.

`appendShipOutcome` is not called. The outcome schema's "one model, held constant" comparison stays intact.

### D5 — Ceiling is a new published cap, enforced between cells

`EVAL_CAPS.matrixCostUsd` is `40`. It is a first guess in the same posture as `shipEvalCostUsd` (20): the outcome ceiling bounds six arm-runs of the full loop, and this grid is twenty-four control-arm cells, so the first bound is twice the outcome ceiling and is expected to be tuned from the `usd` the first rows report. The number appears in `lib/limits.mjs` and in `interlock limits` only. The runner reads it from `interlock limits --json`. Before starting a cell, if the sum of priced `usd` on rows already written in this invocation is greater than or equal to the cap, the remaining cells are recorded not-run and the invocation is partial. An unpriced row does not add to the sum. A cell in flight is not killed.

The cap has a reader in the matrix runner, so publishing it satisfies cap authority. It does not gate CI.

### D6 — Pricing is `priceUsage`

The sweep passes the cell's usage, including the tier object from D2 of `price-the-claude-5-5-list`, and the cell's model id. It does not read `MODEL_PRICES` itself except to learn the id to store and to decide that a model is absent before calling it. Absence is `priceUsage`'s reason, not a zero. If that change has not landed, both grid models are absent from the old table, every cell is not-run, and the reason names the old id. That is the correct failure, and this change does not add a fallback rate.

## Risks / Trade-offs

- [Twenty-four cells cost more than the ceiling and the first sweep is partial] → Partial is a specified result. The cap is a guess and moves only by editing `EVAL_CAPS` after rows exist. The first cells in fixture order still produce comparable rows.
- [Control-arm cost is not ship-loop cost] → The row is labeled as the control procedure, not as a loop run. A later edit that cites it is citing model × effort on the fixture tasks. It is not a measurement of planner or verify spend.
- [A top-level effort on a multi-turn cell invalidates that cell's prompt cache when the next cell changes effort] → Cells are separate processes with separate prefixes. Inside one cell the effort stays constant, so the cell's own cache can hit. The sweep does not try to keep a cache warm across cells.
- [The outcome client starts sending effort because the new argument defaults wrong] → The default is omit. The test locks the request body.

## Migration Plan

Land `price-the-claude-5-5-list` first, then this change. The sweep is invocable by hand and is not added to a pull-request workflow. Rollback is deleting the runner and the cap; rows already appended stay in `cost-per-task.jsonl` and are not read by promotion.

## Open Questions

None that change the grid, the arm, or the ceiling's job. The numeric ceiling is an explicit first guess, not an open choice.
