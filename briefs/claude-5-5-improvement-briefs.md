# Claude 5.5 improvement briefs

Three change briefs. Each one is the source for one OpenSpec change, in this order. Convert them with `openspec new change`; do not hand-scaffold `openspec/changes/`.

They come from the published Claude 5.5 docs and from the current working tree, not from the October 1, 2026 webinar. That page is a registration listing. The recording is not up. Speakers: Lucas Gonzalez, Ben Lehrburger. The published agenda is: which tasks belong on Opus 5.5 versus Sonnet 5.5; compare by cost per task, including a larger model at lower effort against a smaller model at higher effort; build an eval suite from your own tasks; cut cost with effort, prompt caching, and an orchestration where Opus plans and Sonnet executes.

Sources to re-read on the day a change is proposed, because a price or a default can move:

- https://www.anthropic.com/claude-opus-5-5 (2026-09-22)
- https://www.anthropic.com/claude-sonnet-5-5 (2026-09-28)
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything
- https://www.anthropic.com/webinars/building-with-the-claude-5-5-family-choosing-the-right-model-and-getting-more-from-every-token

Facts these briefs rely on, as of 2026-09-30:

| Model | API id | List $/MTok in/out | Cache read | Default effort |
|---|---|---|---|---|
| Opus 5.5 | `claude-opus-5-5` | $4 / $20 | 0.05× input ($0.20) | `medium`. Adaptive thinking is always on. |
| Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 | 0.1× input ($0.20) | API default `high`. Agentic coding guidance: `medium` for well-specified work, `high` for longer work. |
| Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 0.1× | No effort parameter. Haiku 5.5 is announced and has no id. |
| Cache writes | both 5.5 models | 5-minute write 1.25× input, 1-hour write 2× input | | Confirm on the pricing page before minting an id. |

Effort labels are not comparable across models. Opus 5.5 at the same label thinks more than Opus 5, and its default moved from `high` to `medium`. A top-level effort change invalidates the prompt cache. Caches and thinking blocks are model-bound, so a mid-session model switch drops both. Minimum cacheable prompt on these models is 512 tokens.

Repository constraints every brief inherits:

- Thresholds live in `lib/limits.mjs` and are printed by `interlock limits`. Skills and review prompts do not restate them.
- A revised price table mints a new `MODEL_PRICES.id`. Rows already recorded keep the id they were priced under.
- An unpriced model yields no dollar figure. The run still runs. The figure is never zero and never guessed from the name.
- Unknown cache or usage figures stay unknown. They are never stored as zero.
- Host degradation is spoken. A host that cannot do a thing banners it and continues.
- Guards and new advisory checks fail open.
- No new runtime dependency. The eval agent stays on global `fetch`.
- The in-flight lanes work (`LANE_CAPS.opusMinTier: 4`, sonnet for multi-task lanes below that floor) is assumed landed. None of these three changes moves that floor.

---

## Brief 1 — Dispatch the effort the table already publishes

**Suggested change name:** `dispatch-published-effort`

**Depends on:** the in-flight effort/lanes work landing first, so this change edits the spec that already describes CLI-owned routing rather than racing it.

### Why

`EFFORT` in `lib/limits.mjs` already decides what the adversarial steps cost. Verify is `xhigh`. Skeptics are `xhigh`. The effort-routing spec requires both:

> The implementer spawn SHALL pass the lane's derived effort to the agent, and the inter-wave verify step and the adversarial review skeptics SHALL run at `xhigh` regardless of any lane tier. … neither is left at the session default.

Skeptics do. Verify does not. `lib/run.mjs` builds the verify spawn with `effort: null` (the verify step near the `kind: 'verify'` spawn). `spawn()` then stores that null, and `workflows/ship.js` `spawnOne` only forwards a truthy `s.effort`:

```291:291:workflows/ship.js
    ...(s.effort ? { effort: s.effort } : {}),
```

A null effort is omitted. The verify agent inherits the session. On Claude Code that is often Medium. On the Messages API, Sonnet 5.5's default is `high` and Opus 5.5's is `medium`. The step whose job is to catch what an implementer missed runs at whatever the host happened to default, and the two hosts do not default the same way.

