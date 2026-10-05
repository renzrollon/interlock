## MODIFIED Requirements

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
