---
name: dispatch
description: Route a request to the right specflow skill, after one batched pre-flight that loads git state, OpenSpec status, open tasks and graph presence in a single pass. Use when you are not sure which skill applies, or at the start of a session to orient before doing anything else.
license: MIT
compatibility: Optional openspec CLI and git. Node.js >= 18 for the bundled specflow CLI.
allowed-tools: Bash(git *) Bash(openspec *) Bash(specflow *) Bash(specflow-graph *) Read Glob
metadata:
  type: routing
  autonomy_level: L2
---

Figure out where the user actually is in the flow, then route. One cheap pre-flight beats an exploratory warm-up.

---

## Step 0 — Pre-flight, batched

Run these **in one turn**, joined with `;` not `&&` — you want every answer regardless of which ones fail:

```bash
git branch --show-current; git status --short; git log --oneline -5
openspec list --json 2>/dev/null
specflow changes 2>/dev/null
ls -t .claude/handoff/explore-*.md 2>/dev/null | head -3
ls .claude/graph/GRAPH_REPORT.md .claude/graph/DOCS_DIGEST.md 2>/dev/null
```

That is Rules 2 and 3 of `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`: read state, do not re-derive it. Do not traverse the tree to reconstruct what these already tell you.

---

## The flow

```
graph → docs-digest → bootstrap        (once per repo)
/specflow:spec    explore → artifacts → review     ⟵ STOPS. Human reviews.
/specflow:ship    waves → review → verify → commit  (zero-touch)
/specflow:mr      summary → merge request
```

The gap between `spec` and `ship` is deliberate. Never bridge it automatically — if a spec is ready, say so and let the user start ship.

---

## Routing table

| Situation | Route to |
|---|---|
| No `openspec/` directory, or no specs on an existing codebase | `/specflow:bootstrap` |
| No `.claude/graph/`, and the session will explore or review heavily | `/specflow:graph` (build) |
| Docs context too large, or the digest is stale | `/specflow:docs-digest` |
| "How does X work?", "what breaks if I change Y?", tracing, comparing options | `/specflow:explore` |
| "I want to build / fix X" — no change exists yet | `/specflow:spec` |
| A change exists with reviewed artifacts and unchecked tasks | `/specflow:ship` |
| Implementation done, diff needs review | `/specflow:review-code` |
| Artifacts written but not yet reviewed | `/specflow:review-artifacts` |
| Suite is red, or a CI log was pasted | `/specflow:fix-tests` |
| "Explain this code" / "what changed in that commit?" | `/specflow:explain-code` |
| Need a QA checklist for a change | `/specflow:manual-test-plan` |
| Work is done and needs committing | `/specflow:commit` |
| MR or PR needs creating or updating | `/specflow:mr` |

**Prerequisite checks before routing:**

- Routing to `ship` — run `specflow validate <change>` first. Not ready means route to `spec`, not ship.
- Routing to `spec` with no explore brief and a question that spans subsystems — run `explore` first.
- Routing to anything that reads the graph when `.claude/graph/` is absent — offer to build it once.

---

## Ambiguity

When two routes fit, prefer the **earlier phase**. Exploring when you should have specced costs one turn; shipping when you should have specced costs a bad change and a review cycle.

When the request genuinely does not fit any skill, say so and handle it directly. Not everything is a workflow, and forcing an ordinary question through a skill is worse than just answering it.
