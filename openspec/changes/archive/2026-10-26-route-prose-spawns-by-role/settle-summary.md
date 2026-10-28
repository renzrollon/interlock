# Settle summary: route-prose-spawns-by-role

- **Branch:** `feat/leaner-review`
- **Pull request:** #25, https://github.com/renzrollon/interlock/pull/25
- **Head assessed:** `161f955745b9443e9890890c1ce57ab627ea59af`
- **Commit message:** `feat(routing): route prose spawns by role and default reviews to a lean depth`
- **PR title:** `feat(routing): route prose spawns by role, lean review by default`

---

## Summary
- A `settle --review` pass on PR #24 spawned 6 dimension reviewers plus 22 skeptics per review. Its skeptics refuted none of 49 findings. Its fix round re-ran every dimension, and 7 of its 11 findings sat in protected test paths. Routing alone lowers the price per agent, so this change also cuts how many agents run and how often.
- The CLI now publishes a role table (`SPAWN_ROUTING`) and a depth table (`REVIEW_DEPTH`). `interlock routing [role] [--depth lean|strict]` resolves a role to the `model`/`effort` a prose spawn passes, and banners any environment override. Explore, review-code and settle read those values from the command, and no skill names them.
- `/interlock:review-code` and `/interlock:settle --review` now run the lean depth by default: two always-on dimensions and two skeptic agents per review. `--strict` restores the full review (four always-on dimensions, two skeptics per finding that run the check). The depth is recorded and named in the merge verdict.
- A settle round now re-reviews only the dimensions whose findings it fixed, carrying the rest forward as `open (carried)`. It defers findings in protected test paths and findings an earlier fixer declined, and stops when nothing fixable remains. As of review round 1, the briefing's deferrals are kept in a record (`remediate-brief --out`) that `fixer-result --brief` reads, so they are not computed a second time.

## Merge confidence

