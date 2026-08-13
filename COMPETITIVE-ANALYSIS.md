# Interlock vs. the spec-driven field

Competitive analysis, August 2026. Internal strategy doc — not user-facing plugin
documentation.

---

## What this compares against

Nine systems in the 2026 agentic spec-driven landscape:

| System | Shape | Scale / status |
|---|---|---|
| [GitHub Spec Kit](https://github.com/github/spec-kit) | constitution → specify → plan → tasks → implement, plus `/analyze` | 111k stars, 30+ agent integrations, MIT |
| [BMAD-METHOD](https://reenbit.com/bmad-method-token-budget-context-engineering-roi/) | 19+ agent personas, 50+ workflows, simulated agile team | v6.8, ~49k stars |
| [AWS Kiro](https://kiro.dev/docs/specs/) | Agentic IDE: specs / steering / hooks, EARS notation | GA March 2026, replaced Amazon Q |
| OpenSpec | Lightweight repo-resident delta specs (Interlock's substrate) | Highest overall in one Feb 2026 13-category eval |
| [GSD](https://docs.opengsd.net/core/introduction) | Context-engineering + parallel research/execution waves | ~48k stars |
| [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty) | 9-lane state machine, append-only event log, git worktrees | "code is truth, specs are deltas" |
| [Tessl](https://codemyspec.com/blog/tessl-review) | Spec-as-source maximalist + spec registry | $125M raised, still not GA after ~9 months beta |
| claude-flow / Ruflo | Swarm + hive-mind orchestration, SQLite shared memory | Orchestration, not spec-driven |
| [Claude Code Review](https://code.claude.com/docs/en/code-review) | 5 parallel review agents + confidence-scored verification pass | Anthropic, launched March 2026 |

Academic framing used throughout:

- [**Process taxonomy paper** (arXiv 2606.04967)](https://arxiv.org/abs/2606.04967) — scores six
  frameworks on **specification, context, roles, execution, validation, portability**. Its
  standing criticism of the category: these tools "prescribe neither independent verification,
  regulatory traceability, nor human governance gates."
- [**Refute-or-Promote** (arXiv 2604.19049)](https://arxiv.org/pdf/2604.19049) — adversarial
  multi-agent review failure modes.
- [**SlopCodeBench** (arXiv 2603.24755)](https://arxiv.org/html/2603.24755v1) — long-horizon
  agent degradation.
- [**Spec Kit Agents** (arXiv 2604.05278)](https://arxiv.org/html/2604.05278v1) — context-grounding
  hooks in staged spec workflows.
- [**SPECA** (arXiv 2602.07513)](https://arxiv.org/pdf/2602.07513) — specification-to-checklist
  agentic auditing.

---

## Where Interlock genuinely leads

### 1. Policy as tested code, not prose — the moat

Every competitor encodes caps, gates and thresholds in markdown that a model reads and can
rationalize past. Interlock moved eleven classes of decision into a Node CLI.

`lib/limits.mjs` states the thesis outright:

> a model reading a cap in prose treats it as guidance, and the whole point of a cap is that it
> is not.

Spec Kit's `/analyze` is the nearest analogue and it is still a model reading a constitution.
Nobody else has an `interlock gate` that blocks on a **count** rather than a judgement.

The taxonomy paper's central criticism — no independent verification, no traceability, no human
governance gates — is a list of three things Interlock has and the compared frameworks do not.

### 2. The zero-touch contract is structural, not promised

`ship` is a [dynamic workflow](https://code.claude.com/docs/en/workflows), not a skill. The
runtime accepts no mid-run input, so there is no `AskUserQuestion` to remove — nothing is
listening. Paired with `disable-model-invocation: true` on `commit` and `mr`, "the model cannot
decide to commit" becomes a property of the harness.

BMAD and Spec Kit both promise autonomy in prompts. GSD does waves, but the agent still holds the
loop. This is a categorically stronger guarantee, and the header comment in `workflows/ship.js`
(lines 7–30) argues it better than the README does.

### 3. Adversarial review with a quality band and published dismissal counts

Two skeptics per blocker/warning, survival by majority, then a quality floor applied *before* the
gate counts anything.

This converges independently on what Anthropic shipped in Claude Code Review (5 parallel agents +
a verification pass scoring confidence, reporting <1% of findings marked incorrect — a
vendor-reported figure measuring perceived, not ground-truth, correctness).

What almost nobody does — including Anthropic — is **report how many findings the skeptics
dismissed and how many the gate dropped as too weak**. `skills/review-code/SKILL.md` is right that
those counts are the evidence the review is worth reading, and that hiding them makes a verified
review look identical to an unverified one.

### 4. The invariant sweep — no equivalent found anywhere

`shared/INVARIANT-SWEEP.md` names a failure class the entire category is structurally blind to:
every gate is diff-scoped or artifact-scoped, so a change that canonicalizes a shared value cannot
see the stale readers — they live in files the diff never touched.

Interlock gives firing signals, a mandatory two-layer graph+grep sweep, and BLOCKER severity for
raw-form readers. This reads like it came from being bitten. It is a genuine contribution to the
field and would stand up as a short paper.

### 5. Decision ledger with audited evidence

`shared/DECISION-LEDGER.md` makes `agent_resolved` a **claim that gets audited**: it requires a
written resolution, followable evidence, *and* a `design.md` reference by id — or it blocks exactly
like `needs_human`. `interlock ledger` exits non-zero, so it is enforced rather than documented.

Kiro has EARS requirements; BMAD has role artifacts. Nobody has a machine-readable record of what
needed a human and whether it legitimately did not get one.

### 6. A deterministic retrieval layer

Augment Code's critique of this space — if failures cluster around cross-service coupling, the fix
is *a retrieval layer indexing the stack*, not a better orchestration graph over the same blind
spot — is an unintentional argument for `interlock-graph`.

Spec Kit, BMAD and OpenSpec have no retrieval layer; they grep. Local, no vectors, no network is
the right call, and it directly attacks the context-rot problem via locate-before-read.

### 7. Cost architecture

BMAD runs [$800–2,000/month/developer](https://reenbit.com/bmad-method-token-budget-context-engineering-roi/),
and the diagnosed cause is re-injecting the same standards documents into every agent invocation.

Interlock's tier→context ladder (`workflows/ship.js:258-263`) — tier 1 reads the task description
alone; only tier 4+ reads design and specs in full — attacks exactly that, as does "only tier 5 may
be opus, and the planner clamps over-eager opus."

One reported benchmark put the same CRM dashboard feature at 12 minutes on OpenSpec vs 5.5 hours on
BMAD. Interlock is on the right side of that curve.

### 8. Composition over forking

Driving the `openspec` CLI instead of forking its skills means zero drift on OpenSpec releases.
That is a maintenance edge that compounds, and no other framework in the space has chosen it.

---

## Where the field is ahead

### 1. Portability — the biggest strategic exposure

Spec Kit has 30+ agent integrations. OpenSpec supports dozens of assistants. BMAD ships web bundles
for Gemini Gems and ChatGPT Custom GPTs.

Interlock is Claude Code only, and depends on a *specific young runtime feature*: dynamic workflows,
[v2.1.154+](https://code.claude.com/docs/en/workflows), paid plans, opt-in on Pro. The plugin
workflow contract itself — the `workflows/` directory, `meta.name` namespacing, `disableWorkflows` —
has been stable. What moves underneath it is observable behavior: agent caps, the size guideline and
its default, the large-run warning threshold, and resume semantics have all changed across patch
versions since v2.1.154. None of those break the plugin, but each changes what a `ship` run does or
looks like, and Interlock has no way to pin them.

Portability is one of six scored dimensions in the taxonomy paper. Interlock scores near the bottom.

### 2. Spec drift is unanswered

The category's most-cited weakness, inherited from OpenSpec, whose answer reviewers describe as
*"you will manage spec drift by hand."*

[Thoughtworks](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
places SDD in "Assess," not "Adopt," largely over this. Kiro's answer is to delete specs once a
feature ships. Tessl bet a company on solving it and has not shipped in nine months.

Interlock's headline loop is bootstrap → spec → ship → mr. Sync and archive are not in it.

### 3. No isolation for parallel writers

Up to 8 agents run in one working tree, relying on *"tasks in a group must be independent of each
other"* — a **model judgement made at plan time**. If the planner mis-groups, two agents edit the
same file concurrently and the deterministic spine never sees it.

Spec Kitty gives each agent its own git worktree and claims 40% faster with 12 agents and no merge
conflicts. This is the one place where a correctness-critical decision is still prose.

### 4. Same-model skeptics carry correlated error

[Refute-or-Promote](https://arxiv.org/pdf/2604.19049) documents 80+ agents, including dedicated
adversarial reviewers, unanimously endorsing a Bleichenbacher padding oracle in OpenSSL's CMS module
**that did not exist**. Self-preference bias in LLM self-review is separately well documented.

Interlock's skeptics share a model family with its reviewers, and the survival rule (majority of
two) means **one** skeptic saying `isReal` keeps a finding. Skeptics are told to read the file, but
nothing checks that they did. [`ng/adversarial-review`](https://github.com/ng/adversarial-review)
uses cross-model skeptics for exactly this reason.

### 5. No conformance loop

The old 5GL/BDD critique applies: prose specs are not unambiguous, and nothing proves the code
satisfies them. Interlock verifies tests pass and reviews the diff, but nothing checks the
implementation against the delta spec's scenarios.

SPECA does spec-to-checklist auditing; Kiro's EARS notation is an attempt in the same direction.

### 6. Zero published evidence

538 CLI tests is good engineering, not proof the workflow produces better outcomes. Competitors have
numbers — contested and vendor-reported, but numbers. The outcomes corpus is the right instrument
and currently has no control group.

---

## Suggestions, prioritized

### P0 — Make wave independence a checked claim

Add path-overlap validation to `interlock waves`: reject a group where two tasks name overlapping
planned paths. The machinery exists — `lib/risk.mjs` already reasons over planned paths, and
`interlock ready --paths` already consumes them.

This is the last correctness-critical judgement still living in prose, which makes it the one most
out of step with the architecture's own thesis.

### P1 — Make skeptic verdicts carry evidence

Require every verdict to cite a `file:line` span it read, and reject verdicts without one in
`lib/findings.mjs`. This is the `agent_resolved` audit pattern applied to review — cheap, in
character, and the documented mitigation for the correlated-error failure mode.

Cross-model skeptics would be stronger still; per-tier model routing means the plumbing already
exists.

### P2 — Ship a drift gate (the leapfrog)

Spec→file links already exist in the graph, alongside `interlock-graph consumers`. An
`interlock drift` that reports *"spec X cites files changed in N commits since the spec was last
touched"* would be the first **deterministic** answer to the category's most-cited weakness.

Everyone else hand-waves it, deletes the spec, or is still in beta. This is roughly two days of work
to own the argument outright.

### P3 — Publish one honest benchmark

One representative brownfield feature, three runs: Interlock, stock OpenSpec, Spec Kit. Report
wall-clock, tokens, tasks completed, blockers found, tests green.

Even n=1 with loud caveats beats nothing, and it converts "architecturally better" into something a
reader can check.

### P4 — State the portability bet instead of apologizing for it

The README already says Cursor and Copilot are unsupported. Go further and make it a position:

> Interlock trades portability for enforcement. The guarantees come from the workflow runtime; a
> portable version of this would be a folder of prompts, which is the thing it exists not to be.

Then state the version floor and the runtime behaviors that move above it — the ones a user will
*observe* on a `ship` run and misread as an Interlock bug. `CLAUDE_CODE_SUBAGENT_MODEL` is the
sharpest: it overrides per-agent model routing, so it silently defeats the tier ladder the cost
argument rests on. `docs/04-when-it-stops.md` is the right home for the rest.

### P5 — Automated spec conformance

Generate a checklist from the delta spec's scenarios post-ship and have one agent verify each
against the implemented code. The manual test plan already exists; this is its automated sibling,
and it closes the oldest criticism of spec-driven anything.

### P6 — Wire the autonomy ladder or branch it

Honestly labeled as storage-only, which is to its credit, but it is cognitive surface paying no
rent. Give it one real branch or park it until it has one.

---

## Positioning

Everyone in this space competes on **how much structure you write before coding**. Spec Kit adds
phases, BMAD adds roles, Kiro adds an IDE, Tessl adds a registry. That axis is saturated, and the
[waterfall critique](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
lands on all of them.

Interlock competes on a different axis: **how many decisions the model is not allowed to make.**

That axis is better and underserved. The artifacts already argue it well — `lib/limits.mjs` and the
`workflows/ship.js` header are the two strongest pieces of writing in the repo, and neither appears
in the README's opening.

Lead with the split — *the script holds the loop, the CLI holds the rules, the agents do the work* —
because it is the thing no competitor can copy without rewriting themselves.

---

## Sources

- [spec-compare research](https://github.com/cameronsjo/spec-compare)
- [Reenbit — BMAD vs Spec Kit vs OpenSpec](https://reenbit.com/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework/)
- [Reenbit — BMAD token budget & ROI](https://reenbit.com/bmad-method-token-budget-context-engineering-roi/)
- [Process taxonomy (arXiv 2606.04967)](https://arxiv.org/abs/2606.04967)
- [Refute-or-Promote (arXiv 2604.19049)](https://arxiv.org/pdf/2604.19049)
- [SlopCodeBench (arXiv 2603.24755)](https://arxiv.org/html/2603.24755v1)
- [Spec Kit Agents (arXiv 2604.05278)](https://arxiv.org/html/2604.05278v1)
- [SPECA (arXiv 2602.07513)](https://arxiv.org/pdf/2602.07513)
- [Scott Logic — Spec Kit: radical idea or reinvented waterfall?](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
- [Augment Code — what spec-driven development gets wrong](https://www.augmentcode.com/blog/what-spec-driven-development-gets-wrong)
- [Augment Code — agentic swarm vs spec-driven coding](https://www.augmentcode.com/learn/agentic-swarm-vs-spec-driven-coding)
- [Thoughtworks — unpacking spec-driven development](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- [Claude Code — dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code — code review](https://code.claude.com/docs/en/code-review)
- [Kiro — specs documentation](https://kiro.dev/docs/specs/)
- [GSD Core — introduction](https://docs.opengsd.net/core/introduction)
- [Spec Kitty](https://github.com/Priivacy-ai/spec-kitty)
- [Tessl review (2026)](https://codemyspec.com/blog/tessl-review)
- [ng/adversarial-review](https://github.com/ng/adversarial-review)
