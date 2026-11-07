# Spec Delta

## MODIFIED Requirements

### Requirement: A ship run SHALL adjudicate only findings this review wrote, and a missing findings list SHALL never clear a blocker

When a run emits its review step it SHALL remove the findings and verdicts work files and the two answer directories, the reviewers' and the skeptics', so that a reviewer or a skeptic that writes nothing leaves nothing behind for the fold to read. Each reviewer's briefing SHALL tell it to write one ledger with an empty findings list when nothing is found, and the remediation briefing SHALL tell the fixer to write an empty list, so that a clean result is a file with a list in it.

When `run found` folds the answers and a dimension's answer file is absent, unparseable or carries no findings list, the run SHALL record that dimension as not run, with the reason, whatever its reviewer reported about itself, and SHALL fold the others. When no dimension's answer can be read, the run SHALL record the review as not completed, SHALL adjudicate as with no findings, and SHALL continue to final verification. When `run reviewed` folds the verdicts and a skeptic's file is absent, unparseable or carries no list, the run SHALL set aside both verdicts of that pair, so that no finding is dismissed on a single verdict and none is read as judged.

When `run remediated` adjudicates a round and the findings file is absent, unparseable or carries no findings list, the run SHALL adjudicate the round from the surviving findings of its last adjudication, unchanged: it SHALL NOT read the round as having cleared them, SHALL record that the round was not re-reviewed, with the reason, and SHALL plan the next round or reach its verdict from those findings. A blocker that survived the last adjudication is therefore still a blocker at the verdict round. When the last adjudication cannot be read back either, the run SHALL halt with a reason naming both files; it SHALL NOT proceed as with no findings.

Rationale: the work files outlive a run, so a review that wrote nothing was adjudicated from whatever an earlier run left there, and a review step that reported success over a missing file was a clean review. In a remediation round the same reading is worse: a fixer that leaves the file without a list would clear the blockers it was asked to fix, and the run would commit.

#### Scenario: Happy path — a review that finds nothing says so with an empty list

- **GIVEN** a strict run whose every reviewer wrote a ledger with an empty findings list
- **WHEN** `run found` folds them and `run reviewed` adjudicates
- **THEN** the review is recorded as completed with no surviving findings, and no skeptics step was emitted

#### Scenario: Failure — a review step that wrote nothing is not a clean review, even over an earlier run's file

- **GIVEN** a findings file and a reviewers' answer directory left by an earlier run, holding no blocker, and a strict run whose reviewers all report success and write no answer file
- **WHEN** the review step is emitted and `run found` then runs
- **THEN** the earlier files are gone before the first reviewer starts, every dimension is recorded as not run, the review as not completed with the reason, and the run continues to final verification
- **AND** the merge verdict at close reads the review as not completed, never as a review that found nothing

#### Scenario: Failure — a round that leaves no findings list does not clear a blocker

- **GIVEN** a strict run whose review left one surviving blocker, and a remediation round after which the findings file holds an object with no findings list
- **WHEN** `run remediated` adjudicates that round, and the rounds are exhausted
- **THEN** the blocker still stands and the round is recorded as not re-reviewed with the reason
- **AND** the run halts at its verdict on the unresolved blocker, and does not commit

#### Scenario: Failure — neither the round's list nor the last adjudication can be read

- **GIVEN** a remediation round after which the findings file holds no findings list, and a record of the last adjudication that is absent or unparseable
- **WHEN** `run remediated` adjudicates that round
- **THEN** the run halts with a reason naming both files, and does not commit

#### Scenario: Edge case — both briefings ask for the empty list

- **GIVEN** a reviewer's briefing and the remediation briefing a run assembles
- **WHEN** the prompt suite reads each
- **THEN** the reviewer's tells it to write a ledger with an empty findings list to its answer file when nothing is found, and the remediation briefing tells the fixer to write an empty list to the findings file

#### Scenario: Failure — a skeptic that wrote nothing leaves its finding standing

- **GIVEN** a strict run with one blocker, whose `second-opinion` skeptic wrote a verdict of `isReal: false` with a cited span and whose `refute` skeptic wrote nothing
- **WHEN** `run reviewed` folds the verdicts and adjudicates
- **THEN** both verdicts of the pair are set aside, the blocker survives with no verdict, and the step carries `SKEPTIC VERDICTS MISSING:` naming the `refute` label
