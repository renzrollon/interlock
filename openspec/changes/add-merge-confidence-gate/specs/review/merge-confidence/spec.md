## Purpose

Turns the facts a review and a run already produce into one answer to "can this be merged?": a three-way verdict a platform rule can branch on, and a bounded score a person can sort by, computed by the CLI from observed evidence so that neither a model nor a line of prose can re-argue it.

## ADDED Requirements

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

### Requirement: Every registered gating signal SHALL appear in the output, including those whose producer has not landed

The output SHALL carry one entry per registered signal, in a fixed order, whatever the input holds. The registered gating signals, in order, SHALL be `review.blockers`, `review.warnings`, `review.ran`, `review.adversarial`, `risk.class`, `verify.suite`, `verify.e2e`, `verify.coverage`, `ci.pipeline`, `conformance.delta`, `conformance.living`, `spec.coverage`, `diff.shape`, `decisions.open`, `run.integrity`, `drift.stale` and `policy.humanPaths`, followed by the one informational signal, `plan.fidelity`. An informational signal SHALL be reported with its evidence and no band, and SHALL NOT enter the worst band, the clean share or the driving list. A signal whose producing capability is not yet implemented SHALL resolve unobserved with a reason naming the absent producer, and SHALL NOT be omitted or reported as green.

Rationale: a later change that adds a signal silently would change every verdict without anyone seeing the table grow; declaring the full table now makes the growth visible. The identifiers are the ones the receipt, the merge-request labels and the documentation of later changes name.

#### Scenario: Happy path — a full input yields a band for every registered signal

- **GIVEN** an input carrying a fact for every observable signal
- **WHEN** the merge confidence is assessed
- **THEN** the signal identifiers in the output are the registered identifiers, in the registered order
- **AND** every gating entry carries a band, a flag list, evidence and a reason, and the informational entry carries evidence and no band

#### Scenario: Failure — a registered signal absent from the output is a defect

- **GIVEN** an assessment whose output lacks a registered signal identifier
- **WHEN** the output is checked against the registry
- **THEN** the check fails naming the missing identifier

#### Scenario: Edge case — the living-conformance, spec-coverage and human-paths signals before their producers exist

- **GIVEN** any input to this version of the capability
- **WHEN** the merge confidence is assessed
- **THEN** the `conformance.living`, `spec.coverage` and `policy.humanPaths` signals are each present and unobserved
- **AND** each reason names the capability that will produce it
- **AND** the verdict is therefore `HUMAN` or `BLOCK` for every input, never `MERGE`, which is stated in the output rather than hidden

### Requirement: The review signals SHALL read the adjudicated review

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker, or a surviving finding whose severity is outside the published severities, SHALL make the blockers signal (`review.blockers`) red. Surviving warnings above the published cap SHALL make the warnings signal (`review.warnings`) amber, marked as needing a fix. An absent review input SHALL make the ran signal (`review.ran`) amber with the reason that no review ran. A dimension record showing that the review did not complete, or that a selected dimension could not run with its rubric, SHALL make the ran signal amber. A review input that records no dimension selection SHALL be green on the ran signal with a flag, because the counts prove a review happened and only the record of its coverage is missing. A review in which a refutation was refused for citing nothing, or in which a surviving blocker or warning had fewer verdicts than the published floor, SHALL be amber on the adversarial signal (`review.adversarial`), marked as needing more evidence.

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

#### Scenario: Edge case — a refused refutation, and a finding with too few verdicts, are amber on the adversarial signal

- **GIVEN** one review input in which one refutation was refused for citing nothing, and another whose one surviving warning had fewer verdicts than the published floor
- **WHEN** both are assessed
- **THEN** each reads the adversarial signal amber, marked as needing more evidence
- **AND** the second's reason names the verdict floor and its published value

### Requirement: The risk signal SHALL be computed over the touched paths and SHALL never be red

The risk signal (`risk.class`) SHALL classify the changed paths and the change's artifact text with the existing risk classifier. A class within the published merge-allowed classes SHALL be green. A class above them SHALL be amber, marked as needing a person, with the classifier's driving signal in the evidence. The risk signal SHALL NOT resolve red, because touching a sensitive path is a reason for a person to decide, not a defect the machine found.

