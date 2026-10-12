## ADDED Requirements

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

### Requirement: Every registered gating signal SHALL appear in the output, and a signal whose producer has not landed SHALL be unobserved

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

#### Scenario: Edge case — the two signals whose producers have not landed

- **GIVEN** any input to this version of the capability
- **WHEN** the merge confidence is assessed
- **THEN** the `conformance.living` and `spec.coverage` signals are each present and unobserved
- **AND** each reason names the capability that will produce it
- **AND** the verdict is therefore `HUMAN` or `BLOCK` for every input, never `MERGE`, which is stated in the output rather than hidden
- **AND** the `policy.humanPaths` signal is not among them: it reads the base policy, and is unobserved only when no base is given

## MODIFIED Requirements

### Requirement: The review signals SHALL read the adjudicated review

The review input SHALL be the adjudicated review as the review command or the run's review step writes it. A surviving blocker, or a surviving finding whose severity is outside the published severities, SHALL make the blockers signal (`review.blockers`) red. Surviving warnings above the published cap SHALL make the warnings signal (`review.warnings`) amber, marked as needing a fix. An absent review input SHALL make the ran signal (`review.ran`) amber with the reason that no review ran. A dimension record showing that the review did not complete, that a selected dimension could not run with its rubric, or that a selected dimension is recorded neither as run nor as unable to run, SHALL make the ran signal amber. A review input that records no dimension selection SHALL be green on the ran signal with a flag, because the counts prove a review happened and only the record of its coverage is missing. A dimension record that names the `domain` dimension as skipped for want of a graph SHALL leave the ran signal's band as the rest of the record decides it and SHALL add the `domain-skipped` flag. A review in which a refutation was refused for citing nothing, or in which a surviving blocker or warning had fewer verdicts than the published floor, SHALL be amber on the adversarial signal (`review.adversarial`), marked as needing more evidence.

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

#### Scenario: Edge case — a refused refutation, and a finding with too few verdicts, are amber on the adversarial signal

- **GIVEN** one review input in which one refutation was refused for citing nothing, and another whose one surviving warning had fewer verdicts than the published floor
- **WHEN** both are assessed
- **THEN** each reads the adversarial signal amber, marked as needing more evidence
- **AND** the second's reason names the verdict floor and its published value

### Requirement: The command SHALL run offline, treat every absent input as unobserved, and exit on the verdict

The merge-confidence command SHALL read only the repository, the files the caller names and the published limits. It SHALL NOT call a hosting platform or the network. A signal whose input the caller does not supply SHALL resolve unobserved with the reason that the input was not given, unless a fact the command gathers from the repository itself decides the signal first, as the risk class, the ledger, the conformance checklist, drift and, with a base reference, the review policy committed at the base do. With a base reference, every path the diff between the base and the head reports SHALL be assessed as a changed path whether or not the caller named it, and the paths the caller did not name SHALL be listed on standard error. When the assessment completes, the command SHALL exit non-zero if and only if the verdict is `BLOCK`, and, when asked to require a merge, if and only if the verdict is not `MERGE`. An input the command cannot read or parse SHALL end it before any assessment, with exit 1, the reason on standard error and no verdict on standard output, as the gate command does; the usage text SHALL say that exit 1 alone does not tell a blocked change from unreadable input, and that a verdict on standard output does.

#### Scenario: Happy path — a full set of inputs on a clean change

- **GIVEN** a change name, changed paths, a base reference whose `REVIEW.md` lists no changed path, and review, verification, handoff, pipeline and coverage inputs that all resolve green
- **WHEN** the command runs with JSON output
- **THEN** it prints the verdict, the score, the driving signals, the flags and every signal entry
- **AND** the verdict is `HUMAN`, driven only by the `conformance.living` and `spec.coverage` signals whose producers have not landed, and by `run.integrity`, because a command run by hand has no run record
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
- **AND** the human-paths signal resolves unobserved with the reason that no base was given
- **AND** the verdict is `HUMAN` and the exit is zero

#### Scenario: Edge case — an unreadable input exits 1 with no verdict

- **GIVEN** a review file that is not valid JSON
- **WHEN** the command runs with JSON output
- **THEN** it exits 1
- **AND** standard output carries no verdict, and standard error names the file

## REMOVED Requirements

### Requirement: Every registered gating signal SHALL appear in the output, including those whose producer has not landed

**Reason**: Its edge-case scenario states that `policy.humanPaths` is unobserved for every input, which this change makes untrue: the signal now reads the review policy committed at the base. A MODIFIED block cannot drop that scenario, and keeping its title would leave the living spec asserting a producer gap that no longer exists.

**Migration**: Replaced by "Every registered gating signal SHALL appear in the output, and a signal whose producer has not landed SHALL be unobserved", which keeps the registry, its order, the informational-signal rule and the unobserved rule unchanged, and names `conformance.living` and `spec.coverage` as the two signals still without a producer.
