# spec/requirement-wording Specification

## Purpose
Flags the vague phrases that requirement-writing standards name, in a change's delta specs, before anyone reviews them, so the author can make a requirement checkable. It is advice, and it never decides whether a change is ready.

## Requirements

### Requirement: The validate line SHALL report each vague phrase a delta spec's requirement text holds

`interlock validate <change> --json` SHALL carry `wording`: one entry for each occurrence of a phrase from the word list in a delta spec's requirement or scenario text, with its change-relative `file`, its `line`, the `phrase`, the `reason` the list gives, and a printable `message`. It SHALL be an empty list when there is none.

#### Scenario: Happy path — one vague phrase

- **GIVEN** a change whose `specs/a/spec.md` holds, at line 12 of an ADDED requirement, "the cache is eventually refreshed"
- **WHEN** `interlock validate <change> --json` runs
- **THEN** `wording` holds one entry with `file` `specs/a/spec.md`, `line` `12`, `phrase` `eventually`, its reason, and a `message` beginning `WORDING:`
- **AND** the text output prints that `message`

#### Scenario: Edge case — none found

- **GIVEN** a change whose delta specs hold none of the phrases
- **WHEN** the validate line runs
- **THEN** `wording` is an empty list and the text output prints no `WORDING:` line

### Requirement: The word list SHALL live in code and hold the phrases the standards name

The word list SHALL hold `properly`, `as appropriate`, `if possible`, `and/or`, `but not limited to`, `eventually` and `etc.`, each with its reason. It SHALL not hold totality words such as `every` or `all`. Matching SHALL be case-insensitive and on the whole phrase, so a phrase inside a longer word does not match.

#### Scenario: Failure — a totality word is not flagged

- **GIVEN** a requirement reading "every finding SHALL name its file"
- **WHEN** the validate line runs
- **THEN** `wording` holds no entry for `every`

#### Scenario: Edge case — whole phrases only

- **GIVEN** requirement text holding `improperly` and `Eventually`
- **WHEN** the validate line runs
- **THEN** `Eventually` is flagged as `eventually`, and `improperly` is not flagged

### Requirement: The lint SHALL read only requirement and scenario text a change adds or modifies, outside code and quotation

The lint SHALL read the lines under a delta spec's `## ADDED Requirements` and `## MODIFIED Requirements` blocks, skipping heading lines, fenced code, backtick spans and text inside double quotation marks. `## REMOVED` and `## RENAMED` blocks and the other artifacts SHALL not be read.

#### Scenario: Failure — a quoted mention is not a defect

- **GIVEN** a scenario line reading ``- **THEN** it still rejects vague phrases (`update accordingly`, `etc.`)``
- **WHEN** the validate line runs
- **THEN** `wording` holds no entry for that line

#### Scenario: Edge case — removed text is not read

- **GIVEN** a `## REMOVED Requirements` block whose requirement text holds `if possible`
- **WHEN** the validate line runs
- **THEN** `wording` holds no entry for it

### Requirement: Wording entries SHALL never change whether a change is ready

An entry in `wording` SHALL not add to `problems`, SHALL not change `ready`, and SHALL not change the validate line's exit code.

#### Scenario: Happy path — a ready change with a vague phrase stays ready

- **GIVEN** a change that is ready, and whose delta spec holds `as appropriate`
- **WHEN** the validate line runs
- **THEN** `ready` is `true`, `problems` is unchanged, the exit code is 0, and `wording` holds the entry

### Requirement: The spec skill SHALL print the wording lines before the gate

After the validate line, the spec skill SHALL print each `wording` entry's `message` verbatim, as a warning that never stops the run. When the validate output carries no `wording` field, it SHALL print `WORDING: not reported by this CLI` and continue. The lines SHALL be pinned by token.

#### Scenario: Happy path — the skill carries the instruction

- **WHEN** the shipped `skills/spec/SKILL.md` is read
- **THEN** its validate section names `wording`, `message` and `WORDING: not reported by this CLI`, and a test pins those tokens
