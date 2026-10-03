## 1. Price table

- [x] 1.1 Add a failing limits test that the price-table id is `anthropic-list-2026-10`, that `claude-opus-5` and `claude-sonnet-5` are absent, and that a revision does not reuse `anthropic-list-2026-09` or `anthropic-list-2026-09b`. Verify the new assertions fail against the current table.
- [x] 1.2 Replace `MODEL_PRICES` in `lib/limits.mjs` with id `anthropic-list-2026-10`, the three model rows from the spec, per-model `cacheMultipliers.read`, and shared write multipliers `ephemeral_5m` 1.25 and `ephemeral_1h` 2. Update `formatLimits` and the JSON payload so each model prints its own read multiplier. Verify `interlock limits` and `interlock limits --json` show the new id and the three read multipliers, and the test from 1.1 passes.

## 2. Usage record

- [x] 2.1 Extend `addUsage` so a response `usage` block becomes a cache-write object keyed `ephemeral_5m` and `ephemeral_1h`. When the response carries the split, copy the split and do not also add `cache_creation_input_tokens`. When it carries only the scalar, attribute that scalar to `ephemeral_5m` and set `ephemeral_1h` to 0. Verify a unit test for both response shapes, and that a missing creation field stays absent rather than zero.
- [x] 2.2 Write that object from `reportUsage` and sum it in `readAgentUsage`. A line that has only the old scalar makes the summed write record absent. Verify a test that a current agent line prices its writes, and a scalar-only line does not become a zero write.

## 3. Pricer

- [x] 3.1 Extend `priceUsage` so the input term is uncached input only, cache read uses that model's read multiplier, and each write tier uses the shared write multiplier. A null input, output, cache read, or write record yields `usd: null` and a reason naming the missing field. An omitted tier inside a present write object prices as zero. A null tier value withholds the figure. An unknown model, or a listed model with no read multiplier, yields `usd: null` and names the table id. Lookup is the exact string. Verify the spec cases: one million opus input + one million cache read + one million 5-minute write equals 9.2; a measured zero cache read still prices input; `claude-opus-5` and `Claude-Sonnet-5-5` are unpriced.
- [x] 3.2 Point `evals/ship/run.mjs` at the updated usage object with no second conversion. Verify the outcome-eval test that prices `DEFAULT_MODEL` still prices, and a usage missing cache read is unpriced rather than priced on input and output alone.

## 4. Default model

- [x] 4.1 Set `DEFAULT_MODEL` to `claude-opus-5-5` in the same change as the table. Update tests that pinned `claude-opus-5` as the priced default (`test/spine/limits.test.mjs`, `test/spine/ship-outcome-eval.test.mjs`, `test/spine/eval-history.test.mjs`, `test/spine/ship-eval-agent.test.mjs`) without rewriting fixture rows stored under `anthropic-list-2026-09b`. Verify an unconfigured run records `claude-opus-5-5`, and an `INTERLOCK_EVAL_MODEL` of `claude-opus-5` or ` claude-opus-5-5` records that string and prices nothing.
- [x] 4.2 Confirm cap authority still passes: every printed read multiplier and both write multipliers are read by name from `priceUsage`, not only printed. Verify the existing cap-authority test passes.

## 5. Record

- [x] 5.1 Update `CHANGELOG.md` to say the table id changed and that rows under `anthropic-list-2026-09b` were not rewritten. Verify the changelog names the new id and does not claim the ship loop or `interlock report` now shows dollars.
- [x] 5.2 Run `npm test` and verify the suite passes.
