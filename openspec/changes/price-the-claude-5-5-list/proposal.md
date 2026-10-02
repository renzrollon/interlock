## Why

`MODEL_PRICES` (`anthropic-list-2026-09b`) still prices `claude-opus-5` at $15/$75 and `claude-sonnet-5` at $3/$15, with one cache-read multiplier of 0.1 for every model. The published list, confirmed on the Claude API pricing page on 2026-10-02, is Opus 5.5 at $4/$20 with a 0.05× cache read, Sonnet 5.5 at $2/$10 with a 0.1× cache read, and Haiku 4.5 at $1/$5 with a 0.1× cache read. `priceUsage` never reads the cache multipliers at all, so a cached eval run is priced as if the prefix had been sent uncached. The outcome eval's default model is `claude-opus-5`, which the new table will not contain; leaving the two apart makes every default run unpriced.

## What Changes

- Mint `MODEL_PRICES.id` `anthropic-list-2026-10`. Do not edit a number under `anthropic-list-2026-09b`. Rows already recorded under the old id keep it.
- Replace the model rows with `claude-opus-5-5` ($4 / $20), `claude-sonnet-5-5` ($2 / $10), and `claude-haiku-4-5` ($1 / $5). Drop `claude-opus-5` and `claude-sonnet-5` from the new table. A usage row that still names them is unpriced under the new id, with the existing reason. No rate is guessed from the name.
- Make the cache-read multiplier per model: 0.05 for Opus 5.5, 0.1 for Sonnet 5.5 and Haiku 4.5. Keep write multipliers shared, because the same page still shows 1.25× for a 5-minute write and 2× for a 1-hour write on all three rows: `ephemeral_5m` and `ephemeral_1h`, never summed.
- `priceUsage` adds cache read and cache write as separate terms from `inputTokens`. A null cache field withholds the dollar figure. A measured zero prices as zero. A model missing from the table, or a priced model missing its read multiplier, withholds the figure and names the table id.
- `DEFAULT_MODEL` becomes `claude-opus-5-5` in the same change as the table. `INTERLOCK_EVAL_MODEL` still overrides it. An override the table does not contain stays unpriced.
- `interlock limits` and `interlock limits --json` print the new id, the three rows, and a cache-read multiplier per model.
- The ship loop does not read the table. A missing price does not change an exit code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `evals/outcome-run`: a dollar figure is the published price table applied to measured input, output, cache-read, and cache-write tokens. The table id, the 5.5 keys, the per-model read multiplier, and the rule that a missing cache field withholds the figure are requirements. The outcome eval's default model is a key in that table.

## Impact

- `lib/limits.mjs` — new `MODEL_PRICES` object. The comment that defines a cache read as a tenth of base for every model is no longer true. `formatLimits()` prints one read multiplier per model.
- `evals/ship/arms.mjs` — `priceUsage` gains cache terms. `readAgentUsage` passes cache tokens through; today it drops them, so the pricer cannot see a field the agent already writes.
- `evals/ship/agent/model.mjs` — `DEFAULT_MODEL`. `addUsage` must keep cache writes by lifetime tier, because a 5-minute write and a 1-hour write are different prices and the agent currently collapses creation to one number.
- `evals/ship/agent/main.mjs` — the usage record already carries `cacheReadInputTokens` and a scalar `cacheCreationInputTokens`. The scalar becomes the tier object the pricer accepts, attributed at the one boundary that knows the breakpoint is `type: 'ephemeral'` (5-minute).
- `evals/ship/run.mjs` — already calls `priceUsage`. It starts receiving an unpriced result whenever cache fields are absent, which is the requirement, not a second pricer.
- Tests that embed `claude-opus-5` as the priced default (`test/spine/limits.test.mjs`, `test/spine/ship-outcome-eval.test.mjs`, `test/spine/eval-history.test.mjs`, `test/spine/ship-eval-agent.test.mjs`) move to the new id and the new default. A fixture row stored with `anthropic-list-2026-09b` stays on that id.
- No new dependency. No skill edit. No change to `EFFORT`, `LANE_CAPS`, or `interlock report`.
