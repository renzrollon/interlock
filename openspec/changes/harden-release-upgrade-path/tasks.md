## 1. Failing tests first

- [x] 1.1 `test/spine/cli-arguments.test.mjs` (new; spawns `bin/interlock`, `bin/interlock-graph` and `bin/interlock-run` with `spawnSync` in temp roots), per design D6–D9 and D16. (spec: cli/arguments — all five requirements) Cases:
  - **Unknown flag.** `gate --findings f.json --bogus-flag` exits 2, and stderr names `--bogus-flag`, `gate` and the version from `package.json`. With `--json`, stdout parses to an object carrying `error`, `unknownFlag`, `subcommand` and `cliVersion`. `autonomy record review-artifacts --blocker 2` exits 2 and writes no `.claude/autonomy.json`. `run start --change c --strcit --json` exits 2 and writes no `.claude/ship/run.json`.
  - **Union.** Every `flags.<x>`, `flags['<x>']` and `num(flags, '<x>')` read in `bin/interlock` is in `GLOBAL_FLAGS` or some `SUBCOMMAND_FLAGS` entry of `lib/cli-flags.mjs`.
  - **Documented forms.** Every flag that a `USAGE` line documents for a leaf is accepted for that leaf.
  - **Help.** `doctor --help` exits 0, prints the doctor's usage lines and runs no check (no `PREFLIGHT` line). `verify --help` and `tasks tick -h` exit 0 with usage.
  - **Version.** `--version` prints `package.json`'s version. `version --json` carries `version` and `path`. `interlock-graph --version` and `interlock-run --version` print the same version. `interlock-run -h` exits 0 with usage.
  - **Positional.** `tasks tick c --ids 1.1 --json` ticks `1.1` and exits 0. `tasks coverage c --classified <f>` reads `c`. Neither ever prints `change "tick"` or `change "coverage"`.
- [x] 1.2 `test/spine/run.test.mjs`, per design D10, D11, D13, D14, D15, D17, D18 and D36. (spec: ship/run-program — all seven added requirements) Cases:
  - **Closed runs.** A manifest with `halted` set, and one with `closedAt` set: `run next --json` halts naming the run id and the state. The trajectory and `.claude/ship/last-step.json` are byte-identical afterwards.
  - **Foreign manifest.** A manifest tagged `interlock.run/2`: `run next` names both tags and the CLI version, and never says `reached without`. An unparseable manifest is named unreadable. `run close --halt x` against the `/2` manifest leaves it and a stage marker untouched and names the marker's path.
  - **Stale classification.** `run start` over a leftover `classified.json` removes it and raises `STALE CLASSIFICATION REMOVED`. A following `run classified` halts naming the file.
  - **Plan rebuild.** A fingerprint whose `planFormat` is tampered to `/4` makes the start step carry `PLAN REBUILT (plan-format-changed)`. A first run and a reused plan carry none.
  - **Profile.** `run start` with `unit.timeout_ms: "120000"` halts naming the profile. A profile made invalid between `run classified` and `run record-batch` halts the record with no tick, no state change and no trajectory line, and the step's `then` is the close.
  - **Defaulted fields.** A manifest stripped of `verifyBudget` raises `MANIFEST FIELD DEFAULTED` once across two subcommands.
  - **Versions.** The manifest carries `cli.version` and `cli.path`. `--plugin-root <dir>`, where `<dir>/.claude-plugin/plugin.json` holds a different version, raises `CLI VERSION SKEW` naming both and records `plugin`. Every emitted step carries `cliVersion`. The existing relay field whitelist pin gains `cliVersion`, as the spec requires.
- [x] 1.3 `test/spine/run-log.test.mjs`, per design D12 and D17. (spec: ship-run — both added requirements) A trajectory with one `interlock.ship-run/2` line:
  - read, list and summarize skip and count it;
  - `run-log check` fails naming the count and the tag;
  - a line with no `schema` is read as before.

  The `run-start` event and the receipt carry `cli` and `plugin` versions.
