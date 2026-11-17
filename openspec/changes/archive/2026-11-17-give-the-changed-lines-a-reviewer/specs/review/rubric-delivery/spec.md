# Spec Delta

## ADDED Requirements

### Requirement: A bundled rubric SHALL carry only text meant for its reviewer

Each brief under `skills/review-code/dimensions/` is printed verbatim as a reviewer's instructions, so it SHALL NOT contain an unexpanded `${NAME}` variable, an instruction to the orchestrator about when to run the dimension, or its own copy of the emit shape, which the CLI prints once for every dimension.

#### Scenario: Happy path — no brief holds an unexpanded variable

- **GIVEN** the nine shipped briefs
- **WHEN** the skill suite runs
- **THEN** none of them contains a `$`, an opening brace and an upper-case name, such as `${CLAUDE_PLUGIN_ROOT}`

#### Scenario: Edge case — a workflow expression is not a variable

- **GIVEN** the shipped `devops` brief, which quotes the workflow expression `${{ github.event.* }}`
- **WHEN** the skill suite runs
- **THEN** the brief still carries `github.event`
- **AND** the unexpanded-variable check does not report it

#### Scenario: Failure — a brief that tells the orchestrator when to run it

- **GIVEN** the nine shipped briefs
- **WHEN** the skill suite runs
- **THEN** none of them contains `Run this dimension when`
- **AND** none of them names an `interlock review`, `interlock remediate`, `interlock surface` or `interlock conformance` command

#### Scenario: Edge case — a brief names its dimension without copying the shape

- **GIVEN** the shipped `regression` and `blast-radius` briefs
- **WHEN** the skill suite runs
- **THEN** `regression.md` carries `"dimension": "regression"` and `"coverage"`, and `blast-radius.md` carries `"dimension": "blast-radius"`
- **AND** no bundled brief contains `"findings"`

#### Scenario: Edge case — the sweep procedure is in the brief that asks for it

- **GIVEN** the shipped `technical-lead` brief
- **WHEN** the skill suite runs
- **THEN** it carries `interlock-graph consumers` and `string-keyed`
- **AND** it carries no `INVARIANT-SWEEP`
