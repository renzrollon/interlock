## RENAMED Requirements

- FROM: `### Requirement: The scheduled full-suite run reads its runs-per-case from the published limits`
- TO: `### Requirement: The full-suite run reads its runs-per-case from the published limits`

## MODIFIED Requirements

### Requirement: The full-suite run reads its runs-per-case from the published limits

The full-suite run SHALL be triggered on explicit manual invocation. It SHALL carry no schedule while the repository provisions no model credential; adding a schedule is the edit that records the credential's arrival. Whichever trigger starts it, the run SHALL obtain the number of runs per case from the published limits surface, rather than restating it in the workflow definition or leaving it to each case's own value. A case MAY pin a lower value for the fast per-change subset, which runs under its own single-run posture.

#### Scenario: The scheduled run passes the published value

- **WHEN** the full-suite job runs, on manual invocation or on a schedule once a credential is provisioned
- **THEN** it resolves the runs-per-case from the published limits surface and passes it to the harness

#### Scenario: The published value changes

- **WHEN** the published runs-per-case is changed
- **THEN** the next full-suite run uses the new value with no edit to the workflow definition

#### Scenario: No schedule without a credential

- **GIVEN** a repository with no model credential provisioned
- **WHEN** the eval workflow's triggers are read
- **THEN** the full-suite job is reachable by manual invocation only, and the per-change smoke keeps its pull-request trigger and its clean skip
