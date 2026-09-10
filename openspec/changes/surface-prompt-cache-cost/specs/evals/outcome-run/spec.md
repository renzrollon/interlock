## ADDED Requirements

### Requirement: The eval's own model loop SHALL request caching for the prefix it measures

The outcome eval tallies the cache-read and cache-creation tokens its own model requests report. Those tallies are only a measurement if the eval asked for caching in the first place: the provider writes a cache entry only where the request marks one, so a loop that marks none reports a zero that means "never asked", indistinguishable from "asked and missed".

The eval's model loop SHALL mark its stable prefix — the portion that does not change between turns of one loop — as cacheable, so that its recorded cache tallies reflect cache behaviour. The eval SHALL NOT report a cache tally it did not request the conditions for.

#### Scenario: Happy path — a multi-turn loop reads its prefix from cache after the first turn

- **GIVEN** an eval loop that issues several model requests sharing one stable prefix
- **WHEN** the loop runs
- **THEN** the first request records cache creation for that prefix
- **AND** later requests record cache reads rather than re-creating it

#### Scenario: Failure — a loop that marks no cacheable prefix is a defect, not a zero result

- **GIVEN** an eval model loop that issues requests without marking any prefix cacheable
- **WHEN** the eval's tallies are inspected
- **THEN** the recorded cache-read tally is zero for structural reasons rather than measured ones
- **AND** this is a defect in the apparatus, not a finding about the loop under test

#### Scenario: Edge case — a prefix too short to cache is reported as unmeasured, not as a miss

- **GIVEN** a loop whose stable prefix falls below the provider's minimum cacheable size
- **WHEN** the provider writes no cache entry
- **THEN** the eval does not report the resulting zero as a cache miss
- **AND** the condition is distinguishable from a prefix that was cacheable and was not reused
