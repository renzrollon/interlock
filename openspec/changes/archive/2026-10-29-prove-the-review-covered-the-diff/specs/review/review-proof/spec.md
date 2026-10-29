# Spec Delta

## Purpose

Makes a review prove what it covered, so that a review which raised nothing is either shown to have examined the diff or is recorded as unproven, and never reads as a clean review by default.

## ADDED Requirements

### Requirement: Every dimension SHALL return a coverage ledger beside its findings

A dimension's answer SHALL carry `coverage` beside `findings`: `checked`, a list of `{ what, at }` entries naming what the dimension examined, each `at` a `path:line` or `path:start-end` token, in the diff or outside it; and `unread`, a list of `{ input, reason }` entries naming each input its rubric calls for that it did not read. Both lists SHALL be present, and either MAY be empty.

#### Scenario: Happy path — a dimension that raised nothing says what it checked

- **GIVEN** a dimension answer with no finding and two `checked` entries citing `lib/settle-meter.mjs:172-177` and `hooks/mod.mjs:636`, and an empty `unread`
- **WHEN** `interlock review` reads it
- **THEN** the review record keeps both entries under that dimension's coverage
- **AND** the dimension is neither unproven nor listed under `unread`

#### Scenario: Failure — a ledger that is not one is rejected aloud, not fatally

- **GIVEN** one dimension answer whose `coverage.checked` entry has no `at`, and another whose `at` is `see the diff`
- **WHEN** `interlock review` reads them
- **THEN** it exits 0 and writes the record, and standard error carries one `LEDGER REJECTED:` line per dimension naming the entry and the fault
- **AND** each such dimension is recorded unproven with the fault as its reason, so the re-run answer names it

#### Scenario: Edge case — an answer with no coverage key

- **GIVEN** a dimension answer that carries `findings` and no `coverage`
- **WHEN** `interlock review` reads it
- **THEN** the review is recorded, and that dimension is unproven with the reason that its coverage was not recorded

### Requirement: The review record SHALL carry a proof computed from the ledgers and the diff

`interlock review` SHALL record `proof` beside `dimensions`: `unproven` names each ran dimension whose ledger is absent or rejected, or that raised no finding and checked nothing; `unread` names each ran dimension with an `unread` entry, with the entries; `uncited` lists each changed coverable source file no ran dimension cited in a checked entry or a finding. Coverable means what the spec-coverage signal counts, plus an extensionless file directly under a `bin/` directory, which is source no coverage tool attributes. The changed files SHALL be the union of `--changed` and git's own list for `--base`, with a rename counted under its new path only; with neither, or when git cannot list `--base`, the proof SHALL NOT hold.

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

### Requirement: The run's review step SHALL record the same proof

A ship run's review step SHALL ask each dimension for the same ledger, and the review record it writes SHALL carry `proof` computed by the same rules as `interlock review`, so the merge verdict reads a run's review and a settle review alike. The run's review briefing and its fix round's re-review briefing SHALL carry the proof rules, the measure line and the ledger shape `interlock review brief` prints, and SHALL ask a re-review that finds nothing for one ledger per re-reviewed dimension, `{ dimension, findings: [], coverage }`, never a bare `[]`. A fix round's re-review SHALL carry the ledger of every dimension it did not re-run from the record before, under the same stale-file rule as a settle carry, and an entry that went stale in one round SHALL stay stale in every later round. A round that re-reviews no dimension and changes no file, as the verdict round does, SHALL keep the record's coverage and proof as they were. The run SHALL run no proof re-run: an unproven run review is the banner and the amber signal.

#### Scenario: Happy path — a run's review record carries proof

- **GIVEN** a strict run whose review worker returns ledgers for every dimension
- **WHEN** the run writes its review record
- **THEN** the record carries `proof` with the same fields as a record `interlock review` writes for the same answers

#### Scenario: Edge case — a fix round carries what it did not re-run

- **GIVEN** a strict run whose first review was proven and whose fix round re-reviews only `technical-lead`
- **WHEN** the run rewrites its review record
- **THEN** the other dimensions keep their first-review ledgers, only their entries on files the fix changed cover nothing, and the record is not unproven for the dimensions the round did not re-run

#### Scenario: Happy path — a clean fix round stays proven

