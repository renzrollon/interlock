## REMOVED Requirements

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed, and SHALL accept a retired push request without acting on it

**Reason**: 1.15.0 announced that the retired push request would be accepted only until 1.16.0. It is refused from 1.16.0.

**Migration**: the requirement is re-added below under a name that says the request is refused; every scenario but the older driver's accepted request carries over unchanged.

## ADDED Requirements

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed, and SHALL refuse a retired push request

`interlock run close` MUST build the receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary and the banner list, which both drivers print verbatim. It MUST accept host-only banners. Neither driver MAY pass `--notify`. From 1.16.0 the close MUST refuse `--notify` as an unknown flag, exit 2, before it reads or writes anything.

#### Scenario: Happy path — a clean lean run closes with the shared summary

- **GIVEN** a run whose commit spawn reported a sha
- **WHEN** the driver calls `run close` with the commit result
- **THEN** the returned step has exit code `0` and a summary naming the commit, the waves and the "No degradation banners" line
- **AND** the Workflow script and the ACP driver print the same summary text for the same run state

#### Scenario: Failure — a halt closes with the reason and exit code 1

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** the trajectory gains a `run-halt` event carrying the reason, the outcome corpus gains one line, and the returned exit code is `1`

#### Scenario: Edge case — a host banner is carried into the summary

- **GIVEN** the ACP driver hands `run close` a host banner about model routing
- **WHEN** the summary is built
- **THEN** the banner appears in the degradation block
- **AND** the "No degradation banners" line is not printed

#### Scenario: Happy path — neither driver requests a push

- **GIVEN** the Workflow script and the runner
- **WHEN** each assembles the arguments for `run close`
- **THEN** neither includes `--notify`
- **AND** neither contains a network call, a topic, or any notification text of its own

#### Scenario: Failure — an older driver's push request is refused and writes nothing

- **GIVEN** a run at its commit stage, and a call to `run close --notify` from a driver older than the CLI
- **WHEN** the CLI answers
- **THEN** it exits `2` naming `--notify` and saying the driver that passed it is older than the CLI, and prints nothing else on stdout but the `--json` refusal
- **AND** the manifest, the trajectory and the stage marker are as they were, and `run close` without the flag then closes the run

#### Scenario: Failure — a driver passes the retired flag again

- **GIVEN** a driver that passes `--notify` to `run close`
- **WHEN** the driver-parity test runs
- **THEN** it fails naming that driver and the flag
