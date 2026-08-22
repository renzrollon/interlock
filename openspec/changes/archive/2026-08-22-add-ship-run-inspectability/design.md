## Context

See `proposal.md` for motivation. Constraints that shape this design:

- `workflows/ship.js` is a dynamic-workflow script: no `import()`, no `fs`, no shell. Only spawned agents run `interlock`. Anything durable MUST be a CLI side effect, the same way `--write-state` already persists `.claude/ship/state.json`.
- `lib/outcomes.mjs` is the wrong shape to extend. It is one line per attempt, never-throw, and explicitly not a gate (§4.15a). The trajectory is a different corpus with a later inverted failure policy.
- `lib/verify.mjs` is pure policy. Spill I/O belongs in a new impure module, not inside `judgeVerification`.
- `state.json` remains the mutable cursor `wave-state` already writes. The JSONL is the history; do not turn `state.json` into an event log.
- Prior art (dsh, not to copy): `packages/core/session` “model-visible ⇔ logged”; `packages/spill` + post-execute spill policy. Interlock-native equivalent: CLI-appended JSONL + locator/preview on verify steps. No Cordis, no plugin bus.

## Goals / Non-Goals

**Goals:**

- A halted run is reconstructable from `.claude/ship/runs/<runId>.jsonl` plus the final `state.json`.
- Verify agents fit `shared/TOOL-ECONOMY.md`: locator + preview, full log on disk.
- Session-query and reconstructability-as-gate land in this change, after the writer and spill exist.

**Non-Goals:**

- Replacing the workflow runtime, ACP, Code Mode, a Web UI, or dsh's session host.
- Gating continuity on `outcomes.jsonl`.
- Logging prompt text or file diffs into the trajectory (those belong to the prompt-snapshot change).
- Making `lib/verify.mjs` read the filesystem.

## Decisions

### 1. Third impure module: `lib/run-log.mjs`

Sibling of `lib/outcomes.mjs` / `lib/metrics.mjs`. Schema `interlock.ship-run/1`. Path: `.claude/ship/runs/<runId>.jsonl`. `runId` is created in `createRunState` (UUID, also stored on the frozen state as `runId`) so every later `wave-state` call can append without a new flag.

**Why not extend outcomes.jsonl?** Different grain (per-step vs per-attempt), different failure policy, different readers. Mixing them would poison the continuity corpus with suite-adjacent events.

**Why not have ship.js write the file?** It cannot. Agents already call `wave-state` and `verify`; those binaries append.

**Why not a generic event bus?** Interlock stays a workflow. One JSONL writer, one CLI.

### 2. Event envelope and types

Every line:

```json
{
  "schema": "interlock.ship-run/1",
  "ts": "2026-08-20T00:00:00.000Z",
  "runId": "9f2c…",
  "change": "add-widget",
  "seq": 4,
  "type": "wave-action"
}
```

| `type` | Extra fields (copied by name; unknown keys dropped) |
|---|---|
| `run-start` | `mode` (`checkpoint`/`continue`), `strict` (bool) |
| `wave-action` | `action`, `wave`, `waveIndex`, `batchIndex`, `phase`, `source` (`create`/`next`/`record-batch`/`record-verify`/`replan`) |
| `cli-exit` | `command` (e.g. `wave-state record-batch`), `exitCode`, `durationMs` |
| `agent-spawn` | `label`, `model`, `kind` (`implementer`/`ping`/`verify`/`review`/`other`), `taskId` (nullable) |
| `verify-judgement` | `context` (`inter-wave`/`final`), `halt`, `reason`, `unitStatus` (nullable), `spill` (array of locators, may be empty) |
| `run-halt` | `reason` |
| `run-complete` | `leftoverTaskIds` (array) |

Seq is assigned by the writer (not the caller). Append uses the same torn-line heal as `outcomes.mjs` (`endsWithNewline`).

**Agent spawns:** `wave-state next` / `--write-state` already emit the next step, including `tasks[]` (current batch) and `remainingBatches` (rest of the wave). ship.js runs those remaining batches sequentially before the next record ping, so that CLI invocation MUST append one `agent-spawn` per task in `remainingBatches` on wave entry (`next`, or a `--write-state` that lands on `batchIndex` 0). Mid-wave `record-batch --write-state` is cursor catch-up and MUST NOT duplicate later-batch spawns. Plus one spawn for the cheap ping that is about to run (`record-batch-*`, `inter-wave-verify-*`, …) when the script later calls `interlock run-log append --event`. Implementer `agent()` itself cannot log; the reconstructable fact is “the state machine asked for these labels/models” plus “record-batch reported these ids”. `workflows/ship.js` adds one `run-log append` to the existing cheap ping prompts (same agent, not a new turn).

