# Settle summary

- Branch: give-the-changed-lines-a-reviewer
- Commit: d208827 docs(change): record the owner's D10 answer (on 21b4d5d feat(review): give the changed lines a reviewer)
- PR: #42 — feat(review): give the changed lines a reviewer

## Description

## Summary
- No bundled review rubric asked whether a changed line is correct: `regression`, `blast-radius` and `devops` each handed it to "another reviewer" and none took it. The `language` brief now owns the changed lines.
- Adds three checks Claude Code's built-in `/code-review` asks and ours did not: what a removed line protected (`regression`), whether the diff breaks the repository's written rules, and whether a fix removes the cause (`technical-lead`).
- One owner for the scenario-to-test check (`technical-lead`). Every reader of the proof rules is now told not to filter its own findings. Rubrics carry only text meant for their reviewer.
- Prompt text only: no dimension, finding field, gate, limit or CLI flag changes.
- Decision D10, answered by the owner: `language` raises a defect on an unchanged line at its own severity only when a changed line reaches it or relies on it; otherwise a suggestion at most.

## Merge confidence

**HUMAN** · score 63 (amber range 40–79; 10 of 17 gating signals clean)
_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let this pull request merge: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue are not read here._

Assessed commit `d208827177baa6878f355256cc65b69431e2b9f1` against `origin/main` (merge base `98c1bf30a8a66b644fe79d541bf1a521a5e665ac`).

**Needs a person**

- `diff.shape` (amber): `798 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400`

**Needs more evidence**

- `review.ran` (amber): `dimension(s) with unread inputs: language, technical-lead, regression`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Flags:** `review.ran` domain-partial, `verify.suite` no-typecheck, `verify.e2e` no-e2e, `verify.coverage` no-coverage, `conformance.living` requirements-omitted

**Labels:** `interlock/human-review`, `interlock/score-63`

<details>
<summary>All 18 signals</summary>

