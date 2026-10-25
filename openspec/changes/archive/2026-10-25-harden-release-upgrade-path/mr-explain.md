## Change Explanation — PR #22

**Scope:** 25 source files explained (of 54 changed; siblings folded into their blocks) · source `feat/harden-release-upgrade-path` → target `main` · HEAD `f68bf1f`
**Intent:** Make an upgrade observable. The CLI and the plugin now say which version each is, refuse what they do not understand, and resume or refuse the previous release's on-disk state by name. CI tests what users actually install. Separately, the two home-grown subagent "advisors" give way to Claude Code's own advisor tool, which Interlock observes and counts but never turns on.

---

### PR Summary

This PR lands two OpenSpec changes. `harden-release-upgrade-path` (63ea221, with the baseline repair in 4c65fb6) covers four things:
- version reporting and an unknown-flag refusal on every subcommand;
- `CLI VERSION SKEW` in the doctor, the session preflight and at run start;
- named handling of state an earlier release wrote;
- new CI gates: a post-install smoke, an over-install of the previous release, the engine floor, macOS, Node 24 and a daily canary over the shipped bundle.

`replace-subagent-advisors-with-advisor-tool` (f68bf1f) removes the checkpoint and review-findings advisors, keeps compound notes, and reports the real advisor tool's configuration and consults. The same commit carries the fixes from this PR's review gate. In plain terms: a *step* is one JSON instruction `interlock run …` prints for a driver to carry out, a *manifest* is the file recording one ship run, and a *bundle* is the published package on the `release` branch that plugin users install.

---

### Per-File Explanation

#### `lib/version.mjs` — Added

**Why this file needed to change:**
The release-hardening change (`harden-release-upgrade-path`) is about naming the case where the plugin (the prose, hooks and workflow Claude Code loads) and the CLI (the `interlock` binary on PATH) are different versions. Nothing in the repo could answer "what version am I?" before, so this tiny helper gives every other file one place to ask (design D16).

**What changed:**
- Lines 12–20 — `readVersion(file)` reads a JSON file and returns its `version` string, or `null` on any failure. It never throws.
- Lines 23–25 — `cliVersion()` reads `../package.json` relative to this module.
- Lines 28–31 — `pluginVersionAt(root)` reads `<root>/.claude-plugin/plugin.json`. It returns `null` for an empty or non-string root.

**Blast radius:**
- **Local.** Importers: `bin/interlock:79`, `bin/interlock-run:46`, `lib/doctor.mjs:82`, `lib/graph/cli.mjs:27` and `lib/run.mjs:42`. `test/workflows.test.mjs:2194` allow-lists the specifier for the ACP runner.
- `bin/interlock-run` may import only node builtins plus the host port, so the test allow-list entry matters (4c65fb6 added it).

**If this file had been left out:**
- `bin/interlock`, `bin/interlock-run`, `lib/doctor.mjs`, `lib/graph/cli.mjs` and `lib/run.mjs` would fail to load because each imports it. There would be no `--version` and no version stamp on runs.

---

#### `lib/cli-flags.mjs` — Added

**Why this file needed to change:**
`interlock` used to store any `--x` it was given, and each handler read only the names it knew. A mistyped flag such as `autonomy record … --blocker 2` exited 0 having recorded nothing. This file holds, as data, which flags each subcommand reads, so the dispatcher can refuse the rest by name with exit 2 (spec `cli/arguments`, design D6–D8). It also builds the per-subcommand `--help`.

**What changed:**
- Line 20 — `GLOBAL_FLAGS`: `json`, `root`, `state-home`, `change`, `help`, accepted everywhere.
- Lines 28–39 — `run start`'s accepted set is derived from `FLAG_FIELDS` (imported from `lib/run.mjs`), plus `host`, `host-capabilities` and `plugin-root`. A ship flag added to `FLAG_FIELDS` is accepted with no second edit.
- Lines 45–145 — `TABLE`: one entry per leaf form (`gate`, `run close`, `tasks tick`, …).
- Lines 162–195 — `leafOf` maps the positional words to a table key. `firstUnknownFlag` returns the first flag the leaf does not accept.
- Lines 206–221 — `helpFor(usage, sub)` slices the matching synopsis lines out of the USAGE text.

**Blast radius:**
- **Local in code, wide in effect.** The only importer is `bin/interlock:196`, but it runs on every invocation. The tests that pin the table are `test/spine/cli-arguments.test.mjs`, `cli-inventory.test.mjs` and `cli-review-fixes.test.mjs`.
- It imports `lib/run.mjs`, so the dependency runs both ways (`run.mjs` does not import it back).
- Anything that passes a flag not in the table now fails. That includes the skills, `workflows/ship.js`, the hooks and the CI scripts. `scripts/postinstall-smoke.mjs` is the inventory that checks them.

**If this file had been left out:**
- `bin/interlock` would not load. If the import were removed instead, unknown flags would again be silently ignored and `--help` would not work per subcommand.

---

#### `bin/interlock` — Modified

**Why this file needed to change:**
It is the dispatcher every skill, hook and CI step calls, so most of the user-visible behaviour of both the release-hardening and advisor commits lands here: version reporting, refusing unknown flags, per-subcommand help, the halt card's `tasks tick <change>` form, and swapping the subagent advisor commands for the new advisor tool. (A "step" is one instruction object `interlock run …` prints. The "relay" is the driver copying that output verbatim.)

**What changed:**
- Lines 3103–3124 — `--help`/`-h` anywhere on the line prints that subcommand's help and runs nothing. `--version` or `-v` prints the bare version.
- Lines 3126–3150 — `firstUnknownFlag` runs before the `switch`. An unknown flag is refused by name on stderr with exit 2. With `--json` the same facts also go to stdout, because the Workflow relay copies only stdout. Exit 1 already means "blocked" for several gates, so 2 keeps a typo from reading as a verdict.
- Lines 3153–3159 — new `version [--json]` subcommand, which also prints the binary's realpath.
- Line 1504 — `emitRunStep` skips `keepStepCopy` for a refusal of a closed run (`isRefusal`, design D15). `last-step.json` therefore keeps the last real step.
- Lines 4189–4215 — `tasks tick` and `tasks coverage` read the change from the positional the halt card prints.
- Lines 4143–4170 — `run-log show` compares against `RUN_SCHEMA` and notes foreign-release lines.
- Lines 4690–4712 — `run start` reads the four settings files once (`readAdvisorSettings`, line 1462), stores the result on the manifest as `hostEnv.advisor`, and forwards `--plugin-root`.
- Lines 4872–4899 — `autonomy record` and `autonomy clean` print the unreadable-record warning. `clean --json` stays an array and puts `warnings` on each row.
- Removed `advisor` and `review-advisor` subcommands, `review --advisor-brief`, and their USAGE text. Imports now come from `lib/note-cli.mjs`.

