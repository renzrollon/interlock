## ADDED Requirements

### Requirement: A halt whose resume card was written SHALL be named in the summary

When a halted close wrote a resume card, the terminal summary SHALL carry a `  resume card: <repo-relative path>` row naming it. The path SHALL be repo-relative rather than absolute: it is printed beside the `cwd:` row and it is what a reader types.

The row SHALL be printed after the identity rows and before the archive-reminder block and the closing `Do not start another ship run unless the user asks.` line.

The row SHALL be printed only when a card was actually written. A row naming a file that is not there would be worse than no row, so a close that could not write its card reports that in the degradation block instead, and a clean close — which writes no card, having nothing to resume — carries no row at all.

Adding the row SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block.

#### Scenario: Happy path — a halt names the card it left behind

- **GIVEN** a halted run for `add-thing` whose card was written under the handoff directory
- **WHEN** the summary is printed
- **THEN** it carries a `resume card:` row naming that card's repo-relative path
- **AND** the row appears before the closing `Do not start another ship run unless the user asks.` line

#### Scenario: Failure — a card that could not be written is not named

- **GIVEN** a halted run whose card write failed and was bannered
- **WHEN** the summary is printed
- **THEN** it carries no `resume card:` row
- **AND** the degradation block names the card as not written, with the reason
- **AND** the exit code is the halt's own, unchanged

#### Scenario: Edge case — a clean close carries no row

- **GIVEN** a run that completed without a halt
- **WHEN** the summary is printed
- **THEN** it carries no `resume card:` row
- **AND** its `ARCHIVE PENDING` reminder and `LEAN SHIP` line are exactly as they were before the row existed