| Signal | Band | Flags | Reason and evidence |
| --- | --- | --- | --- |
| `review.blockers` | green |  | `no surviving blocker among 5 surviving finding(s); its proof of coverage does not hold`<br>`5 surviving finding(s): no blocker, no unrecognised severity` |
| `review.warnings` | green |  | `0 surviving warning(s), at or under MERGE_BANDS.maxWarningsForMerge = 2; its proof of coverage does not hold`<br>`no surviving warning` |
| `review.ran` | amber | domain-partial | `dimension(s) with unread inputs: language, technical-lead, regression`<br>`selected: language, technical-lead, regression, domain, blast-radius`<br>`ran: language, technical-lead, regression, domain, blast-radius`<br>`depth: lean`<br>`domain review ran on a degraded input: 29 requirement(s) were left out of the domain reviewer's text by the size bound (LIMITS.maxDomainSpecChars); left with no requirement in the text: hooks/launch-guard, spawn-routing, spec/checkpoint-ca…`<br>`unread: language: test/skills.test.mjs and test/spine/prompts.test.mjs changed hunks (pins for the new text) (Not opened; not required for this dimension's coverage list, and no test was run); OpenSpec change artifacts (proposal, design, s…`<br>`unread: technical-lead: design.md, proposal.md and the five delta specs line by line (tasks.md plus the code diff were enough to trace scope and pins; I did not compare every delta-spec token list against the brief files one by one.); Full…`<br>`unread: regression: Full 'npm test' and test/skills.test.mjs / test/spine/prompts.test.mjs run results (A foreground run exceeded the command timeout and was stopped; no pass/fail measurement was taken. Nothing in the findings depends on a…` |
| `review.adversarial` | green |  | `every surviving blocker and warning has at least MERGE_BANDS.minVerdictsPerFinding = 2, no refutation was refused, and the quality band removed no blocker`<br>`refused refutations: 0` |
| `risk.class` | green |  | `class medium is within MERGE_ALLOWED_CLASSES (low, medium)`<br>`class medium`<br>`unmatched-source-change: 1 non-docs path(s) with no matching risk rule: lib/prompts/review-dimension.mjs` |
| `verify.suite` | green | no-typecheck | `typecheck skipped: the profile names no type-check command (no-detectable-command); unit: unit suite is green`<br>`typecheck skipped: the profile names no type-check command (no-detectable-command)`<br>`unit: unit suite is green` |
| `verify.e2e` | green | no-e2e | `no end-to-end suite is enabled or requested here (e2e-not-requested)`<br>`e2e skipped: e2e-not-requested` |
| `verify.coverage` | green | no-coverage | `coverage is not configured in this repository (the final verification verdict skipped it as coverage-not-configured)` |
| `ci.pipeline` | green |  | `12 check(s) passed or were skipped on the head commit`<br>`test (18): pass (required)`<br>`Smoke evals (pull request): pass`<br>`test (20): pass (required)`<br>`test (22): pass (required)`<br>`test (24): pass`<br>`Full eval suite (manual): skipped`<br>`test (release npm): pass`<br>`validate-plugin (latest): pass`<br>`validate-plugin (floor): pass`<br>`upgrade-install: pass`<br>`Outcome eval prepare (model-free): pass (required)`<br>`validate-plugin: pass (required)` |
| `conformance.delta` | green |  | `29 of 29 scenario(s) checked, none unconfirmed`<br>`29 of 29 scenario(s) checked (the command counted 29); 0 unconfirmed` |
| `conformance.living` | green | requirements-omitted | `4 of 4 living requirement(s) checked, none unconfirmed`<br>`4 of 4 living requirement(s) checked (the command counted 4); 0 unconfirmed`<br>`4 requirement(s) asked and 29 left out by the size bound`<br>`left out: hooks/launch-guard: A second ship launch without a human prompt since the last SHALL be denied`<br>`left out: hooks/launch-guard: The launch ledger SHALL be per session, created only by an accepted launch, and bounded by a published age`<br>`left out: hooks/launch-guard: Every unknown SHALL allow, and only the launch branch may deny`<br>`left out: hooks/launch-guard: The guard SHALL be registered on four events and tested as a process`<br>`left out: hooks/launch-guard: The launch rule SHALL live in one Node-free module that both forms of the guard read`<br>`left out: hooks/launch-guard: An in-process guard SHALL deny a second ship launch from the engine's own prompt origin`<br>`left out: hooks/launch-guard: The in-process ledger SHALL be session state declared in the plugin's type contract`<br>`left out: hooks/launch-guard: Which form of the guard is active SHALL be stated, and the in-process deny SHALL preempt the settings form`<br>`left out: spawn-routing: The prose spawn roles and their routing SHALL be published, not restated`<br>`left out: spawn-routing: 'interlock routing <role>' SHALL resolve one role at a depth and speak any environment override`<br>`left out: spawn-routing: Each prose spawn site SHALL read its role's routing before spawning and SHALL say when it could not`<br>`left out: spawn-routing: The doctor SHALL report whether the host applies a per-call effort`<br>`left out: spawn-routing: The run program SHALL route its review and skeptic spawns from the same table through the routing module`<br>`left out: spec/checkpoint-card: The checkpoint card SHALL be rendered by one pure, Node-free module, and its questions and outcomes SHALL be the checkpoint document's`<br>`left out: spec/checkpoint-card: Each outcome SHALL print the command it runs, and a send-back SHALL print no record line`<br>`left out: spec/checkpoint-card: 'interlock checkpoint <change>' SHALL print the card in any session, from the change's own files, and SHALL only read`<br>`left out: spec/checkpoint-card: The spec skill SHALL print the card where it stops, and the line SHALL be pinned by token and left unread by the spec meter`<br>`left out: spec/checkpoint-card: The card SHALL print the published session suggestion for the run after the outcome that starts it`<br>`left out: review/regression-dimension: 'review-code' SHALL bundle a 'regression' dimension brief`<br>`left out: review/regression-dimension: The brief SHALL require every changed start, transition and registration to be paired with its end`<br>`left out: review/regression-dimension: The brief SHALL ask for deleted or weakened tests, measured spec promises and text made stale outside the hunks`<br>`left out: review/review-briefs: 'interlock review brief' SHALL print a dimension's whole prompt`<br>`left out: review/review-briefs: The prompt SHALL quote repository data as data`<br>`left out: review/review-briefs: The prompt SHALL let the reviewer run read-only checks and SHALL ask it to measure what it claims`<br>`left out: review/review-briefs: 'interlock review brief --skeptics' SHALL print the skeptic prompts for the published spawn shape`<br>`left out: review/review-briefs: The review and settle skills SHALL relay the printed prompts and add nothing`<br>`left out: review/review-briefs: 'interlock review brief --dimension' SHALL print a re-run's prompt from the draft that names it`<br>`left out: review/rubric-delivery: A dimension reviewer SHALL receive that dimension's written criteria`<br>`left out: review/rubric-delivery: Re-review after remediation SHALL use the same criteria as the first pass` |
| `spec.coverage` | green |  | `the diff adds no coverable source file, so there is nothing to name`<br>`41 of 172 tracked coverable source file(s) are named by a spec` |
| `diff.shape` | amber |  | `798 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400`<br>`798 changed line(s) (added plus deleted), 20 changed file(s)` |
| `decisions.open` | green |  | `15 ledger row(s), none needing a person and none invalid`<br>`agent_resolved D1`<br>`agent_resolved D2`<br>`agent_resolved D3`<br>`agent_resolved D4`<br>`agent_resolved D5`<br>`agent_resolved D6`<br>`agent_resolved D7`<br>`agent_resolved D8`<br>`agent_resolved D9`<br>`agent_resolved D10`<br>`agent_resolved D11`<br>`agent_resolved D12`<br>`agent_resolved D13`<br>`agent_resolved D14`<br>`agent_resolved D15` |
| `run.integrity` | unobserved |  | `no run record: this assessment was not made by a ship run, which writes one at close` |
| `drift.stale` | green |  | `no living spec cites a file this change removed, and no other unarchived change shares its capabilities`<br>`0 broken citation(s) repo-wide, none of a file this change touched`<br>`1 unarchived change(s), none on this change's capabilities` |
| `policy.humanPaths` | green |  | `no changed path falls under the 1 always-human-review path(s) listed at origin/main`<br>`always-human-review paths read from origin/main: .github/workflows`<br>`20 changed path(s), none under a listed path` |
| `plan.fidelity` | info |  | `no run record`<br>`no run record: plan fidelity is reported from a ship run, and this assessment has none` |

