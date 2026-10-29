# Spec Delta

## ADDED Requirements

### Requirement: The blockers, warnings and adversarial signals SHALL read the adjudicated review and name the proof they stand on

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker, or a surviving finding whose severity is outside the published severities, SHALL make `review.blockers` red. Surviving warnings above the published cap SHALL make `review.warnings` amber, needing a fix. A refused refutation, or a surviving blocker or warning with fewer verdicts than the published floor, SHALL make `review.adversarial` amber, needing more evidence. A blocker or an unrecognised-severity finding the quality band removed SHALL make it amber, needing a person, the finding named; a removed warning or suggestion, or an input with no removed list, SHALL NOT move it. A green `review.blockers` or `review.warnings` SHALL say whether the review's proof holds.

#### Scenario: Happy path — a clean adjudicated review is green on every review signal

- **GIVEN** a review input with no surviving blocker, surviving warnings at or under the cap, no refused refutation, every surviving finding adjudicated by at least the floor number of skeptics, a dimension record showing every selected dimension ran with its rubric, and a proof that holds
- **WHEN** the merge confidence is assessed
- **THEN** the blockers, warnings, ran and adversarial signals are all green with no flag
- **AND** the blockers signal's reason says the proof holds

#### Scenario: Failure — a surviving blocker is red

- **GIVEN** a review input with one surviving blocker
- **WHEN** the merge confidence is assessed
- **THEN** the blockers signal is red and the verdict is `BLOCK`
- **AND** the evidence names the blocker's file and title

#### Scenario: Failure — a finding with an unrecognised severity is red

- **GIVEN** a review input whose one surviving finding carries a severity outside the published severities
- **WHEN** the merge confidence is assessed
- **THEN** the blockers signal is red and the verdict is `BLOCK`
- **AND** the evidence names the finding and the severity that was rejected

#### Scenario: Failure — surviving warnings above the cap are amber

- **GIVEN** a review input with no surviving blocker and one more surviving warning than the published cap
- **WHEN** the merge confidence is assessed
- **THEN** the warnings signal is amber, marked as needing a fix
- **AND** its reason names the warning cap and its published value

#### Scenario: Edge case — a refused refutation, and a finding with too few verdicts, are amber on the adversarial signal

- **GIVEN** one review input in which one refutation was refused for citing nothing, and another whose one surviving warning had fewer verdicts than the published floor
- **WHEN** both are assessed
- **THEN** each reads the adversarial signal amber, marked as needing more evidence
- **AND** the second's reason names the verdict floor and its published value

#### Scenario: Failure — a blocker the quality band removed holds the verdict for a person

- **GIVEN** a review input with no surviving blocker, whose list of findings removed by the quality band holds one blocker that two skeptics voted real
- **WHEN** the merge confidence is assessed
- **THEN** the blockers signal is green and the adversarial signal is amber, marked as needing a person, its evidence naming the finding
- **AND** the verdict is `HUMAN`, and the same input with a warning in the blocker's place reads the adversarial signal green

#### Scenario: Edge case — zero findings from an unproven review do not read as clean

- **GIVEN** the PR #28 round-0 review record: no surviving finding, four dimensions in `ran`, and a proof naming all four unproven
- **WHEN** the merge confidence is assessed
- **THEN** the blockers signal is green and its reason says the review raised no finding and its proof does not hold
- **AND** the verdict is not `MERGE`

### Requirement: The ran signal SHALL read the dimension record and the proof of coverage

`review.ran` SHALL be amber, needing more evidence, when: there is no review input; the record shows the review did not complete; a selected dimension could not run with its rubric or is recorded neither as run nor as unable to run; the proof names an unproven dimension, a dimension with unread inputs, or an uncited changed source file, each named in the evidence; or the input carries no proof or no dimension record (D2). A selected `domain` or `blast-radius` skipped for want of a graph SHALL count as accounted for and add `domain-skipped` or `blast-radius-skipped`; a skip under any other name SHALL NOT. A record from the run's review step and one `--dimensions` stamps SHALL read alike.

#### Scenario: Edge case — no review input is amber, and a review with no dimension record is amber

