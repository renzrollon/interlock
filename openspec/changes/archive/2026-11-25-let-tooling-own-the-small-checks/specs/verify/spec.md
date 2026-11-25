# Spec Delta

## ADDED Requirements

### Requirement: The test profile SHALL be able to name a build command, and no discovery step SHALL invent one

The test profile SHALL accept a `build` section holding a command, a working directory and a time allowance, validated as the other sections are. `/interlock:fix-tests` SHALL resolve the command as it resolves the type check's: the profile's own value, then the project manifest's build script, then the step of the CI job that runs it. It SHALL NOT ask for one and SHALL NOT invent one: with nothing found the command SHALL be `null`.

#### Scenario: Happy path — a profile with a build section is accepted

- **GIVEN** a profile whose `build` section is `{ "command": "npm run build", "cwd": ".", "timeout_ms": 300000 }`
- **WHEN** `interlock verify plan --profile <file> --context final --json` runs
- **THEN** it exits 0 and the plan holds a build step
- **AND** `interlock doctor` reports the same profile's `test-profile` row as it did without the section

#### Scenario: Failure — a malformed build section is refused by name

- **GIVEN** one profile whose `build.command` is a number, and another whose `build.timeout_ms` is the string `"300000"`
- **WHEN** `interlock verify plan --profile <file> --json` runs against each
- **THEN** each exits 1, the first naming `build.command` and the second naming `build.timeout_ms`
- **AND** no plan is printed

#### Scenario: Edge case — nothing found is null, and the skill never asks

- **GIVEN** the shipped `skills/fix-tests/SKILL.md` and `shared/TEST-PROFILE.md`
- **WHEN** the skill suite reads them
- **THEN** the skill names `build.command` and `scripts.build` in the paragraph that resolves the type-check and lint commands, and that paragraph still says never to ask for one and never to invent one
- **AND** the contract's schema holds a `"build"` section, and its field table says a `null` build command is skipped with a reason, never guessed

### Requirement: The build SHALL be planned at the final gate only, from the profile's own command

`interlock verify plan` SHALL plan a build step only outside the inter-wave context, from the profile's `build.command` verbatim, with the profile's working directory and time allowance, after the lint step and before coverage and end-to-end, and SHALL mark it blocking. Between waves it SHALL skip the build with a reason of its own, and no flag SHALL plan it there. With no build command it SHALL skip the build with the no-detectable-command reason.

#### Scenario: Happy path — a final plan holds the build step

- **GIVEN** a profile with a unit command, a lint command, and a `build` section whose command is `npm run build` and whose `timeout_ms` is 300000
- **WHEN** `interlock verify plan --profile <file> --context final --json` runs
- **THEN** the plan holds a `build` step whose command is `npm run build`, whose `blocking` is true and whose `timeoutMs` is 300000
- **AND** the step sits after the `unit` and `lint` steps and before any coverage or end-to-end step

#### Scenario: Failure — no build command is a stated skip, never a guess

- **GIVEN** a profile with no `build` section, a profile whose `build` is `null`, and separately no profile at all
- **WHEN** `interlock verify plan --context final --json` runs for each
- **THEN** no plan holds a build step
- **AND** each plan's `skipped` list holds a `build` entry whose reason is `no-detectable-command`

#### Scenario: Edge case — between waves the build is never planned

