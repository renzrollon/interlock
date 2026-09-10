## Context

See `proposal.md` — Why. Constraints that shape the reader, not the motivation:

- `classifyCase` in `lib/evals-triage.mjs` takes `kase.id` and `kase.runs[].graders[]`. Every test in `test/spine/evals-triage.test.mjs` builds that shape by hand. The committed harness file uses `name` and `arms.with[]` (per-trial objects whose `graders[]` already carry `name` / `passed`). Empty `runs` makes every case fall through to pass.
- `EXIT` is `{ pass: 0, regression: 1, no_signal: 2, configuration: 3 }`. `bin/interlock` already parses `--results` JSON and exits with `verdict.exitCode`. No new subcommand, flag, or exit.
- Zero runtime dependencies. No lint or build step. Caps stay in `interlock limits` / `evals.*`; this change does not touch them.
- Slice E1 recorded the schema disagreement as a defect and left the fixture-backed assertion blocked. This slice writes that assertion against the run's true verdict.
- Judged-type vocabulary (`llm`) and indicator detection (`arm: with-only` vs `type: indicator`) are already named unpinned. The smoke fixture has neither. They stay unpinned.

## Goals / Non-Goals

**Goals:**

- One normalizer at the case boundary so `classifyCase` stays the single classification rule.
- Dual-read that keeps every existing `id`/`runs` test green without editing those inputs.
- A fixture-backed test that fails if triage again reports pass on `test/fixtures/evals/smoke-2026-09-04.json`.
- Hand-built harness-shaped tests for the arms the fixture does not exercise (`with-only` only; `with` + `without`).
- Docs/10 status line matches 2026-09-04; the spec-path coverage sentence stays.

**Non-Goals:**

- No change to classification (deterministic / judged / indicator), partial / configuration branches, or `EXIT`.
- No speculative remap of harness grader `type: llm` into judged, and no treat-`withOnly: true`-as-indicator. Those wait for a fixture that exercises them (same disposition as `ground-evals-in-a-real-run` design).
- No second metered run, no `evals/history` append, no promotion/calibration/capture edits, no `evals.yml` trigger widening, no outcome-eval work, no new dependency.

## Decisions

### D1 — Normalize identity and trials, then call the existing classifier

Add a small helper that maps one raw case to `{ id, runs }` and pass that into today's `classifyCase`. `triage()` also uses the same identity helper when naming unloadable cases.

*Why:* the classification rule is already specified and tested. A second copy of it, one per shape, is how the next schema tweak forks the verdict. The helper is the only new behaviour; everything downstream is unchanged.

*Alternative rejected:* rewrite `classifyCase` to read `name`/`arms` inline. That mixes two schemas into the rule and makes the next dual-read harder. *Also rejected:* detect `schemaVersion === 1` and take a wholly separate path. The smoke file carries that field, but a results object that omitted it and still used `name`/`arms` would be silently misread — the same class of bug this slice is fixing.

### D2 — Trial-list precedence: first non-empty of `runs`, then `arms.with`, then `arms['with-only']`

A list is non-empty when it is an array of length greater than zero. `arms.without` is never selected.

*Why this order:*

1. **`runs` first** keeps every existing unit-test input classifying as it does today, including tests that pass `runs: []` implicitly by omitting trials they do not care about.
2. **`with` before `with-only`** matches what the harness emits for a scored plugin arm. `with-only` is the fallback when that arm is absent (ablation / indicator-only cases).
3. **Never `without`.** That arm is the no-plugin baseline. Scoring it would mix comparison trials into the plugin verdict.

Each selected trial is presented to `classifyCase` as `{ graders: trial.graders }` so the existing `run.graders` loop does not change. Per-trial objects in the smoke fixture already have `graders[]` with `name` and `passed`.

### D3 — Identity is `name`, else `id`

`formatTriage` prints `c.id`. The normalizer writes the chosen identity onto `id`, so harness cases surface as `tier-read-scope` rather than `(unnamed)`. Prefer `name` when it is a non-empty string; otherwise `id`.

### D4 — Fixture test asserts the run's own report, not today's pass

`test/spine/evals-triage.test.mjs` gains one test that `readFileSync` + `JSON.parse`s `test/fixtures/evals/smoke-2026-09-04.json` (repo-relative from the test file) and asserts:

