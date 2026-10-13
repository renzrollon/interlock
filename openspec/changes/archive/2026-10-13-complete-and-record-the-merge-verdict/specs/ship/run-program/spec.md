## ADDED Requirements

### Requirement: The closing step SHALL assess merge confidence once, from what this run observed

When a run closes without a halt, `interlock run close` MUST assess merge confidence one time, before it builds the receipt, from an input gathered as the merge-confidence command gathers it. The input MUST take the run's start commit as the base; the paths of the commit the run made as the changed paths, or the working tree's changed paths when the run made no commit; the review record this run adjudicated; the final verification verdict this run acted on; the handoff's recorded counts; coverage figures computed against the start commit when that verdict shows the coverage command ran; and a run record holding whether the trajectory is complete, the stage markers not published, the handoff reports rejected, the permission prompts and auto-mode denials observed, and the tasks left unticked. It MUST supply no pipeline input, so the pipeline signal reads unobserved.

The final verification verdict, or the reasons the CLI skipped final verification, MUST be recorded with the run's identifier when it is judged, so the close reads the verdict the run acted on. A review record or a verification record left in the working directory by an earlier run MUST NOT be read: the close MUST take the review record only when this run adjudicated a review, and the verification record only when it carries this run's identifier, and MUST treat either as absent otherwise.

A close that carries a halt reason MUST NOT assess. A run that recorded no start commit MUST read every signal that needs a base as unobserved, naming the missing start commit. A run that made no commit, because it was told not to or because its commit step reported failure, MUST read the diff-shape and spec-coverage signals as unobserved with that reason.

#### Scenario: Happy path — a strict run is assessed from its own facts

- **GIVEN** a strict run that reviewed with no surviving finding, passed final verification, confirmed every scenario and living requirement, committed, and left no task unticked
- **WHEN** the driver calls `run close` with the commit result
- **THEN** the assessment's verdict is `HUMAN` and its driving list names `ci.pipeline`, with the reason that no pipeline input was given
- **AND** the review, verification, conformance and run-integrity signals read what the run observed

#### Scenario: Failure — a halted run is not assessed

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** no merge-confidence assessment is made
- **AND** the exit code is `1`, as it was before

#### Scenario: Failure — an earlier run's review is not this run's

- **GIVEN** a working directory that still holds the review record and the verification record of an earlier strict run, and a lean run that verified, committed and never reviewed
- **WHEN** the lean run closes
- **THEN** its assessment reads the `review.ran` signal amber with the reason that no review ran, and reads nothing from the earlier review record
- **AND** its verification signals read the verdict this run recorded, not the earlier one

#### Scenario: Edge case — a lean run reads HUMAN and says why

- **GIVEN** a lean run that verified, committed and never reviewed, in a working directory with no earlier record
- **WHEN** the run closes
- **THEN** the assessment's verdict is `HUMAN`
- **AND** its driving list names `review.ran`, with the reason that no review ran

#### Scenario: Edge case — no start commit, and a run that made no commit

- **GIVEN** one completed run whose manifest recorded no start commit, another that ran with the no-commit option, and a third whose commit step reported failure
- **WHEN** each closes
- **THEN** the first reads the diff-shape, human-paths and spec-coverage signals unobserved, each naming the missing start commit
- **AND** the second and third read the diff-shape and spec-coverage signals unobserved with the reason that the run made no commit, and read their other signals over the working tree's changed paths

### Requirement: The closing step SHALL record the assessment in the receipt, the outcome record and an evidence file, and SHALL NOT change its exit code for it

The close MUST record the assessment in three places: a `mergeConfidence` block on the receipt holding the verdict, the score, the worst band, the signal counts, the identifiers of the driving signals and the flags, and no reason or evidence text; the merge verdict in the outcome record's observed group; and an evidence file in the working root, beside the run's review record, holding a schema identifier, the change, the run identifier, the base, the head commit, whether the run committed, the inputs only the run observed, and the assessment. The evidence file is per-run working state and MUST NOT be written to the state home.

When the close did not assess, the receipt's block MUST be absent, never a zero score or a default verdict, no evidence file MUST be written, and the outcome record's verdict MUST be absent.

The verdict MUST NOT change the close's exit code. An assessment that cannot be made MUST leave the block absent and place `MERGE CONFIDENCE NOT ASSESSED: <reason>` in the degradation block. An evidence file that cannot be written MUST place `MERGE CONFIDENCE NOT WRITTEN: <reason>` there. A fact the gather could not read MUST place `MERGE EVIDENCE UNAVAILABLE: <what> — <reason>` there. None of the three MUST change the exit code. When a trajectory write or the reconstructability check fails after the receipt was built, the evidence file and the summary MUST carry an assessment whose run record says the trajectory is incomplete, and the exit code MUST be the one that failure already produces.

