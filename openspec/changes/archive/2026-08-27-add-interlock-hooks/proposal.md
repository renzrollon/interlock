## Why

Interlock's pitch is that caps and gates are code, not markdown a model can talk past. Yet `.claude-plugin/plugin.json` ships no `hooks` key — grep it and there is no `PreToolUse`, `PostToolUse`, or `SessionStart` anywhere in the plugin. Every deterministic constraint today lives *inside* the workflow (`workflows/ship.js`) or in a skill's prose, both of which an agent executes rather than obeys. The moment an agent is holding the Edit tool, nothing outside its own instructions stops it from editing the wrong file.

Three of the four gaps below are failure modes this repo has already paid for:

- An agent whose job is to make a red check green (remediation, `skills/fix-tests`) can edit the test that defines the check. Nothing structural stops it.
- Tick fidelity was wrong enough to warrant its own shipped change (`2026-08-25-tick-tasks-from-recorded-outcomes`): the tick is the CLI's job, keyed off recorded outcomes, but an implementer holding Edit can still hand-tick `tasks.md`. That fix removed the *incentive*; it did not remove the *capability*.
- `skills/commit/SKILL.md:7` and `skills/mr/SKILL.md:7` both set `disable-model-invocation: true` — the prose version of "don't commit outside the commit stage." Prose is not enforcement.
- `README.md:50` warns that an un-allowlisted command stops a zero-touch run on an approval prompt. `interlock doctor` (`lib/doctor.mjs`) already computes exactly that preflight — but a human or skill has to *remember* to run it. A `SessionStart` hook fires it every time.

Plugins are Claude Code's declared distribution channel for hooks. Interlock ships zero. This change ships the deterministic layer the CLI half already earns.

## What Changes

- Add a `hooks` key to `.claude-plugin/plugin.json` declaring one `SessionStart` and three `PreToolUse` hooks, each pointing at a script under `hooks/`.
- Add `hooks/preflight.mjs` (`SessionStart`): runs the existing `interlock doctor` and surfaces its failures at session start instead of three waves in. Advisory — it reports, it does not block the session.
- Add `hooks/guard-tests.mjs` (`PreToolUse` on `Edit`/`Write`): denies edits to test files while the run is in the `remediation` or `fix-tests` stage. An agent making the red thing green must not be able to weaken the check on that code.
- Add `hooks/guard-tasks.mjs` (`PreToolUse` on `Edit`/`Write`): denies edits to `tasks.md` checkbox lines by an implementer. The tick is recorded by the CLI from adjudicated outcomes; a hand-edit is never the source of truth.
- Add `hooks/guard-commit.mjs` (`PreToolUse` on `Bash`): denies `git commit` (and `git commit`-equivalent invocations) unless the run is in the `commit` stage.
- Add `lib/ship-stage.mjs`: the single reader/writer of a **stage marker** — the deterministic state the three `PreToolUse` guards need, since a hook is stateless and cannot otherwise know whether a test edit is remediation (deny) or ordinary implementation (allow). `workflows/ship.js` writes the marker as it enters each stage; the guards read it.
- Wire stage-marker writes into `workflows/ship.js` at each stage transition (implement → verify → review → remediation → commit), and clear it when the run ends.
- Document the hooks and the stage marker in `docs/` and note in `README.md` that the guards bind only agents running inside an Interlock ship.

## Capabilities

### New Capabilities
- `hooks/stage-guard`: the stage marker's contract — who writes it, its lifecycle across a run, and the fail-open-vs-fail-closed rule each guard follows when the marker is absent or unreadable.
- `hooks/tool-guards`: the three `PreToolUse` deny rules (test edits during remediation, `tasks.md` checkbox edits by implementers, `git commit` outside the commit stage) and exactly what each matches.
- `hooks/session-preflight`: the `SessionStart` hook that runs `interlock doctor` and reports, without blocking the session.

### Modified Capabilities
<!-- No existing openspec/specs/ capability changes its requirements: the ship
     workflow gains stage-marker writes, but that is new behavior specified under
     hooks/stage-guard, not a change to an existing ship requirement. -->

## Impact

- **New files**: `hooks/preflight.mjs`, `hooks/guard-tests.mjs`, `hooks/guard-tasks.mjs`, `hooks/guard-commit.mjs`, `lib/ship-stage.mjs`, tests under `test/`.
- **Modified**: `.claude-plugin/plugin.json` (new `hooks` key), `workflows/ship.js` (stage-marker writes at each transition; the workflow runtime rejects module imports, so the marker path and format are duplicated as literals there and kept identical to `lib/ship-stage.mjs`, the same discipline `PING_AGENT`/`WORKER_TOOLS` already follow — `workflows/ship.js:600`).
- **Runtime**: hooks run in the user's Claude Code host, inherit no plugin module state, and receive only the JSON the host passes on stdin. A guard that cannot read the marker fails **open** for the edit guards (a stale or missing marker must never brick ordinary editing) and the rationale is stated per guard in the spec.
- **Blast radius of a bug**: a too-eager guard blocks legitimate edits mid-run (loud, recoverable); a too-lax guard permits the edit the guard existed to stop (silent). The fail-open default is chosen deliberately and the trade is documented, not assumed.
- **No new dependencies.** Hooks are Node ESM scripts using only `node:` built-ins, matching the rest of `lib/`.
