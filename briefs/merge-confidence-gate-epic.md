# Epic: a merge-confidence scoring gate for PR/MR review

Written 2026-10-12 against Interlock 1.5.1 (`23856b0`); revised the same day after the owner's answers to the six open questions (§6). Each brief in §5 was the source for one OpenSpec change, created with `openspec new change`, never by hand-scaffolding `openspec/changes/`.

**Status, 2026-10-13: all eight briefs are implemented.** This file is the findings and the briefs as they were written; it was not revised to match what was built. Four changes carried them:

| Change | Briefs | State |
|---|---|---|
| `add-merge-confidence-gate` (`8ec2dc7`, `28a296d`) | E1, the verdict and the command | archived |
| `judge-against-base-and-living-specs` (`b2c1384`) | E8 the coverage figures, E4 policy from the base, E5 the `domain` dimension, E7 the spec audit | archived |
| `complete-and-record-the-merge-verdict` (`a170225`) | E2 the close and the receipt, E6 living conformance and spec coverage | archived |
| `label-and-harden-the-merge-verdict` | E3 the labels and the `mr` skill, and the hardening an audit of the epic's commits called for | implemented on this branch |

Where a change departed from its brief, the departure and its reason are recorded in that change's `design.md`, not here. The larger ones: the coverage baseline is `interlock verify baseline` and `verify coverage --base`, not a `verify exec` option (E8); the platform's checks become the pipeline file in code (`interlock pipeline`), not in the skill, and the skill carries no label name (E3); a run's evidence file never supplies a base (E3); changed source the coverage report does not list is a flag, not a band (E3). One question stays open for the owner: what `risk.class` reads at merge (D1 in the last change's decision ledger).

Two asks produced it:

1. A **scoring gate** on a pull or merge request, so a reader knows which PRs a machine is confident can be merged and which need a human.
2. The review should read the **living specs** (`openspec/specs/`) for business-requirement and domain-logic checks, not only the change's own delta specs.

The short version. Interlock already computes most of the facts a merge verdict needs: review survival, the blocker gate, the verify verdict, the risk class, the conformance checklist, the decision ledger, drift, and the path sets on the receipt. It never combines them, and the one place that does pronounce on mergeability today is prose a model writes into the MR description. The epic adds a pure module and one subcommand, `interlock merge-confidence`, that folds those facts, plus the platform's own pipeline result, into a three-way verdict (`MERGE`, `HUMAN`, `BLOCK`) and a 0 to 100 score whose band can never be averaged past a red signal; wires it into the ship receipt and the `mr` skill as labels and a description block; and adds a `domain` review dimension plus a living-spec conformance list so the review is judged against the requirements the repository already wrote. Every threshold lands in `lib/limits.mjs` and prints from `interlock limits`.

One principle runs through the revision: **judge the new code, not the legacy.** Coverage is green when the PR does not lower it, not when the repository clears an absolute bar; a source file is expected to have a spec when the PR creates it, not because it existed unspecced before; a tool the repository never set up is a flag on a green signal, while a result the run should have produced and did not is amber. That is SonarQube's "Clean as You Code" and Codecov's default `target: auto`, and it is what lets a repository still being specced or still wiring its tests earn `MERGE` on a clean PR today.

Two findings surfaced on the way that stand on their own. The living specs are structurally strong (395 requirements, every one normative; 1,255 scenarios, every one with a `WHEN` and a `THEN`), but four capabilities state no bound or prohibition at all, so a domain review would have nothing to catch a regression against (§4). And `REVIEW.md` is read from the working tree, so a pull request can add its own paths to `## Do Not Report` and quiet the review of exactly those paths; both the merge verdict and the review itself move to reading policy from the base ref (E4, after GitHub's `CODEOWNERS` rule and Greptile's in §2.3).

---

## 1. What answers "can this be merged?" today

Nothing does, as one answer. The facts exist, scattered, and the question is answered in prose at the last step.

| Fact a merge decision needs | Where it is computed today | Reaches a merge verdict? |
|---|---|---|
| Did a blocker survive two skeptics | `interlock review` (`lib/review-core.mjs` `resolveReview`), `interlock gate` (`lib/findings.mjs` `evaluateGate`): `passed` iff no blocker and nothing malformed | Only as a halt: the verdict round halts the run on an unresolved blocker (`lib/remediate.mjs`), and `interlock gate` exits 1 |
| How many warnings survived | Same path; `reviewWarnings` on the receipt (`lib/receipt.mjs:217-220`) | No. Warnings never block a commit (`lib/run.mjs` `runRemediated`), and nothing downstream reads the count |
| Was the review adversarial, or did the skeptics assert | `counts.dismissalsRejected` (`lib/review-core.mjs`), per-dimension `raised/surviving` | No. Printed, never consumed |
| Did every selected dimension actually run with its rubric | `REVIEW RUBRIC UNAVAILABLE` banner, `addedDimensions` (`lib/run.mjs` `reviewStep`, `runReviewed`) | No |
| Blast radius: auth, money, schema, data destruction | `lib/risk.mjs` `classifyRisk`, `interlock risk` | Only before ship, for continuity (`lib/ready.mjs` `STRICTNESS.allowedRiskClasses`). Never re-run over the paths the run actually touched |
| Is the unit suite green, was anything skipped | `lib/verify.mjs` judge; `skippedVerifications`, `capExhaustedVerifications`, `unresolvedErrors` on the receipt | A red unit suite halts. A skipped verification is a banner and a count, not a verdict input |
| Coverage of the changed lines, and of the project before and after | `judgeCoverageResult` computes diff coverage `pct = coveredLines / changedLines` (`lib/verify.mjs:774-823`); **no project total, no base figure** | No. Advisory by construction |
| Does the platform's own pipeline pass on the head commit | **Not read anywhere.** The `mr` skill never asks `gh pr checks` or `glab ci status` | No |
| Did the code do what the delta specs promised | `interlock conformance` lists scenarios `C1..`; the handoff agent reports `scenariosChecked` / `scenariosUnconfirmed` | No. "Nothing here blocks" (`lib/conformance.mjs:16-20`) |
| Does the diff contradict a requirement already in `openspec/specs/` | **Not computed.** The qa and technical-lead rubrics read the change's own `specs/**` (`skills/review-code/dimensions/qa.md`, `technical-lead.md`); conformance reads delta specs only (`SPEC_ARTIFACT = /^specs\//`) | No |
| Are the living specs this change would be judged against themselves stale | `interlock drift` (`unarchived`, `stale.broken`, `orphans`) | No. Never blocks, and the `mr` skill prints it after publishing |
| Did the diff stay on plan | Receipt carries touched vs predicted paths (`interlock paths touched` / `predicted`) | Only as a report indicator (`docs/11-the-indicators.md`), which gates nothing by policy |
| Is a product decision still open | `interlock ledger`: `needs_human` and invalid rows | Only before ship (`ready`) |
| Did the run degrade | Stage-marker gaps, rejected handoff reports, permission prompts, auto-mode denials, replans: all on the close summary (`lib/receipt.mjs` `degradationLines`) | No |
| Size and shape of the diff | Not computed anywhere | No |

Then the last step. `skills/mr/SKILL.md` §4 asks the model to write `## High Risk Changes` and tells it "Be honest in the risk assessment. An inflated confidence level is worse than no assessment, because it is the section a reviewer uses to decide how hard to look." That sentence is the finding. The one surface a reviewer uses to decide how hard to look is a confidence level a model wrote, which is exactly the kind of number this repository refuses to leave in prose everywhere else (`.claude/CLAUDE.md`, "Thresholds live in the CLI, not in prose").

Three design rules already in the codebase settle most of the design:

- **Maximum, never average** (`lib/risk.mjs:23-26`): "A change that is 90% docs and 10% payment code is a payment change." A merge score that averaged a red signal away would reintroduce the failure that module exists to prevent.
- **Fail closed on absent evidence** (`lib/risk.mjs:14-21`, `lib/ready.mjs:12-22`, `lib/outcomes.mjs` "absent stays absent, never zero"): a result the run should have produced and did not is not a clean result. For a merge verdict, unobserved is never green. `lib/verify.mjs` already separates that case from a tool the repository never configured (`SKIP_REASONS.COVERAGE_NOT_CONFIGURED` beside `BUDGET_EXCEEDED`), and §3.2 keeps the distinction.
- **Recorded history gates nothing** (`docs/14-evals.md:13-15, 328-329`; decision §4.15(a); the autonomy ladder "stays storage-only"). The verdict must be computed from **this run's** observed facts, never from `outcomes.jsonl`, `interlock report` figures, transcript scores or the ladder. That also rules out the Google/Meta style of learned risk model as a gate input for now (§2), which is fine: the deterministic signals are what those models were trained to approximate.

---

## 2. Reference: how other tools score and gate

