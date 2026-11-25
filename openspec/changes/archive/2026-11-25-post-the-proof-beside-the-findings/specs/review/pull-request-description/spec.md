# Spec Delta

## ADDED Requirements

### Requirement: With `--review`, the skill SHALL write `## Testing` from the lines the CLI printed, and SHALL say when it could not

With `--review`, `skills/settle/SKILL.md` SHALL run `interlock settle validation --summary` on the final verification's records while it composes the description, and SHALL place the three lines it prints under `## Testing`, as printed, adding only the manual-test-plan line when a plan is posted. When the command exits non-zero the skill SHALL print `TESTING SUMMARY UNAVAILABLE: <reason>` and write the section by hand. Without `--review` the section SHALL stay hand-written.

#### Scenario: Happy path — the skill carries the summary line and the instruction

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds, in the section that composes the description, a fenced `interlock settle validation` line carrying `--summary`, `--head`, `--plan`, `--results` and `--verify`
- **AND** the prose beside it says the three lines go under `## Testing` as printed

#### Scenario: Failure — a summary that could not be printed

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the same section
- **THEN** it finds `TESTING SUMMARY UNAVAILABLE:` and that the section is then written by hand
- **AND** it finds that the description is still published

#### Scenario: Edge case — without the flag the hand-written bullets stay

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the fenced description template and the paragraph about `## Testing`
- **THEN** the template still holds the `## Testing` line, and the paragraph names `--review` as the condition for the printed lines
- **AND** the hand-written form, with its `Verified locally` and `Not covered` bullets, is still given for a pass without the flag

#### Scenario: Edge case — the one line the skill may add

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the paragraph about `## Testing`
- **THEN** it finds that with a posted manual test plan the line `Manual UI test plan: see PR comment.` closes the section, after the three printed lines
- **AND** it finds that `no other line` is added, changed or removed

### Requirement: The testing summary SHALL show the exit codes the comment shows, and SHALL name no comment that was not posted

The summary line SHALL carry `--exec .claude/ship/settle/exec.jsonl` when the final verification wrote that file, so `## Testing` and the comment show the same exit codes and marks. When the pass printed `VALIDATION NOT POSTED:`, whether the render or the post failed, the line SHALL carry `--unposted`. A pass with no final verification of its own SHALL run no summary: it prints `TESTING SUMMARY UNAVAILABLE:` and writes the section by hand.

#### Scenario: Happy path — the summary line reads the exec record

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** the fenced `interlock settle validation` line that carries `--summary` also carries `--exec .claude/ship/settle/exec.jsonl`
- **AND** the prose beside it says the flag is passed when the final verification wrote that file

#### Scenario: Failure — a comment that was not posted

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section that composes the description
- **THEN** it finds `--unposted` named as what the summary line carries after `VALIDATION NOT POSTED:`
- **AND** it finds that the description then names no validation comment

#### Scenario: Edge case — a pass with no final verification of its own

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the same section
- **THEN** it finds that a pass whose loop did not start or stopped early runs no summary line
- **AND** it finds `TESTING SUMMARY UNAVAILABLE:` and the hand-written form for that pass
