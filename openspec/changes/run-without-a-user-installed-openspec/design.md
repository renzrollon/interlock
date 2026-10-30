# Design

## Context

See `proposal.md` for why. The explore brief is `.claude/handoff/explore-run-without-a-user-installed-openspec-20261030-095446.md`; F1–F5 below refer to its findings.

- **The hold.** The directory's scan of 1.6.0 raised one Policy hold, `BUNDLES_BINARIES`. It covers "files in bin/, compiled executables elsewhere in the plugin, or files listed under binaries in plugin.json". Its remedy: "Where you can, ship readable scripts outside bin/ rather than compiled programs or install-time downloads." The platform table (`claude.com/docs/plugins/platform-support`) lists "Executables in a top-level `bin/` directory" as "Can't be installed" on claude.ai and Cowork.
- **What the checklist allows** (`claude.com/docs/plugins/pre-submission-checklist`):
  - Commit readable source rather than compiled code: "Code that the security scan can't read is held for a reviewer".
  - "A script that `SKILL.md` only tells Claude to run isn't part of" the follow-the-script check.
  - A lockfile beside `package.json` at the plugin root is held, because Claude Code installs it at plugin install.
- **The hooks already pass.** At 1.6.0, five `hooks/*.mjs` files shipped mode 755 with a `#!/usr/bin/env node` line (`preflight`, `_shared` and three `guard-*`), and its scan held none of them. A readable script outside `bin/` is what the rule asks for.
- **Who calls OpenSpec.** No Interlock code starts `openspec` except the doctor's version probe (`lib/doctor.mjs:794`). The calls are skill prose run through Bash (brief F1).
  - The hard-required ones are spec's `--version`, `new change`, `status --json`, `instructions --json` and `validate "<name>"`.
  - Bootstrap's are `--version`, `init --tools claude` and `validate --specs`.
  - `archive` is printed for the user, never run. The ship path is CLI-free.
- **What upstream ships.** OpenSpec 1.15.0 on npm is 57 packages, all from `registry.npmjs.org`, each with a sha512 `integrity`. The lockfile is 30,863 bytes and the install 16 MB (measured 2026-10-30, `$TMPDIR/os115`).
  - Its `engines.node` is `>=20.19.0`.
  - Its `bin/openspec.js` is a node shebang script.
  - Its `scripts` has no `preinstall`, `install` or `postinstall`.
  - The release also publishes compiled standalone builds of 69–94 MB (brief F4). This design does not use them.
- **What Claude Code guarantees** (`code.claude.com/docs/en/plugins/manifest-reference`, `…/hooks`):
  - `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are exported to hook processes, not to the Bash tool.
  - In skill content they are substituted inline "anywhere in the Markdown body". `skills/spec/SKILL.md:85` already relies on that.
  - A SessionStart hook's `CLAUDE_ENV_FILE` is run as shell code before each later Bash command, and the docs' own example is `export PATH="$PATH:./node_modules/.bin"`.
  - Once that file holds a line other than a plain assignment, PowerShell commands receive none of its variables.
- **Probed 2026-10-30, Claude Code 2.1.314, headless.** A scratch plugin's exec-form SessionStart hook appended `export PATH="$PATH":'<plugin>/cli'`. Bare `pathprobe` then ran from the main session's Bash and from a Workflow `agent()`'s Bash, and in both the appended entry was the last of 16 PATH entries, after every plugin `bin/`.
- **Size budget.** `bin/interlock` is 238,297 bytes against the directory's 262,144-byte hold. New logic goes in `lib/`.

## Goals / Non-Goals

**Goals:**
- The plugin ships no top-level `bin/`, no compiled file and no `binaries` key, and every bare `interlock …` line keeps working.
- spec and bootstrap work on a machine with Node ≥ 20.19 and npm, no OpenSpec installed, and no global install.
- The OpenSpec version is one generated file, bumped by one script and measured by one contract check.
- A user's own `openspec` or `interlock` is never shadowed, wrapped or reconfigured.

**Non-Goals:**
- The provisioned route on Node below 20.19.0, or with no npm. Both are refused and named, and the user installs OpenSpec their own way (D13). Node 18 reached end of life on 2025-04-30 and Node 20 on 2026-04-30.
- A machine with no Node at all. With no Node the CLI cannot run, so the spec flow is dead whatever OpenSpec does. The host already prints `SessionStart hook error: /bin/sh: node: command not found` (D12).
- Auto-running `npx`, `curl … | sh` or any package launcher (D13).
- Changing any skill's `openspec …` or `interlock …` command line, or the spec meter's keyed lines (D11, D19).
- `site/` install snippets. They are regenerated from the design prompt at the next pin, not edited here.

## Decisions

### The CLI leaves `bin/` for `cli/` (D25, D26, D30, D31)

`git mv bin cli`. The four files keep their names, their `#!/usr/bin/env node` line, their mode 755 and their contents. The only edits are comments naming the old path, plus the `openspec` dispatch below. `package.json` follows:

