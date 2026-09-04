## Why

The eval suite is fully built and has never produced a single trial. Eight cases, seventeen graders, a model-free triage verdict, an advisory CI job and two published cost ceilings all exist, and `openspec/changes/archive/2026-08-26-add-interlock-evals/baseline.md` still reads `Status: DEFERRED`. Everything downstream of that gap is an assumption: the results-file field names `lib/evals-triage.mjs` reads are a guess about an undocumented early-access schema, the CI job has never exercised its credential, ceiling or `--tag smoke` branches, and "advisory pending a baseline" is permanent because no baseline can arrive.

Two smaller defects compound it. `EVAL_CAPS.runsPerCase` and `EVAL_CAPS.reportingThreshold` are printed by `interlock limits` and read by nothing — the exact failure `lib/limits.mjs` exists to end, one object over, exempted from the reader-invariant test on the grounds that the readers live in CI YAML the test does not walk. And `.github/workflows/evals.yml` sits under a gitignored directory, tracked only because it was force-added; nothing asserts that, so a rebase that re-applies the ignore silently deletes the entire gate.

## What Changes

- **Record the first observed baseline.** Run the smoke subset once with a provisioned credential under the ceiling `interlock limits` publishes, and replace the `DEFERRED` placeholder with the per-case scores and the run's `cost_usd`. This step needs a human: a credential and the early-access variable cannot be provisioned by an agent or by an unattended job.
- **Turn that run's results file into a fixture.** Commit it (secrets and transcripts stripped) under `test/fixtures/evals/` and add a triage test that loads the file rather than a hand-built object, asserting the verdict the run actually produced. A renamed harness field then fails `npm test` instead of silently changing a verdict.
- **Give every published eval cap a reader, or remove it.** `EVAL_CAPS.runsPerCase` becomes the `--runs` the scheduled full-suite job passes. `EVAL_CAPS.reportingThreshold` is removed from `EVAL_CAPS` and from `formatLimits()` together — triage decides on grader booleans and has no score-based path, so the threshold describes behaviour that does not exist.
- **Extend the reader-invariant test** to walk `EVAL_CAPS` as well as `LIMITS`, and to search `.github/workflows/` alongside `lib/`, `bin/` and `workflows/`, so a CI-only reader counts and the exemption comment can go.
- **Restate the gate spec's threshold language.** Two `evals/gate` scenarios describe a case scoring "below the reporting threshold"; with the threshold gone they must describe what the job actually reports — the triage verdict.
- **Assert the workflow file is tracked.** A test that fails `npm test` when `.github/workflows/evals.yml` is absent from `git ls-files`.

No new eval case, no new harness, no change to what the gate blocks. The suite stays advisory.

## Capabilities

### New Capabilities

None. Every behaviour here amends an existing capability.

### Modified Capabilities

- `evals/gate`: adds a requirement that the first metered run is recorded as an observed baseline with its cost and never with invented scores; adds a requirement that the workflow definition is tracked in version control despite the ignore rule; adds a requirement that the scheduled full-suite run reads its runs-per-case from the published limits surface; and restates the two scenarios that name a reporting threshold in terms of the triage verdict.
- `evals/triage`: adds a requirement that triage's reading of the results-file schema is pinned by a file the harness actually produced, not only by hand-built objects.
- `ship/cap-authority`: broadens "every advertised cap SHALL be enforced by code" to cover every cap group the limits surface prints — not only the loop-iteration group — and recognises a continuous-integration workflow definition as a reader location.

## Impact

- `lib/limits.mjs` — `EVAL_CAPS.reportingThreshold` removed; the `formatLimits()` eval row block loses one row; the module comment explaining why `EVAL_CAPS` is exempt from the invariant is no longer true and goes.
- `test/spine/limits.test.mjs` — the reader-invariant test gains a second cap group and a fourth search root; a removal assertion for `reportingThreshold` joins the existing `memoryEntriesPerRun` one.
- `test/spine/evals-triage.test.mjs` — one new fixture-loading test alongside the twelve hand-built-object tests.
- `.github/workflows/evals.yml` — the full-suite job resolves and passes `--runs`; both jobs otherwise unchanged.
- `test/fixtures/evals/` — new directory holding one committed results file.
- `openspec/changes/archive/2026-08-26-add-interlock-evals/baseline.md` — the `DEFERRED` status is replaced by observed scores.
- A test file asserting `git ls-files` tracking (new or an existing structural test file).
- **Human prerequisite:** a provisioned `ANTHROPIC_API_KEY` and `CLAUDE_CODE_WALNUT_SPIRE=1`. Two of the four requirements land without it; two do not land at all until someone runs the suite.
- No new runtime dependency. No change to `package.json`.
