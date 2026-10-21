## Why

Two independent reviews of this repo's `spec` and `ship` loops (`.docs/WORKFLOW-REVIEW-2026-08-21.md`, `.docs/COMPETITIVE-ANALYSIS.md`) found the same pattern, and it is the one that matters most here: **every gate that checks *shape* is well tested; every gate that checks *substance* accepts anything non-empty.** Sorted by what they validate, the split is clean — `interlock ready`'s fail-closed control flow, the task-failure budget, the quality band and the never-weaken-a-test baseline are all solidly enforced, while the skeptic evidence gate, the `agent_resolved` audit and the continuity blocker count all degrade to a non-emptiness check.

That matters because this repository's entire thesis is *decisions with a correct answer leave the model*, and `README.md` stakes its strongest claims on exactly the gates that do not hold. A documented audit that does not run is worse than no audit, because it is cited as if it did. Three of these gaps are live defects that fail **silently**, verified in this checkout:

| Site | Verified behavior | Consequence |
|---|---|---|
| `workflows/ship.js:499` | a stray unary `+` coerces the tier-ladder text to the string `NaN` | every ship run classifies tiers 1–3 with no definitions, and the only mention of `haiku` is gone |
| `lib/waves.mjs:151` | the collision map is keyed on the raw predicted path | `src/a.ts` and `./src/a.ts` are different keys, so two tasks editing one file land in the same batch |
| `lib/review-core.mjs:100` | dismissal evidence is `trim().length > 0` | the string `"👍"` dismisses a blocker |

None of the 760 tests catches any of them, and the reason generalizes: prompt content is asserted against **source text** with `readFileSync` + `assert.match`, which cannot see a concatenation bug. The broken sentence is still present in the bytes of the broken file.

Doing this now, before the architectural bets (per-task worktrees, cross-family skeptics), is deliberate: those bets change what the gates *are*, and there is no point relocating a gate that does not yet hold.

## What Changes

Each item states the benefit it buys, because "the code is now correct" is not a reason a reader can weigh.

### The three silent defects

- **Fix the tier-ladder prompt corruption** at `workflows/ship.js:499` by deleting one character. **Benefit:** the classifier regains the definitions of tiers 1–3 and the `haiku` routing rule. Today it is told only about the expensive end of the ladder, so `clampModel` — which clamps opus *down* but never clamps haiku *up* — lets under-powered, under-contexted runs look correctly conservative. `tier` also drives the implementer's context rung and batch ordering, so this is not only a model-selection bug.
- **Reconcile the second tier ladder** at `bin/interlock-ship-acp:396`, which carries its own unbroken but differently worded copy. **Benefit:** the two hosts stop having two classifier policies. `lib/host.mjs` already forbids a host from carrying its own policy; this is that rule applied to the one place it drifted.
- **Normalize predicted paths before keying** the `claimed` map in `lib/waves.mjs:151`. **Benefit:** the repo's hardest-won guarantee — presented as such in both `README.md:118` and `docs/06 §5.2` — starts holding against path spelling. A randomized 3,000-plan fuzz found zero violations for exact strings, so the algorithm is right and only the key is wrong; this is the cheapest possible close of a lost-write race.
- **Require a `path:line` shape for dismissal evidence** in `lib/review-core.mjs:100`, and name a path present in the diff. **Benefit:** closes the single widest gap between advertised and actual behavior in the repo. `README.md:128` stakes its strongest claim on this rule and cites a paper about hallucinated vulnerabilities to justify it; today one emoji satisfies it. A shape predicate is deterministic and testable, which is why it is the right instrument — a semantic one would just relocate the judgement.
- **Reject out-of-enum severities** in `lib/findings.mjs:241` instead of mapping them to `unknown`. **Benefit:** a reviewer emitting `"critical"` currently *passes* the gate rather than blocking it. Same direction as the evidence gate, one line.

### Test strategy — the reason all three escaped

