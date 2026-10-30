# Contributing

## Run it from a checkout

```bash
git clone https://github.com/renzrollon/interlock && cd interlock
npm test                      # no dependencies to install first
claude plugin validate . --strict
claude --plugin-dir .         # load it without installing
```

`/reload-plugins` picks up edits without restarting. There is no lint or build step.

`npm test` is `node --test` over a `find`-piped file list. Run it that way: a bare `node --test 'test/**/*.test.mjs'` relies on runner-side glob expansion, which collects zero tests on Node 18 and 20 and reports success.

## Conventions

- **Zero runtime dependencies.** `package.json` has no `dependencies` key and CI installs nothing. Adding one is a design decision that belongs in a change's `design.md` with a pinned exact version.
- Node ≥ 18, `"type": "module"`, `.mjs` throughout.
- `openspec/` belongs to the OpenSpec CLI. Write into it through `openspec new change` / `openspec instructions`, not by hand-scaffolding directories.
- **Thresholds live in the CLI, not in prose.** Never restate a numeric cap in a skill or a review prompt — read it from `interlock limits`, or let the gate decide.
- **Guards fail open, never closed.** Every hook allows on anything it cannot establish.
- **A prose instruction nobody asserts silently stops running.** When you add an instruction to a skill, pin it in `test/skills.test.mjs` — and assert tokens, not sentences.
- **Degradation is spoken, never silent.** If a path degrades, say so in the output.

See [.claude/CLAUDE.md](./.claude/CLAUDE.md) for the full set of things to get right.

## Pull requests

**Every pull request carries an OpenSpec change.** Changes to this repository go through its own loop: `/interlock:spec`, read the spec, `/interlock:ship`. The pull request includes the change under `openspec/changes/<name>/` — proposal, design, tasks and delta specs — or, once archived, under `openspec/changes/archive/`, and names it in the description. A pull request without one is sent back for a change before it is reviewed: the spec is what the diff is reviewed against.

Create the change through the OpenSpec CLI (`openspec new change`), not by hand, and run `openspec validate <name>` before you open the pull request. The [pull request template](./.github/pull_request_template.md) asks for the change's name and the `npm test` output.

## Issues, conduct and security