The user's ranking (PR-Agent, claude-code-action, reviewdog, Kodus, run-gemini-cli, codex-action, Danger, Gito, Gerrit, Review Board) was the starting list. The pass below read primary sources, config files and source for each tool that produces a signal or a gate, and added the deterministic and research layers the ranking leaves out: SonarQube quality gates, Codecov's status model, the JIT defect-prediction literature, Meta's diff risk score and RADAR, Mergify, GitHub rulesets, GitLab approval policies, and the three 2026 benchmarks on LLM review. Claims a page would not confirm are marked **unverified**; URLs are in §7. run-gemini-cli, Gito, Gerrit and Review Board produce no score or gate of their own beyond the platform's and are not repeated here.

### 2.1 What each tool emits, and what decides the merge

| Tool | Signal it produces | Scale | Who decides the merge | Keys that matter |
|---|---|---|---|---|
| **PR-Agent** (`/review`) | `estimated_effort_to_review`, `score`, `relevant_tests`, `key_issues_to_review`, `security_concerns`, `can_be_split`, `ticket_compliance_check`; opt-in `risk_level`, `merge_recommendation`, `failure_modes`. All emitted by the model as YAML | effort 1 to 5; score 0 to 100; risk `low/medium/high`; `merge_recommendation` ∈ `no_concerns_found / needs_review / changes_required`; ticket compliance Fully / Partially / Not Compliant / PR Code Verified | **Nobody in the tool.** Labels `review effort [x/5]` and `possible security issue` are posted; the docs say to add a CI action that blocks on a label, and that a human removing the label is recorded in the PR discussion. `enable_auto_approval` exists but the call site is commented out in main: no auto-approve path is reachable. Legacy (v0.26 to v0.30): `maximal_review_effort`, `auto_approve_for_low_review_effort`, `ensure_ticket_compliance` | `[pr_reviewer]` `require_score_review`, `require_estimate_effort_to_review`, `require_ticket_analysis_review`, `require_risk_assessment`, `require_merge_recommendation`, `num_max_findings=3`, `enable_review_labels_effort`; `/improve` `suggestions_score_threshold` (0 to 10, "not above 8") |
| **PR-Agent** (large PR chunking) | One verdict per chunk, then merged | | Merge rule: score = lowest chunk, risk and recommendation = most conservative chunk, effort = highest. "The merged verdict is deliberately never less alarming than the worst chunk" | `enable_large_pr_chunking` |
| **Qodo** (commercial layer on PR-Agent) | Blast-radius label Large/Medium/Small; Spec Agent "Requirement gap" findings against a linked spec; severity threshold for inline comments | effort mode Auto/Fast/Balanced/Deep; blast radius "reflects the highest risk identified"; threshold 1 to 3 | Explicitly "doesn't describe blocking or gating merges" | `override_effort`, `publish_blast_radius_labels`, `inline_comments_severity_threshold`, `enable_spec_agent` |
| **CodeRabbit** | Review effort; linked-issue assessment (Objective / Addressed / Explanation, plus out-of-scope changes); **pre-merge checks**: docstring coverage, title, description, issue assessment, natural-language custom checks | effort 1 to 5; per check ❌ Error, ⚠️ Warning, ✅ Passed, ❓ Inconclusive; no PR-level score, no confidence | A check in `mode: error` blocks only when the request-changes workflow is on; then auto-approval when comments resolved and no check fails. **Inconclusive does not block.** Ignoring failed checks is a button, tagged `[IGNORED]`, restrictable to requested reviewers; the author cannot override | `reviews.pre_merge_checks.<check>.mode = off/warning/error`, `docstrings.threshold=80`, `request_changes_workflow`, `assess_linked_issues`, `fail_commit_status` |
| **Greptile** | Per-comment confidence; a review-level "5/5"; a GitHub status check | `strictness` 1 to 3 (severity threshold); `autoApprove.riskCeiling` ∈ `low/medium/high/critical`, default `low` | `statusCheck: true` posts pass/fail; `autoApprove.enabled` (default false) approves "low-risk 5/5 reviews". **Read from the PR's base branch, "so a PR cannot loosen it for itself"** | `.greptile/config.json`: `strictness`, `confidenceScoreSection`, `statusCheck`, `autoApprove.{enabled,riskCeiling,filters}` |
| **Kodus** (Kody) | Inline suggestions with severity; Kody Rules (name, instructions, path glob, severity, scope Global → Repo → Directory); **business-logic validation** against a task or inline spec: `MUST_FIX / SUGGESTION / INFO`, each quoting the requirement and "Missing in code" | severity `low/medium/high/critical`; task context graded Complete / Partial / Minimal / Empty | Non-blocking by default; optional request-changes on critical and optional auto-approve when no issues. Docs: enable blocking "only when your team agrees on the thresholds and has strong CI" | `pullRequestApprovalActive`, `isRequestChangesActive`, `suggestionControl.severityLevelFilter`, `reviewOptions.business_logic` |
| **Danger JS / Ruby** | Whatever the Dangerfile computes from `pr.additions / deletions / changed_files / body / title`, `git.modified_files` | `fail / warn / message / markdown` | `fail()` sets exit code 1 (`failOnErrors`) and posts a failing commit status; `warn` "still enables the merge button" | the Dangerfile |
| **reviewdog** | Linter and SAST diagnostics as inline comments or check runs | `-level info/warning/error` maps to the GitHub check conclusion (error → failure) | `-fail-level=[any,info,warning,error]` exits 1 at or above the level; default `none` exits 0 | `-filter-mode added / diff_context / file / nofilter`; reporters per platform |
| **claude-code-action** | Free-form review, sticky comment, inline comments; `track_progress` checklist; no score | | **Cannot by design:** "Claude cannot submit formal GitHub PR reviews", "cannot approve pull requests", cannot merge. A gate has to be built outside, from its outputs into a required check | `--allowedTools`, `allowed_bots`, `allowed_non_write_users` ("RISKY"); checks out the untrusted head into `pr-head`, restores `.claude/`, `CLAUDE.md`, `.mcp.json`, `.husky/` from base; strips HTML comments and invisible characters |
| **codex-action** | A final message posted as a comment; optional `output-schema` for structured JSON; cloud review flags P0 and P1 only | | None built in. "Code review rules guide Codex; they don't replace tests, branch protections, or required approvals" | `safety-strategy` `drop-sudo / unprivileged-user / read-only`; warns that an HTML comment in a PR body is "readily available to the model but effectively invisible to the user", and that `AGENTS.md` is part of the untrusted surface |
| **SonarQube** quality gate | Conditions on **new code**: new issues, security hotspots reviewed, coverage, duplication | Sonar way: new issues = 0, hotspots reviewed = 100%, new-code coverage ≥ 80%, duplication ≤ 3%; coverage and duplication conditions ignored under 20 new lines | Binary pass/fail reported to CI and PR decoration; the branch rule blocks the merge. Community Build has no PR decoration, so the gate "has to be wired into a merge policy externally" | the gate definition; "Clean as You Code" new-code definition |
| **Codecov** commit statuses | `codecov/project` (total coverage vs the base commit) and `codecov/patch` (coverage of the lines the PR added or changed) | `target: auto` (default) "will use the coverage from the base commit … to compare against"; `threshold: N` "Allow the coverage to drop by N%, and posting a success status"; `informational: true` always passes | Two commit statuses the branch rule can require; `informational` shows the figure without blocking | `coverage.status.project.default.{target,threshold,informational}`, `.patch.default.*` |
| **Meta DRS + RADAR** | DRS: a fine-tuned Llama predicts the chance a diff causes a SEV; RADAR: authorship classification → eligibility gates → static heuristics → DRS percentile → LLM review → deterministic validation | Tiers green / weekend / yellow / red; percentile cutoffs P5 (human diffs), P20 (bots), P50 (allowlisted runbooks); auto-accept needs LLM confidence ≥ 8/10 and only "safe categories" (dead-code removal, behaviour-preserving refactor, logging, test additions) | Deterministic gates around a learned score. Eligibility excludes SOX-scoped, open-source and additional-review paths, WIP, code-freeze, bad CI state, blocklisted phrases. Reported: approve rate 60%, revert rate ⅓ and incident rate 1/50 of non-RADAR diffs (observational) | |
| **JIT defect prediction** (Mockus & Weiss 2000; Kamei et al. 2013) | Change-level features that predict defects: diffusion `NS ND NF Entropy`, size `LA LD LT`, purpose `FIX`, history `NDEV AGE NUC`, experience `EXP REXP SEXP` | | Research; the features are what every size labeler and risk score approximates | |
| **Mergify** | Conditions over PR attributes and checks; queue rules | `#added-lines`, `#deleted-lines`, `files`, `label`, `check-success`, `approved-reviews-by`, `from-fork`… with `= != ~= >= …` and `and/or/not` | `queue_conditions` to enter, `merge_conditions` to merge; "Merge Protections" become one required check | |
| **GitHub rulesets and CODEOWNERS** | | | Required approvals, code-owner approval, dismiss stale approvals, conversation resolution, required status checks, "require code scanning results" by severity, merge queue. "Request changes" is informational unless a ruleset requires a PR. "Pull requests use the version of `CODEOWNERS` from the base branch of the pull request" | |
| **GitLab approval rules and policies** | | Approvals required 0 to 100; code owners | Merge request approval policies (Ultimate) require approval when scan findings match, and **fail closed**: "if the rules are invalid, or can't be evaluated, approval is required"; a missing scanner in the latest pipeline also requires approval. Free tier approvals do not prevent merging | `approval_policy`, `fallback_behavior`, `approval_settings` |
| **Bors** | | | `r+` approves; the approval "remains tentative until PR CI succeeds unless `force`"; merge to a test branch, CI, then fast-forward | |
| **pr-size-labeler** | A size label | `size/xs ≤ 10`, `s ≤ 100`, `m ≤ 500`, `l ≤ 1000`, `xl` beyond | `fail_if_xl` fails the workflow | `files_to_ignore` |
| **mr-review** (bedrock-python) | AI comments, each edited, kept or dismissed by a person before posting | | A human per comment; no score, no gate | |

