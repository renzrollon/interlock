## Context

See proposal.md for the motivation. The wiring as it stands:

- `workflows/ship.js` asks its validate ping to run `printenv CLAUDE_CODE_SUBAGENT_MODEL`, `printenv CLAUDE_CODE_EFFORT_LEVEL` and the two Bedrock variables, then decides in the driver: a set subagent model raises `MODEL ROUTING OVERRIDDEN` and withholds `pingExtra.model = 'haiku'`; a Bedrock variable withholds it too, silently. `test/workflows.test.mjs` pins `pingExtra.model = 'haiku'`, pins that the probe asks for `CLAUDE_CODE_EFFORT_LEVEL`, and sweeps both drivers for policy tokens. `lib/doctor.mjs`'s `REQUIRED_COMMANDS` entry for `printenv` names the three variables as its reason, and a test pins that it names the effort one.
- `interlock run start --host workflow` already probes the installed CLI once: `probeClaudeEffort` in `lib/host/claude-cli.mjs` runs `claude --help` under `INTERLOCK_CLAUDE_COMMAND` with a fixed probe timeout, and `bin/interlock` folds the verdict into `hostCapabilities.effort` before `runStart`, appending `EFFORT ROUTING UNAVAILABLE (workflow)` to the manifest and the step when it is `unsupported`. That is the observed-refinement pattern this change extends.
- A step reaches the Workflow driver through a relay ping that retypes stdout, and `relayStep` in `lib/run.mjs` copies only `RELAY_STEP_FIELDS`. A field not on that list never reaches `workflows/ship.js`; `test/workflows.test.mjs` scans the driver for every `step.<field>` it reads and asserts each is listed.
- `spawnOne` in `workflows/ship.js` treats a `null` result and a present result with the wrong `briefing` hash identically: `BRIEFING NOT ACKNOWLEDGED: <label> reported (nothing)`. The runner's `spawnOne` hands the request to an adapter whose `spawn-failed` event already names a failed process.
- The stage marker (`lib/ship-stage.mjs`) is written by the step's own agent with `pid` set to `$PPID`, the session process, so `readStage` finds it live for the run and orphaned once the session ends; `runClose` clears it on every terminal path. The run manifest `.claude/ship/run.json` gains `runId` at `adoptPlan` and records no session id; the `run-start` trajectory event records `hostSessionId(manifest, env)`, which reads `CLAUDE_CODE_SESSION_ID` on the Workflow host only.
- `bin/interlock-run` has `stop(reason)`, which calls `run close --halt` and exits, and registers no signal handler.
- `lib/limits.mjs` holds `RUNTIME.maxConcurrentAgents` and `RUNTIME.maxAgentsPerRun` as vendor facts; `formatLimits()` is pure and `bin/interlock limits` emits `runtime: RUNTIME` in its JSON. The cap-authority sweep does not cover `RUNTIME`.
- `lib/report.mjs` digests one record per trajectory with `hasTerminal`, and coverage prints `with terminal N (run-complete or run-halt)`.
- Hosts on this machine on 2026-10-05: `claude` on PATH is 2.1.274; the Desktop engine is 2.1.286. Both are at or above the two floors this change reads (2.1.251 and 2.1.257).

