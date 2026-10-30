# Spec Delta

## ADDED Requirements

### Requirement: Interlock SHALL pin one OpenSpec npm release as a lockfile with an integrity per package

Interlock SHALL record one OpenSpec npm release: its package name, its version, the Node floor its `engines.node` declares, and the npm lockfile of its whole dependency tree, where every package carries a sha512 integrity and a `registry.npmjs.org` source. One script SHALL regenerate the record from the registry. A unit test SHALL fail when the record is malformed, when its version is below the published floor, or when any package lacks a sha512 integrity.

#### Scenario: Happy path — the committed pin is well formed and at or above the floor

- **GIVEN** the committed pin
- **WHEN** the unit suite runs
- **THEN** its version is at or above `OPENSPEC_MIN_VERSION`, and its lockfile's `@fission-ai/openspec` entry has that version
- **AND** every package entry carries a `sha512-` integrity and a `resolved` URL under `https://registry.npmjs.org/`

#### Scenario: Failure — a pin below the floor fails the suite naming both versions

- **GIVEN** a pin whose version is `1.7.0` and a floor of `1.8.0`
- **WHEN** the pin check runs over it
- **THEN** it fails
- **AND** its message names `1.7.0` and `1.8.0`

#### Scenario: Edge case — a package with no sha512 integrity fails the check naming it

- **GIVEN** a pin whose lockfile has one entry, `node_modules/yaml`, carrying a `sha1-` integrity
- **WHEN** the pin check runs over it
- **THEN** it fails naming `node_modules/yaml`

#### Scenario: Edge case — regenerating from a lockfile with a package outside the registry fails

- **GIVEN** a generated lockfile whose `node_modules/chalk` entry resolves to a git URL
- **WHEN** the pin script builds the record from it
- **THEN** it exits non-zero naming `node_modules/chalk`
- **AND** the committed pin is left unchanged

### Requirement: Provisioning SHALL install only the pinned lockfile, verified by npm, and place it only after it runs

`interlock openspec provision` SHALL install the pinned lockfile with npm's lockfile-exact install, with install scripts off, into a staging directory under the plugin's data directory. It SHALL write a launcher there, run the launcher's `--version` and require it to report the pinned version, and only then place the staging directory atomically as the per-version directory, removing other versions' directories. A run that finds the version already in place SHALL install nothing.

#### Scenario: Happy path — a clean install is verified, run and placed

- **GIVEN** a data directory with nothing provisioned, and an npm whose install of the pinned lockfile succeeds
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits 0, and `<data>/openspec/<version>/openspec` exists with its execute bit set
- **AND** npm was run with `ci` and `--ignore-scripts` in a directory holding the pin's lockfile
- **AND** its output names the version and that path

#### Scenario: Failure — an integrity mismatch is refused and leaves nothing behind

- **GIVEN** an npm install that exits non-zero with `EINTEGRITY` on its last error line
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero saying a package's bytes differed from the pin, and quotes npm's line
- **AND** no version directory and no staging directory remains under `<data>/openspec/`

#### Scenario: Failure — a CLI that does not start is not placed

- **GIVEN** an install whose launcher's `--version` exits non-zero
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero quoting that output, and places nothing

#### Scenario: Failure — a CLI that reports another version is not placed

- **GIVEN** an install whose launcher's `--version` exits 0 printing `1.14.3`, and a pin of another version
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero quoting that output
- **AND** no version directory and no staging directory remains under `<data>/openspec/`

#### Scenario: Edge case — a version already in place installs nothing

- **GIVEN** a data directory already holding the pinned version's launcher
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits 0 without running npm
- **AND** its output says the version was already provisioned

#### Scenario: Edge case — another version's directory is removed

- **GIVEN** a data directory holding `openspec/1.14.3/` and no directory for the pinned version
- **WHEN** provisioning succeeds
- **THEN** `openspec/1.14.3/` no longer exists

#### Scenario: Edge case — with no plugin data directory, provisioning uses the user cache and says so

- **GIVEN** a process with neither `INTERLOCK_PLUGIN_DATA` nor `CLAUDE_PLUGIN_DATA` set
- **WHEN** `interlock openspec provision` runs
- **THEN** it places the version under `${XDG_CACHE_HOME:-$HOME/.cache}/interlock/openspec/<version>/`
- **AND** its output says the plugin's data directory was not available

### Requirement: Provisioning SHALL name every reason it could not finish

When provisioning cannot finish it SHALL exit non-zero and print one line naming the cause and the next step. A Node below the pin's floor and a missing npm SHALL be refused before any network request, naming OpenSpec's own install routes. A refused write SHALL name the path and the one unsandboxed run, and a failed npm install SHALL quote npm's last error line. Provisioning SHALL NOT fall back to another version, a compiled build or a package launcher.

#### Scenario: Failure — a Node below the floor makes no request

- **GIVEN** a process on Node `v18.20.8` and a pin whose floor is `20.19.0`
- **WHEN** `interlock openspec provision` runs
- **THEN** it exits non-zero naming `18.20.8`, `20.19.0` and `npm install -g @fission-ai/openspec@latest`
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

### Requirement: The provisioned launcher SHALL run the pinned OpenSpec with its telemetry off, and the plugin SHALL ship none

