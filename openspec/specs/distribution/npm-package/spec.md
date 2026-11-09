# distribution/npm-package Specification

## Purpose
What a published Interlock package must hold so it installs and runs anywhere it is installed: a files whitelist closed over every declared binary and the hooks module, one version carried identically by the three manifests, a release published from a version tag with provenance and no stored token, the manifest's type contract and listing image shipped in the tarball, and a bundle that stays inside the plugin directory's file limits. Each rule is held by a test that names the file and the reason when it fails.

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

### Requirement: No shipped file SHALL name a credential variable, a credential file or the host's option variables, and the changelog SHALL NOT ship

No file in the published bundle SHALL spell a credential variable or file name from the package test's list, the host's option-variable prefix `CLAUDE_PLUGIN_OPTION_`, or the retired push variables `INTERLOCK_NTFY_`. No file is excepted, and `CHANGELOG.md` SHALL NOT be listed in `files` or ship. No shipped file SHALL carry the removed push's residue.

#### Scenario: Failure — a shipped file names a credential variable

- **GIVEN** a shipped file spells `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `.credentials.json`, `CLAUDE_PLUGIN_OPTION_` or `INTERLOCK_NTFY_`, the changelog included were it shipped
- **WHEN** `npm test` runs
- **THEN** the package test fails naming the file and the name

#### Scenario: Failure — the changelog is shipped again

- **GIVEN** a `files` whitelist that lists `CHANGELOG.md`
- **WHEN** `npm test` runs
- **THEN** the package test fails naming `CHANGELOG.md`

#### Scenario: Failure — the removed push leaves residue

- **GIVEN** a shipped file that still mentions `ntfy` in any case, `notify-option`, `notifyTimeoutMs`, `postNtfy` or `push timeout`
- **WHEN** `npm test` runs
- **THEN** the package test fails naming the file and the word

### Requirement: No shipped code SHALL open a network connection

No shipped JavaScript file SHALL call `fetch`, import a Node network module or `undici`, or construct a `WebSocket`, an `EventSource` or an `XMLHttpRequest`. Requests made by the tools a run spawns are their own, and the README SHALL name those tools. The check SHALL be a named function with a self-test over synthetic files.

#### Scenario: Happy path — the bundle as shipped opens no connection

- **GIVEN** the working tree's `files` whitelist
- **WHEN** the package test runs
- **THEN** it passes

#### Scenario: Failure — a module reaches for the network

- **GIVEN** a synthetic shipped file that calls `fetch(`, imports `node:https`, `node:net` or `undici` by `import`, `import()` or `require`, or constructs a `WebSocket`
- **WHEN** the check reads it
- **THEN** it returns one problem naming the file and the construct
- **AND** a file that only spells the word in a string that is not a call, such as `'fetch'` in an argv list, is not reported

### Requirement: Every hook command SHALL be a plain path from the plugin root, and a sensitive option SHALL reach only a server's env or headers

Every hook the manifest registers SHALL be `node "${CLAUDE_PLUGIN_ROOT}/hooks/<file>.mjs"` with no arguments. A `sensitive` `userConfig` option SHALL appear as `${user_config.<key>}` only in an `mcpServers` or `lspServers` entry's `env` or `headers`, no shipped file but the manifest SHALL spell `${user_config.`, and no declared option SHALL go unused. Each check SHALL be a named function with a self-test.

#### Scenario: Happy path — the shipped manifest passes

- **GIVEN** the manifest as shipped, which declares no option
- **WHEN** the package test runs
- **THEN** both the hook-command check and the option check pass

#### Scenario: Failure — a sensitive option is handed to a hook

- **GIVEN** a synthetic manifest whose sensitive `token` option appears as `${user_config.token}` in a hook's `args`, or is declared and never referenced
- **WHEN** the option check reads it
- **THEN** it returns a problem naming the option and where it appeared, or that nothing consumes it
- **AND** the same option referenced only in an MCP server's `env` returns none

#### Scenario: Failure — a hook command names a variable the directory cannot follow

- **GIVEN** a manifest whose hook carries `${user_config.token}` in its arguments, a `$(…)`, a `*`, or a `${CLAUDE_PROJECT_DIR}`
- **WHEN** the registration pin reads it
- **THEN** it fails naming the event and the hook

### Requirement: The scan pack SHALL build the bundle onto a local branch and SHALL NOT push

`npm run scan-pack` (`scripts/plugin-scan-pack.mjs`) SHALL commit the unpacked `npm pack` of the working tree onto `temp/plugin-scan`, or the branch `--branch` names, through a temporary index, on top of that branch's tip, else `origin/<branch>`'s, else as a root commit. It SHALL leave the working tree, the real index and the checked-out branch as they were, and SHALL NOT push or open a network connection, and SHALL run `npm pack` offline with npm's update check off.

#### Scenario: Happy path — the bundle lands on a local branch

- **GIVEN** a clean checkout
- **WHEN** `npm run scan-pack` runs
- **THEN** the tree of the `temp/plugin-scan` tip holds exactly the files of the unpacked tarball
- **AND** `git status` and the checked-out branch are what they were before the run
- **AND** the output names `git push origin temp/plugin-scan` and the Validate as next steps, and nothing was pushed

#### Scenario: Edge — an untracked file under a shipped path marks the pack

- **GIVEN** an untracked file under a path that `files` lists
- **WHEN** the scan pack runs again
- **THEN** the new commit's parent is the previous tip
- **AND** its message says `with uncommitted changes`

#### Scenario: Failure — the target branch is checked out

- **GIVEN** `--branch` names the branch that is checked out
- **WHEN** the scan pack runs
- **THEN** it exits 1 naming the branch and writes no ref

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