#### Scenario: Happy path — a completed run leaves its verdict in three places

- **GIVEN** a strict run that completed and committed, with an assessment of `HUMAN`
- **WHEN** the run closes
- **THEN** the receipt carries a `mergeConfidence` block with that verdict, the score, the counts, the driving signal identifiers and the flags, and no reason text
- **AND** the evidence file exists in the working root, names the change, the run and the commit, and records that the run committed
- **AND** the outcome record's observed group carries the same verdict, and the exit code is `0`

#### Scenario: Failure — a halted run records no verdict

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** the receipt's `mergeConfidence` is recorded as absent, not as a score of zero
- **AND** no evidence file is written by this close, and the outcome record's merge verdict is absent

#### Scenario: Failure — an assessment that cannot be made is spoken and changes no exit code

- **GIVEN** a run that completed and committed, and a gather that fails outright while the close is assessing
- **WHEN** the run closes
- **THEN** the degradation block carries `MERGE CONFIDENCE NOT ASSESSED:` with the reason
- **AND** the receipt's block is absent, no evidence file is written, and the exit code is `0`

#### Scenario: Edge case — a fact the gather could not read, and a run that made no commit

- **GIVEN** one completed run whose gather could not read the diff against the start commit, and another that made no commit
- **WHEN** each closes
- **THEN** the first's degradation block carries `MERGE EVIDENCE UNAVAILABLE:` naming the diff, and its assessment is still recorded with those signals unobserved
- **AND** the second's evidence file records that the run did not commit

#### Scenario: Edge case — a trajectory write fails after the receipt was built

- **GIVEN** a completed run whose terminal trajectory event cannot be appended
- **WHEN** the run closes
- **THEN** the evidence file's run record says the trajectory is incomplete, and its assessment reads the run-integrity signal amber
- **AND** the summary carries that assessment
- **AND** the exit code is `1`, from the failed write

### Requirement: The run's review record SHALL say which selected dimensions ran with their rubric

Every review record a run writes MUST carry a dimension record holding the dimensions the CLI selected, the selected dimensions whose criteria could not be read, whether the review step reported that it completed, the dimensions that ran, and the dimensions recorded as skipped with the reason for each. A dimension MUST be recorded as having run only when the review step reported that it completed and that dimension's criteria were delivered; a dimension a reviewer added beyond the CLI's selection MUST be recorded as having run and MUST NOT be recorded as selected. When the review step did not report that it completed, no dimension MUST be recorded as having run. The record MUST be written again, unchanged in meaning, by every later adjudication of the same run, so the last review record a run leaves still carries it.

The CLI does not watch one dimension run inside the review worker; "ran" in this record means dispatched with its criteria in a review the worker reported complete, and the documentation MUST say so.

#### Scenario: Happy path — a completed review records every selected dimension as run

- **GIVEN** a review step that selected four dimensions, read the criteria of all four, and whose worker reported that it completed
- **WHEN** the run adjudicates the review
- **THEN** the review record lists the four as selected and as run, none as unavailable, and the review as completed
- **AND** a merge-confidence assessment over that record reads the `review.ran` signal green with no flag

#### Scenario: Failure — unreadable criteria, and a review that did not complete

- **GIVEN** one review whose `qa` criteria file could not be read, and another whose worker returned no usable result
- **WHEN** each is adjudicated
- **THEN** the first record names `qa` as unavailable and does not list it as run
- **AND** the second record says the review did not complete and lists no dimension as run
- **AND** a merge-confidence assessment over either reads the `review.ran` signal amber

#### Scenario: Edge case — a skipped domain review and an agent-added dimension

- **GIVEN** a review for which the `domain` dimension was skipped for want of a graph, and whose worker reported one dimension it added with its reason
- **WHEN** the review is adjudicated
- **THEN** the record names `domain` as skipped with the reason
- **AND** the added dimension is listed as run and is not listed as selected

#### Scenario: Edge case — a remediation round keeps the record

- **GIVEN** a run whose first adjudication wrote the dimension record, followed by one fixing round
- **WHEN** the round is adjudicated and the review record is rewritten
- **THEN** the rewritten record carries the same selected, run, unavailable and skipped dimensions
