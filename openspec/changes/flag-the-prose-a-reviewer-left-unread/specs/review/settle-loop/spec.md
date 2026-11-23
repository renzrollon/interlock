# Spec Delta

## ADDED Requirements

### Requirement: `interlock settle comment` SHALL name the prose a reviewer left unread on its last line

When the record's proof lists an entry under `proseUnread`, the comment's last line SHALL carry the words `prose left unread`, then each such dimension with the files its entries name, each file in an inline code span. That SHALL hold whether the last line is the coverage line or the `REVIEW NOT PROVEN:` line, and the words SHALL appear once. A comment for a record with nothing listed apart SHALL be what it is without this requirement.

#### Scenario: Happy path — a proven review's coverage line names the prose

- **GIVEN** a record with `head` H, one surviving warning, a proof that holds, and `proof.proseUnread` naming `technical-lead` with one entry on `docs/04-when-it-stops.md` and `docs/10-agentic-workflow-ship-and-spec.md`
- **WHEN** `interlock settle comment --review <file> --head H --round 1` runs
- **THEN** the comment ends with the coverage line, and that line carries `prose left unread`, `technical-lead` and both files, each in a code span

#### Scenario: Edge case — nothing survived

- **GIVEN** a record with `head` H, an empty `surviving` list, a proof that holds, and the same `proof.proseUnread`
- **WHEN** the command runs
- **THEN** the single sentence it prints ends with the coverage line, which carries `prose left unread` once, with the dimension and both files

#### Scenario: Edge case — a proof that does not hold names the gaps and then the prose

- **GIVEN** a record with one surviving warning, whose proof names `technical-lead` under `unread` with the input `delta specs` and under `proseUnread` with an entry on `docs/04-when-it-stops.md`
- **WHEN** the command runs
- **THEN** the comment ends with a `REVIEW NOT PROVEN:` line that names the unread input, and after it `prose left unread` with `technical-lead` and the file

#### Scenario: Failure — a file name cannot render as a mention or markup

- **GIVEN** a record whose `proof.proseUnread` names an entry on a changed file called `docs/@team notes.md`
- **WHEN** the command runs
- **THEN** the file name is printed inside an inline code span, so it renders as no mention and no link

#### Scenario: Edge case — a record with nothing listed apart is unchanged

- **GIVEN** a record whose proof holds and carries no `proseUnread`, and the same record with an empty `proseUnread`
- **WHEN** the command runs for each
- **THEN** both print the same comment, whose coverage line ends as it did before this change