The same gap exists one level down. `bin/interlock-run` `spawnOne` forwards `model`, `prompt`, `schema`, `cwd`, `type`, and `tools`. It does not read `s.effort`. `lib/host/registry.mjs` `CAPABILITY_KEYS` has no effort entry (`schemaEnforced`, `modelSelect`, `worktree`, `hooks`, `usage`, `cacheAccounting`, `billing`). A run on `interlock-run` drops the lane effort the program already computed. That is a silent degradation: the Workflow host applies effort, the runner host does not, and nothing banners the difference.

The spec is also behind the code on who derives effort. It still requires `laneEffort` to exist twice, once in `lib/waves.mjs` and once mirrored in `workflows/ship.js`, because "the workflow runtime rejects module loading." The driver no longer derives effort. It forwards the field the step already carries. A parity test aimed at a mirror that is gone will either fail or pin a fiction.

Anthropic's effort docs are the reason this is the first change and not a retune. Effort is the primary cost dial on Opus 5.5 and Sonnet 5.5, and omitting it is a behavior change because the defaults moved. This change makes the published table reach the agent. It does not edit the table. Editing `byTier` before a cost-per-task sample is how a guessed `medium` becomes the new silent default.

### What changes

- The inter-wave verify spawn passes `EFFORT.verify`. The string `xhigh` is not written at the call site.
- Review, remediate, and the skeptic spawns stay on `EFFORT.skeptic`. They already do. This change adds the test that keeps them there; it does not re-implement them.
- These spawns stay at inherited effort, on purpose: the replan ping (`kind: 'ping'`, model `haiku`), `plan-waves`, `handoff`, and `commit`. The spec names verify and the skeptics. Those four are control-plane or prose steps. Say so in the spec so a later reader does not "fix" them.
- `bin/interlock-run` forwards `s.effort` into `host.spawn` the same way it forwards `s.model`: present when the step named one, omitted when it did not.
- The host registry gains an effort capability. Adapters declare whether they can apply a named effort. When a step names an effort and the host cannot apply it, the runner banners that fact and still spawns. It does not invent a flag for a binary that has no such flag. Discover the real Claude Code CLI knob and the ACP knob during design, and declare the capability from what those binaries actually accept.
- The Workflow path stays the path that already works: `workflows/ship.js` forwards `s.effort` into `agent()`. A runtime that ignores the key still runs, which the spec already requires.
- The effort-routing requirement "the planner and the runtime derive identical effort" is rewritten. The run program in `lib/run.mjs` / `lib/waves.mjs` is the only derivation. The driver forwards the step's `effort` and does not recompute it. Parity becomes: the spawn record's effort equals the lane's emitted effort, on both drivers.
- `interlock limits` already prints the effort rows. No new numbers.

### Capabilities

**Modified**

- `effort-routing`
  - Dispatch requirement: the verify spawn carries `EFFORT.verify`, and a test fails while it is null.
  - Replace the `workflows/ship.js` mirror requirement with a forward-only requirement. Both drivers pass the step's effort through. Neither re-derives it.
  - Name the spawns that inherit (ping, planner, handoff, commit) so inheritance there is the requirement, not a hole.
- `run-host-adapters`
  - Effort is a declared capability, in the same family as `modelSelect` and `cacheAccounting`.
  - A host that cannot apply effort banners it when the step named one. The spawn still happens.
- `ship/run-program` (or `workflow-host`, whichever requirement currently says the driver interprets the step)
  - The runner's `spawnOne` passes `effort` when the step carries one.

**Unchanged**

- `EFFORT.byTier`, `EFFORT.verify`, `EFFORT.skeptic`. The strings stay `low` / inherit / `xhigh` until Brief 3's matrix exists.
- `lanes` model clamp and `LANE_CAPS.opusMinTier`.

### Impact

**Code**

