# Spec Delta

## ADDED Requirements

### Requirement: Every prompt that carries the proof rules SHALL tell its reader not to filter its own findings

The proof rules a dimension prompt carries SHALL say, with or without an answer file, that the CLI decides survival, the quality band and the tolerance, and that the reader does not filter findings itself and does not restate a threshold. The ship remediation briefing, which prints the same rules, SHALL carry the same instruction.

#### Scenario: Happy path — a reviewer that returns its answer is told

- **GIVEN** any bundled dimension
- **WHEN** `interlock review brief --dimension <name> --base <ref>` prints its prompt
- **THEN** the prompt holds `Do not filter findings yourself` one time

#### Scenario: Happy path — a reviewer that writes an answer file is still told

- **GIVEN** a strict ship run's review step
- **WHEN** a reviewer's briefing is assembled with its answer file
- **THEN** the briefing holds `Do not filter findings yourself` one time

#### Scenario: Edge case — the remediation briefing

- **GIVEN** a remediation round of a strict ship run
- **WHEN** its briefing is assembled
- **THEN** the briefing holds `Do not filter findings yourself`

#### Scenario: Failure — the instruction is tied to the answer file again

- **GIVEN** an assembler edited so only a prompt with an answer file carries the instruction
- **WHEN** the prompt suite runs
- **THEN** a test fails naming the prompt that lacks it
