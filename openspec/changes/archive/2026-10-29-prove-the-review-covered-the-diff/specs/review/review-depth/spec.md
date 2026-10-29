# Spec Delta

## ADDED Requirements

### Requirement: The always-on set of both depths SHALL hold the `regression` dimension

The depth table the limits surface publishes SHALL list `regression` among the always-on dimensions of the lean depth and of the strict depth (D1), and the strict set SHALL still contain the lean set. The run's path-based dimension selection SHALL read the strict set from that table rather than keep its own list.

#### Scenario: Happy path — both depths run regression

- **GIVEN** the published depth table
- **WHEN** `interlock routing --json` and `interlock routing --json --depth strict` run
- **THEN** both answers list `regression` in `review.dimensions`

#### Scenario: Failure — a second always-on list drifts from the table

- **GIVEN** the run's dimension selection and the published strict set
- **WHEN** the suite runs
- **THEN** the selection's always-on names equal the strict set, and a test fails naming the difference when they do not

## MODIFIED Requirements

### Requirement: The lean depth SHALL give every blocker and warning two per-review skeptics, the strict depth two per-finding skeptics that run the check, and the evidence rule SHALL hold at both

When the routing answer's `review.skeptics` is `per-review`, the skeptic prompts `interlock review brief --skeptics` prints SHALL be two for the whole review, each given every blocker and warning grouped by file, each asked for one verdict per finding id, and each told that findings naming one file and overlapping lines are one issue, judged once and answered under each id. When it is `per-finding`, they SHALL be two per blocker and warning as before, and each SHALL be told that when a finding claims something observable — a failing test, a missing export, an unreachable branch, a command that errors — it runs or reads that before voting and puts what it saw in `evidence`. `review-code` SHALL spawn one skeptic agent per printed prompt. At both depths a verdict of `isReal: false` SHALL require an `evidence` field naming a `file:line` span in the diff, or in the finding's own file for a `blast-radius` or `regression` finding, an uncited refutation SHALL dismiss nothing, suggestions SHALL pass through unverified, and every surviving blocker and warning SHALL carry two verdicts, so the merge verdict's adversarial signal reads a lean record and a strict record by the same rule.

Rationale: the merge verdict counts votes per finding, so lean cuts agents and not votes; one defect raised by four personas costs one reading instead of eight; and an adversarial framing alone removes few false findings, while running what the finding claims removes many, which is what makes strict stricter and not only dearer.

#### Scenario: Happy path — a lean review's findings each carry two verdicts from two agents

- **GIVEN** a lean review with three blockers and warnings in two files
- **WHEN** the skill reaches adversarial verification
- **THEN** `interlock review brief --skeptics --json` prints two prompts, the skill spawns one skeptic agent for each, and each is given all three findings grouped by file
- **AND** the verdicts file carries two verdicts per finding id, one from each agent, and `interlock merge-confidence` reads the adversarial signal green on those findings

#### Scenario: Happy path — overlapping findings are judged once

- **GIVEN** a lean review whose four blockers name one file and the same line under four titles
- **WHEN** a per-review skeptic judges them
- **THEN** it reads the span once and writes four verdicts carrying the same `isReal`, each under its own id
- **AND** `interlock settle replies` and `interlock merge-confidence` still read four findings, because the identity rule is unchanged

#### Scenario: Failure — an uncited refutation dismisses nothing at either depth

- **GIVEN** a per-review skeptic whose verdict on one finding is `isReal: false` with no `evidence`, and a per-finding skeptic whose verdict is the same
- **WHEN** `interlock review` adjudicates each
- **THEN** each finding survives and `counts.dismissalsRejected` counts the verdict
- **AND** the quality score of the verdict still counts

#### Scenario: Edge case — the strict skeptic runs the check

- **GIVEN** a strict review with a finding that claims a named test fails
- **WHEN** a per-finding skeptic judges it
- **THEN** its prompt tells it to run or read that before voting and to put what it saw in `evidence`
- **AND** the skeptic assembler's per-finding prompt carries the sentence, pinned by the tokens `run it or read it` and `evidence`, and its per-review prompt is pinned by `grouped by file`, `one verdict per finding`, `overlapping` and `judged once`

#### Scenario: Edge case — a regression finding outside the diff can be refuted from its own file

- **GIVEN** a surviving `regression` finding whose `file` is an unchanged caller outside the diff, and a refutation citing a span of that file
- **WHEN** `interlock review` adjudicates it
- **THEN** the refutation is accepted as cited, as it is for a `blast-radius` finding
