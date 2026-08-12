# Interlock Hardening Plan

**Date:** 2026-08-12  
**Status:** Implemented 2026-08-12 — all sixteen `OPEN` decisions resolved (§7), every phase delivered except the items explicitly deferred in §5  
**Basis:** Architecture review of Interlock vs carl-workflow (skills, workflows, loops)  
**Canvas:** `~/.cursor/projects/Users-caro-IdeaProjects-interlock/canvases/interlock-architecture-review.canvas.tsx`

---

## 0. Thesis (do not lose)

Interlock’s **default** product cut stays correct:

```
bootstrap → spec → (human reads artifacts) → ship → mr
```

The gap between `spec` and `ship` remains the cheapest place to catch a wrong idea — and it remains the **default**.

Polish means: **anything a computer can decide correctly lives in code**; judgement stays with the model; humans are interrupted only when a decision is genuinely required.

**Opt-in exception (planned, not default):** a continuity mode may proceed from reviewed artifacts straight into `ship` when a deterministic readiness gate says the change is implementable *and* no `needs_human` decisions remain. If a real decision is required, stop and flag the human — never invent product policy to keep going.

This plan closes the gap between README claims and what the harness actually enforces — without collapsing Interlock back into carl’s full `openspec-flow` ceremony, and without making auto-continue the default.

---

## 1. Current state (verified)

| Layer | Interlock today | carl-workflow |
|---|---|---|
| Wave **planning** | `lib/waves.mjs` `planWaves` + CLI (+ `maxParallel`) | `workflows/_lib/waves.mjs` includes plan **and** `runWaves` |
| Wave **execution** | Prose in `skills/ship/SKILL.md` | `runWaves` engine |
| Surface / gate schemas | `lib/surface.mjs`, `lib/findings.mjs` | Same ideas; gate orchestration in `review-core` |
| Adversarial review | Prose + dimension briefs; `TOLERANCE_BAND` **exported unused** | `runAdversarialReview` applies quality band |
| Remediation | Prose “cap 2 rounds” in ship | `runRemediation` |
| Verify | Prose in ship | `runVerify` |
| Autonomy storage | `lib/autonomy.mjs` + CLI (tested) | Same + **`getLevel()` drives flow pauses** |
| Zero-touch | `disallowed-tools: AskUserQuestion` on ship | Prose claim; AUQ still used in full flow |
| OpenSpec boundary | Compose CLI (good) | More forked skill surface |
| Docs for adopters | README only | `docs/` methodology, decision-tree, etc. |

**Cognitive load:** ~14 skills + spine CLI + graph CLI + shared contracts + OpenSpec ≈ 40+ named concepts before a first successful loop.

---

## 2. Guiding principles

1. **Port invariants, not the whole carl tree.** Prefer `interlock <subcommand>` (or a small nested runner) over re-checking in `workflows/openspec-flow.js`.
2. **Skills stay portable fallbacks** when no engine exists — but do not claim code-enforcement for prose-only loops.
3. **Honesty over marketing.** If a feature records trust but does not spend it, demote it from the README until wired.
4. **User surface ≠ implementation surface.** Keep internals; hide them from first-hour docs.
5. **Leave product forks as `OPEN`.** Implement only after the decision section is resolved (or explicitly “defer”).
6. **Default = human checkpoint; continuity is earned and opted into.** Auto-continue must fail closed (stop + flag), never fail open (guess and ship).
7. **Interrupt on decisions, not on ceremony.** If the only reason to stop is “a human should look,” and readiness + decision ledger are clean, continuity may proceed *when explicitly requested*.

---

## 3. Workstreams

Legend: **P0** = correctness / false confidence · **P1** = adoption · **P2** = depth / parity · **P3** = polish

Effort: **S** ≤1 day · **M** 2–4 days · **L** ≥1 week

---

### WS-A — Correctness & false-confidence (P0)

#### A1. Agent (and related) allowlists  
**Effort:** S · **Priority:** P0 · **Decision:** Ready to implement

**Problem:** `ship`, `explore`, `bootstrap`, `review-code` require subagents but omit `Agent` from `allowed-tools`. If the field is a hard allowlist, fan-out silently cannot run.

> **Premise corrected 2026-08-12 (step 1 result).** `allowed-tools` is **not** a hard allowlist. Per the Claude Code skills docs: *"It does not restrict which tools are available: every tool remains callable, and your permission settings still govern tools that are not listed."* It is a per-turn **pre-approval**. `disallowed-tools` is the restrictive field ("tools removed from Claude's available pool") — which is why `ship`'s `AskUserQuestion` removal is genuine enforcement. The subagent tool is named `Agent` and is `Permission required: No` in the default mode.
>
> **Consequence:** fan-out was never silently broken; A1 is not the P0 correctness bug it was filed as. The change is still worth making, with a narrower rationale: under a user's own restrictive permission rules, a subagent-spawning skill can stall on an approval prompt, and in `ship` — sold as zero-touch, with AUQ removed — an unexpected prompt is exactly the interruption the contract forbids. Implemented as a consistency invariant, not a bug fix.

**Plan:**
1. ~~Confirm Claude Code semantics for `allowed-tools` (hard allow vs soft hint)~~ — **done**, see note above.
2. Add `Agent` (and any required companion tools) to every skill that instructs “spawn subagents.”
3. Extend `test/skills.test.mjs` with a rule: if SKILL.md body matches `/Agent tool|spawn.*subagent|Spawn one agent/i`, frontmatter `allowed-tools` must include `Agent`.
4. Re-smoke `/interlock:ship --apply-only` on the mini fixture or a toy change.

**Acceptance:**
- [ ] Allowlist includes `Agent` wherever subagents are required
- [ ] Structural test fails if prose requires Agent but frontmatter omits it
- [ ] Documented in CHANGELOG under Fixed

