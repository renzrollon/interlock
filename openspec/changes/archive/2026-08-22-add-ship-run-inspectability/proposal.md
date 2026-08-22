## Why

A halted `/interlock:ship` run cannot be reconstructed. `workflows/ship.js` overwrites `.claude/ship/state.json` on every `wave-state` mutation, and `lib/outcomes.mjs` appends one summary line per planning→ship attempt — neither is a transcript. Verify agents also swallow full suite logs, which burns the token budget `shared/TOOL-ECONOMY.md` already forbids for ordinary reads. DeepSeek-harness (dsh) already treats “model-visible ⇔ logged” and spills oversized tool output; Interlock should steal those mechanisms while remaining a workflow that owns the loop in `ship.js`.

## What Changes

- Add an append-only JSONL **ship trajectory log** for each run: every wave-state action, CLI exit, agent spawn, and verify judgement. A halted run is reconstructable from that file plus the frozen wave-state snapshot, without re-deriving history from git.
- Spill oversized verify stdout/stderr: agents receive a **locator + preview**, not the full suite log. Full output stays on disk. Fits existing token-economy rules; does not copy Cordis.
- **Follow-on in this change** (after the log and spill land, not a fourth change):
  - Session-query over those trajectories (`interlock run-log` list/show/filter).
  - Reconstructability as a **gate invariant**: a missing, torn, or incomplete log is a loud halt, not a silent bookkeeping miss. This inverts the `outcomes.mjs` “never fail the run” contract for the trajectory only.
- Keep writing `.claude/learning/outcomes.jsonl` unchanged. The trajectory is the run transcript; the outcomes corpus remains one line per attempt for continuity research.

## Capabilities

### New Capabilities

- `ship-run`: Per-run inspectability of `/interlock:ship` — append-only trajectory, session-query, and reconstructability as a blocking invariant. `openspec/specs/` is empty today; this is a new capability rather than a delta on an existing path.
- `verify`: What verification agents may return into context. Spill oversized command output to a locator + preview. New capability because no main spec currently covers `lib/verify.mjs` / `interlock verify`.

### Modified Capabilities

- (none — `openspec/specs/` has no existing capabilities)

## Impact

- New impure modules alongside `lib/outcomes.mjs` / `lib/metrics.mjs` (trajectory writer; spill store). The workflow script still cannot touch the filesystem; logging and spilling happen as CLI side effects of commands agents already run.
- `bin/interlock`: new `run-log` surface; `wave-state` and `verify judge` append events; reconstructability gate on the later tasks.
- `workflows/ship.js`: pass a run id through the existing `STATE` file; log agent spawns via CLI (the script cannot write the JSONL itself).
- Tests: `test/spine/` module tests + `test/spine/cli.test.mjs` wiring, matching the 590-test Node test stack. No ACP/headless harness.
- Docs: `docs/04-when-it-stops.md` (how to read a halted run from the log), `docs/06-why-it-works.md` (inspectability mechanism), `shared/TOOL-ECONOMY.md` (spill as locate-before-read for suite output).
- Out of scope: Cordis, a Web UI, leaving Claude Code, Code Mode, replacing `ship.js` with a dsh-style orchestrator, gating on `outcomes.jsonl`.