- **GIVEN** one assessment with no review input and another whose review input carries counts but no dimension record
- **WHEN** both are assessed
- **THEN** the first reads the ran signal amber with the reason that no review ran
- **AND** the second reads the ran signal amber, needing more evidence, with the reason that the review recorded neither its dimensions nor its coverage

#### Scenario: Edge case — an incomplete review is amber on the ran signal

- **GIVEN** one review input whose dimension record says the review did not complete, and another whose dimension record names a selected dimension that could not run with its rubric
- **WHEN** both are assessed
- **THEN** each reads the ran signal amber
- **AND** the first's reason says the review did not complete, and the second's names the dimension

#### Scenario: Edge case — a skipped domain review is a flag, not a band

- **GIVEN** one review input whose dimension record shows every selected dimension ran and names `domain` as skipped because no graph exists, with a proof that holds, and another identical except that a selected dimension could not run with its rubric
- **WHEN** both are assessed
- **THEN** the first reads the ran signal green with the `domain-skipped` flag and scores below the same input without the skip
- **AND** the second reads the ran signal amber and still carries the `domain-skipped` flag

#### Scenario: Edge case — a skipped blast-radius review is a flag, not a band

- **GIVEN** one review input whose dimension record shows every selected dimension ran and names `blast-radius` as skipped because no graph exists, with a proof that holds, and another that names both `domain` and `blast-radius` as skipped
- **WHEN** both are assessed
- **THEN** the first reads the ran signal green with the `blast-radius-skipped` flag and scores below the same input without the skip
- **AND** the second reads the ran signal green and carries both flags, and `blast-radius-skipped` has its row in the delivery documentation's flag table

#### Scenario: Edge case — the record the review skill writes reads green, and a skipped security review does not

- **GIVEN** the dimension record exactly as `skills/review-code/SKILL.md` shows it, which selects `blast-radius`, leaves it out of `ran` and names it under `skipped` with its reason, stamped by `interlock review --dimensions … --head H --out <file>` with ledgers that prove coverage; and a record that selects `security`, leaves it out of `ran` and names it under `skipped`
- **WHEN** `interlock merge-confidence --review <file>` assesses the first for head H, and the second is assessed alike
- **THEN** the first reads the ran signal green with the `blast-radius-skipped` flag
- **AND** the second reads the ran signal amber, naming `security` as a selected dimension with no record that it ran

#### Scenario: Failure — the PR #28 review is amber on the ran signal

- **GIVEN** the PR #28 round-0 record: four dimensions ran, each raised nothing and recorded no coverage, and four changed source files are uncited
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber, needing more evidence, and its evidence names the four unproven dimensions and the four uncited files
- **AND** the verdict is `HUMAN`

#### Scenario: Edge case — a dimension with an unread input is named with it

- **GIVEN** a review whose proof names `technical-lead` under `unread` with the input `delta specs`, and is otherwise proven
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber and its evidence names `technical-lead` and `delta specs`

#### Scenario: Edge case — a review that raised findings still needs its coverage proved

- **GIVEN** a review with one surviving warning whose proof lists one changed source file as uncited
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber naming that file, and the warnings signal is green

### Requirement: A dimension that ran on a degraded input SHALL be a flag on the ran signal, not a band

A dimension record MAY carry `degraded`, a list of `{ name, reason }` naming a dimension that ran on a cut or stale input: `domain` when the domain text left requirements out, `blast-radius` when the graph did not cover the diff. `review.ran` SHALL add `domain-partial` or `blast-radius-partial` for such an entry and SHALL leave its band as the rest of the record decides it. A `degraded` entry naming any other dimension SHALL be refused by the review command.

#### Scenario: Happy path — a cut domain text is flagged

- **GIVEN** a proven review whose dimension record names `domain` under `degraded` with the reason that five requirements were left out
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with the `domain-partial` flag and scores below the same input without it

#### Scenario: Edge case — a stale graph is flagged, and both can stand together

- **GIVEN** a proven review whose dimension record names both `domain` and `blast-radius` under `degraded`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with both `domain-partial` and `blast-radius-partial`, and each has its row in the delivery documentation's flag table

## MODIFIED Requirements

### Requirement: A review, verification or handoff record that names a commit SHALL be used only for that commit