- `lib/run.mjs` — verify spawn `effort: EFFORT.verify`. Leave the four inheriting spawns null, with a comment that points at the spec requirement rather than at a rationale that can drift.
- `bin/interlock-run` — `spawnOne` forwards `effort`.
- `lib/host/registry.mjs` — new capability key and a legal value set. Each adapter in `lib/host/*.mjs` declares it.
- `workflows/ship.js` — already forwards. A test pins that a verify step's `effort: 'xhigh'` arrives at `agent()`. No second `laneEffort`.
- `openspec/specs/effort-routing/spec.md` — the mirror scenarios (both copies agree, divergence fails the suite) become driver-forward scenarios.

**Tests**

- A failing test first: the verify step's spawn effort equals `EFFORT.verify`, not null. Put it next to the existing skeptic assertion.
- Driver parity: Workflow and `interlock-run` both pass a named effort through, and both omit it when the step's effort is null.
- Host banner: an adapter whose effort capability is unsupported, given a step with `effort: 'low'`, emits a named banner and still returns a spawn result.
- Cap authority: `EFFORT.verify` remains a reader in `lib/run.mjs`. No literal `xhigh` beside the table.

**Docs**

- `docs/07-cli-and-configuration.md` only if the new capability is an operator-visible host fact, in the same style as the other capability banners.
- `CHANGELOG.md`.
- No skill edit. A skill that restates `xhigh` is the drift this change exists to avoid.

### Out of scope

- Any edit to `EFFORT.byTier`, including the 5.5 hypothesis (tier 3 `medium`, tier 5 `high`). That hypothesis is Brief 3.
- Moving `opusMinTier`.
- `MODEL_PRICES`.
- Per-message effort (the beta that preserves the cache when effort changes). The hosts do not expose it. A top-level effort on a fresh subagent is the case Interlock already has: each lane is its own agent, so a lane's effort does not invalidate a sibling's cache.
- Setting `max`. The 5.5 docs reserve `xhigh` and `max` for measured gains. This change applies the value the table already holds.
- Prompt text that tells the model how hard to think. Effort is the parameter. A sentence in the briefing would be a second dial.

### Decisions the design has to settle

1. **Capability shape.** Boolean `effort: true/false`, or a small enum (`flag` / `unsupported`) matching `modelSelect`. Prefer the enum if Claude Code and ACP turn out to apply effort differently. The banner text is part of the decision, so a missing capability cannot look like "effort was low."
2. **Where the banner is emitted.** The runner, when it sees `capabilities.effort` unsupported and `s.effort` set. The run program does not need a second copy of that sentence.
3. **What `interlock-run` does before the CLI flag is confirmed.** If design cannot find a real flag, the capability is `unsupported` and the banner ships. A guessed `--effort` is worse than a spoken skip.
4. **Verify model stays null.** Today the verify spawn's `model` is null (session model) while its effort becomes `xhigh`. Keep that split. Choosing Sonnet versus Opus for verify is a model-routing question, and this change does not take it.

### Task outline

1. Add the failing verify-effort assertion. Watch it fail because the spawn is null.
2. Set the verify spawn to `EFFORT.verify`. The assertion passes. Confirm skeptic spawns still read `EFFORT.skeptic`.
3. Rewrite the effort-routing mirror requirement and its scenarios. Update the parity test to compare the step's effort with what each driver forwards.
4. Discover the host knobs. Record the result in `design.md` with the command or ACP field that was found, or the explicit absence.
5. Add the capability, the runner forward, and the banner test.
6. Docs and changelog. `npm test`.

### Acceptance

- A tier-1 implementer step still carries `effort: 'low'` on both drivers.
- An inter-wave verify step carries `effort: 'xhigh'` on both drivers, read from `EFFORT.verify`.
- A ping step's effort is null, and the driver does not pass an effort key.
- A runner host that cannot apply effort prints a banner naming the step and the capability, and the step still runs.
- `interlock limits` output for the effort rows is unchanged.

---

## Brief 2 — Price the Claude 5.5 list

**Suggested change name:** `price-the-claude-5-5-list`

**Depends on:** nothing in Brief 1. Can be proposed in parallel. Lands before Brief 3, because the matrix prices tokens with this table.

### Why

