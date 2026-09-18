## ADDED Requirements

### Requirement: The explaining skill's quote-not-recompute contract SHALL be pinned by token

The skill that presents the report SHALL keep the tokens `interlock report --json`, `Never recompute`, and `Licenses nothing` in its instruction text. The skill suite SHALL assert those tokens, not whole sentences. A reword that drops any of them SHALL fail the suite. The suite SHALL NOT treat a green run as proof that the skill still quotes the command rather than deriving figures.

#### Scenario: Happy path — the skill names the command and the two contracts

- **GIVEN** the explaining skill as shipped
- **WHEN** the skill suite reads its instruction text
- **THEN** the text contains `interlock report --json`
- **AND** it contains `Never recompute`
- **AND** it contains `Licenses nothing`

#### Scenario: Failure — dropping the command or a contract token fails the suite

- **GIVEN** a revision of the explaining skill that no longer contains `interlock report --json`, or no longer contains `Never recompute`, or no longer contains `Licenses nothing`
- **WHEN** the skill suite runs
- **THEN** the pin fails, naming the missing token
- **AND** a reword that keeps the tokens still passes

#### Scenario: Edge case — a sentence-level reword that keeps the tokens still passes

- **GIVEN** a revision that reorders or rephrases surrounding prose but keeps `interlock report --json`, `Never recompute`, and `Licenses nothing`
- **WHEN** the skill suite runs
- **THEN** the pin still passes
- **AND** the pin does not require a whole sentence to match