**Files:** `skills/{ship,explore,bootstrap,review-code,review-artifacts?}/SKILL.md`, `test/skills.test.mjs`

---

#### A2. Apply `TOLERANCE_BAND` in the review path  
**Effort:** S · **Priority:** P0 · **Decision:** Ready (implementation shape `OPEN` — see §4.1)

**Problem:** `lib/findings.mjs` exports `TOLERANCE_BAND = { minQualityToReport: 3, drift: 1 }` but nothing calls it. Carl’s `review-core.mjs` drops surviving-but-low-quality findings before the gate.

**Plan:**
1. Add a pure function, e.g. `applyToleranceBand(findings, band = TOLERANCE_BAND)` → `{ reportable, dropped }`.
2. Call it from `interlock gate` **or** document that skills must filter before gate (prefer CLI so prose cannot skip it).
3. Unit tests mirroring carl’s quality-2 drop case.
4. Update `skills/review-code/SKILL.md` to say: after skeptics, pipe JSON through `interlock gate` (which applies the band) — do not re-implement thresholds in markdown.

**Acceptance:**
- [ ] Quality &lt; `minQualityToReport` never blocks a gate
- [ ] Gate / findings tests cover drop + report counts
- [ ] README “two skeptics” section mentions quality band (one sentence)

**Files:** `lib/findings.mjs`, `bin/interlock` (gate), `test/spine/findings.test.mjs`, `skills/review-code/SKILL.md`

---

#### A3. Autonomy: wire or demote  
**Effort:** M (wire) / S (demote) · **Priority:** P0 · **Decision:** `OPEN` — see §4.2

**Problem:** Ladder CLI is tested and skills **record** outcomes, but nothing **reads** `interlock autonomy level` to change control flow. README still sells “earned autonomy.”

**Option W — Wire (carl-like, Interlock-shaped):**
- After `review-artifacts` / `review-code`, skills call `interlock autonomy level <path>`.
- At L3: skip the *wait-for-human* presentation only where Interlock still has one (today: mainly the intentional gap after `spec` — which we may **never** auto-skip; see open decision).
- Realistic Interlock wiring may be narrower than carl: e.g. L3 only skips *re*-confirmation inside ship substeps (manual-test-plan acknowledge, explain-code “ready?”), not the spec→ship gap.

**Option D — Demote until run data:**
- Move “Earned autonomy” to README Notes / CHANGELOG “experimental storage only.”
- Skills keep recording (cheap, preserves future wiring).
- No user-facing L2/L3 in summaries.

**Acceptance (either option):**
- [ ] README matches behavior
- [ ] No skill claims “gates your workflow” unless `getLevel` changes a branch
- [ ] CHANGELOG notes the choice

---

#### A4. Scrub predecessor residue  
**Effort:** S · **Priority:** P0 · **Decision:** Ready

**Problem:** Agent-visible strings still say Carl / propose / grill / old skill names.

**Checklist:**
| Location | Change to |
|---|---|
| `lib/graph/graph/report.mjs` | `# Interlock Graph Report` |
| `lib/graph/extract/walk.mjs` comment | Interlock / `.claude` home |
| `shared/EXPLORE-BRIEF.md` | “Ready for `/interlock:spec`”; drop or rename `source_grill` |
| `shared/TOOL-ECONOMY.md` | “spec should not re-pay” (not propose) |
| `shared/CONTEXT-HYGIENE.md` | `/interlock:mr` not `openspec-create-pr` |
| `shared/INVARIANT-SWEEP.md` | `/interlock:review-code` / `/interlock:ship` not `review-ts` / `apply-change` |

**Also:** Extend `test/skills.test.mjs` banned-pattern scan to `shared/` + `lib/` for: `Carl Graph`, `source_grill`, `review-ts`, `openspec-create-pr`, `apply-change` (as skill name). Keep author “Carl Rollon” in plugin metadata / LICENSE.

**Acceptance:**
- [ ] Grep clean for banned agent-facing strings
- [ ] Tests enforce the ban list on `lib/` + `shared/`

---

### WS-B — Orchestration engines (P0/P2)

#### B1. Decide extraction shape for runners  
**Effort:** decision only · **Priority:** P0 · **Decision:** `OPEN` — see §4.3

Three viable shapes:

| Shape | Pros | Cons |
|---|---|---|
| **B1-a** Port engines into `lib/` + `interlock run-*` CLI | Matches existing spine; skills stay thin | Large port; need DI for Agent in CLI (awkward) |
| **B1-b** Vendor a tiny `workflows/` runner (Claude Workflow JS) | Closest to carl; real loops | Second runtime; Interlock marketed as plugin+CLI |
| **B1-c** Keep prose ship; harden with more CLI checkpoints | Smallest diff | Does not fix bitrot risk; marketing must stay honest |

**Recommendation (non-binding):** Prefer **B1-a hybrid** — port *pure* loop controllers that accept injected `{ agent, parallel, log }` like carl, expose `interlock remediate|verify|review` that skills shell out to for policy decisions, while Agent fan-out stays in the skill/harness. Do **not** re-port full `openspec-flow.js`.

**Until decided:** Treat B2–B4 as design spikes, not merge targets.

---

#### B2. Remediation engine (after B1)  
**Effort:** M–L · **Priority:** P2 · **Depends:** B1

Port carl `remediate.mjs` policy:
- Blockers always fix; suggestions always defer (hard policy)
- Group by file; no parallel same-file
- ≤2 rounds; re-review only dimensions that raised findings
- Unresolved blockers → halt

Interlock today: prose in `skills/ship/SKILL.md` § remediates.

**Acceptance:**
- [ ] Shared policy module + unit tests with fake agent primitives (carl pattern)
- [ ] `ship` invokes module/CLI; does not restate triage rules in full
- [ ] Round / halt behavior tested

