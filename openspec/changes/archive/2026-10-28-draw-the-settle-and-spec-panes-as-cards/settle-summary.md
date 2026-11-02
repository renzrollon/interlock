# Settle summary — draw-the-settle-and-spec-panes-as-cards

- Branch: feat/improve-settle-mods
- PR: https://github.com/renzrollon/interlock/pull/28
- Commits: 81102e7 chore(openspec): archive route-prose-spawns-by-role and sync its specs; 76e9092 feat(meters): draw the settle and spec panes as cards, and meter a settle pass without --review; e177e7d chore(openspec): archive the three settled changes and sync their specs
- Commit message: feat(meters): draw the settle and spec panes as cards, and meter a settle pass without --review
- PR title: feat(meters): draw the settle and spec panes as cards

## Description

## Summary
- The `/interlock-settle` and `/interlock-spec` panes were flat columns of grey text, so a reader could not tell where the review ended and a round began, which agents were skeptics and which the fixer, or what the verdict said, without reading every row. The ship meter in the same module already draws cards, theme-key colour and coloured words.
- The settle meter now starts on every `/interlock:settle` load, with or without `--review`, and the pane says which. A pass without `--review` groups its first lines under `resolve` instead of `review`.
- Both panes are drawn as cards: a header card, one bordered card per section and round, role blocks, toned words (exit codes, `STOP:`, the verdict word). Every row keeps its text exactly as before: the pure modules add structured fields (kind, section, open mark, spans that join to the text, verdict) and `hooks/mod.mjs` maps them to theme keys. Below the ship meter's card floor both panes draw the same rows flat.
- Also carries the archive and living-spec sync of `route-prose-spawns-by-role` and `agree-with-openspec-1-15` (both already merged), and of this change, `draw-the-settle-and-spec-panes-as-cards`.

## Merge confidence

**HUMAN** · score 58 (amber range 40–79; 8 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `e177e7de66d7db4ca8b0441ce9f2c41248751803` against `origin/main` (merge base `251cebe8a1368d5b7ba35656e508af19770bd6ba`).

**Needs a person**

- `diff.shape` (amber): `2586 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 46 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`

**Needs more evidence**

- `conformance.delta` (amber): `the conformance checklist could not be built: change "draw-the-settle-and-spec-panes-as-cards" not found under openspec/changes/`
- `decisions.open` (amber): `no decision ledger was read: no change is under assessment, so name one`
- `conformance.living` (unobserved): `6 living requirement(s) listed and no answers: the --handoff input was not given`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `verify.suite` no-typecheck, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `spec.coverage` legacy-unspecced

**Labels:** `interlock/human-review`, `interlock/score-58`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 0 surviving finding(s)`<br>`0 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2`<br>`no surviving warning` |
| `review.ran` | green |  | `every selected dimension ran with its rubric`<br>`selected: language, technical-lead, domain, blast-radius`<br>`ran: language, technical-lead, domain, blast-radius`<br>`depth: lean` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 4 non-docs path(s) with no matching risk rule: hooks/mod.mjs; lib/meter-palette.mjs; lib/settle-meter.mjs (+1 more)` |
| `verify.suite` | green | no-typecheck | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `12 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`cli-smoke (ubuntu-latest): pass`<br>`cli-smoke (macos-latest): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)`<br>`cli-smoke: pass (required)` |
| `conformance.delta` | amber |  | `the conformance checklist could not be built: change "draw-the-settle-and-spec-panes-as-cards" not found under openspec/changes/` |
| `conformance.living` | unobserved |  | `6 living requirement(s) listed and no answers: the --handoff input was not given` |
| `spec.coverage` | green | legacy-unspecced | `the diff adds no coverable source file, so there is nothing to name`<br>`1 edited file(s) no spec names: lib/meter-palette.mjs`<br>`34 of 150 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `2586 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 46 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`<br>`2586 changed line(s) (added plus deleted), 46 changed file(s)` |
| `decisions.open` | amber |  | `no decision ledger was read: no change is under assessment, so name one` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`0 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | green |  | `no changed path falls under the 1 always-human-review path(s) listed at origin/main`<br>`always-human-review paths read from origin/main: .github/workflows`<br>`62 changed path(s), none under a listed path` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **hooks/settle-meter**: the run starts on any settle load, records whether `--review` was passed, groups a pass without it under `resolve`, and draws a header card, section and round cards, role blocks, toned words and a verdict card coloured by `MERGE` / `HUMAN` / `BLOCK`
  - `lib/settle-meter.mjs` (`settleLoad`, `settleLoadsReview`, `freshSettle`, `GROUPS`, `settlePaneLines`), `hooks/mod.mjs` (`drawSettlePane`, the settle load observer)
- **hooks/spec-meter**: a header card, then `artifacts`, `explore`, `gates`, `writes` and `record` cards with toned status words
  - `lib/spec-meter.mjs` (`specPaneLines`, still import-free), `hooks/mod.mjs` (`drawSpecPane`)
- **meter palette**: a tone-to-props map beside the state and turn maps
  - `lib/meter-palette.mjs` (`toneProps`)
- **OpenSpec**: three changes archived, their deltas synced into `openspec/specs/` (new living specs `review/review-depth`, `spawn-routing`, `openspec-cli`)
- **Docs**: `README.md`, `CHANGELOG.md`, `docs/07-cli-and-configuration.md`, `docs/13-the-guards.md` say the settle pane covers every pass, with or without `--review`

## High Risk Changes
None for production state: the meters observe a run and decide nothing, hold only in-memory module state, and add no engine call, hooked event, dependency or limit. The visible risk is the pane itself: a rendering fault would mis-draw the settle or spec pane, not change a run. `settleLoad` now answers `settle` for a load without `--review`, so the meter and its status line appear on passes that showed nothing before; its only caller is `hooks/mod.mjs`. Rollback: revert `76e9092` for the code; the synced living specs (`openspec/specs/hooks/{settle,spec}-meter`) landed in the archive commit `e177e7d`, so reverting the code alone leaves them describing the card panes until they are reverted too.

## Prerequisites to Production
None

## Testing
- Unit: 5 test files updated (`test/spine/{settle,spec}-meter`, `test/spine/meter-palette`, `test/mod/{settle,spec}-meter.test.ts`) — `npm test` passing: 4385 tests, 4374 pass, 0 fail, 11 skipped (sandbox loopback and live-host tests; the diff touches no notify path); CI green on Node 18/20/22/24
- Verified locally: the settle review loop on this head (round 0: 4 dimensions at lean depth, no surviving finding; the CLI stopped the rounds with nothing to remediate)
- Not covered: no typecheck, coverage or e2e step is configured; the change was archived before settle, so its scenarios were not confirmed (no handoff)