`MODEL_PRICES` is the only dollar table the outcome eval is allowed to use. Its id is `anthropic-list-2026-09b`. Its rows are:

| Key | Input | Output |
|---|---|---|
| `claude-opus-5` | 15 | 75 |
| `claude-sonnet-5` | 3 | 15 |
| `claude-haiku-4-5` | 1 | 5 |

Those opus and sonnet rates are the old Opus 4 / early Sonnet list, not Opus 5.5 ($4 / $20) and not Sonnet 5.5 ($2 / $10). The cache block is one read multiplier for every model, `0.1`. Opus 5.5's published cache read is `0.05`. A single multiplier cannot say both, and the comment in `lib/limits.mjs` currently defines a read as "a tenth of base" for every model.

The id comment explains the `b` suffix: base rates were left unchanged when cache multipliers were added, because that revision was "the same published list." The 5.5 list is a different list. Doctrine in that same comment: revising a price means a new id, never an edit under the old one. Recorded rows keep meaning what they meant under `anthropic-list-2026-09b`.

Two callers make a wrong table operational rather than cosmetic.

- `evals/ship/agent/model.mjs` `DEFAULT_MODEL` is `claude-opus-5`. `priceUsage` in `evals/ship/arms.mjs` looks the model string up in `perMillionTokens`. A default that is not a key prices nothing: `usd: null` and a reason that names the table id. Pointing the default at `claude-opus-5-5` without a matching row, or updating the row without the default, darkens the cost ceiling.
- `priceUsage` prices `inputTokens` and `outputTokens` only. It does not read `cacheMultipliers` at all. The multipliers were added by `surface-prompt-cache-cost` under design D9: record them so a dollar figure becomes computable, and decide later whether to compute one. That decision is this change. Cache reads and cache writes are already on the receipt (`cacheReadInputTokens`, creation split by `ephemeral_5m` / `ephemeral_1h` in the host envelope). Leaving them out of `priceUsage` underprices a cached run and makes Brief 3's cost-per-task number a fiction.

`formatLimits()` prints one cache-read row. A per-model read multiplier has to print per model, or the operator-visible table and the JSON table diverge.

The lane floor is not part of this change. `LANE_CAPS.opusMinTier` is already 4, and `openspec/specs/lanes/spec.md` already requires multi-task lanes below that floor to dispatch on sonnet. That is the product's current answer to "Sonnet executes." Retuning it belongs to Brief 3, after a sample, not to a price-table edit.

### What changes

- Mint a new id, dated the day the pricing page is confirmed. Working name: `anthropic-list-2026-10`. Do not edit numbers under `anthropic-list-2026-09b`.
- Rows, subject to that confirmation:

  | Key | Input | Output | Cache read × input |
  |---|---|---|---|
  | `claude-opus-5-5` | 4 | 20 | 0.05 |
  | `claude-sonnet-5-5` | 2 | 10 | 0.1 |
  | `claude-haiku-4-5` | 1 | 5 | 0.1 |

- Keep write multipliers as lifetime tiers when the pricing page still shows 1.25× and 2× for every row above. If Opus and Sonnet diverge, write multipliers become per-model in the same shape as reads. They stay keyed by `ephemeral_5m` and `ephemeral_1h`, never summed into one write price.
- Drop `claude-opus-5` and `claude-sonnet-5` from the new table. A result row that still names them is unpriced under the new id, with the existing reason. Historical rows keep the old id and the old rates. Do not carry a stale key forward "so old evals still price."
- `DEFAULT_MODEL` becomes `claude-opus-5-5`, which is then a key in the table. `INTERLOCK_EVAL_MODEL` still overrides it. A sweep that sets the env to a name the table does not contain stays unpriced and says so.
- `priceUsage` grows a cache term:
  - cache read × that model's read multiplier × its input rate
  - each write tier × that tier's multiplier × the input rate
  - input and output as today
- When cache fields are absent, the returned cost is absent, with a reason that names which field was missing. A present zero is a real zero and prices as zero. Null is not a zero. This matches the receipt rule already in force.
- The figure stays an estimate for the eval ceiling and for the recorded row. It is not a bill, and it gates nothing in the ship loop. Exit codes do not change because a price was missing.
- `interlock limits` and `interlock limits --json` print the new id, the three rows, and a cache-read multiplier per model.

