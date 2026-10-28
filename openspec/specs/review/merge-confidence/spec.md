# review/merge-confidence Specification

## Purpose
Turns the facts a review and a run already produce into one answer to "can this be merged?": a three-way verdict a platform rule can branch on, and a bounded score a person can sort by, computed by the CLI from observed evidence so that neither a model nor a line of prose can re-argue it.

## Requirements

### Requirement: The verdict SHALL be the worst band over every gating signal

Each gating signal SHALL resolve to exactly one of four bands: green, amber, red, or unobserved. The verdict SHALL be `MERGE` only when every gating signal is green, `BLOCK` when at least one gating signal is red, and `HUMAN` otherwise. An unobserved signal SHALL rank as amber for the verdict. No count or share of green signals SHALL lift a verdict past a single red or amber signal. The verdict and the score SHALL be computed from the list of gating signal results alone, so the same list always yields the same verdict and score whichever input produced it.

Rationale: averaging is how a critical signal gets diluted by volume; the risk classifier already refuses it, and the merge verdict inherits the rule.

#### Scenario: Happy path — every signal green reads MERGE

- **GIVEN** a list of gating signal results in which every result is green
- **WHEN** the list is combined into a verdict
- **THEN** the verdict is `MERGE`
- **AND** the output lists no driving signal

#### Scenario: Failure — one red among many greens reads BLOCK

- **GIVEN** a list of gating signal results in which one is red and every other is green
- **WHEN** the list is combined into a verdict
- **THEN** the verdict is `BLOCK`
- **AND** the red signal is named as driving, with the evidence that made it red

#### Scenario: Edge case — one unobserved signal reads HUMAN and says what to look at

- **GIVEN** a list of gating signal results in which one is unobserved and every other is green
- **WHEN** the list is combined into a verdict
- **THEN** the verdict is `HUMAN`
- **AND** the unobserved signal is named as driving with the reason it could not be observed
- **AND** each driving signal is marked as needing a person, needing more evidence, or needing a fix, so a reader can tell which ones no evidence will lift

### Requirement: A flag SHALL lower the score and SHALL NOT move a band

A signal MAY carry one or more flags from a fixed, published list. A flag SHALL be reported with the signal and SHALL make the signal count as not clean for the score. A flag SHALL NOT change the signal's band or the verdict.

Rationale: "no e2e suite exists here" is something a reader should know and the number should reflect, and it is not a reason to stop a merge.

#### Scenario: Happy path — a flagged green signal still reads MERGE

- **GIVEN** a list of gating signal results in which every result is green and one of them carries a flag
- **WHEN** the list is combined into a verdict
- **THEN** the verdict is `MERGE`
- **AND** the score is strictly below the score of the same list with the flag removed
- **AND** the flag is reported beside its signal

#### Scenario: Failure — a flag is not promoted to amber

- **GIVEN** a list of gating signal results that would read `MERGE` except for a flag on one green result
- **WHEN** the list is combined into a verdict
- **THEN** the verdict is `MERGE` and not `HUMAN`
- **AND** an implementation that turned the flag into an amber band would violate this requirement

#### Scenario: Edge case — a flag outside the published list

- **GIVEN** a signal result that carries a flag name not in the published flag list
- **WHEN** the merge confidence is assessed
- **THEN** the assessment is rejected as a defect rather than carrying the unknown flag
- **AND** the published flag list is the only vocabulary a reader has to match against

### Requirement: The score SHALL be bounded by the worst band and ordered by clean signals

The score SHALL be an integer from 0 to 100. Green, amber and red SHALL each have a published ceiling, and a band's floor SHALL be one above the next-worse band's ceiling, with red's floor at 0. An unobserved worst band SHALL take amber's ceiling and floor, as it takes amber's rank for the verdict. The score SHALL equal the worst band's floor plus the band's width scaled by the share of gating signals that are green and carry no flag, rounded to the nearest integer.

Rationale: a bounded score and a verdict agree by construction, and two results in the same band still sort.

#### Scenario: Happy path — every signal clean scores the green ceiling

- **GIVEN** a list of gating signal results in which every result is green with no flag
- **WHEN** the list is combined into a score
- **THEN** the score equals the published green ceiling exactly

#### Scenario: Failure — a red signal cannot score above the red ceiling

- **GIVEN** a list of gating signal results in which one is red and every other is green with no flag
- **WHEN** the list is combined into a score
- **THEN** the score is at most the published red ceiling
- **AND** it is strictly below the amber floor

#### Scenario: Edge case — same band, one more flag, strictly lower score

- **GIVEN** two lists of gating signal results whose worst band is amber, identical except that one carries one additional flag on a green result
- **WHEN** both are combined into a score
- **THEN** the list with the additional flag scores strictly lower
- **AND** both scores lie between the amber floor and the amber ceiling inclusive
- **AND** a list in which no gating signal is clean scores exactly its band's floor

#### Scenario: Edge case — an unobserved worst band scores in the amber range

- **GIVEN** a list of gating signal results whose worst band is unobserved, with no amber and no red
- **WHEN** the list is combined into a score
- **THEN** the score lies between the amber floor and the amber ceiling inclusive
- **AND** it equals the score of the same list with each unobserved result replaced by an amber one

### Requirement: A missing result SHALL be unobserved; a missing tool SHALL be a flag; a missing unit suite SHALL never be a flag

A signal whose evidence the run should have produced and did not SHALL resolve unobserved. A signal whose evidence depends on a tool the repository has not set up SHALL resolve green with a flag naming the absent tool. The unit suite is the exception: with no test profile, or a profile with no unit command, it SHALL resolve amber, never green and never a flag. The type check is a tool a repository may not have, and SHALL be treated as one.

Rationale: the verify planner already separates "not configured" from "budget exceeded"; the merge verdict reads that distinction rather than inventing one, and a repository is not punished for tooling it never claimed to have, except where the ship loop itself refuses to run without it. The ship loop refuses to run unattended without a test profile; it runs without a type checker, and many repositories, this one included, have none.

#### Scenario: Happy path — coverage not configured is green with a flag

- **GIVEN** a coverage input that declares coverage is not configured
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is green
- **AND** it carries the flag naming the absent coverage tool

#### Scenario: Failure — a planned verification with no result is unobserved

- **GIVEN** a verification input in which a planned blocking step has no result
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is unobserved with a reason naming the step
- **AND** the verdict is `HUMAN` or worse

#### Scenario: Edge case — no test profile is amber, not a flag

- **GIVEN** a verification input in which the unit suite was skipped because the repository has no test profile
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber
- **AND** it does not carry a flag, and the verdict is `HUMAN` or worse

#### Scenario: Edge case — no type-check command is a flag, not amber

- **GIVEN** a verification input in which the unit suite passed and the type check was skipped because the profile names no type-check command
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green
- **AND** it carries the flag naming the absent type checker