---

#### B3. Adversarial review engine (after B1)  
**Effort:** M–L · **Priority:** P2 · **Depends:** B1, A2

Port skeptic majority + quality band + metrics emit from `review-core.mjs`.
Dimension briefs stay markdown (judgment).

**Acceptance:**
- [ ] Survival rules tested without live model
- [ ] Dismissed + quality-dropped counts appear in review report
- [ ] `review-code` skill becomes thin orchestrator + briefs

---

#### B4. Verify engine (after B1)  
**Effort:** M · **Priority:** P2 · **Depends:** B1

Port durable test-profile consumption, unit-green required, coverage advisory, e2e run-not-fix, root-cause clustering budget from `verify.mjs` / TEST-PROFILE.

**Acceptance:**
- [ ] Ship never invents test commands when profile exists
- [ ] Hard halt on red unit suite (already prose — must be engine-enforced)
- [ ] Skip reasons always printed (`VERIFICATION SKIPPED: reason=…`)

---

#### B5. Wave **execution** helpers (optional depth)  
**Effort:** L · **Priority:** P2 · **Depends:** B1 · **Decision:** `OPEN` — see §4.4

`planWaves` already ahead on `maxParallel`. Optional: inter-wave verify ≤2, replan ≤2, trailing test wave halt rules as code.

**Until engines land:** Keep ship prose caps aligned with carl numbers (document the constants in one place, e.g. `lib/limits.mjs`).

---

### WS-C — Adoption & simplification (P1)

#### C1. First-hour docs (4 pages)  
**Effort:** S · **Priority:** P1 · **Decision:** Ready

Create `docs/` (human-facing; not `shared/`):

| Doc | Job |
|---|---|
| `docs/01-first-hour.md` | Install → bootstrap → one `spec` → read → `ship` → done. Explicit do-not-run list |
| `docs/02-the-checkpoint.md` | How to review proposal/design/tasks/specs in ~10 minutes; when to re-spec |
| `docs/03-openspec-vs-interlock.md` | Compose not replace; when stock `/openspec-*` is OK |
| `docs/04-when-it-stops.md` | Loud halts vs soft continues; e2e red banner; missing Agent; validate fail |

**README change:** Lead with three commands; demote full skill table under “Advanced / called by those.” Link the four docs.

**Acceptance:**
- [ ] New engineer can complete a toy loop from docs alone
- [ ] Autonomy / graph / dispatch not in first-hour path

---

#### C2. Demote advanced surface in UX copy  
**Effort:** S · **Priority:** P1 · **Decision:** Ready (naming tweaks `OPEN` — §4.5)

**Keep user-invocable primary:** `bootstrap`, `spec`, `ship`, `mr`  
**Mark advanced in README + skill descriptions:** `dispatch`, `graph`, `docs-digest`, `explore`, `review-*`, `fix-tests`, `explain-code`, `commit`, `manual-test-plan`

Optional metadata: `user-invocable: false` or description prefix `"(advanced)"` — confirm Claude plugin semantics before flipping.

---

#### C3. Loud failure banners  
**Effort:** S · **Priority:** P1 · **Decision:** Ready

In `ship` (and bootstrap where relevant), always print in the final summary:

| Condition | Banner |
|---|---|
| Graph build failed / empty structural | `GRAPH UNAVAILABLE: … explorers will be slower` |
| No `.claude/testing/profile.json` | `NO TEST PROFILE: run /interlock:fix-tests --reconfigure once` |
| Verification skipped | `VERIFICATION SKIPPED: reason=…` |
| E2E red but commit allowed | `E2E FAILED (non-blocking by policy): …` |
| Autonomy demoted / unused | Do not print L2/L3 if Option D |

Also: stop swallowing graph failure with `2>/dev/null || true` without a visible line (`skills/bootstrap/SKILL.md`).

---

#### C4. Archive / post-ship “done” story  
**Effort:** S · **Priority:** P1 · **Decision:** `OPEN` — see §4.6

Loop diagram ends at `mr`. Carl had archive/sync. Interlock should either:
- Document “use stock `openspec archive` after merge,” or
- Add thin `/interlock:archive` wrapper

---

### WS-D — Tests & observability (P1/P2)

#### D1. Fake-agent integration tests for policies  
**Effort:** M · **Priority:** P1 · **Depends:** B2/B3 or a minimal stub

Carl pattern: inject `{ agent, parallel, log }` and assert round caps / survival. Interlock’s 171 tests cover pure spine + skill structure only.

**Minimum before engines:** Test A2 tolerance + A1 allowlist rules (done in WS-A).

**With engines:** Port carl’s remediate/review-core test cases.

---

#### D2. Metrics / ladder visibility  
**Effort:** M · **Priority:** P2 · **Decision:** `OPEN` — see §4.7

Carl had `gsd-metrics`. Interlock may want:
- `interlock autonomy state` (exists?) surfaced in dispatch summary
- Optional `.claude/metrics/` emit from review/ship

Defer until autonomy decision (A3) lands.

---

#### D3. Session resume in dispatch  
**Effort:** M · **Priority:** P2 · **Decision:** `OPEN` — see §4.8

Carl dispatch loads memory + handoff. Interlock dispatch is a thin routing table. Optional: read `.claude/handoff/*` and `.claude/memory/MEMORY.md` in preflight.

Not required for first-hour path if dispatch stays advanced.

---

### WS-E — Distribution & drift (P2/P3)

#### E1. Claude-only badge / install honesty  
**Effort:** S · **Priority:** P2 · **Decision:** Ready

README + plugin description: explicit “Claude Code plugin (Cursor/Copilot not supported in 0.x).”

---

#### E2. Shared package vs dual maintenance  
**Effort:** decision · **Priority:** P2 · **Decision:** `OPEN` — see §4.9