- **Assert every assembled prompt against its assembled output**, not its source text: extract the marker region, evaluate it, and assert no `NaN`, `undefined` or `[object Object]` appears in any prompt the loop builds. **Benefit:** the technique already exists and works — `test/spine/implementer-prompt.test.mjs` uses marker regions, `new Function` and checked-in fixtures, and would have caught a `+ +` inside `assembleImplementerPrompt` instantly. It was applied to exactly one of `ship.js`'s dozen prompts. Generalizing it turns a class of invisible corruption into a build failure.

### Gates that check substance

- **Derive the continuity blocker count from the findings file** via `interlock ready --findings <path>`, and deprecate the hand-written `--review`. **Benefit:** the one number deciding whether a human reads a spec is currently written by the party being gated — `skills/spec/continuity.md:13-16` has the agent `printf` it, and `lib/ready.mjs` validates its shape but never its provenance. `lib/findings.mjs:269` already computes the real count from the real findings and discards it. This is the highest-integrity-per-line change available in the whole spec path.
- **Implement the three `agent_resolved` claims** that `skills/spec/SKILL.md` and `shared/DECISION-LEDGER.md` already advertise: a `design.md` reference by id, `obvious` as an empty marker, and a non-zero exit when `decisions.md` is absent. **Benefit:** the audited decision ledger is a genuine differentiator — the competitive review found no equivalent anywhere in the field — and it currently does not run. Empirically, 4 active changes in this repo have 0 `decisions.md` files between them, and `interlock ledger` exits 0 on every one, so the self-check cannot catch its own likeliest failure.
- **Gate ship's completion on `verified.ok` and `unitGreen`.** **Benefit:** both fields are declared in the schema, one is `required`, and neither is branched on — so a red verify reaches the commit unless the agent also volunteers `halted:true`. The data is already paid for; this only stops discarding it.
- **Make `interlock tasks tick` exit non-zero on failure and branch on it.** **Benefit:** a completed task can currently stay unchecked invisibly, which then reads downstream as a failed task.
- **Report cap-skipped verifications, unresolved errors and the `done` step's summary in the banner block.** **Benefit:** a run that skipped checkpoints currently prints *"No degradation banners"* — the precise silence `docs/06 §13` says the block exists to remove. Spoken degradation is a stated property of this loop; here it is unspoken.

### Caps that are restated or dead

- **Move the remediation round bound into the CLI** — `workflows/ship.js:869` hardcodes `while (round <= 3)`, which is `LIMITS.remediationRounds + 1`. **Benefit:** raise the limit and the verdict round silently stops being the verdict round. This is the last place in the script that restates a cap, which is exactly what `lib/limits.mjs`'s header says the module exists to prevent.
- **Fix `summary.remediationRounds`**, which is `Math.min(round, 2)` where `round` is always 4 at loop exit — a constant. **Benefit:** the outcomes corpus exists to answer whether gates can be relaxed; a fictional field in it makes that answer unavailable.
- **Wire or remove `LIMITS.memoryEntriesPerRun` and `LIMITS.verifySpillBytes`.** **Benefit:** `interlock limits` currently advertises two caps no code obeys — `memoryEntriesPerRun` has zero references outside `limits.mjs` and docs, and the 8 KB spill *trigger* is prose while only the 4,096-char field ceiling is enforced. A printed cap that nothing reads is the same failure as a prose cap.
- **Complete the anti-swallow allowlist** `RESULT_TEXT_FIELDS` in `lib/verify.mjs:890`, which omits `summary`, `message`, `error` and `notes`. **Benefit:** the oversized-result check is solid but has four unguarded doors.

### Review inputs

- **Pass `skills/review-code/dimensions/*.md` to the `ship --review` reviewers.** **Benefit:** 6,833 bytes of criteria across six files exist and `workflows/ship.js` never points a reviewer at them — its only occurrence of the word is the field name `reReviewDimensions`. Six reviewers get a dimension *name*, then two skeptics adversarially verify findings produced without criteria. Roughly 285 tokens per agent buys the rubric the review was designed around.

