# Spec Delta

## MODIFIED Requirements

### Requirement: The verification signals SHALL read the final verification verdict, one band per outcome

The suite signal (`verify.suite`) SHALL read the unit suite's, the type check's, the lint's and the build's own results in the final verification verdict, whatever that verdict's halting set, and SHALL take the worst of the four. For each of them:

- a failure of the unit suite, the type check or the build SHALL be red, including a type check that failed at the final gate, where the ship loop reports it without halting;
- a lint failure SHALL be amber, marked as needing a fix, and SHALL never be red;
- unit failures the verdict excused as pre-existing SHALL be amber, marked as needing a person;
- a skip because every changed path is documentation SHALL be green with the docs-only flag;
- a unit skip for want of a test profile or a unit command SHALL be amber with no flag;
- a type-check skip for want of a type-check command SHALL be green with the flag naming the absent type checker;
- a lint skip for want of a lint command SHALL be green with the flag naming the absent linter (`no-lint`), and a build skip for want of a build command SHALL be green with the flag naming the absent build (`no-build`);
- a skip because the verification budget was spent, a planned step with no reported result, and a verdict that records neither a result nor a skip for a kind SHALL be unobserved;
- any other skip reason SHALL be amber;
- a pass SHALL be green.

The band, the mark and the reason SHALL come from the worst of the four, and the flags from all four, so a flag is still reported when another kind holds the signal at a worse band.

The end-to-end signal (`verify.e2e`) SHALL be amber, marked as needing a fix, when the suite ran and failed; green with the flag naming the absent suite when the repository has no enabled end-to-end suite or the caller did not request one; green with no flag when it was skipped because every changed path is documentation; unobserved when the budget was spent or a planned run has no reported result; and green when it passed. A verification verdict that is not from the final gate SHALL make both verification signals unobserved.

Rationale: the final gate declines to halt on a failed type check because the ship loop publishes an exhaustive list of hard halts, and that is a statement about whether the run stops, not about whether the result can be merged. A lint failure is a defect a tool found and a fix clears without a product decision, so it holds the verdict for a person and does not block; a change that does not build cannot be merged. A verdict that says nothing about a kind was written before the kind was read, or lost its result, and either way it is not evidence that the kind passed.

#### Scenario: Happy path — a green final verdict with no e2e suite

- **GIVEN** a final verification verdict in which the unit suite, the type check, the lint and the build passed and end-to-end was skipped as not configured
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green with no flag
- **AND** the end-to-end signal is green with the flag naming the absent suite

#### Scenario: Failure — a red unit suite is red

- **GIVEN** a final verification verdict that halted on the unit suite
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red and the verdict is `BLOCK`

#### Scenario: Failure — a type check that failed at the final gate is red

- **GIVEN** a final verification verdict that did not halt, in which the unit suite passed and the type check failed, carrying the banner that the type check failed and is non-blocking at the final gate
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red and the verdict is `BLOCK`
- **AND** the evidence names the type-check failure

#### Scenario: Edge case — an end-to-end suite that ran and failed is amber, not red

- **GIVEN** a final verification verdict in which the unit suite, the type check, the lint and the build passed and the end-to-end suite ran and failed
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is green and the end-to-end signal is amber
- **AND** the verdict is `HUMAN`, with the end-to-end failure named as needing a fix

#### Scenario: Edge case — pre-existing unit failures are amber, not green and not red

- **GIVEN** a final verification verdict whose unit failures were excused as pre-existing
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber, marked as needing a person
- **AND** its reason says the failures are pre-existing

#### Scenario: Edge case — each skip reason resolves to one band

- **GIVEN** five final verification verdicts: one skipping every kind because the changed paths are documentation, one skipping the unit suite for want of a test profile, one skipping the unit suite for want of a unit command, one skipping the unit suite because the verification budget was spent, and one whose plan held a type-check step for which no result was reported
- **WHEN** each is assessed
- **THEN** the first reads the suite signal green with the docs-only flag
- **AND** the second and third read it amber with no flag
- **AND** the fourth and fifth read it unobserved, each with a reason naming the kind

#### Scenario: Failure — a red build is red

- **GIVEN** a final verification verdict that halted on the build, in which the unit suite, the type check and the lint passed
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is red, marked as needing a fix, and the verdict is `BLOCK`
- **AND** the evidence names the build failure and its exit code

#### Scenario: Failure — a red lint is amber and needs a fix

- **GIVEN** a final verification verdict that did not halt, in which the unit suite, the type check and the build passed and the lint failed
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber, marked as needing a fix, and the verdict is `HUMAN`
- **AND** the signal is not red, and its reason names the lint failure

#### Scenario: Edge case — no lint command and no build command are flags, not bands

- **GIVEN** a final verification verdict in which the unit suite and the type check passed, and the lint and the build were each skipped because the profile names no command for them
- **WHEN** the merge confidence is assessed with every other signal green and clean
- **THEN** the suite signal is green and carries `no-lint` and `no-build`, and the verdict is `MERGE`
- **AND** the score is strictly below the score of the same input with a passing lint and a passing build

#### Scenario: Edge case — a verdict that records nothing for the lint or the build is unobserved

- **GIVEN** a final verification verdict written before these results existed, in which the unit suite and the type check passed and nothing is recorded for the build: no result and no skip
- **AND** separately a final verdict whose plan held a build step for which no result was reported
- **WHEN** each is assessed
- **THEN** each reads the suite signal unobserved, with a reason that names the build
- **AND** neither reads green, and the verdict is `HUMAN`

#### Scenario: Edge case — the worst of four holds the signal, and every flag is still reported

- **GIVEN** a final verification verdict in which the unit suite passed, the lint failed, and the type check and the build were each skipped because the profile names no command for them
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber, marked as needing a fix, with a reason that names the lint
- **AND** it carries `no-typecheck` and `no-build`

#### Scenario: Edge case — a lint the caller turned off is amber, not a flag

- **GIVEN** a final verification verdict in which the unit suite, the type check and the build passed, and the lint was skipped because the caller turned it off
- **WHEN** the merge confidence is assessed
- **THEN** the suite signal is amber, marked as needing more evidence, with a reason that names the lint and its skip reason
- **AND** it carries no `no-lint` flag, because the project has a linter and this verdict did not run it
