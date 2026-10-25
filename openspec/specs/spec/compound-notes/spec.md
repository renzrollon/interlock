# spec/compound-notes Specification

## Purpose

A per-repository table of the surprises a review found about this repository's own invariants and the rule each implies, so the next spec on the same files starts from what the last ship learned. Rows are derived from findings a reviewer marked as a gap the spec should have stated, written by the two places findings are adjudicated, retrieved by file path, and never edited by a machine.

## Requirements

### Requirement: The note table SHALL follow a stable contract a sibling of the ledger's

The contract SHALL live in `shared/COMPOUND-NOTES.md`. The table SHALL live at `docs/notes/compound.md` under a `# Compound notes` heading, with the columns `id | date | change | file | surprise | rule | source` in that order. `id` SHALL be `N1`, `N2`, … unique and never reused; `date` an ISO date; `change` the change name whose review produced the row; `file` one repository-relative path, as `canonicalizePath` in `lib/risk.mjs` writes it; `surprise` one sentence saying what the review found that the spec had not stated; `rule` one imperative sentence a future spec can follow; `source` the findings file path or the ship run id the row came from. `—` SHALL mean an empty cell, and a literal `|` SHALL be escaped as `\|`. `lib/notes.mjs` SHALL export `parseNotes(text)` returning `{ rows, problems }`, where `rows` holds the well-formed rows in table order and `problems` lists every other row with its line number and reason (the wrong column count, a missing `id`, `file` or `rule`, a repeated `id`), so a malformed row is never dropped silently and never read as a note; `renderNotes(rows)`; and `appendNotes(root, rows)`, which SHALL create the file with its heading when absent, append rows with the next free ids, and skip a row whose `change`, `file` and `rule` match a row already present, reporting the skipped count. The row-splitting and separator helpers SHALL be lifted from `lib/ledger.mjs` into `lib/md-table.mjs` and used by both parsers, so the two formats cannot drift in how they read a cell.

#### Scenario: Happy path — three rows parse and a fourth is appended

- **GIVEN** `docs/notes/compound.md` with rows N1–N3
- **WHEN** `appendNotes(root, [{ change: 'add-x', file: 'lib/a.mjs', surprise: '…', rule: 'Name every reader of the raw form.', source: '.claude/metrics/review-code-add-x-20261019.json' }])` runs
- **THEN** the file carries N4 with today's date and the given cells
- **AND** `parseNotes` of the result returns four rows and no problems

#### Scenario: Failure — a row with six cells

- **GIVEN** a table whose third row lacks its `source` cell
- **WHEN** `parseNotes` runs
- **THEN** `problems` names line 3 and the reason `expected 7 cells, found 6`
- **AND** `rows` carries the other rows and not the malformed one, which is listed under `problems` and nowhere else

#### Scenario: Edge case — the same rule twice

- **GIVEN** a table holding N2 for `add-x`, `lib/a.mjs`, rule R
- **WHEN** `appendNotes` is given a row with the same change, file and rule
- **THEN** nothing is appended and the result reports `skipped: 1`
- **AND** the file is byte-identical to before

### Requirement: Rows SHALL be derived from findings that carry specGap, and the field SHALL be optional and never gate anything

`FINDING_SCHEMA` in `lib/findings.mjs` SHALL gain an optional boolean `specGap`, described as "the finding's root cause is a requirement no spec stated". `resolveReview` in `lib/review-core.mjs` SHALL pass a boolean value through unchanged. A non-boolean value SHALL be listed under a new non-blocking `anomalies.specGapShape` entry beside `anomalies.requirementCitations`, naming the finding and the value's type; the finding SHALL be kept, the field SHALL be read as absent, and `evaluateGate`'s `malformed` list and `passed` verdict SHALL be the same for any value of the field, including a non-boolean one, so a reviewer's typo on an advisory field can never block a review. `lib/notes.mjs` SHALL export `deriveNotes(findings, { change, source, date })`, which SHALL produce one row per surviving finding whose `specGap` is `true`, with `file` from the finding's `file`, `surprise` from its `title`, and `rule` from its `suggestion` when present, otherwise the first sentence of its `description`, stored as-is for a person to reword later; findings without `specGap: true` SHALL produce nothing. The finding shape shown to reviewers in `lib/prompts/review.mjs` and in `skills/review-code/SKILL.md` §2 SHALL list `specGap` as optional. The domain and technical-lead dimension briefs under `skills/review-code/dimensions/` SHALL instruct the reviewer to set `specGap: true` on a finding whose root cause is a requirement the living specs and the change's delta specs never stated, and only then; the other dimension briefs SHALL not mention it. `test/skills.test.mjs` SHALL pin the `specGap` token in those two briefs and in `skills/review-code/SKILL.md` §2, and its absence from the other dimension briefs.

