## Purpose

Turns the facts a review and a run already produce into one answer to "can this be merged?": a three-way verdict a platform rule can branch on, and a bounded score a person can sort by, computed by the CLI from observed evidence so that neither a model nor a line of prose can re-argue it.

## ADDED Requirements

### Requirement: The verdict SHALL be the worst band over every gating signal

Each gating signal SHALL resolve to exactly one of four bands: green, amber, red, or unobserved. The verdict SHALL be `MERGE` only when every gating signal is green, `BLOCK` when at least one gating signal is red, and `HUMAN` otherwise. An unobserved signal SHALL rank as amber for the verdict. No count or share of green signals SHALL lift a verdict past a single red or amber signal.

Rationale: averaging is how a critical signal gets diluted by volume; the risk classifier already refuses it, and the merge verdict inherits the rule.

#### Scenario: Happy path — every signal green reads MERGE

- **GIVEN** an input in which every gating signal resolves green
- **WHEN** the merge confidence is assessed
- **THEN** the verdict is `MERGE`
- **AND** the output lists no driving signal

#### Scenario: Failure — one red among many greens reads BLOCK

- **GIVEN** an input in which one gating signal resolves red and every other gating signal resolves green
- **WHEN** the merge confidence is assessed
- **THEN** the verdict is `BLOCK`
- **AND** the red signal is named as driving, with the evidence that made it red

#### Scenario: Edge case — one unobserved signal reads HUMAN and says what to look at

- **GIVEN** an input in which one gating signal has no input and every other gating signal resolves green
- **WHEN** the merge confidence is assessed
- **THEN** the verdict is `HUMAN`
- **AND** the unobserved signal is named as driving with the reason it could not be observed
- **AND** each driving signal is marked as needing a person, needing more evidence, or needing a fix, so a reader can tell which ones no evidence will lift

### Requirement: A flag SHALL lower the score and SHALL NOT move a band

A signal MAY carry one or more flags from a fixed, published list. A flag SHALL be reported with the signal and SHALL make the signal count as not clean for the score. A flag SHALL NOT change the signal's band or the verdict.

Rationale: "no e2e suite exists here" is something a reader should know and the number should reflect, and it is not a reason to stop a merge.

#### Scenario: Happy path — a flagged green signal still reads MERGE

- **GIVEN** an input in which every gating signal resolves green and one of them carries a flag
- **WHEN** the merge confidence is assessed
- **THEN** the verdict is `MERGE`
- **AND** the score is strictly below the score of the same input with the flag removed
- **AND** the flag is reported beside its signal

#### Scenario: Failure — a flag is not promoted to amber

- **GIVEN** an input that would read `MERGE` except for a flag on one green signal
- **WHEN** the merge confidence is assessed
- **THEN** the verdict is `MERGE` and not `HUMAN`
- **AND** an implementation that turned the flag into an amber band would violate this requirement

#### Scenario: Edge case — a flag outside the published list

- **GIVEN** a signal that attempts to report a flag name not in the published flag list
- **WHEN** the merge confidence is assessed
- **THEN** the assessment is rejected as a defect rather than carrying the unknown flag
- **AND** the published flag list is the only vocabulary a reader has to match against

### Requirement: The score SHALL be bounded by the worst band and ordered by clean signals

The score SHALL be an integer from 0 to 100. Each band SHALL have a published ceiling, and a band's floor SHALL be one above the next-worse band's ceiling, with the worst band's floor at 0. The score SHALL equal the worst band's floor plus the band's width scaled by the share of gating signals that are green and carry no flag. Informational signals SHALL NOT enter the share.

Rationale: a bounded score and a verdict agree by construction, and two results in the same band still sort.

#### Scenario: Happy path — every signal clean scores the green ceiling

- **GIVEN** an input in which every gating signal resolves green with no flag
- **WHEN** the merge confidence is assessed
- **THEN** the score equals the published green ceiling exactly

