# Spec Delta

## MODIFIED Requirements

### Requirement: The run's review step SHALL record the same proof

A ship run's review step SHALL ask each dimension's reviewer for the same ledger, `{ dimension, findings, coverage }`, as its whole answer, and the review record it writes SHALL carry `proof` computed by the same rules as `interlock review` over the ledgers `run found` folded, so the merge verdict reads a run's review and a settle review alike. Each reviewer's briefing and the fix round's re-review briefing SHALL carry the proof rules, the measure line and the ledger shape `interlock review brief` prints, and SHALL ask a reviewer or a re-review that finds nothing for one ledger per dimension, `{ dimension, findings: [], coverage }`, never a bare `[]`. A fix round's re-review SHALL carry the ledger of every dimension it did not re-run from the record before, under the same stale-file rule as a settle carry, and an entry that went stale in one round SHALL stay stale in every later round. A round that re-reviews no dimension and changes no file, as the verdict round does, SHALL keep the record's coverage and proof as they were. The run SHALL run no proof re-run: an unproven run review is the banner and the amber signal.

#### Scenario: Happy path — a run's review record carries proof

- **GIVEN** a strict run whose reviewers each wrote a ledger for their dimension
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

- **GIVEN** a run whose `qa` reviewer wrote findings and no `coverage`, and whose other reviewers wrote whole ledgers
- **WHEN** the run writes its review record
- **THEN** `qa` is unproven with the reason that its coverage was not recorded, `proof.proven` is false, and the close carries one `REVIEW NOT PROVEN` banner
- **AND** the other dimensions are proven by their own ledgers
