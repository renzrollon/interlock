# openspec-cli Specification

## Purpose
TBD - created by archiving change agree-with-openspec-1-15. Update Purpose after archive.

## Requirements

### Requirement: The doctor SHALL warn when the OpenSpec CLI is older than the published floor

`interlock doctor`'s `openspec` row SHALL compare the version the CLI prints against a floor that is a named constant in the doctor's code. A version below the floor SHALL make the row `warn`. The detail SHALL name the version found, the floor, and the fault that version has: below the first version that syncs nested delta specs, that they read "No deltas found" and archive without syncing; from that version up to the floor, that `validate` passes a change whose MODIFIED block drops a scenario, which `archive` refuses. The fix SHALL be the doctor's own install command. A floor miss SHALL NOT make the row `fail`.

#### Scenario: Happy path — a CLI at or above the floor is ok

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH whose version line carries a version at or above the floor
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `ok`
- **AND** its evidence carries the version line the CLI printed

#### Scenario: Failure — a CLI below the floor warns and names both versions

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH that prints `1.4.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`, not `fail`
- **AND** its detail names `1.4.0`, the floor constant's value, and nested delta specs
- **AND** its fix is the doctor's install command

#### Scenario: Edge case — a CLI that syncs nested deltas but sits below the floor names the validate fault

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH that prints `1.7.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`, not `fail`
- **AND** its detail names `1.7.0`, the floor constant's value, and that `validate` passes a change `archive` refuses
- **AND** its detail does not say nested deltas archive without syncing

#### Scenario: Edge case — a version line with no major.minor.patch is spoken, not passed

- **GIVEN** an `openspec` on PATH whose version probe prints a line with no `x.y.z` in it
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`
- **AND** its detail says the version could not be read and quotes the line

#### Scenario: Edge case — the not-initialised warning still wins its own case

- **GIVEN** an `openspec` on PATH at or above the floor, in a directory with no `openspec/config.yaml`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is the existing not-initialised `warn`, whose fix names `openspec init`

### Requirement: The task reader SHALL count every task line the OpenSpec CLI counts

The tasks.md reader in `lib/artifacts.mjs` SHALL treat a line as a task exactly when the pinned OpenSpec release's task counter does: any CommonMark list marker, a box holding at most one non-space character, and any description. Only `x` or `X` in the box SHALL read as done. The tick and the plan fingerprint's normaliser SHALL rewrite the box the reader matched, never a fixed literal searched for in the line.

#### Scenario: Happy path — every list marker and box shape OpenSpec counts is a task

- **GIVEN** a tasks.md with one task each under `-`, `*`, `+`, `1.` and `1)`, a nested `  - [ ]` sub-task, and a `- [ ]` with no description
- **WHEN** the reader parses it
- **THEN** it returns one task per line, in document order, each open

#### Scenario: Failure — an unrecognised marker is open work, not a skipped line

- **GIVEN** a tasks.md whose only unchecked task is written `- [~] 2.1 wire the guard`, and every other task is `[x]`
- **WHEN** the change is inspected
- **THEN** the task total counts it and the remaining count is 1
- **AND** drift does not report the change as complete

#### Scenario: Edge case — the tick and the fingerprint rewrite the box they matched

- **GIVEN** a tasks.md with `+ [ ] 1.1 alpha`, `1. [~] 1.2 beta` and `- [ x ] 1.3 gamma`
- **WHEN** `tickTasks` ticks 1.1 and 1.2
- **THEN** the lines read `+ [x] 1.1 alpha` and `1. [x] 1.2 beta`, and 1.3 is reported already done
- **AND** normalising the ticked file rewrites every box to `[ ]` and leaves the rest of each line byte-identical

#### Scenario: Edge case — a link bullet is not a task

- **GIVEN** a tasks.md line `- [A](./notes.md)`
- **WHEN** the reader parses it
- **THEN** it returns no task for that line

### Requirement: The authoring skills SHALL name what `openspec validate` checks

The spec skill SHALL run `openspec validate` with the change's name, and bootstrap SHALL run `openspec validate --specs`. A bare `openspec validate` validates nothing and exits 1. The spec skill SHALL state that a `## MODIFIED` requirement keeps every scenario title its living spec holds. To drop or rename a scenario, the skill SHALL say to remove the requirement and add it back, because OpenSpec refuses to archive a MODIFIED block that omits a living scenario.

