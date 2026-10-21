# evals/spec-range Specification

## Purpose

Ten eval cases, one per archived change whose decision ledger carried a question a human had to answer, that seed a frozen copy of that change folder without its ledger, run the checkpoint consult, and grade whether the advisor's questions include the one the human actually raised and whether they merely restate what the artifacts already answer. The human labels these cases produce are the kill criterion's data; the cases themselves gate nothing.

## ADDED Requirements

### Requirement: Each case SHALL seed a frozen change folder without its ledger and carry the human's question as its label

Each case SHALL be a directory `evals/spec-range-<slug>/` holding `case.yaml`, `fixture.sh`, `fixture/openspec/changes/<change>/` and `label.md`. The fixture folder SHALL be named by the archived change's name without the archive's date prefix, so the CLI resolves it, and SHALL hold only the archived `proposal.md`, `design.md`, `tasks.md` and `specs/**` as archived: no `decisions.md`, no `advisor.md`, and no other file the archive carried. `label.md` SHALL carry `change:`, `row:` (the archived ledger's row id), `source:` (the archived `decisions.md` path and line number), and `question:` (the row's question text, copied). `case.yaml` SHALL pin `schema_version`, set `runs: 1`, name the archived change under `provenance`, declare `exercises:` naming `agents/advisor.md` and `skills/spec/SKILL.md`, set `context.scaffold_script: fixture.sh`, and grant `execution.allowed_tools` of `[Agent, Bash, Read, Glob, Grep, Write]`. `fixture.sh` SHALL copy `fixture/` into the workspace by its own location and nothing else. The prompt SHALL name the change and instruct the agent to run the spec skill's consult step as written: the brief line without `--findings`, one `interlock:advisor` spawn, the draft write, the check line, and to write no `decisions.md`. The ten cases SHALL be:

| slug | archived change | row |
|------|-----------------|-----|
| `harden-substantive-gates` | `harden-substantive-gates` | D11 |
| `add-report-dashboard` | `add-report-dashboard` | D11 |
| `publish-npm` | `publish-interlock-as-npm-package` | P1 |
| `harden-unattended` | `harden-unattended-ship-runs` | D6 |
| `label-merge-verdict` | `label-and-harden-the-merge-verdict` | D1 |
| `collapse-singleton` | `collapse-singleton-waves` | D2 |
| `prompt-cache-cost` | `surface-prompt-cache-cost` | D8 |
| `dispatch-effort` | `dispatch-published-effort` | D14 |
| `judge-against-base` | `judge-against-base-and-living-specs` | D3, the first of that id's four rows |
| `merge-confidence` | `add-merge-confidence-gate` | D8 |

The ten names SHALL be added to `EXPECTED_CASES` in `test/evals.test.mjs`, and a test SHALL assert for each case that the fixture folder holds only the four artifact kinds and no `decisions.md`, that `label.md`'s `question:` line appears in the `matches-label` grader's body, that `runs` is `1`, and that the script `context.scaffold_script` names exists and is executable.

#### Scenario: Happy path — the structural suite accepts all ten

- **GIVEN** the ten case directories as shipped
- **WHEN** `node --test test/evals.test.mjs` runs
- **THEN** each case pins `schema_version`, sets `runs: 1`, resolves its `exercises:`, has a fixture folder without `decisions.md` and with nothing but the four artifact kinds, a `label.md` whose question is in the `matches-label` grader, and a `fixture.sh` that exists
- **AND** `EXPECTED_CASES` lists all ten and the coverage report counts `agents/advisor.md` as exercised

#### Scenario: Failure — a fixture that kept its ledger

- **GIVEN** `evals/spec-range-publish-npm/fixture/openspec/changes/publish-interlock-as-npm-package/decisions.md` present
- **WHEN** the structural suite runs
- **THEN** it fails naming the case and the file, because a fixture that carries the answer cannot test whether the advisor asks the question

#### Scenario: Edge case — a run without --scaffold

- **GIVEN** `claude plugin eval . --case spec-range-publish-npm` run without `--scaffold`
- **WHEN** the agent starts
- **THEN** the workspace is empty, the brief line exits non-zero naming the unresolved change, the `--failed` line exits non-zero the same way, and no `advisor.md` exists
- **AND** `check-ran` passes because the call was made, `advisor-written` and `matches-label` fail, and the absence of any advisor file is how the report shows the run was unseeded rather than the advisor wrong

