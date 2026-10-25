## Branch Name
`feat/harden-release-upgrade-path`

## Commit Message
```
feat!: harden the release upgrade path, adopt the advisor tool

Two OpenSpec changes in three commits: harden-release-upgrade-path
(63ea221, baseline repair 4c65fb6) and
replace-subagent-advisors-with-advisor-tool (f68bf1f, which also carries
the PR #22 review-gate fixes).
```

## MR Title
feat!: harden the release upgrade path, adopt the advisor tool

## MR Description
## Summary

- **Version skew is named, not silent.** The CLI reports its own version. Every subcommand refuses an unknown flag with exit 2, which used to be silently ignored. `interlock doctor`, the session-start preflight and `run start` compare the `interlock` on `PATH` with the plugin. A ship run records which CLI and which plugin wrote it.
- **State written by the previous release resumes or is refused by name.** This covers manifests, trajectories, `classified.json`, test profiles, graph manifests and the autonomy record. Committed `release-1.6.3` and `release-1.7.0` run-state snapshots prove it under the current CLI.
- **Release gates test what users install.** CI now also covers:
  - a post-install smoke of every command a shipped surface calls, run from the installed tarball on Linux and macOS;
  - an over-install on top of the previous npm release;
  - plugin validation at the engine floor;
  - Node 24.

  A daily canary re-validates the shipped `release` bundle under the newest Claude Code.
- **The two subagent "advisors" are replaced by Claude Code's own advisor tool.** Interlock observes and counts the tool's consults but never configures or requests it. Compound notes stay.

