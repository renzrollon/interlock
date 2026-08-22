# Session Shapes

Patterns that produce expert-level sessions. Use these as mental models when
starting a session — or let `/interlock:dispatch` orient you first.

The key insight: expert sessions are not longer or harder — they are better
structured from the start. The right shape chosen upfront eliminates
backtracking, scope drift, and wasted exploration. Score a live session against
these shapes and against `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`.

---

## Shape 1: Plan-then-Execute

**Duration:** 15-25 min | **Agents:** 4-6 | **Pattern:** think → structure → do

**Entry signal:** "I want to build X" — no active change exists, scope spans multiple files

**Flow:**
1. `/interlock:explore` (optional — skip if the domain is well-understood)
2. `/interlock:spec` — generates proposal, design, tasks, delta specs, then gates them through an artifact review and **stops at the human checkpoint**
3. Human reads the spec
4. `/interlock:ship` — dependency-ordered waves of parallel implementers → verify → commit

**Expert version:** State the full scope upfront. Let `spec` generate all artifacts
and pass Gate 1 in one pass. Read the spec once. `ship` handles execution in
parallel and produces one feature-level commit. No mid-session design changes.

**Common failure mode (advanced, not expert):** Starting to code before speccing.
Scope drifts mid-implementation. Multiple commits for what should be one logical
change. 30+ minutes because exploration and execution are interleaved.

