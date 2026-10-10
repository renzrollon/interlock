## MODIFIED Requirements

### Requirement: A run's reported tallies SHALL be its recorded outcomes

Every per-wave tally a run reports — to the reader of its summary and to the record of its trajectory alike — SHALL count the outcomes the state machine recorded, not the outcomes the implementing agents reported for themselves. A run whose tallies are built from self-reports can produce a record that contradicts itself: all waves clean, beside a halt naming failures none of those waves admit to.

A tally SHALL be internally consistent with the run's own halt: if a run halted because recorded task failures accumulated past their cap, the failures counted in its tallies SHALL account for the failures named in its halt reason.

Tasks recorded as done whose report was rejected SHALL be tallied as a count of their own, named by task id, beside the succeeded and failed counts. They SHALL be included in the succeeded count, because the task was recorded as done, and SHALL NOT be included in the failed count. The run's summary SHALL state them on a row of their own and SHALL leave every row it already printed unchanged.

Where a task's recorded outcome is unavailable to the reporting path, the tally SHALL be reported as unobserved rather than as zero, on the same rule that governs every other receipt field: a count that was never read MUST NOT be presented as a count that came back clean. A record written before rejected reports were tallied carries no such count, and a reader of it SHALL report that count as unobserved.

#### Scenario: Happy path — a clean run's tallies match what was recorded

- **GIVEN** a run whose two waves recorded two and three succeeded tasks respectively, with no failures
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both carry per-wave tallies of two succeeded and three succeeded, with no failures
- **AND** the two agree, having counted the same recorded outcomes

#### Scenario: Failure — an adjudicated task is counted as the failure it was recorded as

- **GIVEN** a run in which every implementing agent claimed success but the state machine recorded five tasks as failed because their lanes omitted outcomes, halting the run on its failure cap
- **WHEN** the run reports its summary and appends its receipt
- **THEN** the per-wave tallies report those five as failures
- **AND** neither the summary nor the receipt reports a wave as clean while the halt reason names its tasks as failures

#### Scenario: Edge case — rejected reports are tallied apart from failures

- **GIVEN** a run in which four tasks were recorded as done with rejected reports and no task failed
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both report zero failures and name the four task ids as rejected reports
- **AND** the summary states them on one row of their own, beside a banner naming each task's rejection reason
- **AND** every other row of the summary is what it would have been had the four reports been accepted

#### Scenario: Edge case — an unread outcome is reported as unknown, not as clean

- **GIVEN** a run that ended before the recorded outcomes for a wave could be read back
- **WHEN** the receipt is appended
- **THEN** that wave's tally reads as unobserved rather than as zero failures

#### Scenario: Edge case — a record from an earlier version reports the new count as unobserved

- **GIVEN** a receipt appended before rejected reports were tallied
- **WHEN** that receipt is read back and shown
- **THEN** the record read from it carries the rejected-report count as unobserved rather than as zero
- **AND** what is shown for that receipt is what was shown before the count existed, and states no count of zero rejected reports