### Capabilities

**Modified**

- The price-table requirement that already lives with the outcome eval (archive: `evals/outcome-run`, "the eval measures cost and effort and never fabricates a measurement"). State the new id, the 5.5 keys, the per-model read multiplier, and the rule that a missing cache field withholds the dollar figure.
- `ship/cap-authority`, only if a test pins that every `MODEL_PRICES` field has a reader. `priceUsage` becomes the reader of `cacheMultipliers`, which today has a printer and no pricing reader.

**Unchanged**

- `lanes`, `effort-routing`, `LANE_CAPS`.
- `interlock report`. The archived cache change left a report indicator out on purpose, under the census-versus-recommendation line in `docs/12-repository-review-policy.md`. This change does not reopen it.
- Ship-loop behavior. No spawn reads the price table.

### Impact

**Code**

- `lib/limits.mjs` — new `MODEL_PRICES` object. Update the comment that says a read is a tenth for every model. `formatLimits()` prints per-model read multipliers.
- `evals/ship/arms.mjs` — `priceUsage` accepts cache fields and refuses to treat null cache as zero.
- `evals/ship/agent/model.mjs` — `DEFAULT_MODEL = 'claude-opus-5-5'`.
- Tests that embed `claude-opus-5` as the priced default (`test/spine/limits.test.mjs`, `test/spine/ship-outcome-eval.test.mjs`, `test/spine/eval-history.test.mjs`, `test/spine/ship-eval-agent.test.mjs`) move to the new id and the new default. Fixtures that record a historical row under `anthropic-list-2026-09b` stay on that id.

**Docs**

- `docs/14-evals.md` if it names the model or the table id.
- `CHANGELOG.md`, including the sentence that old rows remain attributable to `anthropic-list-2026-09b`.

### Out of scope

- Haiku 5.5. No id, no price, no row.
- Repricing `claude-opus-5` or `claude-sonnet-5` inside the old id.
- A ship-run dollar total on the receipt. The receipt already stores token counts. Turning those into dollars for every wave is a report-policy decision, and Brief 3 can consume the same function later if a design wants it. This change's reader is the eval pricer.
- Cache TTL settings. `interlock doctor` already advises on `promptCacheTtl` and `subagentPromptCacheTtl`. A plugin still cannot set them.
- Moving `opusMinTier` or `EFFORT`.

### Decisions the design has to settle

1. **Confirm the pricing page the day the id is minted.** If a rate differs from the table above, the design records the page's number and the date. The brief's numbers are the hypothesis, not the constant.
2. **Write multipliers, shared or per-model.** Shared unless the page shows a divergence.
3. **Input tokens versus cache tokens in the host envelope.** `lib/host/claude-cli.mjs` stores `usage.input_tokens` and `usage.cache_read_input_tokens` as separate fields. `priceUsage` must add them as separate terms and must not also scale `inputTokens` by the read multiplier. Design cites those two fields so a double count cannot sneak in.
4. **Partial usage.** Recommended rule: input and output present, cache null → `usd: null` and a reason. The alternative (price input and output, and attach `cache: unknown`) looks like a complete cost in any caller that only reads `usd`. Prefer withholding `usd`.
5. **Whether `claude-opus-5` remains the eval default for one release.** It should not. An unpriced default fails the ceiling open in a way that reads as "the sweep could not tell." The default and the table move together.

### Task outline

1. Pin the current id in a test that asserts a revision mints a new id (this assertion already exists against `anthropic-list-2026-09`; extend it so `anthropic-list-2026-09b` is also not reused).
2. Add the new table and the `formatLimits` / `--json` rows. Update the limits test to the new keys and the per-model read multiplier.
3. Extend `priceUsage` with cache terms and the null-cache case. Unit cases: opus read at 0.05, sonnet read at 0.1, a 5-minute write, a null cache field, an unknown model, a historical caller that passes no cache fields.
4. Point `DEFAULT_MODEL` at `claude-opus-5-5`. Fix the eval tests that assumed `claude-opus-5`.
5. Docs and changelog. `npm test`.