```json
"bin": {
  "interlock": "cli/interlock",
  "interlock-graph": "cli/interlock-graph",
  "interlock-run": "cli/interlock-run",
  "interlock-ship-acp": "cli/interlock-ship-acp"
},
"files": ["cli", "lib", …]
```

npm links a `bin` entry from wherever it lives, so `npm install -g @renzrollon/interlock` is unchanged, and npm's own `<prefix>/bin/interlock` link keeps its name (the `cli/arguments` scenario still holds).

The code that finds the CLI by its own location follows it:
- `INTERLOCK_BIN` (`lib/host.mjs:38`) and `BIN_INTERLOCK` (`lib/run.mjs:345`) become `…/cli/interlock`. `laneEnv` already puts `dirname(INTERLOCK_BIN)` first on a runner lane's PATH, so lanes need nothing else.
- `hooks/preflight.mjs` runs `process.execPath` on `<plugin>/cli/interlock`, rather than executing the file, so it does not depend on the mode bit.
- The doctor's `plugin` row requires `cli/interlock` and `cli/interlock-graph`.
- The `binaries` row's text reads "run from the plugin's cli/, which the session preflight appends to PATH".
- The `cli-version` row compares against `cli/interlock`.

`isReviewSource` (`lib/artifacts.mjs:51-63`) counts an extensionless file directly under a `bin/` or `cli/` directory (D30). Without that, a review of a diff to `cli/interlock` would need no citation of the 238 kB file that holds the rules.

`scripts/cut-release-fixture.mjs` cuts fixtures from old release tags, which have `bin/`. It reads the CLI's path from the tag's own `package.json` `bin` map rather than a fixed directory (D31).

*Rejected:*
- **`.mjs` names.** A PATH lookup needs the bare name `interlock`.
- **A nested `…/bin/`.** The hold's own text says "files in bin/".
- **Launchers the SessionStart hook writes into the data directory each session.** Code written at run time is harder to inspect than files that ship, which is the scanner's whole concern.

### The preflight hands the session its PATH (D5, D8, D20, D27, D29)

`lib/session-env.mjs` holds what `hooks/notify-option.mjs` does today: `shellQuote`, the check that refuses a value with a line break or a NUL, and the "already provided" check. Its exports:
- `appendExport(file, name, value, env)`, which notify-option now calls, with byte-identical behaviour;
- `appendPath(file, entries, platform)`, which appends one line:

```sh
export PATH="$PATH":'<plugin>/cli':'<data>/openspec/<version>'
```

The rules for that line:
- Each entry is single-quoted with `shellQuote`.
- An entry holding a line break or a NUL is dropped.
- On win32 each entry is written in the `/c/…` form Git Bash reads, because a `C:` drive letter would split at the PATH delimiter. This is unprobed.
- The line is not appended when the file already holds it.
- **Appended, never prepended (D5):** a user's own `interlock` or `openspec` still runs first, as with today's plugin `bin/`.

`hooks/preflight.mjs` runs the handoff before the doctor, each step in its own `try`. A failure is one stderr line, and the hook still exits 0:
1. `appendPath(CLAUDE_ENV_FILE, [<plugin>/cli, <data>/openspec/<pin.version>], process.platform)`. The second entry is left out when no data directory is known. It is written before anything is provisioned, so a binary provisioned mid-session is found by the next Bash command.
2. `appendExport(CLAUDE_ENV_FILE, 'INTERLOCK_PLUGIN_DATA', CLAUDE_PLUGIN_DATA, process.env)` (D8). `<data>` above is `INTERLOCK_PLUGIN_DATA` when the operator set it, else `CLAUDE_PLUGIN_DATA`.

