## Context

See proposal.md — Why. Constraints that shape the wiring:

- `node evals/ship/run.mjs --prepare-only` already exists. It copies each fixture to a scratch root under the system temporary directory, git-inits a starting-state commit, refuses a root inside this repository, discards the root, and exits non-zero if any fixture fails. It does not call a model, does not read `ANTHROPIC_API_KEY`, and does not append `evals/history/ship-outcomes.jsonl`.
- `test/spine/ship-outcome-eval.test.mjs` already spawns that flag under `npm test`. `test/spine/ship-fixtures.test.mjs` already applies each reference implementation. Ordinary CI therefore already *exercises* prepare and solvability as unit assertions. It does not *name* `--prepare-only` as a CI contract, and `evals/outcome-run` currently says the eval never runs on a pull request.
- `.github/workflows/ci.yml` is the unit / plugin-validate / CLI-smoke workflow (`pull_request` and `push` to `main`). `.github/workflows/ship-outcome-eval.yml` is schedule + `workflow_dispatch` only; its tests forbid `pull_request` and `push`. `.github/workflows/` is gitignored; tracked workflows are force-added.
- Zero runtime dependencies. CI installs nothing. There is no lint or build step. Caps stay in `interlock limits`; this job has no ceiling because it spends nothing.
- Isolation: a fixture run must not write `.claude/ship/`, `.claude/learning/`, or `.claude/metrics/` in this repository (the 2026-08-29 purge). The runner already enforces that; CI must not disable it.

## Goals / Non-Goals

**Goals:**

- Make ordinary CI fail when `--prepare-only` fails, without a credential and without spend.
- Keep the metered sweep off pull requests, in its own workflow file, unchanged.
- Pin the wiring so dropping the job is a test failure, the same way an untracked `ship-outcome-eval.yml` already is.

**Non-Goals:**

- Changing `evals/ship/run.mjs`, expanding `--prepare-only` to re-run reference solvability, or adding fixtures.
- A new workflow file, a `package.json` script, a fourth eval framework, or a metered job on `pull_request`.
- Editing `evals/prerequisites`: doctor rows stay about the metered suite's credential, which prepare-only does not consult.
- Committing jsonl, dispatching the Wednesday job, or any live model run.

## Decisions

### D1 — One dedicated job in `ci.yml`, not the Node matrix and not a new workflow

Add a job beside `validate-plugin` and `cli-smoke`: `ubuntu-latest`, Node 22, `actions/checkout` + `actions/setup-node`, no install, then `node evals/ship/run.mjs --prepare-only`. A non-zero exit fails the workflow. No `continue-on-error`. No secret.

*Alternatives considered.* (a) A step on the Node 18/20/22 `test` matrix. Rejected: the findings named that cost explicitly, and the unit suite already spawns `--prepare-only` once per matrix cell. (b) A new workflow file. Rejected: `ship-outcome-eval.yml` exists to keep metered triggers off PRs; sharing a file would entangle the two surfaces (archive D11). Ordinary CI already lives in `ci.yml`. (c) A `package.json` script. Rejected: no new script surface; the README already documents the `node evals/ship/run.mjs` invocation. (d) Treating the existing unit-test spawn as the CI contract. Rejected: that test can move or skip without the spec noticing; the job is the requirement.

### D2 — Leave the runner alone

`--prepare-only` is copy / isolate / discard. `checkFixtureSolvable` and reference apply stay in the unit suite. This change does not fold solvability into the CI job and does not duplicate those tests as new eval cases.

*Alternative considered:* have CI run prepare *and* apply each reference. Rejected: that reimplements `test/spine/ship-fixtures.test.mjs` and would be a runner or job change this slice does not need.

### D3 — Absence of a credential is explicit, never a skip

The job does not set `ANTHROPIC_API_KEY` and does not copy `ship-outcome-eval.yml`'s "no credential → skip" step. That skip is correct for the metered sweep (no-signal) and would hide a broken fixture if reused here.

Optionally set `ANTHROPIC_API_KEY` to empty in the job `env` so a repo-level secret cannot leak into the step. Either form is fine so long as the job never reads `secrets.ANTHROPIC_API_KEY` and never skips.

### D4 — Pin the YAML, force-add, do not re-test isolation

Extend the existing workflow assertions (same file that already pins `ship-outcome-eval.yml`):

- `ci.yml` contains `evals/ship/run.mjs` and `--prepare-only`.
- The prepare job does not reference `secrets.ANTHROPIC_API_KEY` or `workflow_dispatch`.
- `git ls-files` still lists `.github/workflows/ci.yml` (gitignore trap).

Do not add a second spawn of `--prepare-only` in tests. Isolation, in-repo refusal, and solvability stay where they are.

After editing `ci.yml`, `git add -f .github/workflows/ci.yml` so the job actually runs on the remote.

### D5 — README states the split; skills stay untouched

`evals/ship/README.md` already documents `--prepare-only` as no model / no spend / no row. Add that ordinary CI runs that path, so a reader cannot infer that only Wednesday measures the apparatus. Pin tokens (`prepare-only`, ordinary CI), not a sentence. Do not restate a published cap. Do not edit `skills/`.

## Risks / Trade-offs

- **The unit matrix already runs `--prepare-only` once per Node version; the new job runs it again.** → Accepted. The job is the named contract and runs once on Node 22; the matrix spawn stays an assertion, not the requirement.
- **Someone later copies the metered job's credential skip into `ci.yml`.** → The pin forbids `secrets.ANTHROPIC_API_KEY` on the prepare job and forbids treating a missing credential as success.
- **`.github/workflows/` is gitignored and the edit never reaches GitHub.** → `git add -f` plus `git ls-files` on `ci.yml`.
- **A reader treats a red prepare job as "the outcome eval failed" and wants to gate ship on scores.** → Spec: a prepare failure is not a graded result; `ship-outcome-eval.yml` stays off PRs and not a required check.
- **Prepare-only is slower than expected on GitHub-hosted disks.** → Three fixture copies and three git inits. If it ever dominates `ci.yml`, keep it a dedicated job; do not fold it into the matrix and do not invent a build cache.

## Migration Plan

Additive. Rollback is deleting the job from `ci.yml` (force-add the revert) and reverting the README and the YAML pin. No gate, no `package.json` key, and no consumer path depends on the job.

## Open Questions

None. Whether GitHub branch protection marks the `CI` workflow required is a repo setting; in-tree, a failed prepare job fails that workflow.
