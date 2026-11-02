# Proposal

## Why

Two install-path problems, one cause: what the plugin ships for the user's machine to run.

- **The plugin directory holds every version for `bin/`.** The scan of 1.6.0 lists one Policy hold, `BUNDLES_BINARIES`. It reads: "The plugin ships programs that run directly on the user's machine: files in bin/ … Where you can, ship readable scripts outside bin/ rather than compiled programs or install-time downloads." The directory's platform table adds that a plugin with a top-level `bin/` cannot be installed on claude.ai or in Cowork at all. Interlock's four executables are readable Node scripts. They sit in `bin/` only because Claude Code puts a plugin's `bin/` on the Bash tool's PATH.
- **The marketplace install leaves the authoring skills dead.** Installing Interlock copies the plugin and runs nothing else. `/interlock:spec` and `/interlock:bootstrap` then stop at `openspec --version`. The only remedy any surface offers is `npm install -g @fission-ai/openspec@latest`: a global install the user runs by hand, at a version nobody measured.

The first draft of this change fixed the second problem by downloading OpenSpec's compiled standalone build and adding a `bin/openspec` shim. Both are what the hold asks a plugin not to ship. This version ships readable code only, and removes `bin/` entirely.

## What Changes

- **No `bin/`.** The four executables move, unchanged, from `bin/` to `cli/`, a directory Claude Code does not treat specially. `package.json`'s `bin` map points at `cli/`, so an npm global install still links `interlock`, `interlock-graph`, `interlock-run` and `interlock-ship-acp`.
- **The SessionStart preflight puts `cli/` on the session's PATH.** It appends `export PATH="$PATH":'<plugin>/cli'` to `CLAUDE_ENV_FILE`, the pattern the hooks reference itself shows. Every bare `interlock …` in skills, prompts, run steps and allow rules keeps working, and a user's own `interlock` still comes first. A probe on Claude Code 2.1.314 found the line in both the main session's Bash and a Workflow subagent's.
- **A session without that line is spoken.** It happens when the plugin was enabled after the session started. Spec, bootstrap and dispatch then run `node "${CLAUDE_PLUGIN_ROOT}/cli/interlock"`. Ship stops and asks for a new session, because its workers run the bare name.
- **A pinned OpenSpec, as a lockfile.** `lib/openspec-pin.mjs` records one OpenSpec npm release and the lockfile of its 57-package tree, every entry with its sha512 `integrity`. `scripts/pin-openspec.mjs <version>` regenerates it.
- **`interlock openspec provision`.**
  - It installs that lockfile with `npm ci --ignore-scripts` into the plugin's data directory, so npm refuses any package whose bytes differ from the pin.
  - It writes a small launcher that runs OpenSpec with its telemetry off, runs `--version`, and renames the install into place.
  - Every refusal is spoken: a Node below OpenSpec's floor, no npm, a write the sandbox denies, an npm install that fails, and a CLI that does not start.
  - `interlock openspec which` reports which OpenSpec this machine resolves.
- **The preflight also puts the provisioned OpenSpec on PATH,** after the user's own entries. It exports the data directory as `INTERLOCK_PLUGIN_DATA`, because `CLAUDE_PLUGIN_DATA` reaches hooks but not the Bash tool.
- **The doctor resolves, then names the source:** the user's PATH, the provisioned pin, or none. Its fix leads with `interlock openspec provision`.
- **The authoring skills provision on a missing CLI.** When `openspec` is not found, spec and bootstrap run `interlock openspec provision` and probe again. Dispatch names the command. `review-artifacts` stops declaring a CLI it never runs.
- **An opt-in contract check.** `scripts/openspec-contract.mjs` runs every OpenSpec command the skills rely on against a candidate CLI, on a scratch project, so a pin bump is measured.
- **Package pins.** A test fails on any shipped path under a top-level `bin/`, any shipped compiled executable, a `binaries` key in `plugin.json`, or a lockfile at the bundle root.
- **Docs disclose it.** The README and the first-hour guide name Node and npm as the prerequisites. They say what provisioning fetches and how it is verified, and state the telemetry posture.

No skill's `openspec …` or `interlock …` command line changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-cli`: the pin, provisioning, the launcher, the doctor's resolved-source row, the skills' missing-CLI case, and the contract check.
- `hooks/session-preflight`: the PATH and data-directory handoff, and what a session without it does.
- `distribution/npm-package`: no top-level `bin/`, no compiled file, no `binaries` key and no root lockfile; the `bin` map points under `cli/`.
- `review/review-proof`: an extensionless file directly under `cli/` counts as reviewable source, as one under `bin/` does.
- `review/merge-request-delivery`: the residue test scans `cli/**` in place of `bin/**`, and its scenarios run `node cli/interlock`.
- `advisor-tool`: the static test scans `cli/` in place of `bin/`.
- `run-host-adapters`: the no-policy sweep reads `cli/interlock-run`.

## Impact

- Moved: `bin/interlock`, `bin/interlock-graph`, `bin/interlock-run` and `bin/interlock-ship-acp` go to `cli/` by `git mv`. Their contents change only in comments that name the old path, and in the new `openspec` dispatch.
- New: `lib/openspec-pin.mjs`, `lib/openspec-cli.mjs`, `lib/which.mjs`, `lib/session-env.mjs`, `scripts/pin-openspec.mjs`, `scripts/openspec-contract.mjs`, `test/spine/openspec-cli.test.mjs`.
- Changed:
  - `package.json` (`bin`, `files`);
  - `lib/run.mjs` and `lib/host.mjs` (the CLI's absolute path);
  - `lib/doctor.mjs` (the plugin, binaries, cli-version, node and openspec rows);
  - `lib/artifacts.mjs` (`isReviewSource`);
  - `hooks/preflight.mjs` and `hooks/notify-option.mjs`;
  - `scripts/cut-release-fixture.mjs`;
  - the skills `spec`, `bootstrap`, `dispatch`, `ship` and `review-artifacts`;
  - the `.github/workflows/*.yml` steps that run `./bin/interlock`;
  - `README.md`, `docs/`, `CONTRIBUTING.md`, `CHANGELOG.md` and `.claude/CLAUDE.md`.
- Tests: about 48 files spell a `bin/` path; each change is to the path only.
- Network: the first provisioning run fetches about 16 MB of npm tarballs from `registry.npmjs.org`, or from whatever registry the user's npm is configured for. Nothing else in Interlock gains network access.
- Breaking for anything that runs `<plugin root>/bin/<name>` by path, such as a personal wrapper script: it must run `<plugin root>/cli/<name>`. The CHANGELOG names it.
- Dependencies: none. The provisioned OpenSpec is installed by the user's npm into the plugin's data directory, never into this package.