### 3. Spill store: `lib/spill.mjs`

Not a dsh `ctx.spillStore`. Function: `spillBytes(root, { runId, kind, bytes, now })`.

- Directory: `.claude/ship/spill/<runId>/<seq>-<kind>.log`
- Threshold: `LIMITS.verifySpillBytes = 8192`
- Preview budget: `LIMITS.verifyPreviewChars = 4096` (head 2048 + `\n…[spilled <n> bytes, locator=<path>]…\n` + tail 2048, or the whole thing if smaller)
- Return `{ locator, bytes, preview, truncated, sha256 }`
- Locator is repo-relative POSIX

`interlock verify` grows `spill` (or folds into the agent-facing result helper) so the workflow's verify prompt can say: run the command, spill, put locator+preview+counts+failures in `vresults.json`. `judgeVerification` stays pure and never opens the locator.

**Reject oversized result fields:** if `detail`, `cliStdout`, or any `failures[]` text exceeds `verifyPreviewChars`, `verify judge` fails closed with an oversized-result reason. That is the anti-swallow check.

### 4. CLI surface

```
interlock run-log append --event <file|->     # used by ship.js pings; also used internally
interlock run-log list [--change <name>] [--json]
interlock run-log show <runId> [--json]
interlock run-log query --run <id> [--type <t>] [--halted] [--json]
```

`wave-state create|next|record-*|replan` append `wave-action` + `cli-exit` automatically (run id from state). `verify judge` takes optional `--run-id` (or reads `runId` from `--state` if we pass the state file); ship.js already has `STATE`. Prefer `--state ${STATE}` on `verify judge` so the run id cannot drift.

Session-query is read-only and never-throw (like `outcomes list`). The reconstructability gate is a separate call:

```
interlock run-log check --state <file>   # exit 1 on gap / missing start / missing close
```

`ship.js` `halt()` and `finish()` run `run-log check` via the existing `record-outcome` haiku ping (or a sibling `record-run-log` ping). Gate lands after query, as specified in tasks.md.

### 5. Two-phase failure policy

| Phase | Trajectory write fails | Outcomes write fails |
|---|---|---|
| Land log + spill | report, do not halt (so we can ship the writer) | report, do not halt (unchanged) |
| After reconstructability task | **halt** | report, do not halt |

Do not silently leave the first phase in production docs: `docs/04-when-it-stops.md` lists the new halt only when the gate is on. Tests pin both phases so the inversion cannot happen accidentally on outcomes.

### 6. Tests (existing stack, no ACP)

- `test/spine/run-log.test.mjs` — append, torn line, seq, key-by-key payload, reconstructability check
- `test/spine/spill.test.mjs` — threshold, preview, hash, locator
- `test/spine/cli.test.mjs` — `run-log` wiring, `wave-state` side-effect, `verify judge` oversized reject, `limits` prints new caps
- `test/workflows.test.mjs` — ship.js mentions `run-log append` / `run-log check`; still no `import()` / `fs`

### 7. Docs

- `docs/04-when-it-stops.md`: how to `run-log show` a `SHIP HALTED` run
- `docs/06-why-it-works.md`: inspectability paragraph next to the wave engine
- `shared/TOOL-ECONOMY.md`: Rule for spilled verify output (locator then Read spans)

## Risks / Trade-offs

- **[Workflow cannot write files] →** All appends are CLI side effects; ship.js only adds argv to existing pings. Extra log lines must not add an agent turn per batch (`--write-state` already collapsed next+record).
- **[Haiku ping invents a spawn event] →** Writer copies fields by name and ignores unknown types; reconstructability cares that *CLI* events exist, not that the ping's JSON is literary.
- **[Log grows large] →** Events are small; spilled suite logs live in `spill/` not in JSONL. No rotation in this change; runs are one file each.
- **[Gate makes read-only checkouts unshipable] →** That is intended once the gate is on. Until then, writer degrades like outcomes.
- **[Seq races if two CLIs append] →** Ship is single-threaded at the script; agents in a wave do not call `wave-state`. Only the cheap ping mutates state. Document that as an invariant; do not add file locks in this change.

## Migration Plan

- New files only; no rewrite of existing `state.json` or `outcomes.jsonl`.
- Old repos: first ship after this change creates `.claude/ship/runs/`.
- Rollback: unused files are safe to delete (same as `.claude/learning/`). Feature-flag none; the gate is a later task on this change, so landing the writer is already a safe increment.

## Open Questions

None that affect specs or task order. Preview 4096 / threshold 8192 can move in `lib/limits.mjs` later the same way other caps do — tests pin the numbers.
