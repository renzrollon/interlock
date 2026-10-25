## Why

The 2026-10-22 release-readiness review (`docs/notes/2026-10-22-release-readiness-review.md`) found that a green CI run proves the working tree is internally consistent and the tarball is complete. It does not prove that an engineer who updates is unbroken. Every one of the last seven patch releases fixed something only a live session shows. 1.7.0 ships two defects of that class today:

- **The halt card's recovery command does not run.** `interlock tasks tick <change> --ids …` exits 1 with `change "tick" not found`. Reproduced on 2026-10-22 against the working tree.
- **A skill one version ahead of its CLI can silently drop a review blocker.** On a 1.5.1 CLI, `review … --base` exits 0 with `--base` ignored.

Nothing in the repository names a CLI/plugin version skew, resumes the previous release's on-disk state, runs the installed tarball's commands, or re-validates the shipped bundle when the engine moves. The model-backed evals that were meant to cover the rest have skipped every metered step since they were created, and they report green.

## What Changes

**CLI surface and version (review O3, O13)**
- `interlock --version` and `interlock version [--json]` print the CLI's own version. `interlock-graph --version` and `interlock-run --version` do the same, and `interlock-run -h` prints usage instead of reading `-h` as a change name.
- Every `interlock` subcommand declares the flags it reads. **BREAKING:** an unknown flag is refused by name with exit 2. Today it is silently ignored.
- `-h`/`--help` after a subcommand prints that subcommand's usage and runs nothing. Today `doctor --help` runs the doctor.
- `tasks tick <change>` and `tasks coverage <change>` read the change from the positional the halt card prints.
- A corrupt `.claude/autonomy.json` is preserved and named instead of being silently overwritten.

**Skew is named (O3)**
- The session-start preflight and `interlock doctor` resolve the `interlock` that `PATH` serves, read its version and compare it with the plugin's. A CLI older than the plugin, or one too old to report a version, is a failing row: `CLI VERSION SKEW`.
- The run records which CLI and which plugin produced it: the version on the manifest, on the `run-start` event, on the receipt and on every step. `/interlock:ship` forwards the plugin root so `run start` can banner a mismatch. The Workflow driver banners a start step that carries no CLI version.

**State written by the previous release resumes or is refused by name (O2, O13)**
- `run start` removes a `classified.json` left by an earlier run and says so. A rebuilt plan is named on the start step, not only at close. The test profile is validated with the run's own validator by `run start` and by the doctor's `test-profile` row.
- `run next` refuses a manifest that is already halted. A manifest field an earlier release did not write is defaulted out loud instead of silently.
- A run manifest or trajectory line carrying a schema tag this CLI does not read is named, never read as "no manifest" or folded in as `/1`.
- `interlock-graph update` rebuilds when the graph's schema or extractor changed, or when an OpenSpec or memory overlay input changed. Today it reports "up to date" over both.
- A committed snapshot of the previous release's run state (`test/fixtures/ship/release-1.7.0/`), cut by a script, is resumed by the current CLI in a test.

**Release gates (O1, O4–O7)**
- A post-install smoke script runs every subcommand the skills, the ship driver, the run steps and the hooks call, from the installed tarball, asserting exit codes and the JSON keys their callers read. A test pins that every subcommand and flag a shipped surface passes is in the CLI's flag table and in the smoke's inventory.
- CI gains a previous-release over-install, an engine-floor plugin validation, Node 24 and a macOS smoke. A new scheduled canary re-validates the `release` branch bundle under the newest Claude Code.

**Evals stop reporting green for work they did not do (O9, as amended by the owner)**
- **BREAKING (CI):** the full-suite eval and the ship outcome eval lose their cron triggers until a model credential is provisioned. Both stay manually invocable. The PR smoke keeps its quiet skip.
- `evals/ship/run.mjs --grade-root` grades an interactive `/interlock:ship` run with the outcome eval's six graders and appends a comparable history row. This is the per-release local regression run of review §8.

**Upgrade notes (O11)**
- A user-facing Upgrading page in `docs/`. A `### Upgrading` subsection in the CHANGELOG for every breaking entry. A spine test that, from 1.8.0 on, fails a breaking entry under a patch version or without that subsection.