### Requirement: The review signals SHALL read the adjudicated review

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker, or a surviving finding whose severity is outside the published severities, SHALL make the blockers signal (`review.blockers`) red. Surviving warnings above the published cap SHALL make the warnings signal (`review.warnings`) amber, marked as needing a fix. An absent review input SHALL make the ran signal (`review.ran`) amber with the reason that no review ran. A dimension record showing that the review did not complete, that a selected dimension could not run with its rubric, or that a selected dimension is recorded neither as run nor as unable to run, SHALL make the ran signal amber. A selected `domain` or `blast-radius` dimension recorded as skipped SHALL count as accounted for, because those two are skipped for want of a graph and the record says so; a skip recorded under any other name SHALL NOT, so a selected `security` dimension that is only skipped still reads amber. A review input that records no dimension selection SHALL be green on the ran signal with a flag, because the counts prove a review happened and only the record of its coverage is missing. A dimension record that names the `domain` dimension as skipped for want of a graph SHALL leave the ran signal's band as the rest of the record decides it and SHALL add the `domain-skipped` flag; one that names the `blast-radius` dimension as skipped for want of a graph SHALL likewise leave the band and SHALL add the `blast-radius-skipped` flag. The dimension record MAY come from the run's review step or from the record the review command's `--dimensions` option stamps, and the ran signal SHALL read both alike. A review in which a refutation was refused for citing nothing, or in which a surviving blocker or warning had fewer verdicts than the published floor, SHALL be amber on the adversarial signal (`review.adversarial`), marked as needing more evidence. A review from which the quality band removed a blocker, or a finding whose severity is outside the published severities, SHALL be amber on the adversarial signal, marked as needing a person, with the finding named in the evidence: the skeptics' vote kept it, and it is in no surviving list for the blockers signal to read. A warning or a suggestion the band removed SHALL NOT move the signal, and neither SHALL a review input that carries no list of what the band removed.

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

#### Scenario: Edge case — the record the review skill writes reads green, and a skipped security review does not

- **GIVEN** the dimension record exactly as `skills/review-code/SKILL.md` shows it, which selects `blast-radius`, leaves it out of `ran` and names it under `skipped` with its reason, stamped by `interlock review --dimensions … --head H --out <file>`; and a record that selects `security`, leaves it out of `ran` and names it under `skipped`
- **WHEN** `interlock merge-confidence --review <file>` assesses the first for head H, and the second is assessed alike
- **THEN** the first reads the ran signal green with the `blast-radius-skipped` flag
- **AND** the second reads the ran signal amber, naming `security` as a selected dimension with no record that it ran

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

### Requirement: The verification signals SHALL read the final verification verdict, one band per outcome

The suite signal (`verify.suite`) SHALL read the unit suite's and the type check's own results in the final verification verdict, whatever that verdict's halting set, and SHALL take the worse of the two. For each of them:

- a failure SHALL be red, including a type check that failed at the final gate, where the ship loop reports it without halting;
- unit failures the verdict excused as pre-existing SHALL be amber, marked as needing a person;
- a skip because every changed path is documentation SHALL be green with the docs-only flag;
- a unit skip for want of a test profile or a unit command SHALL be amber with no flag;
- a type-check skip for want of a type-check command SHALL be green with the flag naming the absent type checker;
- a skip because the verification budget was spent, and a planned step with no reported result, SHALL be unobserved;
- any other skip reason SHALL be amber;
- a pass SHALL be green.

The end-to-end signal (`verify.e2e`) SHALL be amber, marked as needing a fix, when the suite ran and failed; green with the flag naming the absent suite when the repository has no enabled end-to-end suite or the caller did not request one; green with no flag when it was skipped because every changed path is documentation; unobserved when the budget was spent or a planned run has no reported result; and green when it passed. A verification verdict that is not from the final gate SHALL make both verification signals unobserved.

Rationale: the final gate declines to halt on a failed type check because the ship loop publishes an exhaustive list of hard halts, and that is a statement about whether the run stops, not about whether the result can be merged.

#### Scenario: Happy path — a green final verdict with no e2e suite

- **GIVEN** a final verification verdict in which the unit suite and type check passed and end-to-end was skipped as not configured
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green with no flag
- **AND** the end-to-end signal is green with the flag naming the absent suite

#### Scenario: Failure — a red unit suite is red

- **GIVEN** a final verification verdict that halted on the unit suite
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red and the verdict is `BLOCK`

#### Scenario: Failure — a type check that failed at the final gate is red

- **GIVEN** a final verification verdict that did not halt, in which the unit suite passed and the type check failed, carrying the banner that the type check failed and is non-blocking at the final gate
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red and the verdict is `BLOCK`
- **AND** the evidence names the type-check failure

#### Scenario: Edge case — an end-to-end suite that ran and failed is amber, not red

- **GIVEN** a final verification verdict in which the unit suite passed and the end-to-end suite ran and failed
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green and the end-to-end signal is amber
- **AND** the verdict is `HUMAN`, with the end-to-end failure named as needing a fix

#### Scenario: Edge case — pre-existing unit failures are amber, not green and not red

- **GIVEN** a final verification verdict whose unit failures were excused as pre-existing
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber, marked as needing a person
- **AND** its reason says the failures are pre-existing

#### Scenario: Edge case — each skip reason resolves to one band

- **GIVEN** five final verification verdicts: one skipping every kind because the changed paths are documentation, one skipping the unit suite for want of a test profile, one skipping the unit suite for want of a unit command, one skipping the unit suite because the verification budget was spent, and one whose plan held a type-check step for which no result was reported
- **WHEN** each is assessed
- **THEN** the first reads the suite signal green with the docs-only flag
- **AND** the second and third read it amber with no flag
- **AND** the fourth and fifth read it unobserved, each with a reason naming the kind

### Requirement: The coverage signal SHALL judge the change against the base, not against an absolute bar

The coverage signal (`verify.coverage`) SHALL be green when a base figure is present, its commit is an ancestor of the head, and the head total is below the base total by no more than the published decline tolerance; it SHALL be amber, marked as needing a fix, when the head total is further below. With no base figure it SHALL be green, carrying a flag that no baseline exists, when the changed-line coverage is at or above the published patch floor, and amber, marked as needing a fix, below it. A change with fewer changed lines than the published small-change floor SHALL be green with the floor named, whatever the figures; a change with exactly the floor SHALL be judged. It SHALL be unobserved when a base figure is present but its commit is not an ancestor of the head. It SHALL be green with a flag when coverage is not configured, whether the coverage input says so or, with no coverage input, the final verification verdict skipped coverage as not configured.

Rationale: a repository is judged on what the change did to coverage, not on where coverage stood before the change, which is the comparison every coverage status product makes by default.

#### Scenario: Happy path — a decline inside the tolerance is green

- **GIVEN** a coverage input whose base commit is an ancestor of the head and whose head total is below the base total by less than the published tolerance
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is green
- **AND** the evidence states both totals and the tolerance by name

#### Scenario: Failure — a decline beyond the tolerance is amber and needs a fix

