# report/non-gating Specification

## Purpose
Fixes the report's standing as an instrument rather than a decision: it exits zero, issues no verdict, and nothing in the loop may branch on it. Decision §4.15(a) forbids gating on these records, and a rate is one comparison away from a threshold — so the prohibition is a requirement, not a comment.

## Requirements

### Requirement: The report always exits zero

The report SHALL exit zero on every invocation in which it produced a report, including when every indicator is unobserved, when a corpus is absent, and when files were unreadable.

#### Scenario: An empty corpus exits zero

- **WHEN** no corpus exists
- **THEN** the report is produced and the exit status is zero

#### Scenario: Unreadable files do not change the exit status

- **WHEN** some corpus files could not be read
- **THEN** the report names them and the exit status is still zero

### Requirement: The report issues no verdict

The report SHALL NOT classify a value as pass, fail, acceptable, healthy, degraded or blocking, and SHALL NOT compare any value against a threshold.

#### Scenario: No indicator carries a pass or fail label

- **WHEN** the report is produced
- **THEN** no indicator carries a verdict label

#### Scenario: No threshold is applied

- **WHEN** an indicator's value is computed
- **THEN** it is reported as a value and its denominator, and is compared against nothing

### Requirement: Nothing in the loop reads the report

No gate, readiness check, risk classification, autonomy record or workflow step SHALL consume the report's output. The report SHALL be reachable only by a human reader or by the skill that explains it.

#### Scenario: The continuity gate does not consult the report

- **WHEN** readiness for skipping the human checkpoint is decided
- **THEN** the decision is reached without reading the report

#### Scenario: A run's control flow does not branch on the report

- **WHEN** a ship run executes
- **THEN** no step of it invokes the report or branches on its output

### Requirement: The explaining skill does not recompute or recommend

The skill that presents the report SHALL obtain every figure from the command rather than deriving one, SHALL state what a figure does and does not license, and SHALL NOT recommend that any gate, cap or threshold be changed on the basis of a figure.

#### Scenario: A figure is quoted, not recomputed

- **WHEN** the skill presents an indicator
- **THEN** the value it presents is the one the command emitted

#### Scenario: A thin corpus is reported as licensing nothing

- **WHEN** an indicator's denominator is zero or near zero
- **THEN** the skill states that the figure licenses no conclusion, and names what would have to be recorded for it to

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
