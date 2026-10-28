# Settle summary — agree-with-openspec-1-15

- Branch: feat/agree-with-openspec-1-15
- PR: https://github.com/renzrollon/interlock/pull/27
- Commits: ea50232 feat(openspec): agree with OpenSpec 1.15 on task lines, validate targets and the CLI floor; d409772 fix(review): answer the PR #27 review round 1
- PR title: feat(openspec): agree with OpenSpec 1.15 on task lines, validate targets and the CLI floor

## Description

## Summary
- Interlock was built against OpenSpec 1.4.0, which never parsed this repo's nested delta specs: every archive moved a change and left `openspec/specs/` unsynced, silently. OpenSpec 1.15.0 parses nested deltas, refuses a MODIFIED block that drops a living scenario, and counts task lines Interlock could not see, so a ship run could skip a task the CLI calls open.
- The tasks.md reader, the tick and the tick guard now count every task line OpenSpec 1.15.0 counts (`+`, ordered lists, any one-character box, empty text; only `x`/`X` is done).
- `interlock doctor` warns (never fails) when the OpenSpec CLI on PATH is below a published floor, `OPENSPEC_MIN_VERSION` = 1.8.0.
- The authoring skills validate a named target (`openspec validate "<name>"`, `openspec validate --specs`) instead of a bare `openspec validate` that checks nothing, and the two requirement-free retired living specs are deleted because 1.15.0 rejects them.

## Merge confidence