### 2.2 What the research says about the second ask

- **Diff-only review misses contextual issues.** SWE-PRBench (2026): eight frontier models "detect only 15 to 31% of human-flagged issues on the diff-only configuration", and detection "collapses" for issues that need context outside the diff. That is the class the living specs supply.
- **LLMs over-correct on requirement conformance.** Jin and Chen (2026): models "frequently misclassify correct code implementation as non-compliant or defective", and richer explain-and-fix prompts make it worse. A `domain` dimension without skeptics would raise false blockers; with Interlock's two-skeptic survival and the citation shape check it is the right place for them.
- **Every tool that checks a spec does it as LLM findings, not as a status.** PR-Agent's four-state ticket compliance is reported in the comment, not as a label; CodeRabbit turns its issue assessment into a pre-merge check; Kodus quotes the requirement beside `MUST_FIX`; Qodo's Spec Agent emits "Requirement gap" findings. None reads a repository's own living spec corpus; all read a ticket or a linked issue.
- **The 2026 comparison the user cited** (Ganglani) could be read only through search snippets (Cloudflare blocked the page): AI reviewers "consistently miss business logic errors, auth flow flaws, and race conditions". **Partially verified.**

### 2.3 What Interlock takes from it

| Lesson | Evidence | Where it lands in §3 |
|---|---|---|
| **A three-way verdict is the convention.** `no_concerns_found / needs_review / changes_required` (PR-Agent), green / yellow / red (Meta), Error / Warning / Passed (CodeRabbit) | §2.1 | `MERGE / HUMAN / BLOCK` |
| **Conservative composition.** PR-Agent's chunk merge is "never less alarming than the worst chunk"; GitLab policies require approval when a rule cannot be evaluated | §2.1 | worst band wins; `unobserved` is amber |
| **Inconclusive must not pass.** CodeRabbit's ❓ Inconclusive "does not block", which is the fail-open reading this repository refuses for a gate that can remove a person | §2.1 | a result the run should have produced and did not is `unobserved`, never green |
| **Judge the new code against the base, not against an absolute bar.** Codecov `target: auto` + `threshold`; Sonar's new-code conditions with a 20-line floor; GitHub reads `CODEOWNERS` from the base branch | §2.1 | `verify.coverage` (no significant decline), `spec.coverage` (new files must be specced), `minChangedLinesForCoverage` |
| **A tool never configured is not a failed result.** Codecov `informational`, Sonar's conditions only on configured metrics, `lib/verify.mjs`'s own `COVERAGE_NOT_CONFIGURED` skip reason | §2.1, `lib/verify.mjs:96-97` | not-configured advisory kinds are green with a **flag**; the flag lowers the score, never the band |
| **Numbers a model writes are not a gate.** PR-Agent's score and effort are LLM-emitted YAML; its own auto-approve is unreachable; claude-code-action cannot approve by design; every vendor hardens with the pattern model → label or check → deterministic branch rule | §2.1 | the CLI computes every band; the model writes narrative under the verdict; the platform merges |
| **The pipeline is evidence the platform already holds.** Bors ties approval to CI; Mergify `check-success`; GitHub required checks; RADAR requires "CI in an allowed state" | §2.1 | `ci.pipeline`, read from `gh pr checks` / `glab ci` by the `mr` skill and handed to the CLI as a file |
| **Size and diffusion are the cheapest risk signal nobody computes here.** `LA LD NF Entropy`; `size/xl` fails the build; Mergify `#added-lines` | §2.1 | `diff.shape` |
| **"Touches a sensitive path" means "a person approves", never "changes required".** RADAR excludes SOX-scoped and additional-review paths from auto-approval; GitLab policies and CODEOWNERS require an approver; PR-Agent reserves `high` risk for "a clear bug, security concern, or major logic risk" | §2.1 | `risk.class` `high`/`critical` → `HUMAN`, never `BLOCK`; `policy.humanPaths` (E4) |
| **Policy must come from the base branch.** GitHub `CODEOWNERS`; Greptile reads `autoApprove` from the base "so a PR cannot loosen it for itself". Interlock reads `REVIEW.md` from the working tree | §2.1, `lib/review-core.mjs` `readReviewPolicy` | E4: the merge verdict and `interlock review` both read policy from the base ref and report a working-tree difference |
| **PR content is untrusted input.** HTML comments in the body, `AGENTS.md`, commit messages | codex-action and claude-code-action security docs | the `mr` skill reads nothing from the PR body into the computation; the pipeline file carries check names and states only; E5 frames spec text as quoted data |
| **Overrides are visible, not silent.** PR-Agent documents a removed label in the discussion; CodeRabbit tags `[IGNORED]` | §2.1 | a human replacing `interlock/human-review` with a merge is a platform event in the PR timeline; Interlock records nothing and gates on nothing it recorded |
| **Spec conformance needs skeptics.** Over-correction on requirement judgement | §2.2 | `domain` findings go through the same two skeptics and the citation shape check |

---

## 3. Design

### 3.1 Verdict first, score second

Three verdicts, one of which branches:

| Verdict | Meaning | Exit code of `interlock merge-confidence` |
|---|---|---|
| `MERGE` | Every gating signal is green. A machine is confident; the platform's own policy may auto-merge | 0 |
| `HUMAN` | At least one signal is amber or unobserved, none red. A person decides, and the output names what to look at and sorts it into *needs a person* (risk, policy, open decisions) and *could become green* (missing evidence, warnings, coverage) | 0 (1 with `--require-merge`) |
| `BLOCK` | At least one signal is red: a surviving blocker, a red unit suite or typecheck, a failing required pipeline check, a malformed finding. The machine found a defect | 1 |

Each signal resolves to one of `green`, `amber`, `red`, `unobserved`, carries zero or more **flags**, and carries the evidence that produced it (the same shape `classifyRisk` uses: `{ signal, band, flags, evidence, reason }`). The verdict is the **worst band over every gating signal**, with `unobserved` ranking as amber. A red in one signal is a `BLOCK` whatever the other sixteen say. A flag never changes a band: it is the signal saying "green, but you should know that no e2e suite exists here".

The **score** is for people, labels and sorting, not for branching. It is bounded above by the worst band and positioned inside that band by the share of signals that are green **and unflagged**:

```
ceiling = MERGE_BANDS.ceiling[worstBand]          // green 100, amber 79, red 39
floor   = MERGE_BANDS.ceiling[nextWorseBand] + 1  // green 80, amber 40, red 0
clean   = gating signals that are green with no flag
score   = floor + round((ceiling - floor) * clean / gatingSignals)
```

So a PR with every signal clean scores 100; the same PR with no e2e suite and no coverage tooling scores in the mid 90s and still reads `MERGE`; one amber signal among seventeen scores 77 and reads `HUMAN`; a surviving blocker cannot score above 39 however clean the rest is. The number and the band agree by construction, two PRs in the same band sort by how much they left unflagged, and a reader who only sees `72` knows a human is needed without seeing the table. The ceilings are limits, printed by `interlock limits`, never restated in a skill.

**Rejected: a weighted sum.** PR-Agent's 0 to 100 score and the JIT-defect models in §2 are weighted or learned. A weighted sum is exactly the arithmetic that lets a critical signal be diluted by volume, and its weights are numbers somebody will re-argue. The band ceiling is the one piece of arithmetic that keeps "red means red", and the flag share is the one piece that keeps the number moving inside a band. §3.7 is the maintenance contract that keeps the formula this small.

### 3.2 The signals

Every signal is computed from facts the run observed or a file the caller named. Three absences are told apart, and the difference is the whole policy:

- **Not configured**: the repository declared no such tool (no e2e command, no coverage command, no graph). The signal is **green with a flag**. The flag lowers the score; the band is untouched. This is the owner's call on e2e (§6, answer 3), applied to every advisory kind the verify planner already classes as such.
- **Unobserved**: the run should have produced this result and did not (a planned verify step with no result, a pending pipeline, a review that did not complete, a baseline whose commit is not an ancestor of HEAD). **Amber.**
- **Blocking kinds are never flags.** `unit` and `typecheck` are `BLOCKING_KINDS` in `lib/verify.mjs`; a repository with no test profile has no unit evidence, and that is amber, not a flag, because the ship loop itself refuses to run unattended without one (`STRICTNESS.requireTestProfile`).

