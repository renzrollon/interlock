## ADDED Requirements

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
