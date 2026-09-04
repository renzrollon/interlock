# evals/authoring Specification

## Purpose
Defines the `interlock:evals` skill, which covers the two judgement-shaped jobs the eval harness does not do for you: turning an observed failure into a case, and reading a results run to separate a real regression from run-to-run variance.

## Requirements

### Requirement: The skill authors a case only from an observed failure

Given a described failure, the skill SHALL require evidence that the failure was observed — an archived proposal, a changelog entry, a run artifact, a transcript, or a case skeleton captured from a recorded run trajectory — before writing a case. When no evidence is offered, it SHALL say so and stop rather than author a speculative case.

A captured skeleton is admissible evidence because it is a run artifact: its provenance names the trajectory and the events it was derived from, and a reader can go back to that trajectory. It is a draft rather than a finished case: the skill SHALL resolve every value the capture marked as requiring confirmation before the case is authored, and SHALL NOT author a case that still carries an unconfirmed grader pattern or an unconfirmed prompt placeholder.

#### Scenario: Evidence present, case written

- **WHEN** the user describes a failure and cites where it was observed
- **THEN** the skill writes a case that encodes it, recording the citation in the case

#### Scenario: Evidence absent, authoring refused

- **WHEN** the user describes a failure with no observed evidence
- **THEN** the skill states that a case needs an observed failure and does not write one

#### Scenario: A captured skeleton satisfies the evidence requirement

- **WHEN** the user offers a case skeleton captured from a recorded run trajectory
- **THEN** the skill treats its provenance as observed-failure evidence and proceeds to author

#### Scenario: An unconfirmed value in a skeleton is resolved before authoring

- **WHEN** a captured skeleton carries a grader pattern or a prompt marked as requiring confirmation
- **THEN** the skill resolves it against the cited trajectory or asks the user
- **AND** it does not author a case that still carries the unconfirmed marker

### Requirement: The skill selects the cheapest grader that can express the assertion

When authoring, the skill SHALL choose a deterministic grader whenever the assertion is expressible as a pattern, tool invocation, file check, or ordering constraint, and SHALL state why a judged grader was necessary whenever it selects one.

#### Scenario: Deterministic assertion gets a deterministic grader

- **WHEN** the failure is that a returned value fell outside a fixed set
- **THEN** the authored case uses a deterministic grader

#### Scenario: Judged grader is justified in writing

- **WHEN** the authored case uses a judged grader
- **THEN** the skill states which part of the assertion could not be expressed deterministically

### Requirement: The skill delegates the triage verdict and explains it

Given a completed results run, the skill SHALL obtain the classification from the triage capability rather than deriving it, and its own contribution SHALL be explanation: which change plausibly caused a regression, and what to do about it. The skill SHALL NOT restate, override, or soften a verdict it was given.

#### Scenario: Verdict comes from triage

- **WHEN** the skill reports on a results run
- **THEN** the regression, variance and no-signal classifications it reports are the ones triage produced

#### Scenario: Skill adds explanation, not reclassification

- **WHEN** triage classifies a case as a regression
- **THEN** the skill explains which recent change plausibly caused it
- **AND** it does not reclassify the case as variance

#### Scenario: No signal is reported as such

- **WHEN** triage reports no signal
- **THEN** the skill reports that evals could not run, and does not present any case as passing or failing

### Requirement: The skill does not modify the surface under test to make a case pass

The skill SHALL NOT edit a skill, shared contract, agent definition, or prompt in order to resolve a failing case. When a case fails, its output is a report, and any change to the surface under test is a separate, explicit decision.

#### Scenario: Failing case does not trigger a prompt edit

- **WHEN** a case fails and the skill can see which prompt sentence caused it
- **THEN** the skill reports the sentence and the failure
- **AND** it does not edit the prompt

### Requirement: The skill states the enablement prerequisite when the harness is unavailable

When the eval harness cannot run because it is not enabled, the skill SHALL report the prerequisite and how to satisfy it, rather than reporting an empty or passing result.

#### Scenario: Harness gated

- **WHEN** the harness refuses to run because early access is not enabled
- **THEN** the skill reports the enablement prerequisite and where to set it
- **AND** it does not report the suite as passing

### Requirement: The skill reads transcripts before explaining a judged case

After a run that includes a judged grader, the skill SHALL read at least one transcript for each judged case before writing its explanation of that case. It SHALL NOT explain a judged result from scores alone. A score movement whose cause is visible only in the trace — a model that satisfied a judge by narrowing the task rather than by doing it — is invisible to every other step in the loop.

#### Scenario: Judged case explained after reading a transcript

- **WHEN** the skill explains a case whose score depends on a judged grader
- **THEN** it has read at least one transcript for that case first

#### Scenario: Deterministic-only run needs no transcript

- **WHEN** every grader in the run is deterministic
- **THEN** the transcript-reading step does not apply

#### Scenario: Reading does not become reclassification

- **WHEN** reading a transcript suggests a different classification than triage produced
- **THEN** the skill reports what it saw in the transcript as explanation
- **AND** it does not restate, override, or soften the verdict triage gave

### Requirement: The report names the transcripts that were read

The skill's report SHALL carry a line naming which transcripts it read. When it read none, the report SHALL say so explicitly rather than omitting the line, so a reader can tell an unexamined result from an examined one.

#### Scenario: Transcripts read are named

- **WHEN** the skill reports on a run in which it read transcripts
- **THEN** the report names each transcript it read

#### Scenario: No transcripts read is stated

- **WHEN** the skill reports on a run and read no transcript
- **THEN** the report states that none were read
- **AND** the line is present rather than omitted

#### Scenario: Unavailable transcripts are spoken

- **WHEN** the run produced no readable transcript
- **THEN** the report states that transcripts were unavailable and why
- **AND** it does not present the explanation as transcript-grounded
