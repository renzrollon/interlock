## ADDED Requirements

### Requirement: A completed run's summary SHALL carry the merge confidence the close assessed, and a halted run's SHALL carry none

When the close assessed merge confidence, the summary SHALL carry one unindented headline line that is character for character the first line the merge-confidence command prints for the same assessment: it begins `MERGE CONFIDENCE`, then names the verdict, the score, the score's range and how many gating signals are clean. Under it the summary SHALL carry, indented, one row per group of driving signals that has an entry, listing the signal identifiers: `needs a fix:`, `needs a person:` and `needs more evidence:`, in that order; a `flags:` row when any signal carries a flag, naming each signal with its flag; and an `assessment:` row naming the evidence file's path relative to the directory the close ran in. A group with no entry SHALL print no row. The rows SHALL carry identifiers and flags only: no reason and no evidence text.

The block SHALL be printed after the identity rows and before the archive reminder and the closing `Do not start another ship run unless the user asks.` line. A halted run's summary SHALL carry no line of the block. When the evidence file could not be written, the `assessment:` row SHALL NOT be printed, and the degradation block SHALL say the file was not written. When no assessment could be made, no line of the block SHALL be printed, and the degradation block SHALL say so.

Adding the block SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block's existing lines. No line of the block SHALL contain the substrings `LEAN SHIP` or `No degradation banners`, and the wording of the headline and of each row label SHALL be pinned verbatim by a test.

#### Scenario: Happy path — a completed run prints its verdict and what drives it

- **GIVEN** a completed run whose assessment is `HUMAN`, driven by one signal that needs a person and two that need more evidence, with one flag
- **WHEN** the summary is printed
- **THEN** it carries the `MERGE CONFIDENCE HUMAN` headline with the score, the range and the clean count
- **AND** under it a `needs a person:` row naming one signal, a `needs more evidence:` row naming two, a `flags:` row naming the signal and its flag, and an `assessment:` row naming the evidence file
- **AND** it carries no `needs a fix:` row, and the block sits above the `ARCHIVE PENDING` line

#### Scenario: Failure — a halted run prints no merge confidence

- **GIVEN** a run halted by the failure budget
- **WHEN** the summary is printed
- **THEN** it carries no line beginning `MERGE CONFIDENCE` and no `assessment:` row
- **AND** its first line is still `SHIP HALTED — <reason>`

#### Scenario: Edge case — the headline is the command's own

- **GIVEN** one assessment, printed by the merge-confidence command and by a run's close
- **WHEN** the two outputs are compared
- **THEN** the close summary's headline line equals the command's first line exactly

#### Scenario: Edge case — an evidence file that could not be written is not named

- **GIVEN** a completed run whose assessment was made and whose evidence file could not be written
- **WHEN** the summary is printed
- **THEN** it carries the headline and the group rows, and no `assessment:` row
- **AND** the degradation block names the file as not written, with the reason
- **AND** the `LEAN SHIP` line and the exit code are as they would be without the block
