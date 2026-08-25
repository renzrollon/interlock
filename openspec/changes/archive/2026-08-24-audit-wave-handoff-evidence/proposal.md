## Why

A wave handoff packet is a **claim**: an implementer reports `status: "ok"` with an `evidence` array of locators, and the next wave is told to read the packet *instead of reconstructing the work from git*. Nothing checks that the evidence points anywhere real.

`validateHandoff` already enforces the *shape* of a locator (`lib/waves.mjs:749`, `EVIDENCE_LOCATOR = /^[^\s:]+(:\d+(-\d+)?)?$/`). `lib/review-core.mjs:108` established, for review findings, that shape alone is not enough — and spelled out exactly why:

> Two conditions, because either alone is defeated:
> 1. `path:line` or `path:start-end`. Non-emptiness alone was satisfied by the string `"👍"`.
> 2. The path canonicalizes to one present in the reviewed diff. Shape alone is satisfied by inventing `lib/nowhere.ts:1`.

Handoff packets have condition 1 and not condition 2. `lib/nowhere.ts:1` passes today.

The field needed to close it is already being collected and thrown away: `filesChanged` is in the implementer result schema (`workflows/ship.js:245`, *"filesChanged is what the agent touched; evidence is where the next wave should look"*) and appears nowhere in `lib/waves.mjs`. It is reported by every implementer and dropped on the floor.

## What Changes

- A pure predicate audits each handoff packet's evidence against the set of paths that task actually changed — the membership half of `review-core`'s two conditions, applied to a second surface.
- `recordBatchResult` accepts and stores `filesChanged` per task instead of discarding it.
- The CLI supplies the authoritative changed-path set from git at `record-batch` time, while the tree still matches the claim. Git is advisory: when it is unavailable the audit falls back to the packet's own `filesChanged` and **says which source it used**.
- Each stored handoff gains an audit verdict — `confirmed`, `unconfirmed`, or `not-audited` — plus the reason.
- **The verdict is recorded, never gated on.** No new halt. A packet that fails the audit is still handed to the next wave.

Path membership only. The cited line is never required to exist, per `review-core`'s argument that a valid citation to a deleted line must not be rejected: *"path membership is the strongest condition that cannot produce a false rejection."*

Deliberately not semantic. Judging whether a cited span *supports* the claim needs a model, and `review-core` already rejected that: *"putting one there recreates this problem one layer down."*

## Capabilities

### New Capabilities

- `ship/handoff-evidence`: what makes a wave handoff packet's evidence auditable — the two conditions, where the authoritative changed-path set comes from, what the verdict records, and the rule that the verdict never halts a run.

### Modified Capabilities

- `waves`: `recordBatchResult` stores `filesChanged` and an audit verdict per task. Existing requirements on packet validation and failure accounting are unchanged; this adds recorded fields, and adds no new way for a run to stop.

## Impact

**Affected code.**

- `lib/waves.mjs` — a pure `auditHandoffEvidence(packet, changedPaths)` predicate; `recordBatchResult` persists `filesChanged` and the verdict. Stays pure: the predicate takes the changed-path set as an argument, mirroring `hasEvidence(verdict, diff)`.
- `lib/review-core.mjs` — the locator tokenizer and path canonicalizer are extracted so both surfaces share one definition rather than growing a second dialect of "what a locator looks like".
- `bin/interlock` — `wave-state record-batch` resolves the changed-path set from git and passes it in. Precedent for git in a `lib/` module is `lib/drift.mjs:40` (`execFileSync('git', …)`); it must degrade to a reported fallback, never throw.
- `workflows/ship.js` — no prompt change. `filesChanged` is already requested and already returned.

**Why the timing is load-bearance, not convenience.** `record-batch` is the only moment when the working tree still matches what the implementer just claimed. Audited later, the tree has moved and a `confirmed` verdict means nothing.

**What this does and does not buy.**

- Closes: an `ok` packet citing a path the task never touched.
- Closes: an `ok` packet citing a path that does not exist in the repo at all.
- Does **not** close: an `ok` packet citing a real, genuinely-changed path whose contents do not support the summary. That needs a model and is out of scope by the same argument `review-core` used.

**Non-goal.** This change adds no gate. The audit verdict exists to be read by a later scoring effort and by a human reading a halt; wiring it to a halt or to continuity eligibility is a separate decision that has not been made.
