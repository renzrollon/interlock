## Why

`interlock evals triage` cannot see a regression the harness already recorded. `lib/evals-triage.mjs` still reads `cases[].id` / `cases[].runs[]` — the hand-built shape in `test/spine/evals-triage.test.mjs` — while `claude plugin eval` (`schemaVersion` 1) writes `cases[].name` / `cases[].arms.with[]` (and `arms['with-only']`). The only committed real results file, `test/fixtures/evals/smoke-2026-09-04.json`, scored 3 of 4 smoke cases with `tier-read-scope` failing both deterministic graders, and triage reports **pass**. Until that reader is aligned, later eval work cannot be trusted: promotion, calibration, and history all consume a verdict that is blind. The defect is recorded in `test/fixtures/evals/README.md` and `openspec/changes/archive/2026-08-26-add-interlock-evals/baseline.md`; Slice E1 left the fixture-backed assertion blocked rather than green-washing it.

## What Changes

- Teach triage to dual-read: accept the harness `schemaVersion` 1 case shape (`name`, `arms.with` / `arms['with-only']`) **without dropping** the legacy `id` / `runs` shape the existing unit tests use.
- Pin `test/fixtures/evals/smoke-2026-09-04.json` as a fixture that **MUST** yield **regression** (exit 1), naming `tier-read-scope` and the failed graders (`no-design-read`, `no-spec-read`) in the assertion — the verdict the run itself reported, not the current false pass.
- Delta `evals/triage` so the accepted results-file shapes are specified, not only implemented. Keep triage model-free, network-free, and on the existing exit-code verdict (0 pass / 1 regression / 2 no_signal / 3 configuration). Do not invent new exits.
- Update the dated “never run” sentence in `docs/10-agentic-workflow-ship-and-spec.md` so status matches the 2026-09-04 smoke run. Keep the coverage boundary: no spec-path cases exist.

Not in scope (sibling changes own these): running `node evals/ship/run.mjs --prepare-only` in CI; an offline JSONL trajectory grader; running smoke with a credential; committing `evals/history`; calibrating judged graders; authoring new eval cases; triggering `evals.yml` on `evals/**` or `lib/**`; host matrix; `--strict` tail; Harbor / AgentEvals / new deps; wiring evals into ready / gate / ship.

## Capabilities

### New Capabilities

None. This change amends the existing triage reader; it does not introduce a new concern.

### Modified Capabilities

- `evals/triage`: specify the results-file shapes triage SHALL accept (harness `schemaVersion` 1 and the legacy unit-test shape), require dual-read so neither shape is dropped, and require the committed 2026-09-04 smoke fixture to classify as a regression naming `tier-read-scope` and its failed deterministic graders. Classification rules, incompleteness, configuration, and the 0/1/2/3 exit map stay as they are.

## Impact

- **Code**: `lib/evals-triage.mjs` — normalize a case's identity and trial list from either shape before classification. Classification, judged-vs-deterministic, indicators, partial/configuration branches, and `EXIT` stay as they are.
- **Tests**: `test/spine/evals-triage.test.mjs` — keep every existing hand-built `id`/`runs` test; add a fixture-loading test that reads `test/fixtures/evals/smoke-2026-09-04.json` and asserts regression / exit 1 / named case and graders. This is the Slice E1 task 5.1 that stayed blocked on this defect.
- **Fixture docs**: `test/fixtures/evals/README.md` — the “DEFECT this run revealed” section is rewritten as resolved once the pin lands; the unpinned schema parts (judged, indicator, `loaded`, partial-run) stay named as unpinned.
- **Documentation**: `docs/10-agentic-workflow-ship-and-spec.md` — replace the 2026-09-03 “suite has not yet been run” sentence; do not claim spec-path coverage.
- **CLI**: `interlock evals triage --results` already parses JSON and calls `triage()`; no new flag, no new subcommand, no new exit code.
- **Dependencies**: none. Stdlib Node only. No lint or build step.
- **Not touched**: `evals/` cases, `evals.yml` triggers, promotion, calibration, capture, outcome eval, `lib/limits.mjs`, ship / ready / gate.