- **GIVEN** a profile with a unit command and a build command
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --json` runs
- **THEN** the plan holds no build step, and its `skipped` list holds a `build` entry whose reason is `final-gate-only`
- **AND** the budget the plan reports is what it reports for the same profile without the `build` section

#### Scenario: Edge case — a documentation-only change, and a spent budget

- **GIVEN** a profile with a build command
- **WHEN** the final plan is made once with `--changed docs/a.md` and once with `--elapsed-ms` at the budget
- **THEN** the first plan skips the build with the docs-only reason, as it skips every kind
- **AND** the second plan skips the build with the budget-exceeded reason

### Requirement: The verification verdict SHALL carry the lint's and the build's own results

The verdict `interlock verify judge` returns SHALL carry the lint's result and the build's result, each as a field of its own beside the type check's, in every context: whether it ran, its exit code, and whether it passed. A step that could not be executed SHALL be recorded as not passed. When no result was reported for a kind, its field SHALL be present and empty.

#### Scenario: Happy path — a passing lint and a passing build are recorded

- **GIVEN** a final plan with a lint step and a build step, and reported results for both that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's lint field and its build field each record that the step ran and passed, with exit code 0

#### Scenario: Failure — a lint that could not run is recorded as not passed

- **GIVEN** a plan with a lint step and a reported lint result that says it did not run
- **WHEN** the results are judged
- **THEN** the verdict's lint field records that it did not run and did not pass, with no exit code
- **AND** the verdict carries a warning that names the lint and does not halt

#### Scenario: Edge case — no lint or build result reported

- **GIVEN** a plan with a lint step and a build step, and results that carry neither
- **WHEN** the results are judged
- **THEN** the verdict's lint field and its build field are both present and empty
- **AND** the unit, type-check, end-to-end and coverage fields are what they are without these two

### Requirement: A failed build SHALL halt the final gate, and a failed lint SHALL halt nothing

At the final gate a build that failed, or that could not be executed, SHALL halt the verdict, with a reason that names the build. The final gate's halting kinds SHALL be the unit suite and the build; the inter-wave halting kinds SHALL stay the type check and the unit suite. A failed lint SHALL be reported with a non-blocking warning in every context and SHALL NOT halt.

#### Scenario: Happy path — a green build passes the gate

- **GIVEN** a final plan with a unit step and a build step, and results for both that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict does not halt
- **AND** its halting kinds are the unit suite and the build

#### Scenario: Failure — a red build halts the final gate

- **GIVEN** a final plan with a unit step and a build step, a unit result that exited zero and a build result that exited 2
- **WHEN** `interlock verify judge --context final` judges them
- **THEN** the verdict halts with a reason that names the build and exit code 2, and the command exits 1
- **AND** a ship run whose final verification returns that verdict halts with that reason and commits nothing

#### Scenario: Failure — a build that could not run halts as well

- **GIVEN** a final plan with a build step and a reported build result that says it did not run
- **WHEN** the results are judged at the final gate
- **THEN** the verdict halts, and its reason says the build could not be executed

#### Scenario: Edge case — a red lint beside a green suite does not halt

- **GIVEN** a plan with a unit step and a lint step, a unit result that exited zero and a lint result that exited 1
- **WHEN** the results are judged, once at the final gate and once between waves
- **THEN** neither verdict halts, and each carries a non-blocking warning that names the lint
- **AND** each verdict's lint field records that the lint did not pass

#### Scenario: Edge case — a build result judged between waves does not halt

- **GIVEN** a unit result that exited zero and a build result that exited 2, handed to the judge although no inter-wave plan holds a build step
- **WHEN** `interlock verify judge --context inter-wave` judges them
- **THEN** the verdict does not halt, and carries a non-blocking warning that names the build
- **AND** its build field records that the build did not pass

#### Scenario: Edge case — a red type check at the final gate still does not halt

- **GIVEN** a final plan with a type-check step and a build step, a type-check result that exited non-zero and a build result that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict does not halt, and carries the non-blocking type-check banner as before

### Requirement: The verification briefing SHALL state each planned step's time allowance

The briefing a ship run gives its verify agent SHALL name, in one paragraph after the planned lines, the time allowance of every planned step that carries one. It SHALL tell the agent to set its shell tool's timeout to the larger of the tool's default and the allowance, capped at the tool's maximum, and to report a step ended at its timeout as failed. A plan with no allowance SHALL be briefed as it is without the paragraph.

#### Scenario: Edge case — an allowance below the tool's default is a floor

- **GIVEN** a final plan whose unit step carries an allowance of 40000, one measured green run of the suite
- **WHEN** the verification briefing is assembled
- **THEN** the paragraph tells the agent to use the larger of the tool's default and the allowance, and never asks for a timeout shorter than the tool's default

#### Scenario: Happy path — a build's allowance reaches the agent

- **GIVEN** a final plan whose unit step carries an allowance of 120000 and whose build step carries one of 300000
- **WHEN** the verification briefing is assembled
- **THEN** it holds `TIME ALLOWANCES` one time, in a paragraph that names `unit` with 120000 and `build` with 300000
- **AND** every planned line is still the `interlock verify exec` command alone, and the paragraph sits after the sentence that says to run each line as written

#### Scenario: Failure — a step ended at its timeout is not reported as a pass

- **GIVEN** the same briefing
- **WHEN** a reader finds the paragraph
- **THEN** it says a step the tool ended at its timeout is reported with a `non-zero` exit code, naming the step and the timeout

#### Scenario: Edge case — a plan with no allowance is briefed as before

- **GIVEN** a plan whose steps are a type check and a lint, and separately a plan whose unit step's allowance is `null`, zero or negative
- **WHEN** each briefing is assembled
- **THEN** neither holds `TIME ALLOWANCES`
- **AND** each is byte for byte the briefing the same steps get without this requirement

#### Scenario: Edge case — between waves, and on a fix attempt

- **GIVEN** an inter-wave plan whose unit step carries an allowance, briefed once as a first attempt and once as a fix attempt
- **WHEN** each briefing is assembled
- **THEN** each holds the paragraph one time