**Blast radius:**
- **Wide.** Invoked by `skills/*/SKILL.md` (spec, ship, review-code, review-artifacts, commit, …), `hooks/preflight.mjs`, `guard-tasks.mjs`, `recorder.mjs`, `notify-option.mjs`, `hooks/mod.mjs`, `.github/workflows/ci.yml` and `canary.yml`, and `scripts/postinstall-smoke.mjs`.
- Anything calling `interlock advisor`, `review-advisor` or `review --advisor-brief` now hits the unknown-subcommand or unknown-flag path.

**If this file had been left out:**
- None of the new behaviour would exist. `lib/cli-flags.mjs`, `lib/version.mjs` and `lib/settings-sources.mjs` would have no caller, and `--plugin-root` would not reach `runStart`. The skew checks on the run path would see no plugin root.

---

#### `workflows/ship.js` — Modified

**Why this file needed to change:**
`workflows/ship.js` is the Workflow-runtime driver: an interpreter that spawns what each `interlock run` step names and relays the CLI's output. It cannot compare versions itself. It can, however, forward the plugin root, and it can notice when an older CLI ignores that flag. That older CLI is the exact skew case the release hardening targets.

**What changed:**
- Line 135 — `parseInvocation` accepts `pluginRoot` from the args. `skills/ship/SKILL.md:49` passes `${CLAUDE_PLUGIN_ROOT}`.
- Line 584 — `run start` is called with `--plugin-root <pluginRoot>` when one is present.
- Lines 590–598 — if the start step carries no `cliVersion` string, the driver adds a `CLI VERSION UNKNOWN` banner. An older CLI's permissive parser ignores the flag and prints a step without that field.
- Lines 154–158, 497–503 — `CLI_NAME` constant. `test/workflows.test.mjs` scans the file text for `interlock <word>` to list the subcommands the script drives, so prose naming the binary would otherwise be read as an invocation. A relay failure on `run start` also gains a hint to run `interlock --version`.
- Lines 633–638 — the halt reason is tagged `(RELAY UNREADABLE)` when the relay failed before any manifest existed.

**Blast radius:**
- **Local.** It is launched only by `skills/ship/SKILL.md` through the Workflow tool. The CLI side is `bin/interlock`'s `run start` and `lib/run.mjs`, and `test/workflows.test.mjs` pins it.
- `bin/interlock-run` is the ACP counterpart. It does not forward `--plugin-root` here.

**If this file had been left out:**
- `run start` would never receive the plugin root, so `CLI VERSION SKEW` could never fire in a Workflow-driven ship. A CLI older than 1.8.0 would run with no warning at all.

---

#### `lib/run.mjs` — Modified

