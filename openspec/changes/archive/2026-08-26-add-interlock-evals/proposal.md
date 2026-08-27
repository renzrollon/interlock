## Why

Interlock's deterministic half is densely tested — ~760 `node:test` assertions across 27 files, plus `claude plugin validate --strict` in CI. Its model-facing half — 33 markdown files under `skills/`, `shared/` and `agents/`, plus the prompt assemblers in `workflows/ship.js` — ships untested against a model on every release, and the repo's own archived proposals document at least seven production failures where the prompt bytes were correct, the unit suite was green, and a model did the wrong thing anyway.

The plugin argues that decisions with a correct answer belong in code rather than in prose a model can talk itself past. That argument is currently unverified for the prose the plugin itself ships.

## What Changes

- Add an `evals/` case suite at the repo root, run by `claude plugin eval`, seeded with eight cases drawn from reproduced failures in `openspec/changes/archive/*/proposal.md` and `CHANGELOG.md`.
- Each case encodes one failure class that no static assertion can observe: tier read-scope compliance, cited-cap resolution, lane partial-failure reporting, handoff status enum conformance, control-plane action invention, trampoline halt, skill-routing discrimination, and evidence-locator fabrication.
- Prefer free deterministic graders (`tool_used`, `regex`, `file_exists`, `tool_order`) over paid `llm` graders wherever the assertion is set-membership, tool-invocation, or file-existence shaped. The strongest seed case needs no judge at all.
- Add an `interlock evals triage` subcommand that reads a results file and classifies each case as regression, variance, or no signal — without a model and without the network, with its exit status as the verdict, like every other decision on the deterministic spine.
- Publish the new caps (cost ceilings, runs per case, reporting threshold) through `interlock limits`, so nothing restates them.
- Add an `interlock:evals` skill covering what remains genuinely judgement-shaped: authoring a case from a described failure, and explaining a verdict triage produced — never reclassifying it.
- Add `test/evals.test.mjs`, a structural gate over `evals/**` in the same shape as the existing `test/skills.test.mjs`: schema version pinned, provenance cited, no case inside a component directory, every grader declaring a known type. It runs offline, so it gates every pull request including forks.
- Add a new path-filtered CI workflow, separate from `ci.yml`, that runs a fast smoke subset on same-repo pull requests and the full suite on a schedule. **Advisory on day one** — it reports and does not block, because no baseline scores exist yet and a threshold number would be arbitrary.
- Document `CLAUDE_CODE_WALNUT_SPIRE=1` as a prerequisite for running evals locally and in CI.

Not included, and deliberately: no threshold is promoted to blocking in this change, and no eval result feeds any existing gate. Both are follow-ups that need a corpus first.

## Capabilities

### New Capabilities
- `evals/case-suite`: where eval cases live, what a case must contain, which grader types are preferred for which assertion shapes, and the requirement that every case cite the reproduced failure it encodes.
- `evals/triage`: the model-free verdict — how a results file becomes a regression / variance / no-signal classification, and why the exit status is the verdict.
- `evals/gate`: how evals run in CI — trigger surface, fork-PR handling, absent-credential skip, report publication, enablement, and the advisory-before-blocking posture.
- `evals/authoring`: the `interlock:evals` skill contract for authoring a case from a failure and explaining a verdict it did not derive.

### Modified Capabilities
<!-- None. No existing requirement changes: the eval suite observes the shipped
     prompts and skills, it does not alter them. -->

## Impact

- **New files:** `evals/**` (8 case directories), `lib/evals-triage.mjs`, `test/evals.test.mjs`, `skills/evals/SKILL.md`, `.github/workflows/evals.yml`.
- **Modified:** `bin/interlock` (the `evals triage` subcommand and its usage entry), `lib/limits.mjs` (publish the new caps), `README.md` (prerequisite and command). `test/skills.test.mjs` needs no edit — the new skill enters its existing structural gate automatically and must satisfy the frontmatter allowlist, name-matches-directory, and description-length rules.
- **Not modified:** `.claude-plugin/plugin.json`. `evals/` at the repo root is the harness default, so no `experimental.evals` key is needed — which keeps the change off an undocumented manifest surface.
- **New optional dependency:** Anthropic model access in CI. The repo's CI is currently offline and dependency-free, so the eval job is written to skip cleanly when no credential is present. The suite, its structural test and its triage subcommand all land and run without one; provisioning is a later configuration action, not a prerequisite for this change.
- **Mechanical trap:** `.gitignore:30-34` ignores `.github/workflows/`. `git ls-files .github/` returns only `ci.yml`. The new workflow file must be force-added or it is silently untracked.
- **Dependency risk:** `claude plugin eval` is early-access gated and publicly undocumented; its schema lives under `experimental`, which may change without a deprecation cycle.
