## ADDED Requirements

### Requirement: Cache accounting SHALL be a separately declared host capability

Reporting cache tokens is not implied by reporting token usage: a host may expose a cumulative spend scalar while exposing no cache decomposition at all. Each host adapter SHALL therefore declare cache accounting as its own capability, separate from the usage capability it already declares, and the declaration SHALL be recorded in the run manifest alongside the host's other declared capabilities.

The run program SHALL branch on the declared capability rather than on the host's id or name, so that a host gaining or losing cache accounting changes one declaration and nothing else. A run on a host that does not declare it SHALL be bannered — a host that could not be bannered is a run that degraded silently.

#### Scenario: Happy path — a host that reports cache fields declares the capability and records figures

- **GIVEN** an adapter whose vendor CLI returns a usage envelope carrying cache-read and cache-creation fields
- **WHEN** a run starts on that host
- **THEN** the manifest records cache accounting among that host's declared capabilities
- **AND** the run's recorded cache figures are present

#### Scenario: Failure — a host without the capability is bannered, not silently empty

- **GIVEN** an adapter whose runtime exposes only a cumulative spend scalar
- **WHEN** a run executes on that host
- **THEN** the manifest records cache accounting as undeclared for that host
- **AND** the run banners that cache figures are unavailable on this host
- **AND** the banner is carried into the run's summary

#### Scenario: Edge case — the capability is read from the declaration, never from the host's identity

- **GIVEN** two adapters, one declaring cache accounting and one not
- **WHEN** the run program decides whether to expect cache figures
- **THEN** the decision reads the declared capability
- **AND** no branch is taken on the adapter's id or display name

### Requirement: A usage envelope's cache fields SHALL be carried through unchanged or not at all

Where an adapter parses a host's usage envelope, it SHALL carry the cache figures through with the tier distinction the host reported them under intact, or carry none of them. An adapter MUST NOT flatten distinct lifetime tiers into a single cache-creation total, and MUST NOT substitute a zero for a field the envelope omitted.

An envelope that is present but unparseable SHALL be treated as a host that did not report, not as a host that reported nothing.

#### Scenario: Happy path — tiers survive the parse

- **GIVEN** a usage envelope reporting cache creation split across two lifetime tiers
- **WHEN** the adapter parses it
- **THEN** both tier figures are carried through separately
- **AND** neither is summed into the other

#### Scenario: Failure — an omitted field is not read as a zero

- **GIVEN** a usage envelope that carries a cache-read figure and omits cache creation entirely
- **WHEN** the adapter parses it
- **THEN** the cache-read figure is carried through
- **AND** the cache-creation figure is carried as absent rather than as zero

#### Scenario: Edge case — an unparseable envelope degrades to unreported

- **GIVEN** a spawn whose usage envelope cannot be parsed
- **WHEN** the adapter reports that spawn's figures
- **THEN** the cache figures are reported as absent
- **AND** the spawn's other recorded outcomes are unaffected