All numbers below are **proposed defaults**, listed once in §3.6 as `lib/limits.mjs` keys; the point of the table is which fact each signal reads, not the value.

| Id | Reads | green | amber | red | flags | v1 |
|---|---|---|---|---|---|---|
| `review.blockers` | `resolveReview` surviving by severity, or the remediation verdict's `blockersRemaining` | 0 blockers, 0 malformed | | any blocker or malformed finding | | yes |
| `review.warnings` | same | surviving warnings ≤ `maxWarningsForMerge` | above the cap | | | yes |
| `review.ran` | manifest `reviewDimensions`, `REVIEW RUBRIC UNAVAILABLE` banners, the `review did not complete` note | every selected dimension ran with its rubric | a dimension ran without criteria, the worker reported not ok, or no review ran (lean ship) | | `domain-skipped` when E5's dimension could not run for want of a graph | yes |
| `review.adversarial` | `counts.dismissalsRejected`, verdict counts per surviving blocker/warning | every surviving blocker and warning had ≥ `minVerdictsPerFinding` verdicts and no refutation was refused for citing nothing | otherwise | | | yes |
| `risk.class` | `classifyRisk({ changedPaths: observed, artifacts })` re-run over the paths the run **touched**, not the paths it planned | class ∈ `MERGE_ALLOWED_CLASSES` | `high` or `critical`, with the driving signal named; sorted under *needs a person* | never (§6, answer 4) | | yes |
| `verify.suite` | the final verify judgement over the blocking kinds (`unit`, `typecheck`) | green | skipped (`no-test-profile`, budget exceeded) or no result for a planned step | halt | `docs-only-changes` when the planner skipped for that reason | yes |
| `verify.e2e` | the final verify judgement for `e2e` | passed, or not configured / opted out | failed in this run (`E2E FAILED (non-blocking by policy)`); planned but no result | | `no-e2e` when not configured | yes |
| `verify.coverage` | `totalPct` of HEAD vs the base figure (E8), else diff `pct`; changed-line count | base observed and `headTotal ≥ baseTotal − maxCoverageDeclinePts`; or no base and diff `pct ≥ patchCoverageFloorPct`; or fewer changed lines than `minChangedLinesForCoverage` | decline beyond the tolerance; no base and patch below the floor; baseline not an ancestor of HEAD | | `no-coverage` when not configured; `no-baseline` when judged on patch coverage alone | yes |
| `ci.pipeline` | the platform's checks for the **head SHA**, handed in as `--pipeline <file>` by the `mr` skill (`gh pr checks --json` plus `--required`; `glab ci get` with `allow_failure`) | every check passed or skipped | a non-required check failed (where flaky e2e usually lives); any check pending; file is for another SHA | a **required** check failed | `no-pipeline` when the platform reports no checks | yes |
| `conformance.delta` | `verdictsRequired`, handoff `scenariosChecked`, `scenariosUnconfirmed` | checked = required and unconfirmed = 0 | unconfirmed > 0; checklist unavailable; coverable source changed with zero delta scenarios ("promised no behaviour") | | | yes |
| `conformance.living` | the living-spec requirement list from E6 and the handoff's answers | every requirement linked to a touched file confirmed | any unconfirmed | | | E6 |
| `spec.coverage` | graph `implements_spec` edges at the reliable weight (`lib/drift.mjs` `RELIABLE_EDGE_WEIGHT`), the change's own `specs/**`, `isCoverableSource`, the diff's added and deleted files | every coverable source file the PR **adds** is named by a living spec or by the change's delta specs, and no kept file lost its only spec | an added source file no spec names; a spec the PR deletes leaves a kept file unnamed | | `legacy-unspecced: N` for pre-existing files the PR edits that no spec names, with the repo-wide figure (the `drift` framing: "2 of 6, in a repo where 34% have one"); `no-graph` when none exists | E6 |
| `diff.shape` | `git diff --numstat` over base..HEAD | changed lines ≤ `maxChangedLinesForMerge` and files ≤ `maxChangedFilesForMerge` | above either cap | | | yes |
| `decisions.open` | `readLedger` / `summarize` (`lib/ledger.mjs`) | no `needs_human`, no invalid rows | any open or invalid row; ledger missing; sorted under *needs a person* | | | yes |
| `run.integrity` | close summary inputs: halt, trajectory completeness, `STAGE MARKER NOT PUBLISHED`, rejected handoff reports, permission prompts, auto-mode denials; `REVIEW.md` differing from the base ref (E4) | none | any | | | yes |
| `drift.stale` | `interlock drift`: `stale.broken` among specs linked to touched files; `unarchived` changes whose deltas touch the same capabilities | none | any | | | yes |
| `policy.humanPaths` | `REVIEW.md` `## Always Human Review` paths (E4), read from the base ref | no touched path listed | a touched path is listed; forced amber under *needs a person*; the PR can never read `MERGE` | | | E4 |
| `plan.fidelity` | receipt touched vs predicted paths | informational in v1: reported, not banded, because path prediction is optional per task (`docs/11`) | | | | info |

Two consequences are deliberate and worth saying at the checkpoint:

- **A lean ship can never read `MERGE`.** `review.ran` is amber when no review ran. That is the honest answer: the default ship loop is "waves, unit verify, commit" (`README.md`), and a diff nobody reviewed is not one a machine should call mergeable. The epic does not change the lean default; it gives `--review` a reason to exist on a PR.
- **A repository is not punished for its past.** A 30%-specced repository with no e2e suite and no coverage tooling reads `MERGE` on a reviewed PR that adds no unspecced file and lowers nothing; its score carries three flags and sits in the low 90s. The way up is to wire the tooling and spec the new code, which is the incentive the second ask is about, and nothing in the table makes an old file a reason to stop a new one.

### 3.3 Two entry points, one module

`lib/merge-confidence.mjs` is pure: no fs, no git, no network, no agent, no clock. `assessMergeConfidence(input, { bands, allowedClasses })` takes a plain object of observed facts and returns `{ verdict, score, worstBand, signals[], driving[], counts: { gating, clean, green, amber, red, unobserved, flagged }, reasons[] }`, where each `driving` entry carries `kind: 'person' | 'evidence' | 'finding'` so a renderer can group them. `formatMergeConfidence` renders it, and explains the number in one line (`72: amber band 40–79, 14 of 17 signals clean`). It composes `classifyRisk`, `evaluateGate`, `summarize` (ledger) and the verify judge the way `lib/ready.mjs` composes its checks, and reimplements none of them.

**Inside a ship run.** `interlock run close` already gathers everything the signals need to build the receipt and the close summary (`lib/receipt.mjs` `tailFromManifest`, `buildReceipt`). It calls the module there, writes `.claude/ship/merge-confidence.json`, adds a `mergeConfidence` block to the receipt (whitelisted by name in `lib/run-log.mjs:567-583`, every count `nullable*`, absent stays absent), and prints one line in the close summary:

```
MERGE CONFIDENCE 72 — HUMAN: review.warnings (3 surviving, cap 2), conformance.delta (1 of 9 scenarios unconfirmed) · flags: no-e2e
```

`ci.pipeline` is `unobserved` inside a run, with the reason `no pipeline file`: the run is offline and the pipeline, if any, has not run on the commit the run is about to make. The `mr` skill supplies it later.

`interlock report` does **not** read the new field into an indicator in this epic. The report is barred from verdict words (`test/spine/report.test.mjs:698`), and a verdict is what this is.

**Outside a run.** `interlock merge-confidence [change] --changed <files> [--review <review.json>] [--verify <judge.json>] [--handoff <result.json>] [--pipeline <checks.json>] [--coverage <head.json>] [--base <ref>] --json` computes the same object from files, for a PR made by hand, a lean run, or a CI job on a branch. Every input not supplied is `unobserved` and says so; the command itself never calls `gh`, `glab` or the network, so a CI job can run it on a checkout with nothing but git. The `mr` skill calls this form, with `.claude/ship/merge-confidence.json` as its first choice when a run wrote one for the same change and HEAD, re-run with the pipeline file added.

Exit code: 1 iff `BLOCK`, in line with "every gating command exits 1 when it blocks" (`bin/interlock` usage). `--require-merge` exits 1 unless `MERGE`, for a CI job that guards an auto-merge path. `HUMAN` is not a failure, and must not fail a pipeline that merely wants a label.

### 3.4 Delivery: the labels, the description block, and what Interlock never does

The `mr` skill (`skills/mr/SKILL.md`) gains two steps before it composes the description, and loses one sentence.

