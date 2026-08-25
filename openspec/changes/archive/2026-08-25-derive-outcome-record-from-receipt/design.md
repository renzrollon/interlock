## Context

See proposal.md — Why. The mechanics of the defect:

`recordOutcome()` (`workflows/ship.js:614`) builds a record from script-held facts, then hands it to a `haiku` agent with this instruction:

> *"Correct any field that does not match what actually happened, and add `ship.unitGreen` — these values are a starting point, not a claim. Leave a field out entirely rather than guessing it."*

Then asks separately for three state-derived values (`skippedVerificationReasons`, `capExhaustedVerifications`, `unresolvedErrors`).

Sorting the seven values by who actually knows them:

| Value | Script | Agent | Currently writable by agent |
|---|---|---|---|
| `ship.ok` (halted) | ✅ observed | — | **yes** |
| `ship.remediationRounds` | ✅ observed | — | **yes** |
| `ship.codeBlockersSurviving` | ✅ observed | — | **yes** |
| `ship.unitGreen` | ✗ | ✅ | yes — correct |
| `skippedVerificationReasons` | ✗ (in state) | ✅ reads state | yes — correct |
| `capExhaustedVerifications` | ✗ (in state) | ✅ reads state | yes — correct |
| `unresolvedErrors` | ✗ (in state) | ✅ reads state | yes — correct |

Four of seven are correctly agent-sourced. Three are observations the sentence invites a model to overwrite. The record does not distinguish the groups, so a reader cannot tell which is which.

`openspec/specs/spec/continuity-provenance/spec.md` already forbids this pattern for the readiness gate's blocker count, including the requirement *"The continuity procedure SHALL NOT instruct an agent to write the gated number."* Its purpose text asserts that case is unique. It is not.

## Goals / Non-Goals

**Goals:**

- Make provenance a property of the record, readable without consulting the writer.
- Make enforcement independent of prompt wording.
- Remove the possibility that the receipt and the outcome line disagree about one run.

**Non-Goals:**

- **No gate.** `lib/outcomes.mjs:11` states that wiring a gate to these records is an unmade decision (§4.15a / F6.6). This change does not make it. It makes the record trustworthy enough that the decision could later be made from evidence.
- Not removing the agent's contribution. Four of seven values have no other source.
- Not changing `lib/outcomes.mjs`'s existing guarantees: never throws, fixed shape built key by key, tri-state `bool` where `null` means "nobody said".
- Not touching `spec/continuity-provenance`'s requirements. They are correctly scoped to the readiness gate.

## Decisions

**Decision 1: partition the record by provenance, with the groups named in the data.**

Two groups, `observed` and `reported`, rather than a flat object with a convention.

Alternatives considered:

- *Keep the record flat, just fix the prompt.* Rejected. It fixes today's wording and leaves nothing preventing tomorrow's. The defect survived this long precisely because nothing in the data or the writer marked the boundary — the only thing holding it was one sentence, and one sentence lost.
- *Per-field provenance tags.* Rejected as heavier for no gain: the partition is stable and small, and two named groups are readable at a glance in a JSONL line.

**Decision 2: enforcement lives in the writer, not the prompt.**

`appendOutcome` rejects agent-supplied values for `observed` fields rather than accepting them silently. The prompt is also fixed, but the prompt is documentation and the writer is the mechanism.

This is the direct analogue of `lib/ledger.mjs`'s stance — *"the load-bearing rule is that `agent_resolved` is a claim, and this module audits it… Without that check the entire gate can be defeated by writing the word `agent_resolved`"* — and of `continuity-provenance`'s own two-requirement structure, which pairs "derive the count from findings" with "the procedure SHALL NOT instruct an agent to write it". Both layers, because either alone is defeated.

The spec carries a scenario asserting that a procedure edited to reintroduce the invitation is still contained. That scenario is the regression test for the actual failure mode.

**Decision 3: reject, do not silently drop.**

An agent-supplied observed value is rejected with a reason, and the record is still written with the script's value. Not silently ignored: a closing step whose payload was partly refused should be able to say so, and the existing `{written, path, reason}` return shape carries it. Not fatal either — `lib/outcomes.mjs` never throws and *"losing a corpus line must never fail the run that produced it."*

**Decision 4: observed values are derived from the receipt, not composed a second time.**

