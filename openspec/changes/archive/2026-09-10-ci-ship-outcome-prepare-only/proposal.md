## Why

The outcome apparatus at `evals/ship/` already has three solvable fixtures, isolation rules, and a model-free `--prepare-only` path, but ordinary CI never treats that path as a requirement. A broken fixture, reference, or isolation rule can land while the only repeating outcome job — `.github/workflows/ship-outcome-eval.yml` — is metered, Wednesday-only, never on a pull request, and has no committed `evals/history/ship-outcomes.jsonl` to show the runner still works. The cheap check that copy/validate/solve-check still works without spend is a README hope, not a build failure.

## What Changes

- **Ordinary CI invokes `--prepare-only` without a credential.** `node evals/ship/run.mjs --prepare-only` runs on push and pull request so a broken fixture or isolation regression fails the build with no model call and no spend.
- **A dedicated job in `.github/workflows/ci.yml` is enough.** It is not a new build system, not a fourth eval framework, and not a job on the Node 18/20/22 unit matrix. Existing `node:test` coverage of isolation and solvability stays; this change does not add duplicate eval cases.
- **Prepare-only stays the cheap path it already is.** Zero-network, refuses an in-repo scratch root, does not write into this repository's `.claude/ship/`, `.claude/learning/`, or `.claude/metrics/`, does not invoke a model, and writes no history row.
- **Specs name the split.** The metered outcome sweep remains schedule/`workflow_dispatch` only. The model-free prepare path is what ordinary CI must run. Failing the build on a prepare-only failure is apparatus hygiene, not wiring an outcome *score* into ready, gate, or ship.

**Explicitly out of scope** (sibling changes or later operations own these):

- Aligning `interlock evals triage` with harness `schemaVersion: 1`, pinning `smoke-2026-09-04.json`, or the stale sentence in `docs/10`.
- An offline JSONL trajectory grader.
- Changes to the Wednesday/`workflow_dispatch` metered job, committing `ship-outcomes.jsonl`, feeding outcome scores into ready/gate/ship, new fixtures, Harbor/AgentEvals/runtime deps, a host matrix, or a `--strict` tail.

## Capabilities

### New Capabilities

None. The prepare path and the fixture set already exist.

### Modified Capabilities

- `evals/outcome-run`: the existing "scheduled, bounded, and never runs on a pull request" requirement is narrowed to the *metered* sweep. A new requirement makes ordinary CI run `--prepare-only` without a credential, fail the build on a non-zero exit, and never treat a missing credential as skip-or-pass.
- `evals/outcome-fixtures`: the existing isolation and solvability rules gain a requirement that the model-free prepare path — including the CI job that invokes it — stays zero-network, refuses in-repo roots, does not pollute this repository's corpora, and does not invoke a model.

## Impact

- **`.github/workflows/ci.yml`** — one dedicated job that runs `node evals/ship/run.mjs --prepare-only` with no secret and no install step. `.github/workflows/` is gitignored, so the edit must stay force-tracked (`git add -f`), the same trap `evals.yml` and `ship-outcome-eval.yml` already assert.
- **`evals/ship/README.md`** — state that ordinary CI runs `--prepare-only`, so the split (cheap CI vs metered schedule) is spoken rather than inferred.
- **Tests** — pin that `ci.yml` invokes `--prepare-only`, carries no model secret, and is not the metered sweep. Do not add new fixture or isolation cases; `test/spine/ship-outcome-eval.test.mjs` and `test/spine/ship-fixtures.test.mjs` already own those.
- **Not modified:** `evals/ship/run.mjs` (the flag already exists), `lib/`, `bin/`, `skills/`, `.github/workflows/ship-outcome-eval.yml`, `evals.yml`, `package.json` scripts, and every gate. No runtime dependency. No lint or build step.
- **Later, not this change:** a maintainer `workflow_dispatch` of the metered job can produce `evals/history/ship-outcomes.jsonl` rows. That is operational. This change does not require a live LLM run or a committed jsonl.
