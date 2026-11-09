## ADDED Requirements

### Requirement: Every package-manager command a shipped text spells SHALL be readable and exactly pinned

A command that a shipped text spells as code (a backtick span, a fenced line, or a string or template literal) and that starts with a package-manager or launcher word SHALL spell its verb in full, use no single-dash option, join each option to its value with `=`, and pin every package it installs or launches to an exact version. No shipped text SHALL set a package source. A test SHALL name each offender with its path and line.

#### Scenario: Failure — a short verb or a short option is named

- **GIVEN** a shipped text spelling `npm i -g x@1.0.0`
- **WHEN** the package test runs
- **THEN** it fails naming the path, the line, the verb `i` and the option `-g`

#### Scenario: Failure — a floating tag or a missing version is named

- **GIVEN** a shipped text spelling `npm install -g @fission-ai/openspec@latest` or `npx tsc --noEmit`
- **WHEN** the package test runs
- **THEN** it fails naming `@latest` on the first and the unversioned `tsc` on the second

#### Scenario: Failure — a value not joined with `=` is named

- **GIVEN** a shipped text spelling `npm install --tag latest x@1.0.0`
- **WHEN** the package test runs
- **THEN** it fails naming `--tag` as an option whose value is not joined with `=`

#### Scenario: Failure — a package-source setting anywhere is named

- **GIVEN** a shipped text spelling `npm config set registry https://x`, naming `.npmrc`, carrying `--registry=https://x` in plain prose, or setting an `npm_config_` variable
- **WHEN** the package test runs
- **THEN** it fails naming each as a package source

#### Scenario: Failure — a command is read to the end of its span and inside a module's literal

- **GIVEN** a module whose template literal says `install the matching CLI (npm i -g @scope/cli@${v}) or expect`, and a Markdown span `npx tool --flag`
- **WHEN** the package test runs
- **THEN** it names the verb `i`, the option `-g` and the unlisted dynamic pin in the first, reading only up to the `)`, and the unversioned `tool` in the second

#### Scenario: Happy path — long-form pinned commands and plain prose pass

- **GIVEN** shipped texts spelling `npm install --location=global @fission-ai/openspec@1.15.0`, `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`, `npm run typecheck`, and the prose "npm users"
- **WHEN** the package test runs
- **THEN** it reports nothing for them

#### Scenario: Edge case — a bare launcher word, a regex over npm's output, a tool pattern and prose outside code are not commands

- **GIVEN** shipped texts holding a rule sentence that names `npx` with no package argument, the regex `/^npm (ERR!|error)/`, the tool pattern `Bash(npm test:*)`, and the plain comment "the npm install stays as the user's own route"
- **WHEN** the package test runs
- **THEN** it reports nothing for them, because none is a command with a verb or a package spelled where code is read

#### Scenario: Edge case — a dynamic pin passes only from a frozen allow-list

- **GIVEN** a shipped module spelling `npm install --location=global ${OPENSPEC_PIN.package}@${OPENSPEC_PIN.version}`
- **WHEN** the package test runs
- **THEN** it reports nothing, because that template is on the frozen allow-list
- **AND** a template not on the list is named as an unpinned package

#### Scenario: Edge case — the README's install lines equal what the CLI prints

- **GIVEN** `README.md` and `docs/01-first-hour.md` quote the OpenSpec install route, and `README.md` names the command that installs the CLIs
- **WHEN** the package test runs
- **THEN** it fails unless each OpenSpec quote equals the install constant the CLI prints
- **AND** it fails unless the CLI install line is `npm install --location=global` followed by the package's name and its `package.json` version

#### Scenario: Happy path — the bundle as shipped passes

- **GIVEN** the working tree's `files` whitelist
- **WHEN** the package test runs
- **THEN** it reports nothing

### Requirement: The bundle's local-code inventory SHALL be declared and asserted against the directory's policy codes

A test SHALL compute, over the file set `npm pack` ships, what the directory's six policy codes name: hooks of every type, hooks modules, workflow scripts, tool grants beyond plain Read, Grep, Glob and LS, and files outside the allowed text and image types. It SHALL hold that against a declared inventory of counts, places and grant paths, and name every difference with its code and path. A UTF-8 license, readme or `.gitignore` without `#!` SHALL be allowed.

#### Scenario: Happy path — the declared inventory matches the shipped set

- **GIVEN** the working tree's `files` whitelist and manifests, and the inventory declared for this version
- **WHEN** the package test runs
- **THEN** it passes

#### Scenario: Failure — a new command hook or an undeclared tool grant is named

- **GIVEN** a manifest with one more command hook than the inventory counts, or a skill the inventory does not list granting `WebFetch`
- **WHEN** the package test runs
- **THEN** it fails naming `LOCAL_CODE_HOOK_COMMAND` with the expected and actual counts, or `LOCAL_CODE_TOOL_GRANT` with the skill's path

#### Scenario: Failure — a file outside the allowed types in an undeclared place is named, and an empty declared place is stale

- **GIVEN** a shipped `skills/foo/run.mjs` while the inventory declares no place under `skills/foo/`, or an inventory declaring `types/` while nothing outside the allowed types ships there
- **WHEN** the package test runs
- **THEN** it fails naming `LOCAL_CODE_FILE_TYPE` with `skills/foo/run.mjs`, or naming `types/` as a stale declaration

#### Scenario: Happy path — a bundle with no local code passes an empty inventory

- **GIVEN** a synthetic file set of Markdown, JSON and PNG files, no hooks, no workflows and skills granting only Read, Grep, Glob and LS, with every count zero and no declared place or grant path
- **WHEN** the detector runs over it
- **THEN** it reports nothing

#### Scenario: Edge case — a `#!` text counts in its declared place, and a plain-text license is allowed

- **GIVEN** `cli/interlock` starting with `#!` under the declared place `cli/`, and a UTF-8 `LICENSE` with no `#!` that no place declares
- **WHEN** the detector runs
- **THEN** it reports nothing for them, and a new module under `lib/` reports nothing either, because `lib/` is a declared place

#### Scenario: Failure — a hook of another type, a package-manager configuration file and a grant path that escapes are named

- **GIVEN** a manifest hook of type `http`, a shipped `pnpm-workspace.yaml`, and a skill granting `Read(//etc/**)`
- **WHEN** the detector runs
- **THEN** it names `LOCAL_CODE_HOOK_COMMAND`, `LOCAL_CODE_FILE_TYPE` with `pnpm-workspace.yaml`, and `LOCAL_CODE_TOOL_GRANT` with the skill's path