#### Scenario: Happy path — the spec skill validates the change it wrote

- **GIVEN** `skills/spec/SKILL.md`
- **WHEN** its fenced command lines are read
- **THEN** its validate step is `openspec validate "<name>"`
- **AND** no fenced line is a bare `openspec validate`

#### Scenario: Happy path — bootstrap validates the specs it wrote

- **GIVEN** `skills/bootstrap/SKILL.md`
- **WHEN** its fenced command lines are read
- **THEN** its validate step is `openspec validate --specs`

#### Scenario: Edge case — the scenario-title rule is pinned by token

- **GIVEN** `skills/spec/SKILL.md`
- **WHEN** the skills test reads it
- **THEN** it finds the tokens `MODIFIED`, `scenario title` and `REMOVED`

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

`interlock openspec provision` SHALL install the pinned lockfile with npm's lockfile-exact install, with install scripts off, into a staging directory under the plugin's data directory. It SHALL write a launcher there, run the launcher's `--version` and require it to report the pinned version, and only then place the staging directory atomically as the per-version directory, removing older versions' directories. A run that finds the version already in place SHALL install nothing. Before it stages, a run SHALL remove the staging directories of runs that no longer exist (a pid that is not alive, or a directory older than twice the install timeout) and say how many, and SHALL leave the staging directory of a live, recent run alone. On win32 it SHALL also write an `openspec.cmd` beside the launcher, carrying the same marker, because a PATH lookup there finds only PATHEXT suffixes.

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

#### Scenario: Edge case — a staging directory left by a dead or long-gone run is swept and counted

- **GIVEN** a data directory holding `openspec/.9.9.9.partial-<pid>/` for a pid that is not alive, and `openspec/.9.9.8.partial-<pid>/` for a live pid whose mtime is older than twice the install timeout
- **WHEN** provisioning succeeds
- **THEN** both directories are gone
- **AND** its output says `Removed 2 stale staging directories left by an interrupted provision.`

#### Scenario: Edge case — a live, recent run's staging directory is left in place

- **GIVEN** a data directory holding `openspec/.9.9.7.partial-<pid>/` for another live pid, modified within twice the install timeout
- **WHEN** provisioning succeeds
- **THEN** that directory still exists, and the output does not report it removed

#### Scenario: Edge case — on win32 a batch launcher is written and is not mistaken for a user's CLI

- **GIVEN** provisioning on win32
- **WHEN** it succeeds
- **THEN** `openspec.cmd` exists beside `openspec`, carries the launcher marker in a `@rem` line, runs `node "%~dp0openspec" %*` and exits with its errorlevel
- **AND** a PATH lookup on win32 that finds it does not report a user's CLI

### Requirement: Provisioning SHALL leave a newer version's directory in place

Provisioning SHALL remove only the directories of versions older than the pin. The data directory does not vary with the plugin's version, so a newer version's directory belongs to another Interlock sharing it, and SHALL be left in place.

#### Scenario: Edge case — a newer version's directory is left in place

- **GIVEN** a data directory holding `openspec/99.0.0/`, another Interlock's newer pin, and no directory for the pinned version
- **WHEN** provisioning succeeds
- **THEN** `openspec/99.0.0/` still exists beside the pinned version's directory

### Requirement: A provisioned launcher that PATH does not hold SHALL be named by its full path

