# 13 — The guards

Interlock's pitch is that its caps and gates are code, not markdown a model can talk past. For a long time that pitch had a hole: every deterministic constraint lived *inside* the workflow (`workflows/ship.js`) or in a skill's prose, and both of those an agent *executes* rather than *obeys*. The moment an agent was holding the Edit tool, nothing outside its own instructions stopped it from editing the wrong file.

Claude Code's declared channel for enforcement outside the agent is the **hook** — a script the *host* runs, in its own process, on every matching tool call. This plugin ships six of them: one that reports at session start, one that records a session ending mid-run, three that can deny a tool call before it reaches the filesystem, and one that can deny a second ship launch nobody asked for.

The three stage guards bind **only agents running inside an Interlock ship run.** Outside a run they are inert by construction — see [The fail-open rule](#the-fail-open-rule). The launch guard binds only a session that has already launched ship and has had no human message since. Installing the plugin does not change how your own editing or committing behaves.

## The six hooks

| Hook | Event | What it does |
|---|---|---|
| `hooks/preflight.mjs` | `SessionStart` | Runs `interlock doctor` and surfaces any failing check with its fix, plus any [interrupted-run note](./04-when-it-stops.md#previous-run-interrupted-interrupted-note-unreadable-and-interrupted-note-not-marked) a previous session left. Advisory — it reports, it never blocks the session. |
| `hooks/recorder.mjs` | `SessionEnd` | When the session that owns a live ship run ends, writes one note under `.claude/ship/interrupted/` naming the run, the stage and the session. Reports and never blocks: it returns no decision on any path and exits 0, and in any other session it writes nothing at all. |
| `hooks/guard-tests.mjs` | `PreToolUse` on `Edit`/`Write` | Denies edits to a **test file** while the run is in `remediation` or `fix-tests`. An agent making a red check green must not be able to weaken the check. |
| `hooks/guard-tasks.mjs` | `PreToolUse` on `Edit`/`Write` | Denies an edit that flips a **checkbox** in the active change's `tasks.md`. The tick is the CLI's job, keyed off recorded outcomes; a hand-edit is never the authority. |
| `hooks/guard-commit.mjs` | `PreToolUse` on `Bash` | Denies a `git commit` unless the run is in the `commit` stage. The deterministic form of the `disable-model-invocation` flag on `skills/commit`. |
| `hooks/guard-relaunch.mjs` | `PreToolUse` and `PostToolUse` on `Workflow`; `UserPromptSubmit`; `UserPromptExpansion` | Denies a **second ship launch** in one session when no human prompt has arrived since the last launch. One script on four events: the `PreToolUse` branch is the only one that can deny, `PostToolUse` records each launch the runtime accepted, and the two prompt events record when a person last spoke. See [The launch ledger](#the-launch-ledger). Only the `/interlock:ship` path reaches it: `bin/interlock-run` refuses the Workflow host, so a runner-host run never calls the Workflow tool. |

Each of the four guards, when it denies, returns a machine-readable reason in the host's `PreToolUse` shape — the guard name, the offending path or command, and the current stage, or for the launch guard the session and the times of its last launch and last human prompt — so the blocked agent gets actionable feedback rather than an opaque failure.

Why these three? Each is a failure mode this repository has already paid for. An agent whose job is to make a red check green can edit the test that defines the check. Tick fidelity was wrong enough to warrant its own shipped change (`2026-08-25-tick-tasks-from-recorded-outcomes`) — that removed the *incentive* to hand-tick, this removes the *capability*. And "don't commit outside the commit stage" lived only as prose. The guards are defense-in-depth *alongside* the existing flags, not a replacement for them.

The fourth guard covers the most expensive mistake on record. A parent chat called Workflow again over leftover checkboxes, and that cost another 20+ agents including a full review cycle. `skills/ship/SKILL.md` forbids it, `test/skills.test.mjs` pins the sentence, and `evals/trampoline-launch` measures whether the model obeys. None of that stops a model that does not. The guard's deny quotes the skill's sentence and names the remedy: send a new message asking to ship the leftovers, or type `/interlock:ship` again.

## The launch ledger

The launch guard cannot read the stage marker: the mistake it bounds happens *after* `run close` has cleared it. So it keeps its own record, one small file per session at `.claude/ship/launch-ledger/<session_id>.json`. The file holds the ship launches the runtime accepted (time, `taskId`, `runId`, workflow name, persisted script path) and the time of the last human prompt. `lib/launch-ledger.mjs` owns the file and the rule. The hook is plumbing over it, the way the stage guards are plumbing over `lib/ship-stage.mjs`.

- **Only an accepted launch creates it.** The `PostToolUse` branch writes it, and only for a response whose `status` says the workflow launched. A launch the runtime refused never counts against the next one. In practice a refused launch never reaches the hook at all: the engine rejects an unknown workflow before `PreToolUse` runs.
- **A prompt never creates it.** The prompt branches make one existence check and stop when the session has no ledger. Every plugin hook runs on every prompt in every repository, so a prompt in a repository that never shipped writes nothing.
- **The completion wake is not a person.** When a background workflow finishes, the host wakes the session by firing `UserPromptSubmit` with the task notification as the prompt. That is the turn in which a relaunch happens, so a prompt beginning `<task-notification>` is not counted. Without that exclusion the wake would reset the clock and the guard would allow the very call it exists to deny.
- **A resume is a launch.** The completion wake's own diagnostics suggest passing the persisted script back with `resumeFromRunId`. That call names neither `workflows/ship.js` nor `interlock:ship`, so the guard matches it against the run id and script path the session's ledger recorded.
- **Its lifetime is a published cap.** A ledger whose newest launch is older than `launch ledger max age (ms)` in `interlock limits` reads as absent, and every launch write sweeps sibling ledgers past it. Ageing out only ever turns a deny into an allow. Deleting the directory resets the guard.

What it does not do:

- **It does not judge the prompt.** Any human prompt re-arms one launch. Whether the message "explicitly asks to ship leftover tasks" stays with the prose and the eval.
- **It does not close the queued-prompt hole.** A message you type and queue while the run is in flight is a human prompt, recorded before the completion wake. A relaunch after that wake passes the guard. The guard bounds the case that cost twenty agents, a relaunch with no human message at all between the run and the next launch, and nothing wider. Any other machine-originated prompt it does not recognise, a loop or cron firing for instance, also re-arms a launch, which errs toward allow.
- **It does nothing with hooks disabled.** With hooks off (`disableAllHooks`, or a policy that admits only managed hooks), enforcement falls back to the skill's prose and `evals/trampoline-launch`. That is the state before this guard existed.
- **It is the settings-hook form of a guard that will move in-process.** When the host can load plugin mods (2.1.287 and later, with no `allowManagedModsOnly` policy), an in-process guard reading the engine's own prompt origin replaces these four registrations, and this page will say which form is active. Until then this is the only form that can be enforced, and it stays the fallback where mods cannot load.

## The stage marker

A hook is **stateless**. It shares no memory with `workflows/ship.js`, it is spawned per tool call, and environment variables do not survive across the separate subagent processes the workflow spawns. So a guard cannot ask the workflow "what stage are we in" — the only channel that reliably spans the run process and the hook process is the filesystem.

So the run *publishes* its stage, and the guard *reads* it. `lib/ship-stage.mjs` owns the marker:

```json
{ "stage": "remediation", "change": "add-foo", "index": 7, "pid": 12345 }
```

- **`stage`** — one of `implement`, `verify`, `review`, `remediation`, `fix-tests`, `commit`. A value outside that set reads as `unknown`.
- **`change`** — the change being shipped; the marker lives at `.claude/ship/<change>/stage.json`.
- **`index`** — a monotonically increasing write counter for this run, so a caller that knows the current run's count can reject a marker an abandoned run left behind.
- **`pid`** — the process that published the marker. A guard that finds no live process for `pid` treats the marker as orphaned. `pid` is a *hint* (pids recycle), backstopped by `index`; neither is trusted alone.

### Lifecycle

The **agent performing each step** writes the marker as it enters that stage — `implement` on the wave loop's lane briefings, `review` before the review fan-out, `remediation` before each fix round, `fix-tests` before the final verify (which repairs a red suite by root cause, exactly when weakening a test is the hazard), and `commit` before the commit step, which is the one stage `guard-commit` lets a commit through. The writer is the agent rather than a driver because the marker's `pid` has to belong to a process that is alive for the run.

`run close` in `lib/run.mjs` **clears** it, on every terminal path — commit, halt, apply-only, no-commit. The program routes a halt through `run close --halt` and both drivers' `stop()` call it, so a completion and a halt clear the same way. Without that clear, a completed run leaves `stage: "commit"` behind and `guard-tasks` denies every `tasks.md` checkbox edit for the rest of the session; a halt leaves `remediation` or `fix-tests` and `guard-tests` denies every test-file edit. A clear that fails is spoken as a degradation banner, never as an exit code.

No driver carries the marker's path or JSON shape. `lib/prompts/stage.mjs` renders the publish fragment from `lib/ship-stage.mjs`'s own `stagePath`, `MARKER_FIELDS` and `STAGES`, so there is exactly one definition; `test/spine/ship-stage-drift.test.mjs` fails if any driver declares a marker literal at all.

A marker write that fails is a **non-fatal warning** on the run's trajectory, surfaced through the same banner channel every other run warning uses. The run continues: the marker is a guard input, not a gate the run itself depends on.

## The fail-open rule

When a guard cannot determine the stage — marker absent, unreadable, malformed, stale, or the process gone — the edit guards **allow** the tool call.

This is deliberate, and it is the asymmetry to be honest about. A guard that blocked test edits whenever it could not find a marker would break ordinary TDD the moment the plugin is installed — a cost strictly larger than the guard's benefit, which exists *only* during a run's remediation window. Fail-open means a **lost or stale marker during a real run** silently disables the guard for that window; the alternative (fail-closed) would, on the same lost marker, brick every edit in the session, which is a larger and louder harm with no upside.

| guard | marker absent / stale / unreadable | why |
|---|---|---|
| `guard-tests` | **allow** | The hazard (weakening a check) exists only during remediation, which requires a present, fresh `remediation`/`fix-tests` marker to trigger the deny. |
| `guard-tasks` | **allow** | A missing marker is not an active run; hand-ticking outside a run is the human's own business. |
| `guard-commit` | **allow** | Its job is to bound in-run agents, not the human's shell. Outside a run there is nothing to protect. |
| `guard-relaunch` | **allow** on every unknown: no session id or an unsafe one, a ledger absent, unreadable, malformed or past its published age, a tool input it does not recognise as a ship launch, its own crash | It reads the ledger, not the stage marker. A false deny costs one typed message, and that is still a denial, so a ledger it cannot trust never produces one. An unreadable ledger is named on stderr. |

The staleness check (`index` + `pid`) narrows the window in which a leftover marker from a killed run could spuriously block an edit in a later session; it does not close it, and the fail-open default is what makes that residual window safe rather than harmful. A guard that hits an unexpected error while evaluating a call exits in the allow direction too, with a diagnostic on stderr — a protocol mismatch or a bug degrades the guard to inert, never to a wedged session.

The recorder is not a guard and has no row in that table: it decides nothing, so there is nothing for it to fail open *to*. Its rule is narrower. It writes only when a live stage marker exists and the run manifest names the session that is ending. In every other case — no marker, an orphaned marker, another session, a runner run with no session, its own crash — it creates no file and no directory. Every plugin hook runs in every session in every repository, so a recorder that wrote on a guess would leave files in repositories that never ran Interlock.

### Two corpus classes, side by side on purpose

The interrupted-run note is **outcome-class**: a note that cannot be written is a line on the hook's stderr, an unreadable note is a manifest note, and neither ever moves an exit code. The run trajectory under `.claude/ship/runs` is the opposite, **fatal-class**: a failed append exits 1, because a run nobody can reconstruct defeats the reason the file exists. The difference is deliberate. The note points at records written elsewhere — the trajectory, `tasks.md`, the plan. The trajectory *is* the record. Do not make the two consistent: a fatal note would stop a session from ending cleanly over bookkeeping, and an outcome-class trajectory would let a run go unrecorded without a word. No hook ever writes the trajectory, and the recorder is no exception.

No new dependencies: the hooks are Node ESM scripts using only `node:` built-ins, matching the rest of `lib/`.