### Requirement: Deterministic graders SHALL pin that the consult ran; judged graders SHALL carry labels or deferrals

Each case SHALL carry `graders/advisor-written.md` (`file_exists`, path `openspec/changes/<change>/advisor.md`), `graders/consult-spawned.md` (`tool_used`, tool `Agent`, `input_match` naming `interlock:advisor`, `min: 1`, `max: 1`, `arm: with-only`, an indicator excluded from the score), `graders/check-ran.md` (`tool_used`, tool `Bash`, `input_match` matching `interlock advisor .* --check`, `min: 1`), `graders/matches-label.md` (`llm`, judging the `advisor.md` file against the label's question: pass when one kept question asks the same thing as the human's row or a question whose answer would settle it) and `graders/answered-already.md` (`llm`, judging the kept questions against the fixture's artifacts: pass when at most half of them are answered in so many words by `proposal.md`, `design.md` or `tasks.md`). The two `llm` graders SHALL each have a calibration set under `evals/spec-range-<slug>/calibration/<grader>/` or a row in `evals/CALIBRATION-DEFERRALS.md`; this change SHALL ship the deferral rows, each saying the case has never run and expiring on the first run that produces transcripts. The cases SHALL carry no `smoke` tag, so they run in the scheduled full job only, and `.github/workflows/evals.yml`'s full job SHALL pass `--scaffold`; the smoke job SHALL not.

#### Scenario: Happy path — a seeded run, the consult spawned once

- **GIVEN** a seeded run in which the agent spawned `interlock:advisor` once and ran `--check`
- **WHEN** the graders are applied
- **THEN** `advisor-written`, `consult-spawned` and `check-ran` pass and the two judged graders vote on the file and the artifacts
- **AND** the baseline arm reports `consult-spawned` as an indicator, not a score

#### Scenario: Failure — the agent drafted questions in its own prose

- **GIVEN** a run in which no `Agent` call named `interlock:advisor`, no `interlock advisor … --check` line ran, and the agent wrote `advisor.md` with the Write tool
- **WHEN** the graders are applied
- **THEN** `check-ran` fails and the case is a failure whatever the judged graders say, and `consult-spawned` reads zero as an indicator beside it

#### Scenario: Edge case — a judged grader without a label or a deferral

- **GIVEN** a Spec Range case whose `matches-label` grader has neither a calibration set nor a deferral row
- **WHEN** `node --test test/evals.test.mjs` runs
- **THEN** it fails naming `spec-range-<slug>/matches-label`

### Requirement: The labels SHALL be the kill criterion's data, and the suite SHALL say so without a number

`docs/14-evals.md` SHALL carry a section under a heading naming Spec Range, saying what the cases seed and grade, that `--scaffold` is required to seed them, that their human labels under `evals/spec-range-*/calibration/` are what `interlock advisor --verdict` reads, and that the caps live in `interlock limits`; it SHALL state no threshold value and no case count, as the case-suite spec already requires of this document. A test SHALL pin, within that section (from its heading to the next `##` heading), the two command tokens and `--scaffold`, and the absence of each advisor cap's name and of its value as a standalone number, in the form the page's existing cost-ceiling pin uses. `evals/CALIBRATION-LAYOUT.md` SHALL be the label format; no second format is introduced. Who writes the labels and when is ledger row D19, pending a person; until the labels exist the verdict prints `INSUFFICIENT LABELS`.

#### Scenario: Happy path — the doc names the cases and points at the CLI

- **GIVEN** `docs/14-evals.md` as shipped
- **WHEN** the eval structural suite runs
- **THEN** the Spec Range heading is found, the section names `interlock advisor --verdict`, `interlock limits` and `--scaffold`, and carries none of the six advisor cap names or values as a standalone number

#### Scenario: Failure — the doc states "3 of 10"

- **GIVEN** a revision of the section that writes the kill criterion as `3 of 10`
- **WHEN** the suite runs
- **THEN** the no-threshold pin fails naming the document

#### Scenario: Edge case — labels for six cases

- **GIVEN** six cases labelled under `calibration/matches-label/` and `calibration/answered-already/`
- **WHEN** `interlock advisor --verdict --labels evals` runs
- **THEN** it prints `INSUFFICIENT LABELS (6 of <min>)` with the cap read from `lib/limits.mjs`