- It fetches the platform's checks for the head SHA (`gh pr checks <n> --json name,state,bucket` and the same with `--required`; `glab ci get --output json` with each job's `allow_failure`) and writes them to a small file `{ sha, checks: [{ name, state: pass|fail|pending|skipped, required }] }`. Names and states only; no log text, no descriptions, because the pipeline's output is untrusted and the signal needs none of it.
- It runs `interlock merge-confidence … --pipeline <file> --base <base> --json` and renders a `## Merge confidence` block from the JSON: verdict, score, the driving signals grouped as *needs a person* and *could become green*, the flags, then the full signal table. The block is copied from CLI output; the skill never re-derives a band or writes a number of its own. The existing "Be honest in the risk assessment" paragraph is replaced by: `## High Risk Changes` is narrative under the CLI's verdict, and names no confidence level. A token pin in `test/skills.test.mjs` keeps the command line and the field names (`verdict`, `score`, `driving`, `flags`) on the skill's fenced lines, per `openspec/specs/spec/machine-readable-gate-lines`.
- It applies **two** labels and removes their predecessors: one of `interlock/merge`, `interlock/human-review`, `interlock/blocked`, and one `interlock/score-NN`. Every other `interlock/score-*` is removed first, so a PR never carries two scores and a repository never accumulates more than the labels its PRs have actually scored (at most 101, created lazily). GitHub: `gh pr edit --add-label … --remove-label …`; GitLab: `glab mr update --label … --unlabel …`. A label that cannot be created is reported, never silent.
- With `--confidence-comment` it posts the signal table as a comment, under the same comment-only rule the test plan already follows.
- **Interlock never merges, and ship never publishes.** `interlock run close` writes the file and prints the line; the label and the description are written by the `mr` skill, which a person runs (`disable-model-invocation: true`), or by a CI job the repository wrote. The platform decides what a label means: a GitHub ruleset or auto-merge keyed on `interlock/merge`, a Mergify queue rule, a GitLab approval rule that requires a human when `interlock/human-review` is present. `docs/15-merge-confidence.md` (E3) ships the three recipes, the CI job that runs `interlock merge-confidence --require-merge` as a required check, and says plainly that the label is advice to a policy the repository owns.
- The PR description, title and comments are **untrusted input** to the skill, as the Codex and Claude action docs say of PR content (§2). The skill reads none of them into the computation; the pipeline file and the merge-confidence JSON are the only things it writes from. A `REVIEW.md` policy block is already framed as quoted data in the reviewer prompt (`lib/prompts/review.mjs` `renderPolicyBlock`); the living-spec text E5 injects gets the same frame.

### 3.5 The living specs: a domain dimension and a living conformance list

The second ask has two halves, and they are different changes.

**E5: a `domain` review dimension.** A seventh rubric, `skills/review-code/dimensions/domain.md`, whose reviewer is handed the **living** requirements that describe the files the diff touched, and asked three questions per touched capability:

1. Does the diff contradict a requirement already in force (`SHALL`, `SHALL NOT`, `MUST NOT`)? That is a **blocker**, and the finding names the requirement: a new optional field `requirement: "openspec/specs/<cap>/spec.md#<Requirement heading>"` on the finding. The CLI checks the citation's shape the way it checks a skeptic's evidence: the path is under `openspec/specs/`, the file exists at the base ref, the heading is a `### Requirement:` line in it. Shape only; whether the cited requirement really forbids the diff is the skeptics' job.
2. Does the diff add behaviour no requirement describes? A **warning**: unspecified behaviour in a specified capability, with the suggestion to write the delta spec.
3. Is a scenario the living spec already carries now untested or contradicted by a test in the diff? A **warning**.

Selection is a rule, not a reviewer's judgement, in `lib/prompts/dimensions.mjs`: `domain` runs when at least one touched source file has a reliable `implements_spec` edge in `.claude/graph/graph.json`, and the reason names the capabilities. When the graph is absent or partial, the dimension is **reported as not run with that reason** (`DOMAIN REVIEW SKIPPED: no graph`), which `review.ran` carries as the flag `domain-skipped`. Never silent. The requirement text is bounded by `maxDomainSpecChars`, cut at a requirement boundary with the omission stated, so a 60-spec repository does not hand a reviewer the whole corpus.

**E6: living-spec conformance.** `interlock conformance --living` extends the checklist with `L1..Ln`: one question per requirement of every capability linked to a touched file, after the `C1..Cn` delta scenarios. The handoff agent answers each with a `file:line` citation, exactly as it does for `C`. `scenariosChecked` / `scenariosUnconfirmed` gain `requirementsChecked` / `requirementsUnconfirmed` on the handoff result schema and the receipt, and the `conformance.living` signal reads them. Still non-blocking in itself (`lib/conformance.mjs` keeps "Nothing here blocks"); the merge gate is where an unconfirmed requirement costs something. E6 also makes `spec.coverage` observable, on the new-code rule in §3.2: the PR's own `specs/**` count as naming a file, because they are the living specs the archive will write.

**E7: `interlock spec-audit`.** Non-blocking, in the `drift` family: one report over `openspec/specs/` that says how much domain contract a capability carries. It exists because the question "are these specs good business requirements?" currently has no instrument; §4 is the first run, done by hand for this repository.

### 3.6 Every number, in one place

