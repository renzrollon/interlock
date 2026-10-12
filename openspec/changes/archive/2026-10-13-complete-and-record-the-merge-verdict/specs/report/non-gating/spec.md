## ADDED Requirements

### Requirement: The report SHALL NOT read or print the merge verdict

The report SHALL NOT compute any indicator from a receipt's merge-confidence block or from an outcome record's merge verdict, and its human-readable and machine-readable output SHALL NOT carry a merge verdict or a merge score. A corpus whose receipts carry the block SHALL produce the same indicators as the same corpus without it.

Rationale: the report is barred from verdict words, and a merge verdict is one. The verdict is read where it is assessed, in the close summary and by the merge-confidence command.

#### Scenario: Happy path — receipts that carry a verdict add nothing to the report

- **GIVEN** a corpus of trajectories whose receipts each carry a merge-confidence block
- **WHEN** the report is produced
- **THEN** no indicator is derived from the block, and the output carries neither a merge verdict nor a merge score

#### Scenario: Failure — an indicator built from the verdict is a defect

- **GIVEN** a report whose output names a merge verdict taken from a receipt
- **WHEN** the report's output is checked
- **THEN** the check fails naming the value

#### Scenario: Edge case — the same corpus with and without the block

- **GIVEN** two corpora identical except that the receipts of one carry the merge-confidence block
- **WHEN** the report is produced for each
- **THEN** every indicator and denominator is the same in both
