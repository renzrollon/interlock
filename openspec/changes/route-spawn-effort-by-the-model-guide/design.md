# Design

## Context

See `proposal.md` for the motivation. The facts that shape the approach:

- **One table holds every effort a ship run passes.** `EFFORT` in `lib/limits.mjs:554-558`: `byTier` (tiers 1 and 2 `low`, 3 and 4 `null`, 5 `xhigh`), `verify` and `skeptic` (both `xhigh`). A `null` means the spawn omits the parameter and runs at the session's effort.
- **It has few readers, and each reads by name.** `laneEffort` (`lib/lane.mjs:157-160`); the verify spawn (`lib/run.mjs:1559-1560`); the two remediation spawns (`lib/run.mjs:1867-1868`, `1904-1905`); the `review-skeptic` and `settle-fixer` routing rows, which hold `EFFORT.skeptic` by reference (`lib/limits.mjs:584-585`); and the rows `formatLimits` prints (`lib/limits.mjs:884-891`). A sweep fails any published effort nothing reads (`test/spine/limits.test.mjs:287`) and any level written beside an `effort` key outside the table (`:547-569`).
- **The verify step already knows which attempt it is.** The state machine emits `fixAttempt` (0 on the initial attempt, then 1, 2, …) on every inter-wave verify step (`lib/waves.mjs:2130-2146`), and the run program already forwards it into the briefing (`lib/run.mjs:1574-1586`). The final check has no attempt counter.
- **Spawn rows have two writers.** `logSpawns` writes every spawn but the implementers (`lib/run.mjs:2580-2600`); the lane writer in `cli/interlock:1712-1732` writes one row per implementer lane. The event's fields are a whitelist in `lib/run-log.mjs:551-556`: `label`, `model`, `kind`, `taskId`.
- **Where the spend is.** 28 recorded runs: implementers 3,717,353 output tokens, verify 299,421, commit 54,406. Lanes were 160 sonnet, 18 opus, 5 haiku. Skeptics dismissed 3 of 571 findings.
- **The guide.** Well-scoped, spec-driven coding starts at `medium` and moves to `high` for harder tasks. `xhigh` scored about 1.4 points above `high` for about 2.5 times the cost. When a result falls short, raise effort one level before anything else. Source: https://claude.dev/blog/which-claude-model-should-you-build-with/

The explore brief is `.claude/handoff/explore-model-and-effort-selection-20261110-194759.md`. Its rows D1 to D8 belong to Brief 1.

## Goals / Non-Goals

**Goals:**

- A tiered lane's effort is a published value in every session.
- No spawn runs at `xhigh` by default except an inter-wave fix attempt, which follows a red check.
- The trajectory records the effort each spawn was given, so the next change to these values can be judged from recorded runs.

**Non-Goals:**

- Models. The tier-to-model rule, lane packing, the opus floor, the spawn model vocabulary and the price table are unchanged (D9, D14).
- Giving the planner, handoff, commit or replan spawn an effort or a model (D12). They stay the four inheriting spawns `effort-routing` names.
- The skeptic count, or which model skeptics run on.
- Routing the bootstrap skill's spawns. That is Brief 3 (D20).
- A report indicator over the recorded effort, and drawing it on the run board. The field is recorded now and read by `interlock run-log query`.

## Decisions

### D10 — the values

```js
export const EFFORT = {
  byTier: { 1: 'low', 2: 'low', 3: 'medium', 4: 'high', 5: 'high' },
  verify: 'high',
  verifyRetry: 'xhigh',
  skeptic: 'high'
}
```

| Value | Was | Why |
|---|---|---|
| tier 3 | inherit | The guide's start for spec-driven coding. Most lanes are tier 2 to 4 on sonnet. |
| tier 4 | inherit | The guide's next step for harder tasks. |
| tier 5 | `xhigh` | Already on the strongest spawn model; `xhigh` buys about 1.4 points for 2.5 times the cost. |
| verify | `xhigh` | A first attempt usually finds a green suite. |
| verify retry | (same as verify) | A red check earns one step up, the guide's order. |
| skeptic | `xhigh` | Same price argument as tier 5; 3 of 571 findings dismissed. |

D10 is the owner's to confirm: these are a cost policy, and no measured quality data from this repository backs them. The outcome evals have not run, and until this change no run recorded an effort. The cost-per-task sweep was built to compare a tier at `high` with today's `xhigh` (the requirement "A cell is one fixture, one priced model, and one effort" in `openspec/specs/evals/cost-per-task/spec.md`, and the grid and comment at `evals/ship/matrix.mjs:50-56`) and has not run. This paragraph records that caveat. It does not supply a sweep result, and it does not change the values in the table above.

