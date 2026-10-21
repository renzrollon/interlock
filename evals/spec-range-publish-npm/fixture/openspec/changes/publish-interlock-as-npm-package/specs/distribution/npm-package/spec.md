## ADDED Requirements

### Requirement: The published tarball SHALL be a whitelist closed over the declared binaries

`package.json` MUST declare a `files` whitelist, and every file reachable from any `bin` entry through relative `import`, `export ... from` or `import()` specifiers MUST be covered by an entry in that whitelist. A test MUST enumerate that closure and fail naming any uncovered file. The tarball MUST NOT contain `test/`, `openspec/`, `docs/`, `evals/` or `.claude/`.

#### Scenario: Happy path — a global install runs every declared binary

- **GIVEN** the tarball produced by `npm pack` from a clean checkout
- **WHEN** it is installed globally into a fresh prefix and each `bin` entry is run with `--help`, and `interlock limits` is run
- **THEN** every command exits `0`
- **AND** none of them fails with a module-resolution error

#### Scenario: Failure — a new library file is reachable but not whitelisted

- **GIVEN** a `bin` entry that imports `lib/new-thing.mjs` and a `files` list that does not cover `lib/`
- **WHEN** the package test runs
- **THEN** it fails and names `lib/new-thing.mjs` as reachable from that binary and uncovered
- **AND** it does not pass on the grounds that `npm pack` succeeded

#### Scenario: Edge case — a directory that must never ship is added to the whitelist

- **GIVEN** a `files` list that includes `test`
- **WHEN** `npm pack --dry-run` is inspected by the validation task
- **THEN** the task fails because a file under `test/` is listed
- **AND** the whitelist is corrected rather than the check relaxed

### Requirement: The three version-bearing manifests SHALL carry one version

`package.json`, `.claude-plugin/plugin.json` and the first plugin entry of `.claude-plugin/marketplace.json` MUST carry identical `version` strings of the form `MAJOR.MINOR.PATCH`, and a test MUST fail when they differ or when any is malformed.

#### Scenario: Happy path — a lockstep bump passes

- **GIVEN** all three manifests read `0.3.0`
- **WHEN** the package test runs
- **THEN** it passes
- **AND** the release tag `v0.3.0` matches the version the workflow will publish

#### Scenario: Failure — a partial bump

- **GIVEN** `package.json` reads `0.3.0` and `.claude-plugin/plugin.json` still reads `0.2.0`
- **WHEN** the package test runs
- **THEN** it fails naming both files and both values

#### Scenario: Edge case — a pre-release suffix

- **GIVEN** `package.json` reads `0.3.0-rc.1`
- **WHEN** the package test runs
- **THEN** it fails because the accepted form is `MAJOR.MINOR.PATCH` only
- **AND** the message says pre-release versions are not published by the release workflow

### Requirement: A release SHALL be published from a version tag with provenance and no stored token

The release workflow MUST trigger only on tags matching `v[0-9]*`, MUST run the test suite before publishing, MUST publish with `--provenance` using the workflow's OIDC identity, and MUST NOT read a registry token from repository secrets. When trusted publishing is not configured for the repository, the publish step MUST fail with the registry's error rather than skipping.

#### Scenario: Happy path — a tag publishes

- **GIVEN** trusted publishing is configured for this repository and workflow file, and tag `v0.3.0` is pushed with lockstep manifests at `0.3.0`
- **WHEN** the release workflow runs
- **THEN** `npm test` passes and `npm publish` succeeds with a provenance attestation
- **AND** the published version is `0.3.0`

#### Scenario: Failure — trusted publishing is not configured

- **GIVEN** a tag is pushed before the registry has been configured for this repository
- **WHEN** the release workflow reaches the publish step
- **THEN** the step exits non-zero with the registry's authentication error
- **AND** the workflow is reported failed, not skipped

#### Scenario: Edge case — a branch push or a non-version tag

- **GIVEN** a push to `main` or a tag named `docs-snapshot`
- **WHEN** GitHub evaluates workflow triggers
- **THEN** the release workflow does not run
- **AND** the CI workflow runs as before
