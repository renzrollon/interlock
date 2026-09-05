## MODIFIED Requirements

### Requirement: Classifier tier policy SHALL be stated identically across hosts

Classifier tier policy — the tier definitions, the model-routing rule and the grouping rules — SHALL be stated once, in the CLI's prompt module, and assembled into the classifier briefing by the CLI for every host. No host driver SHALL carry a copy of it, divergent or identical. The cross-host comparison that previously established parity SHALL be replaced by a test that the single statement is complete and that no driver contains one.

#### Scenario: Happy path — both drivers state one policy

- **GIVEN** the workflow-runtime driver and the ACP driver
- **WHEN** each runs a classification step
- **THEN** the classifier briefing each agent receives is the file `interlock run start` wrote, assembled from the one prompt module
- **AND** the assembled briefing contains the definition of every tier from 1 through 5 and the rule naming which tier may use the most expensive model
- **AND** neither driver's source contains a tier definition or the routing rule

#### Scenario: Failure — one driver's tier policy drifts

- **GIVEN** a tier definition pasted into one driver
- **WHEN** the no-policy test runs over both drivers
- **THEN** the test fails naming that driver and the tier-ladder token
- **AND** no cross-host comparison is consulted, because there is no second statement to compare

#### Scenario: Edge case — the two drivers word the same policy differently

- **GIVEN** the tier-4 sentence in the prompt module is reworded
- **WHEN** the assembled classifier briefing is checked
- **THEN** the integrity check passes or fails on the assembled output alone
- **AND** both hosts receive the reworded sentence with no second edit, so there is no second wording to reconcile