### Explicit non-goals

Out of scope, each because it is a different kind of decision:

- **Per-task worktree isolation, cross-family skeptics, and the `tasks.md`→waves contract (`plan-hint.json`).** These are the reviews' architectural tier: they contradict current design bets with cited evidence and need design debate, not implementation. They also change what several gates here *are*.
- **Token and docs cleanups** — dead schema fields, per-tier rung printing, stale doc figures, the empty `openspec/config.yaml`, archiving the four completed changes. Real work, no shared invariant with this change.
- **The citation corrections** in review §6 (what `arXiv:2604.19049` actually demonstrates). Docs-only, and it argues about the architectural tier above.

## Capabilities

`openspec/specs/` is currently empty for this product (`interlock drift` reports `indexed: 0`), so every capability below is new. Paths follow the loop they gate.

### New Capabilities

- `ship/prompt-integrity`: every prompt the ship loop assembles reaches its agent intact, and is verified as assembled output rather than as source text.
- `ship/wave-isolation`: two tasks predicted to edit the same file never run concurrently, regardless of how either spells the path.
- `ship/completion-gate`: a ship run commits only on a verification the CLI judged green, and every degradation it accepted is named in the summary.
- `ship/cap-authority`: `lib/limits.mjs` is the only place a cap is stated, and every cap it prints is enforced by code.
- `review/evidence-gate`: a verdict that dismisses a finding carries a citation whose shape can be checked, and a finding's severity is either in the enum or rejected.
- `review/rubric-delivery`: a reviewer receives the written criteria for its dimension, not only the dimension's name.
- `spec/decision-ledger`: `agent_resolved` is an audited claim — resolution, followable evidence, and a `design.md` reference — and an absent ledger is a failure, not an empty one.
- `spec/continuity-provenance`: the blocker count that decides whether a human reads the spec is derived from the review's own findings file, never self-reported by the gated agent.

### Modified Capabilities

None — there are no living specs for this product yet.

## Impact

**Code.** `workflows/ship.js` (prompt assembly, completion gate, remediation bound, banner block, reviewer prompts), `bin/interlock-ship-acp` (tier ladder), `lib/waves.mjs` (collision key), `lib/review-core.mjs` (evidence predicate), `lib/findings.mjs` (severity enum), `lib/ledger.mjs` (audit rules), `lib/ready.mjs` (findings-derived count), `lib/verify.mjs` (field allowlist), `lib/limits.mjs` (dead caps), `bin/interlock` (`ready --findings`, `ledger` exit, `tasks tick` exit).

**Docs and skills.** `skills/spec/continuity.md` (stop writing the count), `skills/spec/SKILL.md` and `shared/DECISION-LEDGER.md` (claims become true rather than aspirational), `README.md:118` / `:128` and `docs/06` where they describe gates whose behavior changes.

**Tests.** New `test/spine/planner-prompt.test.mjs`; extensions to `test/spine/waves.test.mjs`, `review-core.test.mjs`, `findings.test.mjs`, `ledger.test.mjs`, `ready.test.mjs`, `verify.test.mjs`, `limits.test.mjs`, `test/workflows.test.mjs`. The reviewers wrote and executed several of these already and reported the expected failures, so the red state is known before implementation starts.

**Behavioral breaks.** Two, both fail-closed and both intended:

- **BREAKING** — `interlock ready --review <file>` is deprecated in favour of `--findings <file>`. A caller passing only `--review` gets a warning now and stops being trusted later; `skills/spec/continuity.md` is updated in this change.
- **BREAKING** — `interlock ledger <change>` exits non-zero when `decisions.md` is absent. All four active changes in this repo currently rely on the exit-0 behavior, so this surfaces immediately.

**Dependencies.** None added. Every fix uses Node built-ins already imported by the touched module.

**Blast radius note.** This change edits the gate implementations, so its *own* ship run is gated by the pre-change versions. Task ordering keeps `lib/` gate fixes ahead of the `workflows/ship.js` edits that depend on them.
