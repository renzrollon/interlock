# Spec Delta

## ADDED Requirements

### Requirement: An artifact blocker SHALL cite a line or a passage, or be rejected as malformed

A blocker whose `dimension` is `artifacts` SHALL carry a `line` that is a positive integer or a non-empty `passage`. One that carries neither SHALL be reported under `malformed`, with `cause` `citation` and a reason saying it cites nothing a person can check, and it SHALL not be counted as a blocker. The gate SHALL not pass while it is outstanding. Continuation readiness SHALL name the missing citation when it refuses on one.

#### Scenario: Happy path — a blocker cited by line

- **GIVEN** an artifact findings file holding one blocker with `file` `design.md` and `line` `85`
- **WHEN** `interlock gate --findings <file> --json` runs
- **THEN** `blockers` carries it, `malformed` is empty, `passed` is `false`, and the exit code is non-zero

#### Scenario: Happy path — a blocker cited by passage alone

- **GIVEN** an artifact blocker with no `line` and a `passage` quoting the sentence it disputes
- **WHEN** the gate runs
- **THEN** `blockers` carries it and `malformed` is empty

#### Scenario: Failure — an uncited blocker

- **GIVEN** an artifact blocker with no `line` and no `passage`
- **WHEN** the gate runs
- **THEN** `malformed` carries it with `cause` `citation` and a reason naming the missing citation, `blockers` and `counts.blocker` leave it out, `passed` is `false`, and the exit code is non-zero

#### Scenario: Edge case — readiness names the missing citation

- **GIVEN** a change whose artifact findings hold one uncited blocker and nothing else
- **WHEN** continuation readiness is assessed
- **THEN** it refuses with `REVIEW_FINDINGS_MALFORMED`, and the reason names the missing citation and does not say a severity is outside the defined set

#### Scenario: Edge case — a line that is not a line number

- **GIVEN** artifact blockers whose `line` is `0`, `-3` or `"intro"`, each with no `passage`
- **WHEN** the gate runs
- **THEN** each is reported under `malformed`

#### Scenario: Edge case — code-review findings are not held to it

- **GIVEN** a findings file whose findings carry no `dimension` `artifacts`, holding a blocker with no `line` and no `passage`
- **WHEN** the gate runs
- **THEN** `blockers` carries it and `malformed` is empty, as before this rule

#### Scenario: Edge case — warnings and suggestions need no citation

- **GIVEN** an artifact warning and an artifact suggestion, each with no `line` and no `passage`
- **WHEN** the gate runs
- **THEN** each is counted under its severity and neither is malformed

### Requirement: An uncited artifact blocker SHALL still count toward the autonomy outcome

`autonomyOutcome.blockers` SHALL count the blockers in `blockers` together with the artifact blockers reported as malformed for a missing citation. A gate that failed on an uncited blocker therefore never reads as a clean run to `interlock autonomy record`.

#### Scenario: Failure — a gate failed only by an uncited blocker

- **GIVEN** an artifact findings file whose only blocker cites nothing
- **WHEN** the gate runs
- **THEN** `passed` is `false` and `autonomyOutcome.blockers` is `1`, so the spec skill records one blocker and not a clean run

#### Scenario: Edge case — a malformed severity does not count

- **GIVEN** an artifact finding whose severity is `critical`, an unknown value
- **WHEN** the gate runs
- **THEN** it is malformed as before, with `cause` `severity`, and `autonomyOutcome.blockers` does not count it

### Requirement: The artifact emit shape SHALL name the optional `passage` and the citation a blocker needs

The emit shape in the artifact review brief, and the emit contract in the review-artifacts skill, SHALL name `passage` as an optional short verbatim quotation of the artifact text a finding is about. They SHALL say that a blocker carries a `line` or a `passage`, and that an uncited blocker is reported as malformed. Both SHALL be pinned by token.

#### Scenario: Happy path — both contracts name it

- **WHEN** the artifact review brief is assembled, and the shipped `skills/review-artifacts/SKILL.md` is read
- **THEN** each names `passage` and says a blocker carries a `line` or a `passage`, and a test pins those tokens in both
