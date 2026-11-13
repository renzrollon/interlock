## MODIFIED Requirements

### Requirement: Every review of the loop SHALL have run review-code's proof re-run before the loop posts its comment, and the loop SHALL run no second one

Each `/interlock:review-code` pass of the loop SHALL repeat its own `interlock review proof` re-run (D17) until that line exits 0 before it writes the record the loop reads: the first pass is recorded as a draft that carries the review's `--dimensions` and `--carry`, the CLI merges each re-run into the draft (a replaced answer for an unproven dimension, an append for every other re-run dimension, the draft's verdicts kept), the re-run's new findings go through the skeptics, and the final record is the promoted draft, written once for the same head with `--metrics`, so no first-pass finding, verdict, skip or degraded entry is lost and no dimension outside a scoped review's `--dimensions` runs. A pass whose only gap is `unread` inputs SHALL re-run nothing for them: its proof line exits 0 on the first call and the first pass's draft is promoted. The settle skill SHALL post the comment and plan the next round from that final record, SHALL NOT run `interlock review proof` itself, and the comment of a record whose proof does not hold, at the cap or for `unread` inputs, SHALL say so.

#### Scenario: Happy path — one unproven dimension is re-run inside the review

- **GIVEN** a round-0 review in which `technical-lead` returned no coverage ledger
- **WHEN** the loop runs
- **THEN** review-code re-runs `technical-lead` alone, its findings are adjudicated by the skeptics, the record is written once for the same head, and the loop posts the comment from that record

#### Scenario: Edge case — a scoped fix round with a carry re-runs nothing outside its scope

- **GIVEN** a fix round whose review is scoped with `--dimensions technical-lead --carry <round-0 record>`, whose carried ledgers still cite every file the fix left unchanged, and whose `technical-lead` answer cites the files the fix changed
- **WHEN** the review's draft is written and its proof line runs
- **THEN** the line prints `proven`, `regression` is not re-run, and the round-0 `regression` survivors are carried into the record

#### Scenario: Failure — still unproven at the cap

- **GIVEN** a dimension that stays unproven through the published number of re-runs
- **WHEN** review-code's proof line prints `PROOF CAP REACHED`
- **THEN** the loop posts the comment, which opens `REVIEW NOT PROVEN` when nothing survived and ends with a `REVIEW NOT PROVEN:` line when findings did, and goes on to plan the round

#### Scenario: Edge case — the skills' pins

- **GIVEN** the shipped settle and review skills
- **WHEN** the skill suite runs
- **THEN** the `interlock review proof` line appears in the review skill after the skeptic line and before the record's final `interlock review` line, the settle skill holds no `interlock review proof` line, and neither names a count of re-runs
- **AND** the review skill names `PROOF LEFT UNREAD` among the proof line's exit-0 answers, prints the proof line before it re-runs a dimension, asks for each re-run's prompt with `--rerun-of <draft>`, and names `RE-RUN REFUSED` for a re-run brief that exits 1, promoting the last draft without running the proof line again when no named dimension got a prompt

#### Scenario: Edge case — declared unread inputs spawn no second reviewer

- **GIVEN** a round-0 review in which every dimension returned a ledger, every changed source file is cited, and three dimensions recorded `unread` inputs
- **WHEN** the loop runs
- **THEN** review-code's proof line prints `PROOF LEFT UNREAD:` naming the three and exits 0 on its first call
- **AND** no dimension reviewer and no skeptic is spawned a second time in that pass, and the record holds the first pass's findings only
- **AND** the loop posts the comment from that record, which opens `REVIEW NOT PROVEN` when nothing survived and ends with a `REVIEW NOT PROVEN:` line naming the unread inputs when findings did, and goes on to plan the round
