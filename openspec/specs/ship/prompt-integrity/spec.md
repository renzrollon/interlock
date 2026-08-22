# prompt-integrity Specification

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

Where more than one host driver instructs a classifier about tiers, every driver SHALL convey the same tier definitions and the same model-routing rule. A host SHALL NOT carry its own divergent copy of classifier policy.

#### Scenario: Happy path — both drivers state one policy

- **GIVEN** the workflow-runtime driver and the ACP driver
- **WHEN** each driver's assembled classifier prompt is compared to the other's
- **THEN** both convey the same tier definitions for tiers 1 through 5
- **AND** both convey the same rule for which tier may use the most expensive model

#### Scenario: Failure — one driver's tier policy drifts

- **GIVEN** a change to the tier definitions applied to only one driver
- **WHEN** the cross-host comparison runs
- **THEN** the comparison fails and names the two differing statements
- **AND** the run is not permitted to proceed on the basis that each driver is individually well-formed

#### Scenario: Edge case — the two drivers word the same policy differently

- **GIVEN** two drivers whose tier text differs in wording, ordering or whitespace but not in the tier boundaries or the routing rule
- **WHEN** the comparison runs
- **THEN** the comparison passes on the extracted policy, not on byte equality
- **AND** the extraction rule that makes this pass is stated where a reader can check it
