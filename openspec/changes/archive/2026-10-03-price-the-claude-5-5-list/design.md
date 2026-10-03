## Context

See proposal.md for why the table is wrong. The pricing page checked on 2026-10-02 (https://platform.claude.com/docs/en/about-claude/pricing) is the source of the rates in the spec. Write multipliers on Opus 5.5, Sonnet 5.5, and Haiku 4.5 are all 1.25× (5-minute) and 2× (1-hour). Only the cache-read multiplier differs, and only Opus 5.5 is 0.05×. The page's general sentence "a cache hit costs 10%" is the rule for every other model, not for Opus 5.5.

`priceUsage` in `evals/ship/arms.mjs` prices `inputTokens` and `outputTokens` only. `readAgentUsage` sums those two and drops `cacheReadInputTokens` and `cacheCreationInputTokens`, which `reportUsage` in `evals/ship/agent/main.mjs` already writes. `addUsage` in `evals/ship/agent/model.mjs` folds `cache_creation_input_tokens` into one number. The receipt path in `lib/host/claude-cli.mjs` already keeps creation split by `ephemeral_5m` and `ephemeral_1h`. The eval agent does not.

No new dependency. The eval client stays on global `fetch`.

## Goals / Non-Goals

**Goals:**

- One price table id, `anthropic-list-2026-10`, that matches the 2026-10-02 list for the three models the eval can name.
- One pricer, `priceUsage`, that applies input, output, per-model cache read, and per-tier cache write, and withholds the figure when a required count is absent.
- The outcome eval's default model is a key in that table.
- Every printed cache multiplier has a reader in the pricer, so cap authority stays satisfied.

**Non-Goals:**

- Pricing a ship-loop receipt. The receipt already stores token counts. This change does not turn those into dollars and does not add a report indicator.
- Editing `anthropic-list-2026-09b` in place, or keeping `claude-opus-5` / `claude-sonnet-5` as rows so old names still price.
- Batch, fast-mode, or data-residency multipliers. The table is the standard global list.
- Haiku 5.5. It has no id.
- Any change to `EFFORT`, `LANE_CAPS`, or which model a lane dispatches.

## Decisions

### D1 — New id, three keys, per-model read, shared writes

The id is `anthropic-list-2026-10` because the rates were confirmed in October 2026 and they are not a revision of the September list. `cacheMultipliers.read` becomes a map keyed by the same model ids as `perMillionTokens`. `cacheMultipliers.write` stays `{ ephemeral_5m: 1.25, ephemeral_1h: 2 }`.

A model present in `perMillionTokens` and absent from `read` is unpriced. The pricer does not fall back to 0.1.

Alternative: keep a single read multiplier and special-case Opus in the pricer. Rejected. The special case would be a second table.

### D2 — Canonical cache-write form is the tier object, normalized once

The form `priceUsage` accepts for writes is `{ ephemeral_5m: number, ephemeral_1h: number }`, the same keys the receipt and `MODEL_PRICES.cacheMultipliers.write` already use. `addUsage` is the only place an API `usage` block becomes that object.

The committed agent sends `cache_control: { type: 'ephemeral' }`, which is the 5-minute tier. When the response has no `cache_creation` split, `addUsage` attributes `cache_creation_input_tokens` to `ephemeral_5m` and sets `ephemeral_1h` to 0. When the response has the split, `addUsage` copies the split and does not also add the scalar. A response with neither the split nor the scalar, on a request that was made, leaves the write record absent for that response's contribution only if the field was missing; a present zero stays zero. The usage line written by `reportUsage` carries the object, not the scalar.

`readAgentUsage` sums those objects. It does not look at the breakpoint and does not invent a tier. A line that still has the old scalar and no object contributes an absent write record, and the summed usage is then unpriced. Old lines are not rewritten.

Readers swept:

| Site | What it does after this change |
|---|---|
| `addUsage` | Only boundary from the API usage block to the tier object. |
| `reportUsage` | Writes the object. |
| `readAgentUsage` | Sums the object. A scalar-only line makes the sum absent. |
| `priceUsage` | The only dollar conversion. Exact model-string lookup. |
| `evals/ship/run.mjs` | Passes the usage object and the recorded model string through. Does not price on its own. |
| `formatLimits` / `limits --json` | Prints the table. Not a reader of a usage row. |
| Receipt / `lib/host/claude-cli.mjs` | Already stores the tier object and does not call `priceUsage`. Left alone. |

The model id is not normalized. Lookup is `===` against the table key. `DEFAULT_MODEL` is the string `claude-opus-5-5`. `INTERLOCK_EVAL_MODEL` is passed through unchanged.

### D3 — Absent withholds the whole figure

`usd` is null when input, output, cache read, or the write record is null. A present write object with an omitted tier treats that tier as zero, so a 5-minute-only record still prices. A tier key whose value is null withholds the figure: that is an explicit unknown, not an unused tier.

This changes today's outcome-eval behavior. A usage object that has input and output and no cache fields becomes unpriced. That is the requirement. Callers are updated in this change so the committed agent's records do carry the fields; an operator-supplied agent that writes no cache fields stays unpriced and the sweep says so.

Alternative: price input and output and attach `cache: unknown`. Rejected. Anything that reads only `usd` would treat a partial price as the cost.

### D4 — Default model and table move together

`DEFAULT_MODEL` changes in the same commit as the table. Tests that pinned `claude-opus-5` as the priced default move with it. Historical `ship-outcomes.jsonl` lines that name `claude-opus-5` and `anthropic-list-2026-09b` are not rewritten.

## Risks / Trade-offs

- [The pricing page moves after this change] → The spec names `anthropic-list-2026-10` and the rates. A later page edit is a new id and a new change, not an edit here.
- [Attributing a scalar `cache_creation_input_tokens` to the 5-minute tier mis-prices a 1-hour write] → This client only sends `type: 'ephemeral'`. The split object wins when the API sends it. A future client that requests the 1-hour tier has to send the split or the attribution is wrong; the design names `addUsage` as the one place that assumption lives.
- [Cap authority fails because a printed per-model multiplier has no reader] → `priceUsage` reads `cacheMultipliers.read[model]` and `cacheMultipliers.write[tier]` by those names. The limits test asserts each printed model has a read multiplier and that the pricer prices a cache read through it.
- [Outcome rows go unpriced until the agent writes the tier object] → The agent, the reader, and the pricer land in one change. A row from an agent that predates it is unpriced with a reason, which is the same unknown-not-zero rule the receipt already uses.

## Migration Plan

Ship the table, the pricer, the usage-record shape, and the default model together. No corpus rewrite. Rollback is reverting the commit; rows written under `anthropic-list-2026-10` stay attributable to that id even if a later commit mints another one.

## Open Questions

None. The rates were confirmed against the pricing page on 2026-10-02. Whether `interlock report` should show dollars stays deferred, on purpose, and is not required to implement this change.
