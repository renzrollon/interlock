---
name: explore
description: Deep codebase reconnaissance with parallel read-only investigators — fans out automatically when a question spans multiple subsystems, options, or cross-cutting concerns, then synthesizes one coherent picture. Use before designing a change, when tracing how something works end to end, or when you need to know the blast radius of touching a shared value.
license: MIT
compatibility: Optional openspec CLI for change awareness. Node.js >= 18 for the bundled interlock-graph CLI.
argument-hint: "[question] [--autonomous]"
allowed-tools: Bash(interlock-graph *) Bash(openspec *) Agent Read Grep Glob
metadata:
  type: discovery
  autonomy_level: L2
  outputs:
    - .claude/handoff/explore-<slug>-<timestamp>.md
    - openspec/changes/<name>/decisions.md
---

Think deeply. Fan out when breadth is needed. Synthesize into understanding.

**Explore is for thinking, not implementing.** Read files, search code, investigate freely — but never write code and never implement a feature here. If asked to implement, say so and point at `/interlock:spec`. Writing OpenSpec artifacts or an explore brief is capturing thinking, not implementing, and is allowed.

---

## Two modes

**Conversational (default).** A thinking partner. Ask the user which thread to pull when several look interesting. Iterate.

**Autonomous.** Activate on `--autonomous`, "no questions", "don't ask me", "pursue all threads", or when `/interlock:spec` invokes this skill. Then:

1. **No user Q&A.** No AskUserQuestion, no "which thread interests you?" menus. Open threads are work items, not questions.
2. **Fan out on every thread.** Each interesting thread or option gets a read-only investigator. Cap 2–5, merge in synthesis.
3. **Prefer defaults.** Ambiguous product intent → pick a reasonable default, record it under Assumptions Made and Pending Clarifications. Non-blocking. Every one of them is also a ledger row — see below.
4. **Write the explore brief.** Required exit criterion. Follow `${CLAUDE_PLUGIN_ROOT}/shared/EXPLORE-BRIEF.md`. Path: `.claude/handoff/explore-<slug>-<YYYYMMDD-HHMMSS>.md`.
5. **Close short.** Brief path plus a 3–5 line summary. Do not re-dump findings into chat — they are in the brief.

---

## Graph-first reconnaissance, before any fan-out

Follow Rule 0 of `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`. If the graph exists, seed scopes then fan out:

```bash
interlock-graph query "<subsystem tokens>" --budget 1500
interlock-graph consumers <symbol-or-field>
interlock-graph path <A> <B>
```

Scope investigators by real module nodes and consumer lists. Each investigator: graph, then grep for string-keyed and dynamic readers, then Read spans. If the graph is missing and the question spans 3+ subsystems, build it once (`interlock-graph build .`). Never rebuild when it already exists.

---

## When to fan out

**Fan out** when the question shows any of these:

| Signal | Example |
|--------|---------|
| Multiple subsystems touched | "How does deployment work end to end?" |
| Comparative analysis needed | "Redis or SQLite for this?" |
| Cross-file tracing required | "What validates the uploaded archive?" |
| Several options to research | "What are our options for real-time?" |
| Architecture mapping | "Map how auth flows through the system" |

**Mandatory fan-out — shared or derived value changes.** If the change alters what a value *means* or who reads it, run Pattern 4 per `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`. This overrides the single-threaded default.

**Stay single-threaded** for conversational back-and-forth, single-file questions, quick clarifications, sequential discovery where A informs B, or when the user is thinking out loud.

When genuinely unsure, start single-threaded and escalate once you realize the question is broader than it looked.

---

## The four patterns

**Pattern 1 — Subsystem mapping.** The question spans several parts of the system. One investigator per stage of the flow. Synthesize into a diagram plus narrative.

**Pattern 2 — Option comparison.** Several viable approaches. One investigator per option, each reporting fit against *this* codebase, not generic pros and cons. Synthesize into a comparison table plus a recommendation.

