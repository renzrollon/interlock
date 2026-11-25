# Spec Delta

## ADDED Requirements

### Requirement: An `unread` entry SHALL be able to name the changed files it is about

An `unread` entry MAY carry `paths`, a list of repository paths naming the changed files the entry is about, beside `input` and `reason`. The review record SHALL keep `paths` under that dimension's coverage. A `paths` value that is not a non-empty list of non-empty strings SHALL be dropped and the entry read as one with no `paths`; it SHALL NOT reject the ledger or record the dimension unproven.

#### Scenario: Happy path — the files an entry names are kept in the record

- **GIVEN** a `technical-lead` answer whose `unread` entry is `{ input: "docs edits", reason: "prose-only edits, not opened", paths: ["docs/04-when-it-stops.md", "docs/10-agentic-workflow-ship-and-spec.md"] }`
- **WHEN** `interlock review` reads it and writes the record
- **THEN** the record's coverage for `technical-lead` holds that entry with its `input`, its `reason` and both paths

#### Scenario: Failure — a `paths` value of the wrong shape is dropped and is not a ledger fault

- **GIVEN** three answers whose `unread` entry carries, in turn, `paths: "docs/a.md"`, `paths: []` and `paths: ["docs/a.md", 3]`, with `docs/a.md` a changed documentation file
- **WHEN** `interlock review` reads each
- **THEN** it exits 0 with no `LEDGER REJECTED:` line, and no dimension is unproven for it
- **AND** each entry is recorded with no `paths` and named under `proof.unread`, so `proof.proven` is false

#### Scenario: Edge case — an entry with no `paths` reads as it always did

- **GIVEN** a `technical-lead` answer with checked entries and an `unread` entry `{ input: "delta specs", reason: "not opened" }`
- **WHEN** the record is written
- **THEN** `proof.unread` names `technical-lead` with that entry, `proof.proseUnread` is empty, and `proof.proven` is false

#### Scenario: Edge case — a re-run keeps the first entry for an input, with or without its files

- **GIVEN** a draft whose `regression` recorded the `unread` input `docs edits` with no `paths` and is the uncited target, and a re-run that records `docs edits` again with `paths: ["docs/a.md"]`
- **WHEN** the next draft is written with `--rerun-of`
- **THEN** `regression`'s `unread` lists `docs edits` once, without `paths`, and the entry is still named under `proof.unread`

### Requirement: An `unread` entry SHALL be prose-only when every file it names is changed prose that no brief requires

An `unread` entry SHALL be prose-only when it carries `paths` and every path, in canonical form, is a file the proof counts as changed, is classed prose as the size signal classes a path, and is not required prose. Required prose SHALL be any path under `openspec/` or `.claude/`, and the review policy file. An entry that fails any part SHALL stay under `unread`, whole.

#### Scenario: Happy path — two changed documentation files

- **GIVEN** a diff that changes `lib/a.mjs`, `docs/04-when-it-stops.md` and `docs/10-agentic-workflow-ship-and-spec.md`, and a `technical-lead` answer that cites `lib/a.mjs` and whose only `unread` entry names the two files under `docs/`
- **WHEN** the record is written
- **THEN** `proof.proseUnread` names `technical-lead` with that entry, `proof.unread` is empty and `proof.proven` is true

#### Scenario: Failure — the change's delta specs stay unread

- **GIVEN** a diff that changes `lib/a.mjs`, `openspec/changes/a-change/specs/waves/spec.md` and `openspec/changes/a-change/decisions.md`, and a `technical-lead` answer that cites `lib/a.mjs` and whose only `unread` entry names the two files under `openspec/`
- **WHEN** the record is written
- **THEN** `proof.unread` names `technical-lead` with that entry, `proof.proseUnread` is empty and `proof.proven` is false

#### Scenario: Failure — the PR #43 round-1 record stays unproven

- **GIVEN** the two `technical-lead` entries of the PR #43 round-1 review, each carrying under `paths` the files it describes: the two changed files under `docs/`, and the change's delta specs with its `decisions.md`
- **WHEN** the record is written against that review's changed files
- **THEN** the first entry is under `proof.proseUnread`, the second is under `proof.unread`, and `proof.proven` is false

#### Scenario: Edge case — the review context, the policy file, a living spec and an archived change are required prose

- **GIVEN** a diff that changes `.claude/graph/REVIEW_CONTEXT.md`, `REVIEW.md`, `openspec/specs/review/review-proof/spec.md` and `openspec/changes/archive/2026-11-13-a-change/design.md`, and four `unread` entries that each name one of them
- **WHEN** the record is written
- **THEN** all four entries are under `proof.unread` and `proof.proseUnread` is empty

