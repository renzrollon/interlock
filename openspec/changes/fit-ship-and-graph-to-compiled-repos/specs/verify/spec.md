## ADDED Requirements

### Requirement: The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant

For the inter-wave context, the verify budget SHALL be the number of inter-wave verifications a run may spend, as `interlock limits` publishes it, multiplied by the test profile's `unit.timeout_ms`, whenever that field is a positive integer. The budget SHALL never be less than the inter-wave verify budget `interlock limits` publishes: a profile can raise the budget and SHALL NOT be able to lower it. With no profile, or a `unit.timeout_ms` that is absent, null, zero or negative, the budget SHALL be the published one. A product too large to represent exactly SHALL be clamped to the largest exact integer rather than overflowing.

`interlock verify plan --context inter-wave`, given a profile and no `--budget-ms`, SHALL plan against the derived budget and SHALL report both the budget and where it came from. An explicit `--budget-ms` SHALL be used as given. Outside the inter-wave context nothing SHALL be derived.

Both factors SHALL be read at use from the limits definition and the profile; neither SHALL be restated as a literal.

A constant budget fits only the repositories whose suites fit it. A solution whose one honest checkpoint costs more than the constant spends the whole budget on that checkpoint, and every later one is reduced to a typecheck. Scaling the budget by the profile's own per-suite allowance lets the checkpoints the cap already permits run in full, and the floor keeps the profile from being a way to buy less verification.

#### Scenario: Happy path — a profile with a suite allowance raises the budget

- **GIVEN** a profile whose `unit.timeout_ms` is 120000, and a typecheck command
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --elapsed-ms 160000 --json` runs
- **THEN** the reported budget is the published checkpoint cap multiplied by 120000, and its source is the profile
- **AND** the plan still holds the unit step

#### Scenario: Failure — a profile cannot lower the budget

- **GIVEN** a profile whose `unit.timeout_ms` is 1
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --json` runs with `--elapsed-ms` equal to the published inter-wave verify budget
- **THEN** the reported budget is the published one, and its source is the published limit
- **AND** only the typecheck step remains, with the unit and lint skips carrying the budget-exceeded reason

#### Scenario: Edge case — an unusable allowance, an oversized one and an explicit budget

- **GIVEN** four profiles whose `unit.timeout_ms` is respectively absent, `null`, `0` and `9007199254740991`
- **WHEN** `interlock verify plan --context inter-wave --json` runs against each
- **THEN** the first three report the published budget with the published limit as its source
- **AND** the fourth reports the largest exact integer, not a non-finite number
- **AND** the same command given `--budget-ms 5000` against any of them reports a budget of 5000

### Requirement: A run SHALL fix its inter-wave verify budget at start and SHALL report it

A ship run SHALL derive its inter-wave verify budget once, when it starts, from the test profile it located, and SHALL record the budget and its source on the run. Every inter-wave plan of that run SHALL use the recorded budget. A change to the profile after the run started SHALL NOT move it. The run's receipt SHALL carry the budget and its source.

When a checkpoint is reduced because the budget is spent, and the budget is the published one because the profile carried no usable `unit.timeout_ms`, the run SHALL raise a banner that says so and names the command that records one. A checkpoint is reduced whenever a check was dropped for the spent budget: whether nothing is left to run, or the typecheck alone is left because the profile names a typecheck command. The banner SHALL be raised in both cases, and SHALL be raised once per run.

A run whose record carries no budget, because it started before the budget was recorded, SHALL use the published budget.

The budget is derived at the start rather than at each checkpoint so that it is a fact of the run, recorded once, rather than a value an agent working in the tree could move while the run is under way.

#### Scenario: Happy path — a later checkpoint still runs the suite

- **GIVEN** a run started against a profile whose `unit.timeout_ms` is 120000, whose first checkpoint's checks took 160 seconds
- **WHEN** the run plans its second inter-wave checkpoint
- **THEN** the plan holds the unit step
- **AND** the run's receipt carries the derived budget and names the profile as its source

#### Scenario: Failure — a budget left at the floor says why it ran out

- **GIVEN** a run started against a profile with no `unit.timeout_ms`, whose first checkpoint's checks took longer than the published budget
- **WHEN** the run plans its second inter-wave checkpoint
- **THEN** the unit step is skipped with `VERIFICATION SKIPPED: reason=verify-budget-exceeded`
- **AND** the run raises a banner containing `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `/interlock:fix-tests --reconfigure`
- **AND** a third reduced checkpoint in the same run does not raise that banner again

#### Scenario: Failure — a checkpoint cut to typecheck alone says why as well

- **GIVEN** a run started against a profile that names a typecheck command and a unit command and carries no `unit.timeout_ms`, whose earlier checkpoints have spent the published budget
- **WHEN** the run plans its next inter-wave checkpoint
- **THEN** the plan holds the typecheck step alone, and the checkpoint is dispatched rather than skipped
- **AND** the run raises a banner containing `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `/interlock:fix-tests --reconfigure`
- **AND** a later checkpoint reduced the same way does not raise that banner again

#### Scenario: Edge case — the profile changes mid-run, and an older run resumes

- **GIVEN** a run started against a profile whose `unit.timeout_ms` is 120000, after which the profile's value is changed to 1 and then to 900000
- **WHEN** the run plans each later checkpoint
- **THEN** each plan uses the budget recorded at the start
- **AND** a run whose record was written before the budget was recorded plans against the published budget and raises no banner about its absence
