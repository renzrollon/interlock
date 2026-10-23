## MODIFIED Requirements

### Requirement: Retrieval SHALL match by canonical path and be bounded

`matchNotes(rows, paths)` in `lib/notes.mjs` SHALL return the rows whose `file`, after `canonicalizePath`, equals one of `paths` after the same canonicalization, in table order. It SHALL return `{ rows, omitted }` cut at `LIMITS.maxNoteMatchRows` whole rows, with `omitted` the count left out.

`interlock note match <change> [--paths a,b] [--json]` SHALL print exactly what `matchNotes` returns for `specMentionedPaths(tasks.md)` plus any `--paths`, and SHALL name the omitted count when it is not zero. Its JSON SHALL carry `change`, `rows`, `omitted` and `unreadable`.
- A `docs/notes/compound.md` that is absent SHALL read as no rows.
- One that is present and unparseable SHALL make the command exit non-zero naming the file and the reason, and SHALL never read as empty.
- One that parses with problems SHALL contribute its well-formed rows. `unreadable` SHALL be the count of malformed rows, and the text output SHALL say `compound notes: <n> rows unreadable` when that count is not zero.

The spec skill SHALL run this command after `tasks.md` is written and before its ledger audit, and SHALL read the matched rows' rules against the change's design and tasks. When the command exits non-zero, the skill SHALL report its first output line and continue: retrieval informs the spec and never gates it. Nothing else SHALL be required to read the table.

#### Scenario: Happy path — two of nine rows name files the tasks name

- **GIVEN** nine rows and a `tasks.md` naming `lib/a.mjs` and `./lib/b.mjs`
- **WHEN** `interlock note match "<change>" --json` runs
- **THEN** the two rows whose `file` is `lib/a.mjs` or `lib/b.mjs` are returned in table order, `omitted` is 0 and `unreadable` is 0

#### Scenario: Edge case — no table has been written yet

- **GIVEN** a repository with no `docs/notes/compound.md`, and a `tasks.md` naming `lib/a.mjs`
- **WHEN** `interlock note match "<change>" --json` runs
- **THEN** it exits 0 with `rows` empty, `omitted` 0 and `unreadable` 0
- **AND** the spec skill reads that as no matched rules and continues to its ledger audit

#### Scenario: Failure — the table is unparseable

- **GIVEN** `docs/notes/compound.md` whose header row is missing
- **WHEN** `interlock note match "<change>" --json` runs
- **THEN** the command exits non-zero and its first output line names `docs/notes/compound.md` and the reason
- **AND** no row list is printed that could read as an empty table

#### Scenario: Failure — one row of four is malformed

- **GIVEN** a table of four rows, the third with six cells, two of the well-formed rows matching paths the tasks name
- **WHEN** `interlock note match "<change>"` runs
- **THEN** it prints the two matched rows and one line `compound notes: 1 rows unreadable`
- **AND** with `--json`, `rows` has two entries and `unreadable` is 1

#### Scenario: Edge case — more matches than the cap

- **GIVEN** thirty matching rows and `LIMITS.maxNoteMatchRows` of 20
- **WHEN** `matchNotes` runs
- **THEN** the first twenty rows in table order are returned and `omitted` is 10
- **AND** `interlock note match` says `10 more omitted (over the matched-notes cap)`
