# Tasks

Known test pins this change touches. An assertion that pins a meaning the delta specs change is updated in the task that changes that meaning, never during a remediation stage, and the update names the assertion and the requirement it now pins.

- `test/spine/doctor.test.mjs:532-548`: the two no-CLI fixes. They now begin with `OPENSPEC_PROVISION`, name `20.19.0` and npm, and still include `OPENSPEC_INSTALL`. Updated in 1.2.
- `test/spine/doctor.test.mjs:491-500`: Node 18 warns. It stays true, because `baseOpts` stubs `openspec` as a `#!/bin/sh` script.
- `test/skills.test.mjs:584-616`: the pre-flight tokens (`command not found`, `OPENSPEC_INSTALL`, `does not run`, `20.19.0`, the no-install rule). They stay true, and 1.4 adds the new ones beside them.
- `test/spine/review-proof.test.mjs:366-367`: `isReviewSource` cases. They stay true, and 1.5 adds `cli/interlock`.
- `test/spine/package.test.mjs:85-113` (every `bin` entry is an executable node script; the closure walk) stays true at `cli/`. `:545` walks a `'bin'` directory, which 2.2 renames to `'cli'`.
- `test/hooks.test.mjs:1126`, `test/mod/session-start.test.ts:170` and `test/fixtures/mod/preflight.mjs:67`: fixture fix strings, expected unchanged.

**Path pins (bounded rule).** About 48 test files spawn or read `bin/<name>` for one of the four executables. Each changes the path to `cli/<name>`, and nothing else in its assertion. A fixture that records a historical command line (`test/fixtures/ship/**`, `test/fixtures/mod/*.json`) stays as recorded unless a test executes it as a live path. An incomplete list here is never a blocker: 2.2's grep is the check.

## 1. Failing tests first

- [x] 1.1 Write two failing suites over the `openspec-cli` delta. The pin cases get their own file, so they turn green in 3.1 while `lib/openspec-cli.mjs` is still absent.

  **`test/spine/openspec-pin.test.mjs`**, importing `OPENSPEC_PIN` from `lib/openspec-pin.mjs` and `checkPin` and `buildPin` from `scripts/pin-openspec.mjs`, never `lib/openspec-cli.mjs`:
  - **The pin.** The committed pin passes `checkPin(pin, OPENSPEC_MIN_VERSION)`: version at or above the floor, the `@fission-ai/openspec` entry at that version, every entry `sha512-` and on `registry.npmjs.org`. Include 1.7.0 below a 1.8.0 floor naming both, and a `sha1-` `node_modules/yaml` named.
  - **The pin script.** `buildPin` fails naming `node_modules/chalk` when that entry resolves to a git URL.

  Verify with `node --test test/spine/openspec-pin.test.mjs`: it fails because `lib/openspec-pin.mjs` does not exist.

  **`test/spine/openspec-cli.test.mjs`**. Cover:
  - **`resolveOpenSpec` order.** A PATH `openspec` carrying `interlock:openspec-launcher` is skipped. A provisioned launcher counts only under `<data>/openspec/<pin.version>/`. The data dir comes from `INTERLOCK_PLUGIN_DATA`, then `CLAUDE_PLUGIN_DATA`, then `XDG_CACHE_HOME`/`HOME`, read only from the env passed in.
  - **`provision`, with injected `spawn` and `nodeVersion`:**
    - a clean install placed, with npm run as `ci --ignore-scripts` in a directory holding the pin's lockfile, and the launcher executable;
    - `EINTEGRITY` refused, with nothing left under `<data>/openspec/`;
    - a launcher `--version` failure placing nothing;
    - a launcher `--version` that exits 0 printing `1.14.3` placing nothing, its output quoted;
    - already provisioned, with no npm call;
    - a `1.14.3/` sibling removed;
    - the cache fallback said;
    - Node `v18.20.8` refused naming `20.19.0` and `OPENSPEC_INSTALL`, with no spawn;
    - no npm on PATH refused, with no spawn;
    - `EPERM` on mkdir naming the path and the unsandboxed rerun;
    - `ENOTFOUND registry.npmjs.org` quoted, saying one run outside the sandbox, or with the registry reachable, provisions it.
  - **The launcher**, written by provisioning to a temp dir over a stub `node_modules/@fission-ai/openspec/bin/openspec.js`: arguments and exit status 3 passed through; `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1` present.
  - **The contract script.** `scripts/openspec-contract.mjs`, run against a stub Node CLI in a `mkdtemp` directory. The stub answers the six commands design.md lists, and its `archive` copies the nested delta into `openspec/specs/`. Conforming, the script exits 0 and prints its pass line. With `applyRequires` left out of `status --json`, it exits non-zero naming `status.applyRequires`.
  - **The package.** `package.json` `bin` has no `openspec` key, and its `test` script does not name the contract script.

  Verify with `node --test test/spine/openspec-cli.test.mjs`: it fails because `lib/openspec-cli.mjs` does not exist.
