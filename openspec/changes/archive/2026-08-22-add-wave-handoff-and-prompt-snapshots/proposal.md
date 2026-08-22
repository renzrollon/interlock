## Why

A fresh implementer is Interlock's isolation mechanism, but two contracts it depends on are still prose. The tier-ladder prompt is an untested string inside `workflows/ship.js` — silent drift the way caps used to drift before `lib/limits.mjs`. The next wave infers what happened from git plus mutable `state.json` instead of a validated per-task report. DeepSeek-harness snapshots what the model saw and fails closed on an invalid Ralph handoff; Interlock should steal those checks without adopting dsh's ACP harness or `--handoff` artifact docs.

## What Changes

- Extract and **snapshot the assembled implementer prompt text** (the tier ladder, stop-on-green for tiers 1–2, tool-economy rules, schema-only return). Tests compare frozen fixtures the way `test/spine/limits.test.mjs` pins cap numbers. Use the existing Node test stack and the `PARSE_INVOCATION_*` extract pattern already in `test/workflows.test.mjs`. Do **not** require dsh's `pnpm run test:snapshot` ACP/headless replay.
- Add a **bounded structured wave handoff**: each implementer returns `status`, `summary`, `evidence`, `next`, `blocker` under a character cap. Invalid or over-budget packets fail the task (`ok:false`); they are not novels the next wave has to parse. The next fresh agent is handed the CLI-validated packet, not a git reconstruction.
- This is **not** `--handoff` / `--strict` (manual-test-plan, code-explanation, memory). That tail stays opt-in and unchanged.

## Capabilities

### New Capabilities

- `implementer-prompts`: The text a wave implementer is handed is a frozen, testable contract. New because `openspec/specs/` has no capability for assembled `ship.js` prompts.
- `waves`: Cross-wave packets for the wave engine. New because there is no main spec for `lib/waves.mjs` / `interlock wave-state`. Covers schema-validated per-task handoff at wave boundaries.

### Modified Capabilities

- (none — `openspec/specs/` has no existing capabilities)

## Impact

- `workflows/ship.js`: extract `assembleImplementerPrompt` from the `remainingBatches` loop; extend implementer result schema with a handoff object; keep `handoff` on the accumulated batch result; inject previous-wave packets from the outer `next` into every remaining batch's prompt.
- `lib/waves.mjs` + `bin/interlock`: validate handoff on `record-batch`; persist packets with run state; `LIMITS.maxHandoffChars`.
- Tests: snapshot fixtures under `test/fixtures/prompts/`; `test/spine/` validation tests; `test/workflows.test.mjs` still treats `ship.js` as a script the runtime can load (no `import()`).
- Out of scope: Cordis, ACP host (separate change), Code Mode, Web UI, replacing git as the source of files changed, dsh `tool-ralph` package copy.
