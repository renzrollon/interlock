## Purpose

Fixture-seeded eval cases for the review-findings advisor. Each case plants a real bug, taken from a later `fix(...)` commit, as a finding a skeptic dismissed on a weak citation, beside decoys. It runs the review-code consult, then grades two things: whether a flag reached the planted dismissal, and whether the flags merely restate what survived. The cases' human labels are the advisor's kill-criterion data. The cases gate nothing.

## ADDED Requirements

### Requirement: Each case SHALL seed a pre-fix tree and a review in which the real bug was dismissed

Each case SHALL be a directory `evals/review-range-<slug>/` holding `case.yaml`, `fixture.sh`, `fixture/` and `label.md`.

`fixture/` SHALL hold:
- the files the fix commit touched, as they stood before it, at their repository paths
- `openspec/changes/<slug>/proposal.md`, stating the intent of the diff under review
- `review/findings.json` and `review/verdicts.json`, in the shapes `interlock review` reads

The planted review SHALL carry at least three findings:
- the real bug, which every skeptic dismisses on a citation that resolves to a changed file but does not address the defect
- a decoy that is correctly dismissed
- one survivor

`fixture/` SHALL hold no `review-advisor.md` and no file from the fix commit itself.

`label.md` SHALL carry:
- `fix:` (the fix commit's short sha and subject)
- `introduced:` (the commit or ref the bug was present in)
- `file:` (the buggy `path:line` in that state)
- `dismissed:` (the planted finding's `title`, copied)
- `bug:` (one sentence)

`case.yaml` SHALL:
- pin `schema_version`
- set `runs: 1`
- name the fix commit under `provenance`
- declare `exercises:` naming `agents/review-advisor.md` and `skills/review-code/SKILL.md`
- set `context.scaffold_script: fixture.sh`
- grant `execution.allowed_tools` of `[Agent, Bash, Read, Glob, Grep]`, with no `Write`, because the check reads the draft from standard input
- carry no smoke tag

`fixture.sh` SHALL copy `fixture/` into the workspace by its own location and nothing else.

The prompt SHALL instruct the agent to:
1. run the review line with `--advisor-brief <slug>` over the fixture's findings, verdicts and changed files
2. spawn `interlock:review-advisor` once with the brief path
3. pipe the reply to `interlock review-advisor "<slug>" --check - --json`, or run `--check --failed` on failure
4. report the check's JSON

The cases SHALL be added to `EXPECTED_CASES` in `test/evals.test.mjs`. A Review Range block in that suite SHALL assert, for each case, that:
- the fixture holds the two review files and the proposal, and no `review-advisor.md`
- `label.md`'s `dismissed:` title is the title of a finding that `interlock review` over the fixture places in its dismissed list
- at least one finding survives
- `runs` is `1`
- the scaffold script exists and is executable

The initial cases SHALL be the ones the change's design names. The case set is the owner's call at the checkpoint.

#### Scenario: Happy path — the structural suite accepts the cases

- **GIVEN** the Review Range case directories as shipped
- **WHEN** `node --test test/evals.test.mjs` runs
- **THEN** every case passes the Review Range block, and `EXPECTED_CASES` lists them all

#### Scenario: Failure — a planted bug that survives

- **GIVEN** a case whose verdicts do not dismiss the finding `label.md` names
- **WHEN** the structural suite runs
- **THEN** it fails naming the case and saying the labelled finding is not dismissed, because the case would no longer test a wrong dismissal

#### Scenario: Failure — a fixture that carries the fix

- **GIVEN** a case whose fixture file matches the fix commit's version of that file
- **WHEN** the structural suite runs
- **THEN** it fails naming the case and the file

### Requirement: Each case SHALL carry a deterministic floor and two judged graders

Each case SHALL carry five graders:
- `check-drafted`, a `regex` grader. It passes only when the transcript shows the check's JSON with `"step": "check"` followed by `"status": "drafted"`, so a run whose consult did not draft fails the floor rather than passing on a did-not-run stanza.
- `consult-spawned`, a `tool_used` grader on an Agent call with `interlock:review-advisor`, `arm: with-only`, `max: 1`.
- `check-ran`, a `tool_used` grader on a Bash line matching `review-advisor` and `--check`.
- `matches-label`, an `llm` grader focused on `openspec/changes/<slug>/review-advisor.md`. It passes when a kept `dismissal-doubt` targets the dismissal whose title `label.md` names. It fails when none does, when the flags table reads `none`, or when the file records that the consult did not run.
- `repeats-survivor`, an `llm` grader focused on the trace. It fails when more than half of the kept flags only restate a surviving finding's title or description, without naming a dismissal, a shared cause, or an uncovered path.

Each judged grader SHALL have a row under `## Deferred` in `evals/CALIBRATION-DEFERRALS.md` until a calibration set exists. A row SHALL become stale, and fail the suite, once its calibration set exists. The cap values SHALL not be spelled out in docs/14.

#### Scenario: Happy path — the graders are present and typed

- **WHEN** the structural suite reads a Review Range case
- **THEN** it finds the five graders with the stated types, the `regex` pattern requiring `drafted`, and a deferral row for each judged grader

#### Scenario: Failure — a did-not-run consult

- **GIVEN** a run whose check printed `"status": "did-not-run"`
- **WHEN** the graders run
- **THEN** `check-drafted` fails, and `matches-label` fails by its criteria