- [x] 1.2 Extend `test/spine/doctor.test.mjs` for the doctor requirements of the `openspec-cli` delta. Use a temp data dir, passed as `INTERLOCK_PLUGIN_DATA` in `env`, holding a stub launcher that carries the marker. Cover:
  - a provisioned pin is `ok`, with evidence naming the source, path and version;
  - a PATH CLI's evidence names the PATH source;
  - a PATH whose only `openspec` is a launcher for another version reports nothing resolved;
  - Node `v22.11.0` with a provisioned launcher gives an `ok` node row;
  - Node `v18.20.8` with a provisioned launcher warns naming `20.19.0`;
  - Node `v18.20.8` with a PATH `openspec` whose file starts `#!` warns naming `20.19.0`, also when PATH holds a symlink to it from a directory whose path holds no `#!`;
  - Node `v18.20.8` with a PATH `openspec` starting `\x7fELF` gives no `20.19.0`;
  - Node `v18.20.8` with nothing resolved gives a node row not naming `20.19.0`.

  Update the assertions at `:532-548` so both no-CLI fixes begin with `OPENSPEC_PROVISION`, name `20.19.0` and npm, and still include `OPENSPEC_INSTALL` (pins "The doctor SHALL name the OpenSpec it resolved and lead its fix with provisioning"). Add: the `plugin` row fails naming `cli/interlock` when that file is absent from a temp plugin root. Verify with `node --test test/spine/doctor.test.mjs`: the new cases fail on the missing `OPENSPEC_PROVISION` export.
- [x] 1.3 Add `hooks/preflight.mjs` process tests to `test/hooks.test.mjs` for the `hooks/session-preflight` delta, beside the notify-option tests at `:680-760`. Run the hook as a process with a stub doctor. Cover:
  - **The PATH line.** With `CLAUDE_PLUGIN_DATA` and `CLAUDE_ENV_FILE`, the file gains `export PATH="$PATH":'<root>/cli':'<data>/openspec/<OPENSPEC_PIN.version>'`, where `<root>` is the plugin the hook file sits in, and stdout mentions neither line.
  - **A sourcing shell.** A `/bin/sh` with `PATH=/usr/bin:/bin` that sources the file prints `<root>/cli/interlock` for `command -v interlock`, and `PATH` still starts `/usr/bin:/bin`.
  - **No data dir** gives only the `cli` entry.
  - **A data dir holding a line break**, and one holding a NUL, each give only the `cli` entry, and the file gains no other line from that value (no `INTERLOCK_PLUGIN_DATA` export either).
  - **A second run** appends no second PATH line.
  - **A doctor exiting non-zero** with garbage still leaves the PATH line and exits 0.
  - **The data-dir export.** `export INTERLOCK_PLUGIN_DATA='<path>'` is appended. An existing `INTERLOCK_PLUGIN_DATA=/srv/d` appends no export, and the PATH entry is under `/srv/d`. Either input missing writes no export.
  - **An env file in a missing directory** still prints the report and exits 0.

  Verify with `node --test test/hooks.test.mjs` that the new cases fail.