#### Scenario: Edge case — one file that is not prose keeps the whole entry unread

- **GIVEN** an `unread` entry naming `docs/a.md` and `test/spine/a.test.mjs`, both changed
- **WHEN** the record is written
- **THEN** the entry is under `proof.unread` with both paths, and `proof.proseUnread` is empty

#### Scenario: Failure — a file the diff does not change, and a directory

- **GIVEN** two `unread` entries naming, in turn, `docs/unchanged.md`, which the diff does not change, and `docs/`, under which the diff changes two files
- **WHEN** the record is written
- **THEN** each entry is under `proof.unread` and `proof.proseUnread` is empty

#### Scenario: Edge case — a path is matched in canonical form

- **GIVEN** an `unread` entry naming `./docs/a.md`, for a diff whose changed list holds `docs/a.md`
- **WHEN** the record is written
- **THEN** the entry is under `proof.proseUnread`

### Requirement: The proof SHALL class paths with the counts-as-source list the review was adjudicated by

`interlock review` SHALL class the files an entry names with the counts-as-source list of the review policy it read, from the base when `--base` is given, and a ship run's review step with the list of the policy it adjudicates by. When that policy reports a problem in its `## Counts as Source` section, or a problem that belongs to no path-list section, the list is not established and no entry SHALL be prose-only.

#### Scenario: Happy path — a listed path keeps its entry unread

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source`, a diff that changes `skills/settle/SKILL.md`, and an `unread` entry naming that file
- **WHEN** `interlock review --base <base>` writes the record, and again for a base with no such section
- **THEN** the first record names the entry under `proof.unread`
- **AND** the second names it under `proof.proseUnread`

#### Scenario: Failure — a pull request cannot take its own prose out of the proof

- **GIVEN** the same base, and a head whose `REVIEW.md` no longer lists `skills/`
- **WHEN** `interlock review --base <base>` writes the record
- **THEN** the entry naming `skills/settle/SKILL.md` is under `proof.unread`

#### Scenario: Failure — a section that could not be read in full lists nothing apart

- **GIVEN** a base whose `## Counts as Source` section holds the item `skills/**`, and an `unread` entry naming the changed file `docs/a.md`
- **WHEN** `interlock review --base <base>` writes the record
- **THEN** the entry is under `proof.unread`, `proof.proseUnread` is empty and `proof.proven` is false
- **AND** the review reports the policy problem as it does without the entry

#### Scenario: Edge case — a problem in another section changes nothing

- **GIVEN** a base whose `## Do Not Report` section holds a pattern item and whose `## Counts as Source` section is well formed, and an `unread` entry naming the changed file `docs/a.md`
- **WHEN** `interlock review --base <base>` writes the record
- **THEN** the entry is under `proof.proseUnread`

#### Scenario: Failure — a problem that belongs to no section lists nothing apart

- **GIVEN** a base whose `REVIEW.md` front matter sets `team: platform`, a key the policy does not accept, whose path-list sections are well formed, and an `unread` entry naming the changed file `docs/a.md`
- **WHEN** `interlock review --base <base>` writes the record
- **THEN** the entry is under `proof.unread`, `proof.proseUnread` is empty and `proof.proven` is false
- **AND** the review reports the front-matter problem as it does without the entry

#### Scenario: Edge case — a run's review record reads alike

- **GIVEN** a strict run whose reviewers each wrote a ledger citing every changed source file, in which `technical-lead` recorded one `unread` entry naming the changed file `docs/a.md`
- **WHEN** the run writes its review record and closes
- **THEN** the record's `proof.proseUnread` names `technical-lead` with that entry, `proof.proven` is true, and the close carries no `REVIEW NOT PROVEN` banner

### Requirement: `interlock review` and `interlock review proof` SHALL name what the proof listed apart

When a proof lists an entry under `proseUnread`, the `proof:` line of `interlock review` SHALL name each such dimension after the words `prose left unread`, and `interlock review proof` SHALL print, after its first line and any gap lines, one line per such dimension naming the files and the reason of each entry. The first line and the exit status SHALL be what the same record gives with nothing listed apart.

#### Scenario: Happy path — a proven record names the prose after `proven`