For a session at `medium`, tier 4 lanes become dearer than today, since they inherited `medium`. That is intended: a hard task gets `high` whatever the session was left at.

### D9 — this reopens a recorded decision, for effort only

On 2026-10-26 the owner said ship's waves were fine and routing should cover only spec and settle (`openspec/changes/archive/2026-10-26-route-prose-spawns-by-role/decisions.md`, D4). The request of 2026-11-10 asks for more efficient model and effort selection in spawning. This change moves effort and leaves the tier-to-model rule and lane packing as they are.

### D22 — the ladder, and where it is decided

The verify spawn site reads one of two published values:

```js
effort: interWave && carried.fixAttempt > 0 ? EFFORT.verifyRetry : EFFORT.verify
```

`carried.fixAttempt` is the state machine's count of failed verify attempts for the wave, so the first attempt is 0 and every fix attempt is at least 1. The final check has no counter and always reads `EFFORT.verify`. Because the value is derived from the step, a resumed run routes the owed attempt as the halted run would have.

`EFFORT.verifyRetry` is a new key. The sweep at `test/spine/limits.test.mjs:287` requires `EFFORT.verifyRetry` to be read by a code path, which the spawn site does, and `formatLimits` prints it as `effort: verify retry (inter-wave fix attempt)`. `interlock limits --json` forwards the whole `EFFORT` object (`cli/interlock:3662`), so the key is carried with no edit there.

*Alternative rejected:* a ladder of more than two steps (`medium`, `high`, `xhigh`). The inter-wave check allows few fix attempts, and a third value is a third thing to tune with no data.

*Alternative rejected:* a retry effort for the final check. It has no attempt counter; adding one is a state-machine change.

### D11 — one skeptic constant, three readers

`EFFORT.skeptic` stays one string. The `review-skeptic` and `settle-fixer` rows hold it by reference and the two remediation spawns read it, so the one edit moves ship's skeptics, review-code's skeptics, settle's fixer and remediation together. `test/spine/routing.test.mjs:72-78` pins the identity and is not edited.

### D23 — the plan's "inherited by policy" label stays

The plan's effort report marks a `null` effort on a tiered lane as inherited by policy and on an untiered lane as inherited by fallback (`lib/waves.mjs:1282-1290`, `1530-1535`). With the default table no tiered lane is `null`, so the first label is not printed. The branch stays: the table may hold `null` again, and `effort-routing` still requires that a table edit alone re-routes. Only the comments that say tiers 3 and 4 inherit are corrected.

### D15, D21 and D24 — what a spawn row records

The `agent-spawn` event gains `effort`:

- `lib/run-log.mjs` exports `EFFORT_INHERITED = 'inherit'` and the event's builder gains `effort: source => nullableText(source.effort, MAX_ACTION)`.
- That builder truncates; it does not drop. `nullableText` calls `text()` (`lib/run-log.mjs:173-184`), which first trims and collapses whitespace. A string that fits after that is kept. A string still longer than `MAX_ACTION` (40) is stored as `MAX_ACTION - 1` characters of the trimmed string plus `…`, so the stored string is the bound long. It is not omitted and it is not null. A value that is not a string, or that is empty after that trim, becomes null.
- That null is written on the row. `appendRunLogEvent` writes every builder value unless the key is in `OMIT_WHEN_NULL` (`lib/run-log.mjs:850-854`), and that set (`:726-728`) covers only `run-receipt`. An `agent-spawn` row therefore carries `"effort": null` when the builder produced null. The model field already has this shape: a null model is `"model": null` on the row, the key present, not an absent key. `effort` follows it.
- `logSpawns` passes `effort: s.effort ?? EFFORT_INHERITED`.
- The lane writer in `cli/interlock` passes `effort: laneEffort(lane) ?? EFFORT_INHERITED`, importing `laneEffort` beside `laneModel`. It is the function dispatch uses, so the row and the spawn share one derivation, as the lane's model already does (D24).

A spawn given no effort is recorded as `inherit`, not left out (D21). Leaving it out would make a new row with no effort read the same as a row written before the field existed, and the point of the field is to judge these values later. The live writers coalesce `null` and `undefined` with `??`, so a spawn given no effort is recorded as `inherit`. Any other value that is not a non-empty string, including one that reaches a live writer, is stored as `effort: null`. An event appended with the field missing is that null. A reader treats that null as neither a level nor `inherit`, and treats a missing key as not recorded. The schema tag stays `interlock.ship-run/1`: the field is additive, and a reader that does not know it ignores it. The row records what was asked for, bounded by `text()` like every other free-text field; what a host applied is the adapter's own effort-routing event.

