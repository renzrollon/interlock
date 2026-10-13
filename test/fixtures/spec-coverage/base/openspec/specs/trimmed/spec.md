# trimmed Specification

## Purpose

Was larger at the base.

## Requirements

### Requirement: Trimming SHALL be explicit

A trim SHALL name what it removes, and `lib/trimmed.mjs` SHALL do the removing.

#### Scenario: Happy path — a trim is explicit

- **WHEN** a trim runs
- **THEN** it names what it removed