- [x] 1.4 `test/spine/doctor.test.mjs`, and the preflight-file test that covers `buildPreflightReport`, per design D5, D14 and the Risks line on `PATH`. (spec: hooks/session-preflight — both added requirements) Pass `pluginRoot` to a temp plugin directory whose `plugin.json` holds version `Y`, and build a fake `PATH` for each case:
  - **(a)** An npm-layout copy (`…/node_modules/@renzrollon/interlock/bin/interlock` with an older `package.json`): `cli-version` fails with `CLI VERSION SKEW` and a fix naming `npm i -g @renzrollon/interlock@Y`.
  - **(b)** A shim that answers `--version` with `Unknown command: undefined`: fails as predating version reporting.
  - **(c)** A newer copy: `warn`.
  - **(d)** The plugin's own `bin/`: `ok`.
  - **(e)** No `interlock` on `PATH`: `skip`.

  The `test-profile` row fails for the string timeout and for every invalid profile the verify tests use. `buildPreflightReport` copies `evidence`. Every existing doctor or preflight test that asserts an overall `ok` passes an explicit `PATH`.
- [x] 1.5 `test/graph/build-query.test.mjs`, per design D19. (spec: graph/staleness — both requirements) Extend the up-to-date case at `:91`:
  - a manifest with no `schema_version` rebuilds, with a reason naming the predating manifest;
  - a different `extractor` rebuilds;
  - an edit to a file under `openspec/specs/` rebuilds, with `overlays changed=1`;
  - an untouched tree still reports up to date.
- [x] 1.6 `test/spine/autonomy.test.mjs`, per design D20. (spec: spec/autonomy-record) A corrupt `.claude/autonomy.json`:
  - `interlock autonomy record review-artifacts --blockers 0`, spawned, exits 0;
  - the original bytes survive in `autonomy.json.unreadable-<ts>`, whose path is printed;
  - stderr says the counters restarted, and `--json` carries the same text under `warnings`.

  An absent record raises no warning.
- [x] 1.7 `test/helpers/ship-harness.mjs` and `test/workflows.test.mjs`, per design D10, D18 and D25 and review §5a tests 1, 4 and 7. (spec: ship/run-program — stale-classification, rebuilt-plan, defaulted-field and version requirements; distribution/upgrade-compatibility — third requirement)
  - **Harness, part 1.** The `plan-waves` stub writes `opts.classified || DEMO_CLASSIFIED` through `ctx.write`, instead of the up-front write at `:436-444`. A `null` planner response writes nothing. The existing suite must stay green with this alone.
  - **Harness, part 2.** `runShip` and `runCli` take a `cliBin` option, defaulting to `INTERLOCK_BIN`. An option strips `cliVersion` from relayed steps, to stand in for an older CLI.
  - **Tampered middle.** Two runs over one root with a tampered middle: `planFormat` set to `/4` gives `PLAN REBUILT (plan-format-changed)` and `plan-waves` in `calls`; `verifyBudget` and `stateHome` deleted from `run.json` give a run that closes with `MANIFEST FIELD DEFAULTED` for each.
  - **Stale classification.** A leftover `classified.json` with planner response `null` halts naming the file, and no batch is dispatched.
  - **Plugin root.** Args carrying `pluginRoot` make `run start` receive `--plugin-root`.
  - **Older CLI.** A start step without `cliVersion` makes the close carry `CLI VERSION UNKNOWN`.
  - **Unreadable start.** A `run start` relay unreadable twice gives a reason containing `interlock --version`.
  - **Skew.** A case reads `INTERLOCK_HARNESS_BIN`. Unset, it skips with the reason D25 gives; set, it runs `ship.js` against that binary and asserts the close carries `CLI VERSION UNKNOWN`.
