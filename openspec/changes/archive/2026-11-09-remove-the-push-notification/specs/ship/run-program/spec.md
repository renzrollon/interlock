## ADDED Requirements

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed, and SHALL accept a retired push request without acting on it

`interlock run close` MUST build the receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary and the banner list, which both drivers print verbatim. It MUST accept host-only banners. Neither driver MAY pass `--notify`. Until 1.16.0 the close MUST accept `--notify` and do nothing but add one summary row saying the push was removed.

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

#### Scenario: Edge case — an older driver's push request closes the run and is spoken

- **GIVEN** a run ready to close, and a call to `run close --notify`
- **WHEN** the close returns
- **THEN** the exit code and banner list are those of the same close without `--notify`, and "No degradation banners" is still printed for a clean run
- **AND** the summary carries one row saying the push was removed, and no request is made

#### Scenario: Failure — a driver passes the retired flag again

- **GIVEN** a driver that passes `--notify` to `run close`
- **WHEN** the driver-parity test runs
- **THEN** it fails naming that driver and the flag

## REMOVED Requirements

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed

**Reason**: Its two push scenarios required both drivers to pass `--notify`, and the push is removed. A MODIFIED form would have had to keep their titles.

**Migration**: Replaced by "The closing step SHALL produce the summary and exit code both hosts print, from what the run observed, and SHALL accept a retired push request without acting on it". That requirement keeps the three non-push scenarios word for word.
