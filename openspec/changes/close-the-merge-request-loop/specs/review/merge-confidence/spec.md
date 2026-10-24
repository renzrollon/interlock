## RENAMED Requirements

- FROM: `### Requirement: The command SHALL accept a run's evidence file and SHALL use it only for the commit that run made`
- TO: `### Requirement: The command SHALL accept a run's evidence file, SHALL use its tree-bound evidence only for the commit that run made, and SHALL carry its run record to that commit's descendants`

## MODIFIED Requirements

### Requirement: The risk signal SHALL be computed over the touched paths and SHALL never be red

The risk signal (`risk.class`) SHALL classify the changed paths, and only the changed paths, with the existing risk classifier in its paths-only mode: the change's artifact text SHALL NOT be read at merge, and the classifier's severity path rules SHALL be evaluated over the changed paths that are neither documentation nor test paths. A signal whose only rule reads artifact text SHALL therefore not fire at merge, and a diff whose only clue was such a word SHALL read the class its paths earn. A class within the published merge-allowed classes SHALL be green. A class above them SHALL be amber, marked as needing a person, with the classifier's driving signal in the evidence. The risk signal SHALL NOT resolve red, because touching a sensitive path is a reason for a person to decide, not a defect the machine found. The classifier's other callers, the continuity gate and the spec-stage checkpoint, SHALL keep reading both sources.

Rationale: at the spec stage prose is all there is, and a keyword read that fails closed is right. At merge there is a diff, and a word in a design document is not a touched surface; a test file whose name carries a policy token, or that sits under a payments directory, is not a policy or payment surface either.

#### Scenario: Happy path — a docs-and-tests change is green

- **GIVEN** changed paths that are all documentation or tests
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is green with the classifier's class in the evidence

#### Scenario: Failure — a payment path is amber and needs a person

- **GIVEN** a changed source path, neither documentation nor a test, under a payments directory
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is amber, never red
- **AND** it is marked as needing a person, and the evidence names the payment signal and the path

#### Scenario: Edge case — no changed paths and no artifact text fails closed to amber

- **GIVEN** an assessment with no changed paths, once with artifact text and once without
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is amber both times with the classifier's unclassifiable reason, because artifact text is not read at merge
- **AND** it is not green and not unobserved, because the classifier itself answered

#### Scenario: Edge case — prose, a test path's token and a test under a payments directory are not read

- **GIVEN** changed paths `lib/receipt.mjs`, `test/spine/review-policy.test.mjs` and `test/payments/charge.test.mjs`, and artifact text whose words, a text-only signal's among them, would classify critical at the spec stage
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is green with the unmatched-source class in the evidence
- **AND** the same paths and text given to `interlock risk` still classify above the merge-allowed classes

### Requirement: The review signals SHALL read the adjudicated review

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker, or a surviving finding whose severity is outside the published severities, SHALL make the blockers signal (`review.blockers`) red. Surviving warnings above the published cap SHALL make the warnings signal (`review.warnings`) amber, marked as needing a fix. An absent review input SHALL make the ran signal (`review.ran`) amber with the reason that no review ran. A dimension record showing that the review did not complete, that a selected dimension could not run with its rubric, or that a selected dimension is recorded neither as run nor as unable to run, SHALL make the ran signal amber. A review input that records no dimension selection SHALL be green on the ran signal with a flag, because the counts prove a review happened and only the record of its coverage is missing. A dimension record that names the `domain` dimension as skipped for want of a graph SHALL leave the ran signal's band as the rest of the record decides it and SHALL add the `domain-skipped` flag; one that names the `blast-radius` dimension as skipped for want of a graph SHALL likewise leave the band and SHALL add the `blast-radius-skipped` flag. The dimension record MAY come from the run's review step or from the record the review command's `--dimensions` option stamps, and the ran signal SHALL read both alike. A review in which a refutation was refused for citing nothing, or in which a surviving blocker or warning had fewer verdicts than the published floor, SHALL be amber on the adversarial signal (`review.adversarial`), marked as needing more evidence. A review from which the quality band removed a blocker, or a finding whose severity is outside the published severities, SHALL be amber on the adversarial signal, marked as needing a person, with the finding named in the evidence: the skeptics' vote kept it, and it is in no surviving list for the blockers signal to read. A warning or a suggestion the band removed SHALL NOT move the signal, and neither SHALL a review input that carries no list of what the band removed.

