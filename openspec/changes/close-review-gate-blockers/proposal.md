## Why

A whole-tree `/review-code` of `main` on 2026-09-14 gated **BLOCKED** with five blockers: isolate-waves can last-writer-wins across a rename, the SessionStart preflight hook has no process tests, the live `interlock run` path warns on a failed trajectory append that CLAUDE.md and `ship-run` already call fatal, and two skill-instruction contracts (`report` quote-not-recompute, continuity `--findings`) are unpinned. Those are live correctness and silent-instruction-loss defects, not nits. Evidence is that review (file:line on `bin/interlock:1336`, `hooks/preflight.mjs:13`, `lib/run.mjs:2111`, `skills/report/SKILL.md:13`, `skills/spec/continuity.md:11`); this change lands a failing repro for each before the fix.

## What Changes

- **Lane-merge contention includes fold-mutation identity.** `laneDiff` already records rename `oldPath`, and a clean fold deletes it, but `runMergeLanes` keys `mergeDecision` only on `d.path`. Edit `lib/a.mjs` vs rename to `lib/b.mjs` looks disjoint; fold order silently restores or deletes the source. Contention keys become every path the fold will create, modify, or delete (destination always; rename source when status is `R`). Copy source is not a mutation and stays out.
- **SessionStart preflight is spawned in tests.** `hooks/preflight.mjs` already fail-opens (doctor fail, ENOENT, own crash all `exit 0`). Nothing spawns it. Tests cover clean / doctor-fail / ENOENT / own-crash, all exit 0, and pin the `plugin.json` SessionStart command.
- **Live `interlock run` treats a failed run-trajectory append as a halt**, the way `wave-state` already `process.exit(1)`s on `!logOk`. Applies to `logWaveMutation` on run start, record-batch, record-verify, and replan, and to live-path `agent-spawn` / `cli-exit` / `run-start` / `run-receipt` / terminal-event writes. Halt happens before ticks and commit. **Does not** make the outcome corpus or review metrics fatal.
- **Pin report-skill tokens** (`interlock report --json`, `Never recompute`, `Licenses nothing`) in `test/skills.test.mjs`.
- **Pin continuity-procedure tokens** (`interlock ready`, `--findings`, and the no-transcribe instruction) in `test/skills.test.mjs`.

No **BREAKING** CLI flags or JSON shapes. Isolate-waves folds that used to last-writer-wins a rename vs an edit will now halt — that is the stated collision policy finally applying to rename identity. A previously silent trajectory-append failure will now halt the run.

Verified warnings from the same review (review-code survival arithmetic, stage-pid fail-closed, ACP timeout, CI pins, briefing-path sanitizing, and the rest) are **out of scope**.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `ship/lane-merge`: a real collision includes rename-source identity, not only destination `path`.
- `ship-run`: an unwritable or failed append on the live `interlock run` trajectory is a halt, not a warning; the "until this gate is implemented, the writer MAY record without halting" caveat is closed. Outcomes remain non-fatal.
- `hooks/session-preflight`: the SessionStart hook process is fail-open under spawn, including its own crash, and is registered in the plugin manifest; those facts are asserted, not only implemented.
- `report/non-gating`: the explaining skill's quote-not-recompute / licenses-nothing contract is pinned by token in the skill suite.
- `spec/continuity-provenance`: the continuity procedure's `--findings` / no-transcribe contract is pinned by token in the skill suite.

## Impact

- `bin/interlock` — `runMergeLanes` mutation-set for contention; `wave-state` fatality unchanged.
- `lib/merge-lanes.mjs` — still pure path-set intersection; callers pass every fold-mutation path.
- `lib/run.mjs` — failed trajectory append → `haltStep` before tick/commit; outcome writes stay warn-only.
- `hooks/preflight.mjs` — behavior unchanged; tests spawn it.
- `.claude-plugin/plugin.json` — SessionStart command pinned from the test, not rewritten unless the pin finds drift.
- `skills/report/SKILL.md`, `skills/spec/continuity.md` — token pins; reword only if a pin is missing (they are present today).
- Tests: `test/spine/merge-lanes.test.mjs` (and a plumbing repro for rename-vs-edit), `test/hooks.test.mjs` (preflight spawn), `test/spine/run.test.mjs` (live-path append failure), `test/skills.test.mjs` (report + continuity tokens).
- Docs: only if a shipped sentence still says the live path may warn-and-continue on a failed trajectory append.
- Dependencies: none.