Two OpenSpec changes: `harden-release-upgrade-path` (63ea221, with the baseline repair in 4c65fb6) and `replace-subagent-advisors-with-advisor-tool` (f68bf1f, which also carries the fixes for this PR's review gate, 5 blockers of 52 findings).

## Changes

**CLI surface and version**
- `lib/version.mjs`, `lib/cli-flags.mjs` (new): per-subcommand flag table, unknown-flag refusal, `-h` per subcommand
- `bin/interlock`, `bin/interlock-run`, `lib/graph/cli.mjs`: `--version`, `version --json`, and `tasks tick|coverage <change>` read the positional

**Skew**
- `lib/doctor.mjs`: `cli-version` row. It compares against `CLAUDE_PLUGIN_ROOT` or a plugin `bin/` on `PATH`, and skips rather than compare a copy with itself.
- `hooks/preflight.mjs`, `lib/preflight-file.mjs`: preflight wiring
- `lib/run.mjs`, `lib/receipt.mjs`, `workflows/ship.js`: version on the manifest, events, receipt and every step; `CLI VERSION SKEW`, `CLI VERSION UNKNOWN`, `PLUGIN VERSION UNREADABLE`

**Previous-release state**
- `lib/run.mjs`:
  - stale classification removed;
  - a closed or halted manifest refused, and a close of an already-closed run writes nothing;
  - a defaulted manifest field spoken;
  - an unparseable or invalid test profile halts `run start`.
- `lib/run-log.mjs`: foreign schema lines named in every format
- `lib/graph/graph/build.mjs`, `update.mjs`: rebuild on schema, extractor or overlay change
- `lib/autonomy.mjs`: a corrupt record is moved aside and named
- `scripts/cut-release-fixture.mjs` and `test/fixtures/ship/release-*`: committed snapshots of previous releases' run state

**Release gates and evals**
- `scripts/postinstall-smoke.mjs` (new): an exported `INVENTORY` of 71 commands, each asserting its exit code and JSON keys
- `.github/workflows/ci.yml`:
  - Node 24;
  - `validate-plugin` over the latest and floor engines;
  - `cli-smoke` on ubuntu and macOS;
  - gate jobs that keep reporting the required `validate-plugin` and `cli-smoke` checks;
  - `upgrade-install` with the skew harness.
- `.github/workflows/canary.yml` (new): daily, read-only. It checks the bundle with the tests and smoke of the tag the bundle was cut from.
- `.github/workflows/evals.yml`, `ship-outcome-eval.yml`: cron removed until a model credential exists
- `evals/ship/run.mjs`: `--grade-root` grades an interactive ship run in place

**Advisor tool replaces the subagent advisors**
- Removed:
  - `lib/advisor*.mjs`, `lib/review-advisor*.mjs` and their `lib/prompts/`;
  - `agents/advisor.md`, `agents/review-advisor.md`;
  - `scripts/advisor-e2e.mjs`;
  - the Spec Range and Review Range eval cases.
- Added:
  - `lib/advisor-tool.mjs`: configuration and consult counting;
  - `lib/host/advisor-banners.mjs`;
  - `lib/note-cli.mjs`;
  - `lib/settings-sources.mjs`: one settings reader, kept out of the runner's import closure.
- `lib/spec-meter.mjs`, `hooks/mod.mjs`, `lib/agent-usage.mjs`: consult counts
- `skills/spec/SKILL.md`, `skills/review-code/SKILL.md`, `lib/limits.mjs` (`maxNoteMatchRows`)

**Baseline repair**
- `lib/lane-outcomes.mjs`, `lib/run-usage.mjs`: moved out of `lib/run.mjs` for its size headroom; re-exported unchanged

**Docs**
- `docs/16-upgrading.md` (new); CHANGELOG `[Unreleased]` with `### Upgrading`
- `docs/02`, `04`, `07`, `10`, `14`, `README.md`, `CONTRIBUTING.md`

## High Risk Changes

- **BREAKING (CLI): an unknown flag exits 2.** A script or a stale skill that passes a flag a subcommand does not declare now fails instead of being ignored. *Mitigation:* `test/spine/cli-inventory.test.mjs` pins every flag that a skill, the ship driver, the run steps and the hooks pass to the flag table and the smoke inventory. *Rollback:* revert.
- **BREAKING: the 1.7.0 checkpoint advisor is removed.** That means `interlock advisor`, the `interlock:advisor` agent, spec skill §5a and `advisor.md`. The CHANGELOG Removed and Upgrading entries name the replacement.
- **BREAKING (CI): the full-suite and ship-outcome evals lose their cron triggers.** Both stay manually invocable. They had skipped every metered step since they were created and reported green.
- **The required checks now wait on more legs.** `validate-plugin` and `cli-smoke` are gate jobs over their matrices, so a red floor-engine leg or macOS leg blocks a merge. Renaming a CI job or leg needs ruleset 25566171 and `REQUIRED_CHECKS` in `test/spine/github-workflows.test.mjs` updated together.
- **A CLI older than the plugin is now a failing preflight row.** Users with a stale global `interlock` see it at session start. The row's fix text names the exact `npm i -g` command.

## Prerequisites to Production

- **Users of the npm CLI:** bring it to the plugin's version, `npm i -g @renzrollon/interlock@<plugin version>` (see `docs/16-upgrading.md`).
- **Owner follow-ups:**
  - Optionally add `test (24)` and `upgrade-install` to the `main: required CI` ruleset; they block nothing until then.
  - The release bump must cut the `release-<version>` run-state fixture (design D24).
  - The next version is still open: design D35 says 1.8.0, and the commits carry `!`.
- No environment variables, migrations or feature flags.

## Testing

- Unit: `npm test` gives 4045 tests, 4034 pass, 0 fail, 11 skipped. The skips are the sandbox's six loopback-notify tests, three that need a live host, one ACP agent, and the CI-only skew case. `cli.test.mjs` and `run.test.mjs` were also run unsandboxed: 521/521.
- Release checks run locally:
  - the packed tarball installed into a temp prefix, with the smoke giving 71 commands and 0 failures;
  - the skew harness against `@renzrollon/interlock@1.7.0` from npm, against a stand-in 1.6.9, and against the current CLI;
  - `npm run validate` and `openspec validate harden-release-upgrade-path --strict` passed.
- Not covered locally: the canary and the floor-engine and macOS legs, which run only on GitHub Actions.