#### Scenario: Happy path — a clean adjudicated review is green on every review signal

- **GIVEN** a review input with no surviving blocker, surviving warnings at or under the cap, no refused refutation, every surviving finding adjudicated by at least the floor number of skeptics, and a dimension record showing every selected dimension ran with its rubric
- **WHEN** the merge confidence is assessed
- **THEN** the blockers, warnings, ran and adversarial signals are all green with no flag

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

#### Scenario: Edge case — no review input is amber, and a review with no dimension record is a flag

- **GIVEN** one assessment with no review input and another whose review input carries counts but no dimension record
- **WHEN** both are assessed
- **THEN** the first reads the ran signal amber with the reason that no review ran
- **AND** the second reads the ran signal green with a flag saying the dimension record is absent

#### Scenario: Edge case — an incomplete review is amber on the ran signal

- **GIVEN** one review input whose dimension record says the review did not complete, and another whose dimension record names a selected dimension that could not run with its rubric
- **WHEN** both are assessed
- **THEN** each reads the ran signal amber
- **AND** the first's reason says the review did not complete, and the second's names the dimension

#### Scenario: Edge case — a skipped domain review is a flag, not a band

- **GIVEN** one review input whose dimension record shows every selected dimension ran and names `domain` as skipped because no graph exists, and another identical except that a selected dimension could not run with its rubric
- **WHEN** both are assessed
- **THEN** the first reads the ran signal green with the `domain-skipped` flag and scores below the same input without the skip
- **AND** the second reads the ran signal amber and still carries the `domain-skipped` flag

#### Scenario: Edge case — a skipped blast-radius review is a flag, not a band

- **GIVEN** one review input whose dimension record shows every selected dimension ran and names `blast-radius` as skipped because no graph exists, and another that names both `domain` and `blast-radius` as skipped
- **WHEN** both are assessed
- **THEN** the first reads the ran signal green with the `blast-radius-skipped` flag and scores below the same input without the skip
- **AND** the second reads the ran signal green and carries both flags, and `blast-radius-skipped` has its row in the delivery documentation's flag table

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

### Requirement: The command SHALL accept a run's evidence file, SHALL use its tree-bound evidence only for the commit that run made, and SHALL carry its run record to that commit's descendants

The merge-confidence command SHALL accept an option naming the evidence file a ship run's close wrote. From a usable file it SHALL take the inputs only a run observed: the adjudicated review, the final verification verdict, the handoff's counts, the coverage figures and the run record. A file SHALL be usable in full only when it carries the published schema identifier, names the change under assessment, records that the run made a commit, and records as that commit the head commit. For a head that descends from the recorded commit, the file SHALL supply only its run record, under the conditions the descendant requirement below states. When neither holds, the command SHALL use nothing from the file, SHALL say on standard error which condition failed, and SHALL read each of those signals as it would with no file. An input the caller also names explicitly SHALL replace the file's entry for that input. The command SHALL NOT read the verdict, the score or any signal result recorded in the file: it SHALL always assess from the evidence.

A file that cannot be read or parsed SHALL end the command as any other unreadable input does: exit 1, the reason on standard error naming the file, and no verdict on standard output.

Rationale: a run's facts about a tree are evidence about the commit the run made. A later commit leaves tree-bound evidence about a tree no later command can name, which is the same reason a pipeline result for another commit is unobserved; the run's record of its own conduct is not tree-bound.

#### Scenario: Happy path — a run's evidence and a passing pipeline read MERGE

- **GIVEN** a change, a base, an evidence file a clean reviewed run wrote for the head commit, and a pipeline input in which every check for the head passed
- **WHEN** the command runs with the evidence file, the pipeline input and the base
- **THEN** the review, verification, conformance, coverage and run-integrity signals read what the run's evidence supports
- **AND** the verdict is `MERGE` and the command exits zero

#### Scenario: Failure — evidence for another commit is not used

- **GIVEN** an evidence file whose recorded commit is neither the head commit nor an ancestor of it
- **WHEN** the command runs with it
- **THEN** standard error says the file describes another commit, naming both
- **AND** the review, verification and run-integrity signals read as they would with no file, and the verdict is `HUMAN`

#### Scenario: Failure — an unreadable evidence file exits 1 with no verdict