- [x] 1.8 `test/spine/upgrade-fixtures.test.mjs` (new), per design D24. (spec: distribution/upgrade-compatibility — first two requirements)
  - **Release fixtures.** At least one `test/fixtures/ship/release-<v>/` exists with `v` below `package.json`'s version. Each one is copied into a temp root with `${ROOT}` substituted, and no file in it may still contain `/tmp/`, `/private/`, `/var/folders/` or the cutting user's home. Under the current CLI, `run start` names reuse or a rebuild, and `run record-batch` and `run close` reach a receipt.
  - **The 6e9d0b02 run.** `test/fixtures/ship/halted-run-6e9d0b02/` is placed under a temp repository holding its change. Then `run start` names `no-fingerprint` with the `PLAN REBUILT` banner, `wave-state next` returns `halt` for task failures, and `run-log check` passes.
- [x] 1.9 `test/spine/resume-card.test.mjs`. (spec: ship/halt-resume-card — added requirement) Write a card for a halted run in a temp repository with an active change, take every `interlock …` line the card prints, substitute the card's change and a verified id for the placeholders, and run each through `bin/interlock`. `tasks tick <change> --ids <id>` ticks and exits 0.
- [x] 1.10 `test/spine/cli-inventory.test.mjs` (new), per design D22. (spec: cli/arguments — second requirement; distribution/release-gates — second requirement)
  - Extract every `interlock <sub> [<leaf>] …` segment from `skills/**/*.md`, `shared/*.md`, `agents/*.md`, `workflows/ship.js`, the `argv` literals of `lib/run.mjs`, `lib/resume-card.mjs` and `hooks/*.mjs`. A segment ends at a pipe, backtick or line end; placeholders are ignored.
  - Assert that every leaf is a known subcommand, every `--flag` is accepted for its leaf (`lib/cli-flags.mjs`), and every leaf appears in `INVENTORY` exported by `scripts/postinstall-smoke.mjs`.
  - Failures name the flag or leaf and the file.
- [x] 1.11 `test/spine/postinstall-smoke.test.mjs` (new), per design D21. (spec: distribution/release-gates — first requirement) Run `node scripts/postinstall-smoke.mjs <repo>/bin <repo> <tmp>` with `PATH` led by the repository's `bin/`, and assert exit 0. Assert that `INVENTORY` holds:
  - `--version`;
  - `tasks tick <change>`;
  - an entry expecting exit 2 for an unknown flag;
  - a `-h` after a subcommand;
  - `doctor --json` with the `cli-version` and `plugin` rows `ok`;
  - the `record-batch` → `judge` → `--strict` review chain.
- [x] 1.12 `test/spine/grade-root.test.mjs` (new), per design D30. (spec: evals/local-grading — both requirements) Run `runShip({ keepRepo: true })`, then `node evals/ship/run.mjs --grade-root <root> --change <c> --baseline-commit <sha> --fixture-id harness --history-root <tmp> --json`. Assert:
  - one row is appended with host `workflow`, `evalAgent` `interactive-session` and `version` equal to the run's recorded plugin or CLI version;
  - without `--baseline-counts`, not-weakened is `unobserved` with its reason;
  - a root whose trajectory and receipt carry no version appends nothing, exits non-zero and says why;
  - no agent is spawned.
- [x] 1.13 `test/skills.test.mjs`, per design D18. (spec: ship/run-program — version requirement) The ship skill's Workflow invocation line carries the tokens `pluginRoot` and `${CLAUDE_PLUGIN_ROOT}` in its `args`. Assert tokens, not the sentence.

## 2. Implementation (make §1 green)

