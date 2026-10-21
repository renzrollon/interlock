## MODIFIED Requirements

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed

`interlock run close` MUST build the run receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary text and the banner list. Both drivers MUST print that summary verbatim. Host-only banners MUST be accepted on the call so the summary's degradation block stays complete. The close MUST accept a `--notify` flag requesting the terminal push, and both drivers MUST pass it from the same place they pass their host-observed inputs, so the push is one implementation the CLI owns and two hosts request rather than two implementations; the driver-parity test MUST fail when one driver passes it and the other does not.

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

#### Scenario: Happy path — both drivers request the push through the close

- **GIVEN** the Workflow script and the runner after this change
- **WHEN** each assembles the arguments for `run close`
- **THEN** both include `--notify`
- **AND** neither contains a network call, a topic, or any notification text of its own

#### Scenario: Failure — one driver stops requesting the push

- **GIVEN** a driver from which `--notify` has been removed
- **WHEN** the driver-parity test runs
- **THEN** it fails naming that driver and the missing flag
