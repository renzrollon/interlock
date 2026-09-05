## ADDED Requirements

### Requirement: Every host SHALL run the strict tail from the same step records, and no host SHALL refuse a tail flag

A host driver MUST pass the review, handoff, conformance and strict flags to `interlock run start` and MUST interpret the `review`, `remediate` and `handoff` steps exactly as it interprets a batch step: spawn what the step names, write the results, call the continuation. A host MUST NOT exit with a not-supported code for any tail flag, and MUST NOT carry its own review, remediation or handoff text.

#### Scenario: Happy path — the ACP driver runs a strict run

- **GIVEN** `interlock-ship-acp <change> --strict` with an agent that returns canned review counts
- **WHEN** the driver runs
- **THEN** it reaches the `review`, `remediate` and `handoff` steps and closes with exit code `0` or `1` from the run's own verdict
- **AND** it never exits `2`

#### Scenario: Failure — a driver that still refuses is caught

- **GIVEN** a driver containing a refusal branch for `--strict`
- **WHEN** the driver test passes `--strict`
- **THEN** the test fails because the exit code is `2`

#### Scenario: Edge case — a tail flag on a host whose agent cannot review

- **GIVEN** an ACP agent that returns no findings file for the `review` step
- **WHEN** `run reviewed` runs
- **THEN** the review is recorded as not completed with the reason, the run continues to final verification as it does on the Workflow runtime today, and the summary names the incomplete review