- [x] 2.1 `lib/version.mjs` (new), per design D16. `cliVersion()` reads `../package.json` relative to the module. `pluginVersionAt(root)` reads `<root>/.claude-plugin/plugin.json` and returns `null` on any failure. Both are stdlib only. (spec: cli/arguments — version requirement)
- [x] 2.2 `lib/cli-flags.mjs` (new) and `bin/interlock`, per design D6, D7, D8, D9, D11, D16, D18 and D20. Needs 2.1's `lib/version.mjs` and 2.8's autonomy warning shape. (spec: cli/arguments — all five requirements; ship/run-program — foreign-manifest and version requirements; spec/autonomy-record)
  - **Table.** `GLOBAL_FLAGS`, enumerated from `main()`. `SUBCOMMAND_FLAGS` per leaf, traced through every helper that receives `flags`. `run start`'s entry is derived from `FLAG_FIELDS` plus `host` and `plugin-root`.
  - **Check.** After help and version handling, and before dispatch: refuse an unknown flag per D6 (stderr line plus help; with `--json` the stdout object; exit 2).
  - **Help.** `-h`/`--help` anywhere prints the filtered usage (D8) and exits 0.
  - **Version.** `--version` and `version [--json]`.
  - **Tasks.** `tasks tick` and `tasks coverage` resolve through `requestedName(positional.slice(1), flags)` (`:4144`, `:4167`).
  - **Usage lines.** `tasks tick [change] --ids`, `tasks coverage [change]`, `version`, `run start … [--plugin-root <dir>]`.
  - **Run plumbing.** The literal at `:4105` becomes `RUN_SCHEMA`. `--plugin-root` is passed to `runStart`.
  - **Autonomy.** `autonomy record` and `autonomy clean` print the autonomy warning on stderr and under `warnings` with `--json`.
- [x] 2.3 `bin/interlock-run` and `lib/graph/cli.mjs`, per design D7 and D16. Needs 2.1's `lib/version.mjs`. Both gain `--version`. `interlock-run` reads a bare `-h` as help before taking the change positional (`:207`). `interlock-graph` otherwise stays permissive. (spec: cli/arguments — help and version requirements)
- [x] 2.4 `lib/verify.mjs`, per design D14. Export `profileProblem(profile)` → message or `null`, over the checks `validateProfile` (`:133-169`) throws on, and re-implement `validateProfile` over it. Thrown messages are unchanged. (spec: hooks/session-preflight — profile requirement; ship/run-program — profile requirement)
- [x] 2.5 `lib/run.mjs`, plus `lib/receipt.mjs` if the receipt's fields are assembled there, per design D10, D11, D13, D14, D15, D17, D18 and D36. Needs 2.1's `lib/version.mjs` and 2.4's `profileProblem`. (spec: ship/run-program — all seven added requirements; ship-run — the receipt half of the first requirement)
  - **Manifest read.** `inspectManifest` (`ok`, `absent`, `unparseable`, `foreign`), with `readManifest` over it. `noManifest` and the close's no-manifest branch name a foreign or unparseable manifest. The foreign close leaves the manifest and stage marker untouched and names the marker.
  - **Closed runs.** The close stamps `closedAt`. Every `run` subcommand but `start` and `close` refuses a manifest with `halted` or `closedAt`, before writing anything.
  - **Run start.** Remove a stale `CLASSIFIED_PATH` with `STALE CLASSIFICATION REMOVED`. Raise `PLAN REBUILT (<status>)` for every reuse status except `match` and `no-plan`. Halt on `profileProblem`.
  - **Record batch.** `runRecordBatch` checks `profileProblem` before `writeState` (`:3791`).
  - **Defaulted fields.** Raise `MANIFEST FIELD DEFAULTED` for `verifyBudget` and `stateHome`, once per field, through a `defaultedFields` list.
  - **Versions.** `newManifest` records `cli` and `plugin`. `run start` compares the versions and raises `CLI VERSION SKEW`. `makeStep` adds `cliVersion`, and `RELAY_STEP_FIELDS` gains it. The receipt carries `cliVersion` and `pluginVersion`.
- [x] 2.6 `lib/run-log.mjs`, per design D12 and D17.
  - Readers: `nextSeq`, `readRunLog`, `summarizeRunLog`, `listRunLogs` and `checkRunLog` skip and count a line whose `schema` is present and is not `interlock.ship-run/1`.
  - `checkRunLog` fails naming the count and the first tag; `show` and `query` print the count.
  - `TYPE_FIELDS['run-start']` gains `cli` and `plugin`.

  (spec: ship-run — both added requirements)
