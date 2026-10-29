# review/review-depth Specification

## Purpose

How much a code review spends is a policy, not a judgement: which dimensions always run, how the skeptics are shaped, and which of two depths a pass runs at. This capability publishes the two depths through the CLI, lets a flag select the dear one, and makes the record and the verdict say which one ran, so a model never decides how thorough its own review was and a reader of a `MERGE` can ask for the other depth.

## Requirements

### Requirement: Two review depths SHALL be published by the limits surface, and no skill SHALL restate them

`REVIEW_DEPTH` in `lib/limits.mjs` SHALL hold `default`, naming one of its depths, and for each of `lean` and `strict` a `dimensions` list — the review-code dimensions that always run at that depth, each a rubric file under `skills/review-code/dimensions/` — and a `skeptics` shape, `per-review` or `per-finding`. The strict `dimensions` SHALL be a superset of the lean `dimensions`. The conditional dimensions — `devops`, `security`, `domain`, `blast-radius` — SHALL keep their own triggers at both depths and SHALL NOT appear in either list. `interlock limits` SHALL print the default and each depth's two rows, `interlock limits --json` SHALL emit the table under `reviewDepth`, and `interlock routing --json` SHALL carry the selected depth's row under `review`. No skill file SHALL name a dimension count, a skeptic count or a default depth; a skill reads them from the command.

Rationale: a depth written in prose is a threshold a model can re-argue and two skills can drift apart on; a table the CLI publishes changes once, and a reader who wants the other depth finds it in `interlock limits`.

#### Scenario: Happy path — the table is printed and emitted

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries a `review depth: default` row and, for each of `lean` and `strict`, a dimensions row and a skeptics row
- **AND** the JSON carries `reviewDepth` with `default`, `lean` and `strict`, each depth with `dimensions` and `skeptics`

#### Scenario: Failure — a row outside the vocabulary is caught

- **GIVEN** a `REVIEW_DEPTH` row whose `dimensions` names a file that is not a rubric under `skills/review-code/dimensions/`, or whose `skeptics` is neither `per-review` nor `per-finding`, or a `default` that names neither depth
- **WHEN** the table invariant test runs
- **THEN** it fails naming the depth and the field

#### Scenario: Edge case — the strict set contains the lean set, and neither holds a conditional dimension

- **GIVEN** the published table
- **WHEN** the table invariant test runs
- **THEN** every lean dimension is a strict dimension
- **AND** neither list names `devops`, `security`, `domain` or `blast-radius`

### Requirement: `review-code` SHALL run at the published depth, `--strict` SHALL select the strict depth, and the record SHALL say which ran

`/interlock:review-code` SHALL read its depth from the `interlock routing --json` answer it already reads for its routing, passing `--depth strict` when it was given `--strict` and no `--depth` otherwise, SHALL print `REVIEW DEPTH: <depth>` from that answer before it fans out, and SHALL run as its always-on dimensions the answer's `review.dimensions`, the conditional dimensions on their own triggers as before, and `--dimensions a,b,c` as a total override as before. The dimension record SHALL carry `depth` equal to the depth that ran; `interlock review` SHALL accept an optional string `depth` in the record equal to `lean` or `strict`, SHALL record it under `dimensions.depth`, SHALL refuse any other value naming the file and the fault, and SHALL record none when the record carries none. When the routing command exits non-zero, the skill SHALL run the strict depth's shape at the session defaults, after the `ROUTING UNAVAILABLE` line. The skill SHALL NOT select `strict` because the diff looks large, and SHALL NOT name the default depth.

Rationale: the default depth is the cheap one, and the only way a lean review is honest is that its record says so and the full review is one flag away.

#### Scenario: Happy path — the default depth runs and is recorded

- **GIVEN** `/interlock:review-code <change>` with no `--strict`, on a host where `interlock routing --json` answers `depth: lean` with `review.dimensions` of two names
- **WHEN** the skill runs
- **THEN** it prints `REVIEW DEPTH: lean`, spawns those two dimensions plus whichever conditional dimensions their triggers select, and writes `"depth": "lean"` into the dimension record
- **AND** `interlock review --dimensions <that record> --json` carries `dimensions.depth` equal to `lean`

#### Scenario: Happy path — `--strict` selects the strict depth

- **GIVEN** `/interlock:review-code <change> --strict`
- **WHEN** the skill reads its routing
- **THEN** it runs `interlock routing --depth strict --json`, prints `REVIEW DEPTH: strict`, spawns the strict `review.dimensions` plus the conditional ones, and records `"depth": "strict"`
- **AND** its dimension reviewers carry the `review-dimension` row's strict override

#### Scenario: Failure — a record with an unknown depth is refused

- **GIVEN** a dimension record carrying `"depth": "deep"` and `--out` naming a writable path
- **WHEN** `interlock review --dimensions <that record> --out <path>` runs
- **THEN** it exits 1 naming the file and the value on standard error
- **AND** nothing is printed on standard output and nothing exists at the `--out` path

#### Scenario: Edge case — a record without a depth, and a routing failure

- **GIVEN** a dimension record with no `depth` key, and separately a review pass on which `interlock routing --json` exits non-zero
- **WHEN** `interlock review` reads the first, and the skill runs the second
- **THEN** the first records no `dimensions.depth` and is otherwise read as before
- **AND** the second prints `ROUTING UNAVAILABLE:` and runs the strict depth's always-on set with two skeptics per blocker and warning at the session defaults

#### Scenario: Edge case — the skill's pins

- **GIVEN** the shipped `skills/review-code/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** `argument-hint` carries `--strict`, the prose carries `REVIEW DEPTH:`, the dimension table has no row whose `Run when` column reads `always` and its paragraph names `review.dimensions`, and the dimension record fence carries `depth`
- **AND** no sentence beside `lean` or `strict` names a number of dimensions or skeptics

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

### Requirement: `settle --strict` SHALL pass the strict depth to every review pass of the loop, and the default SHALL be the CLI's

`/interlock:settle` SHALL accept `--strict`, SHALL pass `--strict` to the first `review-code` pass and to every round's `review-code` pass when it was given, SHALL pass no depth flag otherwise so the published default applies, SHALL print `REVIEW DEPTH: <depth>` once as `review-code` reported it, and SHALL NOT select `--strict` because the diff looks large. The assessment, the conformance worker, the verification and the platform wait SHALL run the same at both depths.

Rationale: the loop's cost is set once, at its entry, the same way ship's is; a default the CLI publishes is one the owner can budget.

#### Scenario: Happy path — the default loop runs lean

- **GIVEN** `/interlock:settle --review` with no `--strict`
- **WHEN** the loop runs its first review and a round's review
- **THEN** neither `review-code` invocation carries `--strict`, and each prints the published default depth
- **AND** the skill prints `REVIEW DEPTH:` once with that depth

#### Scenario: Happy path — `--strict` reaches every pass

- **GIVEN** `/interlock:settle --review --strict` whose loop runs two rounds
- **WHEN** the three `review-code` passes run
- **THEN** each carries `--strict` and each prints `REVIEW DEPTH: strict`
- **AND** the conformance worker, the verification and the assessment run as they do without the flag

#### Scenario: Edge case — the skill's pins

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** `argument-hint` and the flag table carry `--strict`, both fenced `review-code` lines carry `--strict` inside a placeholder the paragraph before explains, the prose carries `REVIEW DEPTH:` and says the skill does not `invent` `--strict`
- **AND** the loop-order pin still finds both `review-code` lines with `--base origin/` and `--out .claude/ship/settle/review-r`

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