When the launcher's directory is not on PATH, a successful `interlock openspec provision` and `interlock openspec which` SHALL say so and name the launcher's full path, because a bare `openspec` does not find it. The doctor's `openspec` row SHALL warn for a pin in the user cache whose directory PATH does not hold, because the session preflight never adds that directory.

#### Scenario: Edge case — provisioning names a launcher whose directory is not on PATH

- **GIVEN** a process whose PATH does not hold `<data>/openspec/<version>/`, as with the user cache
- **WHEN** provisioning succeeds, or finds the version already in place
- **THEN** its output says that directory is not on PATH, so a bare `openspec` does not find the copy
- **AND** it names the launcher's full path

#### Scenario: Edge case — a pin in the user cache that PATH does not hold warns

- **GIVEN** an initialised OpenSpec project, neither `INTERLOCK_PLUGIN_DATA` nor `CLAUDE_PLUGIN_DATA` set, no `openspec` on PATH, and a launcher for the pin provisioned under `$HOME/.cache/interlock/`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`
- **AND** it names the launcher's directory as not on PATH and the launcher's full path

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

`interlock doctor`'s `openspec` row SHALL resolve the CLI in one order: the first `openspec` on PATH that is not the provisioned launcher, then the provisioned pin. It SHALL name the source in its evidence: the user's PATH, or the provisioned pin with its path. With nothing resolved, the row's fix SHALL begin with `interlock openspec provision`, name the pin's Node floor and npm, and keep the npm install command as the alternative. A resolved CLI whose version probe prints nothing SHALL draw a fix that names no Node version and points at the `node` row. The CLI-version floor check against `OPENSPEC_MIN_VERSION` SHALL apply to whichever CLI resolved; this row SHALL apply no Node floor, which is the `node` row's alone.

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
- **AND** its fix begins with `interlock openspec provision`, names the pin's Node floor and npm, and contains `npm install --location=global @fission-ai/openspec@<pin>`, where `<pin>` is the pinned version

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

#### Scenario: Failure — a resolved CLI that does not run sends the reader to the node row

- **GIVEN** an initialised OpenSpec project and an `openspec` on PATH whose version probe prints nothing
- **WHEN** `interlock doctor --json` runs
- **THEN** the `openspec` row is `warn`
- **AND** its fix names the `node` row and holds no three-part Node version

### Requirement: The doctor's OpenSpec Node warning SHALL apply only to an OpenSpec that runs on the user's Node

The doctor's `node` row SHALL warn that Node is below the resolved OpenSpec's Node floor only when that OpenSpec runs on the user's Node: the provisioned copy, or a CLI on PATH that is a script. The floor SHALL be the pin's for the provisioned copy and, for a PATH script, the minimum Node its own package declares; when the doctor cannot read one it SHALL use the pin's floor and say that it did. The doctor SHALL name no OpenSpec Node floor it did not read from the pin or from that package. A standalone binary on PATH, and no OpenSpec at all, SHALL NOT draw that warning. The plugin's own Node floor is unchanged.

#### Scenario: Happy path — Node 22 with a provisioned copy draws no warning

- **GIVEN** a Node at the pin's Node floor and a provisioned launcher
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `ok`

#### Scenario: Failure — Node 18 with a provisioned copy warns

- **GIVEN** Node `v18.20.8`, a pin whose Node floor is above it, and a provisioned launcher
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the pin's Node floor

#### Scenario: Failure — Node 18 with the npm build on PATH still warns

- **GIVEN** Node `v18.20.8` and an `openspec` on PATH whose file, read at its realpath, begins with the bytes `#!` and sits in an OpenSpec package that declares `engines.node` `>=20.19.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names `20.19.0`

#### Scenario: Edge case — Node 18 with a standalone binary on PATH draws no warning

- **GIVEN** Node `v18.20.8` and an `openspec` on PATH whose first bytes are an ELF or Mach-O signature
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `ok` and does not name the pin's Node floor