#### Scenario: Happy path — a docs-and-tests change is green

- **GIVEN** changed paths that are all documentation or tests
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is green with the classifier's class in the evidence

#### Scenario: Failure — a payment path is amber and needs a person

- **GIVEN** a changed path under a payments directory
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is amber, never red
- **AND** it is marked as needing a person, and the evidence names the payment signal and the path

#### Scenario: Edge case — no changed paths and no artifact text fails closed to amber

- **GIVEN** an assessment with no changed paths and no artifact text
- **WHEN** the merge confidence is assessed
- **THEN** the risk signal is amber with the classifier's unclassifiable reason
- **AND** it is not green and not unobserved, because the classifier itself answered

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

The pipeline input SHALL carry the commit it describes and one entry per check with its name, state and whether the platform requires it. A failed required check SHALL make the pipeline signal (`ci.pipeline`) red. A failed non-required check SHALL make it amber. A pending check SHALL make it unobserved. An input whose commit is not the head SHALL make it unobserved even when the input records a failed required check, and the evidence SHALL name that check. An input with no checks SHALL be green with a flag. An absent input SHALL be unobserved.

Rationale: a check that failed on another commit says nothing certain about the head, which may have fixed it; reading it red would block on stale evidence, and dropping it from the evidence would hide it.

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

The diff-shape signal (`diff.shape`) SHALL be green when changed lines and changed files are both at or under their published caps, amber above either, and unobserved when no base is given to diff against. The open-decisions signal (`decisions.open`) SHALL be amber, marked as needing a person, when the ledger holds a needs-human row, an invalid row, or is missing. The drift signal (`drift.stale`) SHALL be amber, marked as needing a fix, when a living spec cites a file this change removed, and amber, marked as needing a person, when another change that is complete and unarchived has delta specs for a capability this change also has delta specs for. The change under assessment SHALL NOT count against itself; with no change under assessment, every complete, unarchived change SHALL count. Aging specs and changed files that no spec describes SHALL NOT move the drift signal. When the stale-citation check could not run because no usable graph exists, the drift signal SHALL carry a flag with the reason, and SHALL NOT read the empty result as clean. The run-integrity signal (`run.integrity`) SHALL be amber when the run halted, its trajectory is incomplete, a stage marker was not published, a handoff report was rejected, or a permission prompt or auto-mode denial occurred, and unobserved when no run record is given.

Rationale: drift on a pull request is about what this change did to the specs. A broken citation elsewhere, or a finished change in an unrelated capability, is the repository's backlog, which `interlock drift` already reports; counting it would hold every pull request at `HUMAN` for a reason no one on it can act on.

#### Scenario: Happy path — a small on-ledger change with a clean run

- **GIVEN** a diff under both caps, a ledger with only agent-resolved rows, no drift findings, and a run record with no degradation
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

The merge-confidence command SHALL read only the repository, the files the caller names and the published limits. It SHALL NOT call a hosting platform or the network. A signal whose input the caller does not supply SHALL resolve unobserved with the reason that the input was not given, unless a fact the command gathers from the repository itself decides the signal first, as the risk class, the ledger, the conformance checklist and drift do. When the assessment completes, the command SHALL exit non-zero if and only if the verdict is `BLOCK`, and, when asked to require a merge, if and only if the verdict is not `MERGE`. An input the command cannot read or parse SHALL end it before any assessment, with exit 1, the reason on standard error and no verdict on standard output, as the gate command does; the usage text SHALL say that exit 1 alone does not tell a blocked change from unreadable input, and that a verdict on standard output does.

#### Scenario: Happy path — a full set of inputs on a clean change

- **GIVEN** a change name, changed paths, a base reference, and review, verification, handoff, pipeline and coverage inputs that all resolve green
- **WHEN** the command runs with JSON output
- **THEN** it prints the verdict, the score, the driving signals, the flags and every signal entry
- **AND** the verdict is `HUMAN`, driven only by the `conformance.living`, `spec.coverage` and `policy.humanPaths` signals whose producers have not landed
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