### Acceptance

- `interlock limits` shows id `anthropic-list-2026-10` (or the confirmed successor), three model rows at the confirmed rates, and a cache-read multiplier that is 0.05 for Opus 5.5 and 0.1 for Sonnet 5.5 and Haiku 4.5.
- `priceUsage` of 1,000,000 uncached input tokens on `claude-opus-5-5` is $4. The same count as cache reads is $0.20. A null `cacheReadInputTokens` returns `usd: null` and a reason. It does not return $4.
- `priceUsage` of a `claude-opus-5` usage against the new table returns `usd: null` and names the id.
- A fixture row stored with `prices.id === 'anthropic-list-2026-09b'` still displays that id. Nothing rewrites it.
- The ship loop's exit codes do not depend on the table.

---

## Brief 3 — Measure cost per task before retuning either dial

**Suggested change name:** `measure-cost-per-task`

**Depends on:** Brief 2, so the matrix is priced under the 5.5 id. Brief 1 should land first as well, so verify effort in any ship scenario the matrix runs is the published `xhigh` rather than an inherited default. The matrix itself does not require the runner effort capability, as long as the scenarios run on the Workflow host where effort already arrives.

### Why

The webinar's actual curriculum, and the 5.5 model pages, both say the same thing: choose a model by cost per task, and compare a stronger model at lower effort with a cheaper model at higher effort. Opus 5.5's own guidance is to start at `medium` and to reserve `xhigh` and `max` for a measured gain. Sonnet 5.5's agentic guidance is `medium` for well-specified work and `high` for harder work. The same label is not the same amount of thinking on the two models.

