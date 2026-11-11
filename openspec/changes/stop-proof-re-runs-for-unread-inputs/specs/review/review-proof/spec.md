## MODIFIED Requirements

### Requirement: `interlock review proof` SHALL name the dimensions to re-run under a published cap

`interlock review proof --review <file>` SHALL answer on the first line of standard output, with the reasons on the lines after it and no `--json` form, so the settle meter and the skill read one stream: the re-run list SHALL be the unproven dimensions and the uncited re-run target, in the order they ran, and a dimension SHALL NOT be on it for its `unread` inputs. The answer SHALL be `re-run: <dimensions>` and exit 1 while the re-run list is non-empty and the record's `proof.reruns` is below the published `maxProofReruns`; `proven` and exit 0 when the ledgers hold, at the cap as below it; `PROOF CAP REACHED: <dimensions>` and exit 0 once `proof.reruns` has reached the cap with the re-run list non-empty; and `PROOF LEFT UNREAD: <dimensions>` and exit 0 when `unread` inputs are the only gap of a proof that does not hold, naming each dimension that recorded one, whatever `proof.reruns` is. Every answer for a proof that does not hold SHALL list each gap on the lines after the first, `unread` entries included. A record with no `proof.reruns` SHALL count 0. The uncited re-run target SHALL be `regression` when it ran in the review, otherwise the first ran dimension of the review's `--dimensions`, with the uncited files named in its reason. A file that is unreadable or not an adjudicated review SHALL exit 2 with the reason on standard error. `interlock review … --rerun-of <draft>` SHALL write `proof.reruns` as the draft's count plus one when the write carries answers for a dimension, and as the draft's count when it carries none, so the count is the CLI's and no skill keeps it.

#### Scenario: Happy path — an unproven dimension is named for a re-run

- **GIVEN** a record in which `technical-lead` has an unread input and `language` is unproven, and `proof.reruns` is 0
- **WHEN** `interlock review proof` runs
- **THEN** it exits 1, its first line reads `re-run: language`, and `technical-lead` is not named on it
- **AND** the lines after it name `language` as unproven and the `technical-lead` unread input with its reason

#### Scenario: Edge case — uncited files alone re-run regression

- **GIVEN** a record whose every dimension checked something with nothing unread, but whose proof lists `hooks/mod.mjs` as uncited
- **WHEN** `interlock review proof` runs on it, with `proof.reruns` 0
- **THEN** it exits 1, its first line reads `re-run: regression`, and the reason names `hooks/mod.mjs`

#### Scenario: Failure — the cap is reached

- **GIVEN** the same record written with `--rerun-of` until its `proof.reruns` equals the published `maxProofReruns`, with `language` still unproven
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0, its first line reads `PROOF CAP REACHED: language`, and it lists nothing to re-run

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

#### Scenario: Edge case — unread inputs alone re-run nothing

- **GIVEN** a record whose every ran dimension checked something and whose changed source files are all cited, in which `technical-lead` and `security` each recorded an `unread` input, with `proof.reruns` 0
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0, its first line reads `PROOF LEFT UNREAD: technical-lead, security`, and each unread input follows on a later line with its reason
- **AND** the record's `proof.proven` is still false and its `proof.unread` still names both dimensions

#### Scenario: Failure — unread inputs on every ran dimension ask for no re-run

- **GIVEN** a record with five ran dimensions (`language`, `technical-lead`, `regression`, `security`, `domain`), none unproven, every changed source file cited, at least one `unread` entry on each of the five, and `proof.reruns` 0
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0 and its first line reads `PROOF LEFT UNREAD: language, technical-lead, regression, security, domain`
- **AND** no line of its output begins `re-run:`

#### Scenario: Edge case — unread inputs left after a re-run are not the cap's

- **GIVEN** a draft whose `language` was unproven and has been re-run to a ledger, so that a `technical-lead` unread input is the only gap, with `proof.reruns` equal to the published `maxProofReruns`
- **WHEN** `interlock review proof` runs
- **THEN** it exits 0 and its first line reads `PROOF LEFT UNREAD: technical-lead`, not `PROOF CAP REACHED`

#### Scenario: Failure — an unread input does not answer for a record with no diff