`surface` / `autonomy` / `findings` will drift from carl `_lib`. Options: npm workspace publish, git subtree, or “Interlock is upstream; carl vendors.” Pick before next major carl engine change.

---

#### E3. Dimension brief depth  
**Effort:** M · **Priority:** P3 · **Decision:** `OPEN` — see §4.10

Current dimension files are short (~10–20 lines). Carl had full persona skills. Decide whether brevity + skeptics is enough, or port richer rubrics.

---

### WS-F — Opt-in continuity (spec → ship without default human read)

**Priority:** P1 (design) / P2 (ship) · **Default flow unchanged** · **Decisions:** `OPEN` §4.12–§4.16

Today `skills/spec/SKILL.md` hard-stops: *“Do not run ship… The checkpoint is the point.”* That remains correct as the default. This workstream adds a **non-default** path that can continue into implementation when — and only when — the agent can decide everything an implementer needs without inventing product policy.

---

#### F0. Problem analysis — what the human gate is actually for

The human is not “approving markdown.” They are substituting for judgments the agent cannot yet make reliably:

| Human job at checkpoint | Reliably automatable? | How |
|---|---|---|
| Catch a **wrong idea** (builds the wrong thing) | **No** — not from artifacts alone | Only weak proxies: similarity to past accepted changes, explicit intent match to user utterance, living-spec conflict detectors |
| Resolve **product/policy unknowns** | **No** | Must remain `needs_human` interrupts |
| Accept / reject **assumptions** | **Partially** | Safe defaults can be pre-declared; risky assumptions escalate |
| Confirm **blast radius** (auth, data, breaking API, migrations) | **Partially** | Risk classifier + hard stop above a threshold; human accepts or rejects continuity |
| Check **implementability** (tasks actionable, deps ordered, scenarios testable) | **Yes** | `validate` + stronger `review-artifacts` + new `ready` gate |
| Check **evidence** for bug-fixes | **Yes** | Existing evidence gate; encode in readiness |
| Check **invariant sweep** completeness | **Mostly yes** | Graph consumers + review-artifacts blocker (already) |
| Spot **ambiguity in tasks** (“update accordingly”, “as needed”) | **Mostly yes** | Lint tasks for weasel words; blocker if found |

**Conclusion:** You cannot *reliably* remove the human gate for all changes. You can reliably **skip it for a subset** where (1) no `needs_human` decisions remain, (2) structural readiness passes, (3) risk class is allowed for auto-continue, and (4) the user opted in. Everything else must stop and flag.

Wrong idea risk never goes to zero without a human. Continuity mode accepts residual product risk in exchange for speed — so it must be **opt-in**, **fail-closed**, and **auditable**.

---

#### F1. What the agent must decide alone to implement a written OpenSpec change

Before any auto-continue into `ship`, the agent (via deterministic checks + bounded judgment) must be able to answer **yes** to all of the following. Anything unanswered → interrupt, do not ship.

**A. Intent lock**
- [ ] Change name and one-line intent match the user’s request (no silent scope expansion)
- [ ] Feature vs bug-fix classification is recorded
- [ ] Bug-fix: repro + log/error evidence present (existing gate)

**B. Decision ledger empty of humans**
- [ ] Every item from explore `Pending Clarifications` / design open questions is classified:
  - `agent_resolved` — assumption recorded in design with rationale, **or**
  - `needs_human` — must interrupt
- [ ] Zero `needs_human` remain
- [ ] No pinned-version / secret / policy / pricing / legal / multi-tenant boundary questions left open (spec skill already forbids guessing versions)

**C. Artifacts are implementable (not merely present)**
- [ ] `interlock validate` passes (proposal, design, tasks non-empty, real checkboxes)
- [ ] `review-artifacts` has **zero blockers** (warnings: policy `OPEN` — §4.14)
- [ ] Every `#### Scenario:` maps to at least one task (or explicit “covered by task N”)
- [ ] Tasks have no weasel phrases (`appropriately`, `as needed`, `etc.`, `handle edge cases`) without concrete acceptance
- [ ] Task graph is wave-classifiable (no circular “depends on everything”)
- [ ] Invariant-sweep consumers enumerated when applicable

**D. Risk class allows continuity**
- [ ] Risk classifier output ∈ allowlist for `--continue` (see F3)
- [ ] If risk is elevated: continuity **forbidden** unless human previously accepted that risk class for this change (explicit ack)

**E. Runtime readiness for ship**
- [ ] Test profile exists **or** continuity policy allows discover-on-ship (prefer: require profile for continuity)
- [ ] Graph optional but: if language is structurally unsupported, continuity still OK if docs/specs indexed (document limitation)
- [ ] Agent tool available (else ship cannot fan out — hard stop)

**F. Learning / autonomy gates (once F4 exists)**
- [ ] Continuity not disabled by recent auto-continue failure streak
- [ ] Optional: earned path autonomy L3 for `spec`/`review-artifacts` (ties to §4.2 — do not require this for v1 of `--continue`)

These become a **machine-checkable** `interlock ready <change> --json` (or `validate --ready`) that returns `{ ready, blockers[], decisions[], riskClass, scores }`. Skills must not re-derive readiness in prose.

---

#### F2. Decision ledger (interrupt protocol)

Explore already has `Pending Clarifications` + `Assumptions Made`. Spec sometimes asks mid-flight. Continuity needs a **single durable ledger** the readiness gate can read.

**Proposed artifact:** `openspec/changes/<name>/decisions.md` (or `.claude/handoff/decisions-<name>.json` — shape `OPEN` §4.13)

```markdown
# Decisions — <change>

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Pin zod version? | needs_human | — | — |
| D2 | Use existing Session helper vs new | agent_resolved | Reuse lib/session.ts | explore brief §Critical Files |
```