- **GIVEN** a coverage input whose head total is below the base total by more than the published tolerance
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is amber with both totals in the evidence
- **AND** the verdict is `HUMAN`, with the decline marked as needing a fix, because both figures were observed and no further evidence would lift it

#### Scenario: Edge case — a baseline from another branch, and a tiny change

- **GIVEN** one coverage input whose base commit is not an ancestor of the head, and another with no base figure and fewer changed lines than the published small-change floor
- **WHEN** both are assessed
- **THEN** the first reads the coverage signal unobserved with the reason that the baseline is not an ancestor
- **AND** the second reads the coverage signal green with the small-change floor named

#### Scenario: Edge case — each boundary falls on the side the requirement names

- **GIVEN** three coverage inputs: one whose head total is below the base total by exactly the published tolerance; one with no base figure whose changed-line coverage equals the published patch floor; and one with no base figure whose changed lines equal the small-change floor and whose changed-line coverage is below the patch floor
- **WHEN** each is assessed
- **THEN** the first reads the coverage signal green
- **AND** the second reads it green with the flag that no baseline exists
- **AND** the third reads it amber, because a change at the small-change floor is judged and not exempt

### Requirement: The pipeline signal SHALL read the platform's checks for the head commit

The pipeline input SHALL carry the commit it describes and one entry per check with its name, state and whether the platform requires it. A failed required check SHALL make the pipeline signal (`ci.pipeline`) red. A failed non-required check SHALL make it amber. A pending check SHALL make it unobserved. An input whose commit is not the head SHALL make it unobserved even when the input records a failed required check, and the evidence SHALL name that check. An input whose check list is present and empty SHALL be green with a flag. An absent input SHALL be unobserved.

An input that is not well-formed SHALL never read as an input with no checks. The command SHALL accept a `--pipeline` file only when it is well-formed by the one rule `lib/pipeline.mjs` publishes: an object carrying a string `sha` and a list `checks` in which every entry is an object with a non-empty string `name`, a `state` that is one of `pass`, `fail`, `pending` or `skipped`, and a boolean `required`; an `excluded` list of strings MAY be present. Any other file SHALL exit 1 with the fault named on standard error and nothing on standard output, as an unreadable input does. The assessment itself SHALL read a pipeline whose `checks` is not a list, or holds an entry that is not an object, as unobserved, naming the fault, and SHALL read an entry whose state is none of the four as amber, marked as needing more evidence.

When the input records excluded check names, the pipeline signal SHALL name each one in its evidence, whatever band it reads.

Rationale: a check that failed on another commit says nothing certain about the head, which may have fixed it; reading it red would block on stale evidence, and dropping it from the evidence would hide it. An absent or misspelt list and an empty list are different statements: read alike, a file whose only fault is a misspelt key hides a failed required check behind a green signal. A check the caller left out has to stay visible wherever the verdict is shown.

#### Scenario: Happy path — every check passed

- **GIVEN** a pipeline input for the head commit in which every check passed or was skipped
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is green with no flag

#### Scenario: Failure — a failed required check is red

- **GIVEN** a pipeline input for the head commit in which a required check failed
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is red and the verdict is `BLOCK`
- **AND** the evidence names the failed check

#### Scenario: Edge case — a failed optional check, a pending check, and a stale commit

- **GIVEN** three pipeline inputs: one for the head commit with a failed non-required check, one for the head commit with a pending check, and one for a different commit with every check passed
- **WHEN** each is assessed
- **THEN** the first reads the pipeline signal amber
- **AND** the second reads it unobserved with the reason that a check is pending
- **AND** the third reads it unobserved with the reason that the input describes another commit

#### Scenario: Edge case — a failed required check on another commit is unobserved, not red

- **GIVEN** a pipeline input for a different commit in which a required check failed
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is unobserved with the reason that the input describes another commit
- **AND** the evidence names the failed required check, and the verdict is not `BLOCK` on its account

#### Scenario: Failure — a misspelt key over a failed required check never reads green

- **GIVEN** a pipeline file for the head commit that carries a failed required check under the key `check`, and no `checks`
- **WHEN** `interlock merge-confidence --pipeline <file>` runs
- **THEN** it exits 1, standard error says the file carries no `checks` list, and no verdict is printed

#### Scenario: Failure — the assessment reads a misshapen list as unobserved

- **GIVEN** an assessment input whose pipeline carries the head commit and a `checks` value that is a string
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is unobserved with a reason saying the input is not well-formed
- **AND** the verdict is not `MERGE`

#### Scenario: Edge case — an explicit empty list, and a state outside the four

- **GIVEN** a pipeline file for the head commit whose `checks` is an empty list; a pipeline file with an entry whose state is `SUCCESS`; and an assessment input holding that same entry
- **WHEN** the command is given each file, and the assessment is given the input
- **THEN** the first reads the pipeline signal green with the flag `no-pipeline`
- **AND** the second exits 1 naming the entry and the four states the file may carry
- **AND** the assessment reads the pipeline signal amber, marked as needing more evidence

#### Scenario: Edge case — an excluded check is named beside a green signal

- **GIVEN** a pipeline input for the head commit in which every check passed and `excluded` holds `merge-gate`, and another with no `excluded` list
- **WHEN** each is assessed
- **THEN** the first reads the pipeline signal green and its evidence says `merge-gate` was excluded by the caller
- **AND** the second carries no exclusion line

### Requirement: The delta-conformance signal SHALL read the handoff's answers against the command's own checklist

The delta-conformance signal (`conformance.delta`) SHALL compare the handoff's counts of scenarios checked and scenarios unconfirmed with the number of scenarios in the change's delta specs, which the command SHALL count itself. A count of required verdicts carried in the handoff input SHALL be ignored, so a caller cannot shrink the denominator. The signal SHALL be:

- amber, marked as needing more evidence, when the checklist cannot be built, with the checklist's own reason;
- amber, marked as needing a fix, when the delta specs carry no scenario and a changed path is coverable source, because the change promised no behaviour for code it changed;
- green when the delta specs carry no scenario and no changed path is coverable source;
- unobserved when the delta specs carry scenarios and no handoff input is given;
- amber, marked as needing more evidence, when any scenario is unconfirmed or the number checked differs from the number the command counted;
- green when every counted scenario was checked and none is unconfirmed.

Rationale: an unanswered checklist is not a pass, and the conformance module says so; the merge verdict is where an unconfirmed scenario costs something.

#### Scenario: Happy path — every scenario confirmed is green

- **GIVEN** a change whose delta specs carry five scenarios, and a handoff input that checked five and left none unconfirmed
- **WHEN** the merge confidence is assessed
- **THEN** the delta-conformance signal is green
- **AND** the evidence states the number checked and the number the command counted

#### Scenario: Failure — an unconfirmed scenario is amber

- **GIVEN** a change whose delta specs carry five scenarios, and a handoff input that checked five and left one unconfirmed
- **WHEN** the merge confidence is assessed
- **THEN** the delta-conformance signal is amber, marked as needing more evidence
- **AND** the evidence carries both counts, and the verdict is `HUMAN` or worse

