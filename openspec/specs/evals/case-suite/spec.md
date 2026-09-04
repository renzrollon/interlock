# evals/case-suite Specification

## Purpose
Defines the eval case suite that regression-tests Interlock's model-facing surface — the skills, the shared contracts, and the prompts `workflows/ship.js` assembles — against a real model, covering the failure classes that static assertions over prompt text cannot observe.

## Requirements

### Requirement: Cases live in a suite the harness discovers by default

The suite SHALL live at `evals/` in the repository root, which is the harness default for a plugin whose root is the repository root. The suite SHALL NOT be placed inside a declared component directory (`skills/`, `agents/`, `commands/`, `workflows/`), and the plugin manifest SHALL NOT declare an `experimental.evals` key.

#### Scenario: Suite is discovered without manifest configuration

- **WHEN** the eval harness is run against the repository root
- **THEN** it discovers every case directory under `evals/`
- **AND** `.claude-plugin/plugin.json` contains no `experimental` key

#### Scenario: Suite placement does not shadow plugin components

- **WHEN** the suite directory is chosen
- **THEN** it is not nested under `skills/`, `agents/`, `commands/` or `workflows/`
- **AND** no component-overlap warning is emitted

### Requirement: Every case cites the reproduced failure it encodes

Each case SHALL name, in a form a reader can follow, the reproduced failure it regression-tests — an archived proposal path, a `CHANGELOG.md` entry, or a `file:line` span in the prompt or skill under test. A case that encodes a hypothesised failure rather than an observed one SHALL be rejected.

#### Scenario: Case carries provenance

- **WHEN** a case is added to the suite
- **THEN** its description names the archived proposal, changelog entry, or `file:line` span it derives from

#### Scenario: Hypothetical case is refused

- **WHEN** a proposed case cites no observed failure
- **THEN** it is not added to the suite, and the reason given is the absence of provenance

### Requirement: Deterministic graders are preferred over judged graders

Where an assertion is set-membership, tool-invocation, file-existence, or ordering shaped, the case SHALL use a deterministic grader rather than a judged one. A judged grader SHALL be used only where the assertion is genuinely semantic.

#### Scenario: Enum conformance uses a deterministic grader

- **WHEN** a case asserts that a returned status is one of a fixed set
- **THEN** it uses a deterministic grader
- **AND** it does not invoke a model judge for that assertion

#### Scenario: Judged grader is justified

- **WHEN** a case uses a judged grader
- **THEN** the assertion it makes cannot be expressed as a pattern, tool invocation, file check, or ordering constraint

### Requirement: Cases pin a schema version

Every case SHALL pin the case schema version it was authored against, so that a harness upgrade which changes the schema fails loudly at load rather than reinterpreting a case silently.

#### Scenario: Case declares its schema version

- **WHEN** a case is authored
- **THEN** it records the schema version it targets

#### Scenario: Unsupported schema version fails at load

- **WHEN** a case declares a schema version the installed harness does not support
- **THEN** the run reports a load failure for that case rather than scoring it

### Requirement: The seeded suite covers the observable-gap classes

The initial suite SHALL contain one case per failure class that the existing static suite is structurally unable to observe: tier read-scope compliance, cited-cap resolution, lane partial-failure reporting, handoff status enum conformance, control-plane action invention, trampoline halt, skill-routing discrimination, and evidence-locator fabrication.

#### Scenario: Each gap class has a case

- **WHEN** the seeded suite is complete
- **THEN** every listed failure class is represented by at least one case

#### Scenario: A case that duplicates static coverage is refused

- **WHEN** a proposed case asserts something an existing `node:test` assertion already covers deterministically
- **THEN** it is not added, because it would duplicate the unit suite rather than extend it

### Requirement: Skill-trigger cases distinguish plugin behaviour from baseline behaviour

A case asserting that a skill fires SHALL mark that assertion as a plugin-fired indicator rather than as part of the score, so the suite reports whether the plugin caused the behaviour instead of rewarding behaviour the base agent would have produced anyway.

#### Scenario: Skill invocation is reported as an indicator

- **WHEN** a case asserts that a named skill was invoked
- **THEN** that grader is excluded from the case score in both arms
- **AND** the result reports it as an indicator that the plugin fired

#### Scenario: Baseline arm establishes causation

- **WHEN** the suite is run with a baseline comparison arm
- **THEN** the report states the per-case score difference between the plugin and no-plugin arms