**HUMAN** · score 63 (amber range 40–79; 10 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `d4097728ba48b2edeee3ddec19e817e4ef63f14f` against `origin/main` (merge base `cc8eb91ff57337c8749e1294c5f8862ab53dec3a`).

**Needs a person**

- `diff.shape` (amber): `697 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 24 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`

**Needs more evidence**

- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `verify.suite` no-typecheck, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `conformance.living` requirements-omitted, `spec.coverage` legacy-unspecced

**Labels:** `interlock/human-review`, `interlock/score-63`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 4 surviving finding(s)`<br>`4 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2`<br>`no surviving warning` |
| `review.ran` | green |  | `every selected dimension ran with its rubric`<br>`selected: technical-lead`<br>`ran: technical-lead`<br>`depth: lean` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 4 non-docs path(s) with no matching risk rule: bin/interlock; hooks/guard-tasks.mjs; lib/artifacts.mjs (+1 more)` |
| `verify.suite` | green | no-typecheck | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `14 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`cli-smoke (ubuntu-latest): pass`<br>`cli-smoke (macos-latest): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)`<br>`cli-smoke: pass (required)` |
| `conformance.delta` | green |  | `15 of 15 scenario(s) checked, none unconfirmed`<br>`15 of 15 scenario(s) checked (the command counted 15); 0 unconfirmed` |
| `conformance.living` | green | requirements-omitted | `5 of 5 living requirement(s) checked, none unconfirmed`<br>`5 of 5 living requirement(s) checked (the command counted 5); 0 unconfirmed`<br>`5 requirement(s) asked and 12 left out by the size bound`<br>`left out: hooks/launch-guard: An in-process guard SHALL deny a second ship launch from the engine's own prompt origin`<br>`left out: hooks/launch-guard: The in-process ledger SHALL be session state declared in the plugin's type contract`<br>`left out: hooks/launch-guard: Which form of the guard is active SHALL be stated, and the in-process deny SHALL preempt the settings form`<br>`left out: hooks/spec-meter: The spec meter SHALL go live only on the plugin's spec skill load in an interactive session, and SHALL take the change name from the CLI alone`<br>`left out: hooks/spec-meter: The status line and the pane SHALL repeat the CLI's own words from the lines it ran, and SHALL make no verdict of their own`<br>`left out: hooks/spec-meter: The pane SHALL draw the run on both surfaces by field, count writes and spawns without reading them as validity, and name the record it is not`<br>`left out: hooks/spec-meter: The spec run SHALL end at the checkpoint, at an accepted ship launch and at the session boundary, and the module SHALL own one status line`<br>`left out: hooks/spec-meter: The spec meter SHALL observe only, from the pinned lines, and the guarantee SHALL be pinned statically`<br>`left out: hooks/tool-guards: Test-file edits SHALL be denied during remediation and fix-tests`<br>`left out: hooks/tool-guards: git commit SHALL be denied outside the commit stage`<br>`left out: hooks/tool-guards: A denied tool call SHALL report a machine-readable reason`<br>`left out: hooks/tool-guards: The test-edit guard SHALL read the test profile the run recorded when the working root has none` |
| `spec.coverage` | green | legacy-unspecced | `the diff adds no coverable source file, so there is nothing to name`<br>`2 edited file(s) no spec names: hooks/guard-tasks.mjs, lib/doctor.mjs`<br>`33 of 150 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `697 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 24 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`<br>`697 changed line(s) (added plus deleted), 24 changed file(s)` |
| `decisions.open` | green |  | `15 ledger row(s), none needing a person and none invalid`<br>`agent_resolved D1`<br>`agent_resolved D2`<br>`agent_resolved D3`<br>`agent_resolved D4`<br>`agent_resolved D5`<br>`agent_resolved D6`<br>`agent_resolved D7`<br>`agent_resolved D8`<br>`agent_resolved D9`<br>`agent_resolved D10`<br>`agent_resolved D11`<br>`agent_resolved D12`<br>`agent_resolved D13`<br>`agent_resolved D14`<br>`agent_resolved D15` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`2 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | green |  | `no changed path falls under the 1 always-human-review path(s) listed at origin/main`<br>`always-human-review paths read from origin/main: .github/workflows`<br>`24 changed path(s), none under a listed path` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **openspec-cli** (new capability)
  - Task-line parity: `lib/artifacts.mjs` (`TASK_LINE` exported; `parseTasks`, `tickTasks`, `normalizeTaskMarkers` rewrite the matched box span); `bin/interlock` `tasks tick` help text
  - Version floor: `lib/doctor.mjs` (`OPENSPEC_MIN_VERSION`, two new `warn` branches in `checkOpenSpec`: below the floor, and an unreadable version line). The below-floor warning names the fault the installed CLI has: below 1.7.0 (`OPENSPEC_NESTED_SYNC_VERSION`) nested deltas read "No deltas found" and archive without syncing; on 1.7.x `openspec validate` passes a change `openspec archive` refuses (review round 1)
  - Named validate targets and the MODIFIED scenario-title rule: `skills/spec/SKILL.md`, `skills/bootstrap/SKILL.md`
  - Living specs: `evals/spec-range` and `spec/checkpoint-advisor` deleted; `distribution/npm-package` gets a written Purpose
  - Docs: `docs/01-first-hour.md`, `docs/07-cli-and-configuration.md`, `CHANGELOG.md` (`[Unreleased]`)
- **hooks/tool-guards**: the tasks.md checkbox guard reads lines through the shared `TASK_LINE`, so a hand flip of a `+ [ ]` or `1. [ ]` line during a run is denied like a `- [ ]` one
  - `hooks/guard-tasks.mjs`

## High Risk Changes
- **Task reader widening** (`lib/artifacts.mjs`): every consumer of `parseTasks`/`inspectChange` (`lib/run.mjs`, `lib/ready.mjs`, `lib/plan-fingerprint.mjs`, `lib/drift.mjs`) now sees more lines as tasks. A tasks.md that used `[~]` or `+ [ ]` as an informal note now reads as open work, which can hold a ship run or change a plan fingerprint. Mitigation: the shape is OpenSpec 1.15.0's own, so Interlock and the CLI now agree; rollback is a revert of `lib/artifacts.mjs` and `hooks/guard-tasks.mjs`.
- **Tick guard** (`hooks/guard-tasks.mjs`): it now denies more edits during a run. It still fails open on anything it cannot establish.
- **Doctor floor**: a `warn` only; `report.ok` and every exit code are unchanged.

## Prerequisites to Production
None. No dependency added, no exit code changed. Users on OpenSpec < 1.8.0 see a doctor warning naming the install command.

## Testing
- Unit: tests added in `test/spine/artifacts.test.mjs`, `test/hooks.test.mjs`, `test/spine/doctor.test.mjs`, `test/skills.test.mjs`; `test/spine/spec-meter.test.mjs` updated — `npm test` passing on the head (4366 tests, 4355 pass, 0 fail, 11 skipped); CI green on Node 18/20/22/24
- Verified locally: scenario confirmation checked all 15 of the change's scenarios against the code, 15 confirmed
- Not covered: no unit test pins the 1.7.x wording of the below-floor warning (the review fixer could not edit `test/`; the delta spec carries the scenario); no live `interlock doctor` run against an installed old OpenSpec binary; this repository has no typecheck, coverage or e2e step
