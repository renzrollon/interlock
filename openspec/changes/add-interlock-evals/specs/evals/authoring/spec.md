## Purpose

Defines the `interlock:evals` skill, which covers the two judgement-shaped jobs the eval harness does not do for you: turning an observed failure into a case, and reading a results run to separate a real regression from run-to-run variance.

## ADDED Requirements

### Requirement: The skill authors a case only from an observed failure

Given a described failure, the skill SHALL require evidence that the failure was observed — an archived proposal, a changelog entry, a run artifact, or a transcript — before writing a case. When no evidence is offered, it SHALL say so and stop rather than author a speculative case.

#### Scenario: Evidence present, case written

- **WHEN** the user describes a failure and cites where it was observed
- **THEN** the skill writes a case that encodes it, recording the citation in the case

#### Scenario: Evidence absent, authoring refused

- **WHEN** the user describes a failure with no observed evidence
- **THEN** the skill states that a case needs an observed failure and does not write one

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
