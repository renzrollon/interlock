## Context

See proposal.md — Why. The three constraints that determine the shape:

**1. The default host cannot write files.** `workflows/ship.js` has no `writeFileSync`, no `readFileSync`, no `import`. Every byte reaching disk goes through a prompt and then a CLI call:

```
WORKFLOW HOST                              ACP HOST
─────────────                              ────────
script holds the fact                      driver holds the fact
      │ ✗ cannot write                           │ ✓ write(path, obj)
      ▼                                          │
prompt: "Write this JSON to X"                   │
      │                                          │
      ▼  ── agent transports ──                  │
interlock run-log append --event X ──────────────┴──▶ appendRunLogEvent
                                                       TYPE_FIELDS whitelist
                                                       ← integrity boundary
```

`bin/interlock-ship-acp:180` wraps `host.runCli(argv)` and calls the CLI directly twelve times. So the same receipt is written by two different paths, and only one of them has an agent in it.

**2. The facts already exist in one object and are discarded.** `summary` (`workflows/ship.js:396`) accumulates `waves[]`, `plan`, `review`, `remediation`, `remediationRounds`, `handoff`, `commit`, `notes`, `halted`, `closing`. `degradationLines()` derives the degradation list from it. `finish()` joins everything into a string and returns it.

**3. Ordering is fixed and awkward.** `recordOutcome()` sets `summary.closing`; `degradationLines()` reads `summary.closing`; `finish()` calls `degradationLines()`. So the receipt's content is not complete until the closing step has already reported.

## Goals / Non-Goals

**Goals:**

- Persist the facts the run already computed, once, with provenance intact.
- Make `.claude/ship/runs/<runId>.jsonl` sufficient for a reader with no checkout.
- Keep the banner a human reads and the record a process reads derived from one computation.

**Non-Goals:**

- **No score.** No grade, weighting, threshold, composite, or gate. This change records.
- No new file format or directory. The receipt is a trajectory event.
- Not persisting `plan.json` / `classified.json` / `state.json` per run. The fingerprint hash stands in for plan identity; carrying 46 KB of plan per run is a separate decision.
- Not making the receipt mandatory for reconstructability.

## Decisions

**Decision 1: a new trajectory event type, not a new file.**

`run-receipt` joins `RUN_LOG_TYPES` and `TYPE_FIELDS`.

Alternatives considered:

- *A free-form `receipt.json` per run.* Rejected, and this is the load-bearing rejection. On the default host an agent would compose that file. A self-composed artifact presented as an observation is exactly the defect `derive-outcome-record-from-receipt` exists to fix — building the receipt that way would create a second instance of it in the same change set that fixes the first.
- *Extend `run-complete` / `run-halt` with the fields.* Rejected: those events are the *closing* marker, and a run can halt before the receipt's inputs are complete (Decision 4). Overloading them would force a choice between closing late and recording incomplete data.
- *A sibling module with its own file.* Rejected as unnecessary — `run-log.mjs` already has the whitelist, the seq assignment, the torn-line heal, and the never-throw contract. A second module would reimplement four solved problems.

**Decision 2: `TYPE_FIELDS` is the integrity boundary, and it is what makes agent transport acceptable.**

The receipt payload is large relative to other events, which raises the leak risk `run-log.mjs`'s header already names: *"handing the writer a fat object cannot leak suite logs, diffs, or finding bodies."* The `summary` object it is built from holds a review result with finding bodies and a verification result with suite output.

So every receipt field is copied by name through a coercer, as every other type already is. Nested groups (per-wave tallies, degradations) are built element by element with their own coercers rather than passed through — a nested object spread would defeat the whitelist one level down. The spec carries a scenario asserting this specifically.

**Decision 3: degradations are computed once and used twice.**

`degradationLines()` is called once; its result is both printed in the banner and copied into the receipt. Not recomputed for the receipt.

The function's own doc comment is the argument: *"An accumulator can only report what someone remembered to push — which is the exact property this block exists to remove."* Two call sites would reintroduce the possibility that the human's banner and the machine's record disagree, which is the same class of defect one level up.

