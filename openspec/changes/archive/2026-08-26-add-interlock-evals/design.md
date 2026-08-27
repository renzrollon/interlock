## Context

See `proposal.md` — Why. Discovery is in `.claude/handoff/explore-interlock-evals-20260826-114822.md`.

Three constraints shape everything below.

**The harness is early-access and undocumented.** `claude plugin eval` prints `` `plugin eval` is currently in early access `` and does nothing until `CLAUDE_CODE_WALNUT_SPIRE=1` is set. The full `--help` renders regardless, so a `--help`-only read misses the gate entirely. No public documentation page exists; the schema was read from the shipped binary and then confirmed by scaffolding a case with `claude plugin eval init smoke-probe --bare`. The manifest key lives under `experimental`, described as "components whose manifest shape may change without a deprecation cycle."

**Runs are slow and metered.** Default `runs` is 3, and the default ablation adds a second no-plugin arm, so a case costs 6 agent runs. Each is bounded by `max_turns` (default 10) and `timeout_seconds` (default 300). Eight cases at defaults is 48 agent runs — an estimated 1.2–2.5 h, hard worst case 7.5 h.

**CI is currently offline and dependency-free.** `.github/workflows/ci.yml` has no secrets, no env, and no `npm install` step; three jobs run on a bare `pull_request:` with no path filter. The `validate-plugin` job already installs the Claude Code CLI, so an eval job copies that bootstrap rather than inventing one.

## Goals / Non-Goals

**Goals:**
- Catch the eight failure classes that static assertions over prompt text structurally cannot observe.
- Keep the suite's cost proportionate: deterministic graders wherever the assertion allows, judged graders only where meaning is genuinely at stake.
- Make the harness's early-access dependency explicit and survivable, rather than an undocumented reason the suite silently stops working.

**Non-Goals:**
- No threshold is promoted to blocking here (D3). The suite must produce observed variance before a number means anything.
- No eval result feeds `interlock autonomy`, `interlock outcomes`, or any existing gate. Wiring a branch before there is a corpus is the mistake `lib/outcomes.mjs` already refuses to make.
- Not re-testing what the unit suite covers. A case duplicating a `node:test` assertion is refused by the case-suite spec.
- No changes to the prompts or skills under test. This change observes that surface; it does not alter it.

## Decisions

**D1 — Seed from archived proposals and the changelog, not from `.claude/memory/failure-modes/`.**
The request named `.claude/memory/failure-modes/` as the seed. All nine files under `.claude/memory/` were read and triaged: 0 eval-shaped, 4 unit-testable, 5 pure convention. Not one records a model reading correct instructions and behaving wrongly; four already have matching grep assertions in `test/workflows.test.mjs`. The corpus was written by an implementer to avoid re-breaking the build. The reproduced model-behaviour failures live instead in `openspec/changes/archive/*/proposal.md` `## Why` sections and `CHANGELOG.md`. *Alternative considered:* seed from memory anyway and accept weak cases — rejected, because a suite of cases that duplicate unit tests teaches the team to ignore it, which is the failure mode `interlock gate`'s quality band exists to prevent elsewhere in this repo.

**D2 — `evals/` at the repository root, no manifest key.**
The repository root is the plugin root, so `evals/` is the harness default and needs no `experimental.evals` declaration. This keeps the change off an undocumented manifest surface that may change without deprecation. It also avoids the component-overlap warning that placing cases under `skills/*/evals/` would trigger. *Alternative considered:* `experimental.evals` with a custom directory name — rejected for no benefit at strictly higher schema risk.

**D3 — Advisory gate on day one.**
No baseline scores exist anywhere in the repository, so any threshold chosen now is arbitrary. Judged graders take a majority of three votes at haiku and have inherent run-to-run variance that has not been measured here. The job reports and does not block; promotion requires observed variance across more than one run. *Alternative considered:* blocking at `--threshold 1.0` immediately — rejected, because the first flaky judged grader would train the team to bypass the gate, and a gate everyone disables protects nothing.

**D4 — Fork pull requests skip, and the job is never a required check.**
`ci.yml` fires on a bare `pull_request:`, which includes forks, where repository secrets resolve empty. Guard the job on the head repository matching the base repository. Do not mark it required, or fork pull requests become unmergeable on a check that structurally cannot run. *Alternatives considered:* `pull_request_target` — rejected, since checking out the pull request head under that trigger is arbitrary code execution with secrets in scope; a maintainer-applied label with a protected environment — deferred as unnecessary for a single-owner repository.

**D5 — Two run shapes: a smoke subset on pull requests, the full suite on a schedule.**
Full-suite cost rules out running everything per pull request. Tag a deterministic subset `smoke` and run it with a single run and no ablation arm on same-repository pull requests; run the full suite with ablation and judged graders on a schedule. This keeps the per-change signal coupled to the change that caused it — the coupling a nightly-only gate loses — while keeping the expensive arm off the critical path.

**D6 — Deterministic graders preferred; judged graders justified in writing.**
Four grader types are free and deterministic; two call a judge three times per grader. The strongest seed case — handoff `status` ∈ `{ok, blocked, partial}` — is set-membership and needs no judge at all. Preferring the cheapest grader that expresses the assertion is both a cost decision and a determinism decision.

