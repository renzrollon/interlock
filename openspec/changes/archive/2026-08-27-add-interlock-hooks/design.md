## Context

Claude Code hooks run in the **host** process, not the plugin's Node context. A `PreToolUse` hook receives a JSON event on stdin (the tool name, its input, cwd, and session metadata) and returns a decision — allow, or deny with a reason — via its exit code and/or stdout, per the host's hook protocol. It shares no memory with `workflows/ship.js` or `lib/`, and it is invoked for *every* matching tool call in the session, including calls a human makes directly and calls made by agents that have nothing to do with a ship run.

Two facts shape everything below:

1. **A hook is stateless.** It cannot ask the workflow "what stage are we in." The only channel from the run to the hook is the filesystem (or an env var, but env vars do not survive across the separate subagent processes the workflow spawns — the marker must be a file). So the run must *publish* its stage, and the guard must *read* it.

2. **A guard fires for everyone.** The guards must be inert outside a ship run. A test-edit guard that blocked test edits whenever it could not find a stage marker would make the plugin's mere installation break normal TDD. This forces the fail-open default and makes the staleness check load-bearing, not decorative.

`interlock doctor` (`lib/doctor.mjs`, wired at `bin/interlock:1083`) already computes the allowlist/Node/OpenSpec/writability preflight and is non-mutating and never-throwing. The `SessionStart` hook is therefore a thin wrapper, not new logic.

## Goals / Non-Goals

**Goals:**
- Ship a `hooks` key in `.claude-plugin/plugin.json` with one `SessionStart` and three `PreToolUse` hooks.
- Make three already-hit failure modes structural: test-weakening during remediation, implementer hand-ticks of `tasks.md`, commits outside the commit stage.
- Give the guards a deterministic stage input with a defined lifecycle and a defined behavior when that input is missing.
- Keep the guards inert outside an Interlock ship run.

**Non-Goals:**
- Blocking the *human's* own commits or test edits in their terminal. The guards bound in-run agents; the fail-open commit behavior outside a run is deliberate.
- Enforcing the model clamp or any wave-planning policy — that is `lib/waves.mjs`, out of scope here.
- `PostToolUse` or `Stop` hooks. This change adds only the four hooks named.
- Replacing `disable-model-invocation: true` on `skills/commit` / `skills/mr`. The guard is defense-in-depth *alongside* that flag, not a substitute.

## Decisions

### The stage marker is a file keyed by change name, written by the workflow

`lib/ship-stage.mjs` owns the marker: `writeStage(change, stage)`, `readStage()`, `clearStage(change)`, and the path derivation. The marker lives under the run-state tree the doctor already probes for writability — `.claude/ship/<change>/stage.json` — and records:

```json
{ "stage": "remediation", "change": "add-foo", "index": 7, "pid": 12345 }
```

- **`stage`**: one of `implement` | `verify` | `review` | `remediation` | `fix-tests` | `commit`.
- **`index`**: a monotonically increasing write counter for this run, so a guard can tell a fresh marker from one an abandoned run left behind. The run seeds `index` from the run's own start and increments on each transition; a marker whose `index` did not advance across the guard's observation window is treated as stale.
- **`pid`**: the workflow/host process id. A guard that finds no live process for `pid` treats the marker as orphaned. `pid` is a *hint* (pids recycle), backstopped by `index`; neither alone is trusted.

**Who writes it.** `workflows/ship.js` writes the marker as it enters each stage. Because the workflow runtime rejects module imports (`workflows/ship.js:600` documents this for `PING_AGENT`/`WORKER_TOOLS`), the marker path and JSON shape are **duplicated as literals** in `workflows/ship.js` and kept byte-identical to `lib/ship-stage.mjs`, with a comment on each pointing at the other — the same discipline already in force for the agent-type constants. A test asserts the two definitions agree.

