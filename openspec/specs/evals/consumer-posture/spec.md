# evals/consumer-posture Specification

## Purpose
States, for a repository that runs Interlock against its own product rather than developing Interlock, what Interlock checks on each of its runs, what it records, that none of it moves a gate, why no model evals run in that repository's CI, and how to file a failure — so a consuming team can answer those questions from the documentation instead of reading the harness.

## Requirements

### Requirement: The documentation states what a consumer's run is checked by

The documentation SHALL state, for a repository running the spec and ship workflows, which properties of a run are checked deterministically and which command's exit code decides each one. It SHALL distinguish the preflight, which grades the machine before the run, from the checks that grade the run as it proceeds.

#### Scenario: Each stated property names the command that decides it

- **WHEN** a reader looks up what is checked on their run
- **THEN** each checked property is stated together with the command whose exit code decides it

#### Scenario: The preflight is distinguished from the in-run checks

- **WHEN** a reader looks up the checks
- **THEN** the preflight is described as grading the machine before the run, separately from the checks that grade the run

### Requirement: The documentation states what is recorded, where, and that it gates nothing

The documentation SHALL state what a consumer's run records, where those records are written, and that nothing a run records changes any gate, verdict, readiness decision or threshold. It SHALL point at the existing guidance on whether those records belong in version control rather than restating it, so there remains one place that answers that question.

#### Scenario: The non-gating property is stated, not implied

- **WHEN** a reader asks whether recorded figures can block their run
- **THEN** the documentation states that nothing recorded changes a gate

#### Scenario: The keep-or-ignore guidance is referenced rather than duplicated

- **WHEN** the documentation covers what is recorded
- **THEN** it links the existing guidance on committing those records rather than restating it

### Requirement: The documentation states that no model evals run in a consumer's CI, and why

The documentation SHALL state that Interlock does not run model evaluations in a consuming repository's CI, and SHALL give the reasons: the model-facing surface is identical in every consumer, so a prompt regression is Interlock's to catch once; what a consumer wants to know is whether their own change shipped correctly, which their own suite and their own read at the checkpoint answer; and the eval harness is early-access and metered, on terms the consumer does not control.

#### Scenario: The posture is stated with its reasons

- **WHEN** a reader asks whether they should run Interlock's evals in their own CI
- **THEN** the documentation states that they should not, and gives the reasons

#### Scenario: The consumer's own suite is named as the thing that answers their question

- **WHEN** the documentation explains what replaces a consumer-side eval
- **THEN** it names the consumer's own test suite and their read at the checkpoint

### Requirement: The documentation states how to file a failure

The documentation SHALL state how a consumer turns a misbehaving run into a report Interlock can act on: capture a case skeleton from the recorded run, and file it with its provenance. It SHALL state that the capture writes nothing into the consumer's repository beyond the directory they name.

#### Scenario: The filing route names the capture step

- **WHEN** a reader's run misbehaved and they want it fixed upstream
- **THEN** the documentation tells them to capture a skeleton from the recorded run and file it with its provenance

### Requirement: The documentation names caps by where to read them, never by value

Where the documentation refers to a cap, ceiling, band or threshold, it SHALL name the command that publishes the current value and SHALL NOT state the value. A number restated in prose is a second copy of a policy that only code can be held to, and it drifts silently.

#### Scenario: A cap is referred to without its value

- **WHEN** the documentation mentions that a cap governs some behaviour
- **THEN** it names the command that prints the cap and does not print the number

#### Scenario: No numeric threshold appears as policy

- **WHEN** the page is read for policy statements
- **THEN** none of them carries a numeric threshold

### Requirement: The documentation's claims are asserted by a test

The claims this capability requires SHALL be pinned by an automated assertion over the documentation, following the precedent already set for other load-bearing documentation claims. The assertions SHALL match distinguishing tokens rather than whole sentences, so an ordinary rewording does not delete the pin and a reversal of meaning does not survive it.

The page SHALL be reachable from the repository's entry document, and that link SHALL be asserted too, because an unreachable page states nothing to anyone.

#### Scenario: Removing a required claim fails the suite

- **WHEN** a claim this capability requires is deleted from the documentation
- **THEN** the test suite fails

#### Scenario: Rewording a claim without reversing it does not fail the suite

- **WHEN** a pinned claim is rephrased with its meaning intact
- **THEN** the test suite still passes

#### Scenario: The entry document's link is asserted

- **WHEN** the link from the entry document to the page is removed
- **THEN** the test suite fails
