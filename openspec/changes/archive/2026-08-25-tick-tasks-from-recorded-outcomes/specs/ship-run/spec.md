## ADDED Requirements

### Requirement: A run's reported tallies SHALL be its recorded outcomes

Every per-wave tally a run reports — to the reader of its summary and to the record of its trajectory alike — SHALL count the outcomes the state machine recorded, not the outcomes the implementing agents reported for themselves. A run whose tallies are built from self-reports can produce a record that contradicts itself: all waves clean, beside a halt naming failures none of those waves admit to.

A tally SHALL be internally consistent with the run's own halt: if a run halted because recorded task failures accumulated past their cap, the failures counted in its tallies SHALL account for the failures named in its halt reason.

Where a task's recorded outcome is unavailable to the reporting path, the tally SHALL be reported as unobserved rather than as zero, on the same rule that governs every other receipt field: a count that was never read MUST NOT be presented as a count that came back clean.

#### Scenario: Happy path — a clean run's tallies match what was recorded

- **GIVEN** a run whose two waves recorded two and three succeeded tasks respectively, with no failures
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both carry per-wave tallies of two succeeded and three succeeded, with no failures
- **AND** the two agree, having counted the same recorded outcomes

#### Scenario: Failure — an adjudicated task is counted as the failure it was recorded as

- **GIVEN** a run in which every implementing agent claimed success but the state machine recorded five tasks as failed for invalid handoff packets, halting the run on its failure cap
- **WHEN** the run reports its summary and appends its receipt
- **THEN** the per-wave tallies report those five as failures
- **AND** neither the summary nor the receipt reports a wave as clean while the halt reason names its tasks as failures

#### Scenario: Edge case — an unread outcome is reported as unknown, not as clean

- **GIVEN** a run that ended before the recorded outcomes for a wave could be read back
- **WHEN** the receipt is appended
- **THEN** that wave's tally reads as unobserved rather than as zero failures
