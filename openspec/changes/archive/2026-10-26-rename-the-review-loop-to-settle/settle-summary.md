# Settle summary — rename-the-review-loop-to-settle

- Branch: `feat/rename-mr-to-settle`
- Commit: `1f8ee51` feat(settle)!: rename the review loop from mr to settle
- PR: #24 — feat(settle)!: rename the review loop from mr to settle

## Description

## Summary
- The pull-request skill is renamed from `/interlock:mr` to `/interlock:settle`, so the three verbs read "spec, ship, settle". `mr` was GitLab's word for something both platforms have, and it said less than the other two names.
- MR naming is removed from every surface a person reads: CLI, help, errors, skills, docs, README and site pages. There is **no backward compatibility**, as the owner asked on 2026-10-25.
- A new residue test (`test/retired-names.test.mjs`) fails if a retired name comes back. It has a closed allow-list of GitLab's own tokens and historical ids.

## Merge confidence

**BLOCK** · score 11 (red range 0–39; 5 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `1f8ee518d62aba4479c0a8089f0431e244f2052d` against `origin/main` (merge base `780d97a6a9deb58c5612561bd5649682ff3fc820`).

**Needs a fix**

- `review.blockers` (red): `3 surviving blocker(s)`
- `review.warnings` (amber): `8 surviving warning(s) exceed MERGE_BANDS.maxWarningsForMerge = 2`

**Needs a person**

- `risk.class` (amber): `class high is outside MERGE_ALLOWED_CLASSES (low, medium), so a person decides`
- `diff.shape` (amber): `1922 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 65 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`
- `policy.humanPaths` (amber): `REVIEW.md differs from origin/main; its always-human-review list was read from origin/main (.github/workflows)`

**Needs more evidence**

- `verify.suite` (unobserved): `no verification verdict to read: the --verify input was not given`
- `verify.e2e` (unobserved): `no verification verdict to read: the --verify input was not given`
- `verify.coverage` (unobserved): `no coverage figures to read: the --coverage input was not given`
- `conformance.delta` (unobserved): `the delta specs carry 19 scenario(s) and the --handoff input was not given`
- `conformance.living` (unobserved): `5 living requirement(s) listed and no answers: the --handoff input was not given`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `spec.coverage` legacy-unspecced

**Labels:** `interlock/blocked`, `interlock/score-11`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | red |  | `3 surviving blocker(s)`<br>`blocker: test/retired-names.test.mjs — Retired-command test asserts the developer's working tree, not the command`<br>`blocker: test/retired-names.test.mjs — Residue test fails whenever the settle loop's own work directory exists in the checkout`<br>`blocker: test/retired-names.test.mjs — Residue test fails whenever the settle loop has run in this checkout, including during the loop's own verify step` |
| `review.warnings` | amber |  | `8 surviving warning(s) exceed MERGE_BANDS.maxWarningsForMerge = 2`<br>`warning: bin/interlock — Retired phrase survives in --help, split across a line wrap`<br>`warning: bin/interlock — Retired phrase survives in the CLI's own exit-code help, wrapped across a line break`<br>`warning: test/retired-names.test.mjs — Residue pin is line-local, so the CLI's column-wrapped prose structurally escapes it`<br>`warning: bin/interlock — The phrase 'merge request' survives in two shipped surfaces because it wraps across a line, and the line-based residue scan cannot see it`<br>`warning: test/retired-names.test.mjs — CHANGELOG exemption is wider than the closed allow-list the spec defines: every BREAKING bullet and the whole Upgrading subsection are skipped`<br>`warning: bin/interlock — CLI help still says "merge request", split over a line break the line-based residue scan cannot see`<br>`warning: test/retired-names.test.mjs — CHANGELOG exemption goes beyond the closed allow-list: every BREAKING bullet and the whole Upgrading section are skipped`<br>`warning: docs/16-upgrading.md — Upgrade doc still says a newer CLI has "one known break"; the rename adds a second` |
| `review.ran` | green |  | `every selected dimension ran with its rubric`<br>`selected: language, architecture, qa, technical-lead, domain, blast-radius`<br>`ran: language, architecture, qa, technical-lead, domain, blast-radius` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | amber |  | `class high is outside MERGE_ALLOWED_CLASSES (low, medium), so a person decides`<br>`class high`<br>`api-schema-migration: path lib/prompts/schemas.mjs` |
| `verify.suite` | unobserved |  | `no verification verdict to read: the --verify input was not given` |
| `verify.e2e` | unobserved |  | `no verification verdict to read: the --verify input was not given` |
| `verify.coverage` | unobserved |  | `no coverage figures to read: the --coverage input was not given` |
| `ci.pipeline` | green |  | `14 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`cli-smoke (ubuntu-latest): pass`<br>`cli-smoke (macos-latest): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)`<br>`cli-smoke: pass (required)` |
| `conformance.delta` | unobserved |  | `the delta specs carry 19 scenario(s) and the --handoff input was not given` |
| `conformance.living` | unobserved |  | `5 living requirement(s) listed and no answers: the --handoff input was not given` |
| `spec.coverage` | green | legacy-unspecced | `every one of the 2 added source file(s) is named by a spec`<br>`lib/prompts/settle-remediate.mjs is named by a delta spec of this change (delta)`<br>`lib/settle-cli.mjs is named by a delta spec of this change (delta)`<br>`9 edited file(s) no spec names: hooks/_shared.mjs, lib/cli-flags.mjs, lib/drift.mjs, lib/prompts/index.mjs, lib/prompts/schemas.mjs, lib/receipt.mjs, lib/test-paths.mjs, scripts/gen-flow-svg.mjs, scripts/postinstall-smoke.mjs`<br>`30 of 148 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `1922 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 65 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`<br>`1922 changed line(s) (added plus deleted), 65 changed file(s)` |
| `decisions.open` | green |  | `11 ledger row(s), none needing a person and none invalid`<br>`agent_resolved D1`<br>`agent_resolved D2`<br>`agent_resolved D3`<br>`agent_resolved D4`<br>`agent_resolved D5`<br>`agent_resolved D6`<br>`agent_resolved D7`<br>`agent_resolved D8`<br>`agent_resolved D9`<br>`agent_resolved D10`<br>`agent_resolved D11` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`1 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | amber |  | `REVIEW.md differs from origin/main; its always-human-review list was read from origin/main (.github/workflows)` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **review/merge-request-delivery**: `skills/mr/` moves to `skills/settle/`, and `interlock mr <sub>` becomes `interlock settle <sub>` with the same sub-verbs. `interlock mr` is now an unknown subcommand.
  - `lib/mr-cli.mjs` → `lib/settle-cli.mjs`, `lib/prompts/mr-remediate.mjs` → `lib/prompts/settle-remediate.mjs`, `bin/interlock`, `lib/cli-flags.mjs`, `lib/prompts/index.mjs`
  - Work directory `.claude/ship/mr/` → `.claude/ship/settle/`, and artifact `mr-summary.md` → `settle-summary.md`. Files at the old paths are not read.
- **review/pipeline-evidence**: `interlock pipeline --gitlab-mr` → `--gitlab-pr`, and `--gitlab … --mr <file>` → `--gitlab … --pending <file>`
  - `bin/interlock`, `lib/pipeline.mjs`, `test/fixtures/pipeline/gitlab-pr-*.json`
- **ship/close-summary**: the receipt's NEXT line names `/interlock:settle --create --review` (`lib/receipt.mjs`)
- **hooks/tool-guards**: the commit-stage requirement cites `skills/settle/SKILL.md`. This is a comment-only change in `hooks/`.
- **Docs and pages**: README, REVIEW, CHANGELOG `[Unreleased]`, docs 01/03/04/06/07/09/10/12/15, `site/DESIGN-PROMPT.md` and `site/*.html` (text patch only). The flow diagram's `mr` node becomes `settle`, and the SVGs are regenerated.
- **close-the-merge-request-loop** (active, unarchived): its delta specs and open task 8.5 are edited in place, and `review/merge-request-loop` becomes `review/settle-loop`.

## High Risk Changes
- Breaking rename with no alias. Anyone on 1.8.0 who types `/interlock:mr`, or anyone who scripted `interlock mr <sub>` (shipped in 1.9.0) or `interlock pipeline --gitlab-mr` / `--mr`, gets an unknown-skill, unknown-command or unknown-flag error. Mitigation: a CHANGELOG `[Unreleased]` line records the rename. Rollback: revert this PR. No data or state migrates, because the old work directory is scratch that every pass clears.
- The review on `1f8ee51` found that `test/retired-names.test.mjs:153` asserts the repository's own `.claude/ship/settle/` is absent, so `npm test` turns red in any checkout where a settle pass has run. It is a test defect, not a runtime one, and it is not yet fixed (see the review comment).

## Prerequisites to Production
None.

## Testing
- Unit: `test/retired-names.test.mjs` is added; `test/spine/mr-cli.test.mjs` moves to `settle-cli.test.mjs`, and the skills, pipeline, receipt, hooks and workflows pins are updated to the new names. At commit time `npm test` passed: 4198 tests, 4187 pass, 0 fail, 11 skipped. With this pass's `.claude/ship/settle/` present, `test/retired-names.test.mjs` fails 1 of 12 locally (the review's blocker).
- CI: all 13 checks pass on `1f8ee51`, including the required `test (18/20/22)`, `validate-plugin`, `cli-smoke` and `Outcome eval prepare`; one check is skipped.
- Review: six dimensions ran on `1f8ee51`, and every blocker and warning was put to two skeptics. 24 findings were raised and all 24 survived (3 blockers, 8 warnings, 13 suggestions); none was dismissed and none was dropped by quality. They are posted as a PR comment.
- Not covered: the fix rounds, scenario confirmation and head verification did not run. Round 1 stopped before it began because the working tree held an untracked `openspec/changes/route-prose-spawns-by-role/` from another session. The GitLab lines of the loop are still not exercised.