**Rules:**
1. During explore/spec: every ambiguity becomes a ledger row — never only chat.
2. `agent_resolved` requires a written assumption in `design.md` (link by id).
3. Continuity mode: if any `needs_human` → **stop**, present only those rows (AskUserQuestion / short list). Do not dump the whole spec.
4. After human answers: write resolutions, re-run `interlock ready`, then continue if clean.
5. `ship` remains AUQ-disallowed; any interrupt happens **before** ship starts (in `spec --continue` or a thin `flow` wrapper).

**Flag-the-human UX (continuity path only):**
- Title: `Continuity paused — N decisions need you`
- Show only `needs_human` rows + risk class + path to artifacts
- Actions: answer inline → resume; or `abort continuity` (leave artifacts for default checkpoint)

---

#### F3. Risk classifier (fail closed)

Deterministic-ish signals from artifacts + paths (extend `surface`-style pure module):

| Signal | Suggested class |
|---|---|
| Docs/typo/test-only paths | `low` |
| Single-module feature following existing pattern | `low`–`medium` |
| New public API / schema / migration | `high` |
| Auth, session, permissions, tenancy | `high` |
| Deletes data, changes idempotency, payment | `critical` |
| Invariant sweep / shared value transform | at least `medium` |

**Continuity policy (recommended default):**
- `low`: may auto-continue when opted in + ready
- `medium`: may auto-continue only if review-artifacts clean **and** learning score OK (or always require human — `OPEN` §4.14)
- `high` / `critical`: **never** auto-continue; always human checkpoint

Encode in `lib/risk.mjs` + `interlock risk <change> --json`.

---

#### F4. Learning / feedback corpus — do we need it?

**Short answer:** Not required to *ship* a v1 `--continue` flag. **Required** if you want continuity to get safer over time rather than roulette.

Existing `.claude/memory/` captures failure-modes/coupling from ship — useful for implementers, **not** structured enough for “should we have skipped the human?”

**Add a separate learning file (recommended):** focused on **outcome of the planning→ship loop**, not code gotchas.

**Proposed layout:**

```
.claude/learning/
  README.md                 # agent+human: what this corpus is for
  outcomes.jsonl            # append-only; one record per change attempt
  SCORECARD.md              # optional human-readable rollup (generated)
```

**Each `outcomes.jsonl` line (schema draft):**

```json
{
  "ts": "ISO-8601",
  "change": "add-user-auth",
  "mode": "checkpoint" | "continue",
  "riskClass": "low",
  "ready": true,
  "decisionsHuman": 0,
  "reviewArtifacts": { "blockers": 0, "warnings": 1 },
  "ship": { "ok": true, "remediationRounds": 1, "unitGreen": true, "codeBlockersSurviving": 0 },
  "human": {
    "intervened": false,
    "wouldRejectSpec": null,
    "notes": ""
  },
  "scores": {
    "implementability": 0-5,
    "specFidelity": 0-5,
    "postShipChurn": 0-5
  },
  "feedback": "optional free text from human after the fact"
}
```

**How agents use it:**
1. **Eligibility:** refuse `--continue` for `medium` if last N auto-continues in this repo had `ship.ok=false` or human `wouldRejectSpec=true` above threshold.
2. **Prompt context:** before writing tasks, retrieve 3 similar past outcomes (“last time we auto-continued a medium API change, review-code found X”).
3. **Calibration:** after ship, auto-write scores from metrics (blockers, remediation rounds); invite human feedback only when mode was `continue` or ship halted.

**What we should *not* do:**
- Treat memory prose as a score
- Let the model “feel confident” without reading outcomes
- Require a large corpus before enabling the flag (cold start = risk-class + ready gate only)

**Phasing:**
- **F4a (with v1 continue):** append outcome records automatically; no eligibility gating yet
- **F4b:** eligibility gating + SCORECARD rollup
- **F4c:** retrieve-similar into explore/spec prompts

---

#### F5. User-facing continuity option (not default)

**Recommended CLI/skill surface:**

| Invocation | Behavior |
|---|---|
| `/interlock:spec "…"` | **Default** — write + review artifacts → stop at checkpoint (unchanged) |
| `/interlock:spec "…" --continue` | After clean artifact review, run `interlock ready`; if ready → invoke ship; if not → flag human with ledger + blockers only |
| `/interlock:spec "…" --continue --force-checkpoint` | Opt out mid-flight (always stop) |
| `/interlock:ship` | Unchanged — assumes human already accepted (or continuity already passed ready) |

**Alternative shape (`OPEN` §4.12):** `/interlock:flow "…"` = explore+spec+ready+ship wrapper; `spec` never gains `--continue`. Keeps `spec` pure. Slightly more surface area.

**Hard rules:**
1. Continuity is **never** implied by autonomy L3 alone (until §4.2 explicitly says so — recommend independence for v1).
2. README diagram keeps the amber human node as the default path; continuity is a footnote / advanced flag.
3. First-hour docs do **not** teach `--continue`.
4. When continuity pauses for decisions, **do not** ask the human to “read the whole spec” — ask them to answer the ledger rows. Offer “open artifacts” as secondary.

**Ship under continuity:** still `disallowed-tools: AskUserQuestion`. Any new decision discovered mid-ship uses documented defaults + summary report, same as today — if that’s unacceptable for the risk class, readiness should have blocked continuity earlier (tighten classifier, don’t re-open AUQ inside ship).

---

#### F6. Implementation slices

