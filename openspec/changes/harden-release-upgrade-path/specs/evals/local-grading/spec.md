## Purpose

Lets a maintainer grade an interactive `/interlock:ship` run where it happened, with the outcome eval's own graders, and append a comparable row to the outcome history without a model credential.

## ADDED Requirements

### Requirement: The outcome eval SHALL grade an existing run root without spawning an agent

The outcome eval SHALL accept a form that names an existing root, a change, a baseline commit and a fixture identity. That form SHALL grade the root's run with the loop arm's graders, and SHALL invoke no model and require no credential. The run graded SHALL be the newest one in the root unless a run id is given.

#### Scenario: Happy path — a kettle run is graded in place

- **GIVEN** a root holding a closed `/interlock:ship` run of change `c`
- **WHEN** the grade-root form runs naming that root, `c`, the baseline commit and fixture identity `kettle@demo-ship`
- **THEN** each loop-arm criterion is reported met, unmet, unobserved or not applicable
- **AND** no agent is spawned

### Requirement: A graded local run SHALL be appended as a row that says what produced it

The appended row SHALL carry the same schema as other outcome-history rows. Its fields SHALL be set as follows:

- the version SHALL be the plugin version the run recorded, falling back to the CLI version it recorded;
- the host SHALL be the host the run recorded;
- the eval agent SHALL be `interactive-session`;
- the model SHALL be the one the run recorded, or `unknown`.

A run that recorded no version SHALL NOT be appended, and the refusal SHALL name why. Without baseline test counts, the not-weakened criterion SHALL be recorded unobserved with its reason, never met.

#### Scenario: Failure — a run from a CLI that recorded no version

- **GIVEN** a run whose trajectory and receipt carry no CLI or plugin version
- **WHEN** the grade-root form runs
- **THEN** nothing is appended and the output says the run carries no version to key the row on

#### Scenario: Edge case — no baseline counts

- **WHEN** the grade-root form runs without baseline counts
- **THEN** the row records the not-weakened criterion as unobserved, naming the missing counts