**Why this file needed to change:**
`lib/run.mjs` is the ship loop: it emits each next step, keeps the run manifest (the JSON file recording one run's progress) and writes the close. The release hardening makes it name version skew and refuse or default state left by the previous release. The advisor commit adds the close-time pieces for the new advisor tool, and the review fixes make a second close harmless. Most of the diff's size (about 1,000 lines) is code moved out in 4c65fb6.

**What changed:**
- Lines 140–162 — imports from the new `run-usage.mjs` and `lane-outcomes.mjs`, then re-exports of the same names. Callers keep one import path.
- Lines 353–360, 377–400 — the manifest now records `cli: {version, path}` and `plugin: {version, root}`. It stays `interlock.run/1` because the fields are additive.
- Lines 2872, 2917–2938 — `versionBanners` runs in `runStart`. It emits `CLI VERSION SKEW` when both versions are readable and differ, and `PLUGIN VERSION UNREADABLE` when the plugin's version cannot be read.
- Lines 4355–4380, 4410 — `closedState`, `refuseClosed` and `isRefusal`. Any non-start, non-close subcommand on a halted or closed run returns a halt step and writes nothing. `REFUSALS` is a `WeakSet`, and `stampStep` (line 640) does not number a refusal.
- Lines 4382–4403 — `speakDefaulted`. A manifest missing `verifyBudget` or `stateHome` (written by an earlier release) gets a `MANIFEST FIELD DEFAULTED` banner once per run.
- Lines 4682–4741, 4823 — close replay. `runClose` on a manifest with `closedAt` returns the close kept at `LAST_CLOSE_PATH` (`closeAlreadyOnRecord`) and writes nothing. If that copy is missing or belongs to another run, it builds a halt-or-complete step, exit 1, with `CLOSE ALREADY RECORDED` and `ORIGINAL CLOSE UNAVAILABLE` banners. Previously a second close recorded a second receipt and overwrote the halt reason.
- Lines 2476–2499, 3072, 3498 — `profileHalt` uses the shared validator `profileProblem`. An unreadable, unparseable or invalid test profile halts `run start`, and `record-batch` before state advances.
- Lines 5208–5250 — in a strict run, the autonomy record is claimed on the manifest only if the ladder's run count actually moved. The count is read before and after, because `record` does not throw when the file cannot be moved aside.
- Lines 4318–4346 — a foreign or unparseable manifest is named, not read as "no manifest".

**Blast radius:**
- **Wide.** `bin/interlock` is the main caller, and `lib/cli-flags.mjs` and the run, receipt and trajectory tests also import it. `workflows/ship.js` and `bin/interlock-run` do not import it; they carry out the steps it prints, so a change to a step's shape reaches both drivers.
- `lib/run.mjs:31` imports `PLUGIN_ROOT` from `lib/doctor.mjs`, so a doctor change reaches the run loop.

**If this file had been left out:**
- Skew banners and refusals would not exist. A second `run close` would append a second receipt and overwrite the halt reason. An invalid profile would throw mid-run. `bin/interlock` would also fail on its `isRefusal` and `RUN_SCHEMA` imports.

---

#### `lib/lane-outcomes.mjs` — Added (with `lib/run-usage.mjs`)

**Why this file needed to change:**
After `63ea221`, `lib/run.mjs` grew into a headroom test in `test/spine/package.test.mjs` that caps file size. Commit 4c65fb6 moved two self-contained blocks out rather than weaken the test. The commit message says the move took `run.mjs` from 10 KiB inside the 16 KiB headroom to 11 KiB clear of it.

**What changed:**
- `lib/lane-outcomes.mjs` is the adjudication of lane results ("what did this task do", from the outcome `record-batch` recorded rather than the agent's claim). It exports `recordedOutcomes`, `adjudicateBatches`, `overrideBanner`, `claimDerivedBanner`, `rejectedReportReader`, `rejectedBanner` and `laneOutcomes`. It is pure and touches no files.
- `lib/run-usage.mjs` (the sibling move) is the token and cache accounting fold. It exports `recordUsage` and `summarizeUsage` and keeps the rule that "unknown is not zero".
- `lib/run.mjs` lines 140–162 import and re-export all of them.

**Blast radius:**
- **Local.** The only importer of each is `lib/run.mjs` (lines 140–162). `test/workflows.test.mjs:4038` reads `run-usage.mjs` as text.
- The names stay reachable from `lib/run.mjs`, so `bin/interlock` and the tests are unchanged.

**If this file had been left out:**
- `lib/run.mjs` would fail on import. If only the move were undone, the size-headroom test would fail again.

---

#### `lib/doctor.mjs` — Modified

**Why this file needed to change:**
The doctor is the `interlock doctor` preflight, which also feeds the session-start hook. The hardening makes it name a CLI older than its plugin, which is the direction that can silently drop a review blocker. The review fixes made that row compare against a real plugin root rather than the binary against itself.

**What changed:**
- Lines 1727, 664–731 — new `cli-version` row. `cliComparisonRoot` picks the plugin root in this order: the `pluginRoot` option, then `CLAUDE_PLUGIN_ROOT`, then a plugin `bin/` found on PATH (`pluginRootOnPath`, skipping npm copies), then the module's own root.
- Lines 683–731 — `checkCliVersion` returns `skip` when only the CLI's own npm package is found. Otherwise it returns `fail` ("CLI VERSION SKEW") for an older CLI or one that predates `--version`, `warn` for a newer one, and `ok` for a match or the plugin's own `bin/`.
- Lines 570–590 — `readCliVersion` reads the package.json beside a real install, else runs `--version` with a 5 s timeout.
- Line 94 — `export { settingsSources }`. The settings-path code moved to `lib/settings-sources.mjs`, so existing importers keep working.
- Lines 836–842 — the `test-profile` row uses `profileProblem`, so a profile the doctor passes is never one `run start` rejects.
- Lines 1447–1458, 1764 — a new `advisor` row (advice only: `ok` or `skip`).

**Blast radius:**
- **Wide.** `bin/interlock` (`doctor` subcommand, line 3637), `lib/run.mjs:31` (`PLUGIN_ROOT`), `test/spine/doctor.test.mjs`, `test/skills.test.mjs` and `test/workflows.test.mjs`.
- `hooks/preflight.mjs` and the CI jobs consume the doctor's output through `interlock doctor`.
- A `fail` row appears in the session-start preflight for any user whose PATH `interlock` is older than the plugin.

**If this file had been left out:**
- No `cli-version` row, so skew would go unreported at session start. `lib/host/advisor-banners.mjs` and `bin/interlock` already import from `settings-sources.mjs`, so the re-export is not what they need. The invalid-profile case would pass the doctor and then halt `run start`.

---

#### `lib/settings-sources.mjs` — Added

**Why this file needed to change:**
`bin/interlock` and `lib/host/advisor-banners.mjs` both need to read Claude Code's four settings files for the advisor tool. The ACP runner (`bin/interlock-run`) may import only node builtins and the host port. Importing `lib/doctor.mjs` would have dragged in limits, verify and policy modules. So the path list and the read moved into a module with builtins only.

**What changed:**
- Lines 24–37 — `settingsSources(root, home)` lists the managed, user, project and local settings files. It was lifted from `lib/doctor.mjs` unchanged.
- Lines 50–66 — `readSettingsSources` returns, per file, `absent`, `text`, or the thrown `error`. It never throws. An absent file is not a degradation, but an unreadable one is, and the caller says so.

**Blast radius:**
- **Local.** Importers: `bin/interlock:192`, `lib/doctor.mjs:86` and `lib/host/advisor-banners.mjs:11`. `test/spine/settings-sources.test.mjs` pins that doctor re-exports the same function and checks the import closure.

**If this file had been left out:**
- `bin/interlock`, `lib/doctor.mjs` and `lib/host/advisor-banners.mjs` would fail to load. Without the split, the runner would reach `lib/doctor.mjs` and break its import-closure test.

---

#### `lib/autonomy.mjs` — Modified

**Why this file needed to change:**
The autonomy ladder keeps its counters in `.claude/autonomy.json`. A corrupt file used to read as `{}` and the next `record` overwrote it, destroying the history. Design D20 separates "absent" from "unreadable" and preserves the unreadable file.

**What changed:**
- Lines 42–59 — `loadState` returns `{state, unreadable}`. `ENOENT` is an empty ladder. Other read errors, parse failures or a non-object value set `unreadable: true`.
- Lines 70–88 — `save` renames an unreadable file to `autonomy.json.unreadable-<ISO>` before writing fresh counters. It returns a warning string. If the rename fails it leaves the file and writes nothing.
- Lines 104–142, 145–161 — `record` adds `warnings: [..]` to its result only when there is one. `recordCleanFlow` sets `.warnings` as a property on the returned array.

**Blast radius:**
- **Local.** Importers: `bin/interlock:110` (`autonomy` subcommands) and `lib/run.mjs:95`, which now also calls `getState`. `test/spine/autonomy.test.mjs` covers it.
- The strict-close record in `lib/run.mjs` depends on the "left in place, not recorded" behaviour when the move fails.
- `skills/spec` and `skills/review-code` invoke it only through the CLI.

**If this file had been left out:**
- A corrupt `autonomy.json` would again be silently overwritten. `lib/run.mjs` would still call `record`, but would never see a warning, so `AUTONOMY RECORD NOT WRITTEN` would carry less detail. `bin/interlock` would print nothing for `result.warnings`.

---
#### `.github/workflows/ci.yml` — Modified

**Why this file needed to change:**
Until now a green CI run proved the working tree was consistent and the tarball was complete, but not that someone who upgrades is unbroken. This PR adds the missing proofs: the oldest and newest Claude Code engine, a second OS, Node 24, an over-install of the previous release, and the post-install smoke. Adding legs creates a naming problem. The GitHub ruleset `main: required CI` lives on GitHub, not in the repo. It requires bare check names, and a matrix reports names like `validate-plugin (latest)`. So two small "gate" jobs were added to keep the bare names alive.

**What changed:**
- Lines 14–18 — the `test` matrix gains Node `'24'` (a "matrix leg" is one parallel run of a job with one parameter value).
- Lines 33–39 — `validate-plugin` becomes an `engine: [latest, floor]` matrix. The floor version is read from `MODS_MIN_HOST_VERSION` in `lib/host/claude-env.mjs`, never typed into the YAML.
- Lines 75–81 — `cli-smoke` runs on `ubuntu-latest` and `macos-latest`. Line 150 runs `scripts/postinstall-smoke.mjs` against the installed prefix.
- Lines 161–180 — `validate-plugin-gate` and `cli-smoke-gate` carry `name: validate-plugin` and `name: cli-smoke`. Each uses `if: always()` and passes only if every leg was `success`, because a skipped required check reads as passing.
- Lines 191–245 — new `upgrade-install` job: install the previous npm release, install the packed tarball over it, smoke it, check the doctor's `cli-version` row, and run the skew harness case. The case is selected by exact title (`SKEW_CASE`), and the step fails unless the TAP output shows that case as `ok`.

**Blast radius:**
- **Wide.** The `main: required CI` ruleset requires `test (18)`, `test (20)`, `test (22)`, `validate-plugin`, `cli-smoke` and `Outcome eval prepare (model-free)` (line 265). Renaming or re-matrixing any job can block merges.
- Pinned by `test/spine/github-workflows.test.mjs`, which asserts every required name is reported (line 281). Also touched by `test/spine/ship-outcome-eval.test.mjs`, and `test/workflows.test.mjs` is the skew case's host.
- Incidental hits: `README.md`, `lib/surface.mjs`, `shared/TEST-PROFILE.md`, `test/spine/coverage.test.mjs`, `test/spine/prompts.test.mjs`, `test/spine/surface.test.mjs` and some docs.
- `test (24)` and `upgrade-install` are not required yet. The design says the owner adds them to the ruleset after merge.

**If this file had been left out:**
- None of the new gates would run: no floor engine, no macOS, no over-install, no smoke in CI.
- If only the gates were missing, the renamed `validate-plugin (…)` and `cli-smoke (…)` legs would stop reporting the bare required names, and every PR would wait on checks that never arrive.

---

#### `.github/workflows/canary.yml` — Added

**Why this file needed to change:**
Everything else in CI runs when someone changes the repo. But a newly published Claude Code can break the bundle users already installed (the `release` branch, which holds the published tarball unchanged) between two of our releases, and nothing would notice. The canary is a calendar-driven check of that shipped bundle against the newest engine.

**What changed:**
- Lines 27–30 — triggers are a daily `schedule` (cron `23 6 * * *`) plus `workflow_dispatch`. Nothing else.
- Lines 32–33 — token is `contents: read`. The repo allows only one write-capable job, so there is no issue-opening on failure. A failing scheduled run is itself the notification.
- Lines 43–61 — check out `release` into `bundle/`, read its version, and compute `predates` (true when the bundle is 1.7.0 or older).
- Line 66 — check out the tag `v<version>` into `tagged/`. The checks come from the tag the bundle was cut from, never from `main`, because `main`'s smoke inventory describes commands the shipped release lacks.
- Line 71 — install Claude Code unpinned, on purpose: its moving is the signal.
- Lines 72–127 — validate strictly, run the tag's `test/mod` against a copy of the bundle, install the packed bundle into a prefix, then run the doctor with `CLAUDE_PLUGIN_ROOT` set to the bundle and the tag's smoke script. Steps the bundle predates are skipped with a line in the run summary.

**Blast radius:**
- **Isolated.** It is triggered only by the schedule or by hand, and no other workflow depends on it.
- Consumers are `test/spine/github-workflows.test.mjs` (pins its schedule, read-only scope, tag checkout and spoken skips) and OpenSpec/CHANGELOG mentions.
- It reads `scripts/postinstall-smoke.mjs` from the tag, not from this branch.

**If this file had been left out:**
- A breaking engine release would go unseen until a user hit it, and the distribution spec's canary requirement would have nothing behind it.

---

#### `.github/workflows/evals.yml` — Modified

**Why this file needed to change:**
The repo has no `ANTHROPIC_API_KEY` secret. A scheduled run therefore reached the "no credential" step, skipped every metered step and reported green, which is a weekly signal that nothing ran. The owner decided the cron should go until a credential exists. The same reasoning applies to `.github/workflows/ship-outcome-eval.yml`, which is covered here too.

**What changed:**
- `evals.yml` header — a new `NO SCHEDULE` paragraph. The stale "this file is gitignored, force-added" note is corrected to "must stay tracked; only `copilot-setup-steps.yml` is gitignored".
- Lines 44–50 — the `schedule: cron '17 7 * * 1'` block is deleted, leaving `workflow_dispatch`.
- Lines 161–163 — the `full` job is renamed `Full eval suite (manual)` and gated on `github.event_name == 'workflow_dispatch'` only.
- A comment about `--scaffold` and `--allow-tools` is reworded to drop the Spec Range-specific wording.
- `ship-outcome-eval.yml` — the Wednesday cron is removed (trigger is `workflow_dispatch` only, line 43). The job is renamed `Outcome eval (manual)` (line 57), and the header comment is updated.

**Blast radius:**
- **Local.** This is a **BREAKING (CI)** change: anyone relying on the weekly runs loses them.
- Pinned by `test/evals.test.mjs` (line 624, no schedule and no cron) and `test/spine/ship-outcome-eval.test.mjs` (line 559).
- The ruleset requires `Outcome eval prepare (model-free)`, which lives in `ci.yml`, so the renamed manual job does not touch it. Other hits are `lib/limits.mjs`, `docs/14-evals.md` and `docs/10-agentic-workflow-ship-and-spec.md`.
- `scripts/host-probe.mjs` also names `evals.yml`, but only as a reference.

**If this file had been left out:**
- The weekly cron would keep running and reporting green over skipped work. The two pinning tests would fail.

---

#### `scripts/postinstall-smoke.mjs` — Added

**Why this file needed to change:**
`--help` proves a binary starts. It does not prove the files it reads at run time exist, that the JSON keys callers read are present, or that a refused command exits 2. The release review found defects only a live session shows. This script runs every command that a skill, the ship driver, a run step or a hook calls, against an installed `bin/` directory, and asserts the exit code and JSON keys.

**What changed:**
- Lines 56–62 and 381–439 — constants and a `prepare()` step build a scratch git repo with one change and two commits, plus input files. They copy the committed halted-run trajectory in as a state home.
- Lines 158–379 — `INVENTORY`, an exported list of `{ bin, argv, codes, keys, check, env, input, setup }` entries. The run entries form a chain, each naming the step the previous one returned.
- Lines 441–512 — `runInventory` runs each entry with `binDir` first on PATH. It strips `INTERLOCK_STATE_HOME` and `CLAUDE_ENV_FILE`, and empties the ntfy topic so nothing is sent. It prints PASS/FAIL rows.
- Line 209 — the doctor entry passes `CLAUDE_PLUGIN_ROOT` set to the package root, because by name alone the `cli-version` row has no plugin to compare with and skips.
- Lines 531–549 — `packageOf` uses `realpathSync`, and `invokedDirectly` compares real paths, so the script still runs through a symlinked path (macOS `/tmp`).

**Blast radius:**
- **Local.** It lives in `scripts/`, which is not in the package `files`, so it never ships.
- Consumers are `ci.yml` (cli-smoke and upgrade-install), `canary.yml` (run from the tag), `test/spine/postinstall-smoke.test.mjs` and `test/spine/cli-inventory.test.mjs`.
- `cli-inventory` fails if a shipped surface spells a command leaf the inventory does not run. Adding a CLI subcommand or flag therefore means adding an inventory entry. `test/spine/github-workflows.test.mjs` also mentions it.

**If this file had been left out:**
- `ci.yml` would call a missing script, so `cli-smoke` would fail on both OSes. Because `cli-smoke` is a required check, merges would be blocked. The canary would fail too once a new tag exists.

---

#### `scripts/cut-release-fixture.mjs` — Added

**Why this file needed to change:**
To show the current CLI can resume run state a previous release left behind, the repo needs a real snapshot of that state. This script cuts one by checking out an old tag's CLI and driving a canned run with it. The "fixture" is a committed directory under `test/fixtures/ship/release-<version>/` that tests copy and feed to the current CLI.

**What changed:**
- Header — documents the four steps: `git archive <tag> bin lib package.json`, build a scratch repo, drive `run start`, `classified`, `record-batch` and `close --halt` with the old CLI, then copy `.claude/ship/` out.
- Lines 104–125 — `machinePathsIn` and `tokenise` replace every absolute scratch path with `${ROOT}`, and the script refuses to write a fixture that still holds a machine path.
- Lines 127–155 — `outDirRefusal` guards `--out`. `copyOut` deletes the target directory before writing, so it refuses the filesystem root, the home directory, the repo root or anything above it, a file, and a non-empty directory that doesn't hold `openspec/changes/fixture-change`.
- Line 63 — `MAX_FILE_BYTES` drops files over 256 KiB.
- Lines 361–390 — argument parsing and `main`.

**Blast radius:**
- **Local.** It is development tooling only.
- Referenced by `test/spine/upgrade-fixtures.test.mjs`, `test/spine/cli-review-fixes.test.mjs` (the `--out` guard) and `CONTRIBUTING.md` (re-cut at each bump). Existing fixtures `release-1.6.3` and `release-1.7.0` are not touched by this file's presence.

**If this file had been left out:**
- The fixtures could not be re-cut at the next bump, and the tests importing its helpers would fail.
- Without the `--out` guard, a mistyped path could delete a directory such as the user's home.

---

#### `evals/ship/run.mjs` — Modified

**Why this file needed to change:**
The outcome eval grades a run it spawned itself. The release procedure also needs a per-release regression run: ship a change interactively with `/interlock:ship`, then grade it with the same six graders. `--grade-root` adds that path. It needs no agent, no credential and no spend.

**What changed:**
- Lines 620–660 — usage text, and exit codes 1 (refused) and 2 (missing flag).
- Lines 675–680 — `parseArgv` accepts `--grade-root`, `--change`, `--baseline-commit`, `--fixture-id`, `--run-id` and `--baseline-counts`.
- `recordedVersion` (line 826) reads a version in the shape each event is written in: nested `plugin.version`/`cli.version` on `run-start`, flat `pluginVersion`/`cliVersion` on `run-receipt`. A run that recorded no version is refused before anything is graded or written.
- `newestRun` (line 847) is the explicit newest-run pick: by recorded start time, falling back to run id, and it says on stderr when it broke a tie by id order.
- `gradeRootCommand` (line 877) grades with the loop arm's `gradeArm` and appends one `interactive-session` row via `appendShipOutcome`.
- Line 1078 — `main` dispatches to it.

**Blast radius:**
- **Local.** The path only runs when `--grade-root` is passed. The existing sweep is untouched apart from a new import (`agentsSpawnedIn` from `arms.mjs`).
- Consumers include `ci.yml`, whose `outcome-prepare` job runs it with `--prepare-only`; `ship-outcome-eval.yml`, the manually started metered sweep; and `lib/eval-history.mjs`, which it appends through.
- Pinned by `test/spine/grade-root.test.mjs`, `ship-outcome-eval.test.mjs`, `eval-history.test.mjs` and `ship-graders.test.mjs`.
- It reads the new `cliVersion`/`pluginVersion` fields from `lib/run-log.mjs`, so the two files are coupled.

**If this file had been left out:**
- The documented local regression run (`docs/14-evals.md`, `CONTRIBUTING.md`) would not exist, and `test/spine/grade-root.test.mjs` would fail.

---

#### `lib/run-log.mjs` — Modified

**Why this file needed to change:**
The run trajectory (`.claude/ship/runs/<id>.jsonl`) is the record of a run. For skew to be nameable, a run must say which CLI and plugin produced it. And a trajectory containing lines written by another release's schema must be named, not silently read as current events or as a short trajectory.

**What changed:**
- Lines 433–440 — `versionBlock` builds `{ version, <locator> }` field by field, or null.
- Lines 517–518 — the `run-start` event gains `cli` (with `path`) and `plugin` (with `root`).
- Lines 636–637 — the receipt gains flat `cliVersion` and `pluginVersion`.
- Lines 725–727 — `OMIT_WHEN_NULL`: a null `cliVersion` or `pluginVersion` key is left out of the receipt line, so a run that doesn't know its versions writes the same bytes as before.
- Lines 733–739 and 771–777 — `foreignSchemaOf`: a line whose `schema` differs from the current one is skipped by `nextSeq`.
- Line 897 and following — `readRunLog` returns `foreignLines`. `formatRunLog`, `checkRunLog` and the list view report them (`foreign=N`).

**Blast radius:**
- **Wide.** `lib/run.mjs` and `bin/interlock` write and read through it. About twenty files import it, including `lib/receipt.mjs`, `lib/report.mjs`, `lib/draw-run.mjs`, `lib/resume-card.mjs`, `lib/interrupted.mjs`, `lib/launch-ledger.mjs`, `lib/agent-usage.mjs`, `lib/evals-capture.mjs`, `lib/host/claude-cli.mjs`, `evals/ship/graders.mjs` and `evals/ship/trajectory.mjs`.
- Tests that read its output include `test/spine/run-log.test.mjs`, `report.test.mjs`, `resume-card.test.mjs`, `ship-trajectory.test.mjs`, `upgrade-fixtures.test.mjs` and `test/workflows.test.mjs`.
- Two design choices reduce the risk. New fields are additive, and the omit-when-null rule keeps old lines byte-identical. A trajectory whose lines use the new schema tag is read as before.

**If this file had been left out:**
- Runs would record no versions, so skew could not be named and `--grade-root` would refuse every run for lacking a version.
- A trajectory from another schema would be folded in as current events.

---

#### `lib/graph/graph/update.mjs` — Modified

**Why this file needed to change:**
`interlock-graph update` decides from source-file hashes whether the graph is current. Edits to an OpenSpec or memory markdown file, or a change of schema or extractor, were invisible to it, so it reported "up to date" over a stale graph. `lib/graph/graph/build.mjs` is the other half: it records what `update` now compares against.

**What changed:**
- `update.mjs` lines 39–47 — before reading any files, `staleBuildReason(manifest, root)` rebuilds when the manifest has no `schema_version` (`manifest-predates-schema`), a different one (`schema-changed`), or an extractor that no longer includes the JS/TS mode this root resolves (`extractor-changed`).
- Lines 77–94 — it computes `overlayHashes(root)` and compares against `manifest.overlays`, and `overlaysChanged` is now part of the up-to-date test.
- Lines 104–114 — the reason string and result name the overlays that changed.
- `build.mjs` lines 182 and 194–204 — exports `GRAPH_SCHEMA_VERSION` and `overlayHashes`, which hashes every markdown file under `openspec/` and `.claude/memory/` plus `.claude/memory.md`. Lines 445–453 write `schema_version`, `extractor` and `overlays` into the manifest. It also imports `walkMarkdown` from `extract/walk.mjs`.

**Blast radius:**
- **Local.** `updateGraph` is called only from `lib/graph/cli.mjs` line 239, and the `update` subcommand runs on it. Tests: `test/graph/build-query.test.mjs`.
- `build.mjs` has more importers: `lib/graph/retrieve/context.mjs` and `test/graph/*` (`dotnet-bicep`, `openspec-paths`, `python-shell`, `retrieve`).
- Observable effect: the first `update` after upgrading rebuilds fully, with the reason `manifest-predates-schema`.

**If this file had been left out:**
- `update` would keep reporting "up to date" over edited specs and memory, and the new manifest fields would be written but never read.
- If `build.mjs` were missing, `update.mjs` would fail at import because it needs `GRAPH_SCHEMA_VERSION` and `overlayHashes`.

---
#### `lib/advisor-tool.mjs` — Added

**Why this file needed to change:**
Claude Code has its own "advisor tool": a server-side tool the user switches on (`/advisor`, the `advisorModel` setting, or `--advisor`) that lets a session ask a stronger model for guidance mid-task. Subagents and `claude -p` lanes inherit it. Interlock's old "advisors" were separate subagents that wrote files, a different thing with a confusingly similar name. Once those are removed, the repo still has to say, out loud, when a real advisor tool is configured, because a run that silently consults it would be a hidden degradation. This module is the one place that knows how to read that configuration and phrase it. It is pure: no `node:` imports, no I/O. Callers read the files and pass the text in.

**What changed:**
- Lines 59–88 — `readAdvisorConfig(sources)` parses each settings scope and returns `scopes` (those where `advisorModel` is a non-empty string) and `unreadable` (read error, bad JSON, or not an object). An absent file is not a degradation.
- Lines 40–46 — `jsonParseReason` keeps only the position (and line/column) of a JSON error. Node's message can quote file content, and a settings file may hold a credential such as an ntfy topic. This is the review fix.
- Lines 114–129 — `advisorNotes` makes the run-note text (CONFIGURED / DISABLED / NOT READ). Lines 138–161 — `advisorDoctor` gives the doctor row. It is `ok` or `skip`, never `fail`.
- Line 16 — the `advisorModel` key is spelled only here. A static test enforces that, which is how the "never configure it" rule is held.

**Blast radius:**
- **Local.** Importers: `lib/doctor.mjs` (the new `advisor` row, plus `jsonParseReason` for its own parse errors), `lib/run.mjs` (`advisorConfigured` at line 941, `advisorNotes` at line 2815), `lib/host/advisor-banners.mjs`, and `bin/interlock` (line 193). Tests: `test/spine/advisor-tool.test.mjs`, `test/spine/settings-sources.test.mjs`, `test/spine/mod-pins.test.mjs`, `test/skills.test.mjs`.

**If this file had been left out:**
- `doctor`, `run` and the runner would all fail to import it. Without the module, nothing would tell a user that lanes might consult an advisor.

---

#### `lib/host/advisor-banners.mjs` — Added

**Why this file needed to change:**
The ACP runner (`bin/interlock-run`) drives non-Workflow hosts. By design it may import only node builtins and the host port, so it cannot reach `lib/doctor.mjs`, which pulls in the limits, verify and policy modules. It still has to print the same advisor note at the start of a run (a "banner"). This small adapter reads the settings files and the environment for it, and keeps the runner's import closure thin.

**What changed:**
- Lines 19–22 — `advisorBanners(root, env)` calls `readAdvisorConfig` on `readSettingsSources(settingsSources(resolve(root)))`. It merges in `observeClaudeEnv(env).advisorDisabled`, then returns `advisorNotes(..., { counted: false })`.
- `counted: false` makes the note say consults are not counted on this host. The runner cannot see per-lane transcripts the way the Workflow close can.
- It returns nothing when no scope sets the key.
- It uses `lib/settings-sources.mjs`, a new builtin-only module split out of `lib/doctor.mjs`, which still re-exports `settingsSources`. This is the "runner's settings read goes through settings-sources" part of the review fix.

**Blast radius:**
- **Isolated.** One caller: `bin/interlock-run` (import at line 47, used at line 365 only `if (claudeBinary)`). `test/spine/settings-sources.test.mjs` line 116 walks the runner's imports and asserts this file is reached and `lib/doctor.mjs` is not.

**If this file had been left out:**
- `bin/interlock-run` would fail on import. If the call were dropped, runner-hosted ship runs would configure-and-consult silently, with no banner.

---

#### `lib/advisor.mjs` — Deleted (with its siblings)

**Why this file needed to change:**
This was the 1.7.0 "checkpoint advisor": a subagent that read a brief and drafted questions for the human, which the CLI validated and rendered into `openspec/changes/<name>/advisor.md`. The design concluded that Claude Code's real advisor tool does not fit that job. Its advice goes only to the model that asked, it is encrypted, and the model decides when to call. So the subagent is removed rather than kept beside the real tool.

**What changed:**
- `main:lib/advisor.mjs` (306 lines) held `RISK_KINDS`, `checkDraft`, `renderAdvisor`, `headingIndex` and `verdictFromLabels` (the keep-or-drop tally). It is gone.
- Deleted with it:
  - `lib/advisor-cli.mjs` (the `--brief`/`--check`/`--verdict` handlers plus `noteCommand`, which moved to `lib/note-cli.mjs`)
  - `lib/advisor-kit.mjs` (shared table and cap helpers)
  - `lib/prompts/advisor.mjs` and `lib/prompts/brief-kit.mjs` (brief assembly)
  - `agents/advisor.md`
  - `scripts/advisor-e2e.mjs` (474 lines, the on-demand metered runner)
- What replaced each import on `main`:
  - `bin/interlock` line 189 imported `advisorBrief`, `advisorCheck`, `advisorVerdict` and `noteCommand` from `advisor-cli`. It now imports only `noteCommand`, from `note-cli`.
  - `lib/prompts/index.mjs` imported `assembleBrief` and `RISK_KINDS`. It has no advisor entries now.
  - `lib/limits.mjs` caps are removed (see below).

**Blast radius:**
- **Wide.** Files that imported the deleted modules on `main`: `bin/interlock`, `lib/prompts/index.mjs` and `lib/limits.mjs` doc comments. Surfaces that named the agent or script: the ten `evals/spec-range-*` cases (removed), `test/spine/advisor*.test.mjs` and `test/spine/prompts.test.mjs`, `hooks/mod.mjs` (spawn counting), `lib/spec-meter.mjs`, `skills/spec/SKILL.md`. Users: a script calling `interlock advisor` now stops working (the breaking part of the PR).

**If this file had been left out:**
- If this file were kept while the rest of the PR shipped, nothing would break at run time, because no remaining file imports it. It would be dead code whose four `LIMITS.*` reads return `undefined`, since `lib/limits.mjs` drops those caps here.

---

#### `lib/review-advisor.mjs` — Deleted (with its siblings)

**Why this file needed to change:**
This was a second subagent advisor, for `review-code`. It flagged weak dismissals of review findings. It was never released, and the same reasoning applies: it duplicated what the real advisor tool is for, and it kept a second verdict-tally apparatus alive.

**What changed:**
- `main:lib/review-advisor.mjs` (164 lines) had `checkFlags` and `reviewVerdict`. It is gone.
- Deleted with it:
  - `lib/review-advisor-cli.mjs` (the `review-advisor` subcommand and `review --advisor-brief`)
  - `lib/prompts/review-advisor.mjs` (brief assembly)
  - `agents/review-advisor.md`
- What replaced each import on `main`:
  - `bin/interlock` line 190 imported `reviewAdvisorBrief`, `reviewAdvisorCheck` and `reviewAdvisorVerdict`. Nothing replaced them.
  - `lib/prompts/index.mjs` exported `assembleReviewAdvisorBrief` and `planReviewAdvisorBrief`. These are removed.
- Related edits: `skills/review-code/SKILL.md` loses `--advisor`, and `lib/review-core.mjs` and `lib/cli-flags.mjs` drop the flag.

**Blast radius:**
- **Local.** It was reachable only through `bin/interlock`, `lib/prompts/index.mjs` and the six `evals/review-range-*` cases (removed). Also touched: `test/evals.test.mjs` and `test/spine/plugin-agents.test.mjs`, which asserted the agent file. No released behaviour was removed.

**If this file had been left out:**
- If this file were kept while the rest of the PR shipped, nothing would import it. It would be dead code whose three `LIMITS.*` reads return `undefined`, since `lib/limits.mjs` drops those caps here.

---

#### `lib/note-cli.mjs` — Added

**Why this file needed to change:**
"Compound notes" are a table in `docs/notes/compound.md` of rules an earlier change learned about a specific file. `interlock note add|derive|match` manages it. On `main` those handlers lived inside `lib/advisor-cli.mjs`, which is being deleted. They are kept, since the spec skill now relies on `note match` directly.

**What changed:**
- Lines 44–77 — `noteCommand` is moved from `advisor-cli` with the same `add`, `derive` and `match` branches. `readOr` and `findingsListOf` come with it.
- Lines 67–72 — `match` now emits an `unreadable` count and a `compound notes: N rows unreadable` line. This is the one behavioural change: a row that never reaches a match is spoken, not silently absent.
- The `io` bundle (`emit`, `die`, `requireChange`, ...) is still passed in by the entry file, so stdout and exit codes stay the CLI's.

**Blast radius:**
- **Local.** One caller: `bin/interlock` (line 195, dispatch near line 2318). Tests: `test/spine/cli-arguments.test.mjs` (scans it for flag use) and `test/spine/package.test.mjs`. Because the new `unreadable` field is required by the spec meter's `notes` reader (see `lib/spec-meter.mjs`), this file and the meter are coupled.

**If this file had been left out:**
- `interlock note ...` would disappear, `bin/interlock` would fail to import `noteCommand`, and `/interlock:spec`'s new step would have no command to run.

---

#### `lib/limits.mjs` — Modified

**Why this file needed to change:**
`lib/limits.mjs` is where Interlock keeps its caps in code ("thresholds live in the CLI") so a model cannot re-argue them. The ten advisor caps (question and flag maximums, brief character caps, keep/drop tally thresholds) only served the removed advisors. One cap, the compound-note row limit, was named after the advisor but still serves `note match`.

**What changed:**
- Deleted `maxAdvisorQuestions`, `maxAdvisorBriefChars`, `advisorKeepMinMatches`, `advisorRepeatMaxPercent`, `advisorVerdictMinLabels`, `maxReviewAdvisorFlags`, `maxReviewAdvisorBriefChars`, `reviewAdvisorVerdictMinLabels` and `reviewAdvisorKeepMinMatches`.
- Line 161 — `maxAdvisorNoteRows: 20` is renamed `maxNoteMatchRows: 20`, same value.
- Line 644 — `formatLimits` now prints one `note match rows (max)` row instead of ten advisor rows.
- A doc comment on `runsPerCase` is reworded: the full eval job has no schedule.

**Blast radius:**
- **Local.** Readers of the renamed key: `lib/notes.mjs` line 283 (`matchNotes`), and `test/spine/cli.test.mjs` / `test/spine/notes.test.mjs`. Docs: `shared/COMPOUND-NOTES.md`, `docs/07`, `docs/16-upgrading.md`. The living spec `openspec/specs/spec/compound-notes/spec.md` line 110 still names the old key. This change's delta spec replaces that requirement when the change is archived. Consumers of `interlock limits --json` that read `maxAdvisorNoteRows` would see it missing.

**If this file had been left out:**
- `matchNotes` would read an undefined cap, with `lib/notes.mjs` already switched. `interlock limits` would still print advisor rows for features that no longer exist.

---

#### `lib/spec-meter.mjs` — Modified

**Why this file needed to change:**
The "spec meter" is the live status line and pane in the Claude Code UI, drawn by the hooks module while `/interlock:spec` runs. It recognises the skill's commands (the "keyed lines") by their words and reads each command's JSON output. Four of its parts depended on the checkpoint advisor: the `interlock advisor` line, the consult-spawn counter, the draft file and the `waiting on you` row. With the advisor subagent gone, these are replaced by a note-match line and a count of the real tool's consults.

**What changed:**
- Lines 41–54 — `KEYED_LINES` swaps the `advisor` kind for `notes` (`interlock note match`), placed between `status` and `ledger`. Line 59 — `TEXT_KINDS` is updated to match.
- Lines 312–320 — the `notes` reader requires `rows`, `omitted` and `unreadable` in the JSON. Lines 364–365 — the `notes` kind is added to `RESOLVING` and `VERDICT`.
- Lines 423–465 — new `advisorEntryIds`, `freshAdvisorTally`, `addAdvisorEntries` and `advisorConsultsText`. These count `serverToolUses` entries named `advisor`, once per id, split session vs subagents.
- Line 590 — the pane shows `advisor consults seen: ...` only after the first entry, so a missing count never reads as a measured zero.
- Removed: `consult`, `drafts`, the draft write kind, and the advisor, consult and `waiting on you` rows.

**Blast radius:**
- **Local.** Imported by `hooks/mod.mjs` (line 168) only. There, `countAdvisorEntries` hooks `turn.step` and the old `interlock:advisor` spawn counter is removed. Tests: `test/spine/spec-meter.test.mjs`, `test/mod/spec-meter.test.ts` and `test/spine/mod-pins.test.mjs`. Constraint: `hooks/mod.mjs` must stay free of `node:` imports, and this module stays pure.

**If this file had been left out:**
- The meter would keep classifying `interlock advisor`, which no longer exists, and would ignore `note match`. `hooks/mod.mjs` would fail to import `addAdvisorEntries`, so the pane would lose its consult count.

---

#### `skills/spec/SKILL.md` — Modified

**Why this file needed to change:**
This is the prose the model follows when you run `/interlock:spec`. It is model-facing and shipped, so rewording an instruction changes behaviour. The old §5a told the model to spawn the `interlock:advisor` subagent after a clean review gate. That subagent no longer exists, and the skill also needed to say how to behave around the real advisor tool and to start reading compound notes.

**What changed:**
- Line 3 — the description no longer mentions the advisor's `advisor.md`. Line 7 — `Agent` is dropped from `allowed-tools`, since §5a was its only use.
- Line 161 — a new "Advisor tool" bullet. The skill asks for no consult. It never runs `/advisor` or edits `advisorModel`. Advice is guidance, not evidence, so a conflict becomes a ledger row. A failed call is reported and not retried.
- Lines 194–202 — a new "Compound notes" step runs `interlock note match "<name>" --json` after `tasks.md` and before §3a, and says what to do with `rows`, `omitted` and `unreadable`.
- Old §5a (about 30 lines) is deleted.
- Lines 268–269 — the §6 hand-off now reports advisor availability and consults, plus compound-note counts.

**Blast radius:**
- **Wide for behaviour, local for code.** Every `/interlock:spec` run reads it. Pinned by `test/skills.test.mjs` (lines ~797–848 check the `note match` fence order and the Advisor tool bullet) and `test/spine/spec-meter.test.mjs` (every fenced `interlock` line must be one the meter classifies, in `KEYED_LINES` order). Also: `test/spine/plugin-agents.test.mjs`. The `Agent`-grant test at `skills.test.mjs` 649–670 only applies to skills that spawn subagents.

**If this file had been left out:**
- The model would still try to spawn the deleted `interlock:advisor` agent and call `interlock advisor`, which fails. Nothing would run `note match`, and the meter's new `notes` line would never be drawn.

---
Not explained individually (smaller or mechanical):
- `bin/interlock-run`
- `hooks/mod.mjs`, `hooks/preflight.mjs`
- `lib/agent-usage.mjs`, `lib/evals-triage.mjs`
- `lib/graph/cli.mjs`, `lib/host/claude-env.mjs`
- `lib/notes.mjs`, `lib/preflight-file.mjs`
- `lib/prompts/index.mjs`, `lib/receipt.mjs`
- `lib/review-core.mjs`, `lib/verify.mjs`
- `scripts/gen-flow-svg.mjs`, `scripts/host-probe.mjs`
- `shared/COMPOUND-NOTES.md`
- `skills/review-code/SKILL.md`, `skills/ship/SKILL.md`

Also outside this walkthrough: tests, docs, the `release-1.6.3` and `release-1.7.0` run-state fixtures, the deleted Spec Range and Review Range eval cases, and the OpenSpec artifacts.

---

### Change Flow

- **Version on the run path:** `lib/version.mjs` → `lib/run-log.mjs` (versions on `run-start` and the receipt) → `lib/run.mjs` (`versionBanners` at run start) ← `bin/interlock run start --plugin-root` ← `workflows/ship.js` (forwards the plugin root `skills/ship/SKILL.md` passes; banners `CLI VERSION UNKNOWN` when the start step carries no `cliVersion`)
- **Version in the doctor:** `lib/version.mjs` → `lib/doctor.mjs` (`cli-version` row) → `hooks/preflight.mjs` (session start) and `interlock doctor`
- **Flag table:** `lib/run.mjs` (`FLAG_FIELDS`) → `lib/cli-flags.mjs` (flag table) → `bin/interlock` (refuse unknown, exit 2) → `scripts/postinstall-smoke.mjs` (`INVENTORY`) ← `test/spine/cli-inventory.test.mjs`
- **Required checks:** `bin/*` → `npm pack` → `.github/workflows/ci.yml` (`cli-smoke` legs → `cli-smoke` gate; `upgrade-install` → skew case in `test/workflows.test.mjs`) → ruleset `main: required CI`
- **Canary:** `release` bundle + tag `v<version>` → `.github/workflows/canary.yml` (tag's `test/mod` and smoke against the bundle's binaries)
- **Advisor configuration:** `lib/settings-sources.mjs` → `lib/advisor-tool.mjs` → `lib/doctor.mjs` (`advisor` row), `lib/run.mjs` (run note at start), `lib/host/advisor-banners.mjs` → `bin/interlock-run`
- **Compound notes:** `lib/note-cli.mjs` (`note match` JSON with `unreadable`) → `lib/spec-meter.mjs` (`notes` reader) → `hooks/mod.mjs`; `skills/spec/SKILL.md` runs `note match`
- **Baseline move:** `lib/run.mjs` → `lib/lane-outcomes.mjs`, `lib/run-usage.mjs` (moved out, re-exported unchanged)

---

### Reviewer Takeaway

The CLI's flag table and version are now a contract with every shipped caller: skills, `ship.js`, hooks and CI. A new subcommand or flag has to land in `lib/cli-flags.mjs`, the smoke `INVENTORY`, and, for a CI job, the ruleset-mirrored `REQUIRED_CHECKS` together; a caller left behind fails loudly by design.

---
_Explanation generated from PR diff + session context · same depth as explain-code loop · [Claude Code](https://claude.com/claude-code)_