- **GIVEN** an evidence file that is not valid JSON
- **WHEN** the command runs with it and JSON output
- **THEN** it exits 1
- **AND** standard output carries no verdict, and standard error names the file

#### Scenario: Edge case — an explicit input wins, a run with no commit is refused, and a recorded verdict is ignored

- **GIVEN** three runs of the command: one with a usable evidence file and an explicit review input that carries a surviving blocker; one with an evidence file that records the run made no commit; and one with a usable evidence file whose recorded verdict says `MERGE` while its review evidence carries a surviving blocker
- **WHEN** each runs
- **THEN** the first reads the blockers signal red from the explicit review
- **AND** the second uses nothing from the file and says so on standard error
- **AND** the third reads `BLOCK`, because the verdict recorded in the file is never read

### Requirement: With `--markdown` the command SHALL print the description block and nothing else

With `--markdown`, standard output SHALL be one Markdown block and nothing else: a `## Merge confidence` heading; the verdict, the score and the band range on one line; directly after it, one legend line saying that `MERGE` means every local signal is green and is not a statement that the platform's branch rules would let the merge request merge, naming required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue as rules the verdict does not read; the commit assessed and the base; one group per kind of driving signal that has an entry, in the order needs a fix, needs a person, needs more evidence; the flags; the checks excluded from the pipeline input, when any; the two labels; and the full signal table inside a collapsed section. The block SHALL be rendered by `lib/merge-confidence.mjs` from the assessment and from the head, the base and the excluded names the command holds; the legend line SHALL be the same text in every verdict. Every reason and evidence line, and every excluded name, SHALL be rendered as an inline code span, with any backtick in it replaced, line breaks folded, and its length bounded, so that no name a platform, a review or a ledger supplied can render as a mention, a link or markup. The exit status SHALL be what it is without the flag. `--markdown` together with `--json` SHALL exit 1 with a usage error and nothing on standard output.

Rationale: a block a model renders from JSON is a block a model can mis-render. Printed by the command, the description shows what the command computed. A check is named by the workflow that defines it and a finding by the reviewer that wrote it; posted as plain Markdown under the account of whoever ran the skill, either could mention a person or close the collapsed section. The verdict's word is the platform's word, and every platform has gates the command never reads; the legend line is the one line the command controls that could otherwise be read as the platform's answer.

#### Scenario: Happy path — a human verdict's block

- **GIVEN** an assessment reading `HUMAN` with one signal needing a person, two needing more evidence and one flag
- **WHEN** the command runs with `--markdown`
- **THEN** standard output starts with `## Merge confidence`, carries the verdict line, the legend line, the commit and the base, a group for each of the two kinds, the flag, the two labels and one table row per registered signal
- **AND** it carries no group for needs a fix

#### Scenario: Failure — a name that tries to be markup stays text

- **GIVEN** a pipeline input with a failed check named with an `@` mention, a link and a closing `details` tag, and a backtick; and another whose check name is many times longer than a line
- **WHEN** the command runs with `--markdown` for each
- **THEN** in the first the name appears only inside an inline code span, with the backtick replaced
- **AND** with its code spans removed, the block holds one opening and one closing `details` tag
- **AND** in the second the name is cut short and ends with an ellipsis

#### Scenario: Failure — both output flags is a usage error

- **GIVEN** the command run with `--markdown` and `--json`
- **WHEN** it starts
- **THEN** it exits 1, standard error names the two flags, and standard output is empty

#### Scenario: Edge case — a blocking verdict still prints its block

- **GIVEN** an assessment reading `BLOCK`
- **WHEN** the command runs with `--markdown`
- **THEN** the block is printed and the exit status is 1

#### Scenario: Edge case — the legend line is in every verdict

- **GIVEN** three assessments reading `MERGE`, `HUMAN` and `BLOCK`
- **WHEN** the command runs with `--markdown` for each
- **THEN** each block carries, directly after the verdict line, one line naming `branch rules`, `approvals`, `code owners`, `draft`, `review threads` and `merge queue`
- **AND** the line is the same text in all three

## ADDED Requirements

### Requirement: A run's evidence file SHALL supply its run record to a descendant head on the same merge base, and nothing else

