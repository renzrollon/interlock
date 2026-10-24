## Context

See proposal.md (Why) and `docs/notes/2026-10-22-release-readiness-review.md` (§5a–§5c for the probes, §6 for the options). This change carries the options listed in D1. Five facts about the current code shape every decision below; each was re-read on 2026-10-22:

- **The CLI parses everything it is given.** `parseArgs` (`bin/interlock:1273-1313`) stores any `--x` and the handlers read `flags.x` from one shared object, about 100 names in all, some of them dynamic (`:2336`, `:2970`, `:3004-3012`). Nothing declares which flags a subcommand accepts. `-h`/`--help` is honoured only as `argv[0]` (`:3098`). Single-dash tokens are positionals. An unknown command writes to stderr and exits 1 (`:4847-4849`). The file has no `process.exit(2`. `bin/interlock-run` already refuses unknown flags, with exit 2 (`:156-176`).
- **`readManifest` collapses three cases into `null`** (`lib/run.mjs:262-269`): a missing file, an unparseable file, and a schema tag other than `interlock.run/1`. Every `run` subcommand then reports "no manifest" (`:4441-4452`), and the sequence guard is skipped entirely (`bin/interlock:4565-4573`). After a close, `lastThen` is `null` (`:5213`), so `run next` passes the guard and steps a closed run again.
- **Nothing in the repository reads its own version.** `lib/doctor.mjs` reads `package.json` only for `engines.node` (`:469`). It reads the `plugin.json` version of the tree it runs from (`:85`, `:507-541`); `bin/interlock:3584` passes no plugin root. The session-start preflight runs the plugin's own binary (`hooks/preflight.mjs:60-64`) and prints only `fail` rows (`:142-156`). `workflows/ship.js` never receives the plugin root (`skills/ship/SKILL.md:47-50`), and it relays bare `interlock` (`:449-451`). It shows banners only at the close (`:641`, `:655`, `:670-680`).
- **The harness models the planner by writing its output early.** `test/helpers/ship-harness.mjs:436-444` writes `.claude/ship/classified.json` before `run start`, and `runClassified` already halts when the file is absent (`lib/run.mjs:3494-3498`).
- **The previous release's state has never met the current CLI in a test.** `test/fixtures/ship/halted-run-6e9d0b02/` is drawn by four tests and never fed to `run start`. Only `ship-plan` (`/2`→`/5`) and `outcome` (`/2`) have ever moved.

Constraints from `.claude/CLAUDE.md`: no runtime dependency; guards fail open; degradation is spoken; thresholds live in code; a skill instruction nobody asserts stops running; the run trajectory stays `fatal: true`.

## Goals / Non-Goals

**Goals:**

- A tag that passes CI means three things. The installed tarball serves every command the shipped surfaces call, with the JSON keys those callers read. The state the previous release wrote either resumes or is refused by name. A skewed CLI is bannered at session start and recorded on every run.
- Every defect the review reproduced lands together with the test that reproduces it.
- No model-backed job reports green for work it did not do.

**Non-Goals:**

- Making published CLIs strict. 1.7.0 and earlier stay permissive forever, which is why skew detection (D5, D17) is needed alongside the flag table (D6).
- Running `/interlock:ship` in CI. The per-release local run (review §8) stays a human procedure; this change builds its grader entry point (D30) and documents it (D31).
- `interlock-graph` flag strictness. Only `--version` is added there (D7).
- Kettle's reset script, the API key, the live-host CI test, prepending the plugin's `bin/` to `PATH`, and graph `path`/`explain` exit codes (D1, D4, D26).
- Re-pointing skills at `${CLAUDE_PLUGIN_ROOT}/bin/interlock`. Review §5b explains why: the allowlist prefix, the version-bearing path, and the meter's `interlock` token (`hooks/mod.mjs:860`).

## Decisions

### D1. Scope: everything model-free and in this repository

The change carries the following review options:

- O13 (all ten defects)
- O1, the post-install smoke
- O3 items 1, 2, 3 and 5: the skew row, `--version`, the version on run records, and the flag table
- O2, the upgrade fixtures; O4, the previous-release over-install
- O5, the canary; O6, the engine floor; O7, Node 24 and macOS
- O9, as amended in D2
- O10's two in-repository build items: the grade-root entry point and the version stamp
- O11, upgrade notes

It leaves out work that is either not code in this repository or not yet probed: O8 and O12 (provisioning a secret), kettle's reset script, and O3 item 4 (D4). The owner asked for "all needed from findings in one openspec change" on 2026-10-22. The review's §7 splits the same set into six changes. One change is the owner's call; the sections in `tasks.md` follow §7's grouping, so that a reviewer can still read the work one slice at a time.

### D2. Scheduled evals: no cron until a credential exists (owner decision)

Remove the `schedule:` trigger from `evals.yml` (the `full` job's `if` becomes `workflow_dispatch` only) and from `ship-outcome-eval.yml`. Keep `workflow_dispatch` on both, and keep the PR smoke's quiet skip, so forks stay mergeable.

The owner rejected the alternatives on 2026-10-22:

- Failing loudly every week (review O9 as written) would go red forever if the key is never provisioned, which §8 makes likely.
- Leaving the green skip in place keeps the false signal.

Re-adding a cron is the edit that records the credential's arrival. `evals/outcome-run` and `evals/gate` change requirement text accordingly. `test/spine/ship-outcome-eval.test.mjs:560`, which asserts `schedule:`, is re-pointed to assert its absence. That is the spec change, not a weakened test.

### D3. A CHANGELOG semver pin, from 1.8.0 (owner decision)

A spine test parses `CHANGELOG.md` release sections in both heading styles in use: `## [1.7.0] - 2026-10-21` and `## 1.6.3 — 2026-10-19`. Only sections at version 1.8.0 or later are judged. History stays as written.

A section whose bullets carry a breaking marker (`BREAKING` or `Breaking`, bold or not) fails in either of two cases:

- its version has a patch component greater than zero;
- it has no `### Upgrading` subsection.

`## [Unreleased]` is held to the second rule only. Its version is not known until the bump. This change's own `[Unreleased]` entry is the first one the rule applies to (D35).

### D4. No `PATH` prepend through `$CLAUDE_ENV_FILE`

Review §5b fix 4 is unprobed. Nobody has checked whether Workflow agents' Bash calls source that file. It would also override a deliberate `npm i -g` choice, and the plugin directory's review flags `$CLAUDE_ENV_FILE` writes. Skew is named instead (D5, D17).

### D5. The skew row: resolve, read, compare; older is `fail`

Add a `cli-version` row to `lib/doctor.mjs`, next to `checkBinaries`:

1. Resolve `interlock` with the existing `whichSync` and `realpath` it. Read the adjacent `../package.json`. When its `name` is `@renzrollon/interlock`, its `version` is the PATH CLI's version.
2. Otherwise, for a wrapper or a shim, run `<path> --version` with a short timeout.
3. A copy that answers `Unknown command` predates version reporting, which this change introduces in 1.8.0. Read it as older than any plugin that has the row.

Compare the result with the plugin's version, which is `plugin.json` under the doctor's plugin root:

- PATH CLI older, or too old to report: `fail`, with detail `CLI VERSION SKEW: interlock on PATH is <x> (<path>), plugin is <y>` and fix `npm i -g @renzrollon/interlock@<y>`, or "remove `<path>` from PATH" when it is not an npm copy.
- PATH CLI newer: `warn`.
- Equal versions, or a PATH hit that is the plugin's own `bin/`: `ok`.
- `interlock` not on PATH at all: `skip`, with detail `interlock is not on PATH; the bundled binary runs`. Whether that is a failure stays `checkBinaries`' call, as today.

Why `fail` for older: the preflight prints only `fail` rows (`hooks/preflight.mjs:142-156`), and an older CLI is the direction that silently drops a review blocker (review §5b, `review --base`). Why not `fail` for newer: no subcommand a skill calls was removed between 1.5.1 and 1.7.0, so a newer CLI is a mismatch worth saying, not a known break. 1.8.0 itself removes `interlock advisor`, which the 1.7.0 spec skill calls on a clean gate. The row stays `warn` anyway: that skill reports the failed line and reaches its hand-off, so nothing is dropped silently, and `docs/16-upgrading.md` names the break and says to update the plugin.

`bin/interlock doctor` passes no plugin root. From a working tree, the "plugin" is that tree, which is correct for the working tree. The preflight already runs the plugin's own binary, so its plugin root is the installed plugin. `preflight.json` gains the row through the existing `checks` copy (`lib/preflight-file.mjs:87-101`). The row's `evidence` carries the resolved path and both versions, which `buildPreflightReport` does not copy today, so add `evidence` to the copied fields.

### D6. An unknown flag is refused by name, exit 2

Before dispatch, `bin/interlock` checks every parsed flag against the accepted set for the resolved subcommand (D7). An unknown flag:

- writes `interlock: unknown flag --<x> for interlock <sub> (CLI <version>)` and the subcommand's help lines (D8) to stderr;
- with `--json`, also prints `{"error": "...", "unknownFlag": "--<x>", "subcommand": "<sub>", "cliVersion": "<v>"}` on stdout, the shape `--json` errors already take (for example `tasks tick` → `{"error": "change \"tick\" not found …"}`);
- exits 2.

**Why 2 and not `die`'s 1:** exit 1 means "blocked" for `gate`, `ledger`, `ready`, `validate` and `run-log check`. A typo must not read as a verdict, and `bin/interlock-run` already uses 2 for the same refusal.

**Why the stdout object:** the Workflow relay copies stdout only (`workflows/ship.js:362`). A refused `run start --strcit` is then quoted in the `RELAY UNREADABLE` halt instead of vanishing.

An unknown *subcommand* keeps exit 1, which is unchanged. This is breaking for anyone scripting an ignored flag, so it gets the CHANGELOG `### Upgrading` note (D3, D35).

### D7. The flag table is code, declared per leaf, checked three ways

`lib/cli-flags.mjs` exports `GLOBAL_FLAGS` (the flags the dispatcher or every handler reads, such as `json`, `help`, `change` and the state-home override; the implementer enumerates them from `main()`) and `SUBCOMMAND_FLAGS`, keyed by leaf form (`gate`, `run start`, `tasks tick`, `verify exec`, …).

`run start`'s entry is built from `FLAG_FIELDS` (`lib/run.mjs:228`), plus the host flags it reads and `plugin-root` (D18). It is derived, not restated, so a ship flag added to `FLAG_FIELDS` is accepted with no second edit.

Three tests keep the table honest. A per-case static scan is impossible because helpers receive the whole `flags` object.

1. **Union.** Every `flags.<name>`, `flags['<name>']` and `num(flags, '<name>')` read in `bin/interlock` and the helpers it hands `flags` to is in `GLOBAL_FLAGS` or in some leaf's set. This catches a new flag nobody declared.
2. **Documented forms.** For every `USAGE` line `interlock <leaf> … --<flag>`, `<flag>` is accepted for `<leaf>`. A documented invocation is therefore never refused.
3. **Shipped forms.** The inventory pin (D22).

`interlock-graph` keeps its permissive parser. It gains only `--version`, as `interlock-run` does, and `interlock-run -h` becomes help: a bare `-h` is read as `--help` before the change positional is taken (`bin/interlock-run:207`).

### D8. Help after a subcommand: filtered usage, nothing runs

When `-h` or `--help` appears anywhere in argv, `bin/interlock` prints the help for the leading subcommand and exits 0 without dispatching. That help is:

- the `USAGE` synopsis lines that begin `  interlock <sub>` together with their continuation lines (the indented lines up to the next `  interlock`);
- any `<sub>:` section further down the text.

When nothing matches, it prints the full `USAGE`. This replaces today's two failure modes: `doctor --help` runs the doctor, and `verify --help` says "unknown subcommand". A per-subcommand help string was rejected: it would duplicate 1,015 lines of usage, and the two would drift.

### D9. `tasks tick <change>` reads the positional after the subcommand

`bin/interlock:4144` and `:4167` call `requestedName(positional.slice(1), flags)`, the form `run start` already uses (`:4601`). `--change` still wins.

Update the usage line `interlock tasks tick --ids <ids>` (`:410`) to `interlock tasks tick [change] --ids <ids>`, and the same for `tasks coverage`.

The sweep of every reader of the printed form:

- `lib/resume-card.mjs:246` and `docs/04-when-it-stops.md:57` print the positional form, and become correct with no edit.
- `hooks/guard-tasks.mjs:100` names the command without arguments, so it is unaffected.
- `test/spine/ship-graders.test.mjs:92-93` uses `--change`, which still works.
- The one-word callers of `requestedName` (`validate` `:3229`, `ledger` `:3955`, `advisor` `:3982`, `ready` `:3994`) already read the right index.

### D10. `run start` removes a stale `classified.json`, and the harness writes it as a planner would

`run start` removes `.claude/ship/classified.json`, the default path only (`CLASSIFIED_PATH`, `lib/run.mjs:142`), when it exists. It raises `STALE CLASSIFICATION REMOVED: .claude/ship/classified.json (written <mtime ISO>) belonged to an earlier run and was removed`.

A planner that then writes nothing meets the existing halt `wave planning failed: no readable .claude/ship/classified.json from the classify step` (`:3494-3498`), so hazard 1 needs no new halt.

The harness stops writing the file before `run start`. The `plan-waves` stub writes `opts.classified || DEMO_CLASSIFIED` through `ctx.write`, which is what a real planner does. A response of `null` writes nothing.

Rejected alternatives:

- **Stamping the file's hash at start and refusing an unchanged file:** a deterministic planner can rewrite identical bytes.
- **Comparing mtimes:** clock- and granularity-dependent.

### D11. A foreign manifest is named, never "no manifest"

Add `inspectManifest(root)` → `{ status: 'ok' | 'absent' | 'unparseable' | 'foreign', manifest?, schema? }`. `readManifest` keeps its `null` contract for its callers, implemented over it.

Two places use the status: `noManifest` (`:4441-4452`) and the close's no-manifest branch (`:4740-4779`).

- On `foreign`, they halt or close naming the file, the tag it carries, the tag this CLI reads, the CLI's version, and the remedy: "this run was started by a different Interlock CLI; close it with that version, or run `interlock run start` to begin a new run".
- On `unparseable`, they name the file as unreadable rather than absent.

The close against a foreign manifest leaves the manifest and any stage marker untouched. It cannot interpret a newer format, and the message names `.claude/<change>/stage.json` so the operator knows what still blocks a commit.

The literal `'interlock.run/1'` at `bin/interlock:4105` is replaced with the exported `RUN_SCHEMA`.

Sweep of raw readers: `hooks/recorder.mjs:65` and `hooks/guard-tests.mjs:55` read the manifest directly and fail open on anything they cannot read. That is policy, and they stay as they are.

### D12. A trajectory line with a foreign schema is skipped, counted and named

The readers in `lib/run-log.mjs` treat a line whose `schema` is present and is not `interlock.ship-run/1` as foreign. A line with no `schema` is still read, as today. A foreign line is skipped and counted as `foreignLines`, the same way a torn line is counted. The readers are:

- `nextSeq` (~`:737`)
- `readRunLog` (`:851-879`)
- `summarizeRunLog` and `listRunLogs` (`:896`, `:940`)
- `checkRunLog` (`:1191-1237`)

`checkRunLog` fails a file with any foreign line, naming the count and the first tag: such a trajectory cannot be reconstructed by this CLI. `run-log show` and `query` print a one-line note.

Sweep: `lib/report.mjs` reads trajectories through these functions, so it inherits the count. `evals/ship/graders.mjs` `gradeTrajectory` calls `run-log check` through the CLI and inherits the failure.

### D13. A rebuilt plan is named on the start step

When `resolvePlanReuse` (`lib/plan-fingerprint.mjs:581`) returns any status other than `match` (`REUSE_MATCH`) or `no-plan` (`REUSE_NO_PLAN`), `run start` raises `PLAN REBUILT (<status>): <reason> — tasks the earlier run finished but did not tick are dispatched again`.

The receipt line at `lib/receipt.mjs:427-428` is unchanged. `no-plan` is a first run, so it stays a summary line and not a banner. `plan-reuse`'s requirement already demands that the summary say which path was taken; this adds the start.

### D14. One profile validator, three callers

Export `profileProblem(profile)` from `lib/verify.mjs`. It returns the first problem's message or `null`, implemented over the same checks `validateProfile` (`:133-169`) throws on. `validateProfile` becomes `const p = profileProblem(x); if (p) fail(p)`. The three callers:

- **The doctor's `test-profile` row** (`lib/doctor.mjs:642-673`) fails with the problem after its existing JSON and `unit.command` checks.
- **`run start`** halts with `test profile <path> is invalid: <problem>` before any step is emitted.
- **`run record-batch`** checks it before `writeState` (`lib/run.mjs:3791`). A profile edited mid-run then halts naming the profile, instead of throwing after the state advanced and the boxes were ticked (`:3874`, `:3888`). That throw left `lastThen` stale, and the relay misread it (review §5a hazard 5).

### D15. `run` subcommands refuse a closed run

The close stamps `closedAt` on the manifest beside `halted` (`:4781-4782`). Every `run` subcommand other than `start` and `close` halts when the manifest carries a non-null `halted` or a `closedAt`. The halt reads: `run <sub> refused: run <runId> already <halted: reason | closed> — start a new run with interlock run start`. It writes nothing: no trajectory line, no `last-step.json`, and no state or briefing files.

A 1.7.0 manifest that closed clean has neither field, so it is not refused. That is the one legacy gap, and it is spoken in the Upgrading page (D31).

### D16. The version comes from the package, read once

`lib/version.mjs` exports `cliVersion()`, which reads `../package.json` relative to the module. That file is in the npm `files` set and in the bundle. It also exports `pluginVersionAt(root)`, which reads `<root>/.claude-plugin/plugin.json` and returns `null` on any failure.

`interlock --version` prints the bare version. `interlock version [--json]` prints `{ "version", "path" }`, where `path` is the realpath of the running `bin/interlock`. `interlock-graph --version` and `interlock-run --version` print the bare version.

### D17. Every run records which CLI and which plugin produced it

The CLI and plugin versions are recorded in four places:

- **The manifest:** `newManifest` adds `cli: { version, path }` and `plugin: { version, root } | null`.
- **The `run-start` event:** `TYPE_FIELDS['run-start']` (`lib/run-log.mjs:479-503`) gains `cli` and `plugin`.
- **The receipt:** gains `cliVersion` and `pluginVersion`.
- **Every step:** `makeStep` adds `cliVersion`.

`cliVersion` joins the relay field whitelist (`RELAY_STEP_FIELDS`) and the whitelist pin in `test/spine/run.test.mjs`. The manifest stays `interlock.run/1` and the step stays `interlock.run-step/1`, because both changes are additive and every reader ignores unknown fields.

Sweep of step readers: `workflows/ship.js:404` reads `action` only; `bin/interlock-run:432-446` parses and passes through; `hooks/mod.mjs:1037` observes. None needs a change beyond D18.

### D18. `/interlock:ship` forwards the plugin root, and the CLI compares

`skills/ship/SKILL.md` adds `pluginRoot: "${CLAUDE_PLUGIN_ROOT}"` to the Workflow `args` object. `parseInvocation` (`workflows/ship.js:65+`) accepts it, and the driver appends `--plugin-root <path>` to `run start`.

`run start` then compares `cliVersion()` with `pluginVersionAt(pluginRoot)`. When they differ, it raises `CLI VERSION SKEW: this run's interlock is <x> (<path>), the plugin is <y> (<root>)` and records both on the manifest (D17).

An older CLI ignores the unknown flag, since it is permissive, and emits no `cliVersion`. The driver then adds the host banner `CLI VERSION UNKNOWN: the interlock on PATH predates version reporting (older than 1.8.0) — run interlock doctor`.

When `run start`'s relay is unreadable twice, the existing `RELAY UNREADABLE` reason (`ship.js:604-607`) gains the sentence `the interlock on PATH may be older than this plugin — run interlock --version`. An older CLI answers that subcommand with `Unknown command` on stderr, which the relay drops.

Sweep: a skill-text pin in `test/skills.test.mjs` asserts the `pluginRoot` token on the ship skill's Workflow line. The meter recognises relays by the `interlock` token (`hooks/mod.mjs:860`), which is unchanged.

### D19. The graph manifest records what the graph depends on

`writeGraphArtifacts` (`lib/graph/graph/build.mjs:421-426`) adds three fields to `manifest.json`:

- `schema_version` and `extractor` (the same values written to `graph.json`);
- `overlays`, a `{ relPath: sha256 }` map over the inputs of `extractOpenspec` (every `.md` under `openspec/`) and `extractMemory` (`.claude/memory/**.md`, `.claude/memory.md`).

`updateGraph` (`lib/graph/graph/update.mjs:23-82`) then rebuilds in more cases than today, each with a named reason:

- A manifest without `schema_version` rebuilds with reason `manifest-predates-schema`.
- A different `schema_version` or `extractor` rebuilds with reason `schema-changed <old>→<new>` or `extractor-changed`.
- A changed, added or removed overlay file rebuilds with reason `overlays changed=N`.

The existing source-hash path and the unreadable-path rules (`graph/unreadable-paths`) are unchanged. `update`'s printed line carries the reason it already returns.

Sweep: `lib/graph/graph/drift`, merge evidence and `lib/run.mjs:3196` read the graph, not the manifest's new fields, so they are unaffected.

### D20. An unreadable autonomy record is preserved and spoken

`lib/autonomy.mjs` `load` distinguishes "absent" (→ `{}`, as today) from "present and unreadable".

On unreadable, the next `save` renames the file to `autonomy.json.unreadable-<ISO timestamp>`, then writes fresh counters. It raises `AUTONOMY RECORD UNREADABLE: <path> moved to <new path>; counters restarted` on stderr, and in `--json` output as a `warnings` entry.

The exit code is unchanged (0). The record gates readiness credit, not a run, and failing the spec skill's `autonomy record` line would cost the user a step for a file they cannot repair by retrying. A refusal was rejected for the same reason. A silent overwrite is the defect.

### D21. The post-install smoke is a script with an exported inventory

`scripts/postinstall-smoke.mjs <binDir> <repoRoot> <scratchDir>` exports `INVENTORY`, an array of `{ bin, argv, codes, keys, check? }`, and runs it when invoked directly. It prints one PASS or FAIL row per command and exits 1 on any failure.

The inventory is review §5c's list, plus the two extensions §5c names: `record-batch` → `judge` → a `--strict` review step, so that the dimension-file reads happen from the tarball; and the doctor's `plugin` and `cli-version` rows from the installed prefix. Further entries:

- `--version`
- `tasks tick <change>`
- one unknown-flag refusal (exit 2)
- `-h` after a subcommand

The prototype from the review session (`/private/tmp/claude-501/-Users-caro-IdeaProjects-specflow/6bb2be0f-171f-4175-9601-46cfee26776d/scratchpad/postinstall-smoke.mjs`) is a starting point if it still exists. The §5c list is authoritative.

`scripts/` is outside the npm `files` set, so it does not ship. CI's `cli-smoke` tarball step runs it against `$RUNNER_TEMP/prefix/bin`. `test/spine/postinstall-smoke.test.mjs` runs it against the working tree's `bin/`, so `npm test` sees an inventory regression locally (about 4 s). In the sandbox, notify entries use an empty topic and stay offline.

### D22. The inventory pin ties skills, flags and smoke together

`test/spine/cli-inventory.test.mjs` extracts every `interlock <sub> [<leaf>] …` invocation from the shipped surfaces:

- fenced and inline code in `skills/**/*.md`, `shared/*.md` and `agents/*.md`
- `workflows/ship.js` argv arrays
- the `then.argv` and `argv` literals in `lib/run.mjs`
- `lib/resume-card.mjs`
- `hooks/*.mjs`

A segment ends at the next pipe, backtick or line end. The test asserts three things:

1. every leaf is a known subcommand;
2. every `--flag` in the segment is accepted for that leaf (D7);
3. every leaf appears in the smoke's `INVENTORY` (D21).

A new flag in a skill therefore fails CI until the table and the smoke cover it. Placeholders (`<change>`, `${name}`) are positionals and ignored. The existing name-only checks (`test/skills.test.mjs:118-131`, `test/workflows.test.mjs:82-111`) stay.

### D23. The previous-release over-install installs the old version first, smokes the new one

A `ci.yml` job, `upgrade-install`, runs these steps:

1. Resolve the previous release with `npm view @renzrollon/interlock version`. That is not always behind `main`: right after a release the two are the same version, and from the release that began reporting versions on, the previous CLI reports one. The skew case (D25) branches on what that CLI reports for this reason.
2. `npm install -g @renzrollon/interlock@<that> --prefix "$RUNNER_TEMP/prefix"`, then `interlock --help` to prove the install took.
3. `npm pack` the working tree and install the tarball over the same prefix.
4. Run the full smoke (D21) and `interlock doctor --json` from the prefix. The doctor runs with `CLAUDE_PLUGIN_ROOT` set to the working tree, as a plugin session sets it, and its `cli-version` row must be `ok`. Run by name with no plugin root, the row has no plugin to compare with and skips, which proves nothing here.

Running the current smoke before the over-install was rejected: it would fail by design on every command this release adds. The job then runs the skew harness test (D25) with `INTERLOCK_HARNESS_BIN` pointing at a second prefix holding only the previous release.

The job holds `contents: read` only, so `test/spine/github-workflows.test.mjs`'s write-token install rule does not apply. The `npm view` result is still printed so the log names the version.

### D24. A committed snapshot of the previous release's run state

`scripts/cut-release-fixture.mjs <tag>` does the following:

1. Extract `git archive <tag> bin lib package.json` into a scratch directory.
2. Build a scratch repository with one fixed change.
3. Drive the old CLI: `run start` → `run classified` (a hand-written classification) → `run record-batch` (one task ok, one not attempted) → `run close --halt "fixture"`.
4. Copy `.claude/ship/` and the stage marker into `test/fixtures/ship/release-<version>/`, with every absolute scratch path replaced by the token `${ROOT}`.

This change cuts `release-1.7.0` from `v1.7.0`. The tag exists locally; CI never needs tags, because the fixture is committed.

`test/spine/upgrade-fixtures.test.mjs` copies each `release-*` directory into a temp root and substitutes `${ROOT}`. It asserts that under the current CLI, `run start` reuses or rebuilds under a named status (D13), and `run record-batch` and `run close` continue to a receipt.

It also feeds `halted-run-6e9d0b02` to `run start` and asserts the documented outcomes:

- `no-fingerprint` with the D13 banner;
- `wave-state next` → `halt (task-failures)`;
- `run-log check` passes.

The re-cut is a release step, documented in `CONTRIBUTING.md` (D31). A spine assertion requires at least one `release-*` fixture whose version is below `package.json`'s.

### D25. The skew harness test runs only where an old CLI exists

`test/helpers/ship-harness.mjs` lets `runShip` take `opts.cliBin`, defaulting to `INTERLOCK_BIN` (`lib/host.mjs:38`). `runCli` gains the same option.

`test/workflows.test.mjs` adds a case that reads `process.env.INTERLOCK_HARNESS_BIN`. Without it, the case skips with the reason `INTERLOCK_HARNESS_BIN unset — the previous release's CLI is installed only in CI's upgrade-install job`. With it, the case asks that CLI for `--version`, runs the current `ship.js` against it with the working tree as the plugin root, and asserts that the run closes. It also asserts the banner that matches what the CLI reported:

- no version (a CLI from before version reporting): the close carries `CLI VERSION UNKNOWN` (D18), and no `CLI VERSION SKEW`;
- a version other than the plugin's: the close carries `CLI VERSION SKEW` naming both versions, and no `CLI VERSION UNKNOWN`;
- the plugin's own version (the window right after a release): neither banner.

Asserting only `CLI VERSION UNKNOWN` held until the first version-reporting release was published, and failed for good after it. The job runs the case by its exact title (`SKEW_CASE`) and fails unless that case's own `ok` line is in the TAP output. A name pattern that matches nothing exits 0, so a renamed case would otherwise run nothing and pass. `test/spine/github-workflows.test.mjs` pins the title to a case that exists.

### D26. Out of scope: graph `path`/`explain` exit codes

`path` with unresolvable endpoints and `explain` with no match exit 0, while `query` exits 1 (`lib/graph/cli.mjs:270-273`). This is an inconsistency, not an upgrade break, and changing an exit code is itself a contract change. It is left for its own change.

### D27. The canary has no write token; its failure is the signal

`.github/workflows/canary.yml` runs daily and on `workflow_dispatch`, with a top-level read-only token (`contents: read`). It:

- installs the newest Claude Code (unpinned on purpose: the engine moving is what it watches);
- fetches the `release` branch into a directory;
- runs `claude plugin validate <dir> --strict` and `claude plugin test <dir>`;
- installs the bundle's `package.json`-declared bins into a prefix with `npm install -g <dir> --prefix`;
- runs `interlock doctor --json` (with `CLAUDE_PLUGIN_ROOT` set to the bundle) and the smoke (D21).

The module tests, the smoke script and its fixtures come from the tag the bundle was cut from (`v<bundle version>`), not from `main`. `main`'s inventory and module tests describe commands and rows the shipped release does not have yet. Run against the 1.7.0 bundle, they failed 9 of 71 smoke commands and 2 module tests, and the 1.7.0 doctor has no `cli-version` row. So the canary was red every day until the next release, and again whenever `main` added an inventory entry, and a real engine break would have looked the same. A bundle at or below 1.7.0 predates the `cli-version` row and the smoke script. For such a bundle the canary skips those two steps and writes the reason into the run summary. The job has a timeout.

A failed scheduled run notifies the repository owner through GitHub's own scheduled-workflow notifications. Opening an issue would need `issues: write`, and the trust test allows exactly one write-capable job (`test/spine/github-workflows.test.mjs:112-131`).

### D28. The engine floor is read from the module, not restated

`validate-plugin` becomes a matrix over `engine: [latest, floor]`. The floor step resolves the version with `node -e` importing `MODS_MIN_HOST_VERSION` from `lib/host/claude-env.mjs:39` (today 2.1.287) and installs `@anthropic-ai/claude-code@<that>`. A test asserts that the workflow reads the constant and spells no version.

If `claude plugin test` does not exist at the floor engine, the floor leg runs `validate --strict` only. Its step summary then says `plugin test is not available at the floor engine <v>; mod tests are covered on latest only`. The implementer verifies this with a local prefix install before choosing. The prose-only workflow floor (2.1.154, `README.md:8`) is not touched.

### D29. Node 24 joins the matrix; one macOS smoke

The `test` matrix becomes `['18','20','22','24']`. `cli-smoke` gains `strategy.matrix.os: [ubuntu-latest, macos-latest]`.

Required checks are ruleset settings (review §1, Protect row) that live on GitHub. The `main: required CI` ruleset requires the bare names `validate-plugin` and `cli-smoke`, and a matrix leg reports as `validate-plugin (latest)`, `cli-smoke (macos-latest)` and so on. Turning both jobs into matrices therefore left two required checks with nothing to report them, and every pull request was blocked with every check green.

Two gate jobs now report those names: `validate-plugin-gate` (named `validate-plugin`) and `cli-smoke-gate` (named `cli-smoke`). Each needs its matrix, runs on `always()`, and passes only when the matrix result is `success`. A skipped required check reads as passing, so a gate must never skip. As a result, the floor-engine leg and the macOS leg block a merge through their gates. `test (24)` and `upgrade-install` still block nothing until the owner adds them to the ruleset. `test/spine/github-workflows.test.mjs` mirrors the ruleset's list and fails when a required name is reported by no job.

### D30. `--grade-root` grades an interactive run in place

`evals/ship/run.mjs` gains this form:

`--grade-root <dir> --change <name> --baseline-commit <sha> --fixture-id <id> [--run-id <id>] [--baseline-counts <file>] [--history-root <dir>] [--no-history] [--json]`

It runs `gradeArm` (`evals/ship/graders.mjs:642-717`) with arm `loop` against the given root. `--run-id` defaults to the newest trajectory under that root's state home. It then appends through `appendShipOutcome` (`lib/eval-history.mjs:179-254`) with these values:

| Field | Value |
|---|---|
| `host` | the receipt's host (`workflow` for `/interlock:ship`) |
| `version` | the run's recorded `plugin.version` (D17), falling back to `cli.version`, and refusing to append when neither exists |
| `model` | the receipt's model when recorded, otherwise `unknown` |
| `evalAgent` | `interactive-session` |
| `fixture` | `--fixture-id` |

Without `--baseline-counts`, the not-weakened criterion is recorded `unobserved` with its reason, never as met (`evals/outcome-run` "never fabricates a measurement"). The form spawns no agent and needs no credential. `evals/history/README.md` gains the row's provenance and the rule that a maintainer commits the rows they keep.

### D31. Where the procedure and the upgrade notes live

**`docs/16-upgrading.md` is for users.** It covers:

- what persists under `.claude/ship/` and `.claude/graph/`;
- what a resume across versions does: reuse or a named rebuild, closed runs refused, foreign tags named, the clean-closed 1.7.0 gap from D15;
- how to see both versions (`interlock --version`, `interlock doctor`'s `cli-version` row);
- how to keep an `npm i -g` copy in step with the plugin.

**`CONTRIBUTING.md` § Releasing is for maintainers.** It covers:

- the CHANGELOG `### Upgrading` rule (D3);
- re-cutting `release-<prev>` at each bump (D24);
- review §8's local regression run, pre-tag advisory and post-bundle authoritative, graded with `--grade-root` (D30), compared on the invariants §8 lists.

`README.md:71` and `docs/07-cli-and-configuration.md:9-15` gain one sentence each: keep the npm copy at the plugin's version, and `doctor` says when it is not.

### D32. Task shape: TDD

The change is mostly defect repairs and pass/fail cores: argument refusal, skew comparison, manifest and trajectory classification, graph staleness. Each one can be pinned by a test before the code exists, and every defect needs its repro first anyway.

Section 1 is therefore the failing-test wave. CI configuration and docs are plumbing, so their pins sit in the sections that write them.

### D33. The semver test's parse

`test/spine/changelog.test.mjs` splits on `^## ` headings and reads the version with `/^\[?(\d+\.\d+\.\d+)\]?/`. It compares versions numerically, never as strings. The breaking marker is matched with `/\bbreaking\b/i` inside bullet or blockquote lines, not inside headings. `### Upgrading` is matched as a heading line within the section.

### D34. Stale "gitignored" comments go with the files this change edits

`evals.yml:22` and `ship-outcome-eval.yml:31` say `.github/workflows/` is gitignored. Only `copilot-setup-steps.yml` is ignored (`.gitignore:43`). Both comments are corrected in the same edits as D2. `test/spine/package.test.mjs:643` and `test/spine/ship-outcome-eval.test.mjs:541-552` carry the same stale comment and assertion message; only the message text is corrected, and the assertions are unchanged.

### D35. Release bookkeeping

The change writes its `CHANGELOG.md` `## [Unreleased]` entries: Added, Changed and Fixed, with two **BREAKING** bullets (D6, D2) and the `### Upgrading` subsection D3 requires. It does not bump versions; `bump-release` does that, and it must choose a minor (1.8.0) because the section carries breaking entries.

### D36. A manifest field written by an earlier release's start is defaulted out loud

Two manifest fields take a silent default when a manifest predates them:

- `verifyBudget`: `lib/run.mjs:1478-1480` says it "says nothing about its absence".
- `stateHome`: `stateHomeOf`, `:1080-1082`.

The first `run` subcommand after `run start` that reads a manifest missing either field raises `MANIFEST FIELD DEFAULTED: <field> absent (written by an earlier release); using <default>`. It records the field in a `defaultedFields` list on the manifest, so each field is raised once per run.

`startSha` already has its banner (`REVIEW BASE NOT PINNED`) and is unchanged. `stateHomeOf` stays a pure accessor; the check sits where the subcommand loads the manifest. This makes review §5a's first upgrade test ("the banners name what was lost") assertable.

## Risks / Trade-offs

- **[A test that runs the doctor depends on the developer's `PATH`]** → With D5, an older global `interlock` turns `ok` into `fail` on one machine and not on CI. Every test that runs the doctor, directly or through the preflight hook, passes an explicit `PATH` whose `interlock` is the working tree's `bin/` or absent.

- **[A valid flag missing from the table refuses a real invocation]** → The union, usage and shipped-form tests (D7, D22) cover every read, documented and shipped flag. The refusal names the flag and the CLI version, so a miss is one reported line, not a silent drop.
- **[The skew row fails the preflight for every user with an older `npm i -g` copy]** → That is the intent: it is the configuration that drops a review blocker. The fix line names the exact install command, and the hook still exits 0 (fail open).
- **[Removing `classified.json` at start breaks a host that writes it before `run start`]** → Only the harness does (D10). The runner host and the outcome eval's agent write it during the classify step. The change moves the harness.
- **[The release fixture records absolute paths]** → It is tokenised at cut and substituted at test (D24). A fixture that still contains a scratch path fails its own test.
- **[The engine-floor leg fails on a manifest field newer than 2.1.287]** → That is a real finding: users on the floor engine are broken. It is surfaced, not suppressed.
- **[Dropping the cron hides that evals exist]** → `docs/14-evals.md` and the workflow comments say why there is no schedule and that re-adding it records the credential.
- **[`npm test` grows by the smoke's ~4 s]** → Accepted. The smoke against `bin/` is the local copy of the gate that would otherwise exist only in CI.
- **[`run next` on a clean-closed 1.7.0 manifest is still stepped]** → Accepted and documented (D15). The window closes with the first 1.8.0 close in each root.

## Rollout

Ordinary merge. The floor-engine and macOS legs block through the `validate-plugin` and `cli-smoke` gates (D29). `test (24)`, `upgrade-install` and the canary start on merge and block nothing until the owner adds them to the `main` ruleset. That is a follow-up action, named in the PR description. The first release after merge is 1.8.0 (D35). The release fixture for 1.8.0 is cut at that bump (D24). Rollback is a revert: no persisted format changes tag, and the manifest, step and graph-manifest additions are fields that older readers ignore.

## Open Questions

- Does `claude plugin test` exist at 2.1.287? It decides only the floor leg's second step (D28), and the task verifies it before writing the job.
