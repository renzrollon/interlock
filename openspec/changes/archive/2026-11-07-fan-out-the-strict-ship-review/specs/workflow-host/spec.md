# Spec Delta

## MODIFIED Requirements

### Requirement: Every host SHALL run the strict tail from the same step records, and no host SHALL refuse a tail flag

A host driver MUST pass the review, handoff, conformance and strict flags to `interlock run start` and MUST interpret the `review`, `skeptics`, `remediate` and `handoff` steps exactly as it interprets a batch step: spawn what the step names, as many as it names, write the results, call the continuation. A host MUST NOT exit with a not-supported code for any tail flag, MUST NOT carry its own review, remediation or handoff text, and MUST NOT read a step's action or a spawn's kind to decide how to spawn it.

#### Scenario: Happy path — the ACP driver runs a strict run

- **GIVEN** `interlock-run <change> --host acp --strict` with an agent that answers each reviewer and each skeptic by writing the file its briefing names
- **WHEN** the driver runs
- **THEN** it reaches the `review`, `skeptics`, `remediate` and `handoff` steps and closes with exit code `0` or `1` from the run's own verdict
- **AND** it never exits `2`

#### Scenario: Failure — a driver that still refuses is caught

- **GIVEN** a driver containing a refusal branch for `--strict`
- **WHEN** the driver test passes `--strict`
- **THEN** the test fails because the exit code is `2`

#### Scenario: Edge case — a tail flag on a host whose agent cannot review

- **GIVEN** an ACP agent that writes no answer file for any reviewer of the `review` step
- **WHEN** `run found` runs
- **THEN** every dimension is recorded as not run and the review as not completed with the reason, no `skeptics` step is emitted, the run continues to final verification as it does on the Workflow runtime, and the summary names the incomplete review
