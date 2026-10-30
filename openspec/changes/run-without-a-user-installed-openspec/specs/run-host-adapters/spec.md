# Spec Delta

## MODIFIED Requirements

### Requirement: The runner SHALL forward host records to the CLI apart from the agents' results, and SHALL decide none of the lane banners

`interlock-run` SHALL collect the host record of every spawn from the adapter's events and pass them to the CLI on every record path beside, never inside, the results file, and the CLI SHALL decide every lane banner from them. The runner SHALL print no lane verdict of its own. A driver that passes no host records SHALL leave every lane unobserved.

#### Scenario: Happy path — records travel beside results

- **GIVEN** a batch of two lanes on `--host claude`
- **WHEN** the runner records the batch
- **THEN** the CLI receives two results and two host records on separate channels
- **AND** the results carry no host field

#### Scenario: Failure — a lane with no record

- **GIVEN** a runner whose adapter emitted no record for one lane
- **WHEN** the batch is recorded
- **THEN** that lane raises no lane banner and increments no count

#### Scenario: Edge case — the no-policy sweep

- **GIVEN** `cli/interlock-run` as shipped
- **WHEN** the driver source is swept for policy
- **THEN** it contains none of the lane banner texts and no comparison of a served model