Neither line is printed: stdout is context. A path is not a capability, so unlike the ntfy topic nothing forbids saying it.

**PowerShell (D29).** Once the env file holds a `$PATH` line, Claude Code gives PowerShell commands none of its variables, `INTERLOCK_NTFY_TOPIC` included (hooks reference, "Persisted variables in PowerShell commands"). Interlock's skills run Bash, and the plugin's `bin/` already reached PowerShell only outside its sandbox. The README says so.

### A session without the handoff (D28)

A plugin enabled after its session started has had no SessionStart hook, so its PATH has no `cli/`. Bare `interlock` then answers `command not found`. Today the host's own `bin/` injection may cover that case; after this change nothing does.
- **spec, bootstrap and dispatch** say so in one line. Until the next session they run the CLI as `node "${CLAUDE_PLUGIN_ROOT}/cli/interlock"` (and `…/cli/interlock-graph`), which Claude Code substitutes when it loads the skill. Those calls match no `Bash(interlock *)` allow rule, so each asks for approval, and the skill says that too.
- **ship** does not fall back: its Workflow agents run the bare name, so a full path in the lead would not reach them. When the run reports `command not found` for `interlock`, the skill says why and asks for a new session, and does not launch again.

Whether `/clear` re-runs a newly enabled plugin's SessionStart hook is unprobed. It is a follow-up in tasks.md, and the skills name "a new session" until the probe says more.

### OpenSpec comes from its npm build, not the compiled one (D3, D10, D13)

The standalone build needs no Node and would serve Node 18–20.18 and machines with no npm. But it is a compiled program fetched at run time: what the hold names and what the security scan cannot read. The owner asked on 2026-10-30 to remove binaries and `bin/`, which D3 reads as covering the compiled download. The npm build is readable JavaScript, and npm verifies it package by package against a lockfile Interlock commits.

The cost is the Node floor (20.19.0) and the need for npm, both refused and named (D13). A machine that cannot meet them gets OpenSpec's own install routes, named, never run: `npm install -g …` once Node is new enough, or the standalone build from OpenSpec's releases page.

*Rejected:*
- **The compiled standalone build:** the hold.
- **Vendoring the npm tree:** 16 MB and 57 packages inside the plugin, against the 512-file limit.
- **A pinned `npx @fission-ai/openspec@1.15.0`:** a launcher the checklist always holds for review, and one that resolves transitive ranges at run time.
- **Reimplementing validate and archive:** about 6k lines of edge rules (D10).

### The pin is a lockfile, generated (D4, D7, D18)

`lib/openspec-pin.mjs` exports one frozen `OPENSPEC_PIN`:

```js
// Generated by scripts/pin-openspec.mjs from `npm install --package-lock-only`.
// Regenerate it; never edit it by hand.
export const OPENSPEC_PIN = Object.freeze({
  package: '@fission-ai/openspec',
  version: '1.15.0',
  node: '20.19.0',            // from the package's engines.node, `>=20.19.0`
  lockfile: Object.freeze({ lockfileVersion: 3, packages: { /* 57 entries + root */ } })
})
```

It is a module rather than JSON, so Node 18 imports it with no import attributes, and the doctor and the preflight can import it too. It is about 32 KB.

**Trust anchor (D7).** Provisioning writes this lockfile and runs `npm ci`. npm installs exactly the lockfile and refuses any tarball whose sha512 differs, whatever registry served it. Nothing is resolved at provision time. Trusting the installed tree is the same as trusting the plugin release that carries the pin.

**The pin script (D18).** `scripts/pin-openspec.mjs <version>` is dev-only and not shipped. It runs `npm install --package-lock-only --ignore-scripts` of the exact version in the realpath of a `mkdtemp` directory, because a symlinked `/tmp` prefix writes `../../../private/tmp/…` keys. It then fails, naming the entry, on:
- any package key outside `node_modules/`;
- an entry with no `sha512-` integrity;
- a `resolved` outside `https://registry.npmjs.org/`;
- an `@fission-ai/openspec` entry whose `engines.node` is not a single `>=x.y.z`;
- any entry with `hasInstallScript`.

