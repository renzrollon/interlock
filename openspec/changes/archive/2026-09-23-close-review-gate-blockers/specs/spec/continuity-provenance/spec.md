## ADDED Requirements

### Requirement: The continuity procedure's findings-path contract SHALL be pinned by token

The documented continuity procedure SHALL keep the tokens `interlock ready` and `--findings`, and SHALL keep an instruction that the agent must not compose a file containing a blocker count. The skill suite SHALL assert those tokens, not whole sentences. A revision that drops `--findings` or that instructs composing a blocker-count file SHALL fail the suite even if `interlock ready` still appears.

#### Scenario: Happy path — the procedure passes findings and forbids a transcribed count

- **GIVEN** the continuity procedure as shipped
- **WHEN** the skill suite reads it
- **THEN** the text contains `interlock ready`
- **AND** it contains `--findings`
- **AND** it instructs the agent not to compose a file containing a blocker count

#### Scenario: Failure — dropping `--findings` fails the suite

- **GIVEN** a revision of the continuity procedure that still names `interlock ready` but no longer passes `--findings`
- **WHEN** the skill suite runs
- **THEN** the pin fails
- **AND** a leftover pin that only forbids a predecessor Workflow phrase SHALL NOT be treated as covering this contract

#### Scenario: Edge case — a procedure that transcribes a blocker count is rejected

- **GIVEN** a continuity procedure containing a step that writes a blocker count into a file
- **WHEN** the procedure is checked against this requirement
- **THEN** the check fails and names that step
- **AND** a reword that keeps `--findings` and the no-compose instruction still passes
