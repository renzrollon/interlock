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