Only then does it rewrite the pin. Its pure core is two exports: `checkPin(pin, floor)`, which fails naming the entry or both versions on the rules above and on a version below the floor, and `buildPin(lockfile, version)`, which builds the record and runs `checkPin` over it. `checkPin` lives in the script, not the pin module, so the generated file stays data and regenerating it rewrites no code; the unit suite imports it from there. Nothing in `npm test` touches the network.

### One resolution order, shared by the doctor and the CLI (D15, D16, D24)

`lib/openspec-cli.mjs` exports `resolveOpenSpec({ env, platform })`. It returns `{ source: 'path' | 'provisioned' | 'none', bin, dataDir, dataDirSource }`:

1. **`path`**: the first `openspec` on `env.PATH` (via `whichSync`, moved to `lib/which.mjs`) whose first 512 bytes do not carry the marker `interlock:openspec-launcher`. The marker, not a path comparison, identifies the launcher, because the doctor can run with a different data directory than the session's (D16).
2. **`provisioned`**: `<dataDir>/openspec/<pin.version>/openspec` exists and carries the marker.
3. **`none`**.

There is no override variable (D15).

**The data directory** comes from `env.INTERLOCK_PLUGIN_DATA`, then `env.CLAUDE_PLUGIN_DATA`, then `${env.XDG_CACHE_HOME || env.HOME + '/.cache'}/interlock`, and `dataDirSource` says which. The resolver reads only the environment it is given, never `process.env` or `os.homedir()` (D24). That keeps doctor tests from seeing the developer's own install, the discipline `baseOpts` keeps for PATH (`test/spine/doctor.test.mjs:258-262`).

### Provisioning: refuse early, install, launch, smoke, rename (D14, D23)

`provision({ env, spawn, platform, nodeVersion })`, behind `interlock openspec provision [--json]`, runs these steps:

1. **Node floor.** If `nodeVersion` is below `OPENSPEC_PIN.node`, fail naming both versions and OpenSpec's own install routes, with no request made.
2. **npm.** If `whichSync('npm', env)` finds nothing, fail naming npm and the same routes, with no request made.
3. **Already provisioned.** When `resolveOpenSpec` already says `provisioned`, report it and return (D23). A version directory exists only once npm has verified every package and the smoke run has passed, because it is renamed into place last.
4. **The data directory.** `mkdir -p <dataDir>/openspec/`. On `EPERM` or `EACCES`, name the path and the code, and say "one run of `interlock openspec provision` outside the sandbox provisions it". The Bash sandbox denies writes under `~/.claude/plugins`.
5. **Stage.** Into `<dataDir>/openspec/.<version>.partial-<pid>/`, write a `package.json` of `{ "private": true, "dependencies": { "@fission-ai/openspec": "<version>" } }` and a `package-lock.json` of `OPENSPEC_PIN.lockfile`.
6. **Install.** Spawn `npm ci --ignore-scripts --no-audit --no-fund` there, under `PROVISION_TIMEOUT_MS`. It sets no registry: the checklist forbids shipping a registry setting, and the user's npm configuration applies. The integrity check holds whatever registry serves the bytes.
   - On a non-zero exit, remove the partial and name npm's exit code and its last non-empty stderr line.
   - When that line holds `EINTEGRITY`, say that a package's bytes differed from the pin.
   - For a network error code, name the registry and say that one run outside the sandbox, or with the registry reachable, provisions it.
7. **Launch.** Write the launcher `openspec`, mode 0o755, beside `node_modules/`.
8. **Smoke.** Run the launcher with `--version` under a short timeout. On a non-zero exit, or output that lacks the pin's version, remove the partial and quote the output.
9. **Place.** `rename` the partial onto `<version>/`. This is atomic within one directory. If the target already holds a launcher, another run won the race: remove the partial and report provisioned.
10. **Prune.** Remove the sibling directories of `<dataDir>/openspec/` whose names parse as `x.y.z` and differ from the pin. Other names, including other processes' partials, are left alone.

`PROVISION_TIMEOUT_MS` is a named constant in `lib/openspec-cli.mjs`, not prose.

`interlock openspec which [--json]` prints the resolution, the pin version, the data directory and its source. Outside Claude Code, where the session PATH is absent, it is how a user finds the launcher to run a printed `openspec archive <change>`.

