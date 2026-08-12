# Interlock

**Autonomous spec-driven development for Claude Code, layered on [OpenSpec](https://github.com/Fission-AI/OpenSpec).**

Three commands, one human checkpoint. Onboard a repo, produce a reviewed spec, then ship it start-to-commit with parallel agents.

```bash
/plugin marketplace add renzrollon/interlock
/plugin install interlock@interlock
```

Then, in a repo:

```bash
/interlock:bootstrap          # once — code → understanding → graph
/interlock:spec "<idea>"      # explore → artifacts → review, then stops
/interlock:ship               # waves → review → remediate → verify → commit
```

| Requirement | Why |
|---|---|
| [Claude Code](https://claude.com/claude-code) **v2.1.154+** | `/interlock:ship` is a [dynamic workflow](https://code.claude.com/docs/en/workflows), not a skill |
| Dynamic workflows **enabled** | Off via `disableWorkflows`, org policy, or `CLAUDE_CODE_DISABLE_WORKFLOWS` means no `ship`. On Pro, enable it in `/config` |
| [`openspec`](https://github.com/Fission-AI/OpenSpec) CLI | Interlock drives it; it does not replace it |
| Node.js ≥ 18 | For the two bundled CLIs |

**Interlock is a Claude Code plugin.** It relies on Claude Code's skill frontmatter, plugin `bin/` PATH injection, subagent fan-out, and the workflow runtime — Cursor and Copilot are not supported in 0.x.

Before a long `ship` run, allowlist the commands its agents use (`interlock`, `interlock-graph`, `openspec`, `git`, and your test runner). Workflow agents inherit your permission settings, so a command that is not allowlisted stops the run on an approval prompt — which is exactly what a zero-touch run should never do.

New here? Start with **[the first hour](docs/01-first-hour.md)**.

| Doc | |
|---|---|
| [01 — The first hour](docs/01-first-hour.md) | Install to first shipped change |
| [02 — The checkpoint](docs/02-the-checkpoint.md) | How to read a spec in ten minutes |
| [03 — OpenSpec vs Interlock](docs/03-openspec-vs-interlock.md) | What composes with what |
| [04 — When it stops](docs/04-when-it-stops.md) | Every halt and banner, and what to do |

---

## The flow

One human stop. Everything else is automatic.

<p align="center">
  <img src="docs/assets/interlock-flow-wide.png" alt="Interlock flow: bootstrap once, then spec → you read the spec → ship → mr" width="900">
</p>

**The gap between `spec` and `ship` is the product.** A spec is the cheapest place to catch a wrong idea, so that is the one place a person is *required* to look.

`/interlock:ship` is the one that truly asks nothing, and it is structurally incapable of it: ship is a **dynamic workflow**, and the workflow runtime takes no mid-run user input at all. The zero-touch contract is a property of the runtime rather than a promise in a prompt.

The steps before it are conversational where they have to be — `bootstrap` confirms the feature list it discovered, and `spec` asks about intent, bug-fix evidence, and dependency versions it refuses to guess. Those are questions with no correct answer available in the repo, which is the only reason they exist. It is also why every decision that could need a human has to be settled *before* ship starts: once the workflow is running, there is nobody to ask.

---

## Why this and not a folder of prompts

Decisions that have a correct answer are moved out of prose and into code, one at a time. The plugin ships two CLIs on your `PATH`:

**`interlock`** — the deterministic spine. Each subcommand replaces a judgement the model used to re-derive in prose on every run, usually inconsistently:

| Command | Decides |
|---|---|
| `interlock waves` | Wave order, per-task model, and a **hard cap on parallel agents** |
| `interlock surface` | Whether a diff touches UI, and therefore needs a manual test plan |
| `interlock gate` | Whether a review blocks, which findings are too weak to report, and how the rest partition for parallel fixers |
| `interlock review` | Which findings survive two skeptics, and how many were dismissed versus dropped as too weak |
| `interlock remediate` | What gets fixed, what gets deferred, and when the round budget is spent |
| `interlock verify` | What to run, what a red result means, and which failures share a root cause |
| `interlock wave-state` | What happens next in the wave loop, and when to stop |
| `interlock risk` | How dangerous a change is, from its paths and artifacts |
| `interlock ready` | Whether a change may skip the human checkpoint — fail-closed |
| `interlock validate` | Whether a change is actually implementable |
| `interlock limits` | Every cap the loop obeys, so nothing restates one |

```bash
$ interlock surface --changed src/Button.tsx docs/readme.md app/api/login/route.ts
UI-TESTABLE      src/Button.tsx           (.tsx component)
NOT-UI-TESTABLE  docs/readme.md           (docs file)
UI-INDIRECT      app/api/login/route.ts   (API route path)

needsManualTestPlan=true needsDevopsReview=true
```

**`interlock-graph`** — a local, deterministic code knowledge graph. No vector store, no network. Agents navigate with token-budgeted subgraphs instead of re-grepping:

```bash
interlock-graph build .
interlock-graph consumers normalizeEmail
interlock-graph path lib/auth app/api
```

Everything genuinely requiring judgement — classification, implementation, review, synthesis — stays with the model. The split is the point.

Two guarantees come from the harness rather than from either side of that split: the workflow runtime accepts no mid-run input, so `ship` cannot ask you anything; and `commit` and `mr` set `disable-model-invocation: true`, so Claude cannot decide on its own that now is a good time to commit or open a merge request.

The orchestration inside `ship` is a **workflow script**, not prose: the wave loop, the remediation rounds, the halt conditions and the verification order are `workflows/ship.js`, and every policy decision inside it is a `interlock` subcommand rather than a judgement the model re-derives. The script holds the loop; the CLI holds the rules; the agents do the work. What the model still decides is what it should decide — how to classify a task, how to implement it, what a review finding means.

---

## Reviews you can actually read

`/interlock:review-code` fans out up to six dimensions in parallel — language, architecture, QA and delivery always; devops and security when the diff earns them — then **puts two skeptics on every blocker and warning and tries to refute it.** Findings that don't survive are never shown to you.

An unverified review reports everything it notices, so you learn to skim it. A review where every finding survived two adversaries is one you read line by line. The report always tells you how many findings were dismissed — that number is the evidence it's worth trusting.

Surviving is not sufficient. `interlock gate` also applies a quality band: a finding the skeptics scored below 3 out of 5 for how well-grounded and actionable it is gets dropped before the gate counts blockers, so a vague blocker cannot hold up a change. That threshold lives in the CLI rather than in the review prose, which is what stops it from being quietly re-argued on each run.

---

## Commands

Four are the product:

| | | |
|---|---|---|
| `bootstrap` | Onboard a repo — once | skill |
| `spec` | Idea → reviewed, implementation-ready change | skill |
| `ship` | Reviewed change → commit, without asking you anything | **workflow** |
| `mr` | Change → merge request | skill |

`ship` is the odd one out on purpose. A skill is instructions Claude follows; a workflow is a script a runtime executes. The ship loop has real control flow — waves, bounded remediation rounds, halt conditions — and control flow written as prose is control flow the model can talk itself out of. Everything else in the list is genuinely a set of instructions, so it stays a skill.

<details>
<summary><b>Advanced surface</b> — mostly called by the four above; reach for them directly only when you know why</summary>

<br>

| | |
|---|---|
| `explore` | Parallel read-only reconnaissance, durable brief |
| `review-code` · `review-artifacts` | The adversarial gates, run standalone |
| `graph` · `docs-digest` | Build and query the local code graph and docs digest |
| `fix-tests` | Discover the test setup, then repair failures by root cause |
| `manual-test-plan` · `explain-code` · `commit` | Individual `ship` stages, run on their own |
| `dispatch` | One batched pre-flight, then routes you to the right skill |

None of these are part of a first loop — see [the first hour](docs/01-first-hour.md).

</details>

---

## It composes OpenSpec — it doesn't replace it

`openspec init` installs its own `openspec-propose`, `openspec-explore` and `openspec-apply-change` skills. Interlock does **not** fork them. `/interlock:spec` drives the `openspec` CLI directly — `openspec new change`, `openspec status --json`, `openspec instructions` — because the CLI is the stable contract and a forked skill drifts on every OpenSpec release.

What Interlock adds around it: parallel exploration with a durable brief, an evidence gate for bug fixes, invariant sweeps, adversarial review, wave execution, and the deterministic spine above.

Both sets of skills coexist. Plugin skills are namespaced, so `/openspec-propose` and `/interlock:spec` both stay available. Use `/interlock:spec` when you want the gates; use the stock skills when you want the plain artifact loop.

---

## Language support

Structural graph indexing — import and symbol edges — covers **JavaScript/TypeScript, Python, and shell**. Other languages (Go, Rust, Java, Ruby) get everything else: docs and OpenSpec indexing, spec→file links, prose retrieval, and the full workflow. When `interlock-graph build` finds nothing to index it says so and explains why, rather than reporting an empty graph as success.

Docs discovery adapts to your layout: it probes `docs/`, `doc/`, `documentation/`, `site/`, `guides/` and `wiki/`, and always includes root-level `README.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md` — which on many projects are the only documentation there is.

Everything else in the plugin is stack-agnostic. `bootstrap` reads your dependency manifest and phrases its explorer agents in your stack's vocabulary.

---

## Experimental

**Earned autonomy.** `interlock autonomy` records, per gated path, how many consecutive clean runs it has had, resets that count on a blocker or a human override, and assigns blame transitively — a downstream gate blames whoever produced the bad artifact, so `spec` cannot earn trust by emitting shallow specs. It is well tested and skills record outcomes into it.

It is **storage only.** Nothing reads the level to change what the workflow does, and the human checkpoint between `spec` and `ship` is not skippable at any level. Treat it as a ledger accumulating evidence for a decision that has not been made yet — earlier versions of this README described it as gating your workflow, which it does not. If and when a level changes a branch, that will ship as its own release note.

---

## Development

```bash
git clone https://github.com/renzrollon/interlock && cd interlock
npm test                      # 186 tests, no dependencies
claude plugin validate . --strict
claude --plugin-dir .         # load it without installing
```

`/reload-plugins` picks up edits without restarting.

---

## Credits

Built on [OpenSpec](https://github.com/Fission-AI/OpenSpec) by Fission AI, and on the wave-execution pattern for parallel task application.

[MIT](./LICENSE)