#### Scenario: Happy path — two of five survivors carry specGap

- **GIVEN** five surviving findings, two with `specGap: true`, one with `specGap: false`, two without the field
- **WHEN** `deriveNotes(findings, { change: 'add-x', source: 'run-123', date: '2026-10-19' })` runs
- **THEN** two rows are returned, each with the finding's `file`, its `title` as `surprise` and its `suggestion` as `rule`
- **AND** the three others produce nothing

#### Scenario: Failure — specGap is the string "yes"

- **GIVEN** a findings set in which one warning carries `specGap: "yes"`
- **WHEN** the review is resolved and the gate evaluated
- **THEN** the finding is kept, `anomalies.specGapShape` names it with `specGap is not a boolean`, and `evaluateGate` returns the same `passed`, `blockers` and `malformed` it returns for the identical set with `specGap: true`, `specGap: false` or no field
- **AND** `deriveNotes` treats it as not a gap

#### Scenario: Edge case — a specGap finding with no suggestion

- **GIVEN** a `specGap: true` finding with `description` and no `suggestion`
- **WHEN** `deriveNotes` runs
- **THEN** the row's `rule` is the description's first sentence, stored as-is
- **AND** the row is otherwise as any other

### Requirement: The two writers SHALL append after adjudication, non-fatally, and say when they could not

`interlock note derive --findings <file> --change <change> [--source <text>] [--json]` SHALL run `deriveNotes` over the file's findings and `appendNotes` on the result, printing the appended and skipped counts, or `COMPOUND NOTES NOT WRITTEN: <reason>` when the table could not be written, and SHALL exit 0 in both cases; a findings input that carries no findings list SHALL be refused as the evidence gate refuses it. `interlock note add --change <c> --file <f> --surprise "<s>" --rule "<r>" [--source <text>] [--json]` SHALL append one row by hand with the same output. `interlock note match <change> [--paths a,b] [--json]` SHALL print the rows whose `file`, canonicalized, equals a path `specMentionedPaths(tasks.md)` of the change returns, or a path given with `--paths`, capped at `LIMITS.maxAdvisorNoteRows` rows with the omitted count named. `skills/review-code/SKILL.md` §4 SHALL run the derive line after the gate line, with the survivors file and the change name. `lib/run.mjs`'s review adjudication SHALL derive and append notes from the survivors after it writes the review metrics, placing `COMPOUND NOTES NOT WRITTEN: <reason>` in the degradation banners when the append fails, and SHALL never change the exit code for it. When a note was appended, the run SHALL carry the table's path onto the manifest and the commit brief's input SHALL name it as a file the run touched, so the brief's existing rule to stage only touched files stages it; no new staging rule is added. `docs/04-when-it-stops.md` SHALL carry a `###` section for that banner.

#### Scenario: Happy path — the ship loop appends two notes

- **GIVEN** a ship run whose review survivors carry two `specGap: true` findings
- **WHEN** the review is adjudicated
- **THEN** `docs/notes/compound.md` gains two rows whose `source` is the run id and whose `change` is the run's change
- **AND** the commit brief names `docs/notes/compound.md` among the files the run touched, the commit stage stages it with the rest, and no banner is printed

#### Scenario: Failure — the table's directory is read-only

- **GIVEN** `docs/notes/` cannot be written
- **WHEN** adjudication derives one note
- **THEN** the degradation banners carry `COMPOUND NOTES NOT WRITTEN: <reason>`, the run's exit code is what it would have been, and the commit brief names no note table
- **AND** `interlock note derive` on the same input prints the same banner and exits 0

#### Scenario: Edge case — no survivor carries specGap

- **GIVEN** survivors with no `specGap: true`
- **WHEN** `interlock note derive --findings <f> --change add-x --json` runs
- **THEN** it prints `appended: 0`, `skipped: 0`, writes nothing and creates no file
- **AND** a `--findings` file with no findings list is refused with the evidence gate's message

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
