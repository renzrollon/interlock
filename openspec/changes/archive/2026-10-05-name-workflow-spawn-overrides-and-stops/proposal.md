## Why

The default host speaks wrongly in two places and says nothing in two others. The validate ping in `workflows/ship.js` runs `printenv CLAUDE_CODE_SUBAGENT_MODEL` and, when it is set, the driver raises `MODEL ROUTING OVERRIDDEN` and withholds the haiku pin from every control-plane ping; since Claude Code 2.1.251 that variable sets only the *default* subagent model, so on a current host the banner is false and the pings run on the override model, often opus, for the whole run. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, which really does replace every agent's model (2.1.257), is probed by nothing. `spawnOne` reports a `null` result from `agent()`, which is what a stopped agent, an unrecoverable API error or a usage limit outside an interactive subscription session produces, as `BRIEFING NOT ACKNOWLEDGED: <label> reported (nothing)`, sending the reader to the briefing when the host was the cause. And a session that ends mid-run kills the background workflow before `run close` runs, so no resume card is written and the trajectory has no terminal record, in exactly the place a reader most needs one; `bin/interlock-run` has the same hole because nothing traps SIGINT or SIGTERM. Source: `briefs/claude-code-teams-and-orchestration-briefs.md`, Brief 2, with the addendum's note that the Desktop's "Send now" and Cmd/Ctrl+Enter now interrupt a turn.

## What Changes

- **The model-override policy leaves the driver.** `interlock run start --host workflow` reads `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and the Bedrock variables from its own `process.env`, the way `hostSessionId` already reads `CLAUDE_CODE_SESSION_ID`, and learns the host version from `claude --version` beside the existing `claude --help` effort probe. It decides the banners and the ping model; the driver forwards. `workflows/ship.js` sets `pingExtra.model` from a `pingModel` field on the step `run start` emits, and the `printenv CLAUDE_CODE_SUBAGENT_MODEL` and Bedrock lines leave the validate ping. The graph, test-profile and `CLAUDE_CODE_EFFORT_LEVEL` probes stay where they are.
- **Version-aware reading, with named floors.** On a host at or above 2.1.251 a plain `CLAUDE_CODE_SUBAGENT_MODEL` raises no `MODEL ROUTING OVERRIDDEN` banner and the pings keep haiku; an advisory note says the variable sets only the default on this host. On an older host, or when the version cannot be read, today's banner and today's haiku withholding stand, and the note names the unknown version. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` banners `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model` and the Workflow host's observed `modelSelect` is refined to a new registry value, `forced`, the same downward refinement the effort probe already performs. Both version floors are named constants in the module that reads them.
- **Slots are observed, never resized.** `run start` records the concurrency the runtime will honour as it can observe it: the environment override, or the vendor default with the machine's CPU count and the note that the runtime may run fewer on small machines. When an adopted plan's widest batch exceeds an observed override, the run banners `WAVE WIDER THAN RUNTIME SLOTS: <n> lanes queue`. `interlock limits` prints the observed value beside the vendor default. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is a doctor note only, because Workflow `agent()` calls are unaffected by it.
- **A null result is told apart from a wrong hash.** `spawnOne` banners `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed` for `result === null`, and keeps `BRIEFING NOT ACKNOWLEDGED` for a present result whose hash is wrong. The runner's `spawnOne` is unchanged: its adapters already name a failed spawn.
- **A killed session leaves a note, and three readers speak it.** A new recorder hook, `hooks/recorder.mjs`, registered on `SessionEnd`, acts only when a live stage marker exists and the event's `session_id` equals the session the run manifest recorded at start; it writes one small JSON note under `.claude/ship/interrupted/` with the run id, change, session, reason, stage and time, in one synchronous write, with no subprocess, and always exits 0. `interlock run start` banners `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` for every unspoken note and marks it spoken; `hooks/preflight.mjs` surfaces the same line at the next SessionStart; `interlock report` splits runs with no terminal record into *interrupted* and *unexplained*, each with its denominator. The run manifest gains the session id so the hook has one file to compare against.
- **The runner traps signals.** `bin/interlock-run` traps SIGINT and SIGTERM and calls its existing `stop()` once, so a killed runner also leaves a receipt and a resume card.
- **Doctor gains a `claude-env` row** with the same version-aware reading of the four variables, the Bedrock presence and the CPU count. It reports `ok` or `skip` and never `fail`.

## Capabilities

### New Capabilities

- `hooks/session-recorder`: a recorder hook that reports and never decides. Its SessionEnd branch writes the interrupted-run note when a live stage marker and a matching session exist, exits 0 on every path, creates no file or directory otherwise, and is the file later recorder branches (subagent and permission events) join rather than a second recorder.

### Modified Capabilities

- `ship/run-program`: adds the requirement that the CLI reads the Workflow host's environment and version at `run start` and decides the override banners, the observed slot count and the ping model, which the driver forwards without reading the environment itself; modifies "A briefing SHALL be a file whose first line carries its hash…" so that a host delivering by reference records a `null` result as `AGENT RETURNED NO RESULT` and only a present result with the wrong hash as `briefing not acknowledged`; adds the requirement that `run start` speaks every unspoken interrupted-run note once.
- `run-host-adapters`: adds `forced` as a legal `modelSelect` value that no adapter declares and only the Workflow host's run start observes; adds the requirement that the runner closes the run through `stop()` on SIGINT and SIGTERM.
- `hooks/session-preflight`: adds the `claude-env` doctor row (advice, `ok` or `skip`, never `fail`) and the requirement that the SessionStart preflight surfaces unspoken interrupted-run notes.
- `report/indicators`: modifies "Corpus coverage is reported before any indicator" so that runs without a terminal event are split into interrupted (a note exists) and unexplained, each with its own count.