#### Scenario: Edge case — no checklist, and a handoff that claims a smaller denominator

- **GIVEN** one assessment whose change has no artifacts on disk, and another whose delta specs carry five scenarios while the handoff input checked three, left none unconfirmed, and states that three verdicts were required
- **WHEN** both are assessed
- **THEN** the first reads the delta-conformance signal amber with the reason the checklist could not be built
- **AND** the second reads it amber with the reason that three of five scenarios were checked, because the stated three is ignored

#### Scenario: Edge case — no delta scenarios, with and without changed source

- **GIVEN** two changes whose delta specs carry no scenario, one with a changed path that is coverable source and one whose changed paths are all documentation
- **WHEN** both are assessed with no handoff input
- **THEN** the first reads the delta-conformance signal amber, marked as needing a fix, with the reason that the change promised no behaviour for the source it changed
- **AND** the second reads it green, because there is nothing to confirm

### Requirement: The change-shape signals SHALL read the diff, the ledger, drift and the run

The diff-shape signal (`diff.shape`) SHALL be green when changed lines and changed files are both at or under their published caps, amber above either, and unobserved when no base is given to diff against, or when the base is the head commit or a descendant of it, because that diff is empty by construction and says nothing about the change. The open-decisions signal (`decisions.open`) SHALL be amber, marked as needing a person, when the ledger holds a needs-human row, an invalid row, or is missing. The drift signal (`drift.stale`) SHALL be amber, marked as needing a fix, when a living spec cites a file this change removed, and amber, marked as needing a person, when another change that is complete and unarchived has delta specs for a capability this change also has delta specs for. The change under assessment SHALL NOT count against itself; with no change under assessment, every complete, unarchived change SHALL count. Aging specs and changed files that no spec describes SHALL NOT move the drift signal. When the stale-citation check could not run because no usable graph exists, the drift signal SHALL carry a flag with the reason, and SHALL NOT read the empty result as clean. The run-integrity signal (`run.integrity`) SHALL be amber, marked as needing a person, when the run halted, its trajectory is incomplete, a stage marker was not published, a handoff report was rejected, a permission prompt or auto-mode denial occurred, or the run left tasks of the change unticked, and unobserved when no run record is given.

Rationale: drift on a pull request is about what this change did to the specs. A broken citation elsewhere, or a finished change in an unrelated capability, is the repository's backlog, which `interlock drift` already reports; counting it would hold every pull request at `HUMAN` for a reason no one on it can act on. A run that left a task unticked did not finish the change, and whether what remains matters is a person's call.

#### Scenario: Happy path — a small on-ledger change with a clean run

- **GIVEN** a diff under both caps, a ledger with only agent-resolved rows, no drift findings, and a run record with no degradation and no task left unticked
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape, open-decisions, drift and run-integrity signals are all green

#### Scenario: Failure — an open product question is amber and needs a person

- **GIVEN** a ledger with one needs-human row
- **WHEN** the merge confidence is assessed
- **THEN** the open-decisions signal is amber, marked as needing a person
- **AND** the evidence carries the row's identifier and question

#### Scenario: Failure — a removed cited file, and a competing unarchived change, are amber

- **GIVEN** one assessment whose changed paths include a file that a living spec cites and that no longer exists, and another in which a different, complete and unarchived change has delta specs for a capability the change under assessment also has delta specs for
- **WHEN** both are assessed
- **THEN** the first reads the drift signal amber, marked as needing a fix, naming the spec and the file
- **AND** the second reads it amber, marked as needing a person, naming the other change and the shared capability

#### Scenario: Failure — a run that left tasks unticked needs a person

- **GIVEN** a run record with no other degradation that records two tasks left unticked
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is amber, marked as needing a person, and its reason states the two tasks
- **AND** the verdict is `HUMAN` or worse however clean the rest of the input is

#### Scenario: Edge case — no base to diff against, and a missing ledger

- **GIVEN** an assessment given no base reference and a change with no ledger file
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is unobserved with the reason that no base was given
- **AND** the open-decisions signal is amber with the reason that the ledger is missing, not unobserved, because a missing ledger is a failure of the audit

#### Scenario: Edge case — no graph, another capability, and the change itself

- **GIVEN** three assessments with no other drift finding: one in a repository with no graph built; one in which a complete, unarchived change has delta specs only for capabilities the change under assessment does not touch; and one in which the change under assessment is itself complete and unarchived
- **WHEN** each is assessed
- **THEN** the first reads the drift signal green with the flag that no graph exists and the reason the stale-citation check did not run
- **AND** the second and third read it green with no flag

### Requirement: The command SHALL run offline, treat every absent input as unobserved, and exit on the verdict

The merge-confidence command SHALL read only the repository, the files the caller names and the published limits. It SHALL NOT call a hosting platform or the network. A signal whose input the caller does not supply SHALL resolve unobserved with the reason that the input was not given, unless a fact the command gathers from the repository itself decides the signal first, as the risk class, the ledger, the conformance checklist, the living list, drift and, with a base reference, the review policy committed at the base and the spec-coverage facts do. With a base reference, every path the diff between the base and the head reports SHALL be assessed as a changed path whether or not the caller named it, and the paths the caller did not name SHALL be listed on standard error. When the assessment completes, the command SHALL exit non-zero if and only if the verdict is `BLOCK`, and, when asked to require a merge, if and only if the verdict is not `MERGE`. An input the command cannot read or parse SHALL end it before any assessment, with exit 1, the reason on standard error and no verdict on standard output, as the gate command does; the usage text SHALL say that exit 1 alone does not tell a blocked change from unreadable input, and that a verdict on standard output does.

#### Scenario: Happy path — a full set of inputs on a clean change

- **GIVEN** a change name, changed paths, a base reference whose `REVIEW.md` lists no changed path, a living list whose requirements were all confirmed, no added source file left unnamed, a run record with no degradation, and review, verification, handoff, pipeline and coverage inputs that all resolve green
- **WHEN** the command runs with JSON output
- **THEN** it prints the verdict, the score, the driving signals, the flags and every signal entry
- **AND** the verdict is `MERGE`, and the output lists no driving signal
- **AND** it exits zero

#### Scenario: Failure — a blocking verdict exits non-zero, and a required merge turns HUMAN into non-zero

- **GIVEN** inputs that resolve to `BLOCK`, and separately inputs that resolve to `HUMAN`
- **WHEN** the command runs on the first, and on the second with the require-merge option
- **THEN** both exit non-zero
- **AND** the second without the require-merge option exits zero, because a change that needs a person is not a failed command

#### Scenario: Edge case — only changed paths given

- **GIVEN** the command run with changed paths and no other input or base reference
- **WHEN** it runs
- **THEN** every signal that reads only a caller-supplied input resolves unobserved, each with the reason that its input was not given
- **AND** the human-paths and spec-coverage signals resolve unobserved with the reason that no base was given, and the run-integrity signal with the reason that no run record was given
- **AND** the verdict is `HUMAN` and the exit is zero