Interlock's dials encode an older recommendation. `EFFORT.byTier` is `{ 1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh' }`. The nulls inherit the session, which the limits comment describes as "xhigh for coding since w16." On Opus 5.5 that inheritance is no longer `xhigh`, and a forced `xhigh` on tier 5 is the setting the model card says overspends. `opusMinTier` is 4: a multi-task lane whose hardest task is tier 4 or 5 goes to Opus; below that, Sonnet. That floor is a reasonable reading of "Sonnet executes, Opus takes the hard lanes." It is not yet a measured one. The changelog's rationale cites 5.5 bench numbers (Sonnet 5.5 near Opus on CursorBench, far above Sonnet 5 on Terminal-Bench). Those are Anthropic's tasks. The decision the product needs is the cost and the pass rate on Interlock's own ship scenarios.

Interlock already has the apparatus: `evals/ship/`, `EVAL_CAPS`, a non-gating posture, `priceUsage`, and a promotion path that refuses to move a gate without repeated evidence. What it does not have is a frozen matrix of `{opus, sonnet} × {low, medium, high}` on scenarios this repo actually ships. Without that, the next edit to `EFFORT` or `LANE_CAPS.opusMinTier` is a guess with a cache-invalidating side effect (a top-level effort change drops the prefix cache).

This change builds the matrix and records it. It does not apply a new table. Applying the table is a follow-up limits edit that cites the matrix, small enough to be its own change or a second commit inside this one once the numbers exist. The design picks which, and the tasks do not start by editing `byTier`.

### The hypothesis the matrix is for

Not a new default. The question the runs answer:

| Lane | Today | Hypothesis to compare |
|---|---|---|
| Tier 1–2 | `low` | `low` (expect this to hold) |
| Tier 3 | inherit | explicit `medium` |
| Tier 4 | inherit | `medium` and `high`, both cells |
| Tier 5 | `xhigh` | `high` and `xhigh`, both cells |
| Verify, skeptic | `xhigh` | hold `xhigh` unless a cell shows the same catches at `high` for less money |
| Multi-task opus floor | hardest tier ≥ 4 | hold 4 unless Sonnet at `high` matches Opus at `medium` on the tier-4 scenarios |

Model cells are the planner slugs `opus` and `sonnet`, resolved through the existing model map to `claude-opus-5-5` and `claude-sonnet-5-5`. Haiku is not a cell. A scenario that the map cannot resolve is skipped and named, not run on a guessed id.

### What changes

- A small frozen set of ship scenarios, on the order of five to ten, drawn from existing eval fixtures where those fixtures already represent a tier. Each scenario records its tier, its lane shape (single-task, chain, cohesion), and the model and effort of that cell.
- Each cell records: pass or fail against the scenario's existing judge, input tokens, output tokens, cache read tokens, cache write tokens by tier, the priced dollars from Brief 2's `priceUsage`, and wall clock. A missing cache field is an unpriced cell with a reason, not a zero.
- The sweep is non-gating. It does not change `EVAL_CAPS` promotion rules and does not fail CI because Sonnet lost a cell. A cost ceiling for the sweep itself comes from the existing eval caps or from a new non-gating cap in `EVAL_CAPS` if the current smoke ceiling cannot cover a matrix. The cap is a code constant, printed by `interlock limits`.
- Output is a recorded result the triage and report paths can read later, in the same corpus style as the outcome eval: one row per cell, the price-table id on the row, the model id, the effort string. Unknown stay unknown.
- A short doc, in `docs/14-evals.md`, says what the matrix is for and how to read a cell. It does not restate `opusMinTier` or the effort table. It points at `interlock limits`.
- The design's closing section is a decision slot: "given these cells, change nothing" is an allowed outcome. A retune, if the numbers support one, is a separate edit to `lib/limits.mjs` with the matrix id in the changelog. This change's tasks do not include that edit.

### Capabilities

**New**

- `evals/cost-per-task`: a non-gating matrix over model × effort on frozen ship scenarios. Records tokens, cache, dollars under the current `MODEL_PRICES.id`, and pass/fail. Issues no verdict and moves no gate.

**Modified**

- `evals/outcome-run` or `evals/case-suite`, only to say this matrix is a sibling of the outcome run and reuses its pricing and unknown-not-zero rules. Prefer a new spec over bending the outcome-run requirements if the outcome run's "one model, held constant" rule would have to be relaxed. `DEFAULT_MODEL` staying constant for the outcome eval is load-bearing ("a comparison across plugin versions is only meaningful when the model is held constant"). The matrix varies the model on purpose, so it is a different run, not a mode flag on the outcome eval.

**Unchanged**

- `EFFORT`, `LANE_CAPS`, lane dispatch, verify effort.
- Promotion (`evals/promotion`). A matrix cell is not a qualifying trial.
- `interlock report` indicators. Same docs/12 boundary as Brief 2.

### Impact

**Code**

- `evals/ship/` — a matrix runner beside the outcome runner, or a mode that cannot be confused with it. Reuse `priceUsage`. Do not fork a second pricer.
- `lib/limits.mjs` — only if the sweep needs its own ceiling. A new `EVAL_CAPS` field, printed, with a reader. No change to `EFFORT` or `LANE_CAPS`.
- Scenario fixtures under the existing eval fixture layout. New fixtures follow the fixture spec already in `openspec/specs/evals/outcome-fixtures/spec.md` rather than inventing a second layout.

**Docs**

- `docs/14-evals.md` — how to run the matrix and how to read a cell. The hypothesis table can live in the change's `design.md`. The human doc says the matrix exists and that dial changes cite it.
- `CHANGELOG.md`.

**Tests**

- A fixture cell with known token counts prices to a known dollar figure under the Brief 2 table, including a cache read.
- A cell with null cache tokens is stored unpriced, with a reason.
- The sweep's exit code is 0 when a cell fails its judge. The failure is in the row.
- The outcome eval's `DEFAULT_MODEL` is still a single model. A test that the matrix imports do not overwrite it.

### Out of scope

These are real follow-ons. They are not tasks in this change. Each one needs a signal from this matrix, or a host capability that does not exist yet, before it deserves a change of its own.

- **Applying the hypothesis.** No edit to `byTier` or `opusMinTier` in this change's first commit. A follow-up may do it, citing cell ids.
- **An Opus-planner / Sonnet-lane mode beyond the floor.** `plan-waves` already spawns with `model: null`, and lanes below the floor already go to Sonnet. A dedicated planner model is a separate change, and only if plan quality on these scenarios is the thing that fails.
- **Unattended `end_turn` on a progress note.** Opus 5.5 prompting docs warn that a progress update can arrive as `end_turn` and look like the agent stopped. Add a continue-against-checklist path only after a Workflow transcript shows that halt. The existing run step caps stay the bound.
- **Elapsed-time lines in briefings.** Anthropic's multi-agent note is that a harness should tell the model how long it has been running. A decorator in `lib/prompts/` is a small later change. It is not required to interpret the matrix.
- **Haiku 5.5.** When an id and a price exist, a one-row change maps the `haiku` slug. Not before.
- **Messages-API compaction, context editing, `between_tools`, per-message effort.** Relevant to `evals/ship/agent/model.mjs` if a later change grows that loop. Not to the Workflow host until a capability is declared, Brief 1's pattern.
- **Setting `subagentPromptCacheTtl`.** Still operator-side. Doctor already speaks. The matrix's cache columns are what tell an operator whether the 1-hour tier is worth the 2× write. The change may mention the existing doctor check in the doc. It does not add a second check.
- **A keep-warm ping between waves.** Already rejected. Wave gaps of 363s and 1017s are why the cache columns matter. They are not a reason to add a ping.

### Decisions the design has to settle

1. **Which scenarios.** Name them. Prefer fixtures the outcome suite already trusts. Five that span tier 1, tier 3, and tier 4-or-5 beat fifteen that all look like a rename.
2. **Where effort is applied inside a cell.** The scenario's implementer spawn gets the cell's effort. Verify stays at `EFFORT.verify` so the matrix does not confound "Sonnet failed" with "verify inherited Medium and missed it." That is why Brief 1 lands first.
3. **Sweeps and money.** A 10 × 2 × 3 matrix is 60 ship-shaped runs. Design states the ceiling and whether the sweep is local-only, scheduled, or both. It stays outside the PR gate, same posture as the full outcome run.
4. **Retune mechanics.** Either "this change never edits `EFFORT`" or "a second commit inside this change may, and only by citing rows." Pick one in `design.md`. The first is cleaner. The second is how the hypothesis actually ships without a fourth change sitting in the queue.
5. **Slug resolution.** Cells store the API id they ran, not only `opus` / `sonnet`, so a model-map change later cannot reinterpret the row.

### Task outline

1. Spec the new capability: non-gating, unknown-not-zero, price-table id on every priced row, no effect on promotion or on the ship exit code.
2. Pick the scenario list in `design.md` with a one-line reason each.
3. Record one cell end to end against a fixture, including a cache-read price from Brief 2. Assert the unpriced null-cache case.
4. Run the matrix. Check the recorded rows by hand before writing any sentence about what the floor should be.
5. Doc and changelog. If decision 4 allows a retune in this change, it is a later task that quotes row ids and edits only `lib/limits.mjs` plus the spec sentences that embed today's table (`effort-routing` still says tier 5 → `xhigh` and tier 3–4 → inherit). If it does not, stop at the recorded rows.

### Acceptance

- A completed sweep produces one row per cell with model id, effort, judge result, token counts, and either a dollar figure tied to the current price-table id or a reason.
- A failed judge does not fail the process.
- `EFFORT` and `LANE_CAPS.opusMinTier` are byte-identical at the end of the change, unless the design's retune decision was explicitly taken and the changelog cites the rows.
- The outcome eval still runs one model, the Brief 2 default.

---

## What is not a fourth brief

The October 1 session may still answer things this file cannot: their exact cost-per-task accounting, where they draw the plan-versus-execute line, how `agent({ effort })` relates to the API defaults, any new TTL guidance for minute-scale gaps between waves, whether cyber fallbacks can swap the model under an orchestrator, and whether `max` versus `xhigh` being non-monotonic on some Sonnet benches means a cap. If the recording publishes a concrete answer that contradicts a hypothesis above, the affected brief changes before the OpenSpec change is cut. The three change boundaries stay.