When the review, verification or handoff input the caller names carries a string `head`, the command SHALL use it only when that head is the head commit under assessment. Otherwise it SHALL say on standard error that the record describes another commit, naming the input and both commits, and SHALL read that input's signals as it would with no such input. A record with no `head` SHALL be read as before. `interlock verify judge` SHALL accept `--head <sha>` and record it on the verdict as `head`. The handoff's `head` SHALL be optional in its schema and SHALL be stripped before the counts are read, as `verdictsRequired` is.

Rationale: the loop that produces these records produces one of each per pushed head; a record that names its head lets the command, rather than the caller's care, keep last round's review, the previous head's verdict or a handoff answered before the last push from being judged as this head's.

#### Scenario: Happy path — three records for this head

- **GIVEN** a review record with no surviving finding and a proof that holds, a final verification verdict with a green suite, and a handoff whose counts match the command's, each carrying `head` equal to the head commit
- **WHEN** the command runs with them as `--review`, `--verify` and `--handoff`
- **THEN** the review-ran signal is green, the suite signal reads the verdict, and the conformance signals read the counts
- **AND** nothing about a head is said on standard error

#### Scenario: Failure — a record for an earlier head

- **GIVEN** the same three records, each carrying `head` equal to the head commit's parent
- **WHEN** the command runs with them
- **THEN** standard error says, for each input by name, that the record describes another commit, naming both
- **AND** the review-ran signal is amber as it is with no review input, the suite signal is unobserved as with no verdict, the conformance signals are unobserved as with no handoff, and the verdict is not `MERGE`

#### Scenario: Edge case — records with no head, and the verdict's own head

- **GIVEN** a review record with `surviving` and no `head`, a verdict and a handoff with no `head`; and `interlock verify judge` run with `--head H`
- **WHEN** the command runs with the three records, and the verdict of the judge run is read
- **THEN** each record's head is read as it was before the key existed, with nothing about a head on standard error
- **AND** the judge's verdict carries `head` equal to H

### Requirement: The ran signal's evidence SHALL name the depth the review record carries

When the review input's dimension record carries `depth`, the ran signal (`review.ran`) SHALL carry `depth: <value>` in its evidence, whatever its band. A record without `depth` SHALL be read exactly as before, with no depth line. The depth SHALL move no band and raise no flag: the lean depth is the published default, not a degradation, and the evidence is what lets a reader of a `MERGE` ask for the strict one.

Rationale: a verdict that does not say how thorough its review was is a verdict a reader cannot calibrate; a verdict that scored every default review lower would be a threshold stated as a flag.

#### Scenario: Happy path — a lean record is named and green

- **GIVEN** a review input with no surviving blocker, warnings under the cap, a dimension record showing every selected dimension ran and carrying `depth: lean`, and a proof that holds
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with no flag and its evidence carries `depth: lean`
- **AND** the score equals the score of the same input with `depth: strict`

#### Scenario: Failure — an incomplete lean review is amber and still named

- **GIVEN** a review input whose dimension record carries `depth: lean` and names a selected dimension that neither ran nor was unavailable
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber with the reason naming that dimension
- **AND** its evidence carries `depth: lean`

#### Scenario: Edge case — a record without a depth reads as before

- **GIVEN** a review input whose dimension record carries no `depth`, and a proof that holds
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal's band, flags and reason are what they were before this requirement
- **AND** no evidence line names a depth

## REMOVED Requirements

### Requirement: The review signals SHALL read the adjudicated review

**Reason**: Replaced by two requirements that read the review's proof of coverage as well as its findings: "The blockers, warnings and adversarial signals SHALL read the adjudicated review and name the proof they stand on" and "The ran signal SHALL read the dimension record and the proof of coverage". The old requirement read a review with no surviving finding as clean on every review signal and a review with no dimension record as green with a flag, which is how PR #28's unproven review read green.

**Migration**: Ten of the removed requirement's eleven scenarios are carried into the two replacements under their own titles. The eleventh, "Edge case — no review input is amber, and a review with no dimension record is a flag", is carried as "… is amber", because its outcome changes (D2). The clean-review scenario now also requires a proof that holds. Review records written by an older plugin carry no proof and read amber until re-reviewed on this version; the `dimensions-unrecorded` flag is retired.