#### Scenario: Failure — a red signal cannot score above the red ceiling

- **GIVEN** an input in which one gating signal resolves red and every other gating signal is green with no flag
- **WHEN** the merge confidence is assessed
- **THEN** the score is at most the published red ceiling
- **AND** it is strictly below the amber floor

#### Scenario: Edge case — same band, one more flag, strictly lower score

- **GIVEN** two inputs whose worst band is amber, identical except that one carries one additional flag on a green signal
- **WHEN** both are assessed
- **THEN** the input with the additional flag scores strictly lower
- **AND** both scores lie between the amber floor and the amber ceiling inclusive
- **AND** an input in which no gating signal is clean scores exactly its band's floor

### Requirement: A missing result SHALL be unobserved; a missing tool SHALL be a flag; a blocking kind SHALL never be a flag

A signal whose evidence the run should have produced and did not SHALL resolve unobserved. A signal whose evidence depends on a tool the repository has declared it does not have SHALL resolve green with a flag naming the absent tool, except that the blocking verification kinds (the unit suite and the type check) SHALL resolve amber when absent, never green.

Rationale: the verify planner already separates "not configured" from "budget exceeded"; the merge verdict reads that distinction rather than inventing one, and a repository is not punished for tooling it never claimed to have, except where the ship loop itself refuses to run without it.

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

### Requirement: Every registered gating signal SHALL appear in the output, including those whose producer has not landed

The output SHALL carry one entry per registered signal, in a fixed order, whatever the input holds. A signal whose producing capability is not yet implemented SHALL resolve unobserved with a reason naming the absent producer, and SHALL NOT be omitted or reported as green.

Rationale: a later change that adds a signal silently would change every verdict without anyone seeing the table grow; declaring the full table now makes the growth visible.

#### Scenario: Happy path — a full input yields a band for every registered signal

- **GIVEN** an input carrying a fact for every observable signal
- **WHEN** the merge confidence is assessed
- **THEN** the set of signal identifiers in the output equals the registered set
- **AND** every entry carries a band, a flag list, evidence and a reason

#### Scenario: Failure — a registered signal absent from the output is a defect

- **GIVEN** an assessment whose output lacks a registered signal identifier
- **WHEN** the output is checked against the registry
- **THEN** the check fails naming the missing identifier

#### Scenario: Edge case — the living-conformance, spec-coverage and human-paths signals before their producers exist

- **GIVEN** any input to this version of the capability
- **WHEN** the merge confidence is assessed
- **THEN** the living-conformance, spec-coverage and always-human-paths signals are each present and unobserved
- **AND** each reason names the capability that will produce it
- **AND** the verdict is therefore never `MERGE` in this version, which is stated in the output rather than hidden

### Requirement: The review signals SHALL read the adjudicated review

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker or a malformed finding SHALL be red. Surviving warnings above the published cap SHALL be amber. An absent review input SHALL be amber with the reason that no review ran. A review in which a refutation was refused for citing nothing, or in which a surviving blocker or warning had fewer verdicts than the published floor, SHALL be amber on the adversarial signal. A review input that records no dimension selection SHALL be green on the ran signal with a flag, because the counts prove a review happened and only the record of its coverage is missing.

#### Scenario: Happy path — a clean adjudicated review is green on every review signal

- **GIVEN** a review input with no surviving blocker, surviving warnings at or under the cap, no refused refutation, every surviving finding adjudicated by at least the floor number of skeptics, and a dimension record showing every selected dimension ran with its rubric
- **WHEN** the merge confidence is assessed
- **THEN** the blockers, warnings, ran and adversarial signals are all green with no flag

#### Scenario: Failure — a surviving blocker is red

- **GIVEN** a review input with one surviving blocker
- **WHEN** the merge confidence is assessed
- **THEN** the blockers signal is red and the verdict is `BLOCK`
- **AND** the evidence names the blocker's file and title

#### Scenario: Edge case — no review input is amber, and a review with no dimension record is a flag