**HUMAN** · score 58 (amber range 40–79; 8 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `161f955745b9443e9890890c1ce57ab627ea59af` against `origin/main` (merge base `e17e3d8441ffed81e73ffbaa04a83f0c10408bb5`).

**Needs a fix**

- `spec.coverage` (amber): `1 added source file(s) no spec names: lib/routing.mjs`

**Needs a person**

- `diff.shape` (amber): `3423 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 68 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`
- `decisions.open` (amber): `the decision ledger holds 2 needs-human row(s)`

**Needs more evidence**

- `conformance.delta` (amber): `1 of 70 scenario(s) unconfirmed`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `verify.suite` no-typecheck, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `conformance.living` requirements-omitted

**Labels:** `interlock/human-review`, `interlock/score-58`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 5 surviving finding(s)`<br>`5 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2`<br>`no surviving warning` |
| `review.ran` | green |  | `every selected dimension ran with its rubric`<br>`selected: blast-radius`<br>`ran: blast-radius`<br>`depth: lean` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 11 non-docs path(s) with no matching risk rule: bin/interlock; lib/cli-flags.mjs; lib/doctor.mjs (+8 more)` |
| `verify.suite` | green | no-typecheck | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `14 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`cli-smoke (ubuntu-latest): pass`<br>`cli-smoke (macos-latest): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)`<br>`cli-smoke: pass (required)` |
| `conformance.delta` | amber |  | `1 of 70 scenario(s) unconfirmed`<br>`70 of 70 scenario(s) checked (the command counted 70); 1 unconfirmed` |
| `conformance.living` | green | requirements-omitted | `5 of 5 living requirement(s) checked, none unconfirmed`<br>`5 of 5 living requirement(s) checked (the command counted 5); 0 unconfirmed`<br>`5 requirement(s) asked and 41 left out by the size bound`<br>`left out: effort-routing: Control-plane and prose spawns SHALL inherit the host's effort`<br>`left out: effort-routing: An environment override of effort SHALL be bannered`<br>`left out: hooks/launch-guard: A second ship launch without a human prompt since the last SHALL be denied`<br>`left out: hooks/launch-guard: The launch ledger SHALL be per session, created only by an accepted launch, and bounded by a published age`<br>`left out: hooks/launch-guard: Every unknown SHALL allow, and only the launch branch may deny`<br>`left out: hooks/launch-guard: The guard SHALL be registered on four events and tested as a process`<br>`left out: hooks/launch-guard: The launch rule SHALL live in one Node-free module that both forms of the guard read`<br>`left out: hooks/launch-guard: An in-process guard SHALL deny a second ship launch from the engine's own prompt origin`<br>`left out: hooks/launch-guard: The in-process ledger SHALL be session state declared in the plugin's type contract`<br>`left out: hooks/launch-guard: Which form of the guard is active SHALL be stated, and the in-process deny SHALL preempt the settings form`<br>`left out: review/merge-confidence: The verdict SHALL be the worst band over every gating signal`<br>`left out: review/merge-confidence: A flag SHALL lower the score and SHALL NOT move a band`<br>`left out: review/merge-confidence: The score SHALL be bounded by the worst band and ordered by clean signals`<br>`left out: review/merge-confidence: A missing result SHALL be unobserved; a missing tool SHALL be a flag; a missing unit suite SHALL never be a flag`<br>`left out: review/merge-confidence: The review signals SHALL read the adjudicated review`<br>`left out: review/merge-confidence: The risk signal SHALL be computed over the touched paths and SHALL never be red`<br>`left out: review/merge-confidence: The verification signals SHALL read the final verification verdict, one band per outcome`<br>`left out: review/merge-confidence: The coverage signal SHALL judge the change against the base, not against an absolute bar`<br>`left out: review/merge-confidence: The pipeline signal SHALL read the platform's checks for the head commit`<br>`left out: review/merge-confidence: The delta-conformance signal SHALL read the handoff's answers against the command's own checklist`<br>`left out: review/merge-confidence: The change-shape signals SHALL read the diff, the ledger, drift and the run`<br>`left out: review/merge-confidence: The command SHALL run offline, treat every absent input as unobserved, and exit on the verdict`<br>`left out: review/merge-confidence: Every threshold the verdict applies SHALL be published by the limits surface and SHALL be cited by name in the output`<br>`left out: review/merge-confidence: The human-paths signal SHALL read the review policy committed at the base`<br>`left out: review/merge-confidence: The living-conformance signal SHALL read the handoff's answers against the command's own list of living requirements`<br>`left out: review/merge-confidence: The spec-coverage signal SHALL judge the source files a change adds, and SHALL flag, never band, the ones it inherited`<br>`left out: review/merge-confidence: The command SHALL accept a run's evidence file and SHALL use it only for the commit that run made`<br>`left out: review/merge-confidence: The assessment's input SHALL be gathered the same way for the command and for a run's close`<br>`left out: review/merge-confidence: Every registered signal SHALL appear in the output in a fixed order, and every gating signal SHALL have a producer`<br>`left out: review/merge-confidence: A run's evidence SHALL be used only for the diff that run reviewed`<br>`left out: review/merge-confidence: An observation the run record does not carry SHALL be unobserved, never a zero`<br>`left out: review/merge-confidence: Changed source the coverage report does not list SHALL be flagged, and SHALL NOT pass unremarked`<br>`left out: review/merge-confidence: The command SHALL name the commit and the base it assessed, and SHALL print the labels for its verdict`<br>`left out: review/merge-confidence: With '--markdown' the command SHALL print the description block and nothing else`<br>`left out: review/merge-confidence: Every registered signal and every flag SHALL have a row in the delivery documentation`<br>`left out: review/merge-confidence: A file at the repository root SHALL be named by its './' form, and a bare file name SHALL NOT be read as a path mention`<br>`left out: ship/lane-merge: A batch of disjoint lane worktrees SHALL fold cleanly`<br>`left out: ship/lane-merge: Fold contention SHALL include every path the fold will mutate`<br>`left out: ship/lane-merge: A real path collision at merge time SHALL halt, never auto-resolve`<br>`left out: ship/lane-merge: Worktree location and fold SHALL be deterministic across replays`<br>`left out: ship/lane-merge: Lane worktrees SHALL be cleaned up deterministically, and survivors named on halt` |
| `spec.coverage` | amber |  | `1 added source file(s) no spec names: lib/routing.mjs`<br>`added, named by no spec: lib/routing.mjs`<br>`32 of 149 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `3423 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 68 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`<br>`3423 changed line(s) (added plus deleted), 68 changed file(s)` |
| `decisions.open` | amber |  | `the decision ledger holds 2 needs-human row(s)`<br>`needs_human D1: Confirm the initial 'SPAWN_ROUTING' values, or change a row: explore-investigator sonnet/medium, review-dimension sonnet/medium with a 'strict' override of inherit/inherit, review-skeptic inherit/EFFORT.skeptic, settle-fixe…`<br>`needs_human D13: Confirm the 'REVIEW_DEPTH' values, or change a row: default lean; lean always runs language and technical-lead with two per-review skeptics; strict always runs language, architecture, qa and technical-lead with two per-fin…` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`1 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | green |  | `no changed path falls under the 1 always-human-review path(s) listed at origin/main`<br>`always-human-review paths read from origin/main: .github/workflows`<br>`88 changed path(s), none under a listed path` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **spawn-routing**: role table, the `interlock routing` query, spawn sites that read it and print `ROUTING UNAVAILABLE` when they cannot, and a doctor line for the per-call effort floor (Claude Code 2.1.292)
  - `lib/limits.mjs`, new `lib/routing.mjs`, `bin/interlock`, `lib/host/claude-env.mjs`, `lib/doctor.mjs`, `skills/explore`, `skills/spec`, `shared/TOOL-ECONOMY.md`
- **review/review-depth**: `lean`/`strict` depths, `--strict` on review-code and settle, `REVIEW DEPTH:` line, `depth` in the dimension record, per-review skeptics at lean
  - `lib/limits.mjs`, `lib/review-core.mjs`, `skills/review-code/SKILL.md`, `skills/settle/SKILL.md`
- **review/settle-loop**: scoped re-review with `interlock review --carry`, `reReviewDimensions` in `remediate-brief --json`, protected-path and declined deferrals, `--previous`, `remediate-brief --out` / `fixer-result --brief`, `open (carried)` in the reply table
  - `lib/settle-cli.mjs`, `lib/review-core.mjs`, `lib/cli-flags.mjs`, `lib/prompts/settle-remediate.mjs`
- **review/merge-confidence**: the ran signal's evidence names the review depth
  - `lib/merge-confidence.mjs`
- **openspec**: archives `close-the-merge-request-loop` and `rename-the-review-loop-to-settle` and syncs their deltas into `openspec/specs/` (commit a96cb82)

## High Risk Changes
- **Reviews get shallower by default.** A lean review always runs only language and technical-lead (the conditional dimensions keep their triggers), with two skeptic agents per review. A `MERGE` from a lean review names its depth in the ran signal. Rollback: pass `--strict`, or change the default row in `REVIEW_DEPTH` (`lib/limits.mjs`).
- **Spawns move off the session model.** Investigators, dimension reviewers and the conformance worker run on the published row instead of inheriting. A routing failure falls back to the strict shape at session defaults (`ROUTING UNAVAILABLE`), never to a cheaper review.
- **`bin/interlock` is 173 bytes under the package-size pin** (245,587 of 245,760). The next edit to the binary has to move code into `lib/` first.

## Prerequisites to Production
None. The per-call `effort` parameter needs Claude Code 2.1.292 or later. An older host ignores it, and `interlock doctor` reports that.

## Testing
- Unit: new `test/spine/routing.test.mjs`, with additions to `limits`, `cli`, `settle-cli`, `merge-confidence`, `doctor`, `cli-arguments`, `cli-inventory` and `skills` tests. `npm test` passes at 161f955: 4252 tests, 4241 pass, 0 fail, 11 skipped (sandbox/CI-only).
- Verified locally: this PR was settled with the repo's own lean `settle --review` loop. Round 0 ran 4 dimensions + 2 per-review skeptics, round 1 re-reviewed `blast-radius` only and carried 4 findings forward, and the CLI stopped the loop (no surviving blocker).
- Not covered: the round 1 fix (`remediate-brief --out`, `fixer-result --brief`) has spec scenarios but no tests yet, because the fixer may not edit `test/`. Scenario C45 (a profile naming no test root still protects `*.test.*` files by name) is unconfirmed.
