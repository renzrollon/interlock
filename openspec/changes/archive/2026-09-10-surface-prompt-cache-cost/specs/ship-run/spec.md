## ADDED Requirements

### Requirement: A run SHALL record cache-token figures alongside its output-token spend

The trajectory SHALL record, per wave and for the run as a whole, the cache-read and cache-creation input tokens attributable to that span, so that the cost of a re-written prefix is answerable from the corpus rather than inferred. Cache-creation figures SHALL be recorded split by the lifetime tier the host reports them under, because a prefix written for five minutes and one written for an hour are priced differently and a single total conflates them.

The figures SHALL be sourced from the host's own usage accounting, never estimated and never derived by subtraction from a total. Like the output-token figure they cover, they are a span aggregate that includes the orchestrator's own turns; the specification SHALL NOT claim per-agent or per-lane attribution, which no host exposes.

#### Scenario: Happy path — a wave records what it read from cache and what it wrote

- **GIVEN** a run on a host whose usage envelope carries cache accounting
- **WHEN** a wave closes
- **THEN** the trajectory carries that wave's cache-read token figure and its cache-creation token figure
- **AND** the cache-creation figure is recorded split by the lifetime tier the host reported

#### Scenario: Failure — a cache figure is not derived by arithmetic on other figures

- **GIVEN** a host that reports a total input-token figure but no cache breakdown
- **WHEN** the wave's figures are recorded
- **THEN** no cache-read or cache-creation figure is computed by subtracting one reported figure from another
- **AND** the cache figures are recorded as absent

#### Scenario: Edge case — a wave that read entirely from cache records a real zero for creation

- **GIVEN** a wave whose every spawn hit a warm prefix
- **WHEN** its figures are recorded
- **THEN** the cache-creation figure recorded is the measured zero
- **AND** it is distinguishable in the record from a wave whose host could not report the figure at all

### Requirement: A host without cache accounting SHALL record unknown, not zero

Where a host's runtime exposes no cache accounting, the cache figures SHALL be recorded as absent and the host's inability to supply them SHALL be visible to a reader of the run's summary as well as to a reader of the trajectory. A host that cannot measure cache behaviour MUST NOT record `0`, and MUST NOT omit the figures in a way indistinguishable from a run that measured and found none.

This SHALL be stated as a declared difference between hosts, not left to be inferred from missing data. A run whose host cannot report cache figures SHALL say so in its summary, on the same footing as any other degradation.

#### Scenario: Happy path — a host with cache accounting records real figures

- **GIVEN** a run on a host whose usage envelope carries cache-read and cache-creation fields
- **WHEN** the run closes
- **THEN** the recorded cache figures are present and non-negative

#### Scenario: Failure — a host without cache accounting is spoken, not silently empty

- **GIVEN** a run on a host whose runtime exposes only a cumulative scalar with no cache decomposition
- **WHEN** the run closes
- **THEN** the cache figures are recorded as absent
- **AND** the run's summary names the host's inability to report them
- **AND** a reader can distinguish this from a run that measured and found no cache activity

#### Scenario: Edge case — a host that reports cache fields inconsistently degrades rather than failing

- **GIVEN** a run whose host supplies cache fields for some spawns and omits them for others
- **WHEN** the affected waves close
- **THEN** those waves record their cache figures as absent
- **AND** the run continues without failing on account of the missing measurement

### Requirement: A run SHALL record the host session identifier that produced it

The trajectory SHALL record the identifier of the host session under which the run executed, so that a run joins to the host's own transcript by a key rather than by overlapping wall-clock timestamps. Timestamp overlap is not an identity: concurrent sessions in one project produce overlapping windows that cannot be told apart without reading their contents.

Where the host exposes no session identifier, the field SHALL be recorded as absent under the same unknown-not-zero rule that governs every other host-supplied figure. A run SHALL NOT fail, halt, or degrade its behaviour on account of a missing session identifier.

#### Scenario: Happy path — a run records the session it ran under

- **GIVEN** a run started on a host that exposes a session identifier
- **WHEN** the run's opening event is recorded
- **THEN** that event carries the host session identifier
- **AND** a reader can select the host transcript for that run without consulting timestamps

#### Scenario: Failure — an absent identifier is recorded as absent, not fabricated

- **GIVEN** a run on a host that exposes no session identifier
- **WHEN** the run's opening event is recorded
- **THEN** the session identifier is recorded as absent
- **AND** no substitute value is synthesised from the run identifier, the process id, or the timestamp

#### Scenario: Edge case — a missing session identifier does not make a run unreconstructable

- **GIVEN** a trajectory whose opening event carries no session identifier
- **WHEN** the run is checked for reconstructability
- **THEN** the absence alone does not render the run unreconstructable
- **AND** the run's exit code is unaffected
