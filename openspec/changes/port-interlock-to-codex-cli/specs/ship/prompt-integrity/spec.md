## MODIFIED Requirements

### Requirement: Assembled prompts SHALL contain no coercion artifacts

Every prompt the ship loop builds and sends to an agent SHALL be free of the string forms that JavaScript produces when a value is coerced by mistake — `NaN`, `undefined`, `[object Object]`, and `null` appearing as literal text.

This exists because a stray unary `+` in a concatenation chain is valid JavaScript, produces the substring `NaN` in place of a whole instruction, and is invisible to any check that reads the source file.

#### Scenario: Happy path — the tier ladder reaches the classifier

- **GIVEN** the wave-classification prompt is assembled from its source template
- **WHEN** the assembled string is inspected
- **THEN** it contains the definition of every tier from 1 through 5
- **AND** it contains the routing rule naming the cheapest model class for the cheapest tier
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

#### Scenario: Edge case — no assembled prompt names a vendor model

- **GIVEN** every prompt the ship loop assembles, on every host
- **WHEN** each assembled string is searched for a vendor model name in a routing instruction
- **THEN** none is found
- **AND** the routing instruction names a model class instead, so one prompt template serves every host

### Requirement: Classifier tier policy SHALL be stated identically across hosts

Where more than one host driver instructs a classifier about tiers, every driver SHALL convey the same tier definitions and the same model-routing rule. A host SHALL NOT carry its own divergent copy of classifier policy. The comparison SHALL cover every driver the repository ships, and adding a driver without extending the comparison SHALL be detectable.

#### Scenario: Happy path — both drivers state one policy

- **GIVEN** every host driver the repository ships — the workflow-runtime driver, the ACP driver, and the Codex driver
- **WHEN** each driver's assembled classifier prompt is compared to the others'
- **THEN** all convey the same tier definitions for tiers 1 through 5
- **AND** all convey the same rule for which tier may use the deepest model class

#### Scenario: Failure — one driver's tier policy drifts

- **GIVEN** a change to the tier definitions applied to only one driver
- **WHEN** the cross-host comparison runs
- **THEN** the comparison fails and names the differing statements and the drivers they came from
- **AND** the run is not permitted to proceed on the basis that each driver is individually well-formed

#### Scenario: Edge case — the two drivers word the same policy differently

- **GIVEN** drivers whose tier text differs in wording, ordering or whitespace but not in the tier boundaries or the routing rule
- **WHEN** the comparison runs
- **THEN** the comparison passes on the extracted policy, not on byte equality
- **AND** the extraction rule that makes this pass is stated where a reader can check it

#### Scenario: Edge case — a newly added driver cannot escape the comparison

- **GIVEN** a fourth driver added to the repository without being registered with the comparison
- **WHEN** the suite runs
- **THEN** it fails naming the unregistered driver
- **AND** it SHALL NOT silently compare only the drivers it already knew about
