## 1. Ordinary CI job and README

- [x] 1.1 Add a dedicated job to `.github/workflows/ci.yml` beside `validate-plugin` and `cli-smoke`: Node 22, checkout, no install step, `node evals/ship/run.mjs --prepare-only`, no `secrets.ANTHROPIC_API_KEY`, no credential-skip step, no `continue-on-error`. Force-add the file (`git add -f .github/workflows/ci.yml`). Do not edit `evals/ship/run.mjs`, `ship-outcome-eval.yml`, `evals.yml`, `lib/`, `bin/`, or `package.json`.
- [x] 1.2 State in `evals/ship/README.md` that ordinary CI runs `--prepare-only` (no model, no spend, no history row). Do not restate a published cap. Do not edit `skills/`.

## 2. Pins

- [x] 2.1 Extend `test/spine/ship-outcome-eval.test.mjs` to pin that `ci.yml` invokes `evals/ship/run.mjs --prepare-only`, that the prepare job does not read `secrets.ANTHROPIC_API_KEY` or use `workflow_dispatch`, and that `.github/workflows/ci.yml` stays in `git ls-files`. Pin README tokens for the ordinary-CI split. Do not add a second spawn of `--prepare-only` and do not add new fixture, solvability, or isolation cases.
