## ADDED Requirements

### Requirement: The preflight SHALL name a CLI whose version differs from the plugin's

The doctor SHALL resolve the `interlock` binary the session's `PATH` serves to its real path, and read that binary's version from its own package or by asking it. It SHALL then compare the version with the version of the plugin the doctor belongs to, and report:

- **an older version, or a binary that cannot report one:** a failing row reading `CLI VERSION SKEW: interlock on PATH is <x> (<path>), plugin is <y>`, with a fix naming the command that installs the plugin's version;
- **a newer version:** an advisory row;
- **equal versions:** a passing row.

The resolved path and both versions SHALL be carried in the row's evidence and SHALL be written into the session's preflight file. The hook SHALL still exit 0.

#### Scenario: Failure — an npm copy one release behind the plugin

- **GIVEN** a plugin at `1.8.0` and an `interlock` on `PATH` that resolves to a `1.7.0` npm install
- **WHEN** the session starts
- **THEN** the session receives `CLI VERSION SKEW: interlock on PATH is 1.7.0 (<path>), plugin is 1.8.0` with the install command as its fix
- **AND** the preflight file records the path and both versions

#### Scenario: Edge case — a binary too old to report its version

- **GIVEN** an `interlock` on `PATH` that answers `--version` with `Unknown command`
- **WHEN** the doctor runs
- **THEN** the row fails and says the binary predates version reporting

#### Scenario: Happy path — the plugin's own binary

- **GIVEN** the only `interlock` on `PATH` is the plugin's own
- **WHEN** the doctor runs
- **THEN** the row passes

### Requirement: The doctor's test-profile row SHALL apply the same validation a run applies

The doctor's test-profile row SHALL fail, naming the problem, for any profile the run's verification would reject. A profile the doctor passes SHALL NOT be rejected by a run's verification.

#### Scenario: Failure — a timeout written as a string

- **GIVEN** a test profile whose unit timeout is the string `"120000"`
- **WHEN** the doctor runs
- **THEN** the test-profile row fails naming the timeout field
