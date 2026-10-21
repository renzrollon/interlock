## Purpose

Makes an agent-resolved decision an audited claim rather than a declared one: it must carry a written resolution, followable evidence, and a reference to the design document that records it. An absent ledger is a failure of the audit, not an empty result, because an empty result reads as "nothing needs a human".

## ADDED Requirements

### Requirement: An agent-resolved row SHALL reference the design document by id

A row claiming an agent resolved a decision SHALL carry a reference identifying where in the change's design document the resolution is recorded, and that reference SHALL be resolvable in that document. A row whose reference cannot be found SHALL be invalid and SHALL block exactly as an unresolved row does.

#### Scenario: Happy path — a resolvable reference validates the row

- **GIVEN** an agent-resolved row carrying a written resolution, evidence, and a reference id
- **AND** a design document containing that id
- **WHEN** the ledger is audited
- **THEN** the row is valid and does not block

#### Scenario: Failure — a reference that appears nowhere in the design document

- **GIVEN** an agent-resolved row whose reference id does not appear in the change's design document
- **WHEN** the ledger is audited
- **THEN** the row is invalid, the audit names the row and the missing id, and the audit exits non-zero
- **AND** the row blocks continuity exactly as a row needing a human would

#### Scenario: Edge case — the design document is absent or unreadable

- **GIVEN** an agent-resolved row carrying a reference id
- **AND** a change whose design document is missing or cannot be parsed
- **WHEN** the ledger is audited
- **THEN** the reference is treated as unresolvable and the row is invalid
- **AND** an unreadable design document SHALL NOT be treated as one that contains every id

### Requirement: Hedges that assert nothing SHALL count as no evidence

A cell whose content asserts nothing — a blank, a dash placeholder, or a word that claims self-evidence rather than giving evidence — SHALL be treated as empty. An agent-resolved row resting on such a cell SHALL be invalid.

#### Scenario: Happy path — a followable citation counts as evidence

- **GIVEN** an agent-resolved row whose evidence names a file and location a reader can follow
- **WHEN** the ledger is audited
- **THEN** the evidence cell is accepted

#### Scenario: Failure — a self-evidence claim does not clear the audit

- **GIVEN** an agent-resolved row whose evidence cell asserts that the answer is obvious, or is otherwise a hedge meaning the same as blank
- **WHEN** the ledger is audited
- **THEN** the cell is treated as empty, the row is invalid, and the audit exits non-zero

#### Scenario: Edge case — a hedge differing only in casing, whitespace or punctuation

- **GIVEN** evidence cells whose content matches a rejected hedge except for letter casing, surrounding whitespace, or a trailing period
- **WHEN** the ledger is audited
- **THEN** each resolves to the same canonical empty value and is rejected
- **AND** a cell that merely contains a rejected word inside a longer, substantive citation is accepted

### Requirement: An absent ledger SHALL be a failure, not an empty result

Auditing a change that has no decision ledger SHALL exit non-zero and say the ledger is missing. It SHALL NOT report an empty ledger and succeed.

#### Scenario: Happy path — a present ledger with no unresolved rows succeeds

- **GIVEN** a change whose ledger exists and whose every row is valid and resolved
- **WHEN** the ledger is audited
- **THEN** the audit exits zero and reports that no decision awaits a human

#### Scenario: Failure — a missing ledger exits non-zero

- **GIVEN** a change with no decision ledger file
- **WHEN** the ledger is audited
- **THEN** the audit exits non-zero and reports the ledger as missing rather than as empty
- **AND** the reported reason distinguishes "missing" from "present and empty"

#### Scenario: Edge case — a ledger present but containing no rows

- **GIVEN** a change whose ledger file exists, carries its heading, and contains no decision rows
- **WHEN** the ledger is audited
- **THEN** the outcome is reported distinguishably from a missing ledger
- **AND** an unparseable ledger is reported as unparseable rather than as containing no rows