- [x] 2.7 `lib/doctor.mjs` and `lib/preflight-file.mjs`, per design D5 and D14. Needs 2.1's `lib/version.mjs` and 2.4's `profileProblem`. (spec: hooks/session-preflight — both added requirements)
  - **Skew row.** A `cli-version` row: `whichSync`, then `realpath`, then the adjacent `package.json` (name `@renzrollon/interlock`), else `<path> --version` with a short timeout. `fail`, `warn`, `ok` and `skip` as D5 lists, with the resolved path and both versions in `evidence`.
  - **Profile row.** `checkTestProfile` fails on `profileProblem` after its existing checks.
  - **Preflight file.** `buildPreflightReport` copies each check's `evidence`.
- [x] 2.8 `lib/autonomy.mjs`, per design D20. `load` distinguishes absent from unreadable. On unreadable, `save` renames the file to `autonomy.json.unreadable-<ISO>` before writing fresh counters, and returns a warning naming both paths. The return shape is the one 2.2 prints. (spec: spec/autonomy-record)
- [x] 2.9 `lib/graph/graph/build.mjs` and `lib/graph/graph/update.mjs`, per design D19. (spec: graph/staleness — both requirements)
  - **Manifest.** It records `schema_version`, `extractor` and an `overlays` hash map over the inputs of `extractOpenspec` and `extractMemory`.
  - **Update.** `updateGraph` rebuilds with reason `manifest-predates-schema`, `schema-changed <old>→<new>`, `extractor-changed` or `overlays changed=N`, and keeps the source-hash and unreadable-path rules as they are.
- [x] 2.10 `workflows/ship.js` and `skills/ship/SKILL.md`, per design D18. (spec: ship/run-program — version requirement)
  - **Skill.** The Workflow `args` gain `pluginRoot: "${CLAUDE_PLUGIN_ROOT}"`.
  - **Invocation.** `parseInvocation` accepts `pluginRoot`, and `run start` gets `--plugin-root <path>` when it is set.
  - **Missing version.** A start step without `cliVersion` adds the host banner `CLI VERSION UNKNOWN: the interlock on PATH predates version reporting (older than 1.8.0) — run interlock doctor`.
  - **Unreadable start.** The `RELAY UNREADABLE` reason for an unreadable `run start` gains the `interlock --version` sentence.
  - **Unchanged.** The bare `interlock` relay command is unchanged.
- [ ] 2.11 `evals/ship/run.mjs`, `lib/eval-history.mjs` (only if `appendShipOutcome` needs a field it does not accept) and `evals/history/README.md`, per design D30. Its test reads the versions 2.5 and 2.6 record. (spec: evals/local-grading — both requirements)
  - **Form.** `--grade-root`, `--change`, `--baseline-commit`, `--fixture-id`, `--run-id`, `--baseline-counts`, with `--history-root`, `--no-history` and `--json` as today. It goes into the `unknown flag` parser and the usage text.
  - **Grading.** `gradeArm` with arm `loop`, then an append with host, version, model and `evalAgent` as D30's table gives.
  - **Refusals.** Refuse to append without a recorded version. Without `--baseline-counts`, not-weakened is recorded `unobserved`.
  - **README.** The README gains the local row's provenance.
- [ ] 2.12 `scripts/postinstall-smoke.mjs` (new), per design D21. `<binDir> <repoRoot> <scratchDir>`; exports `INVENTORY` of `{ bin, argv, codes, keys, check? }`; prints PASS/FAIL rows; exits 1 on any failure. Contents:
  - review §5c's list, plus the two extensions §5c names;
  - `--version`, `tasks tick <change>`, an unknown-flag refusal (exit 2) and `-h` after a subcommand;
  - `doctor --json` run with `PATH` led by `<binDir>`, so `cli-version` resolves to the installed copy.

  Notify entries use an empty topic. The prototype at the path in D21 may seed it. (spec: distribution/release-gates — first two requirements)
- [x] 2.13 `scripts/cut-release-fixture.mjs` (new) and `test/fixtures/ship/release-1.7.0/` (new), per design D24.
  - **Script.** `git archive <tag> bin lib package.json` into a scratch directory, then a scratch repository with one fixed change. Drive `run start` → `run classified` (a hand-written classification) → `run record-batch` (one task ok, one not attempted) → `run close --halt fixture` with the extracted CLI. Copy `.claude/ship/` and the stage marker out, with every absolute scratch path replaced by `${ROOT}`.
  - **Fixture.** Run it for `v1.7.0` and commit the output. Strip anything gitignored-by-design that the test does not read, such as briefings over 256 KiB.

  (spec: distribution/upgrade-compatibility — first requirement)
