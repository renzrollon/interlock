## ADDED Requirements

### Requirement: The model-free prepare path SHALL isolate without a network or a model

When the model-free prepare path runs — including when ordinary CI invokes it — it SHALL copy each fixture into a scratch root outside the repository that carries the fixtures, SHALL refuse any root that resolves inside that repository, and SHALL leave that repository's own outcome corpus, trajectory directory and metrics directory exactly as they were before the run.

It SHALL complete without invoking a model and without requiring network access. It SHALL NOT be an excuse to execute a fixture inside the repository that carries it.

Existing offline assertions of fixture solvability and isolation remain the unit-suite's contract. This requirement does not add a second fixture set or a second isolation rule; it binds the prepare path, and the CI job that runs it, to the rule the fixture set already has.

#### Scenario: Happy path — CI prepare leaves the carrying repository untouched

- **WHEN** ordinary CI runs the model-free prepare path
- **THEN** every fixture is prepared from a scratch root outside the repository that carries it
- **AND** that repository's outcome corpus, trajectory directory and metrics directory hold exactly the records they held before the run
- **AND** no model is invoked

#### Scenario: Failure — a root inside the carrying repository is refused

- **WHEN** the model-free prepare path is asked to use a root located inside the repository under test
- **THEN** it refuses and states why
- **AND** it does not write into that repository's corpora

#### Scenario: Edge case — prepare completes with no network

- **WHEN** the model-free prepare path runs with no network and no model credential
- **THEN** it still copies, validates isolation, and exits on that result
- **AND** it does not wait on a provider or treat the missing network as no-signal