## Impact

**Code**

- `lib/host/claude-env.mjs` (new, pure): the variable names, the two version floors, the version parser and the observation the CLI reads from an environment, a version string and a CPU count.
- `lib/host/claude-cli.mjs`: `probeClaudeVersion`, beside `probeClaudeEffort`, running `claude --version` under the same command override and timeout.
- `lib/run.mjs`: `runStart` takes the observation, decides the banners, the ping model and the observed `modelSelect`, stores the slot observation and the session id on the manifest, and speaks the interrupted notes; `adoptPlan` raises `WAVE WIDER THAN RUNTIME SLOTS`; `RELAY_STEP_FIELDS` gains `pingModel`.
- `lib/interrupted.mjs` (new): the note's path, shape, writer, readers and banner text, used by the hook, `run start`, the preflight and the report.
- `lib/host/registry.mjs`: `CAPABILITY_VALUES.modelSelect` gains `forced`.
- `lib/limits.mjs`: `formatLimits` takes an optional observed slot count and prints it beside the vendor default; `bin/interlock limits` supplies it and adds `runtime.observed` to the JSON.
- `lib/doctor.mjs`: the `claude-env` row; `REQUIRED_COMMANDS`' `printenv` reason no longer names the moved variables.
- `lib/report.mjs`: the interrupted-versus-unexplained split in coverage.
- `hooks/recorder.mjs` (new), `hooks/preflight.mjs` (reads the notes), `.claude-plugin/plugin.json` (SessionEnd registration).
- `workflows/ship.js`: the validate ping loses the model and Bedrock lines; `pingExtra.model` comes from the step; `spawnOne` splits null from a wrong hash.
- `bin/interlock`: the version probe and observation wired into `run start --host workflow`, into `doctor` and into `limits`.
- `bin/interlock-run`: the signal trap.

**Tests**

- `test/spine/run.test.mjs`: the version-aware matrix through `test/fixtures/hosts/fake-claude.mjs`, which gains a `--fixture-version=<v>` mode answering `--version`; the ping model on the start step; the FORCE refinement; the slots banner; the spoken note.
- `test/workflows.test.mjs`: no `printenv CLAUDE_CODE_SUBAGENT_MODEL` in the driver; the haiku pin repointed to the step's field; `RELAY_STEP_FIELDS` carries `pingModel`; null and wrong-hash results banner differently; the no-policy sweep gains the fixture for the new driver banner.
- `test/hooks.test.mjs`: the SessionEnd recorder cases and the registration pin; the preflight surfacing a note.
- `test/spine/doctor.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/report.test.mjs`, `test/spine/host-registry.test.mjs`, `test/spine/host-adapters.test.mjs`.

**Docs**

- `docs/04-when-it-stops.md`: `MODEL ROUTING OVERRIDDEN` rewritten for the version split and FORCE; `AGENT RETURNED NO RESULT`, `PREVIOUS RUN INTERRUPTED` and `WAVE WIDER THAN RUNTIME SLOTS` added.
- `docs/10-agentic-workflow-ship-and-spec.md`: step 1 of the lean sequence and the kill-switches line.
- `docs/13-the-guards.md`: the recorder row, marked as a hook that reports and blocks nothing.
- `docs/07-cli-and-configuration.md`: the two new environment variables in the routing table; `interlock limits` and `doctor`.
- `docs/11-the-indicators.md`: the coverage split.
- `CHANGELOG.md`, under Unreleased.

**Dependencies and ordering**

- Depends on nothing. It lands before Brief 4 (`record-workflow-agent-usage`) and Brief 9, which reuse the observed-capability path and `AGENT RETURNED NO RESULT`, and it settles the one recorder file they add branches to.
- It may be implemented in parallel with `guard-ship-relaunch` (Brief 3). The two edit disjoint new files (`hooks/recorder.mjs`, `lib/interrupted.mjs` here; `hooks/guard-relaunch.mjs`, `lib/launch-ledger.mjs` there) and only add entries to the shared `.claude-plugin/plugin.json`, `test/hooks.test.mjs`, `docs/13-the-guards.md` and `CHANGELOG.md`, so a merge is additive. Neither edits `hooks/_shared.mjs`. If they land one at a time, this one lands first.

**Out of scope**

- Resizing waves to the observed slot count; a subagent status line showing routed against served models; StopFailure attribution of a null result (whether it fires for a Workflow subagent's API error is undocumented); the ship-meter mod (Brief 7); a terminal trajectory record for an interrupted run, which would be a CLI write in the fatal class (the note and the report split are enough); moving the `CLAUDE_CODE_EFFORT_LEVEL` probe out of the validate ping; the critic's unverified candidates `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` and `CLAUDE_CODE_SAFE_MODE`, which are not added to the doctor row on the critic's word.