A new group in `lib/limits.mjs`, printed by `formatLimits` and covered by the cap-authority sweep (`test/spine/limits.test.mjs:235-300`; a group not in that sweep's `groups` array is a cap printed in prose). Values are starting points.

| Key | Proposed | Read by |
|---|---|---|
| `MERGE_BANDS.ceiling.green` | 100 | score |
| `MERGE_BANDS.ceiling.amber` | 79 | score |
| `MERGE_BANDS.ceiling.red` | 39 | score |
| `MERGE_BANDS.maxWarningsForMerge` | 2 | `review.warnings` |
| `MERGE_BANDS.minVerdictsPerFinding` | 2 | `review.adversarial` |
| `MERGE_BANDS.maxCoverageDeclinePts` | 1 | `verify.coverage` (Codecov's `threshold`, in percentage points of project total) |
| `MERGE_BANDS.patchCoverageFloorPct` | 80 | `verify.coverage`, only when no baseline exists (Sonar way's new-code figure) |
| `MERGE_BANDS.minChangedLinesForCoverage` | 20 | `verify.coverage` (Sonar's floor: a percentage over three lines is noise) |
| `MERGE_BANDS.maxChangedLinesForMerge` | 400 | `diff.shape` |
| `MERGE_BANDS.maxChangedFilesForMerge` | 20 | `diff.shape` |
| `MERGE_BANDS.maxDomainSpecChars` | 12000 | E5 prompt assembly |
| `MERGE_ALLOWED_CLASSES` (`lib/risk.mjs`, beside `CONTINUITY_ALLOWED_CLASSES`) | `['low', 'medium']` | `risk.class` |

`MERGE_BANDS` holds a nested object, so it joins `EVAL_CAPS` on the fractional side of the positive-integer invariant rather than `LIMITS`. No `REVIEW.md` key, flag or environment variable can move any of them; the one `REVIEW.md` addition (E4) is a path list, which is scope, not a threshold, and `BAND_KEY_LINE` keeps rejecting threshold-shaped keys.

### 3.7 Keeping the score maintainable and effective

The owner accepted the number on the condition that it stays maintainable and effective (§6, answer 2). These are the rules that make that a property rather than an intention, each pinned by a test in E1:

- **One registry, one shape.** `lib/merge-confidence.mjs` exports a frozen `SIGNALS` array of `{ id, family, gating, read(input) }`, and every `read` returns `{ band, flags, evidence, reason }`. The verdict and score functions iterate the registry and never name a signal. Adding a signal is one registry entry, one fixture under `test/fixtures/merge-confidence/`, one row in `docs/15`; a test asserts the three sets of ids are equal, the way the cap-authority sweep asserts every cap has a reader.
- **Flags are an enum.** `FLAGS` is a frozen list; a `read` that returns a flag outside it fails a test, so a renamed flag breaks the suite and not a reader's grep.
- **The formula is five lines and reads its ceilings from `MERGE_BANDS`.** Pins: all clean green scores exactly the green ceiling; one flag scores below it and still `MERGE`; one amber scores at most the amber ceiling; one red at most the red ceiling; the score is monotone in the clean count. No literal appears in the test; every expected value is computed from the limits.
- **Every signal is independently testable from a plain object.** No signal reads the filesystem, git or a network; the CLI and `run close` build the input, and `test/spine/merge-confidence.test.mjs` feeds objects.
- **Labels are replaced, never accumulated.** The `mr` skill removes every `interlock/score-*` and the other two verdict labels before adding, pinned as tokens in `test/skills.test.mjs`.
- **The number explains itself.** `formatMergeConfidence` prints the band, the range and the clean count beside the score, so a reader never has to open the formula to understand why 72 is 72.
- **Effectiveness has a definition.** Two PRs in the same band sort by their clean count; a flag always lowers the score; an amber always lowers the band. If a future signal cannot move the number in one of those ways, it is informational, like `plan.fidelity`, and stays out of the denominator.

---

## 4. Findings: the living specs of this repository, audited by hand

The second ask was to review the current `openspec/specs/` for business-requirement and domain-logic quality. This is the first run of what E7 would automate, over the 61 living specs at `23856b0`.

**Structure is strong.**

| Measure | Result |
|---|---|
| Living specs | 61 |
| Requirements (`### Requirement:`) | 395 |
| Requirements with no normative verb (`SHALL`/`MUST`) in heading or body | 0 |
| Scenarios (`#### Scenario:`) | 1,255 |
| Scenarios with no `WHEN` or no `THEN` | 0 |
| Scenarios with no `GIVEN` | 367 (29%): all of `evals/*`, `review/metrics-emission`, `report/html-surface`, most of `report/*`, parts of `waves`, `ship-run`, `workflow-host`, `implementer-prompts`, `verify` |
| Specs with no scenario titled as a failure | 2: `evals/promotion`, `verify` |
| Every spec has a `## Purpose` | yes |

**Where the domain contract is thin.** A requirement that only says what the system does gives a reviewer nothing to catch a regression against; the invariants are in the negatives and the bounds. Counting lines that carry `SHALL NOT`, `never`, `must not`, `at most`, `at least`, `exactly once` per spec:

- Zero or one such line: `spec/task-granularity` (0), `review/rubric-delivery` (1), `hooks/stage-guard` (1), `implementer-prompts` (1). These four describe behaviour with no stated bound, so E5's first question ("does the diff contradict a requirement in force?") has nothing to bite on for them.
- The `evals/*` family writes `WHEN`/`THEN` scenarios without a `GIVEN`. That is a style, not a defect, but a scenario with no precondition cannot be mapped to a test fixture by E6's living conformance, and the same scenarios are the ones a `domain` reviewer would have to re-derive context for.
- Numeric literals inside requirement prose: 31 lines across 16 specs. Most state semantics ("an override of 1 reproduces one agent per task", "exit 1"). One spec, `evals/outcome-run`, restates the full model price table in requirement text (`4 input and 20 output`, `0.05`, `0.1`) while also saying the table is "published in the project limits". That is a second source of truth of the kind `REVIEW.md` ranks Important ("a threshold restated in prose"), and an E7 audit should flag numeric literals in requirement bodies for a human to classify as semantics or as a restated cap.

**What the review cannot see today.** `lib/graph/extract/openspec.mjs` builds `implements_spec` edges from path mentions in spec text, and `lib/drift.mjs` already trusts only the weight-1 edges. Those edges are what E5 and E6 would use to select the capabilities a diff is judged against. Today no reviewer, skeptic or checklist reads a living spec at all, so a diff that breaks `hooks/tool-guards`' "every guard SHALL fail open" would be caught only if the technical-lead reviewer happened to remember it, and would never be cited as a requirement.

**Recommendation for the specs themselves** (outside this epic, but what E7 would say): for each capability, add at least one requirement phrased as a bound or a prohibition; give `evals/*` scenarios a `GIVEN`; and move the price table in `evals/outcome-run` to a reference to the published limits with the values stated once, in `lib/limits.mjs`.

---

## 5. Change briefs

Eight briefs, in landing order. Each names its files, its limits, the tests it adds and the pins it must keep. E1 is the whole gate; E8 gives it the coverage baseline; E2 to E4 deliver it; E5 to E7 are the living-spec half and can land in any order after E1.

### E1 `add-merge-confidence-gate` : the pure module, the limits, and the subcommand

- **New:** `lib/merge-confidence.mjs` (pure; the `SIGNALS` registry, `FLAGS`, `assessMergeConfidence`, `formatMergeConfidence`), `test/spine/merge-confidence.test.mjs`, `test/fixtures/merge-confidence/` (one input object per signal state).
- **Changed:** `lib/limits.mjs` (`MERGE_BANDS`, `formatLimits` rows, the sweep's `groups` array), `lib/risk.mjs` (`MERGE_ALLOWED_CLASSES`), `bin/interlock` (`merge-confidence` subcommand with `--changed`, `--review`, `--verify`, `--handoff`, `--pipeline`, `--coverage`, `--base`, `--require-merge`, `--json`; usage table; exit-code table), `docs/07-cli-and-configuration.md`, `CHANGELOG.md`.
- **Signals:** the v1 rows of §3.2, including `ci.pipeline` and `verify.coverage` on the decline rule. `conformance.living`, `spec.coverage` and `policy.humanPaths` are declared with `unobserved` evidence until E4/E6 land, so the signal table is complete from day one and nothing is added later silently. The pipeline file schema `{ sha, checks: [{ name, state, required }] }` is defined here and read by name.
- **Tests to add:** worst-band wins over any majority; `unobserved` is never green; a flag never changes a band; a red caps the score at the red ceiling; the ceilings come from `MERGE_BANDS` and not from a literal (the `remediate.test.mjs` pattern); every registered signal has a fixture and a doc row; every signal present in the output with a band, including the three not yet observable; `--require-merge` flips the exit for `HUMAN`; a malformed finding is red; a lean run is amber on `review.ran`; a `critical` risk class is amber with its driving signal named and `kind: 'person'`; e2e not configured is green with `no-e2e`; a failed required check is red and a failed non-required check amber; a pipeline file for another SHA is unobserved; a coverage decline inside the tolerance is green and outside it amber; a baseline that is not an ancestor is unobserved.
- **Pins to keep:** `gate --json` field names (`test/spine/cli.test.mjs:483`), the four-count metrics payload (`test/spine/metrics.test.mjs:41`: the score does not ride on the review-metrics record), the cap-authority sweep, `interlock limits` text names.
- **Acceptance:** `interlock merge-confidence --changed a.ts --json` with no other input returns `HUMAN` with every signal `unobserved` and exits 0; `npm test` green.

### E8 `record-a-coverage-baseline` : the base figure `verify.coverage` compares against

- **Changed:** `lib/verify.mjs` (the lcov reader also sums `LF`/`LH` into `totalPct` beside the diff `pct`; `judgeCoverageResult` carries it), `bin/interlock` (`verify exec coverage --write-baseline` writes `.claude/testing/coverage-baseline.json` `{ schema: 'interlock.coverage-baseline/1', sha, ref, totalPct, generatedAt }`; `--compute-base` runs the profile's coverage command on the merge-base in a temporary `git worktree` and removes it, for a repository with no CI on its default branch), `shared/TEST-PROFILE.md` (the baseline is an input, read working root first then state home, like the profile), `docs/15-merge-confidence.md` (the CI recipe: the default-branch job writes the baseline and commits or caches it).
- **Freshness is a fact, not a timer.** The baseline is usable when its `sha` is an ancestor of HEAD (`git merge-base --is-ancestor`); otherwise `verify.coverage` is `unobserved` with `baseline-not-ancestor`. No age threshold: an old baseline on a quiet branch is still the right comparison, and a wrong-branch baseline of any age is not.
- **Tests to add:** `totalPct` from a fixture lcov with two files; the baseline writer refuses to write without a `totalPct`; the ancestor rule; `--compute-base` cleans up its worktree on failure.
- **Pins to keep:** coverage never halts (`lib/verify.mjs:22-23`); the `verify judge` verdict shape.

### E2 `write-merge-confidence-at-close` : the receipt and the close summary

- **Changed:** `lib/run.mjs` (`run close` builds the input from the manifest and the observed path sets; `ci.pipeline` is `unobserved` with `no pipeline file`), `lib/receipt.mjs` (`mergeConfidence` on the receipt; `summaryHeadline`/`formatRunSummary` line with the flags), `lib/run-log.mjs` (receipt whitelist), `lib/outcomes.mjs` (`observedFromReceipt` carries `mergeVerdict` as observed, never agent-reported), `docs/04-when-it-stops.md`, `docs/11-the-indicators.md` (one paragraph: the field exists and the report does not read it).
- **Writes:** `.claude/ship/merge-confidence.json` beside `review.json`, in the working root, not the state home: it is per-run working state the `mr` skill reads back and re-runs with the pipeline file.
- **Tests to add:** in `test/spine/run.test.mjs`, the strict sequence ends with a close whose summary matches `/MERGE CONFIDENCE \d+ — (MERGE|HUMAN|BLOCK)/`; a halted run's receipt carries the field as absent, not a zero; a lean run reads `HUMAN` with `review.ran` named. In `receipt.test.mjs`, the new field is absent when the run halted before review.
- **Pins to keep:** `test/spine/report.test.mjs:698` (no verdict word in any indicator: the report must not pick the field up), `prompt-integrity` ("the receipt is built from what the run recorded").

### E3 `label-the-merge-request-with-confidence` : the `mr` skill and the platform recipes

- **Changed:** `skills/mr/SKILL.md` (§3 fetches the head SHA's checks into the pipeline file and runs `interlock merge-confidence`; §4 renders `## Merge confidence` from JSON and drops the self-assessed confidence sentence; §6 applies the verdict label and the score label after removing their predecessors; new flag `--confidence-comment`), `test/skills.test.mjs` (token pins: `interlock merge-confidence`, `--pipeline`, `--base`, `--json`, `verdict`, `score`, `driving`, `flags`, the three verdict labels and `interlock/score-`; a negative pin that the skill never writes the words `confidence level`), `README.md` (one row), `CHANGELOG.md`.
- **New:** `docs/15-merge-confidence.md`: what the verdict and the flags mean, the signal table (the doc half of the registry pin), the CI job that runs `interlock merge-confidence --require-merge` as a required check, and three platform recipes (GitHub ruleset plus auto-merge on `interlock/merge`; Mergify queue rule; GitLab approval rule requiring a human on `interlock/human-review`), each stating that the platform merges and Interlock does not.
- **Tests to add:** the skill's fenced lines carry the command and the field tokens; `disable-model-invocation: true` stays (`test/skills.test.mjs:140`).

### E4 `read-review-policy-from-the-base-ref` : the one `REVIEW.md` addition, and where policy is read from

- **Changed:** `lib/review-core.mjs` (`parseReviewPolicy` learns `## Always Human Review`, same list grammar and canonicalisation as `## Do Not Report`; `policy.humanPaths`), `bin/interlock` (`review` and `review-policy` gain `--policy-ref <ref>`: the file is read with `git show <ref>:REVIEW.md` in the CLI, never in the pure module; `merge-confidence --base` implies it), `lib/run.mjs` (`run start` records the run's base ref on the manifest; `runReviewed` passes it; a working-tree `REVIEW.md` that differs from the base copy raises `POLICY DIFFERS FROM BASE: REVIEW.md changed in this diff`, which `run.integrity` reads as amber), `skills/review-code/SKILL.md` (the `review-policy` line gains the ref), `skills/review-code/REVIEW.template.md`, `docs/12-repository-review-policy.md` (the split table gains a row for the new section: enforced, by `merge-confidence`, not by `review` or `gate`; and a paragraph on where policy is read from and why).
- **Why both, and why now.** GitHub reads `CODEOWNERS` from the base branch of a pull request and Greptile reads `autoApprove` from the base "so a PR cannot loosen it for itself" (§2.3). Interlock's exclusions are the same kind of rule and are read from the working tree, so a PR can quiet the review of the paths it touches by adding them to `## Do Not Report`. Fixing it only for the merge verdict would leave the review that feeds the verdict reading the editable copy. With no `--policy-ref` and no base on the manifest, both commands read the working tree as today, so a plain `interlock review` in a checkout behaves exactly as before.
- **Signal:** `policy.humanPaths` reads the base copy; a touched path under a listed prefix forces amber under *needs a person*. The list is data the CLI applies, which is the same trust split the existing section uses, so no threshold moves.
- **Tests to add:** in `test/spine/review-policy.test.mjs`, the section parses, canonicalises, reports a non-repo path, and a `nitCap:` line in it is still rejected; in `test/spine/cli.test.mjs`, `--policy-ref` reads the committed copy and a working-tree edit does not change the exclusions; in `merge-confidence.test.mjs`, a listed path forces `HUMAN` over an otherwise all-green input, and a policy that differs from the base is amber with the file named.
- **Pins to keep:** "this repository has a non-empty REVIEW.md" (`review-policy.test.mjs:233`); the `review/policy-file` scenarios (absent file unchanged, prose cannot relax the gate).

### E5 `review-the-diff-against-the-living-specs` : the `domain` dimension

- **New:** `skills/review-code/dimensions/domain.md`; `lib/prompts/domain-context.mjs` (pure: select capabilities from graph edges, bound the text, frame it as quoted data; `DOMAIN REVIEW SKIPPED` reasons).
- **Changed:** `lib/prompts/dimensions.mjs` (the selection rule and reason), `lib/prompts/review.mjs` (the requirement block, framed like `renderPolicyBlock`), `lib/findings.mjs` (`requirement` on `FINDING_SCHEMA`, optional), `lib/review-core.mjs` (shape check of a requirement citation against the base ref; a finding whose citation fails shape is kept and the failure reported, never dropped), `lib/run.mjs` `reviewStep` (reads the graph; banners the skip), `skills/review-code/SKILL.md` (seventh row; "the names above are the rubric filenames, and they are the only names" gains `domain`), `docs/06-why-it-works.md`, `test/spine/prompts.test.mjs`, `test/spine/review-core.test.mjs`, `test/skills.test.mjs`.
- **Rubric, in brief:** read the quoted requirements first; a diff that contradicts a `SHALL`/`SHALL NOT` is a blocker citing `requirement`; behaviour the capability does not describe is a warning; a living scenario the diff makes untested is a warning; never report a finding on a capability whose requirements you were not given.
- **Tests to add:** selection fires only on a reliable edge; absence of the graph is a named skip and never an empty rubric (`review/rubric-delivery` failure scenario); the text is bounded at a requirement boundary with the omission stated; a citation outside `openspec/specs/` fails shape; injection-shaped text inside a spec is quoted, not obeyed (the `policy-file` edge case, applied to specs).
- **Pins to keep:** `selectDimensions` always returns the four always-on names first (`prompts.test.mjs:421`); the review briefing asks for counts only.

### E6 `confirm-living-requirements-at-handoff` : `conformance --living` and the two spec signals

- **Changed:** `lib/conformance.mjs` (`--living`: `L1..` from the capabilities E5's selector names; `requirementsRequired`), `lib/prompts/handoff.mjs` and `lib/prompts/schemas.mjs` (`requirementsChecked`, `requirementsUnconfirmed` on `HANDOFF_RESULT_SCHEMA`), `lib/run.mjs` (`handoffStep` carries the list; `runCommit` records the counts), `lib/receipt.mjs` and `lib/run-log.mjs` (the two counts), `lib/merge-confidence.mjs` (`conformance.living` and `spec.coverage` become observable, the latter on the new-code rule: added files must be named by a living or delta spec, kept files must not lose their only spec, pre-existing unspecced files are the `legacy-unspecced` flag), `docs/14-evals.md` table row.
- **Tests to add:** `conformance.test.mjs`: the living list is empty with a stated reason when no edge links a touched file; the checklist still "holds no verdicts" (`:98`); `merge-confidence.test.mjs`: an unconfirmed requirement is amber; an added source file no spec names is amber; an edited legacy file with no spec is green with the flag and the repo-wide figure in the evidence; a delta spec in the change counts as naming the file.

### E7 `audit-the-living-specs` : `interlock spec-audit`

- **New:** `lib/spec-audit.mjs` (pure over the spec texts plus graph edges), `interlock spec-audit [--json]`, `test/spine/spec-audit.test.mjs`, `docs/15-merge-confidence.md` section "Reading a spec audit".
- **Reports per capability, never blocks (exit 0 always, in the `drift` family):** requirement count; scenarios without `GIVEN`; failure and edge-case scenario counts; bound-or-prohibition lines (`SHALL NOT`, `MUST NOT`, `never`, `at most`, `at least`, `exactly once`) with zero flagged; numeric literals in requirement bodies, listed for a human to classify; source files the capability's edges name that no longer exist (`drift.stale.broken`, reused); coverable source files no spec names, with the repo-wide figure. The §4 table above is its expected first output on this repository.
- **Tests to add:** the counts in §4 reproduce on the committed specs (a pin against the corpus, so a spec edit that drops a failure scenario is noticed); the command exits 0 on an empty `openspec/specs/` with a stated reason.

### Landing order and what depends on what

```
E1 ──► E8 ──► E2 ──► E3
 │
 ├──► E4
 ├──► E5 ──► E6
 └──► E7
```

E1 first, alone, because every other brief reads its output shape. E8 before E2 so the close has a base figure to compare against. E2 and E3 are the delivery pair. E4 is one afternoon. E5 before E6 because E6 reuses E5's capability selector. E7 is independent and is the cheapest way to make §4 repeatable.

---

## 6. Decisions taken on 2026-10-12

The six questions the first draft left open, the owner's answer to each, and how the design changed.

1. **Coverage, and spec coverage, on a repository still being specced.** Owner: compare coverage before and after the PR; green when there is no significant decline. Taken, and generalised. `verify.coverage` is green when the project total on HEAD is within `maxCoverageDeclinePts` of the base figure (Codecov's default `target: auto` with a `threshold`), falls back to patch coverage against `patchCoverageFloorPct` only when no baseline exists, and ignores diffs under `minChangedLinesForCoverage` lines (Sonar's floor). E8 records the baseline. `spec.coverage` takes the same principle in the form Sonar calls "Clean as You Code": a file the PR adds must be named by a spec, a file the PR edits that was never specced is a flag with the repo-wide figure, never an amber. The `## Unspecified Paths` list the first draft floated is dropped; the new-code rule makes it unnecessary.
2. **The score, and a score label.** Owner: keep the number, make it maintainable and effective. Taken. The score label `interlock/score-NN` is applied beside the verdict label and every previous score label is removed first, so labels never accumulate on a PR. §3.7 is the maintenance contract: one registry, one shape, flags as an enum, a five-line formula tested against the limits with no literals, and a definition of "effective" (a flag always lowers the score, an amber always lowers the band, same-band PRs sort by clean count) that a new signal has to meet or be informational.
3. **e2e.** Owner: flag the absence of an e2e suite and allow green without one, since some repositories have difficult e2e setups; but a failed e2e in the pipeline before the MR should block or require a human. Taken, in two parts. `verify.e2e` is green with the flag `no-e2e` when nothing is configured and amber when the suite ran and failed, the same "advisory by policy" the ship loop already applies. The pipeline result is a new signal, `ci.pipeline`, read from the platform's checks for the head SHA: a failing **required** check is red, because the repository has already said that check decides, and the platform would refuse the merge anyway; a failing non-required check, which is where a flaky e2e job usually lives, is amber; a pending pipeline is unobserved. The distinction between "not configured" and "ran and failed" is now a stated principle in §3.2 and applies to every advisory verify kind.
4. **`critical` risk.** Owner: decide from the grounding. Decision: `high` and `critical` are `HUMAN`, never `BLOCK`. Every reference that gates on a sensitive path (RADAR's eligibility exclusions, GitLab approval policies, GitHub code owners) requires a person; none of them pronounces "changes required" on a diff with no defect, and PR-Agent reserves its `high` risk for a clear bug or security concern. `BLOCK` is kept for what the machine actually found: a surviving blocker, a red blocking suite, a failing required check, a malformed finding. The `HUMAN` output groups risk and policy under *needs a person* so the reader sees that no amount of evidence will turn this one green.
5. **Who publishes.** Owner: decide. Decision: ship never publishes a label or edits a PR. `interlock run close` writes `.claude/ship/merge-confidence.json` and prints the line; the `mr` skill, which only a person invokes, or a CI job the repository wrote, does the outward part. Three reasons: a ship run has no channel for a question and a label is an outward action; at close there may be no PR yet, and the pipeline that `ci.pipeline` needs has not run on the commit the run is about to make; and `mr` is `disable-model-invocation: true`, which is the right place for a step that writes to a platform.
6. **Where `REVIEW.md` is read from.** Owner: decide on the better practice. Decision: the base ref, for the merge verdict and for `interlock review` alike, through `--policy-ref`, with the ship loop passing the run's base and a working-tree difference reported and amber. GitHub reads `CODEOWNERS` from the base branch of a pull request and Greptile reads its auto-approve config from the base for exactly this reason; an exclusion list the PR can edit is not an exclusion list. With no ref given the commands read the working tree as today, so nothing changes for a plain local review. E4 carries both halves.

Nothing is left open. The proposed numbers in §3.6 are starting points to be read from `interlock limits`, not decisions.

---

## 7. Sources

Read on 2026-10-12. A default, a flag or a config key can move; re-read on the day a brief is proposed.

**Interlock, at `23856b0`:** `lib/review-core.mjs`, `lib/findings.mjs`, `lib/risk.mjs`, `lib/ready.mjs`, `lib/conformance.mjs`, `lib/drift.mjs`, `lib/verify.mjs`, `lib/remediate.mjs`, `lib/receipt.mjs`, `lib/run-log.mjs`, `lib/run.mjs`, `lib/limits.mjs`, `lib/metrics.mjs`, `lib/outcomes.mjs`, `lib/autonomy.mjs`, `lib/prompts/review.mjs`, `lib/prompts/dimensions.mjs`, `lib/prompts/schemas.mjs`, `lib/graph/extract/openspec.mjs`, `bin/interlock`, `skills/mr/SKILL.md`, `skills/review-code/SKILL.md` and `dimensions/*.md`, `skills/review-artifacts/SKILL.md`, `skills/spec/SKILL.md`, `REVIEW.md`, `docs/11-the-indicators.md`, `docs/12-repository-review-policy.md`, `docs/14-evals.md`, `openspec/specs/review/*/spec.md`, `openspec/specs/ship/completion-gate/spec.md`, `openspec/specs/spec/machine-readable-gate-lines/spec.md`, and the 61 living specs for §4.

**PR-Agent / Qodo**
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/tools/pr_reviewer.py
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/tools/review.md
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/tools/improve.mdx
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/core-abilities/fetching_ticket_context.md
- https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/core-abilities/self_reflection.md
- https://raw.githubusercontent.com/qodo-ai/pr-agent/v0.26/docs/docs/tools/review.md (legacy auto-approve), and `configuration.toml` at tags v0.22, v0.28, v0.30
- https://docs.qodo.ai/code-review/use-qodo-in-prs/control-review-effort
- https://docs.qodo.ai/code-review/assess-risk-with-blast-radius
- https://docs.qodo.ai/code-review/severity-thresholds
- https://docs.qodo.ai/code-review/view-requirement-gaps-in-findings

**CodeRabbit**
- https://docs.coderabbit.ai/reference/configuration
- https://docs.coderabbit.ai/pr-reviews/pre-merge-checks
- https://docs.coderabbit.ai/pr-reviews/walkthroughs

**Greptile**
- https://www.greptile.com/docs/code-review/greptile-config-reference
- https://www.greptile.com/docs/code-review/greptile-json-reference
- https://www.greptile.com/docs/code-review/controlling-nitpickiness

**Kodus**
- https://github.com/kodustech/kodus-ai
- https://docs.kodus.io/en/how_to_use/code_review/policy.md
- https://docs.kodus.io/en/how_to_use/code_review/configs/suggestion_control.md
- https://docs.kodus.io/en/how_to_use/code_review/configs/kody_rules.md
- https://docs.kodus.io/en/how_to_use/code_review/business_logic_validation.md

**Danger, reviewdog**
- https://danger.systems/js/reference.html
- https://raw.githubusercontent.com/danger/danger-js/main/source/runner/Executor.ts
- https://raw.githubusercontent.com/danger/danger-js/main/docs/guides/the_dangerfile.html.md
- https://www.rubydoc.info/gems/danger/9.5.1/Danger/DangerfileMessagingPlugin
- https://raw.githubusercontent.com/reviewdog/reviewdog/master/README.md

**claude-code-action, codex-action**
- https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/security.md
- https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/capabilities-and-limitations.md
- https://raw.githubusercontent.com/anthropics/claude-code-action/main/docs/usage.md
- https://raw.githubusercontent.com/openai/codex-action/main/README.md
- https://raw.githubusercontent.com/openai/codex-action/main/docs/security.md
- https://learn.chatgpt.com/docs/github-action

**SonarQube, Codecov**
- https://docs.sonarsource.com/sonarqube-server/latest/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates/
- https://docs.sonarsource.com/sonarqube-server/10.4/user-guide/clean-as-you-code
- https://docs.codecov.com/docs/commit-status (`target: auto`, `threshold`, `informational`; project vs patch status)

**Change risk and defect prediction**
- Mockus and Weiss, "Predicting risk of software changes", Bell Labs Technical Journal 5(2), 2000: https://onlinelibrary.wiley.com/doi/abs/10.1002/bltj.2229
- Kamei et al., "A large-scale empirical study of just-in-time quality assurance", IEEE TSE 39(6), 2013: https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_TSE2013.pdf
- Meta, "Diff Risk Score (DRS)", 2025: https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/
- Meta, DRS paper: https://arxiv.org/abs/2410.06351
- Meta, RADAR, 2026: https://arxiv.org/abs/2605.30208
- Google, "Resolving code review comments with ML", 2024: https://research.google/blog/resolving-code-review-comments-with-ml/
- Google, AutoCommenter: https://arxiv.org/abs/2405.13565
- Microsoft, Nudge: https://arxiv.org/abs/2011.12468
- Microsoft, US11645188B1 "Pull request risk prediction for bug-introducing changes": https://patents.google.com/patent/US11645188B1/en

**Merge policy surfaces**
- https://docs.mergify.com/configuration/conditions/
- https://docs.mergify.com/merge-queue/rules
- https://docs.mergify.com/merge-protections/
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners (`CODEOWNERS` is read from the base branch of a pull request)
- https://docs.gitlab.com/user/project/merge_requests/approvals/rules/
- https://docs.gitlab.com/user/project/merge_requests/approvals/settings/
- https://docs.gitlab.com/user/application_security/policies/merge_request_approval_policies.html
- https://bors.rust-lang.org/help
- https://graphite.com/docs/ai-reviews (no merge confidence or AI-gated merge documented)

**Spec conformance and review quality**
- SWE-PRBench: https://arxiv.org/abs/2603.26130
- Jin and Chen, "Are LLMs Reliable Code Reviewers? Systematic Overcorrection in Requirement Conformance Judgement": https://arxiv.org/abs/2603.00539
- CR-Bench: https://arxiv.org/html/2603.11078v1
- Ganglani, "AI Code Review Tools 2026 Compared" (snippets only; page blocked): https://www.kunalganglani.com/blog/ai-code-review-tools-2026-compared
- Augment, "12 Best Open Source Code Review Tools in 2026": https://www.augmentcode.com/tools/best-open-source-code-review-tools

**Smaller references**
- https://github.com/CodelyTV/pr-size-labeler
- https://github.com/mergeshield/risk-check
- https://github.com/bedrock-python/mr-review
- https://bedrock-python.github.io/blog/posts/2026-05-28-introducing-mr-review/

**Left unverified by the pass:** PR-Agent `minimal_score_for_auto_approval` (not found in any tag) and the version that removed `focused_pr`; Greptile's `requiredConfidenceScore` scale; any Graphite "merge confidence"; any Google auto-approve system; a GitLab per-MR risk score; the body of the Ganglani articles; the exact `gh pr checks --json` field set on the user's `gh` version (the brief names `name,state,bucket` and `--required`; confirm on the day).