- **GIVEN** one assessment with no review input and another whose review input carries counts but no dimension record
- **WHEN** both are assessed
- **THEN** the first reads the ran signal amber with the reason that no review ran
- **AND** the second reads the ran signal green with a flag saying the dimension record is absent

### Requirement: The risk signal SHALL be computed over the touched paths and SHALL never be red

The risk signal SHALL classify the changed paths and the change's artifact text with the existing risk classifier. A class within the published merge-allowed classes SHALL be green. A class above them SHALL be amber, marked as needing a person, with the classifier's driving signal in the evidence. The risk signal SHALL NOT resolve red, because touching a sensitive path is a reason for a person to decide, not a defect the machine found.

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

### Requirement: The verification signals SHALL read the final verification verdict

The suite signal SHALL be red when a blocking kind halted, amber when a blocking kind was skipped or reported no result, and green otherwise. The end-to-end signal SHALL be amber when the suite ran and failed, green with a flag when no end-to-end suite is configured or the caller opted out, and green when it passed.

#### Scenario: Happy path — a green final verdict with no e2e suite

- **GIVEN** a final verification verdict in which the unit suite and type check passed and end-to-end was skipped as not configured
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green with no flag
- **AND** the end-to-end signal is green with the flag naming the absent suite

#### Scenario: Failure — a red unit suite is red

- **GIVEN** a final verification verdict that halted on the unit suite
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red and the verdict is `BLOCK`

#### Scenario: Edge case — an end-to-end suite that ran and failed is amber, not red

- **GIVEN** a final verification verdict in which the unit suite passed and the end-to-end suite ran and failed
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green and the end-to-end signal is amber
- **AND** the verdict is `HUMAN`, with the end-to-end failure named as needing a fix

### Requirement: The coverage signal SHALL judge the change against the base, not against an absolute bar

The coverage signal SHALL be green when a base figure is present, its commit is an ancestor of the head, and the head total is within the published decline tolerance of the base total. With no base figure it SHALL be green when the changed-line coverage is at or above the published patch floor, carrying a flag that no baseline exists, and amber below it. It SHALL be green when the change has fewer changed lines than the published small-change floor. It SHALL be unobserved when a base figure is present but its commit is not an ancestor of the head. It SHALL be green with a flag when coverage is not configured.

Rationale: a repository is judged on what the change did to coverage, not on where coverage stood before the change, which is the comparison every coverage status product makes by default.

#### Scenario: Happy path — a decline inside the tolerance is green

- **GIVEN** a coverage input whose base commit is an ancestor of the head and whose head total is below the base total by less than the published tolerance
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is green
- **AND** the evidence states both totals and the tolerance by name

#### Scenario: Failure — a decline beyond the tolerance is amber

- **GIVEN** a coverage input whose head total is below the base total by more than the published tolerance
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is amber with both totals in the evidence
- **AND** the verdict is `HUMAN`, marked as needing more evidence

#### Scenario: Edge case — a baseline from another branch, and a tiny change

- **GIVEN** one coverage input whose base commit is not an ancestor of the head, and another with no base figure and fewer changed lines than the published small-change floor
- **WHEN** both are assessed
- **THEN** the first reads the coverage signal unobserved with the reason that the baseline is not an ancestor
- **AND** the second reads the coverage signal green with the small-change floor named

### Requirement: The pipeline signal SHALL read the platform's checks for the head commit

The pipeline input SHALL carry the commit it describes and one entry per check with its name, state and whether the platform requires it. A failed required check SHALL be red. A failed non-required check SHALL be amber. A pending check SHALL make the signal unobserved. An input whose commit is not the head SHALL make the signal unobserved. An input with no checks SHALL be green with a flag. An absent input SHALL be unobserved.

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

### Requirement: The change-shape signals SHALL read the diff, the ledger, drift and the run