- **GIVEN** a strict run whose first review was proven and whose fix round re-reviews only `technical-lead`, whose worker answers with no finding and a ledger citing the files the fix changed
- **WHEN** the run rewrites its review record and closes
- **THEN** `technical-lead` is not unproven, `proof.proven` is true, and the close carries no `REVIEW NOT PROVEN` banner

#### Scenario: Happy path — the verdict round keeps the last fix round's proof

- **GIVEN** a strict run whose fix round left a proven record and cleared every blocker
- **WHEN** the verdict round reports, re-reviewing nothing, and the run closes
- **THEN** the review record's `proof.proven` is still true and the close carries no `REVIEW NOT PROVEN` banner

#### Scenario: Edge case — a fixer's edit stays uncovered by an old ledger

- **GIVEN** a strict run whose round-1 fixer edited `lib/b.mjs`, cited only by `qa`'s first-review ledger, and whose rounds 1 and 2 re-review dimensions other than `qa`
- **WHEN** the round-2 record is written
- **THEN** `lib/b.mjs` is uncited unless a dimension re-run in round 1 or 2 cites it

#### Scenario: Failure — a run's worker that returns no ledger

- **GIVEN** a run whose review worker returns findings and no ledgers
- **WHEN** the run writes its review record
- **THEN** every ran dimension is unproven with the reason that its coverage was not recorded, `proof.proven` is false, and the close carries one `REVIEW NOT PROVEN` banner

### Requirement: `interlock review proof` SHALL name the dimensions to re-run under a published cap

`interlock review proof --review <file>` SHALL answer on the first line of standard output, with the reasons on the lines after it and no `--json` form, so the settle meter and the skill read one stream: `re-run: <dimensions>` and exit 1 while the list of unproven dimensions, dimensions with unread inputs and the uncited re-run target is non-empty and the record's `proof.reruns` is below the published `maxProofReruns`; `proven` and exit 0 when the ledgers hold, at the cap as below it; `PROOF CAP REACHED: <dimensions>` and exit 0 once `proof.reruns` has reached the cap with gaps left. A record with no `proof.reruns` SHALL count 0. The uncited re-run target SHALL be `regression` when it ran in the review, otherwise the first ran dimension of the review's `--dimensions`, with the uncited files named in its reason. A file that is unreadable or not an adjudicated review SHALL exit 2 with the reason on standard error. `interlock review … --rerun-of <draft>` SHALL write `proof.reruns` as the draft's count plus one when the write carries answers for a dimension, and as the draft's count when it carries none, so the count is the CLI's and no skill keeps it.

#### Scenario: Happy path — an unproven dimension is named for a re-run

- **GIVEN** a record in which `technical-lead` has an unread input and `language` is unproven, and `proof.reruns` is 0
- **WHEN** `interlock review proof` runs
- **THEN** it exits 1, its first line reads `re-run: language, technical-lead`, and each reason follows on a later line

#### Scenario: Edge case — uncited files alone re-run regression

- **GIVEN** a record whose every dimension checked something with nothing unread, but whose proof lists `hooks/mod.mjs` as uncited
- **WHEN** `interlock review proof` runs on it, with `proof.reruns` 0
- **THEN** it exits 1, its first line reads `re-run: regression`, and the reason names `hooks/mod.mjs`

#### Scenario: Failure — the cap is reached

- **GIVEN** the same record written with `--rerun-of` until its `proof.reruns` equals the published `maxProofReruns`
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0, its first line reads `PROOF CAP REACHED: language, technical-lead`, and it lists nothing to re-run

#### Scenario: Edge case — a proven record

- **GIVEN** a record whose `proof.proven` is true
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0 and prints `proven`

#### Scenario: Happy path — coverage proven on the attempt that reaches the cap

- **GIVEN** a draft whose `proof.reruns` equals the published `maxProofReruns` and whose ledgers now hold
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0 and prints `proven`, not `PROOF CAP REACHED`
- **AND** the promoted record's `proof.reruns` still equals the number of re-runs

#### Scenario: Edge case — a first-pass proven review counts no re-run

- **GIVEN** a draft whose proof holds on the first pass
- **WHEN** it is promoted with `--rerun-of <draft>` and no `--findings`
- **THEN** the record's `proof.reruns` is 0

