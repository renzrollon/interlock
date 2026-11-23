# Spec Delta

## ADDED Requirements

### Requirement: The pass's final verification SHALL run each planned step under that step's own time allowance

For the pass's final verification the settle skill SHALL run each planned step with the tool's timeout set to that step's own time allowance when the plan carries one, and to the profile's `unit.timeout_ms` otherwise. With no profile the tool's default SHALL apply. A step the tool ended at its timeout SHALL still be recorded as failed, with the step and the timeout named in the report.

#### Scenario: Happy path — a step with an allowance of its own runs under it

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite reads the paragraph that follows the final verification's fenced lines
- **THEN** it carries `timeoutMs`, `plan.json` and `unit.timeout_ms`, and says a step whose plan entry carries an allowance runs under that allowance

#### Scenario: Edge case — a step with no allowance of its own

- **GIVEN** the same paragraph
- **WHEN** the skill suite reads it
- **THEN** it says a step with no allowance of its own runs under the profile's `unit.timeout_ms`, and that with no profile the tool's default applies

#### Scenario: Failure — a build ended at its timeout is a failed step

- **GIVEN** the same paragraph
- **WHEN** the skill suite reads it
- **THEN** it says a step the tool ended at its timeout, a build among them, is recorded as failed with a non-zero `exitCode`, and that the report names the step and the timeout as the reason
- **AND** the round's own verification paragraph still sets its timeout from the plan step's `timeoutMs` in `plan-r<r>.json`