Constraints this design inherits (`CLAUDE.md`, the briefs' "Repository constraints every brief inherits"): thresholds live in the CLI and this change adds no cap; vendor version floors are named constants in the module that reads them; drivers interpret and the CLI decides; guards and recorders fail open and a recorder returns no decision; every plugin hook runs in every session in every repository, so a hook exits before any filesystem write when no live run exists; corpus-loss semantics stay per corpus and a hook never writes the trajectory; unknown stays unknown; degradation is spoken; zero runtime dependencies.

## Goals / Non-Goals

**Goals:**

- Move every routing-policy reading of the host environment out of the driver and into `run start`, decided once from the CLI's own `process.env` and the host's own version.
- Make the version split and FORCE true on the hosts people run today, with the floors stated as named constants and a probe recorded before the reading is trusted.
- Name the three silences: a host-stopped agent, a wave wider than the runtime's slots, and a session that died mid-run.
- Settle the one recorder file that Brief 4 and Brief 9 add branches to, without touching `hooks/_shared.mjs`, so `guard-ship-relaunch` can be implemented beside this change.

**Non-Goals:**

- Resizing a wave to the observed slot count. The plan is published policy; the runtime queues.
- Moving the `CLAUDE_CODE_EFFORT_LEVEL` probe. It stays in the validate ping, and the `EFFORT ROUTING OVERRIDDEN` banner stays where `effort-routing` specifies it.
- Writing a terminal trajectory record for an interrupted run (the brief's decision 4). A note is written; the trajectory is not touched outside the CLI's live path.
- Recording the served model per lane (`MODEL SUBSTITUTED`); that is Brief 4 or Brief 9.
- Adding `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` or `CLAUDE_CODE_SAFE_MODE` to any row before they are confirmed against the vendor documentation.

## Decisions

### D1 — Version-aware reading, two named floors, and the probe that licenses it

`lib/host/claude-env.mjs` (new, pure, imports nothing) exports the variable names (`SUBAGENT_MODEL_ENV`, `SUBAGENT_MODEL_FORCE_ENV`, `WORKFLOW_MAX_CONCURRENT_ENV`, `AGENT_TEAMS_ENV`, `BEDROCK_ENVS`), two floors, `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION = '2.1.251'` (gap3-8) and `SUBAGENT_MODEL_FORCE_MIN_VERSION = '2.1.257'` (gap3-7), `parseClaudeVersion(text)` (the first `major.minor.patch` in the output of `claude --version`, else `null`) and `compareVersions`. The reading, decided in `lib/run.mjs` (D2), is:

| `CLAUDE_CODE_SUBAGENT_MODEL` | `…_FORCE` | host version | banner | ping model | manifest note |
|---|---|---|---|---|---|
| set | unset | ≥ 2.1.251 | none | haiku | `MODEL ROUTING NOTE: CLAUDE_CODE_SUBAGENT_MODEL=<v> sets only the default subagent model on Claude Code <ver>; the model each spawn names takes precedence` |
| set | unset | < 2.1.251, or unreadable | `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=<v> — every agent runs on that model, so the per-tier assignment in the plan is not in effect` (with ` (host version unknown)` appended when unreadable) | none | — |
| any | set | ≥ 2.1.257, or unreadable | `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model (<v>, or the host's default when the variable is unset), so the per-tier assignment in the plan is not in effect` | none | observed `modelSelect: forced` (D4) |
| any | set | < 2.1.257 | the variable is inert on that host; the plain-variable row applies | | |
| unset | unset | any | none | haiku | — |

"Ping model haiku" is conditional on no Bedrock variable being set (`CLAUDE_CODE_USE_BEDROCK` or `AWS_BEDROCK`, non-empty and not `0`/`false`, exactly the test the ping's instruction applies today); with one set the ping model is `null` and a note says `PING MODEL INHERITED: a Bedrock variable is set, so control-plane pings run on the session model`, which speaks the silence the driver keeps today. An unreadable version treats FORCE as effective and the plain variable as overriding: both are the conservative readings, and the note names the unknown version so the reader knows why.

The brief's task 1 is the probe that licenses the first row: on a host at or above 2.1.251 (the 2.1.274 binary on this machine, or the 2.1.286 Desktop engine), with `CLAUDE_CODE_SUBAGENT_MODEL=opus` exported, a Workflow `agent({ model: 'haiku' })` must run on haiku, read off the subagent transcript's `model` fields or the Agent tool's `resolvedModel`. Its result is recorded under Open Questions below, and until it is recorded the row is advisory in exactly this sense: **if the probe fails, `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION` is set to `null`, which disables the first row so the banner applies on every version, and the `ship/run-program` scenario for a current host is amended before implementation continues.** That is a one-constant revert, which is why the floor is a constant and not a comparison inlined at the call site.

*Alternatives considered.* Keeping the probe in the ping and only adding `printenv CLAUDE_CODE_SUBAGENT_MODEL_FORCE` would leave the false banner in place and keep policy in the driver. A `host-env.json` file written by the ping for the CLI to read adds a file and a relay copy for a value the CLI's own process already holds. `nproc` is absent on stock macOS and would fail `doctor` there; `node:os` is the CPU source.

### D2 — The CLI reads and decides; the driver forwards; `bin/interlock` probes

Three parties, each with one job:

- **`lib/host/claude-cli.mjs`** gains `probeClaudeVersion(env, { probeTimeoutMs, cwd })` beside `probeClaudeEffort`: `spawnSync(<command>, ['--version'])` under the same `INTERLOCK_CLAUDE_COMMAND` split and `DEFAULT_PROBE_TIMEOUT_MS`, returning `{ version: '2.1.274' | null, reason: string | null }`. Never throws.
- **`bin/interlock`**, in `run start` when `hostId === 'workflow'`, builds the observation once, `observeClaudeEnv(process.env, { version: probeClaudeVersion(process.env).version, cpuCount: os.cpus().length })`, and passes it to `runStart` as `hostEnv`. The same observer feeds the `doctor` row (D10) and the `limits` print (D5). No other subcommand reads it.
- **`lib/run.mjs`** exports `decideHostEnvironment(observation)` → `{ banners, notes, pingModel, modelSelect, slots }`, a pure function tested directly, and `runStart` applies it: banners onto `manifest.banners`, notes onto `manifest.notes`, `manifest.pingModel`, `manifest.host.modelSelect = 'forced'` when FORCE is effective, `manifest.runtimeSlots` (D5) and `manifest.hostEnv` (the observation, so a later reader sees what the decision saw). The start step carries `pingModel`.

The observation is taken on the Workflow host only. The runner's lanes are `claude -p` processes whose top-level model is `--model`, which `CLAUDE_CODE_SUBAGENT_MODEL` does not govern, and the runner already reads its own environment for `EFFORT ROUTING OVERRIDDEN`. A run that passes `--host-capabilities` keeps whatever `modelSelect` it passed, on the terms the effort probe already honours.

`lib/run.mjs` may import `lib/host/claude-env.mjs` because that module imports nothing — the prohibition in `lib/run.mjs`'s header is on loading the adapters, which spawn vendor binaries, and `claude-env.mjs` is a parser.

### D3 — The driver forwards the ping model and loses the probe

In `workflows/ship.js` the validate ping keeps `hasGraph`, `hasTestProfile`, `effortLevelOverride` and the `mkdir`, and loses the `printenv CLAUDE_CODE_SUBAGENT_MODEL` and Bedrock lines together with the `subagentModelOverride` and `haikuAvailable` fields and the two decisions that read them. After `run start` returns, the driver sets `pingExtra.model = step.pingModel` when the field is a non-empty string and leaves `pingExtra` without a model otherwise. `RELAY_STEP_FIELDS` gains `pingModel`, or the relay would drop it.

The `run start` relay itself runs before the decision exists, so it inherits the session model — exactly as the validate ping does today, so the run makes no more non-haiku pings than it does now. Every later ping carries the decided model.

The pin in `test/workflows.test.mjs` that asserts `pingExtra.model = 'haiku'` names the mechanism this change replaces; it is repointed to `pingExtra.model = step.pingModel` in the red wave, with the test's own comment saying the pin was repointed because the mechanism moved, not weakened. The pin that the probe still asks for `printenv CLAUDE_CODE_EFFORT_LEVEL` stays green. `REQUIRED_COMMANDS`' `printenv` reason becomes "the environment probe reads CLAUDE_CODE_EFFORT_LEVEL", which keeps the pin on that entry green too.

### D4 — FORCE refines the observed `modelSelect` to `forced`

`CAPABILITY_VALUES.modelSelect` in `lib/host/registry.mjs` gains `'forced'`: an environment variable forces one model onto every spawned agent, so the per-spawn channel is ignored. No adapter declares it, and `test/spine/host-registry.test.mjs` asserts both the widened set and that every `HOSTS` entry still declares one of the three original kinds. Only `run start` on the Workflow host writes it, onto `manifest.host.modelSelect`, the same downward-only refinement the effort probe performs. The receipt's host block is unchanged in this change; the served model per lane is Brief 4's or Brief 9's `modelObserved`.

*Alternative considered: a boolean `modelForced` on the manifest.* Rejected: every reader of `hostCapability(manifest, 'modelSelect')` would need a second lookup, and a capability vocabulary with a side flag is the drift the registry exists to prevent. The registry edit is one line and is serialized with every other `CAPABILITY_VALUES` edit, as the briefs require.

### D5 — Slots are observed on the manifest, bannered at plan adoption, printed by `limits`, never resized

`observeClaudeEnv` reads `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` as an integer (the vendor's range is 1–256; a value outside it or not an integer is recorded as `invalid` with its raw text and otherwise ignored) and `cpuCount` from the caller. `runStart` stores `manifest.runtimeSlots = { observed: <n> | null, source: 'env' | 'vendor-default', cpuCount, vendorDefault: RUNTIME.maxConcurrentAgents }`.

The comparison happens in `adoptPlan`, which both the plan-reuse path of `runStart` and `runClassified` call, because that is the first moment the run state exists: the widest batch is the largest `batch.length` over `state.waves[].batches[]`, and when `source === 'env'` and it exceeds `observed`, the step and the manifest gain `WAVE WIDER THAN RUNTIME SLOTS: the widest batch has <w> lanes and CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=<n> — <w − n> lanes queue for a slot; the plan is not resized`. The vendor-default case raises no banner: the CPU-based reduction is a documented fact without a documented number, and inventing one would be a threshold in prose.

`formatLimits({ runtimeObserved })` takes an optional observation and extends its last line: `runtime ceilings: 16 concurrent, 1000 agents per run — observed on this machine: CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=4` or `… — observed on this machine: vendor default, possibly reduced on a 8-CPU machine`. `bin/interlock limits` supplies the observation and adds `runtime.observed` to the JSON. `lib/limits.mjs` itself still reads no environment.

### D6 — Null is split from a wrong hash in the driver, and the sweep allows the words

`spawnOne` in `workflows/ship.js` checks `result === null || result === undefined` first and banners `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`, returning `null` as it does today; the hash check runs only on a present result and keeps its banner. This is a host-observed fact about what `agent()` returned, with no threshold and no verdict, so it belongs in the driver on the terms the briefing bootstrap already does. The no-policy sweep gains the banner's prefix in its allowed-plumbing fixture, pinned, so the sweep cannot later read it as policy. The runner's `spawnOne` is unchanged.

### D7 — The interrupted-run note: one file per run, outcome-class, spoken once

**Path and shape.** `.claude/ship/interrupted/<runId>.json`, `{ schema: 'interlock.interrupted/1', runId, change, sessionId, reason, stage, at, spokenAt: null }`. This refines the brief's `.claude/ship/<change>/interrupted.json` for one reason: `interlock report` needs the record after `run start` has spoken it, and two interrupted runs of one change must not overwrite each other. "Clears the note" therefore becomes "marks it spoken"; nothing is deleted.

**Writer.** `hooks/recorder.mjs` (D8) on `SessionEnd`: `readStage({ root: cwd })` with the liveness rule the guards use (the marker's pid is the session process, which is still alive while its SessionEnd hook runs; a marker whose process is gone is an orphan and writes nothing), then `.claude/ship/run.json` for `runId`, `change` and `sessionId`. It writes the note only when the marker's change is the manifest's, the manifest's `sessionId` equals the event's `session_id`, and `runId` is present; otherwise it creates no file and no directory. One `mkdirSync` and one `writeFileSync`, no subprocess, exit 0 on every path with a stderr line on its own crash. The host's `reason` is stored verbatim and bounded to the trajectory's text limit; nothing branches on its value, because the enum is on the briefs' unverified list.

**The manifest records the session.** `adoptPlan` stores `manifest.sessionId = hostSessionId(manifest, ctx.env)` beside the `run-start` event that already records it, so the hook compares against the same value the trajectory holds and reads one file. A manifest without the field (an older run, or the runner host, where no session owns the run) never matches, and the hook writes nothing — the runner's signal trap (D9) is its receipt.

**Readers**, all through `lib/interrupted.mjs` (new): `interruptedPath`, `writeInterruptedNote` → `{ written, reason }`, `readInterruptedNotes(root)` → `{ notes, unreadable }`, `markSpoken(root, runId)`, and `formatInterruptedBanner(note)` → `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>`, so the three readers print one text.

- `runStart`, immediately after writing the manifest: for every unspoken note in the root, whatever its change, push the banner onto the manifest and the start step and mark the note spoken. An unreadable note becomes the manifest note `INTERRUPTED NOTE UNREADABLE: <file>: <reason>`; a note that cannot be marked is spoken again next time, which is the right direction.
- `hooks/preflight.mjs`: after the doctor report, read the notes and append the same banner line for each unspoken one to its advisory output. It marks nothing: the preflight is a reporter, and the next `run start` is the moment the reader is about to spend agents.
- `interlock report`: `digestTrajectories` joins each run without a terminal event to the notes by run id, and coverage gains `withoutTerminal: { total, interrupted, unexplained }` plus `interruptedNotesWithoutTrajectory`; the text prints `without terminal N — interrupted M (a SessionEnd note names the run), unexplained K` under `with terminal`, and `lib/report-html.mjs` renders the same fields because it renders the same object.

**Corpus class.** The note is outcome-class: a failed write is a stderr line from the hook and a failed mark is a manifest note, and neither moves an exit code. `STATE_DIRS` in `lib/doctor.mjs` gains `.claude/ship/interrupted` with `fatal: false`, so the state-dirs row says which class it is.

*Alternatives considered.* A terminal `run-halt` appended by the hook (hooks never write the trajectory) or by the next `run start` (a fatal-class write for a run that is not the one running; the brief's decision 4 recommends against it). Keying the note by change (overwrites; loses the report's record). Deleting the note at `run start` (same loss).

### D8 — One recorder file, no change to `hooks/_shared.mjs`

`hooks/recorder.mjs` dispatches on `event.hook_event_name`. Today it has one branch, `SessionEnd`; Brief 4's `SubagentStart`, `SubagentStop`, `PermissionDenied` and `PermissionRequest` branches, or Brief 9's, join this file rather than adding a second recorder. Any other event exits 0 at once. It imports `readEvent` and `projectRoot` from `hooks/_shared.mjs` and `readStage` from `lib/ship-stage.mjs`, and adds nothing to `_shared.mjs`, so `guard-ship-relaunch`, implemented in parallel, cannot collide with it there. `.claude-plugin/plugin.json` registers it under `SessionEnd` with the same `node "${CLAUDE_PLUGIN_ROOT}/hooks/…"` command shape as the preflight, and `test/hooks.test.mjs` pins the registration the way it pins the preflight's.

### D9 — The runner traps SIGINT and SIGTERM and stops once

`bin/interlock-run` registers `process.once` handlers for `SIGINT` and `SIGTERM` that call `stop('interlock-run received <signal>')`, guarded by a `stopping` flag so a second signal during the close does not start a second close. `stop()` already routes through `run close --halt`, which writes the receipt, the terminal event and the resume card, then exits non-zero. A signal that arrives before `run start` has returned still reaches `stop()`, and the close prints that no manifest exists and exits 1 — a truthful receipt. In-flight lane processes are not killed by this change; the adapters' own per-spawn timeouts bound them.

The test runs the real `bin/interlock-run` against `test/fixtures/hosts/fake-claude.mjs` with a new `--fixture-delay=<ms>` mode that holds the envelope, sends `SIGTERM` while a lane is in flight, and reads back the `run-halt` event and the card.

### D10 — Doctor gains `claude-env`, advice that never fails

`checkClaudeEnv(env, { version, cpuCount })` takes `checkNotify`'s posture: `ok` when none of the four variables is set and the version was read; `skip` otherwise, including when the version probe returns nothing; never `fail`, with its own try/catch, outside the `run()` wrapper. Its detail names the host version or `unknown`, each variable as set (with its value — a model slug or a small integer, never a credential) or unset, the version-aware reading for the plain variable, that FORCE forces one model, that TEAMS has no effect on Workflow agents, the Bedrock presence, and the CPU count beside the vendor default. The binary is resolved the way the adapter resolves it (`INTERLOCK_CLAUDE_COMMAND`, else `claude`) and probed through the existing injectable `probeVersion`, so tests stub it. The preflight gains one `claude --version` spawn inside its 20-second budget; the probe's own 5-second timeout bounds it.

### D11 — What the docs say, and what stays out

`docs/04-when-it-stops.md` rewrites `MODEL ROUTING OVERRIDDEN` for the two rows that still raise it and adds `AGENT RETURNED NO RESULT`, `PREVIOUS RUN INTERRUPTED` and `WAVE WIDER THAN RUNTIME SLOTS`. `docs/10` step 1 says the validate ping probes the graph, the test profile and the effort variable, and the kill-switches line gains FORCE. `docs/13` gains the recorder row, marked as reporting and never blocking, and names the note's corpus class beside the trajectory's. `docs/07` gains the two variables in the routing table and the observed line of `interlock limits`. `docs/11` gains the coverage split. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` appears only in the doctor row, because Workflow `agent()` calls are unaffected (teams-5). `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` and `CLAUDE_CODE_SAFE_MODE` stay out until confirmed.

### D12 — Tests drive the real binary with a versioned fake host

`test/fixtures/hosts/fake-claude.mjs` gains `--fixture-version=<v>` (answers `--version` with `<v> (Claude Code)` before every other check, as `--help` is answered today) and `--fixture-version-fails` (exits non-zero on `--version`). `test/spine/run.test.mjs` runs `run start --host workflow` with `INTERLOCK_CLAUDE_COMMAND` pointing at the fixture and the variables in the child env, and asserts each row of D1's table on the manifest and the step. The driver's behaviour is asserted through `test/helpers/ship-harness.mjs`, whose relays run the real CLI: the start step's `pingModel` reaches `pingExtra.model`, a lane canned `null` raises `AGENT RETURNED NO RESULT`, and a lane canned with a wrong `briefing` still raises `BRIEFING NOT ACKNOWLEDGED`. Hook tests plant a marker whose pid is the test process and a manifest with a session id, then spawn the recorder with a `SessionEnd` payload. Report tests plant a trajectory without a terminal event beside a note.

## Risks / Trade-offs

- [The host does not fire `SessionEnd` on a hard kill, or fires it after the marker's process is gone] → the hook writes nothing and the report counts the run as unexplained, which is the honest answer; the brief's task 4 captures what the host does, and nothing in this change claims more than it observed.
- [The task-1 probe fails: `agent({ model })` does not count as a spawn-time model] → `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION` is set to `null`, the banner applies on every version, the spec scenario is amended, and the pings keep being withheld — a one-constant change recorded in this file.
- [`claude --version` adds latency to `run start` and to every `SessionStart`] → one spawn bounded by the existing probe timeout; a probe that cannot answer yields an unknown version, today's banner and a note, never a halt.
- [FORCE with an unreadable version is treated as effective on a host where the variable is inert] → a false `MODEL ROUTING OVERRIDDEN` on a pre-2.1.257 host whose version could not be read; the banner names the unknown version, and the cost is one sentence, not a run.
- [Two interrupted notes for one run id] → impossible by construction: the file is named by the run id and the hook writes once per session end.
- [A note survives after its trajectory is deleted] → the report counts it under `interruptedNotesWithoutTrajectory` rather than joining it to nothing.
- [Both this change and `guard-ship-relaunch` append to `plugin.json`, `test/hooks.test.mjs`, `docs/13` and `CHANGELOG.md`] → every shared edit is an added entry, row or paragraph; `hooks/_shared.mjs` is edited by neither; when serialized, this change lands first.
- [`WAVE WIDER THAN RUNTIME SLOTS` never fires on the default configuration] → intended: `LIMITS.maxParallel` is already below the vendor default; the banner exists for an operator who lowered the runtime's slots and would otherwise watch lanes wait without a word.

## Migration Plan

Additive everywhere. The manifest gains `sessionId`, `pingModel`, `runtimeSlots` and `hostEnv`, and an older manifest reads them as undefined, which raises no banner and falls back to the assumed capabilities. `CAPABILITY_VALUES.modelSelect` gains a value no adapter declares. The trajectory schema is unchanged; the note lives in a new gitignored directory under `.claude/ship/`. The step gains one field. Rollback is reverting the commit; the only state a reverted version would not read is the notes directory, which nothing depends on.

## Open Questions

- **Probe result (task 1).** On a 2.1.251+ host with `CLAUDE_CODE_SUBAGENT_MODEL=opus`, does `agent({ model: 'haiku' })` run on haiku? Recorded here when run. A failing probe takes the path named in D1 and the Risks; it changes one constant and one scenario, not the approach or the task breakdown.
  - *Result, 2026-10-05: passes — the spawn-time model wins.* Claude Code 2.1.274 (the binary on PATH), run headless (`claude -p --model opus`) from a clean login-shell environment with `CLAUDE_CODE_SUBAGENT_MODEL=opus` exported, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` unset and the plugin loaded through `--plugin-dir`, ran the one-call Workflow script `agent('reply with the word ok', { label: 'probe', model: 'haiku' })`. The subagent transcript (`subagents/workflows/wf_*/agent-*.jsonl`) carries assistant `model: bedrock.claude-haiku-4-5` on every turn and replied `ok`; the parent session's turns carry `bedrock.claude-opus-4-8`. The stream carried no `resolvedModel` field to cross-check. `SUBAGENT_MODEL_DEFAULT_ONLY_MIN_VERSION` therefore stays `'2.1.251'` and the `ship/run-program` current-host scenario stands. Not probed: the 2.1.286 Desktop engine; the attempt to run the child with this Desktop session's inherited gateway environment failed before any spawn, because that gateway answers 404 for the `bedrock.claude-haiku-4-5` slug the `haiku` alias resolves to there, which is a property of that gateway and not of the reading.
- **`SessionEnd` payload.** The `reason` values and the plugin's SessionEnd time budget are unverified. The recorder stores the reason verbatim and depends on neither; the captured payload from task 4 is pinned as a fixture when it exists.
  - *Captured, 2026-10-05:* the same probe session registered a temporary `SessionEnd` command hook through `--settings` and wrote the payload the host sent when the headless session ended. Keys: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `reason`; `reason` was `other` for a `-p` session ending normally. `prompt_id` is not in the documented shape, and a run under the Desktop's environment additionally carried `scratchpad_dir`; the recorder reads neither. The scrubbed capture (ids zeroed, home and cwd rewritten to `/home/user`) is pinned as `test/fixtures/hooks/sessionend.json`, replacing the documented shape. Still unverified: the `reason` values for an interactive `/exit`, a Ctrl-C and a hard kill, and the SessionEnd time budget.
- **Desktop interrupts.** Whether "Send now" or Cmd/Ctrl+Enter stops the background workflow task is an addendum probe. If it stops the run without ending the session, no `SessionEnd` fires and this note is not written; a `turn.complete.isAborted` observer in the mod (Brief 7 onward) is the in-process view of that case.
