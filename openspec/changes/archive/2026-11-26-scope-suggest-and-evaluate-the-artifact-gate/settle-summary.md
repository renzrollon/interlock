# Settle summary

- Branch: `feat/brief-and-record-the-artifact-gate`
- Pull request: https://github.com/renzrollon/interlock/pull/47 (one PR for brief-and-record-the-artifact-gate and scope-suggest-and-evaluate-the-artifact-gate)
- Commits: fe07cea feat(review): brief and record the artifact gate from the CLI; 5113ef8 feat(review): scope, suggest and evaluate the artifact gate; 57e35ed fix(review): answer the PR #47 review round 1
- PR title: feat(review): brief, record, scope and evaluate the artifact gate
- Assessed head: 57e35edd81fab6197a75dd83817ae319d9042c74

## Description

## Summary
Change: `brief-and-record-the-artifact-gate` (openspec/changes/brief-and-record-the-artifact-gate/proposal.md)
Change: `scope-suggest-and-evaluate-the-artifact-gate` (openspec/changes/scope-suggest-and-evaluate-the-artifact-gate/proposal.md)

Merge confidence was assessed once per change. The block below is the lower score, `brief-and-record-the-artifact-gate`. The `scope-suggest-and-evaluate-the-artifact-gate` block (HUMAN 58) is comment https://github.com/renzrollon/interlock/pull/47#issuecomment-7165613500.

- The artifact gate reviewed against a generic web-app checklist kept in skill prose. By default the session that wrote the artifacts also read them, none of the repository's review context reached the gate, and its record could not say who read the change or at what depth. The 2026-11-25 revisit found that 18 of 54 corpus blockers were harness hazards the checklist does not name, and that 3 passes were later overturned by a different reader. `interlock review brief --artifacts <change>` now prints the reviewer's whole prompt: the bundled rubric and lenses, the `REVIEW.md` artifact sections, `REVIEW_CONTEXT.md` and the living requirements. Spec's own gate now defaults to one routed, independent reader (`brief-and-record-the-artifact-gate`).
- Every gate records its stage, depth, reader, lenses and the findings file it read, and `interlock report` splits the review-metrics figures by stage, depth and reader.
- A `--since` re-gate could not scope an uncommitted change, and every change is uncommitted at gate time. The gate now keeps a snapshot of the artifacts it judged, and the re-gate prints the changed hunks and a rework share. It falls back to git scoping, and says so, when there is no snapshot (`scope-suggest-and-evaluate-the-artifact-gate`).
- `interlock review-policy suggest` lists candidate `REVIEW.md` lines with their evidence and writes nothing. Three eval cases are the first to measure the gate's recall. A wording lint on `validate` never changes `ready`. An artifact blocker must now cite a line or a passage.


## Merge confidence