**D7 — The `interlock:evals` skill is in scope, but only for the judgement half.**
A suite nobody can add to decays into a fixture nobody trusts. Authoring a case from a failure is judgement work, and so is explaining which change caused a regression; both are what a skill is for. The *classification* is not — see D13. *Alternative considered:* deferring the skill to a follow-up — rejected, because the seeding work in this change is exactly the procedure the skill should encode, and writing it later means deriving it twice.

**D13 — The triage verdict is a subcommand, not skill prose.**
Deciding regression versus variance versus no signal is a pure function of the results file: grader types, per-run scores, judge votes, and the partial reason are all in it. This repository's whole argument is that a decision with a correct answer belongs in a tested CLI rather than in prose a model can re-argue, and `interlock gate` already establishes exit-code-as-verdict for the same shape of decision. Putting the classification in `SKILL.md` would have made the eval gate the one gate in the plugin whose rule a model could talk itself past — in a change whose entire purpose is catching models talking themselves past instructions. So `interlock evals triage` owns the verdict, `lib/evals-triage.mjs` holds the rules, and the skill explains rather than classifies. *Alternative considered:* keeping triage in the skill and accepting the inconsistency — rejected at the artifact review gate as a blocker.

**D14 — Eval caps are published through `interlock limits`.**
`interlock limits` exists so nothing restates a cap, and currently publishes twelve of them plus the runtime ceilings. The cost ceilings, runs per case and reporting threshold are caps the loop obeys, so they go there rather than living only in workflow YAML where they would drift. This also follows the implementer prompt's own precedent at `workflows/ship.js:194-195`, which cites `interlock limits` rather than restating a number.

**D15 — The case-suite requirements are enforced by a structural test, not by memory.**
`specs/evals/case-suite/spec.md` states four requirements that are statically checkable against the files on disk: schema version pinned, provenance cited, no case inside a declared component directory, every grader declaring a known type. `test/evals.test.mjs` checks them in the shape `test/skills.test.mjs` already uses for `skills/**`. It runs offline in the existing `npm test` job, so unlike the eval run itself it gates every pull request including forks — which makes it the only part of this change that gates anything on day one.

**D12 (resolved) — The CI job skips cleanly with no credential, which is what unblocks the spend decision.**
Writing the job to skip when no model credential is present — the path forks already take under D4 — decouples merging this change from provisioning paid access. The suite, `test/evals.test.mjs` and `interlock evals triage` all land and run offline; the metered half sits inert until someone provisions a credential, at which point the job starts running with no edit to the workflow. Starting ceilings are $2 for the pull-request smoke subset and $15 for the scheduled full run, to be tuned from the `cost_usd` the first runs actually report rather than guessed at indefinitely.

**D8 — Enablement comes from the environment, never from committed settings.**
The binary states that a repository's `.claude/settings.json` or `settings.local.json` `env` normally leaves the command gated off, so committing the variable would produce a suite that appears configured and does not run. It goes in the CI job's `env:` block and in the contributor prerequisites.

**D9 — Force-add the new workflow file.**
`.gitignore:30-34` ignores `.github/workflows/` under a `#Copilot` heading; `git ls-files .github/` returns only `ci.yml`. A new workflow file added normally is silently untracked and never runs on the remote. The task that creates it must force-add it and verify with `git ls-files`.

**D10 — Report publication disabled in CI.**
The HTML report publishes to claude.ai by default whenever the account supports artifacts. An unattended job has nobody present to consent to publication, so the CI invocation disables it and retains the report as a build artifact instead.

## Risks / Trade-offs

- **Early access is removed or the variable is renamed** → the suite stops running everywhere at once. Mitigation: the gate is advisory (D3), so this degrades to lost signal rather than a blocked repository; the skill reports the prerequisite explicitly rather than reporting a passing suite (`evals/authoring`).
- **The `experimental` schema changes without deprecation** → cases fail to load. Mitigation: pin `schema_version` per case so a mismatch fails loudly at load; keep cases minimal; the documented fallback is a `claude -p --output-format json` harness driven by `node:test`, which needs no early access.
- **Judged-grader variance is read as regression** → trust in the suite erodes. Mitigation: deterministic graders preferred (D6); the triage contract forbids calling a single-run judged dip a regression.
- **Metered cost in a previously free CI** → surprise spend. Mitigation: an explicit ceiling on every metered run (D15), a breach reported as partial rather than as a pass, the smoke subset kept small, and the job skipping entirely until a credential is deliberately provisioned.
- **Eight cases understate the surface** → 33 model-facing files, 8 cases. This is a seed, not coverage. Accepted deliberately: a small suite that runs is worth more than a large one that is too slow to run.
- **D11 — Cases needing fixtures need an extra flag** → `context.scaffold_script` only runs under an explicit scaffold flag, and `prompt.md` frontmatter cannot express `context.*`. Those cases are therefore authored as `case.yaml` rather than `prompt.md`, and the runner sets the scaffold flag; otherwise the fixture silently does not exist and the case scores against an empty workspace. Cases needing no fixture stay on the simpler `prompt.md` form.

## Migration Plan

Additive throughout; nothing existing changes behaviour. Rollback is deleting `evals/`, `skills/evals/` and the new workflow file. The new skill enters `test/skills.test.mjs`'s existing structural gate automatically, so its frontmatter must satisfy that gate in the same task that creates it.

## Open Questions

None. The spend question that blocked the first draft is resolved structurally by D15 rather than by picking a number: the change lands and runs offline, and the metered job stays inert until a credential is provisioned. The two starting ceilings are explicitly first guesses to be replaced by observed `cost_usd`, which is a tuning input rather than a decision the specs depend on.
