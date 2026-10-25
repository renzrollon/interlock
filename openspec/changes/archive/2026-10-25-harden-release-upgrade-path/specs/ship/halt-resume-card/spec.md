## ADDED Requirements

### Requirement: Every command the card prints SHALL run as printed

The suite SHALL write a card for a halted run, take every `interlock` command line the card prints, substitute the card's own values for its placeholders, and run each line against the run's repository. A line that exits non-zero for a reason other than its documented verdict SHALL fail the suite, naming the line.

#### Scenario: Failure — the recovery command reads the wrong positional

- **GIVEN** a card whose recovery line is `interlock tasks tick <change> --ids <ids>`
- **WHEN** the suite runs that line with the card's change and a verified id
- **THEN** the task is ticked and the line exits 0
