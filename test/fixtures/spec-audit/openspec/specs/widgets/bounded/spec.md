# widgets/bounded Specification

## Purpose

Keeps a fixture capability that carries every invariant the audit looks for.

## Requirements

### Requirement: The widget cache SHALL evict old entries

The cache SHALL hold at most 8 entries and SHALL evict the oldest when a ninth arrives.
It SHALL NOT grow past the limit.

#### Scenario: Happy path — a hit is served

- **GIVEN** a cache holding one entry
- **WHEN** the entry is read
- **THEN** it is returned

#### Scenario: Failure — a miss is reported

- **GIVEN** an empty cache
- **WHEN** an entry is read
- **THEN** the miss is reported

#### Scenario: Edge case — the ninth entry

- **GIVEN** a cache holding 8 entries
- **WHEN** a ninth is added
- **THEN** the oldest is evicted

### Requirement: Widgets MUST be named

Every widget MUST carry a name of at least 3 characters.

#### Scenario: Happy path — a named widget

- **WHEN** a widget named `abc` is created
- **THEN** it is accepted