- **GIVEN** a record whose `proof.proven` is true and whose `proof.proseUnread` names `technical-lead` with one entry on `docs/a.md` and `docs/b.md`, reason `prose-only edits, not opened`
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0, its first line reads `proven`, and a later line names `technical-lead`, the words `prose left unread`, both files and the reason

#### Scenario: Happy path — the review's `proof:` line names the dimension

- **GIVEN** a diff that changes `lib/a.mjs` and `docs/a.md`, and a `technical-lead` answer that cites `lib/a.mjs` and whose only `unread` entry names `docs/a.md`
- **WHEN** `interlock review` prints its text output
- **THEN** its `proof:` line reads `proof: proven (1 of 1 changed source file(s) cited; prose left unread: technical-lead)`
- **AND** for the same answer with a second `unread` entry that carries no `paths`, the line reads `proof: not proven (0 unproven, 1 with unread inputs, 0 uncited; prose left unread: technical-lead)`

#### Scenario: Edge case — several dimensions and entries are joined in a fixed order

- **GIVEN** a proven record of a review that ran `language` before `technical-lead`, whose `proof.proseUnread` names `language` with one entry on `README.md`, reason `not opened`, and `technical-lead` with two entries: one on `docs/a.md` and `docs/b.md`, reason `prose-only edits, not opened`, then one on `docs/c.md`, reason `not opened`
- **WHEN** `interlock review proof` runs
- **THEN** the lines after `proven` are `language: prose left unread README.md (not opened)` and then `technical-lead: prose left unread docs/a.md, docs/b.md (prose-only edits, not opened); docs/c.md (not opened)`

#### Scenario: Edge case — a gap and prose left unread are both named

- **GIVEN** a record in which `technical-lead` has one entry under `proof.unread` and one under `proof.proseUnread`, with nothing unproven or uncited
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0 and its first line reads `PROOF LEFT UNREAD: technical-lead`
- **AND** the unread input follows with its reason, and the line naming the prose left unread follows that

#### Scenario: Failure — prose left unread names no dimension on the first line

- **GIVEN** a record in which `security` has an entry under `proof.unread` and `technical-lead` has entries under `proof.proseUnread` only
- **WHEN** `interlock review proof` runs
- **THEN** its first line reads `PROOF LEFT UNREAD: security`, and no line begins `re-run:`

#### Scenario: Edge case — a record with no such list prints as it always did

- **GIVEN** a proven record written before this change, which carries no `proseUnread`, and a review whose answers carry no `paths`
- **WHEN** `interlock review proof` runs on the record, and `interlock review` records the review
- **THEN** the first prints `proven` and nothing after it
- **AND** the second's `proof:` line holds no `prose left unread`

## MODIFIED Requirements

### Requirement: The review record SHALL carry a proof computed from the ledgers and the diff

`interlock review` SHALL record `proof` beside `dimensions`: `unproven` names each ran dimension whose ledger is absent or rejected, or that raised no finding and checked nothing; `unread` names each ran dimension with an `unread` entry that is not prose-only, with those entries; `proseUnread` names each ran dimension with a prose-only `unread` entry, with those entries, and SHALL NOT keep the proof from holding; `uncited` lists each changed coverable source file no ran dimension cited in a checked entry or a finding. Coverable means what the spec-coverage signal counts, plus an extensionless file directly under a `bin/` or `cli/` directory, which is source no coverage tool attributes. The changed files SHALL be the union of `--changed` and git's own list for `--base`, with a rename counted under its new path only; with neither, or when git cannot list `--base`, the proof SHALL NOT hold.

#### Scenario: Happy path — a proven review

- **GIVEN** a review whose every ran dimension checked something, with no `unread` entry, and whose ledgers and findings together cite every changed coverable source file
- **WHEN** the record is written
- **THEN** `proof.unproven`, `proof.unread` and `proof.uncited` are all empty and `proof.proven` is true

#### Scenario: Failure — the PR #28 record is unproven

- **GIVEN** the four dimension answers of the PR #28 round-0 review (`language`, `technical-lead`, `domain`, `blast-radius`, each `{ "findings": [] }` with no coverage) and its changed files
- **WHEN** the record is written
- **THEN** `proof.proven` is false, all four dimensions are named as unproven, and `lib/settle-meter.mjs`, `lib/spec-meter.mjs`, `lib/meter-palette.mjs` and `hooks/mod.mjs` are listed as uncited

#### Scenario: Edge case — a cited path outside the diff counts as checked but covers nothing

- **GIVEN** a dimension whose only `checked` entry cites a file the diff does not change
- **WHEN** the record is written
- **THEN** the dimension is not unproven, and no changed file is counted as cited by that entry