| ID | Work | Effort | Depends |
|---|---|---|---|
| **F6.1** | `lib/risk.mjs` + `interlock risk` + tests | S–M | none |
| **F6.2** | Decision ledger template + explore/spec write rules + shared doc | S | §4.13 |
| **F6.3** | `interlock ready` combining validate + ledger + risk + artifact metrics | M | F6.1–2, review-artifacts metrics path |
| **F6.4** | `spec --continue` (or `flow`) wiring: ready? → ship : interrupt | M | F6.3, §4.12 |
| **F6.5** | Learning `outcomes.jsonl` append from spec/ship | S–M | §4.15 |
| **F6.6** | Eligibility gating from outcomes | M | F6.5 cold-start data |
| **F6.7** | Docs: advanced continuity page; README footnote | S | after F6.4 |

**Acceptance (v1 continuity):**
- [ ] Default `/interlock:spec` still stops at checkpoint (tested structurally)
- [ ] `--continue` with empty `needs_human` + `low` risk + validate clean → invokes ship
- [ ] `--continue` with any `needs_human` → does **not** invoke ship; prints ledger only
- [ ] `--continue` with `high`/`critical` risk → does not invoke ship; tells human why
- [ ] Outcome line appended for both checkpoint and continue modes
- [ ] README states continuity is opt-in and fail-closed

---

#### F7. Relationship to earned autonomy (A3 / §4.2)

Do **not** conflate:

| Mechanism | Question it answers |
|---|---|
| Human checkpoint (default) | “Should a person read this spec?” |
| `--continue` / ready gate | “May we skip the read *this run* because opted in + safe enough?” |
| Earned autonomy L2→L3 | “Has this *path* been clean enough that we trust fewer pauses?” |

**Recommended v1:** `--continue` is an explicit user flag; autonomy ladder may later *suggest* continuity or auto-enable for `low` risk after N clean continues — but never silently flip the default diagram.

Update §4.2 when continuity lands: Option W must specify that L3 does **not** by itself bridge spec→ship unless combined with ready + risk policy.

---

## 4. Open decisions

Resolve these before (or as the first commit of) the dependent workstream. Record the choice in this file under **Decision log** (§7).

### 4.1 Where does `TOLERANCE_BAND` run?
- **(a)** Inside `interlock gate` (recommended — unskippable)
- **(b)** Inside review-code skill only (weaker)
- **(c)** Both (CLI authoritative; skill documents)

**Blocks:** A2 final shape

### 4.2 Autonomy product behavior
- **(W)** Wire `getLevel` into flow (specify *which* waits may skip)
- **(D)** Demote to experimental storage-only until real run data (recommended for 0.1.x)
- **(H)** Hybrid: record + show level in summaries; never auto-skip

**Constraint (once WS-F exists):** L3 alone must **not** silently bridge the default spec→ship gap. Continuity uses `--continue` + `ready` (+ optional later: L3 as eligibility boost). Revisit when §4.12–§4.16 land.

**Blocks:** A3, D2, F7

### 4.3 Runner extraction shape
- **(a)** `lib/` engines + CLI policy subcommands + skill-owned Agent fan-out (recommended)
- **(b)** Claude `workflows/*.js` runner in-plugin
- **(c)** Prose-only ship; honesty pass on README; engines later

**Blocks:** B2–B5

### 4.4 How much of `runWaves` to port?
- **(full)** inter-wave verify, replan, halt thresholds
- **(lite)** planWaves + constants module; execution stays prose
- **(none)** status quo

**Blocks:** B5

### 4.5 Primary vs advanced skills mechanism
- README-only demotion
- Frontmatter `user-invocable: false` / similar
- Separate “advanced” plugin skill group if supported

**Blocks:** C2 implementation detail

### 4.6 Archive in the loop?
- Document stock OpenSpec archive only
- Add `/interlock:archive`
- Add archive step inside `mr` (probably wrong)

**Blocks:** C4

### 4.7 Metrics in 0.x?
- Defer entirely
- Emit review dismiss/drop counts only (cheap, supports README claim)
- Full session manifests (carl-like)

**Blocks:** D2

### 4.8 Dispatch resume richness?
- Keep thin (recommended while advanced)
- Port carl memory/handoff preflight

**Blocks:** D3

### 4.9 Relationship to carl-workflow repo
- Interlock becomes source of truth for spine libs; carl vendors/copies
- Shared private package
- Accept intentional fork; sync by hand occasionally

**Blocks:** long-term drift management (E2)

### 4.10 Dimension brief richness?
- Keep thin + skeptics (current)
- Port carl persona depth into `dimensions/*.md`
- Hybrid: thin default; `--deep` loads extended briefs

**Blocks:** E3

### 4.11 Out of scope confirmation (recommend: leave in carl)
Confirm these stay **out** of Interlock 0.x unless revisited:
- Full `/openspec-flow` one-shot with durable pause/resume
- Agent Teams
- Copilot loops / VS Code / Cursor install matrix
- Grill as required product step
- `--legacy-*` rollback flags
- Guardrail YAML / pattern library roadmap items

**Default:** Yes — out of scope. Change only via explicit decision log entry.

### 4.12 Continuity entrypoint shape
- **(a)** `/interlock:spec --continue` (recommended — one skill, flag opt-in)
- **(b)** Separate `/interlock:flow` that chains spec→ready→ship; `spec` stays pure-stop
- **(c)** Both (`flow` as alias)

**Blocks:** F5, F6.4

### 4.13 Decision ledger storage
- **(a)** `openspec/changes/<name>/decisions.md` (versioned with the change — recommended)
- **(b)** `.claude/handoff/decisions-<name>.json` (runtime; may vanish)
- **(c)** Embed only in explore brief + design (no new file — weaker for gating)

**Blocks:** F2, F6.2

### 4.14 Continuity strictness
For `--continue` eligibility:
- **(strict)** ready requires: 0 artifact blockers, 0 warnings, 0 needs_human, risk∈{low}, test profile present
- **(balanced)** 0 blockers, warnings OK, 0 needs_human, risk∈{low,medium}, test profile present (recommended)
- **(loose)** 0 blockers, 0 needs_human, risk∈{low,medium,high} with high requiring typed ack