### Requirement: A documented count of a suite SHALL be derived or absent

Published documentation SHALL NOT state how many tests a suite contains unless that number is asserted by a test that derives it from the suite itself. Where no such assertion exists, the claim SHALL be expressed without a number. A count written once and maintained by hand is a claim nobody asserts, and drifts silently.

#### Scenario: Happy path — the claim survives without its number

- **WHEN** documentation describes the unit suite as dependency-free and names no count
- **THEN** the claim remains true regardless of how many tests the suite collects
- **AND** no maintenance step is required when a test is added or removed

#### Scenario: Failure — a hand-written count is reintroduced

- **WHEN** a documented sentence describing the size of the unit suite states a literal count that no test derives
- **THEN** the doc-claim check fails and names the file and the count it found

#### Scenario: Edge case — a derived count is permitted

- **WHEN** a documented count is accompanied by an assertion that reads the number from the suite at test time
- **THEN** the doc-claim check permits it, because the number cannot go stale without the suite going red

#### Scenario: Edge case — numbers that do not describe suite size are untouched

- **WHEN** documentation states a number that describes something other than how many tests a suite contains
- **THEN** the doc-claim check leaves it alone

### Requirement: The zero-dependency claim SHALL be read from the manifest

Where documentation claims that the suite runs without dependencies, that claim SHALL be asserted against the package manifest rather than trusted to prose. The claim is exactly derivable at no cost, and it is the claim a reader acts on when they clone the repository.

#### Scenario: Happy path — a dependency-free manifest satisfies the claim

- **WHEN** the package manifest declares no runtime dependencies
- **THEN** the assertion passes and the documented claim stands

#### Scenario: Failure — a runtime dependency is added without updating the claim

- **WHEN** a runtime dependency is declared in the package manifest
- **THEN** the assertion fails and names the documented claim it contradicts

### Requirement: Documentation of the eval suite SHALL name it and state its coverage boundary

Documentation that describes evaluation of this project SHALL name the model-in-the-loop suite at `evals/`, SHALL state which model-facing surfaces it exercises, and SHALL state which surfaces it does not. It SHALL NOT present the unit suite as the eval suite, and it SHALL NOT claim coverage the suite does not have on the day the sentence is written.

#### Scenario: Happy path — a reader learns the suite exists and where it stops

- **WHEN** a reader reaches the documentation's evaluation section
- **THEN** the text names `evals/`, names the surfaces its cases exercise, and names the surfaces with no cases
- **AND** the text does not describe the unit suite as an eval of the workflow's outcomes

#### Scenario: Failure — the eval suite is described but its gap is omitted

- **WHEN** documentation names the eval suite without stating which surfaces it leaves uncovered
- **THEN** the doc-claim check fails, because a coverage claim with no stated boundary reads as full coverage

### Requirement: Documentation of the eval suite SHALL carry no threshold value and no case count

Documentation describing the eval suite SHALL NOT state the value of any cap, cost ceiling, run budget, or score threshold, and SHALL NOT state how many cases the suite contains. Where a cap is relevant to the reader, the documentation SHALL name the command that prints it rather than repeat the value.

#### Scenario: Happy path — a cap is pointed to, not restated

- **WHEN** documentation needs to tell a reader that a cost ceiling bounds a metered eval run
- **THEN** it states that the ceiling exists and names the command that prints it
- **AND** it states no number

#### Scenario: Failure — a threshold value is written into prose

- **WHEN** documentation states the numeric value of an eval cap or score threshold
- **THEN** the doc-claim check fails and names the site

#### Scenario: Failure — a case count is written into prose

- **WHEN** documentation states how many cases the eval suite contains
- **THEN** the doc-claim check fails, because that number goes stale the next time a case is authored

### Requirement: A conditional instruction is tested on both sides

Where a case tests an instruction whose correct behaviour depends on a condition in the environment, the suite SHALL also hold a case for the opposite condition. A suite that only tests when a behaviour should occur, and never when it should not, applies one-sided pressure to the surface it grades.

#### Scenario: Halting case has a launching twin

- **WHEN** a case asserts that the entry point halts because a required host capability is absent
- **THEN** the suite also holds a case asserting that, with that capability present, the entry point launches the workflow exactly once and does not launch it again

#### Scenario: Routing case has a sibling-destination twin

