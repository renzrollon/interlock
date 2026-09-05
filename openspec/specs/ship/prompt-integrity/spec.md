# ship/prompt-integrity Specification

## Purpose

Guarantees that every prompt the ship loop assembles reaches its agent intact, and that prompt correctness is verified against the assembled string rather than against the source text that produced it. A corrupted prompt does not fail — it silently under-instructs an agent, which is the most expensive kind of quiet degradation in the loop.

## Requirements

### Requirement: Assembled prompts SHALL contain no coercion artifacts

Every prompt the ship loop builds and sends to an agent SHALL be free of the string forms that JavaScript produces when a value is coerced by mistake — `NaN`, `undefined`, `[object Object]`, and `null` appearing as literal text.

This exists because a stray unary `+` in a concatenation chain is valid JavaScript, produces the substring `NaN` in place of a whole instruction, and is invisible to any check that reads the source file.

#### Scenario: Happy path — the tier ladder reaches the classifier

- **GIVEN** the wave-classification prompt is assembled from its source template
- **WHEN** the assembled string is inspected
- **THEN** it contains the definition of every tier from 1 through 5
- **AND** it contains the routing rule naming `haiku` for the cheapest tier
- **AND** it contains no occurrence of `NaN`, `undefined`, `[object Object]` or `null` as literal text

#### Scenario: Failure — a coercion artifact fails the build

- **GIVEN** a prompt template in which one concatenation operand is accidentally coerced to a number
- **WHEN** the prompt-integrity check runs over the assembled output
- **THEN** the check fails and names the prompt and the artifact string it found
- **AND** the failure is a test failure, not a warning or a banner

#### Scenario: Edge case — the artifact is present in the assembled output but absent from the source bytes

- **GIVEN** a source file whose bytes still contain the complete, correctly worded instruction sentence
- **AND** a concatenation defect that drops that sentence from the assembled result
- **WHEN** a source-text search for the sentence is performed
- **THEN** the search succeeds, and therefore SHALL NOT be accepted as evidence of prompt correctness
- **AND** the assembled-output check fails, and that failure is authoritative

### Requirement: Every assembled ship prompt SHALL be covered by the integrity check

The integrity check SHALL apply to every prompt the ship loop assembles, not to a chosen subset. Adding a new assembled prompt without extending coverage SHALL be detectable.

#### Scenario: Happy path — all assembled prompts are enumerated and checked

- **GIVEN** the ship loop's set of assembled prompts
- **WHEN** the integrity suite runs
- **THEN** each prompt in the set is assembled and asserted against the coercion-artifact rule
- **AND** the suite reports the number of prompts it checked

#### Scenario: Failure — a prompt is assembled but unreachable by the check

- **GIVEN** an assembled prompt that the integrity suite cannot extract or evaluate
- **WHEN** the suite runs
- **THEN** the suite fails with the name of the unreachable prompt
- **AND** it SHALL NOT silently reduce its coverage count and pass

#### Scenario: Edge case — a prompt assembled only on an opt-in path

- **GIVEN** a prompt that is built only when a flag such as review or handoff is passed
- **WHEN** the integrity suite runs without that flag
- **THEN** the prompt is still assembled and checked in isolation
- **AND** coverage does not depend on which run modes the suite happens to exercise

### Requirement: Classifier tier policy SHALL be stated identically across hosts

Classifier tier policy — the tier definitions, the model-routing rule and the grouping rules — SHALL be stated once, in the CLI's prompt module, and assembled into the classifier briefing by the CLI for every host. No host driver SHALL carry a copy of it, divergent or identical. The cross-host comparison that previously established parity SHALL be replaced by a test that the single statement is complete and that no driver contains one.

#### Scenario: Happy path — both drivers state one policy

- **GIVEN** the workflow-runtime driver and the ACP driver
- **WHEN** each runs a classification step
- **THEN** the classifier briefing each agent receives is the file `interlock run start` wrote, assembled from the one prompt module
- **AND** the assembled briefing contains the definition of every tier from 1 through 5 and the rule naming which tier may use the most expensive model
- **AND** neither driver's source contains a tier definition or the routing rule

#### Scenario: Failure — one driver's tier policy drifts

- **GIVEN** a tier definition pasted into one driver
- **WHEN** the no-policy test runs over both drivers
- **THEN** the test fails naming that driver and the tier-ladder token
- **AND** no cross-host comparison is consulted, because there is no second statement to compare

#### Scenario: Edge case — the two drivers word the same policy differently

- **GIVEN** the tier-4 sentence in the prompt module is reworded
- **WHEN** the assembled classifier briefing is checked
- **THEN** the integrity check passes or fails on the assembled output alone
- **AND** both hosts receive the reworded sentence with no second edit, so there is no second wording to reconcile