#### Scenario: Edge case — no OpenSpec resolved leaves the fix to the openspec row

- **GIVEN** Node `v18.20.8`, no `openspec` on PATH and nothing provisioned
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row does not name the pin's Node floor
- **AND** the `openspec` row's fix begins with `interlock openspec provision`

#### Scenario: Failure — a Node just below the pin's floor with a provisioned copy warns

- **GIVEN** a provisioned launcher and a Node below the pin's Node floor by one minor release, or by one major release when the floor's minor is 0
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the pin's Node floor

#### Scenario: Happy path — a PATH script at the floor its own package declares draws no warning

- **GIVEN** an `openspec` script on PATH in an OpenSpec package that declares a minimum Node below the pin's floor, and a Node at that declared minimum
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `ok`
- **AND** it does not name the pin's Node floor

#### Scenario: Failure — a PATH script is held to a declared floor above the pin's

- **GIVEN** an `openspec` script on PATH in an OpenSpec package that declares a minimum Node above the pin's floor, and a Node at the pin's floor
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the declared minimum

#### Scenario: Edge case — a PATH script whose floor cannot be read is held to the pin's, and the row says so

- **GIVEN** Node `v18.20.8` and an `openspec` script on PATH with no OpenSpec package manifest above its realpath
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the pin's Node floor
- **AND** it says that CLI's own floor could not be read

#### Scenario: Edge case — a declared range that is not one minimum is treated as unread

- **GIVEN** Node `v18.20.8` and an `openspec` script on PATH in an OpenSpec package that declares `engines.node` `>=18 <23`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the pin's Node floor
- **AND** it says that CLI's own floor could not be read

#### Scenario: Edge case — a manifest of another package is not read as the CLI's floor

- **GIVEN** Node `v18.20.8` and an `openspec` script on PATH whose nearest `package.json` names a package other than the pin's and declares `engines.node` `>=16.0.0`, with no OpenSpec package manifest above it
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names the pin's Node floor
- **AND** it says that CLI's own floor could not be read

#### Scenario: Edge case — a Windows shim is held to the package installed beside it

- **GIVEN** the `win32` platform, Node `v18.20.8`, and an `openspec.cmd` on PATH with `node_modules/<pin's package>/package.json` beside it declaring `engines.node` `>=20.19.0`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `node` row is `warn` and names `20.19.0`

#### Scenario: Edge case — the doctor names no OpenSpec Node floor it did not read

- **GIVEN** doctor runs on an unreadable Node version, on a Node below the plugin's floor, and on a provisioned launcher with a Node at and below the pin's floor
- **WHEN** each `node` row's detail and fix are read
- **THEN** every three-part Node version they name is the Node passed in or the pin's Node floor

### Requirement: The authoring skills SHALL provision when the OpenSpec CLI is missing

The spec and bootstrap skills' pre-flight SHALL treat an `openspec --version` that reports `command not found` as a CLI to provision: run `interlock openspec provision`, probe again, and stop quoting provisioning's first line when it fails. A CLI that is installed but does not run SHALL keep its own case, which SHALL point at `interlock doctor` for the Node that CLI needs. Dispatch SHALL name the command without running it. No skill SHALL restate the pinned version or a Node floor for OpenSpec.

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

#### Scenario: Edge case — no skill names a Node floor for OpenSpec

- **GIVEN** every `skills/**/*.md` file
- **WHEN** the skills test reads them
- **THEN** none names a three-part Node.js version
- **AND** `skills/spec/SKILL.md`, `skills/bootstrap/SKILL.md` and `skills/dispatch/SKILL.md` each hold `does not run` and `interlock doctor`

### Requirement: An opt-in contract check SHALL measure a candidate OpenSpec against what the skills read