- [x] 1.4 Add token pins to `test/skills.test.mjs`, importing `OPENSPEC_PROVISION` and `OPENSPEC_PIN` rather than restating them:
  - **spec and bootstrap.** Each `SKILL.md` holds `OPENSPEC_PROVISION` after its `openspec --version` line and before its first CLI-needing command (pins "The authoring skills SHALL provision when the OpenSpec CLI is missing").
  - **dispatch** holds `OPENSPEC_PROVISION`, and no fenced line in it starts with `interlock openspec provision`.
  - **review-artifacts.** The `compatibility:` line does not match `/requires the openspec cli/i`.
  - **No version.** No `skills/**/*.md` contains `OPENSPEC_PIN.version`.
  - **The full-path form.** spec, bootstrap and dispatch each hold `${CLAUDE_PLUGIN_ROOT}/cli/interlock` and `command not found`. `skills/ship/SKILL.md` holds `command not found` and `new session`, and not `${CLAUDE_PLUGIN_ROOT}/cli/interlock` (pins "A skill SHALL speak a session whose PATH has no plugin CLI").
  - **No old path.** No `skills/**/*.md` contains `bin/interlock`.

  Verify with `node --test test/skills.test.mjs` that the new cases fail.
- [x] 1.5 Add package and review-source pins.
  - **`test/spine/package.test.mjs`** gets one case over the file set `npm pack` would ship (the set its closure and file-limit cases already compute), for "The bundle SHALL ship no top-level `bin/`, no compiled executable and no install-time download". It fails naming:
    - any path whose first segment is `bin`;
    - a `bin` map entry outside `cli/`;
    - a file beginning with an ELF, Mach-O or PE signature (design.md "Package pins");
    - a `binaries` key in `.claude-plugin/plugin.json`;
    - a root `package-lock.json`, `npm-shrinkwrap.json`, `bun.lock` or `bun.lockb`.

    Give its checker a pure core, exercised over a synthetic file list for each failure scenario of that requirement.
  - **`test/spine/review-proof.test.mjs:366`**: add `cli/interlock` to the cases `isReviewSource` counts, and a proof case where a changed, uncited `cli/interlock` is listed in `proof.uncited`.

  Verify with `node --test test/spine/package.test.mjs test/spine/review-proof.test.mjs` that the new cases fail, on `bin/` and on `cli/interlock` respectively.

## 2. Move the CLI out of `bin/` (make 1.5 green)

- [x] 2.1 Run `git mv bin cli`, keeping each file's mode and contents. Then update what locates the CLI by its own location:
  - **`package.json`.** `bin` points under `cli/`, and `files` lists `cli` in place of `bin`.
  - **The absolute paths.** `INTERLOCK_BIN` in `lib/host.mjs` and `BIN_INTERLOCK` in `lib/run.mjs` become `…/cli/interlock`.
  - **`hooks/preflight.mjs`.** It runs `process.execPath` on `<PLUGIN_ROOT>/cli/interlock`, and its line-93 message names `cli/`.
  - **`lib/doctor.mjs`.** The `plugin` row requires `cli/interlock` and `cli/interlock-graph`. The `binaries` row reads "run from the plugin's cli/ …, which the session preflight appends to PATH" and fails "resolve neither on PATH nor in the plugin's cli/". The `cli-version` row compares against `cli/interlock`.
  - **`lib/artifacts.mjs` `isReviewSource`.** It counts an extensionless file directly under `bin/` or `cli/`, and its doc comment says so.
  - **`test/spine/doctor.test.mjs`, the plugin's own CLI.** These pin the rows edited above, so they change here, a path only:
    - `fakePlugin` (`:214`) lays down `cli/interlock` and `cli/interlock-graph`;
    - the two `binaries` tests (`:505-528`) omit `cli/interlock-graph` and match "plugin's cli/";
    - the "plugin's own bin/ on PATH" test (`:2354-2362`) puts `join(pluginRoot, 'cli')` on PATH.

    npm's link directory in `npmCopy` (`join(prefix, 'bin', 'interlock')`, `:2151`) stays.

  Verify that 1.5 passes, that `node cli/interlock --version` prints the package version, and that the rest of `node --test test/spine/package.test.mjs test/spine/doctor.test.mjs` passes, apart from 1.2's still-red cases.
