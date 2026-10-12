## ADDED Requirements

### Requirement: The verification verdict SHALL carry the type check's own result

The verdict `interlock verify judge` returns SHALL carry the type check's result as a field of its own, beside the unit, end-to-end and coverage results, in every context: whether it ran, its exit code, and whether it passed. When no type-check result was reported, the field SHALL be present and empty. The field SHALL NOT change which kinds halt in a context: a type check that fails at the final gate SHALL still be reported with its non-blocking banner and SHALL NOT halt.

Rationale: a passing type check otherwise leaves no trace in the verdict, so a reader cannot tell "passed" from "planned and never reported", and a failed one is visible only as a banner string. The merge verdict reads this field rather than parsing banners.

#### Scenario: Happy path — a passing type check is recorded

- **GIVEN** a plan with a type-check step and a reported type-check result that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's type-check field records that it ran and passed

#### Scenario: Failure — a type check that failed at the final gate is recorded and still does not halt

- **GIVEN** a plan with a type-check step and a reported type-check result that exited non-zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's type-check field records that it ran and did not pass, with the exit code
- **AND** the verdict does not halt, and carries the non-blocking type-check banner as before

#### Scenario: Edge case — no type-check result reported

- **GIVEN** a plan with a type-check step and results that carry no type-check entry
- **WHEN** the results are judged
- **THEN** the verdict's type-check field is present and empty
- **AND** every other field of the verdict is what it was before this field existed
