## 1. Dual-read normalizer

- [x] 1.1 In `lib/evals-triage.mjs`, add the identity and trial-list helpers (design D1–D3) and feed them into `classifyCase` and the unloadable-name path: identity is non-empty `name` else `id`; scored trials are the first non-empty of `runs`, `arms.with`, `arms['with-only']`; never select `arms.without`; present each selected trial as `{ graders: trial.graders }`. Leave `classifyCase` rules, `EXIT`, `JUDGED_TYPES`, and `isIndicator` unchanged. No new dependency.

## 2. Pins and documentation

- [x] 2.1 In `test/spine/evals-triage.test.mjs`, keep every existing `id`/`runs` test. Add (D4) a test that `readFileSync` + `JSON.parse`s `test/fixtures/evals/smoke-2026-09-04.json` and asserts `verdict === 'regression'`, `exitCode === EXIT.regression` and `=== 1`, a classified case identity `tier-read-scope` with `classification === 'regression'`, `graders` including `no-design-read` and `no-spec-read`, and `formatTriage` matching those three names. Add (D5) a harness-shaped `arms['with-only']` deterministic failure → regression, and a `arms.with` pass plus `arms.without` failure → pass. Do not assert that the smoke file yields pass.
- [x] 2.2 Rewrite the “DEFECT this run revealed” section of `test/fixtures/evals/README.md` to record that triage now classifies the file as a regression and that the spine test pins that verdict. Keep the unpinned list (judged, indicator, `loaded`/unloadable, partial-run) and name the D6 gaps (`type: llm` as judged; `withOnly` as indicator).
- [x] 2.3 In `docs/10-agentic-workflow-ship-and-spec.md` §8 Evals, replace only the “as of 2026-09-03 the suite has not yet been run” sentence: smoke ran 2026-09-04, three of four passed, `tier-read-scope` failed, baseline not a trend, no spec-path coverage added. Leave the spec-path gap sentence, the advisory-job sentence, and the `interlock limits` pointer unchanged.

## 3. Verification

- [x] 3.1 Run `npm test` and paste the output. Fix code, never tests, on any failure.
  - 1939 tests, 1918 pass, 17 fail. The same 17 fail on a clean `HEAD` worktree (1936/1915/17) — they are pre-existing and belong to the in-flight `grade-ship-outcome-trajectories` / `ci-ship-outcome-prepare-only` work (`ship-graders`, `ship-outcome-eval`, `run`, `cli` notify, `root-isolation`). This change adds 3 tests and 3 passes and no failure.
- [x] 3.2 Run `openspec validate --change align-evals-triage-with-harness-schema --strict` and confirm it passes.
  - The flag is positional in this CLI version: `openspec validate align-evals-triage-with-harness-schema --type change --strict` → "Change 'align-evals-triage-with-harness-schema' is valid".