### D20 — bootstrap routing is Brief 3

The explore brief put routing the bootstrap skill's explorers and spec writers in this change (its D13, and the last clause of its D10). It needs a seventh routing role, which edits four `spawn-routing` requirements that enumerate the six, a dozen enumerations in tests, and a skill. None of it depends on the values above. It is split out as `route-bootstrap-spawns-by-role` so this gate reads one subsystem. D13 goes with it.

### Consumers of what changes

- **The effort values.** Every reader named under Context reads the table by name; none holds a copy. Prose that states the values this change moves:
  - Edited in task 2.1: the table's own comment (`lib/limits.mjs:546-553`).
  - Edited in task 2.5, comments and docs, no code path: `lib/lane.mjs:150-155`, `lib/waves.mjs:1282-1285` and `1530-1531`, the effort paragraph at `docs/04-when-it-stops.md:615`, and the comment at `evals/ship/matrix.mjs:53-54` (it says the sweep compares a tier at `high` with today's `xhigh`; the grid stays).
  - Quoted samples no code path reads, also edited in task 2.5: the plan block at `docs/assets/DESIGN-PROMPT.md:90` (`inherited (by policy) (tier 3)`); the plan blocks at `site/DESIGN-PROMPT.md:889` and `:1045` (tier 3, and tier 4); the reasoning-effort row at `site/DESIGN-PROMPT.md:1423`; the pasted limits rows at `site/DESIGN-PROMPT.md:1689-1693` and `site/Limits.dc.html:280`, which gain the verify-retry row; the remediate sentence at `site/DESIGN-PROMPT.md:745` (a fixer at `xhigh`); the same plan lines at `site/Run.dc.html:217` and `:235`.
  - Checked. In review round 0 (PR #39) two of these were found wrong and fixed. `site/DESIGN-PROMPT.md:744` called the strict review worker `xhigh`; the step has spawned one reviewer per dimension at `review-dimension`'s strict effort (`null`, `lib/limits.mjs`) since the fan-out, and the skeptics run in their own step at `EFFORT.skeptic`, so the row and its narration now say so. The halted-run board at `site/DESIGN-PROMPT.md` and `site/Run.dc.html` does not quote a stored effort: `interlock waves --format board` derives each lane's effort live (`lib/draw-plan.mjs`), so both copies were regenerated from the fixture and read `T3 medium` / `T4 high`, byte for byte the CLI's output. The mermaid block in `docs/10-agentic-workflow-ship-and-spec.md` states no level. No skill or agent definition states a level.
- **The row shape.** `lib/draw-run.mjs:163-170` builds a spawn from named fields and ignores others. `interlock run-log check` does not require the field. Tests that compare a whole row are updated under the pin rule in `tasks.md`.
- **Plan fingerprints.** The fingerprint's caps (`capsOf` in `lib/plan-fingerprint.mjs`) carry the tier→effort table as `effortByTier`, as they carry the opus floor, because the plan's lane report records each lane's effort while dispatch re-derives it. A plan stored before the change no longer matches and is planned again, one time per stored plan, with a reason naming `effortByTier`. Added in review round 0: the first draft cited the narrowing path's re-derivation (`laneEffort` in `narrowPlan`) as fingerprint coverage, and it was not.

## Risks / Trade-offs

- **No local evidence for the values** → D10 is held for the owner, and the change records effort so the next adjustment has data.
- **Skeptics at a lower effort may refute less carefully.** Dismissal is the direction the review design says must be right → the two-verdict floor and the skeptic count are untouched; only the depth of each verdict moves, and one table edit restores it.
- **Tier 5 at `high`** → the hardest lanes lose the top step. A tier-5 lane that fails its wave's check is repaired by a verify fix attempt at `xhigh`.
- **Hosts with no effort channel** (codex, qwen: `lib/host/registry.mjs:136-157`) are passed an effort on tier 3 and tier 4 lanes too, and count each in `effort routing: applied on N/M spawns` as not applied. No run stops; the summary's denominator grows.
- **One re-plan per stored plan** → spoken by the existing plan-reuse status; no action.
- **A session's `CLAUDE_CODE_EFFORT_LEVEL` still outranks all of this** and is still bannered, unchanged.