- **WHEN** a case asserts that one request routes to a named skill rather than a confusable sibling
- **THEN** the suite also holds a case for a request that should route to that sibling instead

#### Scenario: Read-scope case has an upper-tier twin

- **WHEN** a case asserts that the narrowest context tier must not read the change's design and delta specifications
- **THEN** the suite also holds a case asserting that the widest context tier reads them in full

### Requirement: A twin case cites the case it twins, and the citation resolves

A case authored to supply the opposite side of a conditional instruction, rather than from an independently observed failure, SHALL declare the case it twins in a dedicated field of its case definition. The declared name SHALL resolve to a case that exists in the suite. A twin declaration SHALL NOT substitute for provenance on a case that encodes an independently observed failure.

#### Scenario: Twin declaration resolves

- **WHEN** a case declares the case it twins
- **THEN** the structural gate confirms that a case of that name exists in the suite

#### Scenario: Dangling twin declaration is rejected

- **WHEN** a case declares a twin that does not exist in the suite
- **THEN** the structural gate fails, naming the case and the unresolved twin

#### Scenario: Twin declaration is distinguishable from an observed failure

- **WHEN** the suite is inspected for which cases encode an observed failure
- **THEN** a case that carries a twin declaration is separable from one that cites only an observed failure

### Requirement: Every judged grader carries a calibration set or a recorded deferral

Each grader whose verdict depends on a model judge SHALL either have a stored set of human-labelled transcripts kept with its case, or be named in a committed deferral record that states why the set does not yet exist. A judged grader that is neither calibrated nor recorded as deferred SHALL fail the structural gate.

#### Scenario: Judged grader with a calibration set

- **WHEN** a judged grader has a stored calibration set
- **THEN** the structural gate accepts it

#### Scenario: Judged grader with a recorded deferral

- **WHEN** a judged grader has no calibration set and is named in the deferral record with a stated reason
- **THEN** the structural gate accepts it, and the deferral is visible to a reader

#### Scenario: Silently uncalibrated judged grader is rejected

- **WHEN** a judged grader has neither a calibration set nor a deferral entry
- **THEN** the structural gate fails, naming the grader

#### Scenario: A stale deferral is visible

- **WHEN** a deferral record names a grader that no longer exists, or a grader that now has a calibration set
- **THEN** the structural gate fails, so the record cannot outlive the condition it describes

### Requirement: Surfaces with no observed failure are recorded by name, not filled with hypotheticals

When a model-facing surface has been swept for observed failures and none was found, that surface SHALL be recorded by name in the suite's baseline record as unexercised with no provenance. The absence SHALL NOT be closed by authoring a case for a failure nobody observed.

#### Scenario: Swept surface with no provenance is recorded

- **WHEN** a surface is swept for observed model-behaviour failures and none is found
- **THEN** the surface is named in the baseline record as unexercised, with no case authored for it

#### Scenario: Swept surface with provenance gets a case

- **WHEN** the sweep finds an observed failure on a surface
- **THEN** a case is authored citing that failure, and the surface is not listed as unexercised

#### Scenario: Empty corpus is stated

- **WHEN** a source the sweep was required to read holds no records
- **THEN** the baseline record states that the source was empty, rather than reporting the sweep as complete over it

### Requirement: The suite reports which model-facing surfaces it exercises

The suite SHALL be able to partition every model-facing file and every assembled prompt into those named by at least one case and those named by none, and SHALL print the unexercised set by name. A case SHALL be able to name the surfaces it exercises directly, in addition to whatever its provenance citation names. The partition SHALL be a report: it SHALL NOT fail on the size of the unexercised set, and coverage SHALL NOT gate a change.

#### Scenario: Partition is total

- **WHEN** the coverage report is produced
- **THEN** every model-facing file and every assembled prompt appears in exactly one of the exercised and unexercised sets

#### Scenario: Unexercised surfaces are named

- **WHEN** surfaces are exercised by no case
- **THEN** the report prints them by name

#### Scenario: Coverage never fails a build

- **WHEN** the unexercised set is large, or grows
- **THEN** the report states it and the check still passes

#### Scenario: A case may name what it exercises

- **WHEN** a case declares the surfaces it exercises
- **THEN** those surfaces are counted as exercised regardless of what its provenance citation names

#### Scenario: A declared surface that does not exist is rejected

- **WHEN** a case names a surface that is not present in the repository
- **THEN** the structural gate fails, naming the case and the unresolved surface
