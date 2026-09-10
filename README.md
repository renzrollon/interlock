# Interlock

**Autonomous spec-driven development for Claude Code, layered on [OpenSpec](https://github.com/Fission-AI/OpenSpec).**

One human checkpoint. Spec a change, read it, then ship it start-to-commit with parallel agents.

```bash
/plugin marketplace add renzrollon/interlock
/plugin install interlock@interlock
```

Then, in a repo, onboard once:

```bash
/interlock:bootstrap          # code → understanding → graph
```

Every change after that:

```bash
/interlock:spec "<idea>"      # explore → artifacts → review, then stops
/interlock:ship               # waves → verify → commit
/interlock:ship --strict      # previous default: + review, handoff, conformance
/interlock:ship --solo        # one agent implements the whole change in order
/interlock:ship --waves       # force the parallel plan
```

Without a shape flag the classifier recommends solo or waves and the planner honours it inside a published envelope (`interlock limits`); the plan preview names the mode before anything is spawned.

| Requirement | Why |
|---|---|
| [Claude Code](https://claude.com/claude-code) **v2.1.154+** | `/interlock:ship` launches a [dynamic workflow](https://code.claude.com/docs/en/workflows). Known-good on 2.1.229 |
| Dynamic workflows **enabled** | Off via `disableWorkflows`, org policy, or `CLAUDE_CODE_DISABLE_WORKFLOWS` means no `ship`. On Pro, enable it in `/config` |
| `CLAUDE_CODE_SUBAGENT_MODEL` **unset** | If it is set it overrides every per-tier model the planner assigns, so `ship` runs entirely on that model. It banners this rather than hiding it — see [when it stops](docs/04-when-it-stops.md) |
| [`openspec`](https://github.com/Fission-AI/OpenSpec) CLI | Interlock drives it; it does not replace it |
| Node.js ≥ 18 | For the three bundled CLIs |

### Installing the OpenSpec dependency

Interlock drives the `openspec` CLI, so install it and initialize it in the repo first ([OpenSpec quick start](https://github.com/Fission-AI/OpenSpec#quick-start)):

```bash
npm install -g @fission-ai/openspec@latest
```

```bash
cd your-project && openspec init
```

OpenSpec itself requires **Node.js 20.19.0+** (higher than Interlock's own ≥ 18) and also installs via pnpm, yarn, bun or nix. `openspec init` creates `openspec/` and installs its stock skills — Interlock composes with those rather than replacing them.

**Interlock is a Claude Code plugin.** It relies on Claude Code's skill frontmatter, plugin `bin/` PATH injection, subagent fan-out, and the workflow runtime — Cursor and Copilot are not supported in 0.x. Claude Code is the **default and supported host**, and `/interlock:ship` launches the workflow there or halts; it never falls back to anything else. There is an experimental **runner** you invoke yourself — `interlock-run`, which drives the same loop over the Claude Code CLI, an [ACP](https://agentclientprotocol.com) agent, OpenAI Codex or Qwen Code, described under [Experimental](#experimental) — and no slash command starts it for you.

Before a long `ship` run, allowlist the commands its agents use — run `interlock doctor` to get the exact list (derived from what the flow shells out to, plus your own test profile) rather than one enumerated here. Workflow agents inherit your permission settings, so a command that is not allowlisted stops the run on an approval prompt — which is exactly what a zero-touch run should never do.

Also decide once whether this repository keeps its run corpora. If you will run `/interlock:ship` against your own product, the trajectory, outcome record and review metrics are your audit trail and belong in git; if you are developing a harness, they are exhaust and belong in `.gitignore`. Both `.gitignore` blocks and the two caveats that bite when committing are in [11 — whether to keep them](docs/11-the-indicators.md#whether-to-keep-them).

```bash
interlock doctor
```

That is the preflight: it checks the allowlist against the commands the flow actually shells out to (including the one your own `.claude/testing/profile.json` names), plus the Node version, the installed plugin's workflow and agent types, the OpenSpec CLI, git, and whether the run-state directories can be written at all. It exits 1 when a check would stop an unattended run, prints the settings snippet that fixes it, and changes nothing itself. Every condition it names is one you would otherwise meet three waves in. The plugin also runs this preflight automatically at session start (a `SessionStart` hook) so a missing allowlist entry surfaces before a run rather than three waves in.

The plugin ships three `PreToolUse` guards as well — deterministic deny rules that stop an in-run agent from editing a test during remediation, hand-ticking `tasks.md`, or committing outside the commit stage. **They bind only agents running inside an Interlock ship run and are inert outside one:** they fail open whenever no active run marker is present, so installing the plugin does not change how your own editing or committing behaves. See [13 — The guards](docs/13-the-guards.md).

### Install the CLIs without the plugin

The bundled CLIs are ordinary Node with zero dependencies, and each is useful on its own — `interlock` gates a CI job, `interlock-graph` indexes a repo for any agent, `interlock-run` drives the same ship loop over a non-Claude host. They ship as an npm package as well as a plugin:

```bash
npm install -g @renzrollon/interlock
```

Or without installing anything, using the scope on the `-p` flag and the bare binary name after it:

```bash
npx -p @renzrollon/interlock interlock limits
```

| | |
|---|---|
| **Works from the package alone** | `interlock` (the policy engine: `limits`, `gate`, `surface`, `waves`, `report`, `ledger`, `doctor`), `interlock-graph` (build and query the codebase graph), `interlock-run` (drive the loop over the Claude Code CLI, an ACP agent, Codex or Qwen) |
| **Needs the Claude Code plugin** | `/interlock:spec`, `/interlock:ship`, `/interlock:bootstrap` and every other slash command; the `SessionStart` preflight and the `PreToolUse` guards. The package ships the skill and hook files so a package checkout is still a complete plugin, but nothing runs them without the plugin host |

**Releasing:** push a `v<MAJOR.MINOR.PATCH>` tag (the version `package.json` carries) and `.github/workflows/release.yml` runs the suite and publishes with npm provenance. It uses trusted publishing, which has to be configured once on the registry for this repository and that workflow file name — until it is, the publish step fails with the registry's authentication error rather than skipping.

New here? Start with **[the first hour](docs/01-first-hour.md)**. If you have only ever prompted a coding agent — no skills, no specs, no gates — read **[09 — From prompt to workflow](docs/09-from-prompt-to-workflow.md)** first: every term defined once, ending at why `ship` is a script and not a prompt. Then **[10](docs/10-agentic-workflow-ship-and-spec.md)** for this repo's loop reviewed in depth.

| Doc | |
|---|---|
| [01 — The first hour](docs/01-first-hour.md) | Install to first shipped change |
| [02 — The checkpoint](docs/02-the-checkpoint.md) | How to read a spec in ten minutes |
| [03 — OpenSpec vs Interlock](docs/03-openspec-vs-interlock.md) | What composes with what |
| [04 — When it stops](docs/04-when-it-stops.md) | Every halt and banner, and what to do |
| [05 — Continuity](docs/05-continuity.md) | When `--continue` may skip the human read |
| [06 — Why it works](docs/06-why-it-works.md) | The mechanisms, low-level, with the costs stated |
| [08 — The harness landscape](docs/08-harness-landscape.md) | OpenClaw, Hermes Agent and DeepSeek Harness, and which layer each sits at |
| [09 — From prompt to workflow](docs/09-from-prompt-to-workflow.md) | New to agentic workflows? Every term defined, then why `ship` is a script |
| [10 — Ship and spec for prompt-only engineers](docs/10-agentic-workflow-ship-and-spec.md) | Agentic-workflow primer, review of spec+ship, token and quality tactics |
| [11 — The indicators](docs/11-the-indicators.md) | What `interlock report` measures, each denominator, and why it gates nothing |
| [12 — Repository review policy](docs/12-repository-review-policy.md) | The optional `REVIEW.md`: what it can change (scope, advice) and what it cannot (the band, nit cap) |
| [13 — The guards](docs/13-the-guards.md) | The four hooks, the stage marker's lifecycle, and the fail-open rule. The guards bind only agents inside a ship run and are inert outside one |
| [14 — Evals](docs/14-evals.md) | What a consumer's run is checked by, why no model evals run in their CI, how to file a failure — and, for this repo, which layers are real evals and how the suite should grow |

---

## The flow

One human stop. Everything else is automatic.

<p align="center">
  <img src="docs/assets/interlock-flow-wide.png" alt="Interlock flow: bootstrap once, then spec → you read the spec → ship → mr" width="900">
</p>

**The gap between `spec` and `ship` is the product.** A spec is the cheapest place to catch a wrong idea, so that is the one place a person is *required* to look.

`/interlock:ship` is the one that truly asks nothing, and it is structurally incapable of it: ship is a **dynamic workflow**, and the workflow runtime takes no mid-run user input at all. The zero-touch contract is a property of the runtime rather than a promise in a prompt. Default ship is waves → unit verify → commit. Pass `--strict` when you want the adversarial review and handoff tail. `commit` and `mr` set `disable-model-invocation: true` for the same reason — Claude cannot decide on its own that now is a good time to commit.

The steps before it are conversational where they have to be: `spec` asks about intent, bug-fix evidence, and dependency versions it refuses to guess — questions with no correct answer available in the repo. That is also why every decision that could need a human has to be settled *before* ship starts. Once the workflow is running, there is nobody to ask.

---

## Why this and not a folder of prompts

Decisions that have a correct answer are moved out of prose and into code, one at a time. The plugin ships three CLIs on your `PATH` — the deterministic spine, the knowledge graph, and the experimental [runner](#experimental):

**`interlock`** — the deterministic spine. Each subcommand replaces a judgement the model used to re-derive in prose on every run, usually inconsistently:

| Command | Decides |
|---|---|
| `interlock waves` | Wave order, per-task model, a **hard cap on parallel agents**, and whether two tasks in one wave would edit the same file |
| `interlock surface` | Whether a diff touches UI, and therefore needs a manual test plan |
| `interlock gate` | Whether a review blocks, which findings are too weak to report, and how the rest partition for parallel fixers |
| `interlock review` | Which findings survive two skeptics, and how many were dismissed versus dropped as too weak |
| `interlock remediate` | What gets fixed, what gets deferred, and when the round budget is spent |
| `interlock verify` | What to run, what a red result means, and which failures share a root cause |
| `interlock wave-state` | What happens next in the wave loop, and when to stop |
| `interlock risk` | How dangerous a change is, from its paths and artifacts |
| `interlock drift` | Which completed changes were never archived, which specs cite files that are gone, and which changed files no spec describes |
| `interlock conformance` | Which spec scenarios a change must be checked against — the questions, never the verdicts |
| `interlock ready` | Whether a change may skip the human checkpoint — fail-closed |
| `interlock ledger` | Whether the decision ledger still holds an unanswered product question |
| `interlock validate` | Whether a change is actually implementable |
| `interlock tasks` | Whether the wave plan covers every unchecked box, and which ids may be ticked |
| `interlock run-log` | Whether a finished run's trajectory can actually be replayed |
| `interlock run` | The whole ship loop, as steps: every briefing and every branch a driver obeys next |
| `interlock limits` | Every cap the loop obeys, so nothing restates one |

Every one of them runs without a model and without the network, so you can check any decision the loop made yourself — with one exception: `interlock notify` and `run close --notify` open a network connection, and only when `INTERLOCK_NTFY_TOPIC` is set. See [Configuration: push notifications](#configuration-push-notifications) below.

### Configuration: push notifications

A ship run that halts or completes while nobody is watching can push you a message. It is off by default and reads only from the environment — nothing is read from or written to the repo tree for this:

| Variable | Meaning |
|---|---|
| `INTERLOCK_NTFY_TOPIC` | The [ntfy](https://ntfy.sh) topic to post to. Unset (the default) means `run close` posts nothing, and the suite never makes a request. Treat the value as a secret — anyone who knows it reads every message, since it is the only authentication the public server offers. |
| `INTERLOCK_NTFY_URL` | The ntfy server, defaulting to the public `https://ntfy.sh`. Point it at a self-hosted server if the public relay is not an acceptable trust boundary for your halt reasons. |

With a topic set, both `workflows/ship.js` and `bin/interlock-run` pass `--notify` on every close, so one message goes out per terminal outcome — `high` priority on `SHIP HALTED`, default priority otherwise — naming only the summary's first line, the change and the run id, never the topic, the working directory or the project slug. A failed push shows up as `push: failed — <reason>` in the summary and a `PUSH FAILED: <reason>` banner, and never changes the run's exit code. See [when it stops](docs/04-when-it-stops.md#push-failed) for the failure modes, or run a one-off yourself:

```bash
interlock notify --title "<title>" --body "<body>"
```

**`interlock-graph`** — a local, deterministic code knowledge graph. No vector store, no network. Agents navigate with token-budgeted subgraphs instead of re-grepping:

```bash
interlock-graph build .
interlock-graph consumers normalizeEmail
interlock-graph path lib/auth app/api
```

Everything genuinely requiring judgement — classification, implementation, review, synthesis — stays with the model. The split is the point: **the script holds the loop, the CLI holds the rules, the agents do the work.**

The wave loop, the halt conditions and the verification order live in `lib/run.mjs`, which emits the whole program as steps — the agents to spawn, with their briefings, and the exact `interlock` argv to call once they return. `workflows/ship.js` and the experimental `bin/interlock-run` are interpreters of that program, not two copies of it: each spawns what a step names and calls what it names next, and branches on nothing — not a flag, not a mode, not a count, not a verdict. Control flow written as prose is control flow the model can talk itself out of; control flow written twice in two drivers is control flow that drifts, which is what moving it into one CLI removes. Default `ship` is that loop through to a green unit suite and a commit. Adversarial review and handoff artifacts are `--strict` (or `--review` / `--handoff` on their own), not the execute loop itself.

That leaves one thing worth calling out because it took the longest to close: tasks in a wave run in parallel **in one working tree**, and their independence used to be asserted by the classifier and checked by nothing. The planner now takes each task's predicted file list and moves any task that would collide with a sibling into a later batch of the same wave — ordering inside a wave is free, while a new wave is a checkpoint. Collision is compared on the **canonical** path, so `src/a.ts` and `./src/a.ts` are one file rather than two keys; a path that is absolute or escapes the repo root is reported as unusable rather than rewritten into scope. The prediction is still a model's — but with `--isolate-waves`, each lane in a batch runs in its own git worktree, so the race is **closed within a batch** rather than merely narrowed: a mis-predicted shared write can no longer overwrite a sibling lane. Their worktrees fold back into the shared tree afterward (`interlock merge-lanes`); a prediction miss — two lanes that actually wrote the same file — surfaces as a named halt at merge time, never as a silently discarded write. Without the flag, the race is narrowed exactly as before.

---

## Reviews you can actually read

`/interlock:review-code` fans out up to six dimensions in parallel — language, architecture, QA and technical-lead always; devops and security when the diff earns them — then **puts two skeptics on every blocker and warning and tries to refute it.** Findings that don't survive are never shown to you.

An unverified review reports everything it notices, so you learn to skim it. A review where every finding survived two adversaries is one you read line by line. The report always tells you how many findings were dismissed — that number is the evidence it's worth trusting.

**A skeptic must cite what it read to dismiss a finding.** A verdict of "not real" has to carry a `file:line` (or `file:start-end`) span naming a path that is actually in the reviewed diff — a shape a machine can check, not a judgement call handed to another model. A dismissal that fails either half does not dismiss anything: it is recorded, its quality score still counts, and the finding survives to you. The report says how many refutations were refused, so you can see the rule fire. Voting a finding *real* needs no citation, because that direction already ends with a human reading it — the cheap error. Only the dismissing direction is gated, because a wrongly dismissed finding is *invisible*, and nobody can catch a mistake they never see. [Research on adversarial review](https://arxiv.org/pdf/2604.19049) documents where uncited refutation ends: eighty-plus agents, dedicated skeptics among them, unanimously endorsing an OpenSSL vulnerability that did not exist. Confident prose is the one thing an LLM produces reliably, so it is the one thing a dismissal must not rest on.

Surviving is not sufficient. `interlock gate` also applies a quality band: a finding the skeptics scored too low for how well-grounded and actionable it is gets dropped before the gate counts blockers, so a vague blocker cannot hold up a change. That threshold lives in the CLI rather than in the review prose, which is what stops it from being quietly re-argued on each run.

A repo can own its review policy in an optional root **`REVIEW.md`**, read on every review. It can change **scope and advice**: declare `## Do Not Report` paths the CLI drops findings on, and prose — the local definition of "Important", who owns the bar — injected into the reviewer as clearly-delimited advice. It **cannot** change the band or the nit cap: those stay in the CLI, and a threshold-shaped key in the file is reported and ignored, never adopted — a path exclusion a model could talk past is not an exclusion, and a band a file could edit is not a gate. No `REVIEW.md` changes nothing; a malformed one is reported and the run proceeds under default policy. See [repository review policy](docs/12-repository-review-policy.md).

---

## Commands

`bootstrap` once per repo. Then `spec` and `ship` on every change. `mr` when you want the merge request.

| | | |
|---|---|---|
| `bootstrap` | Onboard a repo — once | skill |
| `spec` | Idea → reviewed, implementation-ready change | skill |
| `ship` | Reviewed change → commit (waves → verify → commit). `--strict` adds review and handoff | **workflow** (skill trampoline) |
| `mr` | Change → merge request | skill |

`ship` is the odd one out on purpose: a skill is instructions Claude follows, a workflow is a script a runtime executes. `/interlock:ship` is a thin skill that only launches `workflows/ship.js`, so the Skill tool can find it in any repo where the plugin is installed. The loop stays in the script.

<details>
<summary><b>Advanced surface</b> — mostly called by the four above; reach for them directly only when you know why</summary>

<br>

| | |
|---|---|
| `explore` | Parallel read-only reconnaissance, durable brief |
| `review-code` · `review-artifacts` | The adversarial gates, run standalone. Default `ship` does not run `review-code`; pass `--review` or `--strict`. |
| `graph` · `docs-digest` | Build and query the local code graph and docs digest |
| `fix-tests` | Discover the test setup, then repair failures by root cause |
| `manual-test-plan` · `explain-code` · `commit` | Individual `ship` stages, run on their own |
| `dispatch` | One batched pre-flight, then routes you to the right skill |

None of these are part of a first loop — see [the first hour](docs/01-first-hour.md).

Live-session retro (`session-retro`) now ships from [shippable-skills](https://github.com/renzrollon/shippable-skills) so it can run on Cursor, Copilot, Codex, and Claude Code. Install with `npx skills add renzrollon/shippable-skills`.

</details>

---

## It composes OpenSpec — it doesn't replace it

`openspec init` installs its own `openspec-propose`, `openspec-explore` and `openspec-apply-change` skills. Interlock does **not** fork them. `/interlock:spec` drives the `openspec` CLI directly — `openspec new change`, `openspec status --json`, `openspec instructions` — because the CLI is the stable contract and a forked skill drifts on every OpenSpec release.

What Interlock adds around it: parallel exploration with a durable brief, an evidence gate for bug fixes, invariant sweeps, wave execution with mechanical caps, optional adversarial review (`--strict` or `/interlock:review-code`), and the deterministic spine above.

Both sets of skills coexist. Plugin skills are namespaced, so `/openspec-propose` and `/interlock:spec` both stay available. Use `/interlock:spec` when you want the gates; use the stock skills when you want the plain artifact loop.

### Specs that don't quietly rot

Spec drift is the standing criticism of every tool in this category, and the usual answers are to delete the spec after shipping or to leave it to discipline. OpenSpec's `openspec archive` merges a completed change's deltas back into the living specs — Interlock never archives for you, it just stops the step being forgotten:

```bash
interlock drift --changed <files>
```

Four findings, deliberately kept at **different confidence** rather than averaged into one number: changes that finished but were never archived (certain — read off the filesystem); specs citing files that no longer exist (evidence — the file was there when the graph was built); changed source files no spec describes, always reported with a repo-wide coverage figure so the count means something; and specs older than code they cite (an inference from dates, printed last and labelled as such).

`interlock conformance` is the other half: it lists the scenarios a change's delta specs promised, so each can be checked against what was actually built. It emits questions, never verdicts.

**Neither blocks.** Every other subcommand exits non-zero when it blocks; these two never do. A gate built on regex-inferred spec→file links would be wrong often enough to get switched off, and a gate everyone disables protects nothing.

---

## Language support

Structural graph indexing — import and symbol edges — covers **JavaScript/TypeScript, Python, and shell**. Other languages (Go, Rust, Java, Ruby) get everything else: docs and OpenSpec indexing, spec→file links, prose retrieval, and the full workflow. When `interlock-graph build` finds nothing to index it says so and explains why, rather than reporting an empty graph as success.

Everything else in the plugin is stack-agnostic. `bootstrap` reads your dependency manifest and phrases its explorer agents in your stack's vocabulary.

---

## How it compares

Most of the category competes on how much structure you write before coding — Spec Kit adds phases, BMAD adds roles, Kiro adds an IDE. Interlock competes on a different axis: **how many decisions the model is not allowed to make.**

- **Caps and gates are code.** Remediation rounds, the task-failure budget, parallelism, the review quality floor — all in a tested CLI, not in markdown a model can talk itself past.
- **The zero-touch contract is the runtime's, not a prompt's.** `ship` is a workflow, so there is nobody to ask. Everyone else promises autonomy in prose. Default ship is waves → verify → commit; `--strict` is the review/handoff tail.
- **A dismissal must cite evidence; a report needn't.** On `--review` / `--strict` or `/interlock:review-code`, findings are attacked before you see them, dismissal counts are printed, and a refutation that cites nothing refutes nothing.
- **The invariant sweep is the licensed exception to the diff leash** — a value canonicalized in one place and still read raw in three others is the one bug class every diff-scoped review is structurally blind to.
- **Spec drift is measured, not hand-waved** — and reported at three separate confidence levels rather than one misleading number.

The trade is portability. Spec Kit runs on thirty agents; Interlock runs on one, because the guarantees above come from Claude Code's workflow runtime and its plugin surface. A portable version of this would be a folder of prompts, which is the thing it exists not to be.

That is a bet, not a wall. The part of Interlock that is host-specific turns out to be small — spawn an agent, run the CLI, branch on its exit code — so it is now a stated contract with a second implementation behind it (below). Everything the loop actually decides lives in a CLI any host shells out to. Portability here means *a second host adapter*, not thirty prompt templates.

---

## Experimental

**Earned autonomy** is an internal ledger. `interlock autonomy` records per-path run outcomes (`review-code`, artifact review, and `ship --strict`) and `interlock outcomes` accumulates one line per ship run, but **nothing reads either to change what the workflow does**. No autonomy level and no accumulated outcome ever relaxes a gate. The only path that skips the checkpoint is the explicit `--continue` flag on `spec`, which is fail-closed and accounted for in [continuity](docs/05-continuity.md) — never something the ladder earns on your behalf.

They exist to answer, later and from evidence, whether any gate can safely be relaxed. That question stays open until there is a corpus to answer it with, and wiring a branch before then would be deciding without the data these were built to gather.

**`interlock report` reads them, and still changes nothing.** It computes indicators over all three recorded corpora — outcome records, run trajectories, review metrics — with every value carrying its denominator, and it gates nothing: no threshold, no verdict, always exit 0, and no step of any run consults it. Reading a corpus and branching on it are different acts, and only the first has been built. See [the indicators](docs/11-the-indicators.md).

**Running Interlock against your own product?** [14 — Evals](docs/14-evals.md) states which properties of your run are checked and by which command's exit code, what is recorded and where, that none of it moves a gate, why Interlock runs **no model evals in your CI** — the model-facing surface is identical in every consumer, your own suite and your read at the checkpoint answer what you actually want to know, and the eval harness is early-access and metered on terms you do not control — and how to turn a misbehaving run into a citable report with `interlock evals capture`. Changing Interlock itself: the same page states which layers are evals, which are not, and how the suite should grow.

```bash
interlock report --html > report.html
```

`--html` renders the same report object as one self-contained document — no stylesheet, script or font is fetched, so it opens offline and can be attached to an issue or handed to someone without the repo. It is a generated file, not a service: no server, no port, no watch mode. It issues no verdict either, and gains none by being visual — no threshold, target or trend arrow is drawn, no colour encodes health, and an indicator nobody measured renders as `UNOBSERVED` with its reason at the same weight as a number, never as a zero.

**The runner: the same loop over a vendor coding CLI.** `lib/host.mjs` states the whole host contract — spawn one labeled agent, spawn a batch, run `interlock` and branch on its exit code — and forbids a host from reimplementing wave ordering, verify judgement, limits or the gate. `bin/interlock-run` is the second implementation of it, and it is not welded to one vendor: an adapter under `lib/host/` is a transport plus a declaration of what that host cannot do, and the run program reads the declaration rather than branching on a name. It lands on your `PATH` with the other two CLIs.

```bash
interlock-run <change-name> --host claude
INTERLOCK_ACP_COMMAND="<your-acp-agent>" interlock-run <change-name> --host acp
```

| `--host` | Drives | Result schema | Model selection | Plugin hooks | Token usage | Billing path |
|---|---|---|---|---|---|---|
| `claude` | `claude -p` | enforced by the CLI | the planner's slugs, passed through | yes (`--plugin-dir`) | yes | Anthropic, programmatic |
| `acp` | your `INTERLOCK_ACP_COMMAND` | recovered from text | negotiated on `session/new` | only over the Claude binary | no | whatever the agent is |
| `codex` | `codex exec` | enforced by the CLI | mapped, or unrouted | **no** | yes | ChatGPT plan or API key |
| `qwen` | `qwen -p` | enforced by the CLI | mapped, or unrouted | **no** | no | whatever you configured |

`interlock-ship-acp` still works and prints a deprecation line; it is removed in the next minor version.

- **The whole loop, including `--strict`.** Adversarial review, bounded remediation, the verdict and the handoff artifacts are steps `interlock run` emits, exactly as the waves are, so every host interprets them the way it interprets a batch. Adjudication, the round budget and the dimension selection never leave the CLI, so a strict run here halts on the same terms as one on Claude Code.
- **Isolation is the runner's, on every host.** Under `--isolate-waves` the step names one worktree path per lane, the runner creates it from the batch's merge base, and `interlock run record-batch` folds the clean lanes, removes their worktrees, and **halts naming the path and both lanes** when two of them wrote the same file despite a disjoint prediction. That is the same guarantee the Workflow host has, and it was the gap that was blocked on the host.
- **Model routing comes from one published map.** `INTERLOCK_MODEL_MAP` maps the planner's tier slugs to each host's model ids. Claude accepts `haiku`/`sonnet`/`opus` unmapped; Codex and Qwen do not, and an unmapped spawn there gets **no model flag** and is named in a `MODEL ROUTING UNAVAILABLE (<host>)` banner with its reason — never quietly run on your default and reported as the tier the planner asked for. `INTERLOCK_ACP_MODEL_MAP` is an alias of the `acp` entry.

  ```bash
  export INTERLOCK_MODEL_MAP='{"codex":{"haiku":"gpt-5-mini","sonnet":"gpt-5","opus":"gpt-5-pro"}}'
  ```

- **The runner names the billing path it is on.** Every summary prints `RUNNER HOST: <id> (experimental)`. A run over the Claude binary — directly, or through ACP — prints `SUBSCRIPTION PATH: programmatic`, because `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit; the interactive Workflow runtime is the path that change exempted, which is why **`/interlock:ship` stays the default and this runner is not started for you.** A Codex run with neither `CODEX_API_KEY` nor `OPENAI_API_KEY` prints `CHATGPT PLAN PATH`. A host with no hooks prints `HOOKS NOT IN FORCE (<host>)`. The receipt records the host, its billing path and its hook availability.
- **What a host cannot do is declared, not discovered.** Codex and Qwen have no equivalent of this repository's `PreToolUse` guards, so nothing stops a repair step from weakening a test there except the CLI's own unit-suite shrink check. Qwen reports no token accounting, so every wave and the run total are recorded as `unknown` — never as zero.
- **The zero-touch contract is weaker.** On Claude Code nobody can interrupt a run because the runtime has no channel for it. Here the driver just declines to ask — a policy in a file, not a property of a runtime.
- **`/interlock:ship` is untouched.** No flag, no auto-detect, no fallback: when the Workflow tool is missing the trampoline still halts, and the runner refuses `--host workflow` from the other side. See [when it stops](docs/04-when-it-stops.md).

**Evals over the model-facing surface.** The deterministic spine is densely unit-tested; the prompts, skills and shared contracts that steer a model are not, and the repo's own archived proposals record failures where the prompt bytes were correct and a model did the wrong thing anyway. An `evals/` case suite regression-tests that surface against a real model — tier read-scope, cited-cap resolution, lane partial-failure reporting, handoff enum conformance, control-plane action invention, trampoline halt, skill routing, and evidence-locator fabrication — each case citing the reproduced failure it encodes.

```bash
export CLAUDE_CODE_WALNUT_SPIRE=1          # early-access enablement — env only, never committed
claude plugin eval . --tag smoke --no-publish --json evals-results.json
interlock evals triage --results evals-results.json   # regression / variance / no signal — exit code is the verdict
```

- **Enablement is a local prerequisite.** `claude plugin eval` is early-access and does nothing until `CLAUDE_CODE_WALNUT_SPIRE=1` is set *in the environment*. Do not commit it to `.claude/settings.json` — a committed value produces a suite that looks configured and does not run.
- **The verdict is model-free.** `interlock evals triage` classifies a results file without a model or the network; its exit code is the verdict, so the one gate a model could otherwise re-argue is on the deterministic spine like every other decision.
- **Advisory, pending a baseline.** The CI eval job reports and does not block. No baseline scores exist yet, so any blocking threshold would be a guess; promotion needs observed variance across more than one run. The offline structural gate `test/evals.test.mjs` runs in `npm test` and *does* gate every pull request.
- **CI skips until access is provisioned.** The eval job ([.github/workflows/evals.yml](.github/workflows/evals.yml)) skips fork pull requests and skips cleanly when no model credential is present, so the suite lands and is maintained before paid access exists. Provisioning a credential is a later configuration action, not a prerequisite for the change.

**Code Mode is out of scope.** Running the loop as generated code against a tool API is interesting and it is not this: it would need Interlock to own a runtime to execute that code in, which it does not. Future work, contingent on that, not a supported ship host today.

---

## Development

```bash
git clone https://github.com/renzrollon/interlock && cd interlock
npm test                      # no dependencies to install first
claude plugin validate . --strict
claude --plugin-dir .         # load it without installing
```

`/reload-plugins` picks up edits without restarting.

---

## Credits

Built on [OpenSpec](https://github.com/Fission-AI/OpenSpec) by Fission AI, and on the wave-execution pattern for parallel task application.

[MIT](./LICENSE)
