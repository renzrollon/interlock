# Ship and spec for engineers who only know prompting

This page is a review of **this repo's** spec and ship loop, written for a strong engineer who has so far treated coding agents as "write a better prompt." It is not a second README. After this, [01 — The first hour](./01-first-hour.md) is how you actually run the loop; [06 — Why it works](./06-why-it-works.md) is the mechanism argument.

Two loops exist in this checkout. Mixing them up is the most common first-week mistake.

| Loop | Commands | What it is | Host |
|---|---|---|---|
| **Interlock** | `/interlock:spec` then `/interlock:ship` | Gated OpenSpec + a scripted wave engine | Claude Code v2.1.154+ with dynamic workflows |
| **Stock OpenSpec** | `/opsx:propose` then `/opsx:apply` | Artifact scaffold + sequential apply in the current chat | Any OpenSpec-aware agent (including Cursor) |

Interlock is the product this repository *is*. Stock OpenSpec is what Interlock composes and what `openspec init` installs into `.claude/skills/` and `.claude/commands/opsx/`. Cursor copies live under `.cursor/`. Same artifact files, different execution contracts.

---

## 1. Executive review

**Verdict.** The spec → human checkpoint → ship design is unusually honest for this category. Control flow for ship lives in a script (`workflows/ship.js`), policy lives in a CLI you can run with no model (`bin/interlock`), and the one required human stop sits where a wrong idea is cheapest to kill. That split is real, not marketing. The weak spots are dogfooding, host lock-in, and a default ship path that no longer reviews the diff.

### What's strong

