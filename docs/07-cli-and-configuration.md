# 07 — The CLIs: reference and configuration

The plugin puts three executables on your `PATH` — `interlock`, `interlock-graph` and `interlock-run` — plus the `interlock-ship-acp` deprecation shim. Every subcommand runs without a model and without the network, with one named exception ([push notifications](#the-one-network-call-push-notifications)). They exist so that any decision the loop made can be re-run by you, on the same inputs, and give the same answer.

This page is the reference. [06 — Why it works](./06-why-it-works.md) explains why each decision moved out of prose; [04 — When it stops](./04-when-it-stops.md) explains every banner these commands print.

---

## Install the CLIs without the plugin

The CLIs are ordinary Node with zero dependencies, and each is useful on its own — `interlock` gates a CI job, `interlock-graph` indexes a repo for any agent, `interlock-run` drives the ship loop over a non-Claude host. They ship as an npm package as well as a plugin:

```bash
npm install -g @renzrollon/interlock
```

Or without installing anything, using the scope on the `-p` flag and the bare binary name after it:

```bash
npx -p @renzrollon/interlock interlock limits
```

| | |
|---|---|
| **Works from the package alone** | `interlock` (the policy engine), `interlock-graph` (build and query the codebase graph), `interlock-run` (drive the loop over the Claude Code CLI, an ACP agent, Codex or Qwen) |
| **Needs the Claude Code plugin** | `/interlock:spec`, `/interlock:ship`, `/interlock:bootstrap` and every other slash command; the `SessionStart` preflight and the `PreToolUse` guards. The package ships the skill and hook files so a package checkout is still a complete plugin, but nothing runs them without the plugin host |

---

## `interlock` — the deterministic spine

Each subcommand replaces a judgement the model used to re-derive in prose on every run, usually inconsistently. Every gating command exits 1 when it blocks, so the workflow branches on exit status rather than on parsed prose. `interlock --help` is the authoritative list; this table says what each one decides.

| Command | Decides |
|---|---|
| `interlock waves` | Wave order, per-task model, a **hard cap on parallel agents**, and whether two tasks in one wave would edit the same file. `--mode solo\|waves` forces the plan shape |
| `interlock surface` | Whether a diff touches UI, and therefore needs a manual test plan |
| `interlock gate` | Whether a review blocks, which findings are too weak to report, and how the rest partition for parallel fixers |
| `interlock review` | Which findings survive two skeptics, and how many were dismissed versus dropped as too weak. Reads the repo-root `REVIEW.md` and drops findings on its do-not-report paths |
| `interlock review-policy` | What the repo-root `REVIEW.md` actually says once parsed — owner, advice, and any parse problems. See [12](./12-repository-review-policy.md) |
| `interlock remediate` | What gets fixed, what gets deferred, and when the round budget is spent |
| `interlock verify` | What to run (`plan`), what a red result means (`judge`, `unit`), which failures share a root cause (`cluster`), and whether to repair, halt or accept next (`repair`) |
| `interlock wave-state` | What happens next in the wave loop, and when to stop |
| `interlock plan` | Whether a stored wave plan may be reused for this change (`reuse`), keyed on a fingerprint of its planning inputs (`fingerprint`) |
| `interlock merge-lanes` | Whether a batch's isolated lane worktrees fold cleanly back into the shared tree (`--isolate-waves` runs only). A real path collision is a halt naming the path and both lanes, never a guess |
| `interlock paths` | Which paths a commit actually touched (`touched`) and which the plan predicted (`predicted`). Always exit 0; an unreadable set is reported unobserved, never as empty |
| `interlock risk` | How dangerous a change is, from its paths and artifacts |
| `interlock drift` | Which completed changes were never archived, which specs cite files that are gone, and which changed files no spec describes |
| `interlock conformance` | Which spec scenarios a change must be checked against — the questions, never the verdicts |
| `interlock ready` | Whether a change may skip the human checkpoint — fail-closed. See [05](./05-continuity.md) |
| `interlock ledger` | Whether the decision ledger still holds an unanswered product question |
| `interlock validate` | Whether a change is actually implementable |
| `interlock changes` | Which OpenSpec changes are active |
| `interlock tasks` | Whether the wave plan covers every unchecked box (`coverage`), and which ids may be ticked (`tick`) |
| `interlock run-log` | Whether a finished run's trajectory can actually be replayed (`check`), and what it recorded (`list`, `show`, `query`) |
| `interlock run` | The whole ship loop, as steps: every briefing and every branch a driver obeys next. `run close` is the only step that exits non-zero — on a halt, or on a run that cannot be reconstructed |
| `interlock doctor` | Whether the host can carry an unattended run: the permission allowlist against the commands the flow shells out to (including the one your own `.claude/testing/profile.json` names), the Node version, the installed plugin's workflow and agent types, the OpenSpec CLI, git, and whether the run-state directories can be written. Exits 1 when a check would stop a zero-touch run, prints the settings snippet that fixes it, and changes nothing itself |
| `interlock limits` | Every cap the loop obeys, so nothing restates one |
| `interlock notify` | The one outbound request this CLI makes — see below |
| `interlock evals` | Whether an eval results file shows a regression (`triage`), whether a case may move from advisory to blocking (`promote`), how often judged graders agreed with human labels (`calibrate`), and a draft case from a recorded run (`capture`). See [14](./14-evals.md) |
| `interlock report` | Indicators over the three recorded corpora, every value with its denominator. Gates nothing, always exits 0. See [11](./11-the-indicators.md) |
| `interlock outcomes` · `interlock autonomy` | Record a run's outcome, and per-path outcomes for the earned-autonomy ledger. **Nothing reads either to change what the workflow does**: no autonomy level and no accumulated outcome ever relaxes a gate. They exist so the question can be answered later, from evidence |

`--json` on any command emits JSON instead of prose. Any `<file>` argument accepts `-` to read that input from stdin.

### Where the loop itself lives

The wave loop, the halt conditions and the verification order live in `lib/run.mjs`, which emits the whole program as steps — the agents to spawn, with their briefings, and the exact `interlock` argv to call once they return. `workflows/ship.js` and the experimental `bin/interlock-run` are interpreters of that program, not two copies of it: each spawns what a step names and calls what it names next, and branches on nothing — not a flag, not a mode, not a count, not a verdict. Control flow written as prose is control flow the model can talk itself out of; control flow written twice in two drivers is control flow that drifts.

Without a shape flag, the classifier recommends `solo` or `waves` and the planner honours it inside the envelope `interlock limits` publishes; `--solo` and `--waves` force it. The plan preview names the mode before anything is spawned.

Tasks in a wave run in parallel in one working tree. The planner takes each task's predicted file list and moves any task that would collide with a sibling into a later batch of the same wave. Collision is compared on the **canonical** path, so `src/a.ts` and `./src/a.ts` are one file; a path that is absolute or escapes the repo root is reported as unusable rather than rewritten into scope. The prediction is still a model's — but with `--isolate-waves`, each lane in a batch runs in its own git worktree, so a mis-predicted shared write can no longer overwrite a sibling lane. Their worktrees fold back afterward (`interlock merge-lanes`); a prediction miss surfaces as a named halt at merge time, never as a silently discarded write.

---

## The one network call: push notifications

A ship run that halts or completes while nobody is watching can push you a message. It is off by default and reads only from the environment — nothing is read from or written to the repo tree for this:

| Variable | Meaning |
|---|---|
| `INTERLOCK_NTFY_TOPIC` | The [ntfy](https://ntfy.sh) topic to post to. Unset (the default) means `run close` posts nothing, and the suite never makes a request. Treat the value as a secret — anyone who knows it reads every message, since it is the only authentication the public server offers. |
| `INTERLOCK_NTFY_URL` | The ntfy server, defaulting to the public `https://ntfy.sh`. Point it at a self-hosted server if the public relay is not an acceptable trust boundary for your halt reasons. |

With a topic set, both `workflows/ship.js` and `bin/interlock-run` pass `--notify` on every close, so one message goes out per terminal outcome — `high` priority on `SHIP HALTED`, default priority otherwise — naming only the summary's first line, the change and the run id, never the topic, the working directory or the project slug. A failed push shows up as `push: failed — <reason>` in the summary and a `PUSH FAILED: <reason>` banner, and never changes the run's exit code. See [when it stops](./04-when-it-stops.md#push-failed) for the failure modes, or run a one-off yourself:

```bash
interlock notify --title "<title>" --body "<body>"
```

---

## `interlock-graph` — the local code knowledge graph

A deterministic code knowledge graph under `.claude/graph/`. No vector store, no network. Agents navigate with token-budgeted subgraphs instead of re-grepping:

```bash
interlock-graph build .
interlock-graph consumers normalizeEmail
interlock-graph path lib/auth app/api
interlock-graph context "<query>" --budget 2000
```

`build` indexes, `update` rebuilds incrementally, and `query`, `consumers`, `path`, `explain`, `docs` and `context` read it back within a token budget. `/interlock:bootstrap` builds it for you; `interlock-graph --help` lists every option.

**Language coverage.** Structural indexing — import and symbol edges — covers **JavaScript/TypeScript, Python, and shell**. Other languages (Go, Rust, Java, Ruby) get everything else: docs and OpenSpec indexing, spec→file links, prose retrieval, and the full workflow. When `interlock-graph build` finds nothing to index it says so and explains why, rather than reporting an empty graph as success. Everything else in the plugin is stack-agnostic; `bootstrap` reads your dependency manifest and phrases its explorer agents in your stack's vocabulary.

---

## Model routing

The planner assigns a tier slug — `haiku`, `sonnet` or `opus` — to every spawn. On Claude Code those pass through unmapped. Two environment variables change what actually runs:

| Variable | Meaning |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL` | **Leave it unset.** If set, Claude Code applies it to every subagent, overriding every per-tier model the planner assigned, so `ship` runs entirely on that model. The run banners this as `MODEL ROUTING OVERRIDDEN` rather than hiding it — see [04](./04-when-it-stops.md#model-routing-overridden). |
| `INTERLOCK_MODEL_MAP` | Runner only. A JSON object keyed by host id, each entry mapping the planner's slugs to that host's model ids. Codex and Qwen have no idea what the slugs mean, so an unmapped spawn there gets **no model flag** and is named in a `MODEL ROUTING UNAVAILABLE (<host>)` banner with its reason — never quietly run on your default. `INTERLOCK_ACP_MODEL_MAP` is an alias of the `acp` entry. |

```bash
export INTERLOCK_MODEL_MAP='{"codex":{"haiku":"gpt-5-mini","sonnet":"gpt-5","opus":"gpt-5-pro"}}'
```

---

## `interlock-run` — the experimental runner

`/interlock:ship` runs on Claude Code's Workflow runtime and nowhere else. `interlock-run` is a second implementation of the same host contract (`lib/host.mjs`: spawn one labeled agent, spawn a batch, run `interlock` and branch on its exit code) over a vendor coding CLI. You start it yourself; no slash command starts it for you, and `/interlock:ship` never falls back to it.

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

An adapter under `lib/host/` is a transport plus a declaration of what that host cannot do, and the run program reads the declaration rather than branching on a name. What that means for a run:

- **The whole loop, including `--strict`.** Adversarial review, bounded remediation, the verdict and the handoff artifacts are steps `interlock run` emits, so every host interprets them the way it interprets a batch. A strict run here halts on the same terms as one on Claude Code.
- **Isolation is the runner's, on every host.** Under `--isolate-waves` the step names one worktree path per lane, the runner creates it from the batch's merge base, and `interlock run record-batch` folds the clean lanes and halts naming the path and both lanes when two of them wrote the same file.
- **The runner names the billing path it is on.** Every summary prints `RUNNER HOST: <id> (experimental)`. A run over the Claude binary — directly, or through ACP — prints `SUBSCRIPTION PATH: programmatic`, because `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit; the interactive Workflow runtime is the path that change exempted, which is why `/interlock:ship` stays the default and this runner is not started for you. A Codex run with neither `CODEX_API_KEY` nor `OPENAI_API_KEY` prints `CHATGPT PLAN PATH`. A host with no hooks prints `HOOKS NOT IN FORCE (<host>)`. The receipt records the host, its billing path and its hook availability.
- **What a host cannot do is declared, not discovered.** Codex and Qwen have no equivalent of the `PreToolUse` guards, so nothing stops a repair step from weakening a test there except the CLI's own unit-suite shrink check. Qwen reports no token accounting, so every wave and the run total are recorded as `unknown` — never as zero.
- **The zero-touch contract is weaker.** On Claude Code nobody can interrupt a run because the runtime has no channel for it. Here the driver just declines to ask — a policy in a file, not a property of a runtime.

Every banner the runner prints, with what to do about it, is in [04 — When it stops](./04-when-it-stops.md#runner-host-id-experimental-and-the-rest-of-the-runners-banners). `interlock-ship-acp` still works and prints a deprecation line; it is removed in the next minor version. **Code Mode is out of scope**: running the loop as generated code against a tool API would need Interlock to own a runtime to execute that code in, which it does not — future work, contingent on that, not a supported ship host today.

---

## Environment variables, in one place

| Variable | Read by | Effect |
|---|---|---|
| `INTERLOCK_NTFY_TOPIC` | `interlock notify`, `run close --notify` | Enables push notifications. Unset: no request is ever made |
| `INTERLOCK_NTFY_URL` | same | ntfy server; default `https://ntfy.sh` |
| `INTERLOCK_MODEL_MAP` | `interlock-run` | Planner tier slug → host model id, per host |
| `INTERLOCK_ACP_MODEL_MAP` | `interlock-run --host acp` | Alias of the `acp` entry above |
| `INTERLOCK_ACP_COMMAND` | `interlock-run --host acp` | The ACP agent command to drive |
| `INTERLOCK_RUN_HOST` | `interlock-run` | Default for `--host` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Claude Code | **Must be unset**, or every tier runs on that model (bannered) |
| `CLAUDE_CODE_DISABLE_WORKFLOWS` | Claude Code | **Must be unset**, or `/interlock:ship` cannot start |
| `CLAUDE_CODE_WALNUT_SPIRE` | `claude plugin eval` | Maintainers only: enables the early-access eval harness. Environment only, never committed — see [14](./14-evals.md#running-the-model-evals) |

---

## Next

[**11 — The indicators**](./11-the-indicators.md) — what `interlock report` reads from the corpora these commands write, and why it gates nothing.
