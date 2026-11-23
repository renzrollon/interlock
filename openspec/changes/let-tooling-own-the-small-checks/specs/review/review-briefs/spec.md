# Spec Delta

## ADDED Requirements

### Requirement: Every dimension prompt SHALL leave formatting, lint and type-check findings to the project's tools

Every dimension prompt the CLI assembles, for `interlock review brief` and for the strict ship review alike, SHALL say one time that formatting, lint rules and type-check errors belong to the project's own tools, that a finding whose only claim is one of those is not raised, and that a defect such an error causes or hides is still a finding. The line SHALL follow the rubric, so the prompt's first line is unchanged. The remediation briefing and the skeptic prompts SHALL NOT carry it.

#### Scenario: Happy path — every bundled dimension is told

- **GIVEN** any bundled dimension
- **WHEN** `interlock review brief --dimension <name> --base <ref>` prints its prompt
- **THEN** the prompt holds `TOOLS OWN THE SMALL CHECKS` one time
- **AND** its first line is still the rubric's `# Dimension:` line

#### Scenario: Happy path — a strict ship reviewer and a re-run are told the same

- **GIVEN** a strict ship run's review step, and separately a re-run for uncited files
- **WHEN** each briefing is assembled, the first with its answer file and its stage line
- **THEN** each holds `TOOLS OWN THE SMALL CHECKS` one time

#### Scenario: Edge case — a defect behind a tool's error stays in scope

- **GIVEN** any dimension's prompt
- **WHEN** a reader finds the line
- **THEN** the same paragraph holds `still a finding`, so a reviewer is not told to pass over a defect because a tool also reports it

#### Scenario: Edge case — the remediation briefing and the skeptics are not told

- **GIVEN** a remediation round's briefing and the skeptic prompts `interlock review brief --skeptics` prints
- **WHEN** each is assembled
- **THEN** neither holds `TOOLS OWN THE SMALL CHECKS`

#### Scenario: Failure — a prompt variant that drops the line is caught

- **GIVEN** an assembler edited so that a prompt with an answer file, or a re-run's prompt, lacks the line
- **WHEN** the prompt suite runs
- **THEN** a test fails naming the variant that lacks it