**The verb is `provision` (D14).** Upstream already has `openspec install`, with a different meaning.

### The launcher (D2, D6, D9)

Provisioning writes it. The plugin ships no file named `openspec`, and the npm `bin` map declares none (D6). It is a CommonJS Node script, because the staged `package.json` sets no `type`:

```js
#!/usr/bin/env node
// interlock:openspec-launcher. Written by `interlock openspec provision`:
// runs the pinned OpenSpec beside this file with its telemetry off.
```

It spawns `process.execPath` on `./node_modules/@fission-ai/openspec/bin/openspec.js`, resolved from its own location so the rename does not break it. It passes arguments and stdio through, and the environment plus `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1` (D2; upstream reads both, brief F3). It exits with the child's status, or `128 + signal number`.

A user's own `openspec` is never wrapped, so it keeps the caller's environment. The doctor's version probe of the provisioned copy runs the launcher too.

### The doctor resolves once and passes the result to two rows (D17, D21)

`diagnose` calls `resolveOpenSpec` once, before the checks, and hands the result to `checkNode` and `checkOpenSpec`.

**`checkOpenSpec`:**
- `path` keeps today's logic (version probe, floor, not initialised), with evidence `openspec (your PATH) → <bin>`.
- `provisioned` uses the same floor and init logic, with evidence `openspec (provisioned <version>) → <bin>`.
- `none` keeps today's two severities (D21): warn when `openspec/config.yaml` exists, fail when not. Only the fix changes. It begins with `interlock openspec provision`, names the Node floor and npm it needs, and keeps `OPENSPEC_INSTALL` as "or install your own". The `fail` fix still ends with `openspec init`.

`OPENSPEC_PROVISION = 'interlock openspec provision'` is exported beside `OPENSPEC_INSTALL`, and the skills test imports both rather than restating them.

**`checkNode` (D17).** The OpenSpec-20.19.0 warning applies when the resolved OpenSpec runs on the user's Node:
- the `provisioned` copy, always, since it is the npm build;
- a `path` CLI whose file, read at its realpath, begins with the bytes `#!` (the same first-bytes read the ELF case uses), or that is a `.cmd`, `.bat` or `.ps1` on win32.

A standalone binary on PATH, and no OpenSpec at all, draw no warning; the openspec row carries the fix for the second. The plugin's own Node floor is untouched. The pin at `test/spine/doctor.test.mjs:491-497` stays true, because `baseOpts` stubs `openspec` as a `#!/bin/sh` script.

### The skills learn the provision step and keep their lines (D1, D11, D19, D28)

- **spec and bootstrap §0.** The `command not found` bullet keeps naming the CLI as missing, then says to run `interlock openspec provision` and probe again. It installs the pinned OpenSpec into the plugin's own data directory.
  - If provisioning exits non-zero, quote its first line and stop. A sandbox-refused write means one run of the same command outside the sandbox.
  - `OPENSPEC_INSTALL` stays as the user's own route.
  - "Do not install or upgrade anything yourself" gains that one exception, by name.
  - The "does not run" bullet is unchanged.
- **The command is inline code in prose, not a fenced line (D19).** The spec meter's fenced-line test (`test/spine/spec-meter.test.mjs:751-800`) classifies every fenced `openspec` and `interlock` line, and no meter reads this one.
- **Dispatch** names the command and runs nothing (it routes; D1).
- **The D28 line.** spec, bootstrap and dispatch name `${CLAUDE_PLUGIN_ROOT}/cli/interlock`. Ship says to start a new session.
- **`review-artifacts`** drops "Requires the openspec CLI" from its compatibility line, since its body runs none (brief F1).
- **No skill restates the pin's version, a size or the Node floor's source.** Provisioning prints those.

### The contract check is opt-in and measures only what the skills read (D22)

`scripts/openspec-contract.mjs [--openspec <bin>]` defaults to `resolveOpenSpec(process.env)`. It works in a fresh `mkdtemp` directory with the telemetry-off environment, and runs:

1. `init --tools none`;
2. `new change probe`;
3. `status --change probe --json`, asserting `changeName`, `applyRequires` (an array), `artifacts[].id`/`status` and `artifactPaths.<id>.resolvedOutputPath`;
4. `instructions proposal --change probe --json`, asserting `instruction`, `template` and `resolvedOutputPath`;
5. after writing a minimal proposal, design, tasks and one nested delta `specs/area/cap/spec.md`, `validate probe`, asserting exit 0;
6. `archive probe --yes`, asserting that `openspec/specs/area/cap/spec.md` now holds the delta's requirement.