#### Scenario: Edge case — an unreadable input exits 1 with no verdict

- **GIVEN** a review file that is not valid JSON
- **WHEN** the command runs with JSON output
- **THEN** it exits 1
- **AND** standard output carries no verdict, and standard error names the file

### Requirement: Every threshold the verdict applies SHALL be published by the limits surface and SHALL be cited by name in the output

The band ceilings, the warning cap, the verdict floor per finding, the coverage tolerance and floors, and the diff caps SHALL be read from the published limits definition. The output's reasons SHALL cite the limit's name beside its value. No threshold SHALL be restated in a skill, a prompt or a document as the rule itself.

#### Scenario: Happy path — a reason cites the cap it applied

- **GIVEN** a review input with surviving warnings above the cap
- **WHEN** the merge confidence is assessed
- **THEN** the warnings signal is amber
- **AND** its reason names the warning cap and its published value

#### Scenario: Failure — a literal threshold in the decision is detected

- **GIVEN** the decision module and its tests
- **WHEN** they are checked for a literal equal to a published merge threshold
- **THEN** the check fails naming the site, and the expected value in every test is read from the published limits rather than written as a number

#### Scenario: Edge case — the published ceilings change and the score follows

- **GIVEN** the published band ceilings altered
- **WHEN** the same input is assessed again
- **THEN** the score moves with the altered ceilings
- **AND** the verdict is unchanged, because bands and not ceilings decide it

### Requirement: The human-paths signal SHALL read the review policy committed at the base

With a base reference, the human-paths signal (`policy.humanPaths`) SHALL read the always-human-review paths from the `REVIEW.md` committed at that reference. It SHALL be amber, marked as needing a person, when a changed path lies under a listed path on the canonical path form, naming each such path and the listed path it falls under; when the `REVIEW.md` in the working tree differs from the committed copy, ignoring line-ending differences, naming the file, because a change to review policy is a person's call; and when the committed always-human-review section could not be read in full, naming the problem. It SHALL be green when none of these holds, including when the reference has no `REVIEW.md`. It SHALL be unobserved, with the reason that no base was given, when the command has no base reference. A difference in `REVIEW.md` SHALL NOT move the run-integrity signal.

Rationale: a path the repository has declared as needing a person cannot be cleared by evidence, and reading the declaration from the base keeps the change under assessment from removing its own paths from the list.

#### Scenario: Happy path — no listed path touched and an unchanged policy

- **GIVEN** a base whose `REVIEW.md` lists `lib/release/` as always-human-review, changed paths outside it, and a working-tree `REVIEW.md` identical to the base copy
- **WHEN** the merge confidence is assessed with that base
- **THEN** the human-paths signal is green with no flag
- **AND** its evidence names the reference the list was read from

#### Scenario: Failure — a touched listed path needs a person

- **GIVEN** a base whose `REVIEW.md` lists `lib/release/`, and a changed path `lib/release/publish.mjs`, with every other signal green
- **WHEN** the merge confidence is assessed with that base
- **THEN** the human-paths signal is amber, marked as needing a person, naming `lib/release/publish.mjs` and `lib/release/`
- **AND** the verdict is `HUMAN` however clean the rest of the input is

#### Scenario: Failure — a change that edits the policy needs a person

- **GIVEN** a working-tree `REVIEW.md` that removes `lib/release/` from the base copy's always-human-review list, and a changed path `lib/release/publish.mjs`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the human-paths signal is amber, marked as needing a person, naming both the listed path from the base and the edited `REVIEW.md`
- **AND** the run-integrity signal is not moved by the edit

#### Scenario: Edge case — canonical matching, an absent base policy, and no base

- **GIVEN** one base whose list spells the path `./lib/release` and a changed path `lib/release/a.mjs`; another base with no `REVIEW.md` and no working-tree copy; and an assessment with no base reference
- **WHEN** each is assessed
- **THEN** the first reads the human-paths signal amber, because both spellings name the same canonical path, while a changed path `lib/releasex/a.mjs` would not match
- **AND** the second reads it green
- **AND** the third reads it unobserved with the reason that no base was given

### Requirement: The living-conformance signal SHALL read the handoff's answers against the command's own list of living requirements

The living-conformance signal (`conformance.living`) SHALL compare the handoff's counts of living requirements checked and living requirements unconfirmed with the number of entries in the living list, which the command SHALL count itself. A count of required answers carried in the handoff input SHALL be ignored, so a caller cannot shrink the denominator. The signal SHALL be:

- unobserved when no living list was gathered, with that reason;
- green with the `no-graph` flag when the list was skipped because no graph exists and the change declares no capability;
- green when the list holds no entry, because there is nothing to confirm;
- unobserved when the list holds entries and no handoff input is given;
- amber, marked as needing more evidence, when the handoff input carries neither living count, when any living requirement is unconfirmed, or when the number checked differs from the number the command counted;
- green when every listed requirement was checked and none is unconfirmed.

A list built from declared capabilities only, for want of a graph, SHALL add the `no-graph` flag to whichever band the answers decide. A list from which the bound left requirements out SHALL add the `requirements-omitted` flag, and its evidence SHALL state how many were asked and how many were left out. Neither flag SHALL move the band.

Rationale: an unanswered list is not a pass, and the merge verdict is where an unconfirmed requirement costs something. A list the tool itself cut short is something a reader should know and nobody on the change can act on, which is what a flag is for.

#### Scenario: Happy path — every living requirement confirmed is green

- **GIVEN** a living list of four entries, built with a graph and cut by no bound, and a handoff input that checked four and left none unconfirmed
- **WHEN** the merge confidence is assessed
- **THEN** the living-conformance signal is green with no flag
- **AND** the evidence states the number checked and the number the command counted

#### Scenario: Failure — an unconfirmed living requirement is amber

- **GIVEN** a living list of four entries and a handoff input that checked four and left one unconfirmed
- **WHEN** the merge confidence is assessed
- **THEN** the living-conformance signal is amber, marked as needing more evidence
- **AND** the evidence carries both counts, and the verdict is `HUMAN` or worse

#### Scenario: Failure — a handoff that claims a smaller denominator

- **GIVEN** a living list of four entries and a handoff input that checked two, left none unconfirmed, and states that two answers were required
- **WHEN** the merge confidence is assessed
- **THEN** the living-conformance signal is amber, with the reason that two of four living requirements were checked
- **AND** the stated two is ignored

#### Scenario: Edge case — no graph, a graph that links nothing, and a list cut by the bound

- **GIVEN** three assessments: one whose living list was skipped for want of a graph and of any declared capability; one whose list is empty because the graph links none of the changed paths; and one whose four listed requirements were all confirmed while the bound left two more out
- **WHEN** each is assessed
- **THEN** the first reads the living-conformance signal green with the `no-graph` flag
- **AND** the second reads it green with no flag
- **AND** the third reads it green with the `requirements-omitted` flag, its evidence stating four asked and two left out, and scores below the same input with nothing left out

