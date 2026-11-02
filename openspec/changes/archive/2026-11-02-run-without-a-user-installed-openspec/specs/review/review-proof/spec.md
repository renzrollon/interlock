# Spec Delta

## MODIFIED Requirements

### Requirement: The review record SHALL carry a proof computed from the ledgers and the diff

`interlock review` SHALL record `proof` beside `dimensions`: `unproven` names each ran dimension whose ledger is absent or rejected, or that raised no finding and checked nothing; `unread` names each ran dimension with an `unread` entry, with the entries; `uncited` lists each changed coverable source file no ran dimension cited in a checked entry or a finding. Coverable means what the spec-coverage signal counts, plus an extensionless file directly under a `bin/` or `cli/` directory, which is source no coverage tool attributes. The changed files SHALL be the union of `--changed` and git's own list for `--base`, with a rename counted under its new path only; with neither, or when git cannot list `--base`, the proof SHALL NOT hold.

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