Also: may warnings alone block continuity? **Recommend:** no for balanced; yes for strict.

**Blocks:** F1, F3, F6.3

### 4.15 Learning corpus scope for v1
- **(a)** Append `outcomes.jsonl` only; no eligibility gating (recommended for cold start)
- **(b)** Append + gate on failure streak immediately
- **(c)** Defer learning files entirely until N real continues in dogfood

**Blocks:** F4, F6.5–6

### 4.16 May continuity ever become default?
- **(no)** Never default in 0.x/1.x — flag forever (recommended until strong outcome data)
- **(repo-opt-in)** Default per-repo via `.claude/settings` after eligibility
- **(autonomy-linked)** Default when path is L3 + risk low

**Blocks:** README diagram, C1 first-hour docs, F7

---

## 5. Phased delivery

> **Status 2026-08-12:** Every phase is implemented (uncommitted; 527 tests green, up from 171; `claude plugin validate --strict` passing). All sixteen open decisions in §4 are resolved and logged in §7.
>
> Deliberately **not** built, per the decisions taken: **F6.6** eligibility gating on the learning corpus (§4.15a — records accumulate, nothing reads them), **D3** dispatch resume (§4.8 keep thin), **E3** richer dimension briefs (§4.10 keep thin), and the **§4.2 D→W** autonomy upgrade, which the plan itself gates on run data that does not exist yet.

### Phase 0 — Honesty & safety (do now, ≤2 days) — **DONE**
Independent of open decisions (use Option D defaults where needed):

1. **A1** Agent allowlists + test  
2. **A4** Carl/propose/grill scrub + ban tests  
3. **A2** TOLERANCE_BAND in gate (assume 4.1a unless overruled)  
4. **A3-D** Demote autonomy in README (can upgrade to W later)  
5. **C3** Loud failure banners (ship + bootstrap)  
6. **E1** Claude-only honesty line  
7. README claim audit: rewrite any sentence that implies code enforcement for prose-only loops

**Exit:** No false-confidence claims; ship can actually fan out; agent-facing strings are Interlock-native.

### Phase 1 — Adoption (≤1 week, parallelizable) — **DONE** (except the semver call)
1. **C1** Four docs + README shrink (default path still shows human checkpoint)  
2. **C2** Advanced demotion  
3. **C4** after §4.6 decision  
4. CHANGELOG + version bump notes (0.1.1 or 0.2.0 — `OPEN` semver)

### Phase 1.5 — Continuity foundations — **DONE**
1. **F6.1** risk classifier  
2. **F6.2** decision ledger  
3. **F6.3** `interlock ready`  
4. **F6.5** outcomes append (if 4.15 ≠ c)  
5. Design spike writeup in this plan’s decision log

**Exit:** Ready gate exists; default `spec` unchanged; no auto-ship yet (or behind explicit flag in dogfood only).

### Phase 2 — Engines — **DONE**
1. Spike chosen shape on **remediate** only (smallest policy loop)  
2. **B3** review engine  
3. **B4** verify engine  
4. Optionally **B5** wave execution  
5. **D1** fake-agent tests alongside each engine

### Phase 2.5 — Continuity flag — **DONE**
1. **F6.4** `--continue` or `flow` wiring  
2. **F6.7** advanced docs + README footnote  
3. Dogfood on `low` risk changes only

### Phase 3 — Depth — **PARTIAL** (D2 metrics done; F6.6, D3, E2, E3 and the §4.2 upgrade deliberately deferred)
1. §4.2 upgrade Demote → Wire if run data supports it  
2. **F6.6** learning eligibility gating  
3. **D2** metrics  
4. **D3** dispatch resume  
5. **E2** / **E3** as needed  
6. Shared package or sync ritual with carl  
7. Revisit §4.16 only with outcome data

---

## 6. README claim → action map

| Claim | Action |
|---|---|
| Decisions stay in code, not prose | Phase 0 honesty pass; Phase 2 engines; **F6.3 ready gate** |
| Two skeptics on every finding | Keep prose; **A2** makes quality band real; **B3** makes skeptics engine-real |
| Earned autonomy gates workflow | **A3** demote or wire; **must not** silently mean auto-ship (F7) |
| Zero-touch / AUQ removed | Keep for **ship**; continuity interrupts happen *before* ship |
| One human checkpoint | Keep as **default**; document `--continue` as advanced opt-in |
| Composes OpenSpec | Keep; **C1** doc 03 |
| Language support caveats | Keep; **C3** loud graph unavailable |

---

## 7. Decision log

