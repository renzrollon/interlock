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

### DEFECT this run revealed — triage misread the harness schema (resolved)

The run and `interlock evals triage` originally **disagreed**, which the triage
spec (`evals/triage` — "Triage disagrees with the run's own report") says to
record as a defect, not to paper over:

- The harness reports `aggregates.casesPassed: 3` of 4 — `tier-read-scope` scored
  0 (`arms.with[0].passed: false`; graders `no-design-read` and `no-spec-read`
  both false).
- `interlock evals triage --results <file>` reported **`pass` — "scored 4:
  0 regression, 0 variance, 4 pass"**, exit 0.

Root cause: `lib/evals-triage.mjs` `classifyCase` read `kase.id` and `kase.runs`,
but schemaVersion 1 writes `kase.name` and `kase.arms.with[]` / `kase.arms['with-only'][]`.
So `runs` resolved to `[]` for every case, the grader loop never executed, and
every case fell through to `pass` — triage never saw `tier-read-scope`'s real
failure.

`align-evals-triage-with-harness-schema` closed it: triage now normalizes a case's
identity (`name`, else `id`) and its scored trials (first non-empty of `runs`,
`arms.with`, `arms['with-only']`; never `arms.without`) before classifying, so
both shapes read. Triage now classifies this file as a **regression**, exit 1,
naming `tier-read-scope` and both failed graders. `test/spine/evals-triage.test.mjs`
loads this fixture and pins that verdict: if a field triage depends on is renamed
in a later schema, that assertion fails rather than silently passing.

`kase.loaded` remains absent from the schema (it has no such field), so the
`loaded: false` branch is still not exercised by this file.

### What this fixture does NOT pin

Now that triage reads the schema, one clean smoke run still pins only part of it:

- the case-shape and grader-shape of `schemaVersion: 1`;
- identity from `name` and scored trials from `arms.with`;
- three deterministic clean passes and one deterministic failure.

It does **not** pin: the judged-grader branch, the indicator branch, the
`loaded`/unloadable branch, or the partial-run branch. Those stay hand-built in
`test/spine/evals-triage.test.mjs` and must be named as unpinned rather than
presumed correct.

Two schema-mapping gaps are likewise unpinned, and are **not** guessed at:

- **`type: llm` as judged.** The harness's case-level grader definitions use
  types such as `llm`; triage's `JUDGED_TYPES` does not list it. The per-trial
  graders in this file carry no `type` at all, and absence is treated as
  deterministic — correct for this fixture's `tool_used` / `regex` failures, but
  it means no trial here proves how an `llm` grader would classify.
- **`withOnly` as an indicator.** Every grader in this file has
  `withOnly: false`, while `isIndicator` looks for `type: 'indicator'` or
  `indicator: true`. Whether a `withOnly: true` grader should be excluded from
  the score is unexercised.

Both wait for a fixture that exercises them. Guessing a mapping without one is
how the `id` / `runs` misread landed in the first place.