#### Scenario: Edge case — a cut list keeps its flag when the answers read amber

- **GIVEN** a living list of four entries from which the bound left two more out, and a handoff input that checked four and left one unconfirmed
- **WHEN** the merge confidence is assessed
- **THEN** the living-conformance signal is amber with the `requirements-omitted` flag
- **AND** its evidence states four asked and two left out and names both

#### Scenario: Edge case — a list nobody answered, and a list nobody gathered

- **GIVEN** one assessment whose living list holds three entries with no handoff input, and another with no living list at all
- **WHEN** both are assessed
- **THEN** each reads the living-conformance signal unobserved
- **AND** the first's reason says the listed requirements have no answers, and the second's that the list was not gathered

### Requirement: The spec-coverage signal SHALL judge the source files a change adds, and SHALL flag, never band, the ones it inherited

The spec-coverage signal (`spec.coverage`) SHALL read which files the diff between the base and the head adds, edits and deletes. A file SHALL count as named when its repository-relative path, on the canonical path form, is mentioned in a living spec as the head has it or in one of the change's own delta specs. A mention SHALL be recognised by the same rule the graph applies when it links a spec to a file, so the two cannot disagree about what a mention is. Only coverable source files SHALL be judged: a test, a configuration file or a document SHALL NOT move the signal. The signal SHALL NOT read the graph, and SHALL be judged the same in a repository that has none.

The signal SHALL be:

- amber, marked as needing a fix, when a coverable source file the diff adds is named by no living spec and no delta spec, naming each such file; a renamed file's new path counts as added;
- amber, marked as needing a fix, when a coverable source file that exists at the base and at the head was named at the base by a living spec the diff changed or deleted and is named by nothing at the head, naming the file and the spec;
- green otherwise.

A coverable source file the diff edits that no spec names and that lost no spec in this diff SHALL NOT move the band. It SHALL raise the `legacy-unspecced` flag, and the evidence SHALL state how many such files the diff edits and, for the whole repository at the head, how many tracked coverable source files are named out of how many exist.

The signal SHALL be unobserved, with the reason, when no base is given, because an added file cannot be told from an edited one without a diff, and when the base is the head commit or a descendant of it, because that diff is empty by construction.

Rationale: a repository still being specced is judged on what a change adds, not on what it inherited, and the change's own delta specs are the living specs the archive will write. The facts are computed in `lib/spec-coverage.mjs` from text alone, so a job with nothing but git reads the same band a developer's machine does.

#### Scenario: Happy path — an added file its own delta spec names is green

- **GIVEN** a diff that adds `lib/new.mjs` and `test/spine/new.test.mjs`, and a change whose delta spec mentions `lib/new.mjs`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the spec-coverage signal is green with no flag
- **AND** the evidence says the added source file is named by the change's delta specs, and the test file is not among the files judged

#### Scenario: Failure — an added source file no spec names is amber

- **GIVEN** a diff that adds `lib/orphan.mjs`, mentioned in no living spec and in none of the change's delta specs
- **WHEN** the merge confidence is assessed with that base
- **THEN** the spec-coverage signal is amber, marked as needing a fix, naming `lib/orphan.mjs`
- **AND** the verdict is `HUMAN` or worse however clean the rest of the input is

#### Scenario: Failure — a kept file loses the only spec that named it

- **GIVEN** a base in which one living spec mentions `lib/kept.mjs` and no other spec does, and a diff that deletes that spec and leaves `lib/kept.mjs` in place
- **WHEN** the merge confidence is assessed with that base
- **THEN** the spec-coverage signal is amber, marked as needing a fix, naming `lib/kept.mjs` and the deleted spec
- **AND** the same diff with a delta spec that mentions `lib/kept.mjs` reads green

#### Scenario: Edge case — an edited file that was never named is a flag with the repository's figure

- **GIVEN** a diff that edits `lib/old.mjs`, which no spec has ever mentioned, in a repository where 20 of 60 tracked coverable source files are named
- **WHEN** the merge confidence is assessed with that base
- **THEN** the spec-coverage signal is green with the `legacy-unspecced` flag
- **AND** the evidence states one edited file and 20 of 60, and the score is below the same input without the edit

#### Scenario: Edge case — no base, an empty diff, and no graph

- **GIVEN** three assessments: one with no base reference; one whose base is the head commit; and one with a base, in a repository with no graph, whose diff adds a source file a delta spec names
- **WHEN** each is assessed
- **THEN** the first and second read the spec-coverage signal unobserved, each with its reason
- **AND** the third reads it green with no flag, because the signal does not read the graph

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

### Requirement: The assessment's input SHALL be gathered the same way for the command and for a run's close

The command and a ship run's close SHALL obtain the assessment's input from one gather, so that the same repository state and the same supplied inputs yield the same signal results from either. The gather SHALL read from the repository what the repository can say for itself: the change and its artifacts, the decision ledger, the delta checklist, the living list, drift, and, with a base, the diff shape, the review policy committed at the base and the spec-coverage facts. A fact the gather could not read SHALL leave its signal unobserved or as the signal's own rule decides, never green by default, and SHALL be reported with its reason: by the command on standard error, and by a run's close in its degradation block. A missing means of reaching version control SHALL be such a fact and SHALL NOT end the caller.

Rationale: two assemblies of one input drift apart, and the drift would show as two verdicts for one change. The gather is `lib/merge-evidence.mjs`.

#### Scenario: Happy path — the command and the close agree on the same facts

- **GIVEN** one repository state, one change, one base and the same review, verification, handoff and run-record inputs
- **WHEN** the input is gathered for the command and for a run's close
- **THEN** every gating signal resolves to the same band, flags and reason in both

#### Scenario: Failure — a fact that could not be read is spoken and is not green

- **GIVEN** a gather that cannot read the diff against the base
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape and spec-coverage signals are unobserved, each with the reason
- **AND** the command names what it could not read on standard error, and a run's close names it in the degradation block

#### Scenario: Edge case — no means of reaching version control

- **GIVEN** a caller that supplies no way to read the diff, the tracked files or a file at the base
- **WHEN** the input is gathered
- **THEN** the gather completes, and each signal that needed one of them is unobserved with that reason
- **AND** the signals that read only the working tree are unaffected

### Requirement: Every registered signal SHALL appear in the output in a fixed order, and every gating signal SHALL have a producer

The output SHALL carry one entry per registered signal, in a fixed order, whatever the input holds. The registered gating signals, in order, SHALL be `review.blockers`, `review.warnings`, `review.ran`, `review.adversarial`, `risk.class`, `verify.suite`, `verify.e2e`, `verify.coverage`, `ci.pipeline`, `conformance.delta`, `conformance.living`, `spec.coverage`, `diff.shape`, `decisions.open`, `run.integrity`, `drift.stale` and `policy.humanPaths`, followed by the one informational signal, `plan.fidelity`. An informational signal SHALL be reported with its evidence and no band, and SHALL NOT enter the worst band, the clean share or the driving list. Every registered gating signal SHALL be resolved from the facts its own rule names: no gating signal SHALL resolve unobserved for want of a capability that produces it, and the output SHALL NOT state that a verdict of `MERGE` is unreachable.