- [x] 2.2 Sweep every remaining `bin/<name>` spelling for the four executables to `cli/<name>`, under the bounded rule above (depends on 2.1). That covers test files, `evals/`, `.github/workflows/*.yml` (`./bin/interlock` → `./cli/interlock`), `scripts/`, the comments in `lib/`, `cli/` and `workflows/ship.js`, and `skills/ship/SKILL.md:67`. Three static tests named by the MODIFIED deltas must scan `cli/`:
  - the advisor-tool static test (pins `advisor-tool`);
  - the retired-name residue test (pins `review/merge-request-delivery`);
  - the no-policy sweep of `cli/interlock-run` (pins `run-host-adapters`).

  Two scripts locate the CLI by a pattern rather than a path, and are not a blind replace:
  - **`scripts/cut-release-fixture.mjs`** reads the CLI's path from the tag's own `package.json` `bin` map, so tags cut before the move still work. It archives that path's directory (`:168`), checks that file exists (`:177`), and invokes `join(scratch, 'cli', <map path>)` (`:401`). The scratch directory keeps its name `cli`.
  - **`test/spine/root-isolation.test.mjs:92`** discovers binary-spawning tests by a `'bin', 'interlock'` join regex. It also matches the `'cli'` spelling, so tests swept to `cli/` are still found.

  Leave npm's link directory (`<prefix>/bin/interlock`, `$RUNNER_TEMP/prefix/bin/interlock`, `join(prefix, 'bin', 'interlock')`), the .NET `bin/` rule in `lib/graph/extract/walk.mjs`, `CHANGELOG.md`'s released sections, the dated records under `docs/notes/` and `briefs/`, `openspec/changes/archive/` and `site/`. Verify with both spellings, the slash form (`./bin/…` included) and the join form:

  ```sh
  git grep -nE "(^|[^A-Za-z_])bin/(interlock|openspec)|['\"]bin['\"], *['\"](interlock|openspec)" -- . \
    ':!openspec/changes/archive' ':!openspec/changes/run-without-a-user-installed-openspec' \
    ':!CHANGELOG.md' ':!site' ':!test/fixtures' ':!docs/notes' ':!briefs'
  ```

  It prints only npm's link directory (`<prefix>/bin/…`, `prefix/bin/…`, `join(prefix, 'bin', …)`; a package's own realpath under `node_modules/@renzrollon/interlock/` moves to `cli/` with it) and the living-spec lines this change's MODIFIED deltas replace at archive. Then `npm test` passes, apart from the §1 cases not yet made green.

## 3. Pin OpenSpec and hand the session its PATH (make the pin cases and 1.3 green)

- [x] 3.1 Create `lib/openspec-pin.mjs` exporting the frozen `OPENSPEC_PIN`, under a header saying it is generated: `package`, `version` 1.15.0, `node` 20.19.0, and the lockfile of `@fission-ai/openspec@1.15.0`.
  - Create `scripts/pin-openspec.mjs <version>` with two exported pure functions: `checkPin(pin, floor)`, the shape and floor check design.md "The pin is a lockfile" lists, and `buildPin(lockfile, version)`, which builds the record and runs `checkPin` over it. The pin file stays data only, so regenerating it rewrites no code.
  - Its main runs `npm install --package-lock-only --ignore-scripts` of the exact version in the realpath of a `mkdtemp` directory. It fails naming any entry that breaks a rule in design.md "The pin is a lockfile", and only then rewrites the pin file.
  - Generate the committed pin with it, outside the sandbox if the registry is refused.

  Verify that `node --test test/spine/openspec-pin.test.mjs` passes, that the pin file is under 64 KiB, and that `git diff --stat` shows no other file rewritten.
- [x] 3.2 Create `lib/session-env.mjs` with:
  - `appendExport(file, name, value, env)`, holding `shellQuote` and the publishable and already-provided checks moved out of `hooks/notify-option.mjs`;
  - `appendPath(file, entries, platform)`, per design.md "The preflight hands the session its PATH": single-quoted entries appended after `"$PATH"`, an entry with a line break or NUL dropped, no second copy of a line the file already holds, and on win32 each entry in Git Bash's `/c/…` form.

  Rewrite `hooks/notify-option.mjs` to call `appendExport`, with its observable behaviour unchanged. In `hooks/preflight.mjs` (depends on 2.1 and 3.1, for the `cli/` path and `OPENSPEC_PIN.version`), before the doctor runs and each in its own `try`:
  1. call `appendPath(process.env.CLAUDE_ENV_FILE, [<PLUGIN_ROOT>/cli, <data>/openspec/<OPENSPEC_PIN.version>], process.platform)`, where `<data>` is `INTERLOCK_PLUGIN_DATA`, else `CLAUDE_PLUGIN_DATA`, and the second entry is left out when neither is set;
  2. then call `appendExport(…, 'INTERLOCK_PLUGIN_DATA', process.env.CLAUDE_PLUGIN_DATA, process.env)`.

  A failure is one stderr line, and the hook still exits 0. Verify that 1.3 and the existing notify-option tests at `test/hooks.test.mjs:680-760` pass.