**Left out on purpose:** provisioning the API key (O8) and the live-host CI test that needs it (O12), which are owner actions outside the repository; kettle's reset script (another repository); prepending the plugin's `bin/` to `PATH` through `$CLAUDE_ENV_FILE` (review §5b fix 4, unprobed); the `interlock-graph path`/`explain` no-match exit codes. See `decisions.md` D1, D4 and D26.

## Capabilities

### New Capabilities
- `cli/arguments`: how `interlock`, `interlock-graph` and `interlock-run` parse their arguments. Declared flags per subcommand, the named refusal of an unknown flag, help after a subcommand, version reporting, and the change positional of two-word subcommands.
- `distribution/release-gates`: what CI and the scheduled canary prove about the installed tarball, the shipped bundle, the previous release's over-install, the engine floor and the platform matrix, plus the inventory pin that ties the smoke to the shipped surfaces.
- `distribution/upgrade-compatibility`: run state written by the previous release, and the halted pre-1.0 fixture, are resumed or refused by name under the current CLI, proven against a committed per-release snapshot.
- `distribution/upgrade-notes`: the semver rule for breaking entries, the CHANGELOG `### Upgrading` subsection and the user-facing Upgrading page.
- `graph/staleness`: when `interlock-graph update` must rebuild, and what it says.
- `evals/local-grading`: grading an interactive run in place and appending it to the outcome history as a local row.
- `spec/autonomy-record`: an unreadable autonomy record is preserved and named, never overwritten silently.

### Modified Capabilities
- `hooks/session-preflight`: adds the CLI version-skew row and the test-profile validation parity.
- `ship/run-program`: adds the halted-manifest refusal, the foreign-manifest naming, the stale-classification removal, the start-step plan banner, profile validation at start, and the CLI/plugin version on the manifest and every step.
- `ship-run`: the `run-start` event and the receipt record the CLI and plugin versions, and a trajectory line with a foreign schema is named.
- `ship/halt-resume-card`: every command the card prints runs as printed, proven by a test.
- `evals/outcome-run`: the metered sweep is manually invoked until a credential is provisioned (the cron requirement changes).
- `evals/gate`: the full-suite run is manually invoked until a credential is provisioned and still reads its runs-per-case from the published limits.

## Impact

- **CLI:** `bin/interlock` (argument parsing, help, version, `tasks`, `run`, `doctor`, `autonomy`), `bin/interlock-run`, `lib/graph/cli.mjs`, plus a new `lib/cli-flags.mjs` (the per-subcommand flag table) and a version helper.
- **Run loop:** `lib/run.mjs` (manifest read, `run next`, `run start`, steps, receipt), `lib/run-log.mjs`, `lib/verify.mjs` (an exported validator), `lib/doctor.mjs`, `hooks/preflight.mjs`, `lib/preflight-file.mjs`, `lib/autonomy.mjs`, `lib/graph/graph/build.mjs`, `lib/graph/graph/update.mjs`.
- **Driver and skills:** `workflows/ship.js`, `skills/ship/SKILL.md` (it forwards `pluginRoot`).
- **CI:** `.github/workflows/ci.yml`, `evals.yml`, `ship-outcome-eval.yml`, and a new `canary.yml`. Required checks are ruleset settings, so adding new jobs to them is an owner action after merge.
- **Scripts and fixtures:** new `scripts/postinstall-smoke.mjs` and `scripts/cut-release-fixture.mjs`; new `test/fixtures/ship/release-1.7.0/`.
- **Evals:** `evals/ship/run.mjs`, `lib/eval-history.mjs`, `evals/history/README.md`.
- **Docs:** a new `docs/16-upgrading.md`, a release-procedure section in `CONTRIBUTING.md`, `docs/04-when-it-stops.md`, `docs/07-cli-and-configuration.md`, `docs/14-evals.md`, `README.md`, and `CHANGELOG.md` `## [Unreleased]`.
- **No new dependency.** Everything stays stdlib Node.
- **Release:** this lands as a minor (1.8.0), because the unknown-flag refusal and the eval trigger change are breaking.