#### Scenario: Edge case — an unread input is recorded under unread

- **GIVEN** a `technical-lead` answer with checked entries and an `unread` entry `{ input: "delta specs", reason: "not opened" }`
- **WHEN** the record is written
- **THEN** `proof.unread` names `technical-lead` with that entry, and `proof.proven` is false

#### Scenario: Failure — no diff to prove against

- **GIVEN** a review run with neither `--changed` nor `--base`
- **WHEN** the record is written
- **THEN** `proof.proven` is false with the reason that no diff was given, and the record is still written

#### Scenario: Edge case — a carried dimension keeps its ledger

- **GIVEN** a scoped re-review that carries `language` from the round before, whose fixer then changed `lib/a.mjs` that `language`'s ledger cited
- **WHEN** the record is written
- **THEN** `language`'s ledger is the carried record's, its entries on files unchanged since the carried record's head still count, and its entries on `lib/a.mjs` cover nothing, so `lib/a.mjs` is uncited unless a dimension that ran this round cites it

#### Scenario: Edge case — a changed list that leaves a file out does not narrow the proof

- **GIVEN** `--changed lib/a.mjs` and `--base origin/main`, against which git also lists `lib/b.mjs`
- **WHEN** the record is written
- **THEN** both files are counted, and `lib/b.mjs` is uncited unless cited

#### Scenario: Edge case — a rename is counted under its new path

- **GIVEN** a branch whose only change is `git mv lib/a.mjs lib/b.mjs`, reviewed with `--changed lib/b.mjs --base <base>` and a ledger citing `lib/b.mjs:1`
- **WHEN** the record is written
- **THEN** `lib/a.mjs` is not counted, and `proof.uncited` is empty

#### Scenario: Failure — git cannot list the base

- **GIVEN** `--changed lib/a.mjs` cited by a ledger, and a `--base` git cannot diff against HEAD
- **WHEN** the record is written
- **THEN** standard error says the proof does not hold because git could not list the base, `proof.proven` is false with the reason that no diff was given, and the record is still written

#### Scenario: Edge case — a ledger carried twice is still stale on the first round's edit

- **GIVEN** a `language` ledger citing `lib/a.mjs`, carried at round 1 after `lib/a.mjs` changed, and carried again at round 2 when nothing else changed
- **WHEN** the round-2 record is written
- **THEN** the carried ledger's `carriedFrom` is still the head it was first carried from, and its entry on `lib/a.mjs` covers nothing

#### Scenario: Edge case — an extensionless executable under `cli/` must be cited

- **GIVEN** a review whose changed files are `cli/interlock` and `lib/a.mjs`, with ledgers citing only `lib/a.mjs`
- **WHEN** the record is written
- **THEN** `proof.uncited` lists `cli/interlock`, and `proof.proven` is false

#### Scenario: Edge case — a prose-only entry is listed apart and does not fail the proof

- **GIVEN** a review whose every ran dimension checked something, whose ledgers and findings together cite every changed coverable source file, and whose only `unread` entry is prose-only
- **WHEN** the record is written
- **THEN** `proof.unproven`, `proof.unread` and `proof.uncited` are all empty, `proof.proseUnread` names that dimension with the entry, and `proof.proven` is true

#### Scenario: Edge case — a dimension with both kinds of entry is named in both lists

- **GIVEN** a `technical-lead` answer with one prose-only `unread` entry and one `unread` entry that carries no `paths`
- **WHEN** the record is written
- **THEN** `proof.proseUnread` names `technical-lead` with the first, `proof.unread` names it with the second, and `proof.proven` is false

#### Scenario: Failure — a prose-only entry does not make up for another gap

- **GIVEN** a review with one prose-only `unread` entry and one changed coverable source file no dimension cited
- **WHEN** the record is written
- **THEN** `proof.uncited` lists the file, `proof.proven` is false, and the entry is still under `proof.proseUnread`

#### Scenario: Edge case — a carried dimension's prose-only entry reaches neither list

- **GIVEN** a round-0 record whose `proof.proseUnread` names `technical-lead` with one prose-only entry on the changed file `docs/a.md`, and a scoped re-review that re-runs `language` and carries `technical-lead` from that record
- **WHEN** the round-1 record is written and the merge confidence is assessed from it
- **THEN** the round-1 record names `technical-lead` under `proof.carried`, and neither `proof.unread` nor `proof.proseUnread` names it
- **AND** the ran signal carries no `prose-unread` flag
