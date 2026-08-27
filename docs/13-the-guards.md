# 13 — The guards

Interlock's pitch is that its caps and gates are code, not markdown a model can talk past. For a long time that pitch had a hole: every deterministic constraint lived *inside* the workflow (`workflows/ship.js`) or in a skill's prose, and both of those an agent *executes* rather than *obeys*. The moment an agent was holding the Edit tool, nothing outside its own instructions stopped it from editing the wrong file.

Claude Code's declared channel for enforcement outside the agent is the **hook** — a script the *host* runs, in its own process, on every matching tool call. This plugin ships four of them: one that reports at session start, and three that can deny a tool call before it reaches the filesystem.

They bind **only agents running inside an Interlock ship run.** Outside a run they are inert by construction — see [The fail-open rule](#the-fail-open-rule). Installing the plugin does not change how your own editing or committing behaves.

## The four hooks

| Hook | Event | What it does |
|---|---|---|
| `hooks/preflight.mjs` | `SessionStart` | Runs `interlock doctor` and surfaces any failing check with its fix. Advisory — it reports, it never blocks the session. |
| `hooks/guard-tests.mjs` | `PreToolUse` on `Edit`/`Write` | Denies edits to a **test file** while the run is in `remediation` or `fix-tests`. An agent making a red check green must not be able to weaken the check. |
| `hooks/guard-tasks.mjs` | `PreToolUse` on `Edit`/`Write` | Denies an edit that flips a **checkbox** in the active change's `tasks.md`. The tick is the CLI's job, keyed off recorded outcomes; a hand-edit is never the authority. |
| `hooks/guard-commit.mjs` | `PreToolUse` on `Bash` | Denies a `git commit` unless the run is in the `commit` stage. The deterministic form of the `disable-model-invocation` flag on `skills/commit`. |

Each of the three guards, when it denies, returns a machine-readable reason in the host's `PreToolUse` shape — the guard name, the offending path or command, and the current stage — so the blocked agent gets actionable feedback rather than an opaque failure.

Why these three? Each is a failure mode this repository has already paid for. An agent whose job is to make a red check green can edit the test that defines the check. Tick fidelity was wrong enough to warrant its own shipped change (`2026-08-25-tick-tasks-from-recorded-outcomes`) — that removed the *incentive* to hand-tick, this removes the *capability*. And "don't commit outside the commit stage" lived only as prose. The guards are defense-in-depth *alongside* the existing flags, not a replacement for them.

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

`workflows/ship.js` writes the marker as it enters each stage — `implement` when the wave loop begins, `review` before the review fan-out, `remediation` before each fix round, `fix-tests` before the final verify (which repairs a red suite by root cause, exactly when weakening a test is the hazard), and `commit` before the commit step, which is the one stage `guard-commit` lets a commit through. It **clears** the marker on every terminal path — commit, halt, apply-only, no-commit — so no stage leaks into the next session.

The workflow runtime rejects module loading, so it cannot import `lib/ship-stage.mjs`. The marker's path and JSON shape are therefore **duplicated as literals** in `workflows/ship.js` and kept byte-identical to the module — the same discipline the `PING_AGENT` / `WORKER_TOOLS` constants already follow. A drift test (`test/spine/ship-stage-drift.test.mjs`) fails if the two ever disagree.

A marker write that fails is a **non-fatal warning** on the run's trajectory, surfaced through the same banner channel every other run warning uses. The run continues: the marker is a guard input, not a gate the run itself depends on.

## The fail-open rule

When a guard cannot determine the stage — marker absent, unreadable, malformed, stale, or the process gone — the edit guards **allow** the tool call.

This is deliberate, and it is the asymmetry to be honest about. A guard that blocked test edits whenever it could not find a marker would break ordinary TDD the moment the plugin is installed — a cost strictly larger than the guard's benefit, which exists *only* during a run's remediation window. Fail-open means a **lost or stale marker during a real run** silently disables the guard for that window; the alternative (fail-closed) would, on the same lost marker, brick every edit in the session, which is a larger and louder harm with no upside.

| guard | marker absent / stale / unreadable | why |
|---|---|---|
| `guard-tests` | **allow** | The hazard (weakening a check) exists only during remediation, which requires a present, fresh `remediation`/`fix-tests` marker to trigger the deny. |
| `guard-tasks` | **allow** | A missing marker is not an active run; hand-ticking outside a run is the human's own business. |
| `guard-commit` | **allow** | Its job is to bound in-run agents, not the human's shell. Outside a run there is nothing to protect. |

The staleness check (`index` + `pid`) narrows the window in which a leftover marker from a killed run could spuriously block an edit in a later session; it does not close it, and the fail-open default is what makes that residual window safe rather than harmful. A guard that hits an unexpected error while evaluating a call exits in the allow direction too, with a diagnostic on stderr — a protocol mismatch or a bug degrades the guard to inert, never to a wedged session.

No new dependencies: the hooks are Node ESM scripts using only `node:` built-ins, matching the rest of `lib/`.