</details>

## Changes
- **review/language-dimension**: the brief claims the changed lines (`You own`), reads each hunk's enclosing function, bounds what it raises on unchanged lines (a suggestion at most unless a changed line reaches it or relies on it), and names pitfalls per detected language. The test-quality bullet moves to `technical-lead`. Line 1 and the filename stay.
  - `skills/review-code/dimensions/language.md`
- **review/regression-dimension**: for each deleted or replaced line, asks what invariant it enforced and where the new code re-establishes it. The JSON emit block becomes one sentence that keeps the pinned literals.
  - `skills/review-code/dimensions/regression.md`
- **review/technical-lead-dimension**: adds the written-rules check (raised only when both the rule and the breaking line can be quoted; warning at most, never lowers a finding) and fix depth. Defers changed-line correctness to `language`, takes test quality, and keeps the scenario-to-test check. `qa` hands that check over.
  - `skills/review-code/dimensions/technical-lead.md`, `qa.md`
- **review/rubric-delivery**: replaces the unexpanded `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md` pointer with the two sentences it pointed at. Drops the orchestrator-only "Run this dimension when" line from `devops`, and drops the embedded emit shape from `blast-radius`.
  - `skills/review-code/dimensions/technical-lead.md`, `devops.md`, `blast-radius.md`
- **review/review-briefs**: `renderProofRules` prints "Do not filter findings yourself and do not restate a threshold." in both branches, so the remediation briefing and the no-answer-file prompt carry it too.
  - `lib/prompts/review-dimension.mjs`
- Token pins in `test/skills.test.mjs` and `test/spine/prompts.test.mjs`. `CHANGELOG.md` `[Unreleased]`.

## High Risk Changes
None in production code paths. Reviewers' output shifts: changed-line defects now come from `language`, so per-dimension counts change. Rollback is a revert of the rubric files.

## Prerequisites to Production
None.

## Testing
- Unit: new token pins in `test/skills.test.mjs` and `test/spine/prompts.test.mjs`; no existing test edited. `npm test` at `d208827`: 4948 tests, 4943 pass, 0 fail, 5 skipped. `npm run validate` passes.
- Verified locally: every assembled `interlock review brief` (language, technical-lead, regression) holds no `${CLAUDE_PLUGIN_ROOT}`, prints the no-self-filter sentence once and carries one emit shape; `devops` no longer carries its run line; the npm pack still ships all nine rubric files.
- Review loop: round 0 raised 5 suggestions, no blocker or warning, so no fix round ran (see the round 0 comment). All 29 delta scenarios and 4 living requirements were confirmed against the code.
- Not covered: whether the reviewers now find more real defects (a non-goal; read the first real review after merge).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
