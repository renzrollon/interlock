## Context

See `proposal.md` for motivation.

- Implementer prompts are a string built inline in `workflows/ship.js` (around the `pipeline(tasks, …)` `agent()` call). `test/workflows.test.mjs` already extracts `parseInvocation` with `PARSE_INVOCATION_START/END` markers and evals it. Caps are pinned in `test/spine/limits.test.mjs`.
- The script still cannot `import()`. Prompt assembly MUST remain in `ship.js` (or be fetched by an agent, which would add a turn). Validation of handoff belongs in `lib/waves.mjs` because `record-batch` already crosses the CLI.
- `--handoff` on ship is a different feature (strict-tail markdown artifacts). Do not overload that flag.
- Prior art (dsh, not to copy): `pnpm run test:snapshot` ACP/headless replay of model-visible prompts; `packages/workflow/tool-ralph` status/summary/evidence/next/blocker + `maxHandoffChars` + fail on invalid. Interlock-native: Node snapshot of assembled text; CLI-validated packet on `record-batch`.

## Goals / Non-Goals

**Goals:**

- Silent prompt drift fails `npm test` the way a quiet cap change already does.
- Cross-wave context is a schema with a char cap; invalid packets fail the task.
- Next-wave `wave-state next` JSON carries previous-wave packets so `ship.js` can interpolate without reading disk.

**Non-Goals:**

- dsh ACP snapshot harness, Cordis, copying `tool-ralph`.
- Changing `--handoff` / `--strict` artifact generation.
- Putting prompt assembly in `lib/` (the workflow cannot import it).
- Feeding the entire run's handoffs into later waves.

## Decisions

### 1. Extract `assembleImplementerPrompt` in `ship.js` behind markers

```js
// ASSEMBLE_IMPLEMENTER_PROMPT_START
function assembleImplementerPrompt({ change, task, previousHandoffs }) { /* … */ }
// ASSEMBLE_IMPLEMENTER_PROMPT_END
```

Same eval trick as `parseInvocationFromSource`. The function is the single source of the tier ladder currently hardcoded at the `agent()` call.

**Alternative considered:** `lib/implementer-prompt.mjs` + CLI print. Rejected: `ship.js` cannot import it, and a copied string in the script would drift — the failure mode this change exists to catch.

