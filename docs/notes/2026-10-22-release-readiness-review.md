# Release readiness: can an engineer pull the next release without breaking their Interlock?

22 October 2026, against `main` at `b4595b5` (1.7.0 plus four commits). A review of the release process, the test suite, the review and eval suites, and the GitHub Actions, answering one question: **do they tell us, before a tag is pushed, that an existing engineer who updates will not be broken?** Every number below was measured in this session; every claim cites a file or a command.

## Verdict

1. **The deterministic spine is well covered and the release mechanics are hardened. Neither is where users break.** `npm test` runs 3,967 tests across 103 files in about 2.5 minutes, CI runs them on Node 18, 20 and 22, packs the tarball, installs it into a throwaway prefix and runs every binary. The release path (tag → npm with provenance → `release` branch mirror) is integrity-checked end to end. All of it passed on every one of the last 14 releases, and 7 of those 14 releases were patches shipped within 24 hours of the minor they fixed.
2. **Every model-backed check has produced zero signal since it was created.** The PR smoke evals, the weekly full evals and the weekly ship outcome eval all run green, and each one skips its metered steps at "Check for model credential" because the repository has no `ANTHROPIC_API_KEY` secret (`gh secret list` is empty). `evals/history/` holds a README and nothing else. The "review suite" for the model-facing surface is, in practice, the token pins in `test/skills.test.mjs`.
3. **The supported user path is never executed before a release.** `/interlock:ship` on the Workflow runtime with a real model, `interlock doctor` from an installed plugin, a resume of a run written by the previous release, a CLI one version behind the skills: none of these is run anywhere in CI. The regressions users hit (below) are all in that gap, and this review found two more live in 1.7.0: the recovery command the halt card prints does not run (§5c, G10), and a 1.6.0 skill against a 1.5.1 CLI silently drops a review blocker (§5b).
4. **The skills and the CLI can run at different versions on one machine, and nothing notices.** The skills, `workflows/ship.js`, the hooks and the agents call bare `interlock` from `PATH`, not the plugin's own `bin/`. On this machine the session-start preflight recorded `plugin 1.6.3` while the checkout is 1.7.0. There is no `interlock --version`.
5. **What to do** is cheap and mostly model-free: a post-install smoke over the commands the skills and driver actually call, an upgrade-fixture test, a version-skew banner in `doctor`, a daily canary that installs the shipped bundle under the current Claude Code, and for the model-backed half either one provisioned API key or, as the owner proposed on 2026-10-22, a local regression run of the real `/interlock:ship` on the demo fixture, graded with the outcome eval's own graders (§8). Details in §6, §7 and §8.

## 1. What a release is today

| Step | Mechanism | Checked by |
|---|---|---|
| Bump | `bump-release` user skill: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` in lockstep; commit; annotated tag; `gh release create` with notes from `git log` | `test/spine/package.test.mjs:218` (one version across the three manifests) |
| Publish | `.github/workflows/release.yml` on `v*` tag: `npm test`, then `npm publish --provenance` via OIDC trusted publishing; `npm@12.2.0` pinned | `test/spine/github-workflows.test.mjs` (no floating installs in a job with a write token) |
| Mirror | `.github/workflows/plugin-bundle.yml` on a successful Release run from this repo's `release.yml` on a `push`: fetch the tarball **from the registry**, check `plugin.json` version, `claude plugin validate --strict` the unpacked tarball, hand the bytes to a second job that re-hashes them and commits them to the `release` branch | `github-workflows.test.mjs:69,91,112,133` |
| Install | Plugin users: `/plugin marketplace add renzrollon/interlock` then `/plugin install interlock@interlock`, which reads the `release` branch (`marketplace.json` `ref: release`). CLI users: `npm i -g @renzrollon/interlock` | `ci.yml` `cli-smoke` packs and installs the tarball from the checkout |
| Protect | Rulesets since 2026-10-22: `main` requires `test (18)`, `test (20)`, `test (22)`, `validate-plugin`, `cli-smoke`, `Outcome eval prepare (model-free)`; `release` and `v*` tags cannot be force-pushed or deleted | live settings, read with `gh api repos/…/rules/branches/main` |

The `release` branch currently holds 1.7.0, the same version npm serves as `latest`. The mirror has succeeded on every release since 1.5.0.

**Cadence.** Fourteen tags between 6 and 21 October. Patch releases and the gap from the minor they fixed:

| Minor | Patch | Gap | What the patch fixed (CHANGELOG) |
|---|---|---|---|
| 1.2.0 | 1.2.1 | same day | listing image and ntfy options; the meter's quiet-time read (a paused run looked like a hang) |
| 1.3.0 | 1.3.1 | same day | the meter pane's wave cards; listing image moved out of the manifest folder |
| 1.4.0 | 1.4.1, 1.4.2 | same day, next day | meter timeline; a run resumed across the 1.4.0 upgrade; a plugin install opened every session with a preflight warning |
| 1.5.0 | 1.5.1 | 2.5 h | docs corrections (what the one network call sends) |
| 1.6.0 | 1.6.1, 1.6.2, 1.6.3 | 22 h, 31 h, 6 d | relay recorded the previous batch's results; transport failures halted runs; missing `openspec` not named; halt card held the session-start band |

Every one of those tags had green CI. The patches fixed things only a live session shows: a relay copying stdout, a hook drawing at session start, the openspec CLI absent, a plugin install warning. That is the class of defect the current gates cannot see.

## 2. The test suite

**What it is.** `npm test` = `node --test` over a `find`-piped list of `test/**/*.test.mjs`. Measured in this session on Node 24.16.0:

| | |
|---|---|
| test files | 103 (`.test.mjs`) + 4 (`.test.ts`, engine kit) |
| tests | 3,967 run, 3,957 pass, 10 skipped, 0 fail |
| wall time, local | 158 s |
| wall time, CI per Node version | about 5 min 20 s |
| lines of test code | 69,104 |
| engine kit (`claude plugin test .`) | 120 tests, 4 files, 3.3 s, under Claude Code 2.1.307 |

The 10 skips are deliberate and spoken: 6 relay/notify tests skip when loopback binding is denied (this sandbox), 3 live-host tests skip unless `INTERLOCK_LIVE_HOSTS` names a CLI, 1 live ACP test skips unless `INTERLOCK_ACP_COMMAND` is set. In CI none of them skip for the sandbox reason, but the live-host ones always skip there too: **no CI run has ever exercised a real vendor CLI.**

**What it proves well.**

- The run program as a state machine: `test/spine/run.test.mjs` (253 tests) and `test/spine/cli.test.mjs` (227 tests, spawning `bin/interlock` as a subprocess with `spawnSync`) cover steps, halts, relays, exit codes.
- The ship driver, executed rather than grepped: `test/helpers/ship-harness.mjs` evaluates `workflows/ship.js` with stubbed agents and **the real CLI** against a temp repository, so a coercion bug that drops an instruction from an assembled briefing is caught (`test/workflows.test.mjs`, 214 tests).
- Packaging: `package.test.mjs` walks the import graph of every binary and of the hooks module and fails if a reachable file is outside the `files` whitelist (the class of bug that installs cleanly and dies at first use).
- Fail-open guards: `test/hooks.test.mjs` (96 tests) spawns each hook with captured payloads.
- Prose that must keep running: `test/skills.test.mjs` (58 tests) pins tokens in every `SKILL.md`; `test/spine/mod-pins.test.mjs` (30 tests) pins what the hooks module may import and call.
- CI configuration itself: `test/spine/github-workflows.test.mjs` (5 tests, added 2026-10-22) holds every tracked workflow to the trust rules.

**What it cannot prove, by construction.** The repo's own `docs/14-evals.md` says it plainly in its "four layers" table: unit tests prove "policy, CLI exit codes, schema, isolation, fail-open" and not "that a model followed an instruction". Beyond that, three things are outside the suite even on its own terms:

- **The installed artefact.** Every test runs against the checkout. Only `ci.yml` `cli-smoke` touches the packed tarball, and it runs `--help` on each binary plus `interlock limits`.
- **The previous release's state.** Nothing installs release N‑1, writes a run, and resumes it under N. The one committed older run (`test/fixtures/ship/halted-run-6e9d0b02/`) is used by the draw and report tests, not as an upgrade fixture. (Agent audit below.)
- **The engine.** The hooks module (`hooks/mod.mjs`) runs inside Claude Code's mod runtime (2.1.287+). `claude plugin test` runs under whatever `npm install -g @anthropic-ai/claude-code` resolves on the day. Claude Code 2.1.289 broke `claude plugin validate --strict` for this repo once already (CHANGELOG 1.6.0 "Fixed"), and users auto-update the engine on their own schedule.

Two small oddities found while measuring: `node bin/interlock --version` prints `Unknown command: undefined`, and `node bin/interlock doctor --help` runs the doctor instead of printing help. The CI smoke runs `--help` on every bin and asserts only the exit code, so it would not notice either.

## 3. The review suite

Three distinct things carry the word "review" here.

**The in-repo review gate for Interlock's own PRs.** `REVIEW.md` names the owner, three repo-specific "Important" classes (a guard that fails closed, a threshold restated in prose, a silent fallback) and two fixture exclusions; `/interlock:review-code` runs seven dimensions (`skills/review-code/dimensions/`: architecture, devops, domain, language, qa, security, technical-lead) then two skeptics, and `interlock gate` decides. CONTRIBUTING requires an OpenSpec change on every PR. The 2026-10-22 note `docs/notes/2026-10-22-ci-trust-review-lessons.md` records that this gate scored the `workflow_run` rollback at 6/10 and missed the inert ruleset entirely; the devops rubric gained a CI checklist the same day. This gate reviews *diffs*; it has no view of "does the shipped plugin still work for an upgrading user".

**The model evals** (`evals/`, 21 `case.yaml` cases, run by `claude plugin eval`; `evals.yml` smoke subset on PRs touching `skills/`, `shared/`, `agents/`, `workflows/`, `plugin.json`; full suite Mondays). **Status: never executed.** Step conclusions from the latest runs, read with `gh api …/actions/runs/<id>/jobs`:

| Run | Check for model credential | Run evals | Triage |
|---|---|---|---|
| PR smoke, 2026-10-21 (`feat/checkpoint-advisor`) | success | skipped | skipped |
| Full suite, scheduled 2026-10-19 | success | skipped | skipped |
| Ship outcome eval, scheduled 2026-10-21 (and every weekly run back to 2026-09-09) | success | skipped | skipped |

`gh secret list` returns nothing, so there is no `ANTHROPIC_API_KEY` for the jobs to find. The workflow's design treats "no credential → skip, reported in the step summary" as correct for a job that produces no signal without a model, and the job summary does say so. But the net effect is a green check beside every PR that touched a skill since the workflow landed, and `interlock evals promote` reporting "insufficient history" forever. The posture is advisory by decision, and it will stay advisory until something runs.

**The outcome eval** (`evals/ship/run.mjs`): copies a committed fixture out of the repo, runs the real ship loop on the ACP host with the committed stdlib agent against a real model, grades the outcome with CLI decisions only. This is the closest thing the repository has to "does a release still ship a change", and it has the same empty credential. Its model-free half (`--prepare-only`) runs on every PR and is a required check.

## 4. GitHub Actions, job by job

| Workflow · job | Trigger | Proves | Does not prove |
|---|---|---|---|
| CI · `test (18/20/22)` | push main, PR | the suite is green on the three supported majors | Node 24 (what this machine and the test profile's own notes run); macOS or Windows paths |
| CI · `validate-plugin` | same | `claude plugin validate --strict` and `claude plugin test` pass under today's latest Claude Code | the same under the minimum engine the doctor names (2.1.287) or under a user's pinned older engine |
| CI · `cli-smoke` | same | `surface`, `gate`, `waves`, `interlock-graph build` from the checkout; tarball installs; every bin answers `--help`; `interlock limits` runs | any other subcommand from the installed tarball; `doctor`, `run start`, `validate`, `conformance`, `merge-confidence`, `report`, `notify` |
| CI · `outcome-prepare` | same | the three outcome fixtures copy and isolate | the loop ships them |
| Evals · smoke / full | PR on model-facing paths; Mondays | nothing yet (no credential) | — |
| Ship outcome eval | Wednesdays | nothing yet (no credential) | — |
| Release · `publish` | `v*` tag | `npm test` green at the tag; publish with provenance | `cli-smoke`/`validate-plugin` at the tag (only `main` requires them; a tag on a non-main commit publishes with tests alone) |
| Plugin bundle · `validate` + `bundle` | after Release | the registry's bytes validate as a plugin and reach `release` unchanged | the bundle loads and runs inside a Claude Code session |
| Pages | site changes, after Release | the site deploys | — |

Total CI latency for a PR is about 5.5 minutes, bounded by the test matrix. Nothing in the set runs after the release lands to confirm what users now install actually works, and nothing runs on a schedule that would catch an engine update breaking the shipped bundle between releases.

## 5. Will an engineer who updates be broken? The gaps

The honest answer today: **the gates establish that the code is internally consistent and that the tarball is complete. They do not establish that an upgrade is safe.** Concretely:

**G1 — No release is ever exercised on the path users take.** The supported path is `/interlock:ship` on the Workflow runtime inside an interactive Claude Code session. The harness proves the driver under stubbed agents; the outcome eval proves the ACP host; neither runs the Workflow host, and the outcome eval has never run. The 1.6.0 → 1.6.1 relay bug (a relay that ran its command before writing its input recorded the previous batch's results) lived exactly there.

**G2 — No test resumes the previous release's on-disk state.** Seventeen schema-tagged formats plus a dozen untagged files under `.claude/ship/` are written by one release and read by the next. Only the plan format (`/5`) has ever actually moved; the refusal paths behind the other tags have never met a real older file. Probing them found: a leftover `classified.json` is planned from with no banner; a rebuilt plan is named only at close; a foreign manifest tag halts with a false "reached without `run start`" and leaves the stage marker; an old graph is never seen as stale; a mistyped `profile.json` passes `doctor` and kills a run mid-batch with the wrong halt reason. See §5a.

**G3 — Skills and CLI can skew.** `workflows/ship.js:451` builds `interlock <argv> --json` for a relay to run through Bash; skills say `interlock …`; `hooks/preflight.mjs:59-63` prefers the bundled binary only for its own doctor call. Which `interlock` runs is decided by `PATH` order: an `npm i -g` copy, a user shim, or the plugin cache. This session's startup preflight (`.claude/ship/preflight.json`) says `plugin 1.6.3`; `node bin/interlock doctor` says `plugin 1.7.0`; both are true at once. A subcommand added in 1.7.0 and called by a 1.7.0 skill fails on a 1.6.3 CLI with "Unknown command"; a flag added in 1.6.0 and passed to a 1.5.1 CLI is silently ignored, and in one case (`review --base`) the silence reopens a gate loophole. Nothing names the skew. See §5b.

**G4 — The model-facing surface is unmeasured.** Reworded skill prose is a behaviour change (`CLAUDE.md`), the token pins guarantee the words are present, and the evals that would show whether a model still follows them have never run. A release can change what `/interlock:spec` or `/interlock:ship` does for every user with no signal other than the next bug report.

**G5 — Engine drift is one-sided.** CI validates and runs the mod tests against the newest Claude Code only, on the day of the run. A user on an older engine, or an engine update that lands between two Interlock releases, is uncovered. `validate --strict` has already broken once on an engine bump; the hooks module's observe-only surface (`mod-pins.test.mjs`) is the kind of thing an engine minor can change.

**G6 — Semver is not what the CHANGELOG says it is.** 1.6.1 (a patch) carries "BREAKING: an inter-wave check never halts the run" and removes a halt kind; 1.6.0 carries "BREAKING: a strict run's review that leaves no findings list is not a clean review"; 1.5.0 changed the recorded outcome of a rejected handoff ("Breaking, for the recorded outcome"). A reader or script keyed on those values broke on a patch. There is no "Upgrading" section anywhere in `docs/` or `README.md`.

**G7 — The CLI's own command surface is untested from the installed artefact and has no version.** `--help` exit codes are the only post-install assertion; `interlock --version` does not exist, so neither a user nor `doctor` can say which CLI a session is running. See §5c for which subcommands the shipped surfaces call that no subprocess test spawns.

**G8 — Platform matrix is Linux-only while users are on macOS.** `lib/state-home.mjs` already carries a macOS-specific realpath rule; the guards resolve paths; the shim and `PATH` behaviours above are shell-dependent. One `macos-latest` job would cost about five minutes.

**G9 — Monitoring after release is the npm downloads badge and GitHub issues.** By design there is no telemetry (`interlock report` reads local corpora only). That is the right design, but it means the only "monitor" is a human running the plugin. There is a demo repository (kettle) that already serves as a dogfood target; nothing in the release procedure says to ship something there before or after a tag.

**G10 — A documented recovery path shipped broken, and CI is green.** After any halt, the resume card the preflight shows at session start tells the operator to run `interlock tasks tick <change> --ids …`. That form exits 1 with `change "tick" not found` because `requestedName` reads the subcommand word as the change (`bin/interlock:2290-2293`); only `--change <name>` works, and only that form is tested. 1.7.0 ships it. It is the cleanest single example of the gap: the card's text is pinned by a test, the lib is tested, the command as a user types it is not.

### 5a. Persisted state across an upgrade (agent audit)

**How often the formats have moved.** `ship-plan` went /2 (0.1.1) → /3 (0.3.0) → /4 (1.1.1) → /5 (1.2.0, `98c2fdb`) and has not moved since; `outcome` has been /2 since 0.1.1; every other tag is still at /1 from the day it was introduced. So only the plan-format and outcome branches have ever met a real older file. The refusal paths behind the other fifteen tags have never run against a real release.

**Per-format behaviour** (probed with HEAD `node bin/interlock` against copies of the committed fixture and against CLIs extracted with `git archive v1.1.0` and `git archive v1.6.0`):

| File / format | Writer → reader | Older input | Newer or unknown tag | Pinned? |
|---|---|---|---|---|
| `.claude/ship/run.json`, `interlock.run/1` | `writeManifest` `lib/run.mjs:250` → `readManifest` `:262-269`, plus raw reads in `hooks/recorder.mjs:65`, `hooks/guard-tests.mjs:55` | per-field defaults. Missing `startSha` → `REVIEW BASE NOT PINNED` banner; missing `verifyBudget` → default, **silently** (`:1478-1480` says so); `stateHomeOf` `:1081` falls back to root silently | any other tag reads as **no manifest**: `run next` halts "reached without `interlock run start`" (`:4441-4452`); `run close` says "nothing was recorded" (`:4764-4777`), writes no receipt, no terminal event, and leaves the stage marker. Probed: the message is wrong | old fields yes (`run.test.mjs:1697,4428,6463`); foreign tag **none** |
| step stdout, `last-step.json`, `last-close.json`, `interlock.run-step/1` | `makeStep` `:1215-1221` → `ship.js:404` (`action` only), `interlock-run:432-446` (bare `JSON.parse`), `hooks/mod.mjs:1037` | a step with no `seq` (≤1.6.0) disables recovery, tolerated | accepted silently; no driver checks the tag | stamping yes (`run.test.mjs:3390`); foreign tag none |
| `plan.json` + `plan-fingerprint.json`, `interlock.ship-plan/5` | `:3551,3559` → `checkPlanReuse` `lib/plan-fingerprint.mjs:333-447` | named rebuild `plan-format-changed` (`:388-396`). Probed with a v1.1.0 `/3` plan: `run start` → `classify`. The reason is printed **only at close** (`lib/receipt.mjs:427-428`); the start step has no banner | same branch, named | tag-only mutations (`plan-fingerprint.test.mjs:244,261,555,742`); no real N‑1 plan |
| `.claude/ship/state.json` (no tag) | `writeState` `:2558` → `readState` `:2554`; `requireState` `lib/waves.mjs:1853` throws if `waves` or `cursor` is missing | field defaults (`mode`, `laneCaps`, `skippedDependents`, …). Probed: a v1.6.0-started run continued and closed under HEAD | unknown fields ignored silently | `waves.test.mjs:2039,…,4142` |
| `.claude/ship/runs/<id>.jsonl`, `interlock.ship-run/1` | `lib/run-log.mjs:774` → `:851,940,1191`, `report.mjs`; **none reads `schema`** | unknown event types skipped (`:64-66`) | read as /1 silently | `run-log.test.mjs:1493,1744` |
| `outcomes.jsonl` `/2`, `metrics/*.json` `/1`, resume card `/1`, `preflight.json` `/1`, `agent-usage` `/1`, `interrupted` `/1`, `launch-ledger` `/1`, `merge-confidence.json` `/1`, `coverage-baseline.json` `/1`, handoff packet `/1`, eval history `/1` | various | n/a (never moved) | all **named**: "not counted (schema X)", `unreadable`, `{problem}`, "ignored — allowing", "refused", `die`, `HANDOFF REJECTED`, `unrecognized`. Exception: `AGENT USAGE UNREADABLE` is a note, not a banner (`run.mjs:5250-5252`) | yes, each |
| `classified.json` (no tag) | the planner agent → `runClassified` `:3487-3499` | tolerated | **nothing clears it at `run start`** (the only `rmSync` calls are `:1947,2532`); see hazard 1 | none |
| `batch-*.json`, `spawn-*.json`, `run-start.json`, `outcome.json` | nothing current | orphans from pre‑1.0 drivers, never swept (this checkout has a `batch-0.json` from 7 September) | — | — |
| `<change>/stage.json` marker | agents → `lib/ship-stage.mjs:164-198` → guards | unchanged since 1.0.0 | unknown stage reads `unknown`, guard allows silently (by policy) | `ship-stage-drift.test.mjs:94` |
| `.claude/testing/profile.json` (`"version": 1`) | `/fix-tests` → `validateProfile` `lib/verify.mjs:131-161`; `doctor` `lib/doctor.mjs:642-673` | `version` checked only to be an integer (`:137`), never compared; doctor checks only `unit.command` | unknown keys ignored; a wrong type **throws** mid-run (hazard 5) | none for version |
| `.claude/autonomy.json` (no tag) | `lib/autonomy.mjs:47-50` → `:38-44` | a parse failure becomes `{}` and the next save **overwrites the file silently** | same | none |
| `.claude/graph/graph.json` + `manifest.json` (`schema_version: 1`) | `lib/graph/build.mjs:380-389` → `update.mjs:23-80`, `drift.mjs`, `merge-evidence.mjs:213`, `run.mjs:3196` (existence only) | `schema_version` and `extractor` are written and **read by nobody** (`cli.mjs:204,254` print them). Probed: a v1.1.0 graph → `update` prints "Graph up to date" | same | `build-query.test.mjs:91` pins only the unchanged case |
| `REVIEW.md` (untagged) | a human → `lib/review-core.mjs:624-720` | — | unknown `##` sections ignored "so the format can grow" (`:661-662`). A ≤1.5.x CLI drops `## Always Human Review` and reads `- src/**` as a literal path, silently | none cross-version |

`hooks/mod.mjs` reads exactly two files: `preflight.json` (`:1269`) and the resume card the report names (`:1346`). The committed halted fixture `test/fixtures/ship/halted-run-6e9d0b02/` is a byte copy of a pre‑1.0 run (7 September); four tests read it, all to draw (`draw-plan`, `draw-run`, `plan-summary`, `cli.test.mjs:2770`). No test feeds it to `run start`. Under HEAD it would be rebuilt as `no-fingerprint`, `wave-state next` returns `halt (task-failures)`, and `run-log check` reports it reconstructable.

**Top five upgrade hazards**, as probed:

1. **A leftover `classified.json` from the earlier release is planned from with no banner.** When the planner spawn returns nothing, `workflows/ship.js:593-599` still calls `run classified`; `bin/interlock:4684-4689` reads `--classified` or the default path and `runClassified` takes whatever is on disk (`lib/run.mjs:3494`). Nothing deletes it at `run start`. Probed: HEAD over a v1.1.0 halted run's file, planner result `null`, went straight to `run-batch`. Untested.
2. **"Resuming" a halted N‑1 run is a restart that says so only at close.** Plan reuse names `plan-format-changed`, but on the receipt, not the start step. The old `state.json` (cursor, handoffs, failures, rejected reports) is replaced by `adoptPlan` (docs/04:63), so done-but-unticked work is dispatched again. Mid-run, missing manifest fields take silent defaults. **Latent:** the day `interlock.run/1` bumps, every in-flight run halts with the false "reached without `run start`" message, and the close records nothing and leaves the stage marker, the exact state the memory note about stale markers describes.
3. **No version handshake anywhere on the plugin → PATH CLI path** (detail in §5b). What holds today: every flag `ship.js` passes has existed since 1.0.0, the `{answers,value}` envelope is written only once the CLI emits `seq`, and a v1.6.0-started run closed cleanly under HEAD. `interlock-run` is immune because it pins its sibling binary (`lib/host.mjs:38,58-67`). A committed `REVIEW.md` is the real team-skew case.
4. **An older graph is never detected as stale.** `update` decides by source-file hash only (`update.mjs:23-71`); the OpenSpec and memory overlays are not hashed (`:47-51`). Probed: a v1.1.0-built graph → "Graph up to date"; editing a spec → still up to date with a now-wrong `implements_spec` link. The domain review and merge evidence select living specs from those links.
5. **An older or hand-edited `profile.json` passes `doctor`, then kills a run mid-batch with the wrong halt reason.** Probed with `"timeout_ms": "120000"` (a string): doctor `ok`; `run record-batch` ticks the task and advances the state, then throws inside `planVerification` with no stdout; `last-step.json` still holds the previous `seq`, so `ship.js:471` reads "the call did not take effect" and relays again; the run then halts "record-batch was called while the run state was at done". The real cause is on the first call's stderr, which the relay does not copy.

**Cheap upgrade-regression tests**, each reusing what exists:

1. **Two runs with a tampered middle.** `runShip({keepRepo:true})` then `runShip({repo:{reuseRoot}})` from `test/helpers/ship-harness.mjs` (`workflows.test.mjs:3009,3061` already reuse a root). Between them set `plan-fingerprint.json` `planFormat` to `/4` and assert `PLAN REBUILT (plan-format-changed)` plus `plan-waves` in `calls`; delete `startSha`, `testProfilePath`, `verifyBudget`, `seq` from `run.json` and assert the run closes and the banners name what was lost.
2. **A committed per-release snapshot** `test/fixtures/ship/release-<N‑1>/`, cut at bump time by driving the extracted old CLI (`git archive v<N‑1> bin lib` → `run start` → `run classified` → `record-batch` → `close --halt`; stdlib only, no git at test time since CI clones may lack tags). Under HEAD assert `run start` reuses or rebuilds under a named status, and `record-batch` continues the N‑1 manifest and state to a receipt. Treat `halted-run-6e9d0b02` the same way: `no-fingerprint`, replaced state, `halt` from `wave-state next`, reconstructable.
3. **Foreign tags are named.** `run.json` with `interlock.run/2` → the halt reason names the schema. A trajectory line with `ship-run/2` → named, not folded in. Both fail today.
4. **Stale classification.** `runShip` with planner response `null` and a leftover `classified.json` → a banner or a halt. Fails today.
5. **Doctor/validator parity.** For every invalid profile in the verify tests, doctor's `test-profile` row is not `ok`, or `record-batch` halts naming the profile.
6. **Graph staleness.** Rewrite `schema_version`/`extractor`, or edit a spec under `openspec/specs/`, then assert `interlock-graph update` rebuilds or says why (extends `build-query.test.mjs:91`).
7. **Skew.** Let the harness's `runCli` take a CLI path (`INTERLOCK_BIN` is fixed at `lib/host.mjs:38`), then run HEAD `ship.js` against the N‑1 snapshot CLI.

### 5b. Skill vs CLI version skew (agent audit)

**Mechanism.** No shipped surface calls `${CLAUDE_PLUGIN_ROOT}/bin/interlock`; the substitution is used only for `shared/*.md`, `workflows/ship.js`, the hook scripts and one helper script. Claude Code appends the plugin's `bin/` to the **end** of the session `PATH` (entry 35 of 35 here, after `~/.claude/bin`, the mise Node bin and Homebrew), so any `npm i -g @renzrollon/interlock` copy or user shim beats the plugin copy for every skill line and every ship relay (`workflows/ship.js:450-451`). The docs recommend exactly that setup: README.md:75 and docs/07:9-15 say to install the npm package "for your terminal too", and nothing says to keep the two in lockstep. The session-start preflight runs the **bundled** binary (`hooks/preflight.mjs:57-62,76`), so its report describes the plugin's CLI while the session uses another. `doctor`'s `plugin` row reads the `plugin.json` of whichever tree is running the doctor (`lib/doctor.mjs:85,507-541`; `bin/interlock:3584` passes no `pluginRoot`), its `binaries` row only asks whether the names resolve (`lib/doctor.mjs:551-571`), and the preflight file keeps the version only as prose (`hooks/preflight.mjs:122`). `interlock --version` and `interlock version` both exit 1 with "Unknown command"; `interlock-graph --version` exits 1; `interlock-run --version` exits 2.

**The CLI accepts any flag.** `parseArgs` (`bin/interlock:1273-1312`) stores an unknown `--x` and ignores it, and a non-boolean unknown flag swallows the next positional. Probed on 1.7.0: `gate … --bogus-flag` exits 0, `limits --bogus` exits 0, `run next --bogus --json` exits 0 and emits a step. Only an unknown *subcommand* fails (`Unknown command: <sub>`, usage on stderr, exit 1). So a plugin ahead of its CLI fails in two different ways: a new subcommand is refused loudly, a new flag on an old subcommand is dropped silently.

**Which shipped argv is version-sensitive.** Trees for v1.5.1 and v1.6.3 were extracted with `git archive` and each argv run from a scratch directory:

| Surface | argv | Needs | Older CLI does | Caller surfaces it? |
|---|---|---|---|---|
| `skills/spec/SKILL.md:254,260,268` | `advisor <c> --brief/--check … --json` | **1.7.0** | 1.6.3: exit 1, `Unknown command: advisor` | Partly: :271 reports the first output line and continues, so the consult is skipped; nothing says the CLI is too old |
| `skills/review-code/SKILL.md:149` | `note derive --findings … --json` | **1.7.0** | 1.6.3: exit 1, `Unknown command: note` | No: :152 handles only `COMPOUND NOTES NOT WRITTEN` |
| `skills/mr/SKILL.md:102-114` | `pipeline --github/--gitlab-mr/--gitlab …` | 1.6.0 | 1.5.1: exit 1 | Mostly: :121 reports stderr and skips the section |
| `skills/mr/SKILL.md:126,152,264,277` | `merge-confidence <c> --base --pipeline --run …` | 1.6.0 | 1.5.1: exit 1 | Partly: :277 pipes into `gh pr comment --body-file -`, which hides the exit status |
| `skills/review-code/SKILL.md:43` | `domain-context <c> --changed … --base b --json` | 1.6.0 | 1.5.1: exit 1 | No: :46 handles only `partial`, `skipped`, not-selected |
| `skills/review-code/SKILL.md:34` | `review-policy --base b --json` | 1.6.0 (`--base`) | 1.5.1: **exit 0**, `--base` silently ignored | No. Silent |
| `skills/review-code/SKILL.md:106` | `review --findings --verdicts --changed --base b --metrics c --json` | 1.6.0 (`--base`) | 1.5.1: **exit 0**, `--base` ignored, the working-tree `REVIEW.md` is applied: a blocker under a path the change itself added to `## Do Not Report` is **dropped** (surviving 0, droppedByPolicy 1) where 1.6.3 and 1.7.0 keep it. This is the loophole docs/07:176 says `--base` closes | No. Silent, and `gate` then passes |
| every other skill line (`validate`, `changes`, `ledger`, `drift`, `gate`, `autonomy`, `ready`, `surface`, `limits`, `report`, `evals`, `notify`, all `interlock-graph`) | | ≤ 0.3.0 | fine on any CLI ≥ 1.0 | |
| `workflows/ship.js:551-567,649-659` driver protocol | `run start … --host workflow --json`; `seq` and the `{answers,value}` results envelope; `last-close.json` | 1.6.1 (`seq`) | an older CLI sends no `seq`; the driver writes bare results and skips the recovery read (`ship.js:442-446,465`), which the CLI accepts (`lib/run.mjs:557-566`) | a failed `run start` halts as `RELAY UNREADABLE … 0 relayed chars … the CLI's own bytes are in .claude/ship/last-step.json` (`ship.js:479-490,604-635`). It reads as a relay failure, never as skew, and the named `last-step.json` may belong to an earlier run. The relay copies stdout only (`ship.js:362`), so `Unknown command` on stderr is lost |
| `lib/run.mjs` step `argv` and the briefings | `run classified/record-batch/judge/…`, `verify exec/plan/spill` | | emitted by the PATH CLI itself, so self-consistent | |
| `hooks/*.mjs` | none; they import `../lib` at plugin version and read state the PATH CLI writes | | an unknown stage reads as `unknown` and the guards allow (`lib/ship-stage.mjs:15-20,52,188`) | silent, by the fail-open policy |

The hazard is one-directional today (plugin ahead of CLI): no subcommand a skill calls was removed between 1.5.1 and 1.7.0.

**What the existing guards check.** `test/skills.test.mjs:118-131` matches `/interlock:<name>` slash references against skill names: no CLI subcommand, no flag. `test/workflows.test.mjs:82-111` matches `interlock <word>` in `ship.js` against `case '…':` in the same tree's `bin/interlock`: top-level names only, and a coherent tree always passes. `package.test.mjs:218` pins one version inside one tarball. Run records carry no CLI version: `newManifest` (`lib/run.mjs:285-310`) and the `run-start` event (`lib/run-log.mjs:479+`) record mode, session, state home and cwd, so a trajectory cannot say which loop produced it. Skills carry "command not found" guidance for `openspec` only.

**Fixes, cheapest first.**

1. **A skew row in the preflight and `doctor`** (about 30 lines, covers every past release because the preflight runs at plugin version). In `checkBinaries`, `realpath` each PATH hit and read the adjacent `package.json` (name `@renzrollon/interlock`; 1.6.3 resolves this way), fall back to `--version` for wrappers such as the shim, compare with `pluginRoot/.claude-plugin/plugin.json`, and banner `CLI VERSION SKEW: interlock on PATH is <x> (<path>), plugin is <y>` with the `npm i -g @renzrollon/interlock@<y>` fix. Use `fail` when the PATH copy is older, since the preflight prints only failures. Write the resolved paths and versions into `preflight.json`.
2. **`interlock --version` / `version [--json]`**, and the same on `interlock-graph` (a few lines each). A copy that answers "Unknown command: undefined" is itself dated as 1.7.0 or older.
3. **Record the CLI version in run records**: `cli: {version, path}` on `newManifest`, on `run-start`, and `cliVersion` on each step (`makeStep`, `lib/run.mjs:1220`). The ship skill already substitutes `${CLAUDE_PLUGIN_ROOT}` into Workflow args (`skills/ship/SKILL.md:48`); forward it as `--plugin-root` so the CLI banners a mismatch, and have the driver banner a `run start` step that carries no `cliVersion` (an older CLI ignores the flag).
4. **Probe before adopting: prepend the plugin's `bin/` to `PATH` from the SessionStart hook via `$CLAUDE_ENV_FILE`** (the mechanism exists in `hooks/notify-option.mjs:60-63`). Unverified whether workflow agents' Bash calls source that file; it overrides a deliberate npm-global choice; and the plugin-directory notes flag `$CLAUDE_ENV_FILE` use. Run `scripts/host-probe.mjs` first.
5. **A per-subcommand accepted-flag table** (the `KNOWN_FLAGS` refusal in `bin/interlock-run:175` is the pattern), so an unknown flag fails as `unknown flag --x for interlock <sub> (CLI <version>)` instead of the silent `review --base` drop. Cheap companion test: extract each `interlock <sub> …` segment from the skills up to the next pipe or backtick and assert every `--flag` is in the table and read by the handler. Protects future skews only; published CLIs stay permissive, so 1 and 3 are still needed.

**Do not move the skills to `${CLAUDE_PLUGIN_ROOT}/bin/interlock`.** The permission allowlist is keyed on the bare `interlock` prefix (`lib/doctor.mjs:192-194`), and the substituted path contains the version directory, so every update would invalidate the allow rules and an unattended run would stall on an approval prompt (docs/04:135). The meter recognises relays by a leading `interlock` token (`hooks/mod.mjs:860`). `ship.js` has no environment or filesystem, so the path would have to arrive through args.

**Two side findings from the probing.** `interlock run next` does not refuse a run whose manifest is already `halted`: run from this checkout it stepped the halted run `d7eda7dc` (change `add-checkpoint-advisor`, halted 2026-10-20), appending `seq 46` to its trajectory and rewriting `.claude/ship/run.json`, `last-step.json`, `vplan-final.json` and `briefings/verify.md`. All of it is gitignored, the manifest still carries its `halted` reason, no stage marker was written and `hooks/guard-commit.mjs` still allows a commit, so nothing in the working tree or the guards changed. The trajectory is append-only, so the row stays. A `run next` that refused a halted manifest, or required `--continue`, would close that.

### 5c. CLI subcommand coverage from the installed artefact (agent audit)

**The surface.** `bin/interlock` dispatches 34 top-level cases (`bin/interlock:3109-4846`) giving 75 leaf forms (`run` ×11, `verify` ×9, `wave-state` ×5, `run-log` ×5, `evals` ×4, `autonomy` ×4, `advisor` ×3, `note` ×3, plus 21 bare commands). `interlock-graph` has 11 commands (`lib/graph/cli.mjs:194-363`) and no `--json`. `interlock-run` refuses unknown flags with exit 2 (`bin/interlock-run:156-172`); `bin/interlock` never does (`parseArgs`, `:1273-1313`). `-h`/`--help` is honoured only as the first argument (`bin/interlock:3098`): `doctor --help` runs the doctor, `limits --help` prints the limits, `verify --help` says "unknown subcommand: (none)". `interlock-run -h` is parsed as a change named `-h`.

**The good news.** Every command `workflows/ship.js`, `bin/interlock-run` and the `then.argv` of the run steps call is spawned by a test as a subprocess with its JSON keys asserted: `run start` (`test/spine/run.test.mjs:197`), the 160 step dispatches (`run.test.mjs:200-252, 705-732`), `run close` (about 50 spawns), `verify exec/spill` (`cli.test.mjs:2721, 775`), `doctor` through the real hook (`hooks.test.mjs:518`), `limits`, `validate`, `gate`, `review`, `review-policy`, `domain-context`, `ready`, `ledger`, `advisor`, `drift`, `pipeline`, `merge-confidence`, `report`, `run-log`. The driver path is not where an untested command hides.

**Called by a shipped surface but not spawned by any test**, ranked by blast radius:

| # | Command | Called by | Coverage | What is wrong today |
|---|---|---|---|---|
| 1 | `tasks tick <change> --ids …` | the halt resume card (`lib/resume-card.mjs:246`), which the SessionStart preflight shows after every halt; `hooks/guard-tasks.mjs:100` names it too | the text is pinned (`resume-card.test.mjs:102`); only the `--change` form is ever executed (`cli.test.mjs:2224`) | **Broken.** `requestedName` reads `positional[1]`, which is the word `tick` (`bin/interlock:2290-2293`, used at `:4144,4167`), so the documented recovery after a halt exits 1 with `change "tick" not found`. Reproduced in this session. `tasks coverage <change>` has the same defect |
| 2 | `autonomy record` / `autonomy clean` | `skills/spec/SKILL.md:236,238,249`, `review-artifacts:125`, `review-code:145` | lib only (`autonomy.test.mjs`) | the CLI glue (state-home routing, `--blockers`, `--human-override`) is untested, and since flags are not checked, `--blocker 2` (a typo) records a **clean** run with exit 0 |
| 3 | `changes` | `dispatch:23`, `manual-test-plan:23`, `mr:59`, `review-code:23` | lib only (`artifacts.test.mjs:43`) | — |
| 4 | `surface` | `review-code:25`, `manual-test-plan:41`, `dimensions/devops.md:18`; CI `cli-smoke` | lib only; CI greps the pretty-printed JSON from the **checkout** bin | — |
| 5 | `interlock-graph which` (and the content of `path`, `explain`, `context`, `docs`) | `skills/graph:52` and the explore, explain-code, manual-test-plan, docs-digest skills | nothing spawns `which`; the others are spawned with only exit/stderr asserted | `path` with unresolvable endpoints and `explain` with no match exit 0 while `query` with no match exits 1 (`lib/graph/cli.mjs:272`) |
| 6 | `evals promote` | `evals.yml:131,138,220,227` takes the job's blocking posture from its exit code | lib only | directory read and unparseable-entry handling untested end to end |
| 7 | `limits --json` fields `smokeCostUsd`, `fullRunCostUsd`, `runsPerCase` | `evals.yml:98,184,187` | only `shipEvalCostUsd` is asserted from spawned JSON (`limits.test.mjs:449`); the reader sweep checks cap→reader, not reader→cap | a deleted cap with a surviving reader would pass |

Dead surface, not hazards: `run verify-final` (no caller, no test), `run next` (reachable only after a test nulls `lastThen`; the sequence guard at `lib/run.mjs:2576-2591` refuses it mid-run) and `evals calibrate`.

**What the `cli-smoke` tarball step proves.** `--help` on each of the four binaries does exit 0 and print real usage (1015, 39, 61 and 61 lines). Because ESM imports link before `main()` runs, that proves the bin map, the exec bits and that every **statically** imported module is in the tarball (`bin/interlock` has 63 import lines; `package.test.mjs:105` pins the same in unit form). It does not prove: files read at run time (`skills/review-code/dimensions/*.md` at `lib/run.mjs:1613`, the plugin files `doctor` checks at `lib/doctor.mjs:510-516`, the files `pluginRoot()` probes at `lib/host/claude-cli.mjs:101`), the hooks' dynamic imports (`hooks/preflight.mjs:185,230,256`), any subcommand's logic or JSON shape, any Node but 22, or the tag itself (`release.yml` runs only `npm test`; `plugin-bundle.yml` validates manifests and never executes a bin).

**A model-free post-install smoke exists as a prototype.** `/private/tmp/claude-501/-Users-caro-IdeaProjects-specflow/6bb2be0f-171f-4175-9601-46cfee26776d/scratchpad/postinstall-smoke.mjs` (79 lines, not in the repo) takes `<binDir> <repo> <scratch>`, builds a scratch git repository with one change and two commits, and runs **51 commands in 4.2 s: 50 pass, 1 fails** (the `tasks tick` positional above). Pointed at `$RUNNER_TEMP/prefix/bin` it covers the installed tarball. What it runs and asserts:

- every bin `--help` → 0, and `interlock --help` names `run start`, `doctor`, `merge-confidence`, `tasks tick`;
- `limits --json` → keys `limits.maxParallel`, `evals.{smokeCostUsd,fullRunCostUsd,runsPerCase,shipEvalCostUsd,matrixCostUsd}`, `prices`, `mergeBands`;
- `doctor --json` → keys `ok`, `checks`, `counts`, `stateHome`, `surface`; from a tarball, `plugin` and `binaries` must be `ok`;
- `changes`, `validate <c> --json` (`ready`, `problems`), `surface --changed … --json` (`needsManualTestPlan`, `files`);
- the review gate: `gate` with a blocker → 1 and `autonomyOutcome.blockers`; `gate` with `[]` and `--metrics` → 0 and `metrics.written`; `review … --base HEAD~1 --metrics`, `review-policy --base`, `domain-context … --base`, `drift --changed`, `ledger` (→ 1, `missing`), `ready`;
- the spec skill's commands: `advisor --brief`, `advisor --check --failed`, `autonomy record … --blockers 0`, `autonomy clean …` (array), `note derive`, `notify checkpoint` with an empty topic (→ "not configured", offline);
- the merge flow: `pipeline --github -` from `test/fixtures/pipeline/github-passing.json`, `merge-confidence … --pipeline` (`verdict`, `score`, `signals`), `--markdown`, `--label-names`;
- `report --json`, `report --html` (starts `<!doctype html>`), `evals triage --results`;
- the committed halted run: `waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --format board` → **byte-identical to the fixture's `board.txt`**; `run-log show/check/query` over its trajectory copied under a `--state-home`;
- the loop itself: `run start --change <c> --host workflow --json` → `classify`; a hand-written `classified.json` → `run classified` → `run-batch` with two spawns each carrying `promptPath` and `promptSha256`; `verify exec --command "exit 3"` → 3; `verify spill` over 20 kB; `run close --halt smoke --notify --json` → 1 with `exitCode`, `summary`; `run-log list`;
- `interlock-graph build/update/query/consumers/context/docs/docs-index/explain/which` → 0; `interlock-run <c> --host bogus` → 2.

Two extensions worth adding: drive `record-batch` → `judge` → a `--strict` review so the dimension-file reads at `lib/run.mjs:1613` happen from the tarball, and pin `doctor`'s `plugin` row from the installed prefix. The `test/fixtures/merge-confidence/*.json` files are `scoreMerge` inputs, not CLI inputs, so they add nothing here.

## 6. Options

Ranked by signal per unit of cost. "Model-free" means no credential, no spend, runs in ordinary CI.

| # | Option | Cost | Catches | Model-free |
|---|---|---|---|---|
| O1 | **Post-install command smoke.** Extend `cli-smoke`'s tarball step to run, from the installed prefix and against committed fixtures, every subcommand the skills, `ship.js`, `run.mjs` steps and hooks call, asserting exit code and the JSON keys the callers read. The prototype in §5c already runs 51 commands in 4 s and found the broken `tasks tick` form on its first run; move it into `scripts/` and call it from `ci.yml` with `$RUNNER_TEMP/prefix/bin`. | an afternoon; +30 s CI | a renamed flag, a dropped file, a changed JSON key, a subcommand that dies outside the checkout, a recovery command the card prints that does not run | yes |
| O2 | **Upgrade fixture tests**, the seven in §5a: a two-run harness pass with a tampered middle; a committed `test/fixtures/ship/release-<N‑1>/` snapshot cut at bump time from the extracted old CLI; foreign tags named; a stale `classified.json` bannered; doctor/validator parity on the profile; graph staleness; the harness driving HEAD `ship.js` against the N‑1 CLI. Tests 3 and 4 fail today, which is the point. | a day | G2 | yes |
| O3 | **Version-skew guard**, in the order §5b ranks them: a skew row in the preflight and `doctor` that resolves the PATH binary's real path and version and banners `CLI VERSION SKEW` against the plugin's `plugin.json`; `interlock --version`; the CLI version on the run manifest, the `run-start` event and every step; then a per-subcommand accepted-flag table so an unknown flag fails by name instead of being dropped, with a test that every flag a skill passes is in the table. | a day | G3, G7 | yes |
| O4 | **Previous-release install matrix.** In CI: `npm i -g @renzrollon/interlock@<prev>` into a prefix, run `doctor` and O1's smoke, then install the packed tarball over it and run them again. Also install the `release` branch bundle with `claude --plugin-dir` and run `claude plugin validate` and `claude plugin test` against *that* directory. | half a day; +1 min CI | leftover-file and bin-map upgrade bugs; the bundle differing from the checkout | yes |
| O5 | **Daily canary against the shipped bundle.** A scheduled workflow (no secret) that installs the newest Claude Code, clones the `release` branch, runs `claude plugin validate --strict`, `claude plugin test`, `interlock doctor` and O1's smoke from the bundle. Fails loudly; opens or comments on an issue. | half a day | G5: an engine update breaking the shipped plugin between releases (the 2.1.289 class) | yes |
| O6 | **Engine floor in CI.** Run `validate-plugin` twice: against `@anthropic-ai/claude-code@latest` and against the minimum the doctor names (2.1.287, or whatever `lib/doctor.mjs` carries). | an hour; +1 min CI | G5 for users behind on the engine | yes |
| O7 | **Node 24 and one macOS job.** Add `'24'` to the matrix; run `cli-smoke` once on `macos-latest`. | minutes; +5 min CI | G8 | yes |
| O8 | **Provision the API key.** One repository secret. The smoke evals (cap $2 per PR), full evals ($15 weekly) and outcome eval ($20 weekly) already exist, already read their caps from `interlock limits`, and already upload reports. Then commit the first `evals/history` rows by hand per `evals/history/README.md`. | minutes; up to ~$35/week at the caps, in practice far less | G1 (outcome eval ships a real fixture through the real loop), G4 | no |
| O9 | **Make the credential skip loud for scheduled jobs.** Until O8: the scheduled jobs should `exit 1` when no credential is present (keep the PR smoke's quiet skip so forks stay mergeable). A green weekly job that did nothing for six weeks is the "silent degradation" the repo's own rule forbids. | 10 minutes | the current false green | yes |
| O10 | **A local regression run on the demo fixture**, §8. Before tagging: reset kettle to `demo-ship`, load a packed copy with `claude --plugin-dir`, run `/interlock:ship`; after the bundle lands: `/plugin update`, `interlock doctor`, the same ship from a clean install, then `/interlock:spec` from `demo-spec` to its checkpoint. Grade each run with the outcome eval's six graders, append the row to `evals/history/ship-outcomes.jsonl`, compare invariants against the previous release's row. Needs three small build items (§8). | ≈12 min and ≈110k output tokens per ship run on the subscription, no API key; half a day once for the grader flag, reset script and version stamp | G1 on the Workflow host every plugin user runs, G3 on a real machine, the installed-plugin path CI cannot reach | no (subscription) |
| O11 | **Semver and upgrade notes.** Any `BREAKING` entry moves to a minor at least, with an `### Upgrading` subsection in the CHANGELOG naming the file or value that changed; `docs/` gains a short "Upgrading" page: what persists under `.claude/ship`, what a resume across versions does, how to check both versions. | an hour per release | G6 | yes |
| O12 | **Live-host test in CI for the claude adapter.** Set `INTERLOCK_LIVE_HOSTS=claude` in one job once O8's key exists; the test already exists and skips. | minutes; cents | the headless `claude -p` envelope drifting | no |
| O13 | **Fix the defects this review found**, each with the test that would have caught it: `tasks tick`/`tasks coverage` positional (`bin/interlock:2290`); `run start` clears or banners a leftover `classified.json`; `run next` refuses a `halted` manifest; a foreign `interlock.run/*` or `ship-run/*` tag is named, not read as "no manifest"; `PLAN REBUILT` bannered on the start step, not only the receipt; `doctor`'s `test-profile` row runs `validateProfile`; `interlock-graph update` reads `schema_version`/`extractor`; `autonomy.json` parse failure spoken, not overwritten; `--help` honoured after a subcommand; `interlock-run -h`. | a day | G2, G10 | yes |

Options considered and not recommended: a fourth test framework (the repo's spine rule refuses it, rightly); telemetry from user machines (the design forbids outbound calls other than `notify`); running model evals in consumers' CI (`docs/14` explains why not).

## 7. Recommended plan

In order, each one small enough to be a single OpenSpec change:

1. **O13 first, as a patch release.** The `tasks tick` form on the halt card is a user-facing break in 1.7.0 today; the stale `classified.json` and the halted-manifest `run next` are a wrong plan waiting to happen. Each fix lands with the test that reproduces it.
2. **O9, then the model-backed signal: O10 by default, O8 optional.** Fail the scheduled eval jobs when there is no credential. For "does the loop still ship", the owner's offer (2026-10-22) to run the sample spec and ship locally is the better instrument than the CI evals, because it exercises the Workflow host, the installed plugin and the PATH shim that the ACP-hosted outcome eval never touches; §8 says what to build so one run per release is a comparable row and not a one-off dogfood. Provision the secret later only if the transcript evals are wanted as well.
3. **O1 + O3 as one change**: the post-install smoke and the version-skew guard share the same inventory (which commands and flags the shipped surfaces call). Pin the inventory in a test so a new flag in a skill fails CI until the smoke covers it.
4. **O2 + O4**: the upgrade fixtures and the previous-release install. Re-cut the snapshot fixture as part of `bump-release`.
5. **O5 + O6 + O7**: the canary, the engine floor, Node 24, macOS. All configuration, all model-free.
6. **O10 + O11**: process. A dogfood ship per minor and an Upgrading section are what turn the 24-hour patch cadence into something a user can plan around.

What this buys: a tag that passes CI would then mean the installed tarball serves every command the skills call, state from the previous release resumes or is refused by name, a skewed CLI is bannered at session start, the shipped bundle is re-validated daily under the current engine, and at least one real ship per release, on the host users run, grades an outcome and is compared with the previous release's row. That is still not "every upgrade is safe", but it is a gate that sees the class of failure the last seven patches fixed.

## 8. Local regression runs on the demo fixture

Added 2026-10-22 after the owner offered to run a sample `/interlock:spec` and `/interlock:ship` locally per release and watch them for regressions, outside the pipeline. It changes the plan, and it is worth adopting in the specific form below rather than as an informal dogfood.

### What already exists for it

- **A fixture with reset points.** `~/IdeaProjects/kettle` carries three tags: `demo-spec` (the brief only, the state `/interlock:spec` starts from), and `demo-ship`, which `demo-baseline` also points at (the change artifacts present, the state `/interlock:ship` starts from). `HEAD` is two commits past them with the shipped feature. `takes/RESHOOT.md` step 2 is the reset recipe. One correction to it: `git clean -fd` leaves the ignored `.claude/ship/` in place, so the reset must remove `.claude/ship` and `.claude/learning` explicitly. Kettle today still holds `.claude/ship/classified.json` from 2026-10-10, which is the stale-classified hazard of §5a sitting live in the fixture.
- **The run receipt is already a fingerprint.** The 2026-10-09 demo ship recorded: 12.4 minutes wall from `run-start` to `run-complete`, 9 agent spawns, two waves (8, 3 and 1 tasks, 0 failed), 109,804 output tokens, 7 `cli-exit` rows all zero, and `host.billing: claude-subscription-programmatic`, which is to say it ran on the subscription with no API key. The receipt carries `halted`, `committed`, `commit`, `leftoverTaskIds`, `degradations`, `toolsDeniedInLanes`, `modelSubstitutions`, `permissionPrompts`, `autoModeDenials`, `schemaResultsMissing`, `touchedPaths` against `predictedPaths`, and spend per wave. It does not carry the Interlock version that produced it: the word `version` occurs nowhere in the trajectory.
- **The reader exists.** `interlock report --root ~/IdeaProjects/kettle` already prints the indicators over that corpus (run in this session; it reports the outcome-eval series as "absent" because `evals/history/ship-outcomes.jsonl` does not exist there). By design (§4.15a, the header of `lib/report.mjs`) it judges nothing, so the compare step has to live outside the CLI.
- **The graders exist.** The outcome eval's six criteria (`evals/ship/graders.mjs`: ticks against the state machine, a commit, a green suite, no weakened test, a reconstructable trajectory, a receipt) are model-free CLI calls that take a `root`. They can grade an interactive run as they stand. What is missing is an entry point: `evals/ship/run.mjs` only copies a committed fixture and drives it through the ACP host, whose agent calls the API directly. That is the metered category the owner has paused, and the same credential wall CI hit. So the proposal is not "run the outcome eval locally"; it is "run the real ship on the subscription, then grade it with the outcome eval's graders".

### How this changes the plan

1. **O8 becomes optional.** The local run is a better answer to the question this review was asked than the CI evals would be. It runs the Workflow host, which is the host every plugin user runs, where the outcome eval runs the ACP host. It runs the installed plugin, the shim and PATH order, the skills, the hooks and the ship meter on a real machine. The CI evals measured none of that even when they were designed.
2. **It does not displace the deterministic items.** O13, O1, O3, O2 and O4 take seconds per run and catch the class of break this review actually found (a recovery command that does not run, a flag dropped silently, a foreign manifest tag) before twelve minutes and 110k tokens are spent finding the same thing. Deterministic gates first; the local run is the last gate before the tag and runs once more after the bundle lands.
3. **It needs three small build items** to be a regression signal rather than a one-off:
   - A grade-an-existing-root entry point: `node evals/ship/run.mjs --grade-root <kettle> --change <name> --baseline-commit <sha>` (or a sibling script) that runs the six graders against the run kettle holds and appends a row to `evals/history/ship-outcomes.jsonl` marked as a local interactive run. From then on `interlock report` shows the series across releases with no new code, and `evals/history/README.md`'s rule (a maintainer commits the rows they keep) already covers it.
   - A reset script in kettle: RESHOOT step 2 plus the explicit `.claude/ship` and `.claude/learning` removal, with the fixture's expected invariants (below) written next to it.
   - The plugin version stamped on `run-start` and the receipt (already inside O3). Without it a pre-tag run under `--plugin-dir` and a run that fell through to the installed 1.6.3 on PATH are indistinguishable in the corpus.

### The procedure, per release

- **Pre-tag, advisory.** `npm pack`, extract into a scratch directory (never the checkout: a `--plugin-dir` session writes `tsconfig.json` and `types/` into the directory it loads, `docs/14-evals.md`), reset kettle to `demo-ship`, start `claude --plugin-dir <copy>` there, run `/interlock:ship open-the-second-counter`. One caveat this session did not test: the relay agents call bare `interlock` from PATH (`workflows/ship.js:451`), and whether a `--plugin-dir` session's `bin/` precedes the `~/.claude/bin` shim is unverified. Until the version stamp exists, run `which interlock` inside that session before trusting the row.
- **Post-bundle, authoritative.** `/plugin update` (served from the `release` branch), `interlock doctor`, reset kettle to `demo-ship`, `/interlock:ship` from the clean install. Then reset to `demo-spec` and run `/interlock:spec` with the brief and flags RESHOOT.md records, to its checkpoint.
- Grade both with the entry point above and compare the rows with the previous release's.

### What to compare

One run per release is a smoke, not a score; the outcome eval's own header says one run per fixture per arm is a weak signal. So compare invariants that must hold on every release for this fixture, not golden diffs. A violation is either a regression or a change the CHANGELOG names:

- terminal event `run-complete`; `halted` false; `committed` true; `leftoverTaskIds` empty
- every wave `failed: 0`; every `cli-exit` zero
- `degradations` empty; `toolsDeniedInLanes`, `permissionPrompts`, `autoModeDenials`, `schemaResultsMissing` all zero; `modelSubstitutions` exactly what the model map predicts for the engine in use
- `interlock verify unit` green in kettle, and no weakened suite against the fixture's baseline counts
- the touched-within-predicted share (100% of 57 paths on 2026-10-09)
- wall time and output tokens within a band of the previous row (twice is a reasonable first band; the model varies run to run)
- for the spec run: `interlock validate <change> --json` exits 0, the artifact-review metrics file is written, and the risk class is unchanged for the same brief

Anything outside the band is an issue opened before the tag, not a reason to widen the band.

### Cost and placement

About 12 minutes and about 110k output tokens per ship run on the subscription, plus a few minutes for the spec run. At the current cadence (14 tags in 15 days) that is noticeable but bounded. It is a per-release check, not a per-PR one, and it should stay out of the pipeline: a pipeline run would have to go through `claude -p` or ACP, which is the metered category, and would measure a different host than the one users run.

## Appendix: what was run

```
npm test                                   # 3967 tests, 3957 pass, 10 skipped, 158 s, Node 24.16.0
claude plugin test .                       # 120 pass, 4 files, 3.25 s, Claude Code 2.1.307
node bin/interlock doctor                  # PREFLIGHT OK — 11 passed, 3 skip (notify, prompt-cache, claude-bare, evals-*)
node bin/interlock --version               # Unknown command: undefined
node bin/interlock doctor --help           # runs the doctor
node bin/interlock tasks tick some-change --ids 1.1 --json   # {"error":"change \"tick\" not found …"}, exit 1
which -a interlock                         # ~/.claude/bin/interlock (shim → installed 1.6.3), then the plugin cache 1.6.3
gh secret list                             # (empty)
gh api repos/renzrollon/interlock/actions/runs/<id>/jobs   # eval steps: credential check success, every metered step skipped
gh api repos/renzrollon/interlock/rules/branches/main       # six required checks
npm view @renzrollon/interlock time        # 1.2.0 … 1.7.0, 6–21 October
git for-each-ref refs/tags                 # 14 tags, 15 days
git archive v1.1.0 / v1.5.1 / v1.6.0 / v1.6.3 bin lib package.json   # older CLIs, run from scratch directories for §5a and §5b
```

Three read-only audits ran in parallel on Opus for §5a, §5b and §5c; every claim they made that is repeated above was either re-run in this session or cited to a file and line. One probe suggested to the §5b audit, `run next` from this checkout, stepped the already-halted run `d7eda7dc` under `.claude/ship/` (gitignored); the manifest still reads halted, no stage marker was written, the commit guard allows, and `git status` is unchanged. The prototype smoke script and the extracted old CLIs are in this session's scratchpad, not the repository.
