# Spec Delta

## MODIFIED Requirements

### Requirement: The prompt SHALL let the reviewer run read-only checks and SHALL ask it to measure what it claims

Every dimension prompt SHALL say the reviewer may run read-only commands, including a single test file and the repository's own CLI, SHALL say the reviewer writes nothing, since the reviewer's agent type takes away the tools that edit a file but not the shell, so the prompt stays a bound beside the type, and SHALL say that a claim about a size, a width, a count or a duration is measured and the measurement cited, with a measurement the reviewer cannot take recorded under `unread`. No prompt SHALL tell a reviewer not to run tests.

#### Scenario: Happy path — the run-and-measure lines are present

- **GIVEN** any bundled dimension
- **WHEN** its prompt is printed
- **THEN** it holds the read-only run line, the write-nothing line and the measure-what-you-claim line

#### Scenario: Failure — the skill suite catches a prompt that forbids tests

- **GIVEN** an assembler edited so a prompt says not to run the tests
- **WHEN** the skill suite runs
- **THEN** a test fails naming the prompt

#### Scenario: Edge case — the write-nothing line stays under a typed spawn

- **GIVEN** a dimension prompt printed for the review skill, whose reviewers run as `interlock:reviewer`
- **WHEN** the prompt is read
- **THEN** it still holds the write-nothing line, word for word as before this change