- **The checkpoint is load-bearing.** `/interlock:spec` writes specs and stops. `/interlock:ship` asks nothing. The gap is the product ([02](./02-the-checkpoint.md), `skills/spec/SKILL.md`). Continuity (`--continue`) is opt-in, fail-closed, and explicitly cannot catch a wrong idea ([05](./05-continuity.md)).
- **Caps are code.** Parallelism, remediation rounds, task-failure halt, spill thresholds, and handoff size live in `lib/limits.mjs` and print from `interlock limits`. Skills are told to cite the CLI, not restate numbers.
- **Ship is a workflow, not a prompt.** `skills/ship/SKILL.md` is a trampoline. Implementing the loop in conversation is defined as a bug. The runtime accepts no mid-run user input ([Claude Code workflows](https://code.claude.com/docs/en/workflows)).
- **Token tactics are specific.** Context tiering per implementer, graph-first locate, docs digest, verify spill at 8 KB, schema-validated wave handoffs (not git archaeology), haiku for mechanical pings, opus clamp on over-eager classifiers.
- **Review, when you pay for it, is adversarial.** Two skeptics per blocker/warning; an uncited dismissal is a non-vote; a quality band drops vague findings before they can halt a change. That matches the failure mode in [Adversarial Review (arXiv:2608.18167)](https://arxiv.org/abs/2608.18167): agents optimize for agreement unless disagreement is structured and evidence-gated.
- **Degradation is spoken.** Lean ship prints `LEAN SHIP`. Missing graph, missing test profile, overridden model routing, skipped verify, and red e2e all banner. Silence is treated as a bug.

### What's weak

- **This repo does not close its own spec loop.** Four changes under `openspec/changes/` have every task ticked (`add-ship-run-inspectability`, `add-wave-handoff-and-prompt-snapshots`, `add-interlock-acp-host`, `fix-wave-boundary-cost`) and none are archived. There is no living `openspec/specs/` for the product itself — only fixture specs under `test/graph/fixtures/`. `interlock drift` was built for exactly this failure, and it is happening here.
- **Default `ship` no longer reviews code.** Lean is waves → unit verify → commit. `--strict` is the previous bill. That is the right cost default for a two-file change. It is a quality default only if `tasks.md` and the unit suite are good. They often are not on a first spec.
- **Cursor cannot run Interlock ship.** README is explicit: 0.x is Claude Code. This checkout still installs stock `/opsx:*` skills for Cursor. A new engineer in Cursor will find a propose/apply loop that looks like spec/ship and is not.
- **No `AGENTS.md` or `CLAUDE.md`.** Industry practice in 2026 is a small always-on instruction file plus on-demand skills ([Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md), [Cursor rules](https://cursor.com/docs/rules)). This repo relies on plugin skills and `docs/`. Fine for Claude Code with the plugin loaded; thin for anyone else.
- **`shared/CONTEXT-HYGIENE.md` is unused.** It specifies `[[VARIABLE_NAME]]` wrapping for downstream prompts and claims spec/explore/ship/mr do it. A repo-wide search finds those placeholders only inside that file. Explore's skill *says* to wrap; `assembleImplementerPrompt` in `workflows/ship.js` interpolates change name and task text directly.
- **[08 — The harness landscape](./08-harness-landscape.md) is stale in one important place.** It still tells you to implement spill and a run trajectory first. `lib/spill.mjs` and `lib/run-log.mjs` exist; `add-ship-run-inspectability/tasks.md` is fully checked. Treat § "Worth taking" in that page as a snapshot from before those changes landed, not as current work.

### What's missing

- A published outcome comparison. `interlock outcomes` accumulates lines; nothing yet reads them to change behavior. Docs admit there is no control group ([06 §14](./06-why-it-works.md)).
- Per-task isolation. Parallel implementers share one working tree. Path-collision detection uses a model's predicted `paths` list. That narrows races; it does not close them.
- Wiring of the external `openspec-change-context-pack` skill (lives under `~/.claude/skills/`, not this plugin). Interlock ship uses tiered artifact reads + wave handoff packets instead. The pack is a reasonable idea that this loop does not consume.
- Archive as a first-class Interlock command. Interlock notices unarchived changes (`interlock drift`) and refuses to archive for you. That is a principled split. On this repo it has produced a pile of completed-but-unmerged deltas.

---

## 2. Mental model for prompt-only engineers

Prompting is one layer. Agentic workflow is a stack. If you only improve the prompt, you are tuning the least reliable layer.

```
you (intent, checkpoint, merge)
        │
process / workflow     what gets built, in what order, under which gates
                       Interlock spec + ship; stock OpenSpec propose + apply
        │
skills / commands      procedures loaded on demand (SKILL.md), not pasted every turn
        │
memory / artifacts     what survives /clear: specs, decision ledger, explore briefs,
                       ship run logs, test profile
        │
harness / runtime      who owns the loop, tools, compaction, subagent spawn
                       Claude Code (supported); ACP driver (experimental); Cursor (opsx only)
        │
model                  judgement: classify, implement, review, synthesize
```

### Prompt vs everything else

| You used to do this | The equivalent here | Why it is not "a better prompt" |
|---|---|---|
| Paste a long system prompt every chat | A **skill** (`SKILL.md`) loads only when invoked. Claude sees the description at session start; the body loads on use ([progressive disclosure](https://code.claude.com/docs/en/skills)) | Tokens stay out of the window until needed |
| Hope the model follows "don't skip tests" | A **CLI exit code** (`interlock validate`, `interlock verify unit`). The script branches on it | The model cannot talk past a non-zero exit |
| Keep conventions in the prompt | **`AGENTS.md` / `CLAUDE.md`** (industry); here, plugin skills + `openspec/config.yaml` + `docs/` | Durable, reviewable, shared |
| One huge agent does plan + code + review | **Subagents** with clean windows; ship orchestrator is a script, not a model | Context isolation. Orchestrator context rot was the original failure |
| "Looks good" as the quality bar | **Specs** (Given/When/Then), **tests**, optional **adversarial review**, **human checkpoint** | Plausible prose is cheap; a failing scenario is not |
| Re-explain the repo every session | **Explore brief**, **decision ledger**, **graph**, **docs digest**, **test profile** | State on disk, not in chat |

Anthropic's name for the shift is **context engineering**: curating the token set at each inference, not wordsmithing one system prompt ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), Sep 2025). Chroma's [context rot](https://www.trychroma.com/research/context-rot) result is why: accuracy degrades as input length grows even when the needle is present. Dumping more files into the chat is not a strategy.

### Roles, in this repo's vocabulary

- **Skills** — instructions a model follows. `/interlock:spec` is a skill. It may ask you questions. It must not write application code.
- **Workflow** — a JavaScript script the Claude Code runtime executes. `/interlock:ship` launches `workflows/ship.js`. It cannot ask you anything. Caps cannot be negotiated.
- **CLI (`interlock`)** — deterministic policy. Wave order, gates, verify judgement, readiness. No network, no model.
- **CLI (`openspec`)** — artifact formats, templates, validation, archive. Interlock drives it; it does not fork it ([03](./03-openspec-vs-interlock.md)).
- **Subagents** — one task, one clean context. Ship never implements inline.
- **Gates** — fail-closed checks. Artifact review before code; `interlock validate` before ship; unit suite before commit; `interlock ready` before skipping the human.
- **Memory** — `.claude/memory/` (recurring failure modes, coupling). Written on `--handoff` / `--strict`, and the prompt asks for at most three entries. That bound is prose in the prompt, not an enforced cap: `LIMITS.memoryEntriesPerRun` used to be printed by `interlock limits` with nothing reading it, and was removed rather than backed by an enforcement point invented to justify it. Not Hermes-style self-improving skills; a human still owns the skill files.
- **Evals** — 590+ unit tests of the *policy engine*, not of whether ship produces better product than a simpler loop. Do not confuse those.

OpenAI's Codex loop is the same stack with different nouns: harness + `AGENTS.md` + skills + compaction ([Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)). Cursor's is rules / `AGENTS.md` plus an agent that stays in your chat. Interlock's distinguishing bet: **decisions with a correct answer leave the model**.

---

## 3. How spec works here

End-to-end: **intent → (explore) → OpenSpec artifacts → decision ledger → validate → artifact review → stop.**

Source of truth for the Interlock path: `skills/spec/SKILL.md` (plugin copy also at the installed skill path). It writes specifications. It does not write code. Without `--continue`, it does not invoke ship.

### Step by step (Interlock `/interlock:spec`)

1. **Establish intent.** Derive a kebab-case change name. If the request is a bug fix (`fix`, crash, stack trace, issue id), **do not** `openspec new change` until there is real log/error output *and* a reproduction. Task 1 of a bug-fix `tasks.md` must be the failing repro test.
2. **Load or run explore.** Prefer `.claude/handoff/explore-*.md` (contract: `shared/EXPLORE-BRIEF.md`, ~2–6k tokens, citations not pasted code). No matching brief and no `--no-explore` → `/interlock:explore --autonomous`. Explore may fan out 2–5 read-only investigators (graph-first, then grep, then Read spans).
3. **Drift check, non-blocking.** `interlock drift --json`. Names unarchived changes and specs that cite missing files. Spec does not archive for you.
4. **Create the change.** `openspec new change "<name>"`.
5. **Generate artifacts via the OpenSpec CLI**, not by inventing a folder shape:
   - `openspec status --change "<name>" --json` → `applyRequires`, dependency graph, resolved paths
   - for each ready artifact: `openspec instructions <id> --change "<name>" --json`
   - write to `resolvedOutputPath` using `template`; never copy `<context>` / `<rules>` into the file
   - loop until every `applyRequires` artifact is done
6. **Invariant sweep** if a shared/derived value is in play (`shared/INVARIANT-SWEEP.md`): every consumer gets a task. Structural pass via `interlock-graph consumers`, then grep for string-keyed readers.
7. **Decision ledger.** `openspec/changes/<name>/decisions.md` (`shared/DECISION-LEDGER.md`). Two classes only: `needs_human` | `agent_resolved`. Empty resolution/evidence on `agent_resolved` is invalid. `interlock ledger "<name>"` exits non-zero while blocked.
8. **Validate.** `openspec validate` (schema) then `interlock validate "<name>"` (three artifacts present, real checkboxes).
9. **Artifact review.** `/interlock:review-artifacts` — architecture completeness + QA/testability + invariant check (`skills/review-artifacts/SKILL.md`). Findings go to `.claude/metrics/review-artifacts-*.json`; `interlock gate` decides blockers. **Blockers → halt and show you.** No silent fix-and-continue.
10. **Hand off to you.** Change path, assumptions, task count, non-blocker warnings. Greppable line: `GOAL MET: interlock spec stopped at the checkpoint.`

### Artifacts on disk

```
openspec/changes/<name>/
├── proposal.md      what and why
├── design.md        how, decisions
├── tasks.md         ordered checkboxes the wave planner consumes
├── decisions.md     Interlock addition — not stock OpenSpec
└── specs/**         delta specs: ADDED / MODIFIED / REMOVED / RENAMED + Given/When/Then
```

Stock `/opsx:propose` produces the same OpenSpec files (minus the ledger and the review gate) using `.claude/skills/openspec-propose/SKILL.md`. It also stops before code. Its closing prompt points at `/opsx:apply`, not `/interlock:ship`.

### Who reviews, when you intervene

| Gate | Actor | You intervene when |
|---|---|---|
| Bug-fix evidence | spec skill (refuses to proceed) | You have no log or no repro |
| Pinned versions | spec skill asks | Design names a dependency without a version |
| Ledger `needs_human` | you, before continuity or ship | Product/policy/security/tenancy/pin |
| Artifact review blockers | `interlock gate` + you | Spec is wrong; re-spec or edit markdown |
| The checkpoint | **you** | Always, unless you passed `--continue` *and* `interlock ready` exited 0 |

`--continue` asks `interlock ready` whether the change may skip the read. Ready checks implementability, review result present, ledger valid, scenarios mapped to tasks, vague-task phrases, risk class, test profile. It does **not** check "is this the change I wanted." Full table: [05](./05-continuity.md).

---

## 4. How ship works here

End-to-end, default (lean): **validate → classify/plan waves → implement in batches → inter-wave verify (capped) → final unit verify → commit.**

`--strict` (or `--review` / `--handoff` / `--conformance` individually) adds the tail: adversarial diff review, bounded remediation, manual test plan / teach-in / memory, spec-conformance questions.

Source of truth: `workflows/ship.js`. The skill `skills/ship/SKILL.md` only parses args and calls `Workflow({ scriptPath, args })`. If the Workflow tool is missing, it **halts**. It does not fall back to implementing in chat, and it does not auto-start the experimental ACP driver (`bin/interlock-ship-acp`).

### Step by step (lean)

1. **Validate.** `interlock validate --change <name>`. Missing/empty artifacts or no real checkboxes → `SHIP HALTED`. Also probes `CLAUDE_CODE_SUBAGENT_MODEL` and Bedrock/haiku reachability (banners, not quality gates).
2. **Classify (one model step, `plan-waves`).** Reads proposal/design/tasks/specs **in full** (the "artifact leash"). Writes `.claude/ship/classified.json`. Coverage check: `interlock tasks coverage` — omitted checkboxes halt. Then `interlock waves` → `.claude/ship/plan.json`, `interlock wave-state create` → `.claude/ship/state.json`, first `wave-state next`.
3. **Wave loop** until action is `done` or `halt`. The script does not decide next; it copies `interlock wave-state next` stdout. Known actions: `run-batch`, `test-wave`, `verify`, `replan`, `done`, `halt`. An invented `action` is retried once (`next-retry-*`), then halt.
4. **A batch** is up to `LIMITS.maxParallel` (8) implementers in `pipeline()`, one agent per task, in **one working tree**. Each agent gets `assembleImplementerPrompt`: tiered artifact reads, stop-on-green for tiers 1–2, previous-wave handoff packets (schema `interlock.wave-handoff/1`, cap `maxHandoffChars` 2000). Invalid/missing packet on a returned result fails the task closed.
5. **Record.** Haiku ping writes `.claude/ship/batch-N.json`, `wave-state record-batch --write-state`, `interlock tasks tick` for succeeded ids. If the next action is `verify`, the same ping fuses inter-wave verify (saves a turn).
6. **Inter-wave verify.** Typecheck + unit can halt the *next* wave. Docs-only waves skip. Cap: `interWaveVerifications` (3). Output over 8 KB is spilled (`interlock verify spill`); judge rejects oversized result fields.
7. **`--apply-only` exits here.** Otherwise **final verify**: unit red → root-cause repair (cluster, fix once, `verify repair`, max 5 iterations). Weakening tests is checked, not merely forbidden in prose. E2E red is a banner, not a halt. Coverage is advisory.
8. **Commit** one feature-level commit. Never `git add -A`, never amend, never push. `--no-commit` leaves this to you.
9. **Record outcome** (`interlock outcomes append`) and close the trajectory (`interlock run-log`). Unreconstructable trajectory → halt even on an otherwise clean run.

`--strict` inserts after waves, before final verify: dimension reviewers → two skeptics → `interlock review` → `interlock remediate` rounds 1–2, round 3 verdict-only.

### Stock apply is not ship

`/opsx:apply` (`.claude/skills/openspec-apply-change/SKILL.md`) implements tasks **sequentially in the current conversation**. It pauses and asks. It has no waves, no parallel isolation, no CLI caps, no adversarial review. It is the right tool when you want to stay in the loop. It is not a fallback that preserves Interlock's guarantees.

After merge, archive is stock OpenSpec: `openspec archive <name>` or `/opsx:archive` (syncs delta specs into living specs, then moves the change). Interlock never archives for you.

### Handoffs between spec and ship

| On disk | Consumer |
|---|---|
| `openspec/changes/<name>/*` | ship classifier + implementers |
| `decisions.md` | `interlock ready` / `interlock ledger` |
| `.claude/ready/<name>-review.json` | continuity only |
| `.claude/testing/profile.json` | verify plan; absence banners `NO TEST PROFILE` and blocks continuity |
| `.claude/graph/` | implementers (optional; grep fallback) |
| `.claude/ship/{classified,plan,state,batch-*,runs/*.jsonl,spill/}` | the run itself |

A change proposed by `/opsx:propose` can still be shipped by `/interlock:ship` if `interlock validate` passes. Ship does not care who wrote the markdown.

---

## 5. Harness anatomy

### Layers (what spends tokens)

```
Claude Code session (your chat)
  └─ /interlock:spec          skill in *this* conversation — explore, write files, review
  └─ /interlock:ship          trampoline → Workflow runtime
        workflows/ship.js     no model; holds loop + summary + banners
          ├─ validate / plan-waves / record-* / verify pings   usually haiku
          ├─ implementer agents                                 haiku|sonnet|opus by tier
          └─ review/remediate agents                            --strict only
  interlock CLI               policy, no tokens
  interlock-graph             retrieval budgets, no model
  openspec CLI                templates and schema, no model
```

Claude Code is the harness: tools, permissions, compaction, subagent spawn, workflow runtime ([How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)). Interlock is process on top of that harness ([08](./08-harness-landscape.md)).

### Skills and commands in this checkout

| Path | Role |
|---|---|
| `skills/spec/SKILL.md`, `skills/spec/continuity.md` | Interlock spec |
| `skills/ship/SKILL.md` | Trampoline only |
| `skills/dispatch/SKILL.md` | Pre-flight + route; never auto-bridges spec→ship |
| `skills/explore/SKILL.md` | Parallel recon; writes explore brief |
| `skills/review-artifacts/SKILL.md` | Pre-code gate |
| `skills/review-code/SKILL.md` + `dimensions/` | Adversarial diff review |
| `skills/{bootstrap,graph,docs-digest,fix-tests,commit,mr,...}` | Called by the loop or for recovery |
| `.claude/skills/openspec-*` and `.claude/commands/opsx/` | Stock OpenSpec (propose/apply/explore/sync/archive) |
| `.cursor/skills/` and `.cursor/commands/` | Same stock loop for Cursor |

### Memory and context packs

- **Explore briefs** — `.claude/handoff/explore-*.md`. Spec's durable input. gitignored.
- **Decision ledger** — in the change folder; committed.
- **Docs digest** — `.claude/graph/DOCS_DIGEST.md`, ~2500–3200 tokens, agent-only. `/interlock:docs-digest`.
- **Graph** — `.claude/graph/graph.json`. JS/TS, Python, shell for structural edges; other languages get docs/OpenSpec indexing only.
- **Ship trajectory** — `.claude/ship/runs/<runId>.jsonl`. Verbose on disk, not loaded into implementers. `interlock run-log show`.
- **Spill** — `.claude/ship/spill/<runId>/`. Locator + preview in context; full log on disk.
- **Learned constraints** — `.claude/memory/MEMORY.md` plus one file per entry. Current examples: backticks in `bin/interlock` USAGE; ship.js prose grepped by `test/workflows.test.mjs`.
- **Context pack** — not in this plugin. External skill writes `openspec/changes/<name>/.claude/context-pack.md`. Ship does not Read it.

### How tokens are actually spent on a ship run

Inference, not a measurement from this session:

| Step | Typical spend | Notes |
|---|---|---|
| `plan-waves` | One frontier-ish call + full artifact read | Most expensive *single* context; leash is deliberate |
| Each implementer | Task + tier slice + previous-wave packets | Isolation is the saving; N tasks ≠ N full spec dumps |
| Record/next pings | Haiku, structured JSON | Cheap if `CLAUDE_CODE_SUBAGENT_MODEL` is unset |
| Inter-wave verify | Capped; spill above 8 KB | Fused into record-batch when possible |
| `--strict` review | 4–6 dimensions + 2 skeptics per finding + fixers | Easy to trip Claude Code's "Large workflow" warning (>25 agents / 1.5M tokens). Advisory, does not halt |
| Lean commit | One call | |

Kill switches that silently inflate cost: `CLAUDE_CODE_SUBAGENT_MODEL` (every agent on that model — banner `MODEL ROUTING OVERRIDDEN`); permission prompts mid-run (allowlist `interlock`, `interlock-graph`, `openspec`, `git`, your test runner *before* a long ship); missing graph (grep fallback).

`.gitignore` ignores graph/handoff/metrics/testing but **not** `.claude/ship/` or `.claude/memory/`. This checkout currently carries a large untracked ship-run corpus. That is runtime state, not source.

---

## 6. Best-practice comparison

Mapped against what primary sources actually recommend in 2025–2026.

| Practice | Source | This repo |
|---|---|---|
| Treat context as a finite attention budget; smallest high-signal token set | [Anthropic, context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Yes for ship implementers (tiers, locate-then-read, spill). Weaker for spec (full artifacts + review in one conversation) and for `plan-waves` (full leash) |
| Progressive disclosure: descriptions always, bodies on demand | [Claude Code skills](https://code.claude.com/docs/en/skills), [claude doctor / Claude 5 context rules](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) | Plugin skills do this. No small always-on `CLAUDE.md`/`AGENTS.md` to rightsize |
| Just-in-time retrieval over dumping the repo | Anthropic same essay; Claude Code hybrid: CLAUDE.md up front, grep/glob JIT | `interlock-graph` budgets; digest-first in `shared/TOOL-ECONOMY.md`. Exception: active change artifacts are read in full |
| Persist state outside the window (notes, files, trajectories) | Anthropic; [Codex compaction + AGENTS.md](https://openai.com/index/unrolling-the-codex-agent-loop/); DeepSeek Harness session log (see [08](./08-harness-landscape.md)) | Explore brief, ledger, run JSONL, spill. Chat is not the system of record |
| Isolate subagent context; orchestrator should not accumulate | Anthropic; Claude Code workflows | Ship yes (script orchestrator). Spec/explore/review-artifacts still run in the parent conversation |
| Spec before code; living specs after | [OpenSpec](https://github.com/Fission-AI/OpenSpec), [openspec.dev](https://openspec.dev/) | Artifacts yes. Living specs **not maintained in this repo** |
| Human gate where the idea is cheapest to kill | This project's own thesis; OpenSpec "agree before you build" | The checkpoint. Continuity is the acknowledged hole |
| Structured disagreement in review, evidence to dismiss | [arXiv:2608.18167](https://arxiv.org/abs/2608.18167); Interlock also cites [arXiv:2604.19049](https://arxiv.org/pdf/2604.19049) (uncited refutation → phantom vuln) | Implemented, **opt-in** |
| Fail-closed gates; absent input ≠ clean | OpenClaw harness SDK; Interlock `ready` | Continuity and validate yes. Drift/conformance deliberately non-blocking (prose specs, inferred links) |
| Don't put control flow in prose the model can talk past | [Claude Code workflows](https://code.claude.com/docs/en/workflows); this repo's origin story | Ship migrated. Spec is still a skill (correct: it must ask questions) |
| Small AGENTS.md / rules; point at docs, don't copy them | [Cursor rules](https://cursor.com/docs/rules); Codex AGENTS.md guide | Missing. `docs/` is excellent and unloaded unless something tells the agent to Read it |
| Eval the workflow, not just the CLI | Industry gap generally | Policy tests are strong; outcome corpus exists and is unread |

Where Interlock is ahead of the median "folder of prompts": unarguable caps, spoken degradation, dismissal-needs-a-span, invariant sweep as licensed exception to diff-scoped review, host contract starting to exist (`lib/host.mjs` + ACP driver).

Where it lags what it preaches: dogfooding archive; always-on agent instructions for non-Claude hosts; default-path review; per-task worktrees (blocked on the workflow runtime's spawn).

---

## 7. Token optimization (tactics that apply here)

Context rot is the reason. Cost is the side effect.

### Load this

| When | What | Why |
|---|---|---|
| Start of spec | Newest matching explore brief, `openspec status --json`, `interlock drift --json` | Rule 3: read state, don't re-derive (`shared/TOOL-ECONOMY.md`) |
| Spec / implement against a named change | That change's proposal, design, tasks, delta specs | Artifact leash. Budgeted retrieval of your own spec implements two-thirds of it |
| Exploring | `DOCS_DIGEST.md` once, then `interlock-graph context` (2000) / `docs` (800) / `query` (1500) | Digest-first; widen once if empty, then stop |
| Implementer tier 1 | Task text only | Stop after typecheck/lint |
| Implementer tier 2+ | Relevant design section; specs enter at 3; full design+specs at 4+ | `assembleImplementerPrompt` |
| Next wave | Previous-wave handoff packets (locators, not file bodies) | Do not reconstruct from git |
| Red tests | Spill preview; Read `offset`/`limit` on the locator only if the omitted middle matters | Rule 4 |
| Halt | `interlock run-log show <runId>` | Trajectory is for you, not for the next implementer |

### Do not dump this

- All of `docs/` or `find docs -exec cat`
- Living `openspec/specs/` plus every historical change
- Full unit-suite stdout into a verify result field (CLI rejects it)
- Other tasks' work into an implementer's prompt (isolation is the point)
- `.claude/ship/runs/*.jsonl` into the orchestrator
- A second `Workflow()` because leftover `- [ ]` remain (those are a report; a relaunch is a full new run — [04](./04-when-it-stops.md))

### Already in the harness — use them

- **Classification batches** (`.claude/ship/classified.json` → `interlock waves`): predicted `paths` serialize collisions into later batches of the *same* wave instead of extra waves (extra waves cost verify cycles). Omit `paths` when you cannot predict; invented paths serialize for nothing.
- **Fused record-batch + verify** so a wave boundary is not automatically two agent turns.
- **Haiku pings** when Bedrock/haiku is reachable and `CLAUDE_CODE_SUBAGENT_MODEL` is unset.
- **`session-retro`** (from [shippable-skills](https://github.com/renzrollon/shippable-skills)) while the transcript is still in context: flags waste in relative magnitude, writes wire-ins. Target `workflows/ship.js` for ship, not the trampoline skill.

### Gaps you can close without new architecture

1. **Archive completed changes** so the next spec does not plan against a lie, and so drift output is small enough to read.
2. **Keep `openspec/config.yaml` filled** — it is currently commented examples. OpenSpec injects `context` / `rules` into `openspec instructions`; empty config means every spec run re-discovers stack conventions.
3. **Do not enable `--strict` by habit.** Pay for review when the blast radius is high (auth, money, migrations) or when the suite is thin.
4. **Allowlist before ship.** A permission prompt mid-workflow is the one interruption the runtime cannot prevent.
5. **Ignore stale advice in [08](./08-harness-landscape.md)** that says spill/trajectory are still to-do. They landed. Next token wins are: archive, config.yaml, and not re-reading spilled logs.

---

## 8. Output quality — better implementations

Quality here is a pipeline, not a vibe.

### Specs

Bad `tasks.md` becomes bad parallel code. Vague phrases (`update accordingly`, `handle edge cases`, `etc.`) are instructions to an implementer who cannot ask you — and they block continuity by design. Each task should name files/modules, tests should pair with features, bug fixes start with the repro. Delta specs should be behavior, not function names. Read them with the ten-minute procedure in [02](./02-the-checkpoint.md). Editing the markdown yourself is cheaper than a re-spec for small gaps.

### Reviews

- **Artifact review** catches wrong shape before waves. Treat blockers as "the spec is wrong," not as nits to silence.
- **Code review** (`--review` / `--strict` / `/interlock:review-code`) is calibrated for *you* to read survivors. Dismissed and dropped-by-quality counts are the evidence the report is worth line-by-line attention. A high `dismissalsRejected` means skeptics asserted without reading.
- False consensus is the multi-agent default ([arXiv:2608.18167](https://arxiv.org/abs/2608.18167)). Interlock's tie-keeps and uncited-refutation rules are the counter. They only run if you opt in.

### Tests

Lean ship trusts the unit suite. No `.claude/testing/profile.json` means inferred commands and a banner. `/interlock:fix-tests --reconfigure` once. Ship will not weaken assertions to get green. E2E failure still commits — you must look (`E2E FAILED` banner).

### Adversarial checks that are not review-code

- Invariant sweep at spec time (consumers of a normalized value).
- `interlock conformance` on `--conformance`: questions, never verdicts; unconfirmed stays unconfirmed.
- Reconstructability of the ship trajectory: a run you cannot replay is a halt.

### Evals

There is no SWE-bench-style eval of Interlock vs "just prompt Cursor." There *is* a large, dependency-free test suite of the CLI. Use it as a regression net for policy, not as proof that a change was the right product. `interlock outcomes` is the intended corpus; it does not yet change gates. Until it does, **your read at the checkpoint is the eval that matters.**

### Human gates that still pay

Anything you would have actually read: first change in an unfamiliar area, unclear intent, expensive-to-undo mistakes. Continuity is for docs, tests, and narrow flags you would have skimmed anyway. If `--continue` becomes habit, stop.

---

## 9. Playbook — first week

Assume Claude Code with the plugin, dynamic workflows on, `openspec` installed. If you are in Cursor, stop at step 4 and use `/opsx:apply` instead of ship, or switch hosts.

### Day 1 — one small loop

1. Allowlist `interlock`, `interlock-graph`, `openspec`, `git`, your test runner.
2. `/interlock:bootstrap` once (or `--quick` on a small repo). Does not modify source.
3. Pick a change with an obvious pass/fail: one flag, one error message, one command.
4. `/interlock:spec "<that change>"`. If it is a bug, have the log and repro ready.
5. Spend ten minutes on [02](./02-the-checkpoint.md). Reject scope creep in `proposal.md`. Check `tasks.md` for named files and test pairs. Skim `decisions.md`.
6. `/interlock:ship --no-commit` the first time if you want to see the diff before git.
7. Read the summary banners. `LEAN SHIP` is expected. `NO TEST PROFILE` / `GRAPH UNAVAILABLE` are the ones to fix once.

### What good looks like

- Spec stopped. You can explain the change from `proposal.md` in two sentences.
- `interlock validate <name>` is clean before ship.
- Ship prints a terminal summary (`GOAL MET: interlock ship…`) without leftover mystery. Leftover `- [ ]` are named failed tasks, not an invitation to relaunch.
- Unit suite green without tests getting narrower.
- After merge: `openspec archive <name>` so living specs exist. **Do this on this repo too.**

### What to watch for

| Smell | Likely cause | What to do |
|---|---|---|
| Spec wrote a config subsystem you did not ask for | Silent scope expansion | Re-spec with an explicit non-goal |
| Ship unknown / trampoline halts | Workflows disabled or Cursor | [04](./04-when-it-stops.md); use opsx apply or enable workflows |
| Mid-run permission prompt | Command not allowlisted | Approve, allowlist, expect that wave to be messy |
| Three task failures halt | Underspecified `tasks.md` in that area | Re-spec that slice; do not third-round ship |
| Unit still red after repair cap | Real bug or bad tests | `/interlock:fix-tests` or fix by hand; do not `--skip` unit |
| `MODEL ROUTING OVERRIDDEN` | Env var set | `unset CLAUDE_CODE_SUBAGENT_MODEL` unless you meant it |
| Second `Workflow()` in one chat | Leftover boxes or `/goal` misfire | Report leftovers; only a new user message ships again |
| `/opsx:apply` after `/interlock:spec` by habit | Two loops, same files | Legal, but you left the zero-touch / isolation contract |

### Days 2–5

- Run `/interlock:dispatch` only when you do not know which skill applies.
- After a messy session, `/session-retro` (from [shippable-skills](https://github.com/renzrollon/shippable-skills)) before `/clear`.
- Use `--strict` once on a change that touches auth or a public surface so you know what the bill looks like.
- Read [04](./04-when-it-stops.md) once so banners are a language, not noise.
- Do not start with `--continue`.

---

## 10. Recommended changes

Prioritized for *this* repository. "Do now" is cheap and closes a lie. "Consider" is real work with tradeoffs.

### Do now

1. **Archive the four completed changes** (`openspec archive <name>`, with spec sync). Until that happens, `interlock drift` will keep reporting the failure mode the tool was written to catch, and the next `/interlock:spec` on this repo plans against unmerged deltas plus empty living specs.
2. **Point the README at this page** (and restore [05](./05-continuity.md) in the doc table — it is missing today). New engineers currently get "first hour" or a 15-section mechanism essay with nothing in between.
3. **Fill `openspec/config.yaml`** with stack, test command, and artifact rules (proposal non-goals; tasks must name paths). Empty config wastes spec tokens rediscovering what `package.json` already says.
4. **Gitignore `.claude/ship/`** (and decide whether `.claude/memory/` is source). Runtime JSONL does not belong in `git status`. Memory files are currently useful and untracked — either commit the index or ignore the directory.
5. **Update [08](./08-harness-landscape.md) "Worth taking" items 1–2** to "shipped" (`lib/spill.mjs`, `lib/run-log.mjs`) so the landscape page stops assigning work that is done.
6. **Mark `CONTEXT-HYGIENE.md` as aspirational or implement it.** A protocol that claims ship wraps `[[CHANGE_NAME]]` while `assembleImplementerPrompt` interpolates raw strings is the silent-degradation pattern the rest of the codebase refuses.

### Consider

1. **Add a short root `AGENTS.md`** (symlink or stub `CLAUDE.md`): host split (Claude Code for ship, Cursor for opsx), pointer to this page, "do not implement Interlock ship inline," test command. Keep it small; put procedures in skills. This is the 2026 portable default.
2. **Default-path quality without full `--strict`.** Options: run `/interlock:review-code` on MRs rather than inside ship; or auto-`--review` when `interlock risk` is `high`/`critical` while keeping lean for `low`. Inference: not in the code today.
3. **Make archive harder to skip** without taking the decision away from the merger: `interlock:mr` already surfaces drift; a blocking reminder on `SHIP COMPLETE` when tasks are all ticked would match how other gates speak.
4. **Wire or drop context-pack.** If wave handoffs replaced it, say so in explore/spec docs so people do not run a personal `~/.claude` skill that ship ignores.
5. **Per-task worktrees** once a host port can spawn them. Predicted-path serialization is the honest interim. Hermes/dsh isolation is the actual close ([08](./08-harness-landscape.md)).
6. **Read the outcomes corpus** before relaxing any gate. Earned autonomy is storage-only on purpose. Wiring a branch without a control group would be deciding without the data.
7. **Delete or clearly label duplicate skill trees** (`.claude/skills/openspec-*` vs plugin `skills/`, plus `.cursor/` copies) in a "which command do I type?" box at the top of [01](./01-first-hour.md). The duplication is inherited from `openspec init`; the confusion is ours.

---

## Related pages in this repo

- [01 — First hour](./01-first-hour.md) — install to first commit
- [02 — The checkpoint](./02-the-checkpoint.md) — how to read the spec
- [03 — OpenSpec vs Interlock](./03-openspec-vs-interlock.md) — who owns artifacts
- [04 — When it stops](./04-when-it-stops.md) — halts and banners
- [05 — Continuity](./05-continuity.md) — `--continue`
- [06 — Why it works](./06-why-it-works.md) — mechanisms and costs
- [08 — Harness landscape](./08-harness-landscape.md) — OpenClaw / Hermes / dsh (check spill/trajectory claims against `lib/`)

## Sources (web)

Primary or near-primary, retrieved 2026-08-21:

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, 2025-09-29
- [The new rules of context engineering for Claude 5](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models) — Anthropic
- [Claude Code: how it works](https://code.claude.com/docs/en/how-claude-code-works) · [skills](https://code.claude.com/docs/en/skills) · [best practices](https://code.claude.com/docs/en/best-practices) · [dynamic workflows](https://code.claude.com/docs/en/workflows)
- [Context Rot](https://www.trychroma.com/research/context-rot) — Chroma, 2025
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) · [openspec.dev](https://openspec.dev/) · [overview](https://github.com/Fission-AI/OpenSpec/blob/main/docs/overview.md)
- [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) · [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md) · [Codex best practices](https://developers.openai.com/codex/learn/best-practices)
- [Cursor rules / AGENTS.md](https://cursor.com/docs/rules)
- [Adversarial Review](https://arxiv.org/abs/2608.18167) — structured disagreement; false consensus
- [Spec Growth Engine](https://arxiv.org/abs/2606.27045) — cited by this repo's drift/tool-economy design (machine-readable spec graph vs OpenSpec prose)
- Agent Skills standard: [agentskills.io](https://agentskills.io)

Repo-internal claims above are from the files named, not from the README's marketing summary. Where docs and code disagree, the code path is `workflows/ship.js` + `lib/limits.mjs` + the ticked change under `openspec/changes/`.
