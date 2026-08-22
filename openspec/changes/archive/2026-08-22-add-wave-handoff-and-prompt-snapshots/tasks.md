## 1. Snapshot assembled implementer prompts

- [x] 1.1 Extract `assembleImplementerPrompt({ change, task, previousHandoffs })` in `workflows/ship.js` between `ASSEMBLE_IMPLEMENTER_PROMPT_START/END` markers, preserving today's tier ladder, rules, and tier 1–2 stop-on-green text (the inline template lives in the `remainingBatches` loop)
- [x] 1.2 Call that function from the implementer `agent()` prompt in the `remainingBatches` loop instead of inlining the template
- [x] 1.3 Add `test/spine/implementer-prompt.test.mjs` that evals the marked function (same pattern as `parseInvocationFromSource`)
- [x] 1.4 Write fixtures `test/fixtures/prompts/implementer-tier-{1,2,3,4,5}.txt` for change `add-widget` / task `1.1` with empty `previousHandoffs` and assert exact equality
- [x] 1.5 Assert empty `previousHandoffs` omits a `PREVIOUS WAVE` section so tier snapshots stay stable

## 2. Handoff schema and cap

- [x] 2.1 Add `LIMITS.maxHandoffChars = 2000` and print it from `interlock limits`; pin it in `test/spine/limits.test.mjs`
- [x] 2.2 Add pure `validateHandoff` in `lib/waves.mjs` for schema `interlock.wave-handoff/1` (`taskId`, `status` ok|blocked|partial, `summary`, `evidence`≤8 locators, `next`, `blocker` null iff ok) and the character count
- [x] 2.3 Add `test/spine/handoff.test.mjs` for ok, blocked-without-blocker, over-budget, missing object, extra keys ignored

## 3. record-batch fail-closed and previous-wave injection

- [x] 3.1 Store valid packets on run state (`handoffs[taskId]`); invalid or missing packet on a returned object becomes `ok:false` with `invalid handoff:` and counts toward the task-failure halt. Keep `handoff` on the `remainingBatches` accumulator in `ship.js` (today `{ id, ok, error }`) and through `normalizeTaskResults` — the fused record ping writes those objects to `batch-N.json`
- [x] 3.2 Leave null agent results as `agent returned no result` without requiring a packet
- [x] 3.3 Have `nextStep` attach `previousHandoffs` from the immediately previous wave only (same array on every remaining batch of the current wave; not earlier batches of this wave)
- [x] 3.4 Extend `test/spine/waves.test.mjs` for fail-closed record-batch and previous-wave-only injection
- [x] 3.5 Extend `nextSchema` in `ship.js` **beside** the existing `remainingBatches` field and pass `previousHandoffs` from the outer `next` into `assembleImplementerPrompt` for every batch in the loop; render a `PREVIOUS WAVE` block that tells the agent not to re-derive from git
- [x] 3.6 Require `handoff` on the implementer agent schema; do not change `--handoff` / `--strict` artifact behavior
- [x] 3.7 Assert in `test/workflows.test.mjs` that implementers still go through `assembleImplementerPrompt` and that `ship.js` still has no `import()` / `fs`
