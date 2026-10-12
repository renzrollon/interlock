# widgets Specification

## Purpose

Builds widgets.

## Requirements

### Requirement: Widgets SHALL be built by `lib/widget.mjs`

A widget SHALL be assembled in one place.

The quoted form "lib/quoted.mjs" names a file, and so does a bare mention:
lib/bare.mjs holds the cache.

Background reading lives at https://example.com/lib/url-only.mjs and does not
name a file of this repository.

#### Scenario: Happy path — a widget is built

- **WHEN** a widget is requested
- **THEN** it is returned