**Alternative rejected — env var.** `INTERLOCK_STAGE` set by the workflow would not reach the guard: `PreToolUse` fires in subagent processes the workflow spawns as children of the host, and there is no guarantee the workflow's env propagates to the host process that runs the hook. The filesystem is the only channel that reliably spans both.

**Alternative rejected — one marker for the whole tree.** Keying by change name lets two runs (unlikely but possible) not stomp each other's stage, and makes cleanup a targeted delete rather than a global one.

### Guards fail open on an unknown stage — with the commit guard's outside-run case called out

| guard | marker absent / stale / unreadable | rationale |
|---|---|---|
| `guard-tests` | **allow** | Blocking test edits whenever the marker is missing breaks ordinary TDD the moment the plugin is installed. The hazard (weakening a check) exists *only* during remediation, which requires a present, fresh `remediation` marker to trigger the deny. |
| `guard-tasks` | **allow** | Same reasoning; a missing marker is not an implementation stage. |
| `guard-commit` | **allow** | Its job is to bound in-run agents, not the human's shell. Outside a run there is nothing to protect, and blocking the human's own `git commit` on a stray marker would be the worse failure. |

The asymmetry to be honest about: fail-open means a **lost or stale marker during a real run** silently disables the guard for that window. That is the accepted trade — a guard that fails closed would, on the same lost marker, brick every edit in the session, which is a larger and louder harm with no upside. The staleness check (`index` + `pid`) narrows the window; it does not close it. This mirrors the README's own honesty about the collision check "narrowing the race rather than closing it."

### The guards match on resolved paths and canonicalized commands, not raw strings

- Edit guards resolve the tool input to an absolute path and compare against the project's test locations (read from `.claude/testing/profile.json`, the same source the doctor and the runner use) and against the change's `tasks.md`. An input that does not resolve to a concrete path → allow (an unresolvable target is not a target to protect).
- `guard-tasks` matches only lines whose change is a checkbox marker (`- [ ]` / `- [x]`); a prose-only edit that leaves every checkbox byte-identical is allowed. The guard diffs checkbox lines, not the whole file.
- `guard-commit` canonicalizes the Bash command enough to catch `git commit`, `git -C <path> commit`, and `git commit`-with-leading-env, without trying to defeat a determined adversary — this is a guardrail against the wrong-stage mistake, not a sandbox.

### The SessionStart hook wraps `interlock doctor` and never blocks

`hooks/preflight.mjs` shells `interlock doctor --json`, and if any check is a `fail`, prints the check and its `fix` string to the session as advisory output. It exits non-blocking regardless. If the `interlock` binary is unresolvable, it says so and exits non-blocking — a preflight that aborts the session because its own tool is missing is worse than no preflight.

## Risks / Trade-offs

- **Fail-open disables the guard on a lost marker mid-run.** Accepted and documented above; the alternative (fail-closed) has a strictly worse failure mode. Mitigation: `index`/`pid` staleness check and a test that the workflow clears the marker on every terminal path.
- **Literal duplication between `workflows/ship.js` and `lib/ship-stage.mjs` can drift.** Mitigation: a test asserts the path and shape match, exactly as the existing agent-type literals are guarded.
- **Hook protocol coupling.** The deny structure must match the host's `PreToolUse` contract for the deny to reach the agent as actionable feedback rather than a bare failure. Mitigation: the tool-guards spec pins "machine-readable reason," and the hook scripts target the documented protocol; a guard error itself exits allow-direction so a protocol mismatch degrades to inert, not to a wedged session.
- **Guards bind only Interlock-run agents in practice, but fire for all tool calls.** The inertness outside a run rests entirely on the marker being absent/stale. If a run fails to clear its marker (process killed), the staleness check is the only thing between a leftover `remediation` marker and a spuriously blocked test edit in the next session. Covered by the stage-guard spec's "process killed before cleanup" scenario.
- **No new dependencies**, so no version pin is required. The hook scripts use only `node:` built-ins (`node:fs`, `node:child_process`, `node:path`), matching `lib/`.
