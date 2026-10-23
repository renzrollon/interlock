## Purpose

Defines when `interlock-graph update` must rebuild the graph rather than report it current: a graph built by a different schema or extractor, or built before an OpenSpec or memory input changed, is stale and is rebuilt with the reason named.

## ADDED Requirements

### Requirement: An update SHALL rebuild a graph whose recorded schema or extractor differs from the current one

The graph's manifest SHALL record the schema version and the extractor that built it. `interlock-graph update` SHALL rebuild in two cases:

- a manifest that records neither field;
- a manifest whose recorded value differs from the current one.

In both cases it SHALL print a reason naming what differed.

#### Scenario: Failure — a graph built by an older release

- **GIVEN** a graph and manifest written by a build that recorded no schema version
- **WHEN** `interlock-graph update` runs with no source file changed
- **THEN** the graph is rebuilt and the printed reason says the manifest predates the schema record
- **AND** the output never says the graph is up to date

### Requirement: An update SHALL rebuild when an OpenSpec or memory input changed

The manifest SHALL record a content hash for every OpenSpec and memory file the graph's overlays read. `interlock-graph update` SHALL rebuild when any of those files is added, removed or changed, and SHALL print how many changed.

#### Scenario: Failure — an edited living spec

- **GIVEN** a current graph
- **WHEN** a file under `openspec/specs/` is edited and `interlock-graph update` runs
- **THEN** the graph is rebuilt and the reason counts one changed overlay input

#### Scenario: Happy path — nothing changed

- **GIVEN** a current graph and no changed source, OpenSpec or memory file
- **WHEN** `interlock-graph update` runs
- **THEN** it reports the graph up to date and does not rebuild