**HUMAN** · score 56 (amber range 40–79; 7 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `57e35edd81fab6197a75dd83817ae319d9042c74` against `origin/main` (merge base `1ec7d48895c5c26779e06f70c8ff289aee71e93d`).

**Needs a fix**

- `spec.coverage` (amber): `7 added source file(s) no spec names: lib/artifact-lenses.mjs, lib/artifact-snapshot.mjs, lib/line-diff.mjs, lib/prompts/artifact-review.mjs, lib/requirement-wording.mjs, lib/review-policy-cli.mjs, lib/review-policy-suggest.mjs`

**Needs a person**

- `diff.shape` (amber): `2714 source line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 41 source file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`
- `drift.stale` (amber): `1 other complete, unarchived change(s) on a capability this change also touches`
- `policy.humanPaths` (amber): `REVIEW.md differs from origin/main; its always-human-review list was read from origin/main (.github/workflows)`

**Needs more evidence**

- `conformance.delta` (amber): `1 of 109 scenario(s) unconfirmed`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `verify.suite` no-typecheck, `verify.suite` no-lint, `verify.suite` no-build, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `conformance.living` requirements-omitted

**Labels:** `interlock/human-review`, `interlock/score-56`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 21 surviving finding(s); its proof of coverage holds`<br>`21 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2; its proof of coverage holds`<br>`no surviving warning` |
| `review.ran` | green |  | `every selected dimension ran with its rubric and the proof of coverage holds`<br>`selected: language, regression, security`<br>`ran: language, regression, security`<br>`depth: lean` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 32 non-docs path(s) with no matching risk rule: cli/interlock; evals/artifact-gate-clean-pin-list/case.yaml; evals/artifact-gate-clean-pin-list/scaffold.sh (+29 more)` |
| `verify.suite` | green | no-typecheck, no-lint, no-build | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green; lint skipped: the profile names no lint command (no-detectable-command); build skipped: the profile names no build command (no-d…`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green`<br>`lint skipped: the profile names no lint command (no-detectable-command)`<br>`build skipped: the profile names no build command (no-detectable-command)` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `12 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`test (release npm): pass`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)` |
| `conformance.delta` | amber |  | `1 of 109 scenario(s) unconfirmed`<br>`109 of 109 scenario(s) checked (the command counted 109); 1 unconfirmed` |
| `conformance.living` | green | requirements-omitted | `4 of 4 living requirement(s) checked, none unconfirmed`<br>`4 of 4 living requirement(s) checked (the command counted 4); 0 unconfirmed`<br>`4 requirement(s) asked and 212 left out by the size bound`<br>`left out: review/merge-confidence: The verdict SHALL be the worst band over every gating signal`<br>`left out: review/merge-confidence: A flag SHALL lower the score and SHALL NOT move a band`<br>`left out: review/merge-confidence: The score SHALL be bounded by the worst band and ordered by clean signals`<br>`left out: review/merge-confidence: A missing result SHALL be unobserved; a missing tool SHALL be a flag; a missing unit suite SHALL never be a flag`<br>`left out: review/merge-confidence: The risk signal SHALL be computed over the touched paths and SHALL never be red`<br>`left out: review/merge-confidence: The verification signals SHALL read the final verification verdict, one band per outcome`<br>`left out: review/merge-confidence: The coverage signal SHALL judge the change against the base, not against an absolute bar`<br>`left out: review/merge-confidence: The pipeline signal SHALL read the platform's checks for the head commit`<br>`left out: review/merge-confidence: The delta-conformance signal SHALL read the handoff's answers against the command's own checklist`<br>`left out: review/merge-confidence: The change-shape signals SHALL read the diff, the ledger, drift and the run`<br>`left out: review/merge-confidence: The command SHALL run offline, treat every absent input as unobserved, and exit on the verdict`<br>`left out: review/merge-confidence: Every threshold the verdict applies SHALL be published by the limits surface and SHALL be cited by name in the output`<br>`left out: review/merge-confidence: The human-paths signal SHALL read the review policy committed at the base`<br>`left out: review/merge-confidence: The living-conformance signal SHALL read the handoff's answers against the command's own list of living requirements`<br>`left out: review/merge-confidence: The spec-coverage signal SHALL judge the source files a change adds, and SHALL flag, never band, the ones it inherited`<br>`left out: review/merge-confidence: The command SHALL accept a run's evidence file, SHALL use its tree-bound evidence only for the commit that run made, and SHALL carry its run record to that commit's descendants`<br>`left out: review/merge-confidence: The assessment's input SHALL be gathered the same way for the command and for a run's close`<br>`left out: review/merge-confidence: Every registered signal SHALL appear in the output in a fixed order, and every gating signal SHALL have a producer`<br>`left out: review/merge-confidence: A run's evidence SHALL be used only for the diff that run reviewed`<br>`left out: review/merge-confidence: An observation the run record does not carry SHALL be unobserved, never a zero`<br>`left out: review/merge-confidence: Changed source the coverage report does not list SHALL be flagged, and SHALL NOT pass unremarked`<br>`left out: review/merge-confidence: The command SHALL name the commit and the base it assessed, and SHALL print the labels for its verdict`<br>`left out: review/merge-confidence: With '--markdown' the command SHALL print the description block and nothing else`<br>`189 more evidence line(s) left out of this row; --json carries them all` |
| `spec.coverage` | amber |  | `7 added source file(s) no spec names: lib/artifact-lenses.mjs, lib/artifact-snapshot.mjs, lib/line-diff.mjs, lib/prompts/artifact-review.mjs, lib/requirement-wording.mjs, lib/review-policy-cli.mjs, lib/review-policy-suggest.mjs`<br>`added, named by no spec: lib/artifact-lenses.mjs`<br>`added, named by no spec: lib/artifact-snapshot.mjs`<br>`added, named by no spec: lib/line-diff.mjs`<br>`added, named by no spec: lib/prompts/artifact-review.mjs`<br>`added, named by no spec: lib/requirement-wording.mjs`<br>`added, named by no spec: lib/review-policy-cli.mjs`<br>`added, named by no spec: lib/review-policy-suggest.mjs`<br>`49 of 187 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `2714 source line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 41 source file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`<br>`source: 2714 changed line(s) in 41 file(s), counted toward the caps`<br>`test: 3694 changed line(s) in 25 file(s), not counted toward the caps`<br>`prose: 2785 changed line(s) in 37 file(s), not counted toward the caps`<br>`total: 9193 changed line(s) (added plus deleted), 103 changed file(s)`<br>`skills/, listed under Counts as Source in origin/main REVIEW.md, placed 8 file(s) and 268 line(s) in the source class`<br>`shared/, listed under Counts as Source in origin/main REVIEW.md, placed 1 file(s) and 2 line(s) in the source class` |
| `decisions.open` | green |  | `29 ledger row(s), none needing a person and none invalid`<br>`agent_resolved D1`<br>`agent_resolved D2`<br>`agent_resolved D3`<br>`agent_resolved D4`<br>`agent_resolved D5`<br>`agent_resolved D6`<br>`agent_resolved D7`<br>`agent_resolved D8`<br>`agent_resolved D9`<br>`agent_resolved D10`<br>`agent_resolved D11`<br>`agent_resolved D12`<br>`agent_resolved D13`<br>`agent_resolved D14`<br>`agent_resolved D15`<br>`agent_resolved D16`<br>`agent_resolved D17`<br>`agent_resolved D18`<br>`agent_resolved D19`<br>`agent_resolved D20`<br>`agent_resolved D21`<br>`agent_resolved D22`<br>`agent_resolved D23`<br>`agent_resolved D24`<br>`agent_resolved D25`<br>`4 more evidence line(s) left out of this row; --json carries them all` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | amber |  | `1 other complete, unarchived change(s) on a capability this change also touches`<br>`scope-suggest-and-evaluate-the-artifact-gate is complete and unarchived and also has delta specs for review/metrics-emission` |
| `policy.humanPaths` | amber |  | `REVIEW.md differs from origin/main; its always-human-review list was read from origin/main (.github/workflows)` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **spec/artifact-review-brief** (new): the CLI assembles the artifact reviewer's prompt. Lenses are chosen in a fixed order (`--lens`, then `REVIEW.md`, then detection, then none), the brief prints their provenance, and their number is capped.
  - `lib/prompts/artifact-review.mjs`, `lib/artifact-lenses.mjs`, `lib/review-cli.mjs`, `skills/review-artifacts/{rubric.md,re-gate.md,lenses/*.md}`
- **spec/artifact-gate-depth**, **spawn-routing**: `interlock routing --caller spec` answers `strict` for `artifact-reviewer`, so spec's gate spawns one `interlock:reviewer`. `--lean` restores the inline read. When the brief cannot be printed, the gate runs inline on `rubric.md`.
  - `lib/routing.mjs`, `skills/spec/SKILL.md`, `skills/review-artifacts/SKILL.md`, `shared/TOOL-ECONOMY.md`
- **review/policy-file**: `## Artifact Review Lenses` and `## Artifact Checks` are read from the base. A misnamed artifact heading is a reported problem that moves neither the proof nor the merge verdict.
  - `lib/review-core.mjs`, `lib/merge-evidence.mjs`, `REVIEW.md`, `skills/review-code/REVIEW.template.md`
- **review/metrics-emission**, **spec/machine-readable-gate-lines**: the record gains `stage`, `depth`, `reviewer`, `lenses` and `findings`, set by `interlock gate --stage --depth --reviewer --lenses`. The schema id is unchanged.
  - `lib/metrics.mjs`, `lib/cli-flags.mjs`, `lib/run.mjs`, `cli/interlock`
- **report/indicators**: the review-metrics figures are split by stage, depth and reader.
  - `lib/report.mjs`, `lib/report-html.mjs`
- **spec/artifact-re-gate** (new): the snapshot beside the findings file, plus the hunks, the rework share and the fallback under `--since`. The snapshot takes only a single-directory change name, and only a findings path inside the root. Any other value is refused aloud with `snapshot not written:` (review round 1).
  - `lib/artifact-snapshot.mjs`, `lib/line-diff.mjs`, `lib/limits.mjs`
- **review/policy-suggestions** (new): `interlock review-policy suggest [--all] [--summary]` covers triggers T1–T4 and stale Artifact Checks. The spec hand-off and settle's close print its one-line summary.
  - `lib/review-policy-suggest.mjs`, `lib/review-policy-cli.mjs`, `skills/settle/SKILL.md`
- **spec/requirement-wording** (new): `interlock validate --json` gains `wording` entries, and the spec skill prints them before the gate.
  - `lib/requirement-wording.mjs`, `lib/artifacts.mjs`
- **review/evidence-gate**: an artifact blocker with no positive `line` and no `passage` is `malformed`. It still holds the gate and still counts toward the autonomy outcome.
  - `lib/findings.mjs`, `lib/ready.mjs`
- **evals/case-suite**: three artifact-gate cases (two recall cases and one false-blocker case) with deterministic graders.
  - `evals/artifact-gate-*`, `test/evals.test.mjs`
- Docs: `docs/07`, `10`, `11`, `12`, `14`, `16`, `CHANGELOG.md`

## Must Not Change
- review-code keeps its default depth, its dimension briefs and its skeptics. A caller that the table names nothing for keeps the published default depth (`test/spine/routing.test.mjs:190`).
- The review-metrics schema id stays `interlock.review-metrics/1`, and the new keys are additive (`test/spine/metrics.test.mjs:195`, `:423`).
- A problem in the artifact sections of `REVIEW.md` moves neither `policy.humanPaths` nor the proof's source paths (`test/spine/merge-confidence.test.mjs:3421`, the `proofSourcePaths` tests in `test/spine/review-policy.test.mjs`).
- A wording entry never changes `ready`, `problems` or the exit code (`test/spine/requirement-wording.test.mjs:154`).
- Code-review findings are untouched by the citation rule: an uncited blocker outside `artifacts` stays a blocker (the guard tests in `test/spine/findings.test.mjs`). No command writes `REVIEW.md` (design Non-Goals; `review-policy suggest` is read-only).

## High Risk Changes
- Every default `/interlock:spec` gate now spawns one routed reviewer, which reads a 10–15K-token brief plus the artifacts. D1 accepted that cost. The record and the spec meter measure it, and `--lean` opts out per run.
- An older `interlock` on PATH with the newer skills: each new command degrades aloud (`ARTIFACT BRIEF UNAVAILABLE`, `ROUTING UNAVAILABLE`, one `GATE UNAVAILABLE` rerun without the recording flags, `WORDING: not reported by this CLI`), and `docs/16-upgrading.md` lists each row.
- An artifact blocker that cites nothing now reads `malformed`. It still holds the gate and counts toward `autonomyOutcome.blockers`, and readiness names the missing citation.
- Snapshots accumulate in the gitignored `.claude/metrics/snapshots/`, tens of kilobytes per gate. Nothing reads them except a `--since` that names their findings file.
- The eval cases add metered trials to a full eval job. They are full-suite only, run by hand, and no cost ceiling moves.

## Prerequisites to Production
Before merging: none
Before deploying: none (no env vars, migrations or flags). After the merge, archive `brief-and-record-the-artifact-gate` first, then `scope-suggest-and-evaluate-the-artifact-gate`, which adds requirements to `review/metrics-emission` on top of the first change.

## How to Roll Back
Undo: revert the merge commit, or `5113ef8` then `fe07cea`. The brief command, the bundled rubric files, the caller table, the record fields, the snapshot writer, the suggest command, the lint and the citation rule all leave together.
Not undone by a revert: review-metrics records already written with `stage`, `depth`, `reviewer`, `lenses` and `findings`, and the snapshots under `.claude/metrics/snapshots/`. Both are local and gitignored, and the reverted reader ignores the additive keys (D6).
Order: revert `scope-suggest-and-evaluate-the-artifact-gate` (`5113ef8`) before `brief-and-record-the-artifact-gate` (`fe07cea`), because the second builds on the first's brief and record fields.

## Testing
- Ran: unit `npm test` exit 0
- Not run: typecheck, lint, build, coverage, e2e
- Proof: the latest `Validation — 57e35edd81fab6197a75dd83817ae319d9042c74` comment on this pull request
