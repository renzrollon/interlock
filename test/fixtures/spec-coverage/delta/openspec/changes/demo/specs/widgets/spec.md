## ADDED Requirements

### Requirement: Widgets SHALL be created by `./lib/new.mjs`

A new widget path SHALL be created by the new module, and ./lib/kept.mjs SHALL
keep serving the old one.

#### Scenario: Happy path — a widget is created

- **WHEN** a widget is created
- **THEN** it is returned