Rationale: a signal added silently would change every verdict without anyone seeing the table grow, so the table is declared in full and pinned. The identifiers are the ones the receipt, the merge-request labels and the documentation of later changes name. With every producer in place, a signal reads unobserved only because a fact about this change is missing, which is something a reader can act on.

#### Scenario: Happy path — a full input yields a band for every registered signal

- **GIVEN** an input carrying a fact for every observable signal
- **WHEN** the merge confidence is assessed
- **THEN** the signal identifiers in the output are the registered identifiers, in the registered order
- **AND** every gating entry carries a band, a flag list, evidence and a reason, and the informational entry carries evidence and no band

#### Scenario: Failure — a registered signal absent from the output is a defect

- **GIVEN** an assessment whose output lacks a registered signal identifier
- **WHEN** the output is checked against the registry
- **THEN** the check fails naming the missing identifier

#### Scenario: Edge case — a clean input reads MERGE, and nothing says it cannot

- **GIVEN** an input in which every gating signal has the facts it reads and each resolves green
- **WHEN** the merge confidence is assessed
- **THEN** the `conformance.living` and `spec.coverage` signals are each present and green, and neither reason names an absent producer
- **AND** the verdict is `MERGE`
- **AND** no reason line in the output says that `MERGE` cannot be read

#### Scenario: Edge case — an input that omits the two newest facts reads them unobserved for that reason

- **GIVEN** an input that carries no living list and no spec-coverage facts
- **WHEN** the merge confidence is assessed
- **THEN** the `conformance.living` and `spec.coverage` signals are each unobserved, with the reason that the fact was not gathered
- **AND** neither reason names a capability that has yet to be built

### Requirement: A run's evidence SHALL be used only for the diff that run reviewed

In addition to the conditions under which a run's evidence file is used at all, when a base is given the command SHALL use the file only when the commit the file records as its base equals the merge base of that base and the head. When they differ, when the file records no base, or when the merge base cannot be read, the command SHALL take nothing from the file, SHALL name on standard error the diff the run reviewed and the diff under assessment, and SHALL read each of the run-supplied signals as it would with no file. The command SHALL NOT take a base from the file: with no base given, every signal that needs one SHALL stay unobserved, as it is without an evidence file, so the verdict cannot be `MERGE`.

Rationale: a run reviews the diff from its start commit to the commit it made. A pull request of five commits whose last commit came from a reviewed run is not a reviewed pull request, and the evidence file ends at the same head either way. A base the file supplied would let that same file choose the diff it is judged on.

#### Scenario: Happy path — one run, one pull request

- **GIVEN** a branch whose only commit beyond the target branch is the one a ship run made, that run's evidence file, and `--base` naming the target branch
- **WHEN** the command runs with `--run`
- **THEN** the file is used, and with a passing pipeline input for the head the verdict can read `MERGE`

#### Scenario: Failure — a run that reviewed only the last of several commits

- **GIVEN** a branch five commits beyond the target branch, the evidence file of a run that started at the fourth, and `--base` naming the target branch
- **WHEN** the command runs with `--run`
- **THEN** nothing is taken from the file, and standard error names the run's base and the merge base
- **AND** the review signals read as they would with no file, and the verdict is not `MERGE`

#### Scenario: Failure — no base given never borrows the file's

- **GIVEN** the same five-commit branch and evidence file, a passing pipeline input for the head, and no `--base`
- **WHEN** the command runs with `--run`
- **THEN** the diff shape, the spec coverage and the human-paths signals are unobserved for want of a base
- **AND** the verdict is not `MERGE`, and with `--require-merge` the command exits 1

#### Scenario: Edge case — a target branch that moved on after the run started

- **GIVEN** a one-commit branch and its run's evidence file, and a target branch that gained a commit after the run started
- **WHEN** the command runs with `--run` and `--base` naming the target branch
- **THEN** the file is used, because the merge base is still the commit the run started on

### Requirement: An observation the run record does not carry SHALL be unobserved, never a zero

The run-integrity signal (`run.integrity`) SHALL read the observations a run's close records: whether the run halted, whether its trajectory is complete, and its counts of unpublished stage markers, rejected handoff reports, permission prompts, auto-mode denials and unticked tasks. A recorded degradation SHALL read amber, marked as needing a person, whatever else is absent. With no recorded degradation, a record that lacks any of those observations, or carries one as null, SHALL read unobserved and SHALL name the observations it lacks by the keys the record uses for them. Only a record that carries every observation, none of them a degradation, SHALL read green.

Rationale: a host that observed no permission prompt and a host that could not observe one are different facts. Counting the second as zero is the reading this repository refuses everywhere else it records an observation.

#### Scenario: Happy path — every observation present and clean

- **GIVEN** a run record carrying every observation, with no halt, a complete trajectory and every count zero
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is green

#### Scenario: Failure — an empty record never reads as a clean run

- **GIVEN** a run record that is an empty object
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is unobserved and names every observation as missing
- **AND** the verdict is not `MERGE`

#### Scenario: Edge case — counts the host could not observe, and a degradation beside them

- **GIVEN** two run records whose permission-prompt and auto-mode-denial counts are null: one otherwise clean, one that also records an unticked task
- **WHEN** each is assessed
- **THEN** the first reads the signal unobserved, naming the two counts by their record keys
- **AND** the second reads it amber, marked as needing a person, naming the unticked task

### Requirement: Changed source the coverage report does not list SHALL be flagged, and SHALL NOT pass unremarked

When the coverage input records changed source files the report does not list, a coverage signal that reads green SHALL carry the flag `unmeasured-source`, and its evidence SHALL name the files and state the number of lines the diff adds in them. A coverage signal that reads any other band SHALL state the same in its evidence. The flag SHALL NOT move the band: the small-change floor, the decline rule and the patch rule SHALL each be applied as they are without it. An input that carries neither unreported field SHALL raise no flag, and the evidence SHALL say the input does not state unreported files. A repository with no coverage configured SHALL read green with the flag `no-coverage` and SHALL NOT carry `unmeasured-source`.

Rationale: a report lists the files the tests loaded. A new source file no test loads is absent from it, so its lines count neither for nor against any figure, and the change that most needs the signal read "under the small-change floor" with nothing said. A report cannot tell a file no test loaded from one the project left out of coverage on purpose, so holding the band would give some repositories an amber nothing can lift; a flag is what "green, but you should know" is for.

#### Scenario: Happy path — every changed source file is in the report

- **GIVEN** a coverage input whose unreported list is empty
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal carries no `unmeasured-source` flag

#### Scenario: Failure — a new, unloaded source file is flagged where it used to pass unremarked

