## MODIFIED Requirements

### Requirement: A judged-only dip on a single run is variance, not regression

When every failing grader for a case depends on a model judge, and the results file carries only one run of that case, triage SHALL classify it as variance and SHALL state what would confirm it as a regression. Whether a grader depends on a model judge SHALL be decided by one exported set, `JUDGED_GRADER_TYPES` in `lib/evals-types.mjs`, read by triage, by `interlock evals calibrate` and by the eval structural test, so the three cannot disagree on which types are judged. A trial grader that carries no `type` SHALL have its type joined by name from the case's own grader list in the results file, or from a `graderTypes` map the caller passes to `triage(results, { graderTypes })`, which `interlock evals triage --eval-dir <dir>` SHALL build from each case's `graders/<name>.md` frontmatter; `lib/evals-triage.mjs` SHALL read no file and import nothing but the shared set. A grader whose type cannot be found SHALL be treated as deterministic, and the output SHALL name it as `type unknown, treated as deterministic`, so a dip it causes is loud rather than hidden.

#### Scenario: Single judged run dips

- **WHEN** a case's only failing graders are judged, and the case ran once
- **THEN** triage classifies it as variance
- **AND** the output states that corroboration across further runs would confirm it

#### Scenario: Judged failure repeats across runs

- **WHEN** a case fails the same judged grader on a majority of its runs
- **THEN** triage classifies it as a regression

#### Scenario: A trial grader's type is joined from the case

- **WHEN** a results file's trial graders carry `name` and `passed` but no `type`, and the case's grader list names that grader with `type: llm`
- **THEN** triage treats the grader as judged, and a single-run dip on it is variance
- **AND** the same results with the case's grader list absent and no `--eval-dir` classify the dip as a regression and name the grader as `type unknown, treated as deterministic`

#### Scenario: The three readers share the set

- **WHEN** `lib/evals-triage.mjs`, `lib/evals-calibrate.mjs` and `test/evals.test.mjs` are read
- **THEN** none spells its own list of judged types, and each imports `JUDGED_GRADER_TYPES`
- **AND** the set names `llm` and `baseline`, the two judged types the structural test knows
- **AND** `lib/evals-triage.mjs` carries no `node:` import and no local judged-set literal, and `skills/evals/SKILL.md` still names `llm` and `baseline` as the two that call a judge