**Preconditions for expert execution:**
- Clear one-sentence scope statement before starting
- No ambiguity about boundaries (what's in / out)
- Domain knowledge sufficient to skip the explore phase

---

## Shape 2: Structured Execute

**Duration:** 7-15 min | **Agents:** 3-13 (depends on task count) | **Pattern:** load → classify → do

**Entry signal:** "Ship the change" or "execute the tasks" — an active change with reviewed artifacts already exists

**Flow:**
1. `/interlock:ship` — the workflow loads all artifacts, classifies tasks, and runs them in dependency-ordered waves
2. Unit verification, then a single commit

**Expert version:** Artifacts already exist and passed the checkpoint in a prior
session. This session is pure execution — zero exploration, zero design decisions.
Fastest path to done. The workflow reads everything before writing anything.

**Common failure mode:** Re-implementing the change inline in the conversation
instead of launching the `ship` workflow. Making implementation decisions that
contradict the design doc. Speccing again when the spec is already reviewed.

**Preconditions for expert execution:**
- All artifacts exist and were reviewed (Gate 1 passed)
- Tasks are well-defined with clear acceptance criteria
- The Workflow tool is available (Claude Code v2.1.154+, dynamic workflows on)

---

## Shape 3: Investigate-then-Propose

**Duration:** 20-35 min | **Agents:** 2-5 | **Pattern:** understand → capture → structure

**Entry signal:** "How does X work? I might need to change it." — needs understanding before committing to a design

**Flow:**
1. `/interlock:explore` — fan out read-only investigators across subsystems, write a durable brief
2. Synthesize findings into a scope definition
3. `/interlock:spec` — convert understanding into durable artifacts (auto-loads the latest explore brief)
4. Stop at the checkpoint (or continue to ship in the same session if scope is small)

**Expert version:** Run `/interlock:explore` and let it fan out across threads
without asking which to follow; it writes `.claude/handoff/explore-<slug>-<ts>.md`.
Then `/interlock:spec` (possibly after `/clear` or cache expiry) auto-loads the
latest matching brief and generates proposal artifacts — no re-discovery from chat.

**Common failure mode:** Exploring in one long single-threaded chat. Findings live
only in chat history and are lost after `/clear` or prompt-cache expiry. Never
converting understanding into a spec or explore brief — the next session
re-discovers everything.

**Preconditions for expert execution:**
- Multiple subsystems or modules are involved (justifies fan-out)
- The question is specific enough to decompose into parallel investigations
- Memory / prior briefs are checked first (avoid re-investigating known territory)

---

## Shape 4: Targeted Fix

**Duration:** 5-12 min | **Agents:** 0-1 | **Pattern:** locate → fix → verify

**Entry signal:** "X is broken" or "fix the error in Y" — specific bug, narrow scope

**Flow:**
1. Check memory / known constraints about this area
2. Locate the issue (often a single file or function) — graph query or grep, not a full-file read sweep
3. Fix it
4. `/interlock:fix-tests` or run the suite to verify
5. `/interlock:commit` (or report if more investigation is needed)

**Expert version:** The relevant constraint is already known. No exploration needed
— go directly to the fix. Verify immediately. Done in under 10 minutes.

**Common failure mode:** Guessing at solutions without reading constraints. Trying
three wrong approaches before finding the right one. Exploring broadly when the fix
is narrow. Not running tests after the fix.

**Preconditions for expert execution:**
- The error is specific (not "something is slow" — that's Investigate-then-Propose)
- Scope is genuinely narrow (one file, one concept)
- If the fix touches a shared or derived value, its consumers are swept
  (`${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`)

---

## Shape 5: Workflow-Orchestrated

**Duration:** 10-40 min | **Agents:** 10-50+ | **Pattern:** script controls flow, agents do work

**Entry signal:** Complex work that benefits from deterministic orchestration — a reviewed change ready to ship, or a diff ready to review.

**Flow (ship):**
1. `/interlock:ship` launches `workflows/ship.js` on the Workflow runtime
2. Load artifacts → classify tasks (schema-validated) → execute in parallel waves
3. Inter-wave verification gates catch interface mismatches immediately
4. Unit verify, then commit. `--strict` adds adversarial review, remediation, handoff, conformance
5. Resumable — a stopped run picks up where it left off

**Flow (review):**
1. `/interlock:review-code` fans out up to six dimension reviewers (language, architecture, QA, delivery; devops and security when the diff earns them)
2. Two skeptics try to refute every blocker and warning; a dismissal must cite a `file:line` span
3. Only surviving findings reach you; the report states how many were dismissed

**Expert version:** The script holds the plan, not the model's context window.
Intermediate results stay in script variables, not chat history. Deterministic
retry logic instead of prompt-based "hopefully it retries."

**Common failure mode:** Re-implementing a workflow's job inline in the
conversation. Using a workflow for work that is genuinely sequential or needs a
human decision between steps.

**Preconditions for expert execution:**
- Tasks are independent (can parallelize without file conflicts)
- Verification commands are detectable (typecheck, test, lint)
- For `ship`: artifacts exist and passed Gate 1
- For `review-code`: implementation is complete (files to review exist)

---

## Shape 6: Agent-Team Investigation

**Duration:** 15-45 min | **Agents:** 3-6 persistent teammates | **Pattern:** debate → converge → decide

**Entry signal:** "The root cause is unclear" or "we need to investigate from multiple angles simultaneously" — when competing hypotheses need adversarial testing, not just parallel exploration.

**Flow:**
1. Spawn 3-5 teammates, each assigned a different hypothesis or angle
2. Teammates investigate independently AND challenge each other's findings
3. The debate structure surfaces the theory that survives scrutiny
4. The lead synthesizes consensus into a decision or a spec

**Expert version:** Unlike a workflow fan-out (which collects results silently),
agent teams *communicate*. Teammate A finds evidence that contradicts Teammate B's
theory and messages them directly. The adversarial communication is the value — it
prevents anchoring on the first plausible explanation.

**Best use cases:**
- Debugging with an unclear root cause (an investigator per hypothesis)
- Architecture decisions with genuine tradeoffs (an advocate per approach)
- Cross-layer coordination where subsystem owners negotiate interfaces

**Common failure mode:** Using teams for work that's purely mechanical parallelism
(use a workflow instead). Teams add coordination overhead — only worth it when
agents need to *talk to each other*.

**Preconditions:**
- Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings
- The problem has multiple plausible approaches / causes (not a single clear path)
- Value comes from inter-agent communication, not just parallel execution

---

## Shape Selection Heuristic

When in doubt, start with the simplest shape that fits:

```
Specific error + narrow scope           → Targeted Fix
"Ship the tasks" + reviewed artifacts    → Structured Execute
"Build X" + clear scope                  → Plan-then-Execute
"How / why / what if" + broad scope      → Investigate-then-Propose
Reviewed change ready, or a diff to vet  → Workflow-Orchestrated (ship / review-code)
Unclear root cause + competing theories  → Agent-Team Investigation
```

If you pick Targeted Fix and discover the scope is broader than expected, escalate
to Investigate-then-Propose. If you pick Plan-then-Execute and the change is already
reviewed, downgrade to Structured Execute. Shape classification is a starting point,
not a commitment.

**Choosing between Workflow and Agent Team:**
- Tasks are independent and the orchestration is known → Workflow (deterministic, cheaper)
- Agents need to communicate, challenge, or negotiate → Agent Team (higher cost, richer coordination)

---

## Anti-Patterns (What NOT to Do)

| Anti-Pattern | Why It Fails | Instead |
|-------------|-------------|---------|
| "Explore everything first" | Burns 20 min before any output | Pick a shape, start executing |
| "Let me read the whole codebase" | Context window fills with irrelevant code | Query the graph / read artifacts, then act |
| "I'll figure out the approach as I go" | Leads to backtracking and scope drift | Classify shape, announce scope, then execute |
| "Just one more thing…" | Scope creep extends sessions past 30 min | Handoff + new session for new scope |
| Single-threading work that could parallelize | 3x wall-clock for independent tasks | `ship` or an explore fan-out |
| Re-implementing `ship` inline | Context fills, intermediate results lost | Launch the `ship` workflow — results stay in script variables |
| Bridging `spec` → `ship` automatically | Skips the one human checkpoint | Stop at the checkpoint; let the human read |

---

## Expertise Level

**expertise_level**: Rate the USER's demonstrated expertise in the domain/task of THIS
   session — command of its terminology, structures, and conventions — ONCE for the WHOLE
   conversation, from the user's turns only. Rate domain familiarity with the work AT HAND,
   NOT general intelligence, NOT the agent's performance, NOT task difficulty (a senior
   engineer can be a beginner at Rust or differential privacy). Weigh three CO-EQUAL signals
   together:
   - Setup specificity: does the framing use named entities/constraints that require domain
     knowledge to even reach for? Naming files/paths visible on screen is NOT domain
     knowledge — anyone using the agent does that.
   - Verification type: generic asks ("please double-check", "are you sure?") are epistemic
     humility, not expertise; targeted asks ("did you actually call commit()?", "what's the
     cardinality of that join?") require knowing WHAT to check.
   - Direction of correction: the agent correcting the user's terminology/mental model pulls
     DOWN (1-2); the user catching the agent's domain mistakes pulls UP (4-5); neither
     correcting the other is neutral.
   Emit exactly ONE value (default `2_beginner` only when there's nothing to go on, e.g. a
   warmup session):
   - `1_novice` — generic/imprecise framing, no domain names; verification absent or fully
     generic; doesn't notice wrong output; agent supplies basic domain concepts.
   - `2_beginner` — some correct terms used loosely; mostly generic verification; pushes back
     only on obvious errors; agent reframes the user at least once. A fluent technologist
     working OUTSIDE their domain lands here.
   - `3_intermediate` — precise at a directive level (names files, outputs, libraries) but
     doesn't engage methodology/tradeoffs; mix of generic and targeted checks; catches
     meaningful mistakes. A domain expert delegating a routine task can also land here.
   - `4_advanced` — structural domain knowledge NOT readable off the screen (a specific edge
     case, non-obvious constraint/invariant, version-specific behavior, known failure mode);
     moderately specific verification; catches at least one of the agent's domain mistakes;
     the agent doesn't have to correct the user's domain model.
   - `5_expert` — insider-only jargon/conventions, unprompted tradeoff discussion, surgical
     verification, authoritative corrections invoking specific technical reasoning,
     preemptive edge-case handling. Direction of correction is user->agent. "Insider talking
     to an equal," even in a short session.
