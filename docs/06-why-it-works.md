# Why it works

The other five pages tell you what to run. This one is the argument underneath: which failure modes of agentic coding Interlock targets, the mechanism used against each, and what each mechanism costs. It assumes you have built with coding agents and have watched them fail.

It is long, and it is opinionated. Every number in it comes from a file you can read.

---

## 1. The three failure modes

Everything below is a response to one of these. If a mechanism does not map to one, it should not exist.

**Context rot.** Model accuracy degrades with context length even when every relevant token is present — [Chroma measured 13.9–85% degradation across 18 frontier models](https://www.trychroma.com/research/context-rot), and Liu et al. documented the positional "lost in the middle" effect. The practical consequence in a coding agent: an hour into a long task, an agent that was tracking three constraints is tracking one, and it does not announce which two it dropped.

**Plausibility over correctness.** LLMs are optimised to produce text that reads right. This is fine when the output is code that must compile and pass tests, and dangerous when the output is a *judgement* — "this finding is a false positive", "these tasks are independent", "two remediation rounds were enough". A wrong judgement in confident prose is indistinguishable from a right one.

**Silent degradation.** The compounding version of both. A run that lost the graph, skipped verification, and dismissed four real findings produces the same shape of summary as a clean one. What you cannot see, you cannot correct.

---

## 2. Where the plan lives, and why that decides everything

The single largest architectural choice: `ship` is a [dynamic workflow](https://code.claude.com/docs/en/workflows), not a skill.

| | Skill | Workflow |
|---|---|---|
| What it is | Instructions Claude follows | A script the runtime executes |
| Who decides what runs next | Claude, turn by turn | The script |
| Where intermediate results live | Claude's context window | Script variables |
| Orchestrator token cost | Every result re-enters context | Zero — the script is not a model |

Three consequences follow, and none of them are available to a folder of prompts.

**The orchestrator stops accumulating context.** In a skill-driven fan-out, every subagent result lands back in the orchestrating model's window. Thirty tasks means thirty results plus thirty prompts plus the plan, and by task twenty the orchestrator is reasoning at the degraded end of its own context curve — about scheduling decisions that determine what the remaining ten agents do. In a workflow, results land in `const` bindings. `workflows/ship.js` holds a `summary` object and a `banners` array; the model that wrote the script is not in the loop while it runs.

**Loop control stops being persuadable.** `ship` used to be `skills/ship/SKILL.md` — eleven numbered headings including "cap two remediation rounds". A model that has just spent forty minutes on a change is precisely the wrong party to ask whether it has earned a third round, and prose caps do not survive that conversation. The cap is now `LIMITS.remediationRounds` in `lib/limits.mjs`, read by a script that cannot argue.

**Zero-touch becomes structural.** The runtime accepts no mid-run user input. There is no `AskUserQuestion` to remove because nothing is listening. This is why every decision that could need a human must be settled *before* `ship` starts — and why the checkpoint between `spec` and `ship` exists at all.

The runtime imposes its own ceilings: 16 concurrent agents, 1,000 per run, no module loading (a script containing `import()` fails before it starts), and no filesystem or shell access from the script itself. That last one shaped the whole design. The script cannot run `interlock`; it must ask an agent to. Which turned out to be a feature — every policy decision is a CLI invocation with a testable exit code, and the script *cannot* quietly reimplement a rule it was supposed to obey.

---

## 3. The judgement/mechanism split

The organising principle: **a decision with a correct answer belongs in code; a decision requiring judgement belongs to the model.** Thirteen `interlock` subcommands exist because each replaces a judgement the model used to re-derive in prose, differently every run.

The test for whether something belongs in the CLI: *if two competent runs could reach different answers from the same inputs, and only one is right, it is not a judgement.*

```
workflows/ship.js   the loop, the branching, the intermediate results
interlock CLI       what the loop is allowed to do next
agents              read files, write code, run commands, form opinions
```

Two properties fall out. The policy is testable without a model — 590 tests, no network, no API key, most running in under a millisecond. And a skill can no longer restate a threshold, because the threshold is not written down anywhere a skill can read it except by shelling out.

`lib/limits.mjs` is the clearest instance:

```js
export const LIMITS = {
  maxParallel: 8,              // agents per batch
  interWaveFixAttempts: 2,     // targeted fixes after a failed inter-wave check
  replansPerRun: 2,
  remediationRounds: 2,        // review → fix → re-review cycles
  rootCauseIterations: 5,      // repair attempts against a red unit suite
  taskFailureHalt: 2,          // strictly more than this halts the run
  memoryEntriesPerRun: 3,
  interWaveVerifyBudgetMs: 60_000
}
```

Skills cite `interlock limits`; they never restate a number. When a cap changes, it changes once.

---

## 4. Token economy: three mechanisms, measured

Cost is not the point — degradation is. But the two are the same lever, and the numbers are worth being concrete about. For calibration, one published comparison put the same CRM feature at **12 minutes on OpenSpec, 90 on Spec Kit, 5.5 hours on BMAD**, with BMAD's frontier-model spend at **$800–2,000/month/developer**. The diagnosed cause of that spend was not reasoning — it was re-injecting the same standards documents into every agent invocation.

### 4.1 Context tiering: read what the work needs

Every implementer agent gets a context ladder keyed to its tier (`workflows/ship.js`):

```
tier 1  the task description, and nothing else
tier 2+ the relevant section of design.md
tier 3+ the relevant file under specs/
tier 4+ design.md and the specs, in full
```

A twelve-task change is not twelve full artifact reads. It is nine task descriptions and three spec sections. Tiers 1–2 additionally carry a stop instruction — *after typecheck and lint pass, stop; do not refactor or polish* — because the expensive failure at that tier is not a wrong edit, it is a correct edit followed by four hundred tokens of unrequested improvement.

### 4.2 Model routing, with a clamp

Tier maps to model: tier 1 → `haiku`, tiers 2–4 → `sonnet`, tier 5 → `opus`. The mechanical control-plane steps (`wave-state next`, `record-batch`, `replan`, `record-outcome`) are pinned to `haiku` — they parse JSON and report it verbatim, which does not need a frontier model.

The clamp is the part that matters. Classifiers reliably over-assign `opus` to anything touching several files, so `lib/waves.mjs` overrides it:

```js
if (task.tier < 5 || task.model !== 'opus') {
  task.model = task.model === 'haiku' ? 'haiku' : 'sonnet'
}
```

The rule stated in the classifier prompt — *a mechanical refactor across many files is tier 4 sonnet, because breadth is not depth* — is a prompt. The clamp is not. Every override is recorded in `plan.clamped` and printed, so the correction is visible rather than silent.

One environment variable defeats all of this: `CLAUDE_CODE_SUBAGENT_MODEL` overrides both the session model *and* a per-agent model a script requests. `ship` detects it and banners `MODEL ROUTING OVERRIDDEN` rather than reporting a clean run on which the entire ladder was bypassed.

### 4.3 Locate before you read

`shared/TOOL-ECONOMY.md` is a discipline every investigating skill loads. Rule 0: query the graph before you grep. Rule 1: locate the line, *then* `Read` with `offset`/`limit`. Never read a file sequentially to discover where something lives.

Retrieval is explicitly budgeted, in tokens estimated as `ceil(chars / 4)`:

| Command | Budget | Role |
|---|---|---|
| `DOCS_DIGEST.md` | ~2500 soft / ~3200 hard | Agent-only prose bootstrap |
| `interlock-graph context` | 2000 | Structural + documentation bundle |
| `interlock-graph docs` | 800 | Prose/domain context only |
| `interlock-graph query` / `consumers` | 1500 | Structural navigation |

`context` splits its budget 45/55 between structural and prose by default. The digest exists because the alternative — `find docs -exec cat` — is how a 40k-token preload happens, most of it irrelevant to the task.

**The exception is load-bearing.** When implementing against an active change, agents read `proposal.md`, `design.md`, `tasks.md` and the delta specs *in full*. Budgeted retrieval replaces exploratory preload, not the implementation contract. Getting this backwards produces an agent that budget-retrieves its own specification and implements two-thirds of it.

---

## 5. The wave engine

### 5.1 Isolation is the point

One agent per task, always, in parallel. Never inline in the orchestrator. That is not a throughput optimisation — it is context isolation, and implementing a task in the orchestrator's context defeats the entire mechanism. Each implementer gets a clean window containing its task, its tier's slice of the artifacts, and nothing about the other eleven tasks.

This also determines what a pause costs. The runtime's resume rule: **replay follows the order agents started, caching stops at the first agent that did not finish, and every agent started after it re-runs.** A run fanned out across many small agents therefore preserves far more progress across an interruption than one long agent — the work sitting behind the first unfinished agent is bounded by batch width, not by the whole task.

### 5.2 Independence is now checked

Tasks in a wave run concurrently **in one working tree**. Their independence was asserted by the classifier and verified by nothing — two agents editing one file concurrently is a lost write that nothing downstream notices.

The classifier now predicts a `paths` list per task, and `lib/waves.mjs` refuses to schedule a collision: the first claimant of a path keeps its slot, later ids move to a trailing wave. Recorded in `plan.regrouped` and in warnings, never silent.

```
Wave 1: 1.1, 1.3
Wave 3: 1.2
  regrouped 1.2: wave 1 → 3 (src/auth.ts held by 1.1)
```

**What this does not do:** `paths` is a model's prediction, so a task editing a file it never named is still unguarded. This narrows the race; it does not close it. The value is that the assumption is now *stated and checked* rather than assumed — an unpredicted collision is a wrong prediction, which is a thing that can be improved, rather than a silent property of the design.

`paths` is optional by design. A classifier that cannot predict must be able to say nothing: an invented path costs a wave of parallelism for no reason, while an omitted one leaves things exactly as they were.

### 5.3 Hardest first

Within a group, tasks sort by tier descending before batching. Groups run in parallel, so this only bites when a group exceeds `maxParallel` and splits — and then it decides which tasks are in batch one. The tier-5 task is the one whose failure means the design was wrong; discovering that in batch 1 rather than batch 4 saves the rest of the wave. This is Boehm's spiral ordering applied inside a wave. Ties break on id, so the same classified input always produces the same batches.

### 5.4 The loop is a state machine

`ship` does not decide what happens next. It asks `interlock wave-state next` and obeys one of six actions: `run-batch`, `test-wave`, `verify`, `replan`, `done`, `halt`.

Test tasks defer to a single trailing wave, so a cross-cutting test failure is diagnosed once against the finished implementation rather than repeatedly against half-built state. `record-batch` and `replan` pass `--write-state`, so their stdout *is* the next step — saving one agent turn per batch.

---

## 6. Verification: two contexts, deliberately different

The subtlest piece in the codebase, and worth understanding because collapsing it breaks a published contract.

`BLOCKING_KINDS` is `['typecheck', 'unit']` — short on purpose. Lint, coverage and e2e are reported, never enforced. But *which* blocking kind actually halts depends on the call site:

```js
export const VERIFY_CONTEXTS = {
  'inter-wave': { haltingKinds: ['typecheck', 'unit'] },
  final:        { haltingKinds: ['unit'] }
}
```

A red typecheck **between waves** must stop the next wave from building on broken ground. A red typecheck **at the final gate** is loud but not a halt — because `docs/04-when-it-stops.md` publishes an exhaustive list of hard halts, and a typecheck is not on it. A check cannot silently become a fourth halt because someone tidied the constants. `final` is the default, so a caller that forgot to say which site it is acquires the *stricter-documented* behaviour, not extra halts.

Skip reasons are machine-readable strings printed verbatim (`no-test-profile`, `failures-are-pre-existing`, `verify-budget-exceeded`, …) — part of the contract, extended but never reworded in place.

**A red unit suite is repaired by root cause, not by iteration.** Failures cluster by normalised error signature; the shared cause gets fixed once; `interlock verify repair` decides whether another iteration is allowed, bounded at `rootCauseIterations: 5`. And the anti-pattern is checked rather than forbidden in prose: given a baseline, the CLI verifies the suite did not go green by *shrinking*. A suite that passed because assertions were loosened is not green.

---

## 7. Review: making dismissal expensive

### 7.1 Why adversarial review at all

An unverified review reports everything it notices, so readers learn to skim, and the skimmed review catches nothing. Fan out six dimensions in parallel — language, architecture, QA, technical-lead always; devops when the diff touches deploy or config; security when it touches auth, input handling or data exposure — then put **two independent skeptics on every blocker and warning**. Suggestions pass unverified; they are cheap to ignore and not worth the tokens.

### 7.2 The asymmetry that governs everything

The two errors are not symmetric:

- A surviving false positive costs a human ten seconds of reading.
- A wrongly dismissed finding is **invisible**. It never reaches the report, so nobody can catch the mistake.

Every ambiguous case therefore resolves toward reporting. Concretely, in `lib/review-core.mjs`: majority survival, **a tie keeps**, and **no verdicts means survival** (absence of adjudication is not dismissal). With exactly two skeptics a 1–1 split is the common case, which makes the tie rule the one that matters most.

### 7.3 Evidence gates dismissal, not reporting

[Refute-or-Promote](https://arxiv.org/pdf/2604.19049) documents where uncited refutation ends: 80+ agents, dedicated adversarial reviewers among them, unanimously endorsing a Bleichenbacher padding oracle in OpenSSL's CMS module **that did not exist**. Self-preference bias in LLM self-review is separately well established. Confident prose is the single thing an LLM produces most reliably, so it is the one thing a dismissal must not rest on.

So: **a not-real verdict must cite a `file:line` span the skeptic actually opened. A real verdict needs nothing.** Only the dismissing direction is gated, because only that direction ends in silence.

The implementation detail matters. An uncited refutation is a **non-vote, not a deleted verdict**:

- Deleting it would orphan it, and an orphaned verdict means an unadjudicated finding — which, by the rule above, survives anyway but with no record of why.
- Its `qualityScore` still feeds the tolerance band. A skeptic can be too lazy to cite and still be right that a finding is badly written.

`interlock review` reports `dismissalsRejected`. A run where that number is high means the skeptics are asserting rather than reading — which is itself the signal you want.

### 7.4 The tolerance band

Surviving is not sufficient. Before the gate counts blockers, `applyToleranceBand` drops findings too poorly-grounded to be worth a human's attention. Two parameters: `minQualityToReport: 3` (of 5) and `drift: 1`.

The disagreement clause is the interesting half:

```js
const disagree = scores.length > 1 && high - Math.min(...scores) > tolerance
const keep = scores.length === 0 || disagree || high >= min
```

When two skeptics disagree about quality by more than `drift`, the finding is **kept regardless of the floor**. Disagreement is treated as signal in its own right — the same asymmetry as the tie rule. Scores pool across findings sharing an identity, so a finding raised by two dimensions is judged on every score it collected.

The gate itself is then a count, not a judgement: **it blocks if and only if at least one surviving finding is severity `blocker`.** That is why it lives in the CLI. `droppedByQuality` is reported separately from `dismissed`, because "the skeptics refuted it" and "it was too vague to act on" are different facts about your review.

---

## 8. The invariant sweep: the licensed exception

Every gate after exploration is scope-leashed by design. `spec` sees artifacts; `review-code` and `ship` see the diff. Correct for almost everything, and **structurally wrong for exactly one class**: a change that transforms a value read in more than one place.

Normalise an email in the write path. The updated paths are in the diff. The readers still comparing the raw form case-sensitively are not — they live in files the change never touched. A diff-scoped reviewer cannot see the bug, because the bug is not in the diff.

`shared/INVARIANT-SWEEP.md` licenses one exception, with explicit firing signals: a session/JWT/token field, a cache or dedup key, any identity used in `Set`/`Map`/`WHERE`/`===`, or any normalisation of user input — casing, trimming, encoding, Unicode, slug canonicalisation. Also any design that says "normalize", "canonical", "dedupe", "match", or "lookup by".

Two mandatory halves:

1. **Normalise once at the boundary.** The design must name where the single canonical transform lives. Scattering it across call sites guarantees one gets missed.
2. **Sweep the consumers repo-wide** — structural first (`interlock-graph consumers`), then grep for stringly and dynamic readers the graph misses.

A reader still consuming the raw form is a **BLOCKER**: a live correctness bug with a data-dependent trigger, failing only for the inputs that differ pre/post-transform — exactly the set no happy-path test exercises.

The sweep does not fire on local changes. Firing it on everything would defeat the leash it deliberately breaks.

---

## 9. The graph: deterministic retrieval, no vectors

`interlock-graph` builds a local knowledge graph. No embeddings, no vector store, no network. Node-link JSON on disk.

Node types: `file`, `module`, `symbol`, `external`, `unresolved`, `openspec`, `memory`. Edges: `imports`, `exports`, `references`, `belongs_to`, `implements_spec`.

Every edge carries a `confidence` — `EXTRACTED` (parsed) or `INFERRED` (matched). That distinction propagates all the way to policy: **treat `INFERRED` edges as hints and verify with `Read` spans before making claims.** It is also why the drift gate reports rather than blocks (§10).

Structural indexing covers JavaScript/TypeScript, Python and shell. Other languages get docs and OpenSpec indexing, spec→file links, prose retrieval, and the complete workflow. When a build indexes nothing it says so and explains why — an empty graph is never reported as success.

`interlock-graph consumers <symbol>` is the structural half of the invariant sweep. The prose retrieval half feeds §4.3.

---

## 10. Spec drift: measuring the category's oldest complaint

The standing criticism of every spec-driven framework is that specs go stale and mislead — worse for agents than for humans, since a stale doc misleads the next reader while a stale spec misleads every future run.

OpenSpec is **spec-anchored**: `openspec archive` merges a completed change's deltas into `openspec/specs/`. Interlock never archives for you. It only stops the step being forgotten.

`interlock drift` reports four findings at **three explicitly different confidence levels**, never averaged:

| Finding | Confidence | Basis |
|---|---|---|
| Unarchived changes | certain | Every task ticked, change still in `openspec/changes/`. Filesystem. |
| Broken references | evidence | A spec cites a file that is gone. It existed when the graph was built. |
| Orphan code | evidence, scoped | Changed source files no spec describes, with a repo-wide coverage denominator. |
| Aging specs | inference | A spec older than a file it cites that still exists. Dates, not behaviour. |

Design notes worth stealing:

- **A deleted file appears under broken references only, never also under aging.** One deletion reported twice, once as fact and once as inference, forces the reader to reconcile two findings that are one.
- **The orphan count always ships with its denominator.** "2 files have no spec" is alarming; "2 of 6, in a repo where 34% of source files have one" is informative. Orphan detection skips entirely when no spec links to any file — every file would be unowned, which is the loudest possible way to say nothing.
- **Absence is never reported as cleanliness.** No graph, no living specs, no changed source files: each is a distinct message, not a pass.

`interlock conformance` is the other half — it enumerates the scenarios a change's delta specs promised so each can be checked against what was built. It emits questions, never verdicts.

**Neither blocks.** Every other gating subcommand exits non-zero when it blocks; these two never do. [The Spec Growth Engine](https://arxiv.org/abs/2606.27045) can block a merge on intent/evidence disagreement because its specs are machine-readable contracts with declared dependency edges. `implements_spec` links are regex path-mentions marked `INFERRED`. A blocking gate on that basis would be wrong often enough to be switched off, and a gate everyone disables protects nothing.

---

## 11. Continuity as durable state

Agent work fails at context boundaries — `/clear`, cache expiry, a handoff to a fresh session. Interlock's answer is that anything that must survive gets written to disk in a parseable format.

**The explore brief** (`.claude/handoff/explore-*.md`) is `spec`'s durable input, with stable headings `spec` depends on. Bounded 2–6k tokens: citations and line refs, not pasted code. Writing it is autonomous explore's exit criterion, and reading it is how `spec` avoids re-deriving discovery from chat.

**The decision ledger** (`openspec/changes/<name>/decisions.md`) is the one a machine reads. Five stable columns, exactly two classes:

| Class | Meaning |
|---|---|
| `needs_human` | Product, policy, pricing, legal, security-posture, pinned-version or tenancy judgement the repo cannot answer. Stops continuity. |
| `agent_resolved` | Answered from the repo, the brief, or a stated default — and written down. |

`agent_resolved` is **a claim, and it is audited.** A row is invalid — and blocks exactly like `needs_human` — when its resolution is empty, its evidence is empty, or it does not also appear in `design.md` referenced by id. Writing the word is not a decision; saying what was decided and why is. Evidence must be a pointer someone else can follow: `lib/session.ts:42`, `explore brief §Critical Files`, `human decision 2026-08-12`. Not evidence: *obvious*, *standard practice*, *see above*.

A ledger that cannot be parsed is never reported as empty, because an empty ledger reads as "nothing needs a human".

This is the same audit pattern as §7.3. Both say: an unsubstantiated claim is treated as unresolved.

---

## 12. Fail-closed, and the shape of a gate

`interlock ready` decides whether a change may skip the human checkpoint. It is the most safety-relevant code in the repo, and three properties are load-bearing:

**Fail closed, without exception.** `ready` is true only when every implemented check affirmatively passed. A check that *could not run* — an unreadable ledger, an artifact that would not open, a classifier that threw — is a blocker, not a pass. Nothing in the module can turn an error into permission.

**An absent input is not a clean input.** The two ways the gate would otherwise be defeated are a missing `decisions.md` ("nobody recorded anything, so nothing needs a human") and a caller that forgets to pass the artifact-review result ("no blockers reported, so no blockers"). Both are blockers by name.

**Unimplemented checks report `skip` with a reason, not silence.** The printed checklist never implies a check passed when it was never run. A skip is "we chose not to check this"; a fail is "we tried and could not".

Risk classification follows the same instinct. `UNCLASSIFIABLE_CLASS` is `'high'` and `UNMATCHED_SOURCE_CLASS` is `'medium'` — never `'low'`. "No rule fired" means "we did not recognise it", not "it is safe". And risk never averages: a docs change bundled with a payment change is a payment change, because averaging is how a critical signal gets diluted.

---

## 13. Degradation is always spoken

The banner block prints on every run, including clean ones:

```
No degradation banners — graph, test profile, model routing, verification and e2e were all clean.
```

That line exists because **silence is the failure mode it removes.** A summary with no banner section is indistinguishable from a run that degraded and hid it. The banner strings are a contract — asserted verbatim in `test/workflows.test.mjs`, because a reworded banner is a banner nobody greps for.

The same instinct, repeated across the codebase:

- A verification skip **always** carries a machine-readable reason.
- Review reports dismissed, dropped-by-quality, and refused-refutation counts separately.
- The model clamp records every override.
- `drift` distinguishes "checked, clean" from "nothing to check".
- E2E failure is reported and never repaired — auto-fixing e2e is how a real regression gets papered over.

---

## 14. What this costs, honestly

**Portability.** Interlock runs on Claude Code and nothing else. The guarantees above come from the workflow runtime and the plugin surface. A portable version would be a folder of prompts, which is the thing it exists not to be. Spec Kit runs on thirty agents; that is a real advantage it has and this does not.

**A moving substrate.** Dynamic workflows require v2.1.154+. The plugin contract has been stable, but observable behaviour above it — agent caps, size guidelines, warning thresholds, resume semantics — has moved across patch versions, and none of it can be pinned.

**Surface area.** Fourteen skills, two CLIs, six shared protocol documents, thirteen subcommands. Four commands are the product and the rest is called by them, but the machinery underneath is not small.

**Prediction-shaped inputs.** Wave path collision detection, tier classification, and spec conformance all depend on a model predicting something. The *checks* on those predictions are deterministic; the predictions are not.

**No published benchmark.** 590 tests prove the policy engine behaves as specified. They do not prove the workflow produces better outcomes than a simpler loop. That comparison has not been run, and until it has, everything above is an argument from mechanism rather than from measurement. The outcome corpus (`interlock outcomes`) exists to close that gap and currently has no control group.

---

## 15. The one-paragraph version

Most of this category competes on **how much structure you write before coding**. Interlock competes on **how many decisions the model is not allowed to make**. Control flow lives in a script the runtime executes, policy lives in a CLI you can run yourself with no model and no network, and judgement — classification, implementation, review, synthesis — stays with the model, which is what it is for. Every gate fails closed, every degradation is spoken aloud, and every claim an agent makes about its own work is audited against evidence: a decision needs a citation, a dismissal needs a span it actually read. What is left over is a loop you can check.

---

## Next

- [**03 — OpenSpec vs Interlock**](./03-openspec-vs-interlock.md) — the composition boundary in practice
- [**04 — When it stops**](./04-when-it-stops.md) — every halt and banner, and what to do
- [**05 — Continuity**](./05-continuity.md) — the readiness gate check by check