Each failure names its path (`status.applyRequires`), and the script exits 1 on any. On success it prints one line naming the CLI it ran, its version and the number of checks passed, the line a pin bump pastes into its PR. The field list is the one brief F1 found the skills and `compact-instructions.mjs:7` read.

It is not in CI, which installs nothing (`.claude/CLAUDE.md`). `CONTRIBUTING.md` makes it a step of every pin bump: `node scripts/pin-openspec.mjs X.Y.Z && node cli/interlock openspec provision && node scripts/openspec-contract.mjs`. The unit suite runs it against a stub CLI only.

### Package pins

`test/spine/package.test.mjs` gains one case over the file set `npm pack` would ship (the set its closure and file-limit cases already compute). It fails, naming each offender, on:
- any path whose first segment is `bin`;
- a `bin` map entry outside `cli/`;
- a file that begins with an ELF (`7f 45 4c 46`), Mach-O (`fe ed fa ce`, `fe ed fa cf`, `ce fa ed fe`, `cf fa ed fe`, `ca fe ba be`) or PE (`4d 5a`) signature;
- a `binaries` key in `plugin.json`;
- a `package-lock.json`, `npm-shrinkwrap.json`, `bun.lock` or `bun.lockb` at the bundle root.

### Decision index

These are written up above or in the ledger: D1 (skills provision, pending), D2 (telemetry off, pending), D3 (no compiled program, owner 2026-10-30), D4 (pin 1.15.0, pending), D5–D31, D32 (the residual `npm ci` hold, pending) and D33 (where the pin check lives).

## Risks / Trade-offs

- **A session started before the plugin was enabled has no `interlock` on PATH.** → spec, bootstrap and dispatch name the full-path form and that it asks for approval, and ship asks for a new session (D28). Whether `/clear` repairs it is a follow-up probe.
- **The handoff depends on the SessionStart hook running.** A crashed preflight, or a host without `CLAUDE_ENV_FILE`, leaves bare `interlock` unresolved. → The PATH line is the hook's first step, in its own `try`, before the doctor runs. The doctor's `binaries` row and the D28 line speak the miss.
- **A reviewer may still hold a plugin whose CLI runs `npm ci` at run time.** → It installs nothing at plugin install, sits outside the plugin root, sets no registry, and runs only when a skill or the user asks. The README discloses it. D32 is the owner's call, and the change is scanned on a `temp/plugin-scan` branch before release.
- **Node below 20.19.0 or no npm cannot use the provisioned route.** → Refused before any request, naming the floor or npm and OpenSpec's own routes (D13).
- **Offline, behind a proxy or in the Bash sandbox, `npm ci` fails.** → npm's own error line is quoted, plus the one unsandboxed rerun. Nothing falls back silently.
- **PowerShell commands lose the session variables (D29).** → Stated in the README, and in the CHANGELOG with the ntfy topic named.
- **Windows Git Bash paths.** The `/c/…` conversion is unprobed, as `bin/` on Windows was. → Stated, and left for a probe.
- **48 test files change a path.** → One mechanical task with a bounded rule (a path edit only, never an assertion's meaning) and a grep that must come back empty.
- **Anything that runs `<plugin root>/bin/<name>` by path breaks.** → The CHANGELOG's upgrade note names the move, and `interlock doctor` names the CLI it resolved.
- **A `.partial-<pid>` directory is left behind if the process is killed mid-install.** → The next run stages under its own pid, and the prune step ignores names that are not versions, so a stray partial costs disk space only.

## Rollout

No release flag. The change ships in the next minor version, with a CHANGELOG `[Unreleased]` entry and an upgrade note for path callers.

- A plugin user sees no difference except the doctor's evidence lines.
- A user with no OpenSpec gets one provisioning step at the first spec run instead of a dead end.
- An npm user's `interlock` is linked from `cli/` instead of `bin/`.

Reverting is `git mv cli bin`, the map and the handoff lines. A provisioned tree left in the data directory is inert, and uninstalling the plugin deletes the directory.