**Decision 4: the receipt is appended after the closing step, and its absence is meaningful.**

Order becomes: `recordOutcome()` → `summary.closing` set → build receipt (including `degradationLines()`) → append receipt → `finish()`.

A run that dies between the closing step and the receipt append leaves no receipt. That is not papered over: the spec requires that a reader can see a closed run has no receipt, because "the run did not reach its own close" is a finding, not missing data. This is the same principle as `summary.plan` starting `null` rather than assuming a path — *"'we never found out' and 'there was no prior plan' are different facts."*

**Decision 5: absent means unknown, never a clean value.**

Review counts on a run that halted before review read as not-observed, not as zero blockers. Commit identifier on a `--no-commit` run reads as "did not commit", distinctly from "never found out". Coercers use the `nullableCount` / `nullableText` idiom already in `run-log.mjs`, not the `count` idiom that floors to 0.

This is the field-level version of the whole change's purpose: a corpus that reports absence as cleanliness would systematically flatter halted runs, which are the most informative records in it.

**Decision 6: plan identity by fingerprint hash, not by plan contents.**

`plan-fingerprint.json` already computes a `hash` over the artifact digests (verified: `hash`, plus `inputs[]` of `{path, sha256, bytes}`). The receipt carries the hash. Two runs of the same plan over the same artifacts are identifiable as such on a machine holding neither repository, at the cost of ~64 bytes rather than ~46 KB.

**Decision 7: both hosts write the same event; only the path differs.**

The ACP host writes directly (no agent). The workflow host transports through the closing agent. The event is identical, so a reader cannot tell which host produced it — and should not need to. The transport difference is a host concern, and `workflow-host`'s existing requirement that hosts share a spawn and CLI boundary is the reason this is acceptable rather than a fork.

**Decision 8: reconstructability learns the type but does not require it.**

`checkRunLog` recognizes `run-receipt` as valid, does not add it to the required set, and does flag a duplicate — a run has one close, so it has one receipt. Requiring a receipt would make halted runs unreconstructable, withholding exactly the trajectory a reader most needs.

## Risks / Trade-offs

**The receipt is transported by an agent on the default host** → Mitigated structurally by `TYPE_FIELDS`: the agent can drop the payload (losing the receipt, which is visible) but cannot add fields to it or alter which fields exist. It can in principle alter a *value* in transit. That residual risk is the same one `run-log append --event` already carries for every script-authored event, and closing it needs host-side write access, which is out of scope here.

**One more agent-visible payload in the closing prompt** → The receipt JSON is larger than the existing closing payloads. Mitigated: it is counts, hashes and short strings, and the degradation list is already bounded by `text()` coercion at 500 chars per entry.

**`TYPE_FIELDS` collision with `record-ship-run-measurements`** → Both changes edit that table. Sequencing note, not a design risk: land either order, expect a conflict on that one table if landed simultaneously.

**A reader mistakes a receipt for a score** → The receipt carries counts and facts, no derived grade. Mitigated by the proposal and spec stating the non-goal explicitly. The pressure to add a composite number to this event will be real; the defense is that nothing in the schema invites one.

**Nested field coercion is easy to get wrong** → A per-wave tally array is the first nested structure in this table. Mitigated by an explicit spec scenario that a fat summary containing finding bodies and suite output produces a receipt containing neither.

## Migration Plan

Additive. `RUN_LOG_SCHEMA` does not move: a reader of `interlock.ship-run/1` encountering an unknown `type` already tolerates it, since `readRunLog` parses objects generically and only `checkRunLog` interprets types.

Old trajectories have no receipt, which reads as a run that predates receipts — indistinguishable from a run that died before its close. Accepted: retrofitting is impossible, and the ambiguity resolves itself as old logs age out.

Rollback is a revert. Receipts already written stay parseable; `checkRunLog` at the prior version does not know the type but does not reject unknown ones.