- **GIVEN** a record whose proof does not hold because no diff was given, in which one dimension also recorded an `unread` input
- **WHEN** `interlock review proof` runs
- **THEN** it exits 2 with nothing on standard output and the reason on standard error, as it does for the same record without the unread input

### Requirement: `interlock review --rerun-of` SHALL merge a re-run into the draft in the CLI

A draft (`--draft`) SHALL carry `inputs: { answers, verdicts }`, the per-dimension answers and the verdicts it was written from, and the final record SHALL NOT. `interlock review --rerun-of <draft> --findings <re-run answers> --verdicts <re-run verdicts>` SHALL merge into the draft's inputs and resolve the whole again: a dimension the draft's proof named unproven SHALL have its ledger replaced and the findings whose ids are new appended, no first-pass finding dropped; every other dimension the write names SHALL keep its first ledger and have the re-run's checked and unread entries and the findings whose ids are new appended, nothing of its first answer dropped, keeping the first `unread` entry per `input` and the first `checked` entry per `what` and `at`; a re-run ledger of the wrong shape on that path SHALL leave the first ledger in place and standard error SHALL carry `LEDGER REJECTED: <dimension>: <fault>; the first ledger was kept`, and that fault SHALL NOT record the dimension unproven; the draft's verdicts SHALL be kept for every finding id they cover and the new verdicts appended; a dimension the write does not name SHALL be untouched, carried or ran. A `--rerun-of` write with no `--findings` SHALL promote the draft unchanged. A `--draft` or `--rerun-of` write whose findings input holds an entry that is not a per-dimension answer SHALL exit 1 and write nothing. `interlock review brief --skeptics … --rerun-of <draft>` SHALL print prompts only for the findings the draft holds no verdict for. No skill SHALL compose a merged findings or verdicts file.

#### Scenario: Happy path — an unproven dimension's re-run replaces its ledger

- **GIVEN** a draft in which `language` is unproven, and a re-run `language` answer with one finding and a ledger
- **WHEN** `interlock review --rerun-of <draft> --findings <answer> --verdicts <its verdicts> --draft --out <next>` runs
- **THEN** the next draft's `language` carries the new finding and ledger, `proof.reruns` is 1, and every other dimension's findings, ledgers and verdicts are the draft's

#### Scenario: Failure — a blocker beside an unread input survives a clean re-run

- **GIVEN** a draft whose `security` raised one blocker with two upholding verdicts and recorded one `unread` entry, and a re-run `security` answer with no finding and a ledger with no `unread` entry
- **WHEN** the next draft is written with `--rerun-of` and promoted
- **THEN** the promoted record lists the blocker under `surviving` with its two verdicts
- **AND** `security`'s ledger holds its first checked entries and the re-run's, and still holds the first answer's `unread` entry

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

#### Scenario: Edge case — a repeated unread input is recorded once

- **GIVEN** a draft whose `regression` recorded the `unread` input `REVIEW_CONTEXT` and is the uncited target, and a re-run that records `REVIEW_CONTEXT` again and adds one new checked entry
- **WHEN** the next draft is written with `--rerun-of`
- **THEN** `regression`'s `unread` lists `REVIEW_CONTEXT` once, with the first pass's reason, and its `checked` list holds the first pass's entry and the new one

#### Scenario: Failure — a malformed re-run ledger on the append path is spoken and does not replace the first

- **GIVEN** a draft whose `regression` cited `lib/a.mjs`, recorded one `unread` input, and left `lib/b.mjs` uncited, and a re-run whose `coverage.checked` is not a list
- **WHEN** the next draft is written with `--rerun-of`
- **THEN** standard error carries `LEDGER REJECTED: regression:` and `the first ledger was kept`
- **AND** the first `unread` entry is still recorded, `regression` is not unproven, and `lib/b.mjs` is still uncited

#### Scenario: Edge case — a re-run scoped to uncited files keeps the first pass's ledger

- **GIVEN** a draft whose `regression` cited `lib/a.mjs` and recorded one `unread` input, and whose proof lists `hooks/mod.mjs` as uncited
- **WHEN** `regression` is re-run for `hooks/mod.mjs` alone, answers with one checked entry on that file, and the next draft is written with `--rerun-of`
- **THEN** `lib/a.mjs` and `hooks/mod.mjs` are both cited, `proof.uncited` is empty, and the `unread` entry is still recorded under `regression`