| Date | ID | Choice | Decided by | Notes |
|---|---|---|---|---|
| 2026-08-12 | 4.1 | **(a)** inside `interlock gate` | Carl | Band applied in `evaluateGate` after the dismissed filter; `band: null` opts out. Skills must not re-implement thresholds in markdown. |
| 2026-08-12 | 4.2 | **(D)** demote | Carl | README "Earned autonomy" → "Experimental", stated as storage-only. Skills keep recording. Revisit with run data (Phase 3). |
| 2026-08-12 | 4.3 | **(b)** in-plugin workflow runner, **hybrid shape** | Carl | See §4.3-addendum below — the runtime's constraints force policy into `lib/` + CLI and leave only loop/branching in the script. `ship` becomes workflow-only. |
| 2026-08-12 | 4.4 | **(full)** | Carl | Inter-wave verify, replan and halt thresholds ported as a pure state machine in `lib/waves.mjs`; caps centralised in `lib/limits.mjs`. |
| 2026-08-12 | 4.5 | README demotion only | Carl | Four primary skills in a table; the other ten behind a `<details>` block. No frontmatter `user-invocable` flip until plugin semantics are confirmed. |
| 2026-08-12 | 4.6 | Document stock `openspec archive` | Carl (implementer default) | No `/interlock:archive` wrapper — "increasing skill count" is an explicit non-goal (§8). Covered in `docs/01-first-hour.md`. |
| 2026-08-12 | 4.7 | Dismiss/drop counts only | Carl | `lib/metrics.mjs` writes `.claude/metrics/review-<change>-<ts>.json` with four counts and no finding text. Backs the README's "that number is the evidence" claim. |
| 2026-08-12 | 4.8 | Keep dispatch thin | Carl (documented default) | D3 not implemented. Dispatch stays a routing table while it remains advanced surface. |
| 2026-08-12 | 4.9 | Interlock is upstream; carl vendors | Carl | Binding constraint on every spine module: dependency-free, no imports outside `lib/`, pure where possible. E2 needs no packaging work. |
| 2026-08-12 | 4.10 | Keep dimension briefs thin | Carl (documented default) | E3 not implemented. Thin briefs + two skeptics is the bet. |
| 2026-08-12 | 4.11 | Confirmed out of scope | Carl (documented default) | Full one-shot flow with durable pause/resume, Agent Teams, multi-IDE matrix, grill, `--legacy-*`, guardrail YAML all stay out of 0.x. |
| 2026-08-12 | 4.12 | **(a)** `/interlock:spec --continue` | Carl (documented default lean) | One skill, flag opt-in. No separate `/interlock:flow`. Interrupts happen in `spec`, before ship — which matters more than it did, since workflows cannot take mid-run input. |
| 2026-08-12 | 4.13 | **(a)** `openspec/changes/<name>/decisions.md` | Carl (documented default lean) | Versioned with the change. `lib/ledger.mjs` + `shared/DECISION-LEDGER.md`. |
| 2026-08-12 | 4.14 | **(balanced)** | Carl (documented default lean) | 0 blockers, warnings OK, 0 `needs_human`, risk ∈ {low, medium}, test profile present. Encoded in one named constant so it can be re-tuned in a single edit. |
| 2026-08-12 | 4.15 | **(a)** append-only | Carl (documented default lean) | `outcomes.jsonl` written for both modes; no eligibility gating (F6.6 deferred until real cold-start data exists). |
| 2026-08-12 | 4.16 | **(no)** never default in 0.x | Carl (documented default lean) | Continuity stays an explicit flag. README diagram keeps the amber human node as the default path. |

### §4.3 addendum — why (b) became a hybrid

`(b)` was chosen for real code-held control flow. Verifying the runtime against the
[dynamic workflows docs](https://code.claude.com/docs/en/workflows) before building surfaced three
constraints that reshape it:

1. **No module loading** — *"a script that contains `import()` fails before the run starts"*. A workflow script cannot import `lib/*.mjs`.
2. **No filesystem or shell access from the script itself** — only the agents it spawns read files and run commands.
3. **No mid-run user input** — the docs' own advice is *"For sign-off between stages, run each stage as its own workflow"*.

So the engines cannot be modules the script consumes. The resulting shape, confirmed with the decision owner:

- **Policy lives in pure `lib/*.mjs`**, exposed as `interlock remediate|review|verify|waves|risk|ready`. Unit-testable without a model, and vendorable per §4.9.
- **The workflow script holds the loop and branching**, and its agents shell out to those subcommands for every decision.
- **`ship` becomes workflow-only** (`workflows/ship.js`, invoked as `/interlock:ship`). The skill is removed rather than kept as a fallback.

Consequence accepted knowingly: Interlock now **requires Claude Code v2.1.154+ with dynamic workflows
enabled**. Where `disableWorkflows` is set, an org blocks them, or the plan has not enabled them,
there is no ship path. This must be stated in the README requirements and in `docs/01-first-hour.md`.

Constraint 3 also strengthens the case for §4.12(a): continuity interrupts must happen in `spec`,
because the ship workflow structurally cannot ask.

When a decision lands, append a row and update the matching workstream status in §3.

---

## 8. Non-goals (explicit)

- Replacing OpenSpec
- Multi-IDE install matrix in 0.x
- Making the spec→ship gap the **default** auto-continue path (opt-in only; see WS-F / §4.16)
- Claiming we can eliminate wrong-idea risk without a human
- Re-enabling `AskUserQuestion` inside `ship` to “fix” continuity mid-implement
- Porting carl pain-point CLAUDE.md snippets as spine code
- Increasing skill count for symmetry with carl

---

## 9. Suggested first PR slices

| PR | Contents | Depends on decisions |
|---|---|---|
| **PR-1** | A1 + A4 + banlist tests | none |
| **PR-2** | A2 tolerance in gate + tests + review-code wording | 4.1 (default a) |
| **PR-3** | A3 demote + README honesty + E1 + claim audit | 4.2 default D |
| **PR-4** | C3 banners | none |
| **PR-5** | C1 docs + C2 README demotion | 4.5 default |
| **PR-6** | Engine spike (remediate only) | **4.3 required** |
| **PR-7** | F6.1 risk + F6.2 ledger template + explore/spec write rules | 4.13 |
| **PR-8** | F6.3 `interlock ready` + tests | 4.14 |
| **PR-9** | F6.4 continuity flag + F6.5 outcomes append + F6.7 docs footnote | **4.12, 4.14, 4.15, 4.16** |

---

## 10. References

- Interlock: `README.md`, `CHANGELOG.md`, `lib/`, `skills/`, `shared/`, `test/`
- carl-workflow: `workflows/_lib/{waves,review-core,remediate,verify,surface,autonomy}.mjs`, `docs/methodology.md`, `docs/workflow-authoring.md`, `docs/roadmap-harness-engineering.md`
- Review agents (2026-08-12): architecture map, carl polished patterns, gap analysis, UX simplification
- Continuity analysis: WS-F in this plan (human gate jobs, ready checklist, decision ledger, learning corpus)