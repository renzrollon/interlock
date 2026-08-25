## ADDED Requirements

### Requirement: A recorded duration SHALL state what it measured

Where the trajectory records a duration on a CLI exit, that duration SHALL be the measured execution time of the command that wrote the event, and the specification SHALL state that this is what it is. It MUST NOT be presented as, or read as, the wall-clock time an agent spent on the corresponding turn — the command runs between agent turns and cannot observe them.

A duration the writer could not measure MUST be recorded as absent, not as zero.

Wave-level and run-level elapsed time SHALL be derived by a reader from event timestamps rather than recorded as an additional field, because the timestamps already carry it and a second recorded field could disagree with them.

#### Scenario: Happy path — a CLI exit carries its own measured execution time

- **GIVEN** a wave-state mutation that runs to completion
- **WHEN** its `cli-exit` event is appended
- **THEN** the event carries a non-negative measured duration for that command's execution

#### Scenario: Failure — an unmeasurable duration is absent rather than zero

- **GIVEN** an append path where the command's execution time was not measured
- **WHEN** the `cli-exit` event is appended
- **THEN** the duration field is absent
- **AND** it is not recorded as zero, which would assert an instantaneous command

#### Scenario: Edge case — wave elapsed time is derivable without a wave duration field

- **GIVEN** a run whose trajectory holds a wave's first and last events
- **WHEN** a reader is asked how long that wave took
- **THEN** the answer is derived from the two timestamps
- **AND** no recorded field claims a wave duration that could contradict them

### Requirement: A run SHALL record output-token spend per wave and per run

The trajectory SHALL record the output-token spend attributable to each wave and to the run as a whole, so that cost per shipped task is answerable from the corpus. The figure SHALL be sourced from the orchestrating runtime's own accounting, not estimated.

The figure is a cumulative process-wide delta over the wave's span. The specification SHALL state that it therefore includes the orchestrator's own turns as well as the implementers', and SHALL NOT claim per-agent or per-lane attribution, which the runtime does not expose.

#### Scenario: Happy path — each wave records a spend figure and the run records a total

- **GIVEN** a run of three waves on a host whose runtime exposes token accounting
- **WHEN** the run closes
- **THEN** the trajectory carries a spend figure for each of the three waves and a total for the run

#### Scenario: Failure — a fabricated per-lane attribution is not recorded

- **GIVEN** a wave that ran four lanes concurrently
- **WHEN** its spend is recorded
- **THEN** the recorded figure is the wave's aggregate
- **AND** no per-lane or per-agent figure is recorded or derived by division

#### Scenario: Edge case — a wave that spawned no agents records its spend as measured, not as zero by assumption

- **GIVEN** a wave whose only work was a verification with no implementer spawns
- **WHEN** its spend is recorded
- **THEN** the figure recorded is the measured delta across that wave's span, whatever it was
- **AND** it is not assumed to be zero on the grounds that no implementer ran

### Requirement: A host without token accounting SHALL record unknown, not zero

Where a host's runtime exposes no token accounting, the spend figures SHALL be recorded as absent and the host's inability to supply them SHALL be visible to a reader. A host that cannot measure spend MUST NOT record `0`, and MUST NOT omit the field in a way indistinguishable from a run that genuinely spent nothing.

The specification SHALL name this as a declared difference between hosts rather than leaving readers to infer it from missing data.

#### Scenario: Happy path — a host with accounting records real figures

- **GIVEN** a run on the default host, whose runtime exposes cumulative output-token spend
- **WHEN** the run closes
- **THEN** the recorded spend figures are present and non-negative

#### Scenario: Failure — a host without accounting records absence explicitly

- **GIVEN** a run on a host whose runtime exposes no token accounting
- **WHEN** the run closes
- **THEN** the spend figures are recorded as absent
- **AND** a reader can distinguish this from a run that measured and found no spend

#### Scenario: Edge case — a runtime that exposes accounting inconsistently degrades rather than throwing

- **GIVEN** a run whose runtime exposes token accounting at the start and stops exposing it partway through
- **WHEN** the later waves close
- **THEN** those waves record their spend as absent
- **AND** the run continues without failing on account of the missing measurement
