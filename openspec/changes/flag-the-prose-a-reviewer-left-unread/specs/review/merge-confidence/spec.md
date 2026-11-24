# Spec Delta

## ADDED Requirements

### Requirement: Prose a reviewer left unread SHALL be a flag on the ran signal, not a band

When the review's proof lists an entry under `proseUnread`, `review.ran` SHALL add the `prose-unread` flag and SHALL leave its band as the rest of the record decides it. Its evidence SHALL name each such dimension with the files and the reason of each entry, and a green reason SHALL say which dimensions left prose unread. `prose-unread` SHALL be in the published flag vocabulary.

#### Scenario: Happy path — a proven review with prose left unread is green and flagged

- **GIVEN** a review whose every selected dimension ran, whose proof holds, and whose `proof.proseUnread` names `technical-lead` with one entry on `docs/04-when-it-stops.md`, reason `prose-only edits, not opened`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is green with the `prose-unread` flag, and scores below the same input with nothing listed apart
- **AND** its evidence names `technical-lead`, `docs/04-when-it-stops.md` and the reason, and its reason names `technical-lead`

#### Scenario: Edge case — an unread input beside it still reads amber, and the flag stays

- **GIVEN** a review whose proof names `technical-lead` under `unread` with the input `delta specs`, and under `proseUnread` with an entry on `docs/04-when-it-stops.md`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal is amber, needing more evidence, and still carries the `prose-unread` flag
- **AND** its evidence names both the unread input and the prose left unread

#### Scenario: Edge case — several dimensions and entries are joined in a fixed order

- **GIVEN** a proven review of the dimensions `language` then `technical-lead`, whose `proof.proseUnread` names `language` with one entry on `README.md`, reason `not opened`, and `technical-lead` with two entries: one on `docs/a.md` and `docs/b.md`, reason `prose-only edits, not opened`, then one on `docs/c.md`, reason `not opened`
- **WHEN** the merge confidence is assessed
- **THEN** the ran signal's evidence holds `prose left unread: language: README.md (not opened)` and then `prose left unread: technical-lead: docs/a.md, docs/b.md (prose-only edits, not opened); docs/c.md (not opened)`
- **AND** its green reason ends `; prose left unread by language, technical-lead`

#### Scenario: Edge case — the flag is published and has its row

- **GIVEN** the published flag vocabulary and the delivery documentation
- **WHEN** the merge-confidence suite reads both
- **THEN** `prose-unread` is in the vocabulary, and `docs/15-merge-confidence.md` carries its row under `## The flags`, naming `review.ran`

#### Scenario: Failure — a record with no such list raises no flag

- **GIVEN** a proven review record written before this change, which carries no `proseUnread`, and another whose `proseUnread` is not a list
- **WHEN** each is assessed
- **THEN** the ran signal is green with no `prose-unread` flag, and the command does not fail on either
