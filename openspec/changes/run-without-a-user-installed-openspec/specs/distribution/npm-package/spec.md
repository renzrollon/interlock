# Spec Delta

## ADDED Requirements

### Requirement: The bundle SHALL ship no top-level `bin/`, no compiled executable and no install-time download

The file set the package ships MUST hold no path under a top-level `bin/`, and every `bin` entry in `package.json` MUST point under `cli/`. No shipped file MAY begin with an ELF, Mach-O or PE signature. `.claude-plugin/plugin.json` MUST NOT declare `binaries`, and the bundle root MUST NOT hold a lockfile the host would install. A test MUST check all five over the file set `npm pack` would ship and name each offender.

#### Scenario: Happy path — the bundle as shipped passes

- **GIVEN** the working tree's `files` whitelist and manifests
- **WHEN** the package test runs
- **THEN** it passes
- **AND** each of the four executables `interlock`, `interlock-graph`, `interlock-run` and `interlock-ship-acp` is a `bin` entry under `cli/`, starts with `#!/usr/bin/env node` and is executable

#### Scenario: Failure — a file under a top-level `bin/` fails naming it

- **GIVEN** a `files` whitelist that also covers `bin/`, holding `bin/interlock`
- **WHEN** the package test runs
- **THEN** it fails naming `bin/interlock`

#### Scenario: Failure — a compiled executable anywhere in the bundle fails naming it

- **GIVEN** a shipped file `lib/vendor/tool` whose first four bytes are `7f 45 4c 46`
- **WHEN** the package test runs
- **THEN** it fails naming `lib/vendor/tool` as a compiled executable

#### Scenario: Edge case — a `binaries` key or a root lockfile fails

- **GIVEN** a `plugin.json` that declares `binaries`, or a `package-lock.json` beside the root `package.json` that the whitelist ships
- **WHEN** the package test runs
- **THEN** it fails naming `binaries` or `package-lock.json`
- **AND** a lockfile carried as data inside a shipped `.mjs` module is not reported