**Pattern 3 — Layer sweep.** "Where does X happen?" when X could happen at several layers. One investigator per layer (client, API, business logic, persistence, post-processing). Synthesize into what each layer catches and where the gaps are.

**Pattern 4 — Impact analysis.** A change would alter what a value means or who reads it. One investigator per **disjoint** layer of the blast radius. Synthesize into an impact map with severity per area, and explicitly flag readers still consuming the raw, untransformed form.

---

## Investigator rules

1. **Focused prompts.** Not "explore everything about X" — "trace the exact flow of Y through files A, B, C".
2. **Read-only.** Investigators search, read, and report. They never write.
3. **Structured returns.** JSON only (schema below). No narrative dump.
4. **2–5 agents.** Fewer than 2 is not a fan-out; more than 5 means the decomposition is too granular.
5. **Disjoint scopes.** Non-overlapping assignments so findings merge cleanly. For Pattern 4 this is load-bearing: partition the search space so no reader is missed or double-counted.
6. **Label clearly** so progress is visible.
7. **Use `subagent_type: "Explore"`** for read-only investigation.
8. **Context hygiene.** Wrap user-supplied values per `${CLAUDE_PLUGIN_ROOT}/shared/CONTEXT-HYGIENE.md` before echoing them into a subagent prompt.
9. **Locate before Read** — graph, then grep, then Read spans.

### Prompt template

```
Investigate: [[SPECIFIC_QUESTION]]

Context: [[BROADER_TOPIC]]

Look for:
- [specific thing 1]
- [specific thing 2]

Return JSON only:
{ "files": [{ "path": "", "lines": "" }], "how": "", "connections": [], "gaps": [] }
```

Resolve `[[SPECIFIC_QUESTION]]` and `[[BROADER_TOPIC]]` from session state at emit time. **An unresolved placeholder halts the fan-out — never gap-fill one.**

---

## Synthesis

After investigators return, you **must** synthesize. Never dump raw agent output.

1. **Merge overlapping findings** — agents often reach the same file from different angles.
2. **Build one unified picture** — a diagram where structure matters.
3. **Name the gaps** — what did no agent find? What is still unclear?
4. **Surface contradictions** — when two agents disagree, say so; do not silently pick one.
5. **Run a completeness check.** Before closing, ask what is missing: a layer not swept, a reader not checked, an option not costed. **For Pattern 4 this is mandatory** — if any layer of the blast radius went uncovered, say so outright. A silent gap reads as "we covered everything" when you didn't.
6. **Offer direction.** What is worth exploring next? In autonomous mode, pursue it or record it in the brief rather than asking.

The result should read like a senior engineer who just debriefed four specialists — not like four reports stapled together.

---

## OpenSpec awareness

```bash
openspec list --json          # is there an active change?
```

When a change exists, read its artifacts via `openspec status --change "<name>" --json` for context, and offer to capture decisions as they crystallize:

| Insight | Captured in |
|---|---|
| New or changed requirement | `specs/<capability>/spec.md` |
| Design decision | `design.md` |
| Scope change | `proposal.md` |

---

## Every ambiguity becomes a ledger row

Follow `${CLAUDE_PLUGIN_ROOT}/shared/DECISION-LEDGER.md`. Do not restate its format.

- `## Pending Clarifications` → `needs_human` rows.
- `## Assumptions Made` → `agent_resolved` rows with followable evidence (`obvious` is not evidence).
- Never only chat — a conversational answer still gets a row citing the human.

Active change → write `openspec/changes/<change>/decisions.md` now and run `interlock ledger <change>`. No change yet → number them `D1`, `D2`, … in the brief (class stated) so `/interlock:spec` transcribes them. Never renumber; never reuse an id.

---

## Exit

Conversational mode ends when the user has what they need.

Autonomous mode ends by writing the explore brief and reporting its path — the brief is what `/interlock:spec` reads instead of re-deriving discovery. Writing it is how explore pays forward.
