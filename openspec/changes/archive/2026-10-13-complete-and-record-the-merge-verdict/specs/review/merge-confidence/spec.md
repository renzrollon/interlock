## ADDED Requirements

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

### Requirement: The command SHALL accept a run's evidence file and SHALL use it only for the commit that run made

The merge-confidence command SHALL accept an option naming the evidence file a ship run's close wrote. From a usable file it SHALL take the inputs only a run observed: the adjudicated review, the final verification verdict, the handoff's counts, the coverage figures and the run record. A file SHALL be usable only when it carries the published schema identifier, names the change under assessment, records that the run made a commit, and records as that commit the head commit. When any of these does not hold, the command SHALL use nothing from the file, SHALL say on standard error which condition failed, and SHALL read each of those signals as it would with no file. An input the caller also names explicitly SHALL replace the file's entry for that input. The command SHALL NOT read the verdict, the score or any signal result recorded in the file: it SHALL always assess from the evidence.

A file that cannot be read or parsed SHALL end the command as any other unreadable input does: exit 1, the reason on standard error naming the file, and no verdict on standard output.

Rationale: a run's facts are evidence about the commit the run made. A later commit, or a run that made none, leaves evidence about a tree no later command can name, which is the same reason a pipeline result for another commit is unobserved.

#### Scenario: Happy path — a run's evidence and a passing pipeline read MERGE

- **GIVEN** a change, a base, an evidence file a clean reviewed run wrote for the head commit, and a pipeline input in which every check for the head passed
- **WHEN** the command runs with the evidence file, the pipeline input and the base
- **THEN** the review, verification, conformance, coverage and run-integrity signals read what the run's evidence supports
- **AND** the verdict is `MERGE` and the command exits zero

#### Scenario: Failure — evidence for another commit is not used

- **GIVEN** an evidence file whose recorded commit is not the head commit
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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Every registered gating signal SHALL appear in the output, and a signal whose producer has not landed SHALL be unobserved

**Reason**: Its second half described a state that no longer exists. `conformance.living` and `spec.coverage` were the last two registered signals without a producer, and this change gives each one, so the rule for a producer-less signal and the scenario pinning that no input can read `MERGE` have nothing left to describe.

**Migration**: The first half is carried, unchanged in meaning, by the added requirement "Every registered signal SHALL appear in the output in a fixed order, and every gating signal SHALL have a producer": the same identifiers in the same order, and the same treatment of the informational signal. A reader of the output sees the same entries; the two signals now carry the band their facts decide, and the reason lines saying `MERGE` is unreachable are gone.