The diff-shape signal SHALL be green when changed lines and changed files are both at or under their published caps, amber above either, and unobserved when no base is given to diff against. The open-decisions signal SHALL be amber, marked as needing a person, when the ledger holds a needs-human row, an invalid row, or is missing. The drift signal SHALL be amber when a living spec linked to a touched file cites a file that no longer exists, or when an unarchived change exists. The run-integrity signal SHALL be amber when the run halted, its trajectory is incomplete, a stage marker was not published, a handoff report was rejected, or a permission prompt or auto-mode denial occurred, and unobserved when no run record is given.

#### Scenario: Happy path — a small on-ledger change with a clean run

- **GIVEN** a diff under both caps, a ledger with only agent-resolved rows, no drift findings, and a run record with no degradation
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape, open-decisions, drift and run-integrity signals are all green

#### Scenario: Failure — an open product question is amber and needs a person

- **GIVEN** a ledger with one needs-human row
- **WHEN** the merge confidence is assessed
- **THEN** the open-decisions signal is amber, marked as needing a person
- **AND** the evidence carries the row's identifier and question

#### Scenario: Edge case — no base to diff against, and a missing ledger

- **GIVEN** an assessment given no base reference and a change with no ledger file
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is unobserved with the reason that no base was given
- **AND** the open-decisions signal is amber with the reason that the ledger is missing, not unobserved, because a missing ledger is a failure of the audit

### Requirement: The command SHALL run offline, treat every absent input as unobserved, and exit on the verdict

The merge-confidence command SHALL read only the repository, the files the caller names and the published limits. It SHALL NOT call a hosting platform or the network. Every input the caller does not supply SHALL resolve its signals unobserved with the reason that the input was not given. The command SHALL exit non-zero if and only if the verdict is `BLOCK`, and, when asked to require a merge, if and only if the verdict is not `MERGE`.

#### Scenario: Happy path — a full set of inputs on a clean change

- **GIVEN** a change name, changed paths, a base reference, and review, verification, handoff, pipeline and coverage inputs that all resolve green
- **WHEN** the command runs with JSON output
- **THEN** it prints the verdict, the score, the driving signals, the flags and every signal entry
- **AND** it exits zero

#### Scenario: Failure — a blocking verdict exits non-zero, and a required merge turns HUMAN into non-zero

- **GIVEN** inputs that resolve to `BLOCK`, and separately inputs that resolve to `HUMAN`
- **WHEN** the command runs on the first, and on the second with the require-merge option
- **THEN** both exit non-zero
- **AND** the second without the require-merge option exits zero, because a change that needs a person is not a failed command

#### Scenario: Edge case — only changed paths given

- **GIVEN** the command run with changed paths and no other input or base reference
- **WHEN** it runs
- **THEN** every signal with no input resolves unobserved, each with the reason that its input was not given
- **AND** the verdict is `HUMAN` and the exit is zero

### Requirement: Every threshold the verdict applies SHALL be published by the limits surface and SHALL be cited by name in the output

The band ceilings, the warning cap, the verdict floor per finding, the coverage tolerance and floors, and the diff caps SHALL be read from the published limits definition. The output's reasons SHALL cite the limit's name beside its value. No threshold SHALL be restated in a skill, a prompt or a document as the rule itself.

#### Scenario: Happy path — a reason cites the cap it applied

- **GIVEN** a review input with surviving warnings above the cap
- **WHEN** the merge confidence is assessed
- **THEN** the warnings signal's reason names the warning cap and its published value

#### Scenario: Failure — a literal threshold in the decision is detected

- **GIVEN** the decision module and its tests
- **WHEN** they are checked for a literal equal to a published merge threshold
- **THEN** the check fails naming the site, and the expected value in every test is read from the published limits rather than written as a number

#### Scenario: Edge case — the published ceilings change and the score follows

- **GIVEN** the published band ceilings altered
- **WHEN** the same input is assessed again
- **THEN** the score moves with the altered ceilings
- **AND** the verdict is unchanged, because bands and not ceilings decide it