Provisioning SHALL write, beside the installed tree, an executable named `openspec` that carries a fixed marker. It SHALL run the installed OpenSpec with the caller's arguments, streams and exit status, and with `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1` added to its environment. Neither the plugin nor the npm package SHALL ship or declare an executable named `openspec`, and an `openspec` the user installed SHALL NOT be wrapped or given either variable.

#### Scenario: Happy path — arguments and exit status pass through

- **GIVEN** a provisioned version whose OpenSpec exits 3 for `status --change demo --json`
- **WHEN** the launcher runs with `status --change demo --json`
- **THEN** OpenSpec receives exactly those arguments
- **AND** the launcher exits 3

#### Scenario: Happy path — the provisioned OpenSpec sees both variables

- **GIVEN** a provisioned version whose OpenSpec prints its environment
- **WHEN** the launcher runs it
- **THEN** its environment holds `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1`

#### Scenario: Edge case — nothing named `openspec` ships

- **GIVEN** the file set the package ships and `package.json`
- **WHEN** they are read
- **THEN** no shipped file is named `openspec`, and the `bin` map has no `openspec` entry

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
- **AND** its fix begins with `interlock openspec provision`, names `20.19.0` and npm, and contains `npm install -g @fission-ai/openspec@latest`

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

### Requirement: The doctor's OpenSpec Node warning SHALL apply only to an OpenSpec that runs on the user's Node

The doctor's `node` row SHALL warn that Node is below OpenSpec's 20.19.0 only when the resolved OpenSpec runs on the user's Node: the provisioned copy, or a CLI on PATH that is a script. A standalone binary on PATH, and no OpenSpec at all, SHALL NOT draw that warning. The plugin's own Node floor is unchanged.

#### Scenario: Happy path — Node 22 with a provisioned copy draws no warning

- **GIVEN** Node `v22.11.0` and a provisioned launcher
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `ok`

#### Scenario: Failure — Node 18 with a provisioned copy warns

- **GIVEN** Node `v18.20.8` and a provisioned launcher
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names `20.19.0`

#### Scenario: Failure — Node 18 with the npm build on PATH still warns

- **GIVEN** Node `v18.20.8` and an `openspec` on PATH whose file, read at its realpath, begins with the bytes `#!`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names `20.19.0`

#### Scenario: Edge case — Node 18 with a standalone binary on PATH draws no warning

- **GIVEN** Node `v18.20.8` and an `openspec` on PATH whose first bytes are an ELF or Mach-O signature
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row does not name `20.19.0`

#### Scenario: Edge case — no OpenSpec resolved leaves the fix to the openspec row

- **GIVEN** Node `v18.20.8`, no `openspec` on PATH and nothing provisioned
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row does not name `20.19.0`
- **AND** the `openspec` row's fix begins with `interlock openspec provision`

### Requirement: The authoring skills SHALL provision when the OpenSpec CLI is missing

The spec and bootstrap skills' pre-flight SHALL treat an `openspec --version` that reports `command not found` as a CLI to provision: run `interlock openspec provision`, probe again, and stop quoting provisioning's first line when it fails. A CLI that is installed but does not run SHALL keep its own case. Dispatch SHALL name the command without running it. No skill SHALL restate the pinned version.

#### Scenario: Happy path — spec and bootstrap name the command in the missing-CLI case

- **GIVEN** `skills/spec/SKILL.md` and `skills/bootstrap/SKILL.md`
- **WHEN** the skills test reads them
- **THEN** each holds `command not found` and `interlock openspec provision`
- **AND** both appear after the `openspec --version` line and before the first command that needs the CLI

#### Scenario: Edge case — dispatch names the command and fences no line running it

- **GIVEN** `skills/dispatch/SKILL.md`
- **WHEN** the skills test reads it
- **THEN** it holds `interlock openspec provision`
- **AND** no fenced line runs `interlock openspec provision`

#### Scenario: Edge case — review-artifacts no longer claims the CLI

- **GIVEN** `skills/review-artifacts/SKILL.md`, which runs no `openspec` command
- **WHEN** its frontmatter is read
- **THEN** its compatibility line does not say it requires the openspec CLI

#### Scenario: Edge case — no skill restates the pinned version

- **GIVEN** every `skills/**/*.md` file
- **WHEN** the skills test reads them
- **THEN** none contains the pin's version string

### Requirement: An opt-in contract check SHALL measure a candidate OpenSpec against what the skills read

A script SHALL run, against a candidate `openspec` on a scratch project outside the repository, every OpenSpec command the authoring skills rely on, and fail naming each field or exit that differs: the `status --json` and `instructions --json` fields the skills read, a named `validate`'s exit, and an `archive` that syncs a nested delta into the living specs. The unit suite SHALL run it only against a stub CLI, never against an installed OpenSpec or the network.

#### Scenario: Happy path — a conforming CLI passes every check

- **GIVEN** a candidate `openspec` that answers every command the way the pinned release does
- **WHEN** the contract script runs against it
- **THEN** it exits 0 and prints one line naming the CLI it ran, its version and the number of checks passed

#### Scenario: Failure — a missing field is named

- **GIVEN** a stub `openspec` whose `status --json` output has no `applyRequires`
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `status.applyRequires`

#### Scenario: Edge case — the unit suite never runs the contract script against a real OpenSpec

- **GIVEN** `package.json`'s `test` script and the contract script's file name
- **WHEN** they are read
- **THEN** the `test` script does not name the contract script, and the file name does not end in `.test.mjs`
- **AND** the only unit test that starts the script passes it a stub CLI from a scratch directory
