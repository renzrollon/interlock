# distribution/npm-package Specification

## Purpose
TBD - created by archiving change publish-interlock-as-npm-package. Update Purpose after archive.

## Requirements

### Requirement: The published tarball SHALL be a whitelist closed over the declared binaries

`package.json` MUST declare a `files` whitelist, and every file reachable from any `bin` entry, or from the hooks module `hooks/hooks.json` names, through relative `import`, `export ... from` or `import()` specifiers MUST be covered by an entry in that whitelist. A test MUST enumerate that closure from every root and fail naming any uncovered file and the root it is reachable from. The tarball MUST NOT contain `test/`, `openspec/`, `docs/`, `evals/` or `.claude/`.

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

#### Scenario: Failure — a file the hooks module imports is reachable but not whitelisted

- **GIVEN** `hooks/hooks.json` naming `hooks/mod.mjs`, which imports `lib/pure-thing.mjs`, and a `files` list that does not cover that file
- **WHEN** the package test runs
- **THEN** it fails and names `lib/pure-thing.mjs` as reachable from the hooks module and uncovered
- **AND** a bare specifier such as `claude-code` in the module is not walked, because it is the engine's and not the package's

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

### Requirement: The manifest's type contract SHALL ship in the tarball

When the plugin manifest names a `types` path, the file it names MUST be covered by the `files` whitelist, and the package test MUST fail naming the path when it is not, because a published plugin whose contract is missing fails the host's validation at install and its session state is refused.

#### Scenario: Happy path — the contract is whitelisted

- **GIVEN** a manifest naming `./types/index.d.ts` and a `files` list containing `types`
- **WHEN** the package test and `npm pack --dry-run` run
- **THEN** the contract file is listed in the tarball
- **AND** the installed package validates with the same `state reads:` and `state writes:` lines as the checkout

#### Scenario: Failure — the contract is named but not shipped

- **GIVEN** a manifest naming `./types/index.d.ts` and a `files` list without `types`
- **WHEN** the package test runs
- **THEN** it fails naming `types/index.d.ts` as named by the manifest and uncovered
- **AND** it does not pass on the grounds that `npm pack` succeeded

#### Scenario: Edge case — no `types` key

- **GIVEN** a manifest without a `types` key
- **WHEN** the package test runs
- **THEN** it asserts nothing about a contract file
- **AND** a stray `types/` directory with no manifest key is not required to ship

### Requirement: The manifest's listing image SHALL be declared, shipped and an image

The plugin manifest MUST name its listing image under `icon`, as a path that begins `./` and resolves to a file the `files` whitelist covers. That file MUST be a complete PNG that is square and within the pixel bounds the package test records for a listing image. A test MUST fail naming the path and the reason when the key is absent, when the path is not covered, or when the file is not such an image, because the plugin directory reads the listing image from that key and a bundled image nothing declares is an asset it cannot account for.

#### Scenario: Happy path — the declared image ships

- **GIVEN** a manifest whose `icon` is `./assets/icon.png` and a `files` list containing `assets`
- **WHEN** the package test and `npm pack --dry-run` run
- **THEN** the test passes and the image is listed in the tarball
- **AND** `claude plugin validate . --strict` reports no warning for the key

#### Scenario: Failure — the image is named but not shipped

- **GIVEN** a manifest whose `icon` is `./assets/icon.png` and a `files` list without `assets`
- **WHEN** the package test runs
- **THEN** it fails naming `assets/icon.png` as named by the manifest and uncovered
- **AND** it does not pass on the grounds that the file exists in the working tree

#### Scenario: Failure — the key is absent

- **GIVEN** a manifest without an `icon` key and an image under `assets/`
- **WHEN** the package test runs
- **THEN** it fails saying the bundle ships an image the manifest does not declare
- **AND** the message names the image's path

#### Scenario: Edge case — a path without the leading `./`, or an image that is not square

- **GIVEN** a manifest whose `icon` is `assets/icon.png`, or one that names a PNG 512 pixels wide and 256 high
- **WHEN** the package test runs
- **THEN** it fails naming the value in the first case and the two dimensions in the second
- **AND** neither is accepted because the file is a valid PNG

### Requirement: The bundle SHALL stay inside the directory's file limits

Every file the tarball ships that is not an image or a font MUST be under 262,144 bytes, and the tarball MUST hold 512 files or fewer. A test MUST compute both over the file set `npm pack` would ship, record the two limits beside the name of the document they come from, and fail naming each file over the size limit with its size, or the count when the count is over, because the plugin directory holds a version for a reviewer on either and nothing else in the repository measures them.

#### Scenario: Happy path — the bundle as shipped is inside both limits

- **GIVEN** the working tree's `files` whitelist
- **WHEN** the package test runs
- **THEN** it passes
- **AND** it asserts over the same file set the closure test walks, not over a list written by hand

#### Scenario: Failure — a source file grows past the size limit

- **GIVEN** a shipped `.mjs` file of 262,145 bytes
- **WHEN** the package test runs
- **THEN** it fails naming that file, its size and the limit
- **AND** it does not pass on the grounds that `npm pack` succeeded

#### Scenario: Edge case — the boundary, an image and the count

- **GIVEN** a shipped text file of 262,144 bytes, a shipped PNG of 300,000 bytes, and a whitelist that covers 513 files
- **WHEN** the package test runs
- **THEN** it fails for the text file, because the limit is under 262,144 bytes and not at it, and for the count
- **AND** it reports nothing for the PNG, because the size limit is for files that are not images or fonts