## 4. Provision the pinned OpenSpec (make the rest of 1.1, 1.2 and 1.4 green)

- [x] 4.1 Create `lib/which.mjs` by moving `whichSync` and `isExecutable` out of `lib/doctor.mjs` unchanged, and re-export `whichSync` from `lib/doctor.mjs`, so every existing importer still resolves. Create `lib/openspec-cli.mjs` per design.md (depends on 3.1). It exports:
  - `OPENSPEC_PROVISION` and `OPENSPEC_INSTALL` (moved here and re-exported from `lib/doctor.mjs`);
  - `PROVISION_TIMEOUT_MS`, `LAUNCHER_MARKER`, `resolveOpenSpec`, `telemetryOff`, `launcherSource` and `provision`;
  - `openspecCommand(io, positional, flags, json)` for `provision` and `which`.

  It imports only `node:` modules, `./which.mjs`, `./openspec-pin.mjs` and `compareVersions` from `./host/claude-env.mjs`, never `./doctor.mjs`, to avoid an import cycle. Verify that `node --test test/spine/openspec-cli.test.mjs` passes except its contract-script cases, and that the pre-existing cases of `node --test test/spine/doctor.test.mjs` still pass.
- [x] 4.2 Add `case 'openspec':` to `cli/interlock`, dispatching to `openspecCommand`, plus `USAGE` lines for `interlock openspec provision [--json]` and `interlock openspec which [--json]` (depends on 2.1 and 4.1). Leave the `package.json` `bin` map with no `openspec` entry. Verify that:
  - `node cli/interlock openspec which --json` prints `source`, `bin`, `dataDir`, `dataDirSource` and `pin`;
  - `wc -c cli/interlock` stays under 262144;
  - `node --test test/spine/cli-inventory.test.mjs test/spine/package.test.mjs` passes.
- [x] 4.3 In `lib/doctor.mjs` (depends on 4.1), resolve once in `diagnose` with `resolveOpenSpec(env)` and pass the result to `checkNode` and `checkOpenSpec`.
  - `checkOpenSpec` names the `path` or `provisioned` source in its evidence, and probes a provisioned launcher with `telemetryOff(env)`. For `none` it keeps today's verdict severities, with fixes beginning `OPENSPEC_PROVISION` and naming `OPENSPEC_PIN.node` and npm.
  - `checkNode` warns about 20.19.0 for a `provisioned` resolution, and for a `path` one whose file, read at its realpath, begins with the bytes `#!`, or that is a `.cmd`/`.bat`/`.ps1` on win32.

  Verify that 1.2 passes and the rest of `test/spine/doctor.test.mjs` is unchanged.
- [x] 4.4 Edit the skills.
  - **spec §0 and bootstrap §0.** In the `command not found` bullet, run `interlock openspec provision` as inline code, never as a fenced line, then probe again. On failure, quote its first line and stop. A sandbox-refused write means one unsandboxed run of the same command. Keep `OPENSPEC_INSTALL` as the user's own route, and name that command as the one exception to "do not install or upgrade anything yourself".
  - **The full-path line.** spec, bootstrap and dispatch say that a bare `interlock` (or `interlock-graph`) reporting `command not found` means the session predates the plugin. Until a new session, run `node "${CLAUDE_PLUGIN_ROOT}/cli/interlock"` (or `…/cli/interlock-graph`), and those calls ask for approval.
  - **`skills/ship/SKILL.md`.** A run that reports `command not found` for `interlock` means the same. Ask for a new session, and do not launch again.
  - **`skills/dispatch/SKILL.md:69`.** Name the provision command, and run nothing.
  - **`skills/review-artifacts/SKILL.md`.** Drop "Requires the openspec CLI" from the compatibility line.
  - **No numbers.** Restate no version, no size and no Node floor anywhere new.

  Verify that 1.4 passes, and that `node --test test/spine/spec-meter.test.mjs` still passes, since no fenced line was added.
