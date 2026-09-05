## ADDED Requirements

### Requirement: Byte counts and durations format to a fixed scale

The package SHALL format a byte count and a millisecond duration into a
human-readable string, printing the base unit as an integer and every larger
unit to exactly one decimal place.

#### Scenario: Happy path — a byte count scales

- **WHEN** `formatBytes` is given 512, 2048 and 5242880
- **THEN** it returns `512 B`, `2.0 KB` and `5.0 MB`

#### Scenario: Happy path — a duration scales

- **WHEN** `formatDuration` is given 250, 1500 and 90000
- **THEN** it returns `250 ms`, `1.5 s` and `1.5 min`

### Requirement: A summary composes the formatters rather than repeating them

The package SHALL expose a summary that joins a formatted byte count and a
formatted duration, and it SHALL obtain both from the formatters rather than
formatting either itself, so that a rounding change has one site.

#### Scenario: Happy path — a summary reads as one line

- **WHEN** the summary is given 2048 bytes and 1500 milliseconds
- **THEN** it returns `2.0 KB in 1.5 s`

### Requirement: The documented surface matches the exported surface

The README SHALL carry an `## API` section naming every public export.

#### Scenario: Failure — an undocumented export is a defect

- **WHEN** an export is added without being named in the `## API` section
- **THEN** the suite reports it, rather than the documentation drifting silently