**Fixture location:** `test/fixtures/prompts/implementer-tier-1.txt` … `implementer-tier-5.txt` (tier 5 may share tier 4's ladder text plus model is opus — still snapshot). Tests call the extracted function with a fixed `{ change: "add-widget", task: { id: "1.1", description: "sessions table", tier: N, model } }` and `assert.equal` against the fixture file. Update is deliberate, like changing `LIMITS.remediationRounds`.

Previous-handoffs block: when `previousHandoffs` is empty, the prompt contains no `PREVIOUS WAVE` section (keeps tier-1 snapshots stable). When present, a bounded section is appended after RULES.

### 2. Handoff schema and cap

Schema id: `interlock.wave-handoff/1`.

```json
{
  "schema": "interlock.wave-handoff/1",
  "taskId": "1.1",
  "status": "ok",
  "summary": "Added sessions table and unique email index.",
  "evidence": ["db/schema.sql:12-40", "lib/sessions.mjs:1-80"],
  "next": "Wave 2 can assume sessions persist; wire login against this table.",
  "blocker": null
}
```

| Field | Rule |
|---|---|
| `status` | enum `ok` \| `blocked` \| `partial` |
| `blocker` | null iff `status === "ok"`; non-empty string otherwise |
| `evidence` | array of strings, max 8; each matches `^[^\\s:]+(:\\d+(-\\d+)?)?$` or a repo-relative path |
| char count | `summary.length + next.length + (blocker\|\|'').length + evidence.join("\\n").length` ≤ `LIMITS.maxHandoffChars` |
| `maxHandoffChars` | `2000` |

`validateHandoff(taskId, packet)` in `lib/waves.mjs` (pure). `recordBatchResult` requires a packet per reported task. Invalid → `{ id, ok: false, error: "invalid handoff: …" }` and it counts toward `taskFailureHalt`.

**Do not silently truncate.** Truncation is the silent degradation this schema exists to forbid.

**Alternative considered:** markdown files under `.claude/ship/handoffs/`. Rejected for the hot path: `ship.js` cannot read them. Persist on run state (`handoffs: { [taskId]: packet }`) so `--write-state` already serializes them. Optional mirror on disk is unnecessary.

### 3. Previous-wave injection via `nextStep`

`nextStep` for `run-batch` / `test-wave` adds `previousHandoffs: Handoff[]` — packets whose tasks belong to `waves[waveIndex - 1]`, not the whole `completed` list, and not earlier batches of the **current** wave.

`remainingBatches` (from `fix-wave-boundary-cost`) already sits on that same step. ship.js runs every remaining batch of a wave sequentially from one `next` payload, so every batch of the wave receives the same previous-wave packets. Later batches of the same wave do **not** get earlier-batch handoffs — that would be a different contract than "previous wave only".

`assembleImplementerPrompt` renders:

```
PREVIOUS WAVE (schema-validated; do not re-derive from git):
- [1.1 ok] summary
  evidence: …
  next: …
```

The cheap ping that copies `wave-state` stdout already maps `tasks` and `remainingBatches`. Extend `nextSchema` in `ship.js` with `previousHandoffs` **beside** `remainingBatches` so the script can pass it into the assembler for every batch in the loop. If the ping drops the field, inject nothing rather than inventing git instructions — and the snapshot with empty previous stays the default.

`record-batch` is now one ping per checkpoint that writes `batch-0.json`… and calls `wave-state record-batch --write-state` once per file. Each file's `tasks[]` MUST still carry a `handoff` per task. Today the accumulator in `workflows/ship.js` projects `{ id, ok, error }` only — this change MUST keep `handoff` on that projection or `record-batch` will never see the packet. `normalizeTaskResults` in `lib/waves.mjs` currently strips unknown keys the same way; it MUST keep a validated `handoff` (or the invalid-handoff error).

### 4. Implementer agent schema

Today: `{ id, ok, filesChanged, error, note }`. Add required `handoff` object (same schema as above). `filesChanged` stays; it is not a substitute for `evidence`.

### 5. Tests

- `test/spine/handoff.test.mjs` — validateHandoff cases (ok, blocked without blocker, over budget, extra keys ignored, evidence cap)
- `test/spine/waves.test.mjs` — recordBatchResult fails invalid; nextStep previousHandoffs is prior wave only (same packets on every remaining batch of the current wave; not earlier batches of this wave)
- `test/spine/limits.test.mjs` — pin `maxHandoffChars === 2000`
- `test/spine/implementer-prompt.test.mjs` — extract + snapshot
- `test/workflows.test.mjs` — ship.js still forbids `import()`; implementer `agent()` calls `assembleImplementerPrompt`

## Risks / Trade-offs

- **[Eval-from-source tests are brittle] →** Same accepted risk as `parseInvocation`; markers are the contract. Do not add a bundler.
- **[Haiku ping drops previousHandoffs] →** Wave 2 still has git on disk; isolation is weaker that run, not wrong code. Optional later: fail the ping if the field is missing when prior wave had packets (out of scope unless cheap).
- **[Handoff required on failed agents] →** Null agent results still become `{ ok:false, error: "agent returned no result" }` without a packet — that path cannot produce a schema. Treat missing packet as invalid only when the agent returned an object.
- **[2000 chars × 8 tasks] →** Previous-wave block can be ~16k chars. Acceptable vs reading design.md; if needed, add `maxHandoffBlockChars` later without changing the per-task schema.

## Migration Plan

- Additive schema field; old in-flight `state.json` files have no `handoffs` key → `previousHandoffs: []`.
- Rebase onto current `ship.js`: implementer prompt is still inline in the `remainingBatches` loop; `nextSchema` already has `remainingBatches`; fused `record-batch` ping writes N result files. Do not restore per-batch record pings or overflow-group `regrouped`.
- No change to `--handoff` flag behavior.
- Rollback: remove the required field and snapshots; wave engine otherwise unchanged.

## Open Questions

None. `maxHandoffChars = 2000` is a pin, not a product question — change it in `limits.mjs` the same way as other caps.