- **GIVEN** a coverage input reporting zero measured changed lines and one unreported source file with three hundred added lines
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is green under the small-change floor and carries the flag `unmeasured-source`
- **AND** its evidence names the file and the three hundred lines
- **AND** the score is lower than the same input scores with an empty unreported list

#### Scenario: Edge case — a decline with unreported source, an input from an older producer, and no coverage configured

- **GIVEN** a coverage input whose head total fell beyond the tolerance and which lists one unreported source file; an input that carries neither unreported field; and an input saying coverage is not configured
- **WHEN** each is assessed
- **THEN** the first reads the coverage signal amber, and its evidence names the unreported file
- **AND** the second raises no `unmeasured-source` flag, and its evidence says the input does not state unreported files
- **AND** the third reads green with `no-coverage` and without `unmeasured-source`

### Requirement: The command SHALL name the commit and the base it assessed, and SHALL print the labels for its verdict

The command's JSON output SHALL carry `head`, an object holding the assessed commit as `sha`, or null when the head could not be read; `base`, an object holding the reference given as `ref` and the merge base the diff was taken from as `sha`, with `sha` null when the reference resolves and its merge base cannot be read, or null when no base was assessed; and `labels`, an object holding `verdict` and `score`, each an object with a `name`, a `color` and a `description`, together with `verdictNames`, the three verdict label names, and `scorePrefix`. The verdict label SHALL be `interlock/merge` for `MERGE`, `interlock/human-review` for `HUMAN` and `interlock/blocked` for `BLOCK`. The score label SHALL be `interlock/score-` followed by the integer score with no padding. The label names SHALL be defined in one place in `lib/merge-confidence.mjs` and SHALL NOT be restated as literals by the command or the skill. The text output SHALL print the two label names on one line. Given `--label-names`, the command SHALL print `verdictNames` and `scorePrefix` under `labels` and nothing else, SHALL assess nothing and read no input file and no repository state, and SHALL exit zero, so that a caller whose assessment could not run can still recognise the labels an earlier assessment left; together with `--markdown` it SHALL be a usage error.

Rationale: a label name composed in a skill is a second definition of the verdict's vocabulary; the documentation, the skill and the platform recipes all have to agree with one list.

#### Scenario: Happy path — a human verdict prints its two labels

- **GIVEN** an assessment that reads `HUMAN` with a score of 72 for a readable head commit and a given base
- **WHEN** the command prints JSON
- **THEN** `labels.verdict.name` is `interlock/human-review` and `labels.score.name` is `interlock/score-72`
- **AND** `labels.verdictNames` lists the three verdict names and `labels.scorePrefix` is `interlock/score-`
- **AND** `head.sha` is the head commit, `base.ref` is the reference given and `base.sha` is the merge base

#### Scenario: Failure — an unreadable head is null, not a guess

- **GIVEN** a directory that is not a repository
- **WHEN** the command prints JSON
- **THEN** `head` is null and `base` is null
- **AND** the labels are still printed for the verdict, which is not `MERGE`

#### Scenario: Edge case — the score is written as the integer it is

- **GIVEN** two assessments, one whose score has three digits and one whose score has fewer
- **WHEN** the labels are printed
- **THEN** each score label name is the prefix followed by the decimal digits of that assessment's score, with no leading zero

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

### Requirement: Every registered signal and every flag SHALL have a row in the delivery documentation

`docs/15-merge-confidence.md` SHALL carry, under a heading `## The signals`, one table row per registered signal, saying what the signal reads and what moves it to each band, and under a heading `## The flags`, one table row per flag. The first cell of each row SHALL be the identifier in backticks. The set of signal identifiers under the first heading SHALL equal the registry's, and the set of flags under the second SHALL equal the published flag list; the suite SHALL fail, naming the identifier, when either differs. An informational signal SHALL be marked as not gating.

#### Scenario: Happy path — the tables and the registry agree

- **GIVEN** the shipped page and the registry
- **WHEN** the suite compares the two sets of signal identifiers and the two sets of flags
- **THEN** each pair is equal

#### Scenario: Failure — a signal registered without a row fails the suite

- **GIVEN** a registry that gained a signal the page does not list
- **WHEN** the suite runs
- **THEN** it fails naming the signal

#### Scenario: Edge case — the informational signal is listed and marked

- **GIVEN** the registry's one informational signal
- **WHEN** a reader finds its row
- **THEN** the row says it is reported and never banded

### Requirement: A file at the repository root SHALL be named by its `./` form, and a bare file name SHALL NOT be read as a path mention

The rule that recognises a path mention in spec text (`lib/spec-text.mjs`) SHALL read a path as a mention only when it carries a directory and a file extension. A file at the repository root that carries an extension SHALL therefore be named as `./<file>`, which SHALL be read as the same path. A bare file name SHALL NOT name a file.

Rationale: a bare file name in a spec is usually an example or a file elsewhere in the tree. Reading it as a mention would link specs to every root file that happens to share the name.

#### Scenario: Happy path — a root file named by its `./` form

- **GIVEN** a change that adds a source file with an extension at the repository root and a delta spec that mentions it as `./<file>` in backticks
- **WHEN** the merge confidence is assessed with a base
- **THEN** the spec-coverage signal reads the file as named

#### Scenario: Failure — a bare file name names nothing

- **GIVEN** the same change with the delta spec mentioning only the bare file name in backticks
- **WHEN** the merge confidence is assessed with a base
- **THEN** the spec-coverage signal is amber and names the file as added and named by no spec

#### Scenario: Edge case — a path with a directory is unaffected

- **GIVEN** a spec that mentions a source file two directories deep by its repository-relative path in backticks
- **WHEN** the mention rule reads the spec
- **THEN** the file is named, with or without a leading `./`

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

### Requirement: The ran signal's evidence SHALL name the depth the review record carries

When the review input's dimension record carries `depth`, the ran signal (`review.ran`) SHALL carry `depth: <value>` in its evidence, whatever its band. A record without `depth` SHALL be read exactly as before, with no depth line. The depth SHALL move no band and raise no flag: the lean depth is the published default, not a degradation, and the evidence is what lets a reader of a `MERGE` ask for the strict one.

Rationale: a verdict that does not say how thorough its review was is a verdict a reader cannot calibrate; a verdict that scored every default review lower would be a threshold stated as a flag.

#### Scenario: Happy path — a lean record is named and green

- **GIVEN** a review input with no surviving blocker, warnings under the cap, and a dimension record showing every selected dimension ran and carrying `depth: lean`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with no flag and its evidence carries `depth: lean`
- **AND** the score equals the score of the same input with `depth: strict`

#### Scenario: Failure — an incomplete lean review is amber and still named

- **GIVEN** a review input whose dimension record carries `depth: lean` and names a selected dimension that neither ran nor was unavailable
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber with the reason naming that dimension
- **AND** its evidence carries `depth: lean`

#### Scenario: Edge case — a record without a depth reads as before

- **GIVEN** a review input whose dimension record carries no `depth`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal's band, flags and reason are what they were before this requirement
- **AND** no evidence line names a depth
