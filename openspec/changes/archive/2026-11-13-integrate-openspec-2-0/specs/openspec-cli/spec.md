## MODIFIED Requirements

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

## ADDED Requirements

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