- [x] 4.5 Create `scripts/openspec-contract.mjs [--openspec <bin>]` per design.md (depends on 4.1 for `resolveOpenSpec` and `telemetryOff`). In a `mkdtemp` project it runs:
  1. `init --tools none`;
  2. `new change probe`;
  3. `status --change probe --json`;
  4. `instructions proposal --change probe --json`;
  5. a named `validate`, after writing minimal artifacts and one nested delta `specs/area/cap/spec.md`;
  6. `archive probe --yes`.

  It asserts the fields design.md lists, names each failure by its path (e.g. `status.applyRequires`), and exits 1 on any. On success it prints one line naming the CLI it ran, its version and the number of checks passed. Verify that 1.1's two stub-CLI contract cases pass.

## 5. Document the move and provisioning

- [x] 5.1 Document both halves.
  - **`README.md`.** In the Install table, name Node.js 20.19+ with npm as what provisioning needs, and Node 18+ as what the plugin itself needs. Say that the plugin ships readable scripts only, that the SessionStart hook puts its `cli/` on the session PATH, and that OpenSpec is used from PATH when present, otherwise provisioned on the first `/interlock:spec`. Disclose:
    - the registry install (about 16 MB) and that npm verifies every package against the pinned lockfile;
    - that install scripts are off and telemetry is off for the provisioned copy;
    - the data dir, and `interlock openspec which` for running a printed `openspec archive` outside Claude Code;
    - that PowerShell commands get none of the session variables.
  - **`docs/01-first-hour.md`.** Say the same in its install section, with the npm route as the alternative.
  - **`docs/07-cli-and-configuration.md`.** Add `interlock openspec provision|which`, `INTERLOCK_PLUGIN_DATA` and the PATH handoff.
  - **`CONTRIBUTING.md`.** Add the pin-bump steps: `node scripts/pin-openspec.mjs X.Y.Z && node cli/interlock openspec provision && node scripts/openspec-contract.mjs`.
  - **`.claude/CLAUDE.md` Architecture.** Rename the `bin/` bullet to `cli/` and say why it is not `bin/`.
  - **`CHANGELOG.md`.** Add an `[Unreleased]` entry with an upgrade note: anything that runs `<plugin root>/bin/<name>` by path must run `<plugin root>/cli/<name>`.
  - **Other docs.** Update every other `docs/*.md` line naming the plugin's `bin/<name>` or its `bin/` on PATH (`docs/16-upgrading.md:36` among them). The dated notes under `docs/notes/` stay as written.

  Verify that `grep -l "interlock openspec provision" README.md docs/01-first-hour.md docs/07-cli-and-configuration.md` lists all three, that `git grep -n "bin/interlock" -- README.md docs CONTRIBUTING.md .claude/CLAUDE.md ':!docs/notes'` prints nothing but npm's `<prefix>/bin/interlock` link, and that `npm run validate` passes.

## Workflow follow-up

- **Before merging, outside the sandbox,** with `INTERLOCK_PLUGIN_DATA` pointing at a scratch dir and no `openspec` on PATH, run each and paste the output into the PR:
  - `node cli/interlock openspec provision`;
  - `<data>/openspec/1.15.0/openspec --version`, which prints the pin's version;
  - `node scripts/openspec-contract.mjs`, which exits 0;
  - `node cli/interlock doctor --json`, which names the provisioned source.
- **Probe with `scripts/host-probe.mjs`** whether a plugin enabled after its session started gets its SessionStart hook on `/clear`, and so the PATH line (D28). If it does, reword the skills' "new session" to name `/clear`, and record the probe in `decisions.md`.
- **Scan before release.** Pack the `files` set onto a `temp/plugin-scan` orphan branch and run the portal's Validate. Expect no `BUNDLES_BINARIES`, record the report, and settle D32 with the owner.
- **Archive** the change after merge.
