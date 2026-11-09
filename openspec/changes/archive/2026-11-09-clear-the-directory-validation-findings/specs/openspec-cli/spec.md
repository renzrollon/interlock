## MODIFIED Requirements

### Requirement: Provisioning SHALL name every reason it could not finish

When provisioning cannot finish it SHALL exit non-zero and print one line naming the cause and the next step. A Node below the pin's floor and a missing npm SHALL be refused before any network request, naming OpenSpec's own install routes. A refused write SHALL name the path and the one unsandboxed run, and a failed npm install SHALL quote npm's last error line. Provisioning SHALL NOT fall back to another version, a compiled build or a package launcher.

#### Scenario: Failure — a Node below the floor makes no request

- **GIVEN** a process on Node `v18.20.8` and a pin whose floor is `20.19.0`
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero naming `18.20.8`, `20.19.0` and the install route `npm install --location=global @fission-ai/openspec@<pin>`, where `<pin>` is the pinned version and never `latest`
- **AND** it does not run npm

#### Scenario: Failure — no npm makes no request

- **GIVEN** a PATH with no `npm`
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero naming npm, and does not start any process that reaches the network

#### Scenario: Failure — a refused write names the path and the unsandboxed rerun

- **GIVEN** a data directory whose creation fails with `EPERM`
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero naming that path and `EPERM`
- **AND** it says one run of `interlock openspec provision` outside the sandbox provisions it

#### Scenario: Failure — an unreachable registry is named with the rerun

- **GIVEN** an npm install that exits non-zero with `ENOTFOUND registry.npmjs.org` on its last error line
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero quoting that line
- **AND** it says one run outside the sandbox, or with the registry reachable, provisions it

### Requirement: The doctor SHALL name the OpenSpec it resolved and lead its fix with provisioning

`interlock doctor`'s `openspec` row SHALL resolve the CLI in one order: the first `openspec` on PATH that is not the provisioned launcher, then the provisioned pin. It SHALL name the source in its evidence: the user's PATH, or the provisioned pin with its path. With nothing resolved, the row's fix SHALL begin with `interlock openspec provision`, name the Node floor and npm it needs, and keep the npm install command as the alternative. The floor check SHALL apply to whichever CLI resolved.

#### Scenario: Happy path — the provisioned pin is ok and named

- **GIVEN** an initialised OpenSpec project, no `openspec` on PATH, and a provisioned launcher whose version probe prints the pin's version
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `ok`
- **AND** its evidence names the provisioned source, its path and its version

#### Scenario: Happy path — a user's own CLI is named as the PATH source

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH at or above the floor
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `ok` and its evidence names the PATH source

#### Scenario: Failure — nothing resolved in an initialised project warns and leads with provisioning

- **GIVEN** an initialised OpenSpec project, no `openspec` on PATH and nothing provisioned
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`
- **AND** its fix begins with `interlock openspec provision`, names `20.19.0` and npm, and contains `npm install --location=global @fission-ai/openspec@<pin>`, where `<pin>` is the pinned version

#### Scenario: Failure — nothing resolved and no project fails, then names init

- **GIVEN** no `openspec/` directory, no `openspec` on PATH and nothing provisioned
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `fail`
- **AND** its fix begins with `interlock openspec provision` and names `openspec init`

#### Scenario: Edge case — the launcher on PATH is not mistaken for a user CLI

- **GIVEN** a PATH whose only `openspec` is a provisioned launcher for a version other than the pin's, and nothing provisioned for the pin
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row reports nothing resolved
- **AND** it does not report a CLI on PATH