A script SHALL run, against a candidate `openspec` on a scratch project outside the repository, every OpenSpec command the authoring skills rely on, and fail naming each field or exit that differs: the `status --json` and `instructions --json` fields the skills read, the `list --json` fields and task counts, a named `validate`'s exit, an `archive` that syncs a nested delta into the living specs, a `validate --specs` of the result, and bootstrap's `init --tools claude` with the layout it writes: the five stock skills under `.agents/skills/`, each linked from `.claude/skills/`, and no `.claude/commands/`. It SHALL compare the task counts the candidate reports with what Interlock's task reader counts for the same `tasks.md`. The unit suite SHALL run it only against a stub CLI, never against an installed OpenSpec or the network.

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

#### Scenario: Failure — a task count that differs from Interlock's reader is named

- **GIVEN** a stub `openspec` whose `list --json` reports one task fewer than Interlock's reader counts in the scratch change's `tasks.md`
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `list.totalTasks`

#### Scenario: Failure — a living spec that fails validation after the archive is named

- **GIVEN** a stub `openspec` whose `validate --specs` exits 1
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `validate --specs`

#### Scenario: Edge case — the scratch tasks.md carries every task shape the reader counts

- **GIVEN** the `tasks.md` the contract script writes into its scratch change
- **WHEN** the unit test reads it
- **THEN** it holds a task under each of `-`, `*`, `+`, `1.` and `1)`, a nested sub-task, a done task, a box holding a character other than `x`, a task with no description, a link bullet, and a task whose text wraps onto a second line

#### Scenario: Edge case — an init that writes no project config is named

- **GIVEN** a stub `openspec` whose `init --tools claude` exits 0 and writes no `openspec/config.yaml`
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `init --tools claude`

#### Scenario: Edge case — an init that writes command files again is named

- **GIVEN** a stub `openspec` whose `init --tools claude` writes the 2.0.0 skill layout and also a `.claude/commands/` directory
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `init.commands`

#### Scenario: Edge case — an init that copies the skills into .claude/skills instead of linking them is named

- **GIVEN** a stub `openspec` whose `init --tools claude` writes the five skills under `.agents/skills/` and plain copies of them under `.claude/skills/`
- **WHEN** the contract script runs against it
- **THEN** it exits non-zero naming `init.claudeSkills`

### Requirement: The setup docs and design prompts SHALL name the pin's Node floor wherever they name one for OpenSpec

`README.md`, `docs/01-first-hour.md` and `docs/07-cli-and-configuration.md` SHALL name no Node.js version of two or three parts other than the pin's Node floor. `site/DESIGN-PROMPT.md` and `docs/assets/DESIGN-PROMPT.md` SHALL each hold at least one three-part version after `OpenSpec requires` or `OpenSpec CLI needs`, and every such version SHALL be the pin's Node floor. A unit test SHALL read the five files and fail naming the file and the version when one differs.

#### Scenario: Happy path — the docs name the pin's floor

- **GIVEN** the three files and the committed pin
- **WHEN** the unit suite reads every two- and three-part Node.js version they name
- **THEN** each one is the pin's Node floor, written in full or as its major and minor

#### Scenario: Failure — a stale floor is named with its file

- **GIVEN** a text that names `Node.js 20.19+` and a pin whose Node floor is `22.12.0`
- **WHEN** the docs check runs over it
- **THEN** it reports that text's file and `20.19`

#### Scenario: Edge case — the plugin's own one-part floor is not a finding

- **GIVEN** a text that names `Node.js ≥ 18` and no other Node.js version
- **WHEN** the docs check runs over it
- **THEN** it reports nothing

#### Scenario: Failure — a design prompt with a stale OpenSpec floor is named

- **GIVEN** a design prompt whose sample `node` row reads `Node v26.8.1 (plugin requires >=18, OpenSpec requires 20.19.0+)` and a pin whose Node floor is `22.12.0`
- **WHEN** the docs check runs over it
- **THEN** it reports that prompt's file and `20.19.0`
- **AND** it does not report `26.8.1`
