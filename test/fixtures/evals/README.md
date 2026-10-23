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

## `spec-range-2026-10-21.json`

A triage fixture. It is the only results file with judged (`llm`) graders, and
the only one written under `--ablation none`, and `test/spine/evals-triage.test.mjs`
reads it for both. The case it records (`spec-range-collapse-singleton`, the
checkpoint-advisor eval) has since been removed from `evals/` along with the
advisor it measured, so nothing here can be re-run. The grader names inside the
file are historical; only its scoring shape is pinned.

### Which run produced it

- Command: `node scripts/host-probe.mjs --mode eval --plugin-dir <rsync'd plugin> --case spec-range-collapse-singleton --max-cost-usd 2.45 --allow-tool Bash --allow-tool Write`,
  which runs `claude plugin eval <plugin> --case spec-range-collapse-singleton --scaffold --trust-plugin --runs 1 --ablation none --no-publish --keep-temp --max-cost-usd 2.45 --allow-tools Bash Write …`
- Harness: `claude` 2.1.306, results `schemaVersion: 1`
- Run: 2026-10-21 · `costUsd` 0.5304095 · `partial: false` · one case, one run, with arm only
- Outcome: `advisor-written`, `check-ran` and `consult-spawned` (one `interlock:advisor` spawn) passed; both judges (`matches-label`, `answered-already`) failed 3 votes to 0.

### What was removed (removal only, never rewriting)

Everything the smoke fixture drops, plus three fields this run carried that the smoke run did not:

- `cases[].promptMarkdown` and `cases[].arms.<arm>[].tracePath`, as above.
- `cases[].arms.<arm>[].graders[].evidence`: the judge's trace excerpt, about 70 KB of session transcript holding hook and session ids.
- `suite.root` and `suite.plugins[].path`: the runner's scratch directory.

Every scoring field is kept as the harness wrote it.

### What it pins

- **`llm` as judged** (`test/spine/evals-triage.test.mjs`). Before PR #20 this file would have triaged as a regression, exit 1. It now triages as `variance` on the two judges, exit 0. That closes the first gap listed for the smoke fixture.
- **`withOnly` under `--ablation none`.** The with-only `consult-spawned` grader is written `withOnly: false, scored: true`, so in this mode it is part of the score. Triage now excludes a grader written `scored: false`. The harness documents that a with-only grader under `--ablation with-without` is an indicator outside the score. **No with-without file exists yet**, so the `scored: false` branch is pinned only by a hand-built case.

### What two earlier runs on the same day showed (not committed)

- **With no `--allow-tools`** (the CI full job's command as of PR #20), the harness printed a `cannot pass with the granted tools` advisory for `check-ran` (Bash) and `advisor-written` (Write) before the run. Bash and Write are operator-gated, and a case's `allowed_tools` alone does not grant them. The run scored 0 and triage read a regression.
- **With only `--allow-tools "Bash(interlock:*)" Write`**, the session ran in don't-ask mode. The model's `interlock advisor … --brief --json; echo "exit=$?"` did not match the pattern and was denied. The case's own failure path (`--check --failed`) was denied the same way. A pattern grant does not survive the model's own command style.
