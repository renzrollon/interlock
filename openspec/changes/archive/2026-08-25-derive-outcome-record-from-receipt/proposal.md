## Why

`openspec/specs/spec/continuity-provenance/spec.md` states as its purpose:

> Makes the blocker count that decides whether a human reads a specification come from the artifact review's own findings, rather than from a number the reviewed agent wrote down. **This is the one number in the loop where the party being gated currently reports its own result.**

It is not the one number. There is a second instance, in the corpus built expressly to inform whether human checkpoints can be removed.

`recordOutcome` (`workflows/ship.js:614`) constructs the outcome record from facts the script holds — `summary.halted`, `summary.remediationRounds`, `summary.review.blockers` — hands the JSON to a **haiku** agent, and instructs it:

> *"Correct any field that does not match what actually happened, and add `ship.unitGreen` — these values are a starting point, not a claim."*

The script does not hold `unitGreen`, so inviting an observation there is right. But `halted`, `remediationRounds`, and `codeBlockersSurviving` are values the script *observed*, and the same sentence invites a model to overwrite them. That is a self-report standing in for an observation, in the file whose entire purpose is to answer "should we have skipped the human that time?" — and `continuity-provenance` already has a requirement forbidding exactly this pattern: *"The continuity procedure SHALL NOT instruct an agent to write the gated number."*

## What Changes

- The outcome record is **partitioned by provenance**. Two named groups, never merged:
  - **observed** — written by the script from what it saw: halted, remediation rounds, surviving code blockers, wave tallies, commit sha. The closing prompt does not invite correction of these, and the CLI whitelist rejects an attempt to supply them from an agent-composed payload.
  - **reported** — written by the agent from reading state and the suite: `unitGreen`, skipped-verification reasons, cap-exhausted count, unresolved-error count. These stay agent-sourced because nothing else knows them, and they are labelled as reports, not measurements.
- Observed fields are **derived from the run receipt** rather than composed a second time, so the receipt and the outcome line cannot disagree. Nothing is reported twice.
- Absent stays absent. A field the agent could not read is omitted, never defaulted to a clean value — the existing rule (*"Leave a field out entirely rather than guessing it"*) is preserved and extended to the new grouping.
- `continuity-provenance`'s purpose statement is corrected: it names a class of defect, not a single number.

## Capabilities

### New Capabilities

- `ship/outcome-provenance`: the ship run's outcome record separates what the orchestrator observed from what an agent reported, and an agent is never asked to correct an observation. Sibling to `spec/continuity-provenance`, same principle, different surface.

_None._

`spec/continuity-provenance` needs its purpose text corrected — it claims this is the only place the gated party reports its own result, and it is not. That is prose in an existing capability's `## Purpose`, which a delta cannot carry, so it lands as a direct edit to `openspec/specs/spec/continuity-provenance/spec.md`. Its requirements are correctly scoped to the readiness gate's blocker count and are unchanged.

## Impact

**Depends on `add-ship-run-receipt`.** The observed half is derived from the receipt. Without a receipt there is nowhere to derive it from, and this change would reduce to deleting a sentence from a prompt — which fixes the invitation but leaves the two records free to drift apart.

**Affected code.**

- `lib/outcomes.mjs` — the record gains the observed/reported partition. The module's existing guarantees hold unchanged: never throws, writes a fixed shape built key by key, tri-state `bool` so `null` still means "nobody said".
- `workflows/ship.js` — the closing prompt stops inviting correction of observed fields and asks only for the three things the agent can actually see. Observed values are transported, not negotiated.
- `bin/interlock` — `outcomes append` rejects agent-supplied values for observed fields rather than silently accepting them, so the prompt and the writer agree.
- `openspec/specs/spec/continuity-provenance/spec.md` — purpose text corrected in place (prose only; a delta cannot carry an existing capability's `## Purpose`), to name the defect class and cross-reference the ship-run instance.

**Why not simply delete the sentence.** Three of the seven fields the closing step reports are genuinely unknown to the script (`unitGreen`, `skippedVerificationReasons`, `unresolvedErrors` come from reading `state.json` and the suite result). Removing the agent's contribution would lose them. The defect is not that an agent contributes — it is that one sentence grants the agent write access across a provenance boundary that is not marked anywhere.

**What this is worth.** The outcomes corpus records both `checkpoint` and `continue` runs specifically so the checkpoint runs act as a control group. A control group whose measurements may have been rewritten by the system under test is not a control group. This change is a precondition for the corpus being usable as evidence at all, independent of any scoring built on top of it.

**Non-goal.** No gate, no threshold, no eligibility rule. `lib/outcomes.mjs:11` is explicit that this is an unmade decision (§4.15a / F6.6) and this change does not make it — it makes the record trustworthy enough that the decision could later be made from evidence.
