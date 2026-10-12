# gadgets Specification

## Purpose

A fixture capability that probes the counting rules at their boundaries.

## Requirements

### Requirement: Gadgets SHALL be switched with care

The switch nevertheless SHALL stay reachable; the code `retry(3)` is quoted here.
A gadget SHALL answer within 250 ms using utf8 labels.
Gadgets must never be dropped silently.

#### Scenario: Failure — a dropped gadget

- **GIVEN** a gadget that was dropped
- **WHEN** the console reads 42 gadgets
- **AND** the line is checked
- **THEN** the console shall not hide it

#### Scenario: Happy path — a switch

- **GIVEN** a gadget
- **WHEN** it is switched
- **THEN** it answers
