## ADDED Requirements

### Requirement: A size cut of the domain reviewer's text SHALL be spoken at run level

When the size bound leaves requirements out of the text the domain reviewer is given, a ship run SHALL raise `DOMAIN REVIEW PARTIAL`, stating how many requirements were left out and citing the limit that bounds the text by its published key (`maxDomainSpecChars`). It SHALL NOT restate the limit's value. The run SHALL raise one `DOMAIN REVIEW PARTIAL` banner: when the selection is also partial for want of a graph, that one banner SHALL state both reasons. The banner SHALL be raised once per run, however many review rounds follow, and SHALL reach the close summary. A text that fits SHALL raise nothing on this account.

Rationale: the reviewer is told what was cut, and the review record names it, but a person reading the close summary was not: a clean domain review over a cut text read exactly like a clean one over the whole.

#### Scenario: Happy path — a text that fits raises nothing

- **GIVEN** a strict run with a graph whose selected capabilities fit the bound
- **WHEN** the review step is planned
- **THEN** no `DOMAIN REVIEW PARTIAL` banner is raised

#### Scenario: Failure — a cut is named in the close summary

- **GIVEN** a strict run whose selected capabilities exceed the bound, so that four requirements are left out
- **WHEN** the run closes
- **THEN** the close summary carries one `DOMAIN REVIEW PARTIAL` line holding the count of four and the key `maxDomainSpecChars`
- **AND** the line appears one time, however many review rounds ran

#### Scenario: Edge case — no graph and a cut together

- **GIVEN** a strict run with no graph, whose declared capabilities exceed the bound
- **WHEN** the run closes
- **THEN** the close summary carries one `DOMAIN REVIEW PARTIAL` line that states the partial selection and the cut
