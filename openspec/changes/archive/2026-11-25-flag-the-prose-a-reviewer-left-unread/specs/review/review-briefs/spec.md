# Spec Delta

## ADDED Requirements

### Requirement: The prompt SHALL ask for the changed files an `unread` entry is about

Every dimension prompt SHALL show `paths` on the `unread` entry of its emit shape, SHALL say the key is optional, and SHALL ask the reviewer to name under it the changed files an `unread` entry is about, as the scope lists them. The prompt SHALL say the CLI classes those paths, and SHALL NOT say which class changes the proof. A ship run's reviewer briefing and its fix round's re-review briefing SHALL carry the same lines.

#### Scenario: Happy path — the emit shape and the rule are in every dimension's prompt

- **GIVEN** a diff that changes one source file and one documentation file
- **WHEN** any bundled dimension's prompt is printed
- **THEN** the `unread` entry of its emit shape shows `paths` beside `input` and `reason`, and the prompt says `paths` is optional
- **AND** it asks the reviewer to name the changed files an `unread` entry is about under `paths`, and says the CLI classes them

#### Scenario: Failure — the proof rules name no class a reviewer could aim for

- **GIVEN** the proof rules the prompt prints, without the rubric and the quoted repository data
- **WHEN** the prompt suite reads them
- **THEN** they hold neither the word `prose` nor `Counts as Source`

#### Scenario: Edge case — a run's briefings carry the same lines

- **GIVEN** a strict ship run's reviewer briefing and its fix round's re-review briefing
- **WHEN** each is assembled
- **THEN** each holds the same `paths` line and the same emit shape as the prompt `interlock review brief` prints

#### Scenario: Edge case — the review skill's answer shape agrees

- **GIVEN** the shipped review skill
- **WHEN** the skill suite runs
- **THEN** the answer shape the skill shows carries `paths` on its `unread` entry, and the skill says the key is optional