The observed group is read from the run's `run-receipt` event. This is why the change depends on `add-ship-run-receipt`.

Without it, the two records would each be assembled from `summary` independently and could drift — a bug that would be invisible until someone compared them, and unresolvable afterwards because there would be no way to tell which was right. Deriving one from the other makes agreement structural.

When no receipt exists (the run died before its close), the observed group records the receipt's absence. It does **not** fall back to asking the agent — falling back to the untrusted source exactly when the trusted one is missing would defeat the change on the runs most likely to need it. A halted run with no receipt yields an outcome line that says so, which is honest and still useful.

**Decision 5: absent stays absent, in both groups.**

The existing rule (*"Leave a field out entirely rather than guessing it"*) is preserved and extended. A reported value the agent could not read is omitted, never defaulted to zero skips or a green suite. An observed value with no receipt reads as not-observed, never as clean.

Same reasoning as the receipt's Decision 5, and it matters more here: this corpus contains both `checkpoint` and `continue` runs specifically so the checkpoint runs are a control group. Defaulting absences to clean values would bias the control group, and a biased control group is worse than none because it looks like evidence.

**Decision 6: correct `continuity-provenance`'s purpose text in place.**

Prose in an existing capability's `## Purpose`, which a delta cannot carry (the schema states a delta's Purpose is ignored for existing capabilities). So it is a direct edit to `openspec/specs/spec/continuity-provenance/spec.md`, naming the defect class and cross-referencing the ship-run instance instead of claiming uniqueness.

Left uncorrected, the main spec actively misleads: a future reader looking for other instances of this pattern would read "this is the one" and stop.

**Decision 7: the invariant is "an observed value is never agent-writable"; the sweep covers every writer into the corpus.**

| Writer | Today | After |
|---|---|---|
| `recordOutcome` prompt (workflow host) | invites correction of all fields | asks only for `reported` values |
| `bin/interlock outcomes append` | accepts whatever the record file holds | rejects agent-supplied `observed` fields |
| `lib/outcomes.mjs appendOutcome` | flat payload | partitioned payload, enforced |
| ACP host closing path (`interlock-ship-acp:312`) | composes the record directly, no agent | same partition; its `observed` half is trustworthy by construction, and must still be written into the same shape |
| `interlock autonomy record` (strict only) | separate ladder store | out of scope — different file, different decision |

The ACP row matters: that host has no agent in the path, so it is tempting to let it write a flat record. It must not — one shape, or a reader has to know which host produced a line before interpreting it.

## Risks / Trade-offs

**Existing corpus lines are flat** → Records written before this change have no groups. Readers must handle both. Mitigated by the schema identifier: bump `OUTCOME_SCHEMA` so a reader can branch on shape rather than sniff for keys. Old lines stay readable, which the module's header already requires (*"Bump when the record shape changes, so old lines stay readable"*).

**Dependency on `add-ship-run-receipt`** → This change is inert without it. Accepted and made explicit rather than worked around; the standalone version (prompt fix only) is the alternative Decision 1 rejects.

**Rejection could lose a legitimately-corrected value** → If the script's observation were ever wrong, the agent can no longer fix it. Accepted deliberately: a mechanism that lets the assessed party correct the assessment's inputs is the defect. If a script observation is wrong, that is a bug to fix in the script, where it is testable.

**Two groups is a shape change to a corpus with few records** → Low cost now, and the cost only rises. Doing it before the corpus is used as evidence is the cheap moment.

## Migration Plan

Bump `OUTCOME_SCHEMA` to `interlock.outcome/2`. `readOutcomes` keeps returning every parseable line regardless of schema; consumers branch on the identifier. No rewrite of existing lines — the corpus is append-only and rewriting it would be the one operation its design forbids.

`.claude/learning/README.md` is written once and never clobbered (`ensureReadme`), so its "Contents of a record" section will describe the old shape on repositories that already have one. The task list includes updating the template for new repositories and noting that existing files are intentionally left alone.

Rollback is a revert plus accepting that `interlock.outcome/2` lines exist in the corpus. They stay parseable; a reverted reader sees the group objects as unrecognized keys and the top-level fields it expects as absent — so a revert should be paired with reading the schema identifier, which is why the bump matters more than the partition.
