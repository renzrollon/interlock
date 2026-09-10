## Why

A ship run repeatedly pays for prompt-cache prefixes it could have read, and nothing in Interlock can see it. Claude Code splits every request into two TTL buckets — the *main conversation* and *everything else* (subagents, workflows, compaction) — and the CLI's main conversation runs on the 5-minute default while wave agents are on 5 minutes on every host. Measured wave gaps in this repository's own trajectory are **362.9s (6.0 min)** and **1016.7s (16.9 min)**, so each wave boundary outlives the subagent bucket and re-writes its ~30–40k spawn prefix cold. Real cold re-reads observed in this project's transcripts run to **352,598 tokens** — roughly **$5.70 of avoidable spend per miss** at the repository's own `MODEL_PRICES` opus input rate.

None of this is visible. The trajectory records exactly one token field (`outputTokens`) and no input-side field at all, so a cache miss is invisible by construction. `interlock doctor` already opens all four settings scopes and already distinguishes API-key from OAuth auth, yet never mentions the two keys that fix this. And `evals/ship/agent/model.mjs` — the one raw Anthropic API caller in the repo — sends **no `cache_control` block at all** while faithfully tallying `cache_read_input_tokens`, so it re-pays full base input on up to 60 turns and reports a permanent 0% that reads as "caching unavailable" rather than "no breakpoint sent".

A plugin cannot set either TTL: Claude Code's plugin component model has no settings component. So this change does the three things that *are* Interlock's to do — **name** the problem where an operator will see it, **measure** it so the next decision has a number, and **fix** the one place caching is provably broken and entirely ours.

## What Changes

- **The preflight advises on prompt-cache TTL.** `interlock doctor` gains a check reporting whether `promptCacheTtl` (main conversation) and `subagentPromptCacheTtl` (subagents and workflows) are set in any of the four settings scopes, alongside the detected auth mode. It reports what settings *say* — nothing exposes the effective TTL to a hook or a script — and it carries the version floors, because both keys are documented as *silently* unavailable below Claude Code v2.1.242. Advice only: `ok`/`skip`, never `fail`, following `checkNotify`'s posture exactly.
- **The trajectory records cache tokens, not just output tokens.** The run receipt gains cache-read and cache-creation figures split by TTL tier (`ephemeral_5m` / `ephemeral_1h`), recorded when the host reports them and **unknown — never zero — when it does not**. This extends the existing output-side spend requirement to the input side, under the same unknown-not-zero rule already in force.
- **Cache accounting becomes a declared host capability.** Only hosts that surface a usage envelope can report it: `lib/host/claude-cli.mjs` already parses `usage` and discards these fields, while the Workflow runtime's `budget.spent()` is a single cumulative scalar with no decomposition. The capability is declared in the host registry so the run program can branch on it and the runner can banner it, rather than a metric silently present on one host and absent on another.
- **A run records the host session identifier.** `run-start` gains the Claude Code `sessionId`, making the trajectory↔transcript join exact. Today the receipt carries `runId` and `projectSlug` and the transcript carries `sessionId`, with no key between them — the join is timestamp-overlap, and it was genuinely ambiguous during the exploration that produced this change.
- **The outcome eval sets a cache breakpoint.** `evals/ship/agent/model.mjs` marks its stable prefix with `cache_control`, so its already-existing `cacheReadInputTokens` / `cacheCreationInputTokens` tallies measure cache behaviour instead of reporting a structural zero. **This is a bug fix and lands its failing assertion first.**
- **The docs separate two things this repository currently both calls "cache".** `docs/04-when-it-stops.md` discusses only the Workflow *replay* cache (keyed on exact prompt text, what makes a resumed run skip completed agents). The Anthropic *prompt* cache is keyed on the request prefix and expires on idleness. They are unrelated, and prose about one currently reads as advice about the other.

**Explicitly out of scope**, and why:

- **No keep-warm ping, keepalive step, or Stop hook.** Structurally impossible and already adjudicated: a subagent's requests do not touch the parent's prefix, so nothing spawned inside a run can reset the main session's timer; a fixed-prompt ping would be replayed from the Workflow result cache and make no model request at all; and `docs/04:136` plus the `harden-unattended-ship-runs` design's Non-Goals reject this shape by name.
- **No cache indicator in `interlock report`.** This change records the data; whether the report surfaces it is an open policy question about `docs/12-repository-review-policy.md`'s census-versus-recommendation boundary, tracked as an unresolved decision rather than assumed.
- **No `experimental: { cacheTtl: 1h }` default on the shipped agents.** Two official Claude Code pages contradict each other on whether that field survives plugin distribution, and a 1-hour write costs 2x base against 1.25x. Shipping that default on an unmeasured hit rate would be a guess with a 60% write-price increase attached.

## Capabilities

### New Capabilities

None. Every behaviour here extends a capability that already exists.

### Modified Capabilities

- `hooks/session-preflight`: a new advisory requirement for prompt-cache TTL configuration, in the same shape as the existing "SHALL report whether push is configured, as advice" requirement.
- `ship-run`: the existing "SHALL record output-token spend per wave and per run" and "A host without token accounting SHALL record unknown, not zero" requirements extend to cache tokens; and a run records the host session identifier so a trajectory joins to its transcript.
- `run-host-adapters`: the existing "Usage SHALL be recorded when the host reports it and unknown otherwise" requirement extends to cache accounting as a separately declared capability, bannered where absent.
- `evals/outcome-run`: the existing "The eval measures cost and effort and never fabricates a measurement" requirement gains the cache breakpoint — a tally that is structurally always zero is not a measurement.

## Impact

**Code**

- `lib/doctor.mjs` — new `checkPromptCache`, sibling to `checkNotify` (`:732-750`); reuses `settingsSources()` (`:61-73`) and the existing auth-mode detection (`:872-880`). No new file reads, no new env reads.
- `lib/host/claude-cli.mjs:126-135` — widen `readClaudeEnvelope` to keep `usage.cache_read_input_tokens` and `usage.cache_creation.ephemeral_{5m,1h}_input_tokens`.
- `lib/host.mjs` / `lib/host/registry` — declare the cache-accounting capability per adapter.
- `lib/run-log.mjs` — `sessionId` on `run-start`; cache fields on `run-receipt`.
- `lib/receipt.mjs` — `buildReceipt` carries the cache figures; `formatRunSummary` states unknown where the host cannot report.
- `lib/run.mjs` — host-observed merge (`:2228-2285`) folds cache figures; the existing `TOKEN USAGE NOT REPORTED` degradation path is the model for the cache-unknown banner.
- `lib/limits.mjs` — cache-tier multipliers (5m write 1.25x, 1h write 2x, read 0.1x) under a **new** `MODEL_PRICES` id; the current table (`anthropic-list-2026-09`) has input and output only, and repository doctrine is that revising prices means a new id.
- `evals/ship/agent/model.mjs:119-134` — the `cache_control` breakpoint.

**Docs**

- `docs/04-when-it-stops.md` — the replay-cache/prompt-cache distinction and the two settings keys with their version floors.
- `docs/06-why-it-works.md §4` — token economy currently reasons about prefix *size* (`§4.1`, `:150`) and never reaches prefix *lifetime*.
- `CHANGELOG.md`.

**Tests**

- `test/spine/doctor.test.mjs` — the new check, including the never-`fail` posture.
- `test/spine/run.test.mjs`, `test/spine/host.test.mjs` — cache fields, the unknown-not-zero rule, the host capability banner.
- `test/workflows.test.mjs` — driver parity; the NO_POLICY_TOKENS sweep (`:3355-3410`) means no cache constant may live in a driver.

**Dependencies**

None. Every addition is stdlib Node against data the host already returns.

**Risk**

The cache figures are available on the runner host and not on the Workflow runtime. That asymmetry is real and must be spoken on every run that cannot report, never left as a silent absence.