- [x] 2.14 CI, per design D2, D23, D27, D28, D29 and D34. (spec: distribution/release-gates — requirements three to six; evals/outcome-run and evals/gate — the modified requirements)
  - **`.github/workflows/ci.yml`.**
    - `test` matrix adds `'24'`.
    - `cli-smoke` gains `os: [ubuntu-latest, macos-latest]`, and its tarball step runs `node scripts/postinstall-smoke.mjs "$RUNNER_TEMP/prefix/bin" . "$RUNNER_TEMP/smoke"`.
    - `validate-plugin` becomes an `engine: [latest, floor]` matrix whose floor reads `MODS_MIN_HOST_VERSION` with `node -e`. First verify with a local `$TMPDIR` prefix install whether `claude plugin test` exists at that version, and write the summary line D28 gives if it does not.
    - A new `upgrade-install` job as D23 gives, which also runs the `INTERLOCK_HARNESS_BIN` case.
  - **`.github/workflows/canary.yml` (new).** As D27 gives.
  - **`evals.yml` and `ship-outcome-eval.yml`.** Drop `schedule:`; the `full` job's `if` becomes `workflow_dispatch` only; correct the stale "gitignored" comments (D34) and say why there is no schedule.
  - **Pins.**
    - In `test/spine/ship-outcome-eval.test.mjs`, re-point `:560` to assert no `schedule:`, per the modified requirement, and correct the stale message at `:541-552`.
    - Assert the `full` job has no schedule.
    - In `test/spine/github-workflows.test.mjs`: the canary is scheduled, read-only, and runs validate, plugin test, doctor and the smoke; `ci.yml` carries Node 24, the macOS smoke, the floor leg reading the constant and spelling no version, and `upgrade-install`; the workflow count rises.
    - Correct the stale message at `test/spine/package.test.mjs:643`.
- [x] 2.15 Docs and the CHANGELOG, per design D3, D31, D33 and D35. (spec: distribution/upgrade-notes — both requirements)
  - **`docs/16-upgrading.md` (new).**
  - **`CONTRIBUTING.md` § Releasing.** The Upgrading rule, the fixture re-cut, and review §8's local run graded with `--grade-root`, with its invariants.
  - **`README.md:71` and `docs/07-cli-and-configuration.md:9-15`.** Keep the npm copy at the plugin's version. `docs/07` also gets `--version`, the unknown-flag exit 2, help after a subcommand, `tasks tick <change>` and `--plugin-root`.
  - **`docs/04-when-it-stops.md`.** Closed-run refusal, stale classification, the start-step rebuild banner, foreign manifests, defaulted fields.
  - **`docs/14-evals.md`.** No schedule until a credential; `--grade-root`.
  - **`CHANGELOG.md` `## [Unreleased]`.** Added, Changed and Fixed, two **BREAKING** bullets (unknown flags refused; eval cron removed) and `### Upgrading`.
  - **`test/spine/changelog.test.mjs` (new).** The D3 and D33 rule.

## 3. Final verification (needs §1 and §2)

- [ ] 3.1 Run and report each of the following:
  - `npm test`, pasting the summary;
  - `npm run validate`;
  - `openspec validate harden-release-upgrade-path --strict`;
  - `node bin/interlock doctor`, showing the `cli-version` row;
  - `npm pack` installed into a `$TMPDIR` prefix with `node scripts/postinstall-smoke.mjs <prefix>/bin . $TMPDIR/smoke`;
  - `@renzrollon/interlock@1.7.0` installed into a second `$TMPDIR` prefix, with the `INTERLOCK_HARNESS_BIN` case run once against it.

  Confirm with `git diff --stat` that no file outside the proposal's Impact list moved. Name any test that skipped and why; the relay tests skip in the sandbox.
