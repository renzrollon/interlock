# Committed eval results fixtures

## `smoke-2026-09-04.json`

The results file from the first metered smoke run of the Interlock eval suite —
the baseline that `openspec/changes/.../ground-evals-in-a-real-run` set out to
record. It is committed here, **outside `evals/`**, because `evals/` is the
harness's discovery root and `test/evals.test.mjs`'s structural gate walks it; a
results file there would be scanned as a case directory.

### Which run produced it

- Command: `claude plugin eval . --tag smoke --runs 1 --ablation none --no-publish --max-cost-usd 2 --json <file>`
- Harness: `claude` 2.1.260, results `schemaVersion: 1`
- Started: 2026-09-04T17:49:44Z · `costUsd` 0.7222594999999999 · `partial: false`
- Suite: the four `smoke`-tagged cases (`cited-cap-resolution`,
  `control-plane-action`, `handoff-status-enum`, `tier-read-scope`), one run each,
  deterministic graders only, `ablation: none`.

### What was removed (redaction is by removal, never rewriting)

- `cases[].promptMarkdown` — the eval prompt text (4 cases).
- `cases[].arms.<arm>[].tracePath` — pointers to per-run transcript files on the
  runner's disk (4 arm runs).

Every scoring field is kept byte-for-byte: `cases[].name`, `cases[].graders[]`,
`cases[].arms.with[].passed`/`score`/`graders[]`, `cases[].aggregates`, and the
top-level `aggregates`, `costUsd`, `partial`. No retained value was edited —
editing one would forge the evidence this fixture exists to be.

### DEFECT this run revealed — triage misreads the harness schema

The run and `interlock evals triage` **disagree**, which the triage spec
(`evals/triage` — "Triage disagrees with the run's own report") says to record as
a defect, not to paper over:

- The harness reports `aggregates.casesPassed: 3` of 4 — `tier-read-scope` scored
  0 (`arms.with[0].passed: false`; graders `no-design-read` and `no-spec-read`
  both false).
- `interlock evals triage --results <file>` reports **`pass` — "scored 4:
  0 regression, 0 variance, 4 pass"**, exit 0.

Root cause: `lib/evals-triage.mjs` `classifyCase` reads `kase.id` and `kase.runs`,
but schemaVersion 1 writes `kase.name` and `kase.arms.with[]` / `kase.arms['with-only'][]`.
So `runs` resolves to `[]` for every case, the grader loop never executes, and
every case falls through to `pass` — triage never sees `tier-read-scope`'s real
failure. `kase.loaded` is likewise absent (the schema has no such field), so the
`loaded: false` branch is never reached either.

Fixing triage's schema reading is **out of scope for this slice** (design
Non-Goals; "carried into the Slice E2 change"). Until that fix lands, no
fixture-backed triage test can assert the run's true verdict without asserting the
bug — so `tasks.md` task 5.1 is recorded as blocked on this defect, not completed.

### What this fixture does NOT pin

Even once triage reads the schema, one clean smoke run pins only part of it:

- the case-shape and grader-shape of `schemaVersion: 1`;
- three deterministic clean passes and one deterministic failure.

It does **not** pin: the judged-grader branch, the indicator branch, the
`loaded`/unloadable branch, or the partial-run branch. Those stay hand-built in
`test/spine/evals-triage.test.mjs` and must be named as unpinned rather than
presumed correct.