#### Scenario: Edge case — a scoped review's uncited files re-run a scoped dimension

- **GIVEN** a draft written with `--dimensions technical-lead --carry <previous record>` whose proof lists one uncited file
- **WHEN** `interlock review proof` runs
- **THEN** its first line reads `re-run: technical-lead`, and `regression` is not named

#### Scenario: Failure — a file that is not a review is not a re-run

- **GIVEN** a file that does not parse, and another that carries no `surviving` list
- **WHEN** `interlock review proof --review <file>` runs for each
- **THEN** each exits 2 with nothing on standard output and the reason on standard error, so neither reads as the re-run answer

#### Scenario: Edge case — the cap is published

- **GIVEN** the limits surface
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** both carry `maxProofReruns`

### Requirement: `interlock review --rerun-of` SHALL merge a re-run into the draft in the CLI

A draft (`--draft`) SHALL carry `inputs: { answers, verdicts }`, the per-dimension answers and the verdicts it was written from, and the final record SHALL NOT. `interlock review --rerun-of <draft> --findings <re-run answers> --verdicts <re-run verdicts>` SHALL merge into the draft's inputs and resolve the whole again: a dimension the draft's proof named unproven or unread SHALL have its ledger replaced and the findings whose ids are new appended, no first-pass finding dropped; a dimension re-run for uncited files alone SHALL have the new checked entries and the findings whose ids are new appended and nothing of its first answer dropped; the draft's verdicts SHALL be kept for every finding id they cover and the new verdicts appended; a dimension the write does not name SHALL be untouched, carried or ran. A `--rerun-of` write with no `--findings` SHALL promote the draft unchanged. A `--draft` or `--rerun-of` write whose findings input holds an entry that is not a per-dimension answer SHALL exit 1 and write nothing. `interlock review brief --skeptics … --rerun-of <draft>` SHALL print prompts only for the findings the draft holds no verdict for. No skill SHALL compose a merged findings or verdicts file.

#### Scenario: Happy path — an unproven dimension's re-run replaces its ledger

- **GIVEN** a draft in which `language` is unproven, and a re-run `language` answer with one finding and a ledger
- **WHEN** `interlock review --rerun-of <draft> --findings <answer> --verdicts <its verdicts> --draft --out <next>` runs
- **THEN** the next draft's `language` carries the new finding and ledger, `proof.reruns` is 1, and every other dimension's findings, ledgers and verdicts are the draft's

#### Scenario: Failure — a blocker beside an unread input survives a clean re-run

- **GIVEN** a draft whose `security` raised one blocker with two upholding verdicts and recorded one `unread` entry, and a re-run `security` answer with no finding and a ledger with no `unread` entry
- **WHEN** the next draft is written with `--rerun-of` and promoted
- **THEN** the promoted record lists the blocker under `surviving` with its two verdicts, and `security`'s ledger is the re-run's

#### Scenario: Failure — a draft written from a flat findings list

- **GIVEN** a `--findings` file that is a flat list of findings with no per-dimension answer
- **WHEN** `interlock review --findings <file> --draft --out <draft>` runs
- **THEN** it exits 1 naming the entries that are not answers, and no draft is written

#### Scenario: Edge case — a regression blocker survives an uncited-file re-run

- **GIVEN** a draft whose `regression` raised one surviving blocker with two verdicts and whose proof lists `hooks/mod.mjs` as uncited
- **WHEN** `regression` is re-run for that file and the next draft is written with `--rerun-of`
- **THEN** the blocker is still surviving with its two verdicts, the new checked entries are appended under `regression`, and `hooks/mod.mjs` is no longer uncited

#### Scenario: Edge case — first-pass findings keep the floor number of verdicts

- **GIVEN** a draft whose first pass adjudicated three warnings and a re-run that raises one new warning with its two verdicts
- **WHEN** the next draft is written with `--rerun-of` and promoted
- **THEN** each of the four warnings carries at least `minVerdictsPerFinding` verdicts, and the merge-confidence adversarial signal is not amber for a thin verdict

#### Scenario: Failure — the skeptics are not asked twice

- **GIVEN** a draft holding verdicts for finding `F-1` and a re-run answer that raises `F-1` again and `F-2`
- **WHEN** `interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> --json` runs
- **THEN** every prompt's `findingIds` is `["F-2"]`
