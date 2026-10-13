## ADDED Requirements

### Requirement: The per-capability report SHALL be the audit's JSON output, and its text output SHALL list where to look

The measures the audit owes for each capability, computed by `lib/spec-audit.mjs`, SHALL all be in the `--json` output under `capabilities`, for every capability, flagged or not. Without `--json`, `interlock spec-audit` SHALL print a summary in this order: the repository totals; each flagged capability with its flags, or that none is flagged; each requirement that states neither `SHALL` nor `MUST`, when there is one; each numeric literal in requirement prose with its spec, line and value; and the two graph measures, or the reason they were not measured. The text output SHALL NOT print a row for a capability that carries no flag. Documentation that describes the text output SHALL describe those parts and SHALL NOT promise a per-capability table or a list of path literals.

Rationale: the audit is read to find where to look. A table of every capability buries the flagged ones, and the complete figures are one flag away for a reader who wants them.

#### Scenario: Happy path — a corpus with one flagged capability

- **GIVEN** three capabilities of which one states no bound or prohibition
- **WHEN** `interlock spec-audit` runs without `--json`
- **THEN** it prints the totals over three specs and one flagged capability with its flag
- **AND** the two unflagged capabilities have no row

#### Scenario: Failure — an unflagged capability is not lost

- **GIVEN** the same corpus
- **WHEN** `interlock spec-audit --json` runs
- **THEN** `capabilities` holds three entries, each with its own measures

#### Scenario: Edge case — no flag anywhere, and no graph

- **GIVEN** a corpus in which no capability is flagged, in a repository with no graph
- **WHEN** the text output is printed
- **THEN** the flags part says none is flagged
- **AND** each graph measure is printed with the reason it was not measured, never as zero
