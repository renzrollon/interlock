# Explore Brief — Spec Contract

Durable handoff from `/interlock:explore` into `/interlock:spec`. Lives on disk
so `/interlock:spec` can reload discovery after prompt-cache expiry or `/clear`
without re-deriving it from chat.

**Path:** `.claude/handoff/explore-<slug>-<YYYYMMDD-HHMMSS>.md`  
Slug = topic or suggested change name in kebab-case. Same handoff directory
across a context reset.

**When to write**

- **Required** in autonomous explore mode (exit criterion).
- **Optional** in conversational explore when the user asks to “save
  exploration” / “handoff for spec”.

**Bound the brief** (~2–6k tokens): make it decision-oriented; cite paths and
line refs; prefer pointers over pasted code; ASCII diagrams when useful. The
brief carries conclusions into `/interlock:spec`, not an inventory of every
file the investigators touched.

---

## Template (stable — `/interlock:spec` depends on these headings)

```markdown
# Explore Brief: <slug>

## Meta
- mode: autonomous | conversational-capture
- topic: <one-line topic>
- created: <ISO-8601 timestamp>
- suggested_change_name: <kebab-case or none>
- related_change: <existing openspec change name or none>

## Problem / Intent
<!-- Crystallized problem statement and desired outcome -->

## Codebase Findings
<!-- Decision-relevant conclusions about how it works today, constraints and
     patterns. Cite file:line spans; do not enumerate every file touched. -->

## Critical Files
<!-- path:line — why it matters (citations over pasted code) -->

## Options Considered
<!-- Each option: tradeoffs + evidence; mark recommended vs rejected -->

## Recommended Direction
<!-- Chosen approach and why; pointer back to Options if needed -->

## Assumptions Made
<!-- Defaults taken when product intent was ambiguous -->

## Pending Clarifications
<!-- Only true product/policy unknowns that cannot be resolved from the repo.
     In autonomous mode: list for the human later — do not AskUser mid-explore. -->

## Risks / Gaps
<!-- What could go wrong; layers not swept; contradictions -->

## Spec Ready Checklist
- [ ] Problem / intent is clear enough to name a change
- [ ] Recommended direction is stated (or options narrowed to ≤2)
- [ ] Critical files listed with why
- [ ] Assumptions recorded
- [ ] Residual unknowns are product/policy only (not “I didn’t look”)
```

---

## Section rules

| Section | Rule |
|---------|------|
| **Codebase Findings** | Conclusions + cited `file:line` spans only. Omit exhaustive file inventories and raw investigator output. |
| **Critical Files** | Paths + line refs + why. No large code dumps. |
| **Options Considered** | Tradeoffs + evidence. Mark recommended vs rejected with rationale. |
| **Pending Clarifications** | Repo-unresolvable items only. Autonomous mode lists them; does not ask mid-explore. |
| **Assumptions Made** | Prefer reasonable defaults over blocking; record them here. |
| **Spec Ready Checklist** | If unchecked items remain that block a correct proposal, say so in chat when pointing at the brief. |

## Chat reply after write

Do **not** re-dump the full brief into chat. Reply with:

1. Path to the brief
2. A 3–5 line summary (intent + recommended direction + top risk)
3. “Ready for `/interlock:spec`” (or the Copilot/VS Code equivalent)

## Spec consumption

`/interlock:spec` auto-finds the latest matching brief under
`.claude/handoff/explore-*.md` (see that skill). Override: user passes an
explicit brief path. Prefer brief recommendations over re-exploring; reopen
code only for gaps or contradictions.
