# 16 — Upgrading

The plugin and the `interlock` command line are installed in two places, and a run's files outlive both. This page says what an upgrade keeps, what a resume across versions does, how to read both versions from a session, and how to keep a separately installed CLI in step with the plugin.

Every release's breaking changes are listed under `### Upgrading` in the [CHANGELOG](../CHANGELOG.md). From 1.8.0, a breaking change ships in a minor release at least; read that heading before you update across a minor version.

---

## Two installs, and why they can differ

`/plugin install` puts the plugin in Claude Code's plugin cache and puts its `bin/` on the `PATH` of Claude Code's shell. `npm install -g @renzrollon/interlock` puts a second copy on the `PATH` of your own terminal ([07](./07-cli-and-configuration.md#install-the-clis-without-the-plugin)). They update separately. Updating the plugin does not touch the npm copy, so a machine can hold a plugin at one version and a global CLI a release or two behind it.

That matters because the plugin's skills and workflow call `interlock` by name. When a session's shell finds the older copy first, the skills run against a CLI that predates the flags they pass. A CLI older than 1.8.0 ignores a flag it does not know, so a review base or a plugin root the plugin hands it is dropped without a word. From 1.8.0 a CLI refuses an unknown flag by name and exits 2 (see [what the CLI now refuses](#what-the-cli-now-refuses)), but that protects only the copy you already updated.

## See both versions

```text
! interlock --version          # the CLI that answered; prints the bare version
! interlock version --json     # { "version", "path" }: which file answered
! interlock doctor             # the cli-version row compares it with the plugin
```

The `!` runs the command from the Claude Code prompt, so it resolves `interlock` the way the plugin's skills do. `interlock-graph --version` and `interlock-run --version` print the same version.

**`interlock doctor` has a `cli-version` row.** It resolves the `interlock` your shell finds first, reads its version, and compares it with the plugin's:

| The `interlock` on `PATH` is | The row reads | What it means |
|---|---|---|
| older than the plugin, or too old to report a version | `fail`: `CLI VERSION SKEW: interlock on PATH is <x> (<path>), plugin is <y>`, or `CLI VERSION SKEW: interlock on PATH predates version reporting (<path>), plugin is <y>` | The preflight prints it at session start. This is the direction that silently drops arguments a skill passes. |
| a binary whose version could not be read | `fail`: `CLI VERSION SKEW: the version of interlock on PATH (<path>) could not be read (<reason>), plugin is <y>` | `--version` timed out, was killed, exited non-zero without `Unknown command`, or printed no `major.minor.patch`. Run `<path> --version` and read its answer. |
| newer than the plugin | `warn` | A mismatch worth saying, with one known break. 1.8.0 removed `interlock advisor`, which a 1.7.0 plugin's `/interlock:spec` still calls after a clean artifact review. The call exits 1 with `Unknown command`, and the skill reports it and goes on to the hand-off, so the spec finishes with no `advisor.md`. Update the plugin to the CLI's version, or update both together. |
| the same version, or the plugin's own `bin/` | `ok` | Nothing to do. |
| not on `PATH` at all | `skip`: `interlock is not on PATH; the bundled binary runs` | Whether that is a problem is the `binaries` row's call. |
| an npm copy, with no plugin to compare it with | `skip`: `the doctor ran outside a plugin session, so there was no plugin to compare …` | The doctor found no plugin root: none passed, no `CLAUDE_PLUGIN_ROOT`, and no plugin `bin/` later on `PATH`. Run it from the Claude Code prompt, or set `CLAUDE_PLUGIN_ROOT` to the plugin's directory. |

The plugin the row compares with is, in order: `CLAUDE_PLUGIN_ROOT` when it is set, then the first plugin `bin/` on `PATH` that is not the npm copy itself. The plugin puts that `bin/` on the `PATH` of Claude Code's shell, so `! interlock doctor` finds it even when a global copy comes first. A copy run by name from a plain terminal has neither, and says so rather than comparing itself with itself. A copy older than the plugin's release may have no such row at all; the session-start preflight still catches it, because it runs the plugin's own bundled `bin/interlock doctor`.

A CLI that answers `--version` with `Unknown command` predates version reporting and is read as older than the plugin. A wrapper that prints `interlock 1.8.0` is read as `1.8.0`, and a prerelease such as `1.8.0-rc.1` is older than `1.8.0`. A plugin whose own version is not `major.minor.patch` leaves the row a `skip`. The row's `evidence` in `.claude/ship/preflight.json` carries the resolved path and both versions. A relative `PATH` entry such as `.` or `./bin` is skipped: the preflight runs the binary it finds, and a relative entry would find one in whatever repository the session opened.

**Every run records which release produced it.** The `run-start` event in the trajectory carries the CLI's version and path and the plugin's version and root, and the receipt carries both versions, so a trajectory read without its repository still says what wrote it. `/interlock:ship` hands the workflow the plugin's root, and `interlock run start` raises `CLI VERSION SKEW: this run's interlock is <x> (<path>), the plugin is <y> (<root>)` when the two disagree. When the CLI on `PATH` is so old that its start step carries no version at all, the close says `CLI VERSION UNKNOWN: the interlock on PATH predates version reporting (older than 1.8.0) — run interlock doctor`.

## Bring the CLI to the plugin's version

When the preflight or `interlock doctor` reports a skew, the fix is one of two commands, and the row's own fix text names which:

```bash
npm i -g @renzrollon/interlock@<the plugin's version>
```

for an npm copy, or, when the copy on `PATH` is not an npm install (a checkout, a wrapper, a shim), remove that path from `PATH` so the plugin's `bin/` is found. The plugin's version is the `version` in `.claude-plugin/plugin.json`, and it is the version `interlock doctor` prints in the same row. Pin the number rather than `latest`: a plugin that has not updated yet would then sit behind the CLI.

Keep the two together whenever the plugin updates. If you only ever use the plugin, you can drop the global copy: the plugin puts its own `bin/` on the `PATH` of Claude Code's shell.

## What persists across an upgrade

Nothing in these places is deleted by installing a new version. Each is read by the new CLI as it finds it.

| Where | What it holds | Read by a newer CLI |
|---|---|---|
| `.claude/ship/run.json` | the manifest of the run in progress or the last run: id, change, flags, the CLI and plugin that started it | Read if its schema tag is the one the CLI writes; otherwise named, never guessed at |
| `.claude/ship/plan.json`, `plan-fingerprint.json` | the stored plan, and what it was built from | Reused when the fingerprint matches; rebuilt, with the reason named, when it does not |
| `.claude/ship/<change>/stage.json` | the stage marker the guards read | Left alone by a foreign close |
| `.claude/ship/runs/<run id>.jsonl` | one run's trajectory | Lines of another schema are counted and skipped, never read as events |
| `.claude/ship/last-step.json`, `last-close.json` | the CLI's own copy of the last step and the last close | Rewritten by the next call |
| `.claude/graph/` | the codebase graph and its `manifest.json` | Rebuilt by `interlock-graph update` when the build that made it no longer matches |
| `.claude/autonomy.json` | the autonomy ladder | Preserved aside if it cannot be read |
| `.claude/testing/profile.json` | the test profile | Validated; an invalid profile halts the run naming the file |

If your corpora live in a [state home](./04-when-it-stops.md#corpora-in-main-checkout-and-corpora-in-state-home), the trajectories and the autonomy record are written there instead.

## What a resume across versions does

You can stop a run under one version, update, and resume or start again under another. The CLI does one of five things with what it finds, and each is spoken.

**It reuses the stored plan, or rebuilds it and says why.** `interlock run start` reuses a stored plan whose fingerprint still matches. For any other status it rebuilds the plan, and the start step carries `PLAN REBUILT (<status>)` with the reason. A plan whose format changed between releases is `plan-format-changed`; one stored before fingerprints existed is `no-fingerprint`. Tasks the earlier run finished but did not tick are dispatched again after a rebuild. A first run has no stored plan and says so in its summary, not as a banner.

**It removes a stale classification.** A `classified.json` left by an earlier run is the planner's output from a different run, and a run that read it would plan from the wrong tasks. `run start` removes it and says `STALE CLASSIFICATION REMOVED`, with the time it was written. If the planner then writes nothing, the run halts naming the file.

**It names a foreign manifest.** A `run.json` tagged with a schema this CLI does not write is named, with both tags and the CLI's version, and `run next` halts instead of reporting that no run exists. `run close` against it leaves the manifest and the stage marker untouched and names the marker's path, because it cannot interpret a format it does not know and the marker is what still blocks a commit. Close the run with the version that started it, or start a new run. A manifest that is not valid JSON is named as unreadable, not as absent.

**It defaults a missing field out loud.** A manifest written by an earlier release can lack a field the new one reads. `verifyBudget` and `stateHome` fall back to a default, and the first subcommand that loads the manifest says `MANIFEST FIELD DEFAULTED: <field> absent (written by an earlier release); using <default>`, once per run.

**It refuses a run that is over.** Every `run` subcommand except `start` and `close` refuses a manifest that records a halt or a close, naming the run id and the state, and writes nothing. Start a new run with `interlock run start`. Following the refusal to `interlock run close` returns the close the earlier run kept, with its own halt reason and exit code, and records nothing; that holds for a run 1.7.0 halted as well. One gap is deliberate: a run that closed *clean* under 1.7.0 recorded neither mark, so a `run` subcommand does not refuse it.

A halted run can still be picked up from its resume card; [04](./04-when-it-stops.md#reading-a-ship-halted-run) says how, and every `interlock` line on a card is checked to run.

**The trajectory.** A line whose `schema` is present and is not `interlock.ship-run/1` is skipped and counted. `run-log show` and `query` print a note with the count, and `run-log check` fails the file naming the count and the first tag found, because a trajectory written in part by another release cannot be reconstructed by this one. A line with no `schema` is read as before.

**The graph.** The graph's `manifest.json` records the schema version, the extractor, and a hash of every OpenSpec and memory file the overlays read. `interlock-graph update` rebuilds, with the reason printed, when the manifest predates those records, when the schema or extractor differs, or when an overlay file was added, removed or changed. Nothing is reported as up to date that was built by something else.

**The autonomy record.** An `autonomy.json` that exists but cannot be read is moved to `autonomy.json.unreadable-<ISO time>` before fresh counters are written. `interlock autonomy record` and `autonomy clean` print `AUTONOMY RECORD UNREADABLE: <path> moved to <new path>; counters restarted` on stderr, and under `warnings` with `--json` (for `clean`, on each row of the array it prints). The exit code stays 0. An absent record is an empty one, as it was.

## What the CLI now refuses

From 1.8.0 the CLI checks every flag against the flags the subcommand accepts. An unknown flag is refused by name:

```text
interlock: unknown flag --strcit for interlock run start (CLI 1.8.0)
```

It prints that subcommand's usage lines and exits **2**. With `--json` it also prints `{ "error", "unknownFlag", "subcommand", "cliVersion" }` on stdout, so a refusal that crossed the workflow relay is quoted in the halt instead of vanishing. Exit 1 keeps meaning a blocked verdict for `gate`, `ready`, `ledger`, `validate` and `run-log check`; a typo is never mistaken for one. An unknown subcommand still exits 1.

If a script of yours passed a flag the CLI used to ignore, it fails with exit 2 naming the flag. Remove the flag. `-h` or `--help` after any subcommand prints that subcommand's usage and exits 0 without running it, and `interlock tasks tick <change> --ids <ids>` reads the change from the positional, as `run start` does.

## The subagent advisors are removed

The 1.7.0 checkpoint advisor and the opt-in review advisor are gone, so these commands now fail as unknown subcommands or flags, exit 1 or 2, and write nothing:

- `interlock advisor` (`--brief`, `--check`, `--verdict`) and the `advisor.md` file it wrote beside a change's specs. A script that ran `interlock advisor <change> --brief` must drop the line; an `advisor.md` already in a change folder is left alone and nothing reads it.
- `interlock review-advisor`, `interlock review --advisor-brief` and `/interlock:review-code --advisor`, with the `review-advisor.md` file.
- The `interlock:advisor` and `interlock:review-advisor` agents, and the Spec Range and Review Range eval cases.

What replaces them is Claude Code's own advisor tool, which only you can turn on. `interlock doctor` has an `advisor` row that says whether it is configured, a ship run says so at start, and the Workflow close counts consults ([07](./07-cli-and-configuration.md#claude-codes-advisor-tool)). `interlock limits` no longer prints the advisor caps, and the note-match cap `maxAdvisorNoteRows` is now `maxNoteMatchRows` with the same value.

## Evals no longer run on a schedule

The model-eval workflows no longer have a `schedule:` trigger, because the credential they need is not provisioned and a weekly green skip reads as a passing eval. They run on `workflow_dispatch`, and the pull-request smoke still skips quietly in a fork. [14](./14-evals.md) has the posture.

## Next

[04 — When it stops](./04-when-it-stops.md) explains every banner named above. [07 — CLI and configuration](./07-cli-and-configuration.md) is the reference for the commands.