When the head commit descends from the commit the evidence file records, a base is given, and the commit the file records as its base equals the merge base of that base and the head, the command SHALL take from the file only the run record, and SHALL drop the review, the verification verdict, the handoff's counts and the coverage figures, saying on standard error, once, the commit the record was carried from, and once per dropped entry, that it describes the tree at that commit. With no base given, with a merge base that differs from the file's base, or with a file that records no base, the command SHALL take nothing from the file and SHALL say why. The reader of the file SHALL return what it kept, what it dropped and the commit it carried from, and SHALL NOT read version control itself: the caller establishes the ancestry and hands it in as one of three values, an ancestor, not an ancestor, or not decided. A fact git could not decide SHALL refuse the file with a reason that says the ancestry could not be decided, naming the recorded commit, distinct from the reason for a commit that is not an ancestor.

Rationale: a fix commit made on top of the run's commit does not change what that run did, and the record of a run's conduct is the one entry that is not about a tree. The merge-base condition keeps the rule that a branch of several hand commits is not a reviewed branch: only a branch that still starts where the run started carries the record. A shallow clone that lacks the recorded commit is not a branch that abandoned it, and the reader is sent to the right repair only if the two are told apart.

#### Scenario: Happy path — one fix commit on top of the run's

- **GIVEN** a branch whose commits beyond the target are the run's commit and one later commit; the run's evidence file; `--base` naming the target; explicit `--review`, `--verify` and `--handoff` inputs bound to the head; a pipeline input in which every check for the head passed; a ledger with no open row and changed paths outside the always-human list; and either a `--coverage` input the loop's coverage step produced for the head or a verification verdict that skipped coverage as not configured
- **WHEN** the command runs with `--run`
- **THEN** the run-integrity signal reads the file's run record, standard error names the run's commit as the one the record was carried from and lists review, verify, handoff and coverage as dropped
- **AND** the review, verification, conformance and coverage signals read the explicit inputs, and the verdict is `MERGE`

#### Scenario: Failure — a descendant on another merge base, and no base at all

- **GIVEN** the same branch rebased onto a target that moved so the merge base is no longer the run's base; and the same branch with no `--base` given
- **WHEN** the command runs with `--run` for each
- **THEN** the first takes nothing from the file and standard error names the run's base and the merge base
- **AND** the second takes nothing from the file and standard error says the ancestry cannot be judged without a base, and the verdict is not `MERGE`

#### Scenario: Failure — an ancestry git could not decide

- **GIVEN** an evidence file whose recorded commit the repository does not hold, so `git merge-base --is-ancestor` fails rather than answers
- **WHEN** the command runs with `--run` and `--base`
- **THEN** it takes nothing from the file and standard error says the ancestry of the recorded commit could not be decided, with git's own failure beside it
- **AND** standard error does not say the file describes another commit, and the verdict is not `MERGE`

#### Scenario: Edge case — the reader's own answer

- **GIVEN** the evidence reader called with a head that is not the recorded commit, the ancestry fact true, and a base whose merge base equals the file's base
- **WHEN** it reads the file
- **THEN** it returns usable with `evidence` holding only `run`, `dropped` naming `review`, `verify`, `handoff` and `coverage` each with a reason, and `carriedFrom` equal to the recorded commit
- **AND** called with the ancestry fact false it refuses the whole file with the "another commit" reason, and called with the fact null it refuses with the "could not decide" reason

### Requirement: A review, verification or handoff record that names a commit SHALL be used only for that commit

When the review, verification or handoff input the caller names carries a string `head`, the command SHALL use it only when that head is the head commit under assessment. Otherwise it SHALL say on standard error that the record describes another commit, naming the input and both commits, and SHALL read that input's signals as it would with no such input. A record with no `head` SHALL be read as before. `interlock verify judge` SHALL accept `--head <sha>` and record it on the verdict as `head`. The handoff's `head` SHALL be optional in its schema and SHALL be stripped before the counts are read, as `verdictsRequired` is.

Rationale: the loop that produces these records produces one of each per pushed head; a record that names its head lets the command, rather than the caller's care, keep last round's review, the previous head's verdict or a handoff answered before the last push from being judged as this head's.

#### Scenario: Happy path — three records for this head

- **GIVEN** a review record with no surviving finding, a final verification verdict with a green suite, and a handoff whose counts match the command's, each carrying `head` equal to the head commit
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
- **THEN** each record is read as it was before the key existed, with nothing about a head on standard error
- **AND** the judge's verdict carries `head` equal to H