- `verdict === 'regression'`
- `exitCode === EXIT.regression` (and `=== 1`)
- a classified case whose identity is `tier-read-scope` and whose `classification` is `regression`
- `graders` includes `no-design-read` and `no-spec-read`
- `formatTriage` matches `/tier-read-scope/` and both grader names

The three passing smoke cases (`cited-cap-resolution`, `control-plane-action`, `handoff-status-enum`) are not required to be enumerated; the contract is the run-level regression and the named failure. Do not add an assertion that the file currently yields pass.

Existing hand-built tests stay. They are the dual-read proof for the legacy shape.

### D5 — Hand-built harness-shaped tests cover the arms the fixture does not

The smoke fixture only has `arms.with`. Spec scenarios for `with-only` and for ignoring `without` are therefore constructed in the unit file, using the same grader helpers (`det` / `judge` / `run`) already there, placed under `name` + `arms` instead of `id` + `runs`:

- `{ name, arms: { 'with-only': [run(det('shape', false))] } }` → regression naming `shape`
- `{ name, arms: { with: [run(det('ok', true))], without: [run(det('baseline-fail', false))] } }` → pass (the `without` failure is not scored)

These pin trial-list selection. They do not pin `withOnly: true` as an indicator (D6).

### D6 — Leave judged-type and indicator detection unpinned

Harness case-level grader types include `llm`; triage's judged set does not. Per-trial graders in the smoke file have no `type` at all — absence of `judged`/`type` is treated as deterministic, which is correct for this fixture's `tool_used` / `regex` failures. Skill-fired indicators are marked `arm: with-only` on the case, while `isIndicator` looks for `type: 'indicator'` or `indicator: true`.

Neither gap is exercised by `smoke-2026-09-04.json`. Guessing a mapping without a fixture is how `id`/`runs` landed. Name both as unpinned in `test/fixtures/evals/README.md` (they already are). Do not change `JUDGED_TYPES` or `isIndicator` in this slice.

### D7 — Docs/10: replace only the dated status clause

In `docs/10-agentic-workflow-ship-and-spec.md` §8 Evals, keep the paragraph that names the spec-path gap (`skills/spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap` have no model-in-the-loop coverage). Replace only the closing sentence that currently reads that as of 2026-09-03 the suite has not been run.

Replacement intent (not a threshold, not a case count): a smoke subset ran on 2026-09-04; three of four cases passed; `tier-read-scope` failed; that is a baseline, not a trend; it does not add spec-path coverage. Leave the advisory-job sentence and the `interlock limits` pointer as they are. Do not describe the former triage false-pass in that page — the fixture README is the defect record.

### D8 — Fixture README: defect resolved, unpinned list unchanged

Rewrite the “DEFECT this run revealed” section to state that triage now classifies the file as a regression and that `test/spine/evals-triage.test.mjs` pins that verdict. Keep the “What this fixture does NOT pin” list (judged, indicator, `loaded`/unloadable, partial-run) and add the D6 items (`type: llm` as judged; `withOnly` as indicator) so they stay named rather than presumed.

## Risks / Trade-offs

- **`runs` precedence hides harness arms if a future file carries both a non-empty `runs` and `arms.with`.** → Unobserved in `schemaVersion` 1. If it appears, the fixture assertion still pins the real file; a mixed-shape file would be a new harness revision and a new change. Preferring `runs` is what keeps today's unit tests untouched.
- **Per-trial graders omit `type`, so `llm` / indicator detection cannot be proven from the smoke file.** → Accepted (D6). A full-suite fixture is the pin for those branches; this slice does not invent one.
- **Selecting only `arms.with` ignores a failure that exists solely in `arms['with-only']` when both arms are present.** → Matches scoring: `with-only` graders are indicators excluded from the case score. A failed indicator must not become a regression. If both arms are present, `with` is the scored list.
- **Docs/10 still says “a case below threshold” after `reportingThreshold` was removed.** → Out of this slice. Editing that clause would be an unrelated restatement of gate language.

## Migration Plan

Nothing persisted changes shape. `interlock evals triage --results` gains a correct reading of files it already accepted as JSON. Rollback is reverting the change. No CI workflow edit, so no advisory/blocking posture shift.

1. Land the normalizer and the new tests together; `npm test` is the verification.
2. Rewrite the fixture README in the same change so the recorded defect does not outlive the pin.
3. Edit the one docs/10 sentence in the same change.

## Open Questions

None. Remaining schema gaps (D6) are recorded unpinned findings, not questions this slice needs answered before apply.