- **Issues** start from a form: a bug, a run that misbehaved, a feature request or an accessibility barrier. Questions go to [Discussions](https://github.com/renzrollon/interlock/discussions).
- **Security vulnerabilities never go in a public issue.** Report them privately, as [SECURITY.md](./SECURITY.md) describes.
- **Accessibility**: what Interlock aims for, its known limitations and how a barrier is handled are in [ACCESSIBILITY.md](./ACCESSIBILITY.md).
- Everyone taking part follows the [code of conduct](./CODE_OF_CONDUCT.md).

## Bumping the OpenSpec pin

Interlock provisions one pinned OpenSpec release (`lib/openspec-pin.mjs`, generated). To move it:

```bash
node scripts/pin-openspec.mjs X.Y.Z && node cli/interlock openspec provision && node scripts/openspec-contract.mjs
```

The first command regenerates the pin from a lockfile it resolves (it needs npm and the registry, and refuses an entry that is not sha512, not from the npm registry, or has an install script). The second installs it. The third runs every OpenSpec command the skills rely on against that copy in a scratch project, and prints one line naming the CLI, its version and how many checks passed. Paste that line into the pull request. The contract script is opt-in and not part of `npm test` or CI, which install nothing; the unit suite runs it against a stub CLI only. Then update `OPENSPEC_MIN_VERSION` in `lib/doctor.mjs` if the floor moved.

## Model evals

The deterministic spine is unit-tested; the model-facing surface (prompts, skills, shared contracts) is regression-tested against a real model by the `evals/` case suite. How to run it, what it gates, and how to add a case from an observed failure are in [docs/14 — Evals](./docs/14-evals.md).

## Releasing

Push a `v<MAJOR.MINOR.PATCH>` tag matching the version `package.json` carries, and `.github/workflows/release.yml` runs the suite and publishes to npm with provenance. It uses trusted publishing, which has to be configured once on the registry for this repository and that workflow file name — until it is, the publish step fails with the registry's authentication error rather than skipping.

When that run succeeds, `.github/workflows/plugin-bundle.yml` fetches the tarball that was just published from the registry. It follows only a tag push of `release.yml` in this repository, never a same-named workflow from a fork's pull request. It validates the tarball as a plugin with a read-only token and, in a separate job that holds the write token, commits it, unpacked and unchanged, to the `release` branch. Plugin installs read that branch: the marketplace entry names it, and Anthropic's plugin directory tracks it. A plugin user therefore gets the same files and the same version as an npm user, and nothing from main until it is released. Two consequences:

- **The npm `files` whitelist is the whole plugin.** A file the plugin reaches at runtime that no entry ships is missing for every plugin user, even though `claude --plugin-dir .` still loads it. `test/spine/package.test.mjs` names any such file.
- **The branch moves only through the workflow.** To seed it, or to roll plugin users back, run *Plugin bundle* from the Actions tab with a version that is already on npm. Do not push to `release` by hand.

### Before you cut the tag

**Write the `### Upgrading` notes.** Every CHANGELOG section that carries a breaking entry needs an `### Upgrading` subsection saying what a user has to do, and a section with a breaking entry cannot be a patch. `test/spine/changelog.test.mjs` holds sections from 1.8.0 on to both rules, comparing versions numerically, and holds `## [Unreleased]` to the Upgrading rule alone, since its version is not known until the bump. A breaking entry is a bullet marked `BREAKING` (bold or not), and the marker is read in bullets and quoted lines, not in headings. A release with one is a minor at least: choose the version with that in mind when you run `bump-release`, which renames `## [Unreleased]` and bumps every manifest. The user-facing page that the notes link to is [docs/16](./docs/16-upgrading.md).

**Re-cut the previous release's run-state fixture.** `test/fixtures/ship/release-<version>/` is the `.claude/ship/` a run left under that release's CLI, with every scratch path replaced by `${ROOT}`. `test/spine/upgrade-fixtures.test.mjs` copies each one into a temporary repository and drives it to a receipt under the current CLI, so a change that cannot read what the last release wrote fails there. At each bump, add the fixture for the release you are leaving:

```bash
node scripts/cut-release-fixture.mjs v<previous version>
```

It extracts that tag's `bin`, `lib` and `package.json` with `git archive`, runs a fixed change through `run start`, `run classified`, `run record-batch` and a halting `run close` using that CLI, and copies the result out. Commit the output. The test requires at least one fixture below `package.json`'s version, and fails any file that still spells a machine path.

**Run the shipped sample locally, twice, and grade it.** Two checks the pipeline cannot make, because they need a subscription session and the host users actually run. Neither belongs in CI: a pipeline run would go through `claude -p` or ACP, a different host on a metered path.

- *Pre-tag, advisory.* `npm pack`, extract the tarball into a scratch directory (never the checkout: a `--plugin-dir` session writes into the directory it loads), reset the demo fixture repository to the commit `/interlock:ship` starts from, start `claude --plugin-dir <copy>` there and run `/interlock:ship` on its change. Run `which interlock` inside that session first, and check that it is the copy you mean to test: the relay agents call bare `interlock` from `PATH`.
- *Post-bundle, authoritative.* After *Plugin bundle* has pushed the `release` branch, `/plugin update`, run `interlock doctor` and read its `cli-version` row, reset the fixture and run `/interlock:ship` again from the clean install. Then reset to the state `/interlock:spec` starts from and run it to its checkpoint.

Grade each run where it happened, with the outcome eval's own graders and no model:

```bash
node evals/ship/run.mjs --grade-root <fixture repo> --change <change> --baseline-commit <sha> \
  --fixture-id <fixture>@<tag> --baseline-counts <file> --history-root <dir>
```

The row it appends carries the plugin version the run recorded, the host, and an eval agent of `interactive-session`, so it is never mistaken for a headless row; a run that recorded no version is refused. Without `--baseline-counts` the not-weakened criterion is recorded `unobserved`. Commit the rows you mean to keep, as `evals/history/README.md` says.

One run is a smoke, not a score. Compare invariants that must hold on every release rather than golden diffs, and treat a violation as a regression or a change the CHANGELOG names:

- the terminal event is `run-complete`; `halted` is false, `committed` is true, `leftoverTaskIds` is empty;
- every wave has no failed task and every `cli-exit` is zero;
- `degradations` is empty; `toolsDeniedInLanes`, `permissionPrompts`, `autoModeDenials` and `schemaResultsMissing` are all zero; `modelSubstitutions` is what the model map predicts for the engine in use;
- `interlock verify unit` is green in the fixture and no suite was weakened against its baseline counts;
- the paths a run touched stay within the paths it predicted;
- wall time and output tokens stay within a band of the previous row. Twice is a reasonable first band, because the model varies;
- for the spec run, `interlock validate <change> --json` exits 0, the artifact-review metrics file is written and the risk class is unchanged for the same brief.

Anything outside the band is an issue opened before the tag, not a reason to widen the band.
