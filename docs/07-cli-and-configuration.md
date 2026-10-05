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
| `interlock waves` | Wave order, the model a lane dispatches on, a **hard cap on parallel agents**, and whether two tasks in one wave would edit the same file. `--mode solo\|waves` forces the plan shape |
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
| `interlock doctor` | Whether the host can carry an unattended run: the permission allowlist against the commands the flow shells out to (including the one your own `.claude/testing/profile.json` names), the Node version, the installed plugin's workflow and agent types, the OpenSpec CLI, git, and whether the run-state directories can be written — each one where it lives, so from a linked worktree the trajectory directory is probed in the main checkout. Exits 1 when a check would stop a zero-touch run, prints the settings snippet that fixes it, and changes nothing itself. Its `state-home` and `claude-bare` rows are advice and never fail — see the note under this table |
| `interlock limits` | Every cap the loop obeys, so nothing restates one. Its last line adds the concurrency observed on this machine beside the vendor default: `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=<n>` when set, otherwise the vendor default and the CPU count that may reduce it. `--json` carries it as `runtime.observed` |
| `interlock notify` | The one outbound request this CLI makes — see below |
| `interlock evals` | Whether an eval results file shows a regression (`triage`), whether a case may move from advisory to blocking (`promote`), how often judged graders agreed with human labels (`calibrate`), and a draft case from a recorded run (`capture`). See [14](./14-evals.md) |
| `interlock report` | Indicators over the three recorded corpora, read from the state home, every value with its denominator. Gates nothing, always exits 0. See [11](./11-the-indicators.md) |
| `interlock outcomes` · `interlock autonomy` | Record a run's outcome, and per-path outcomes for the earned-autonomy ledger. **Nothing reads either to change what the workflow does**: no autonomy level and no accumulated outcome ever relaxes a gate. They exist so the question can be answered later, from evidence |

`--json` on any command emits JSON instead of prose. Any `<file>` argument accepts `-` to read that input from stdin.

Two of `interlock doctor`'s rows are advice, `ok` or `skip` and never `fail`, on the same posture as its `prompt-cache` row. **`state-home`** names the home this root's corpora go to and what the root is — a main checkout, a linked worktree, one of Interlock's lane worktrees — or `skip` with the reason when it could not tell ([the state home](#where-a-runs-records-go-the-state-home)); `doctor --json` carries the resolved `stateHome`, which the SessionStart preflight reads interrupted-run notes from. **`claude-bare`** says whether a bare `claude -p` would have a credential to run on: `ok` when `ANTHROPIC_API_KEY` is set (checked by name, never printed) or an `apiKeyHelper` is configured in a settings scope, `skip` otherwise. It exists because Claude Code's headless docs recommend `--bare` and say it will become the `-p` default, and under it OAuth and the keychain are never read: `--host claude` lanes would then need a key or a helper, and a plugin would load only through `--plugin-dir`. Nothing changes for a run today.

<p align="center">
  <img src="./assets/limits.png" alt="Example output of interlock limits: the caps the ship loop obeys, printed by the CLI." width="800">
</p>

### Where the loop itself lives

The wave loop, the halt conditions and the verification order live in `lib/run.mjs`, which emits the whole program as steps — the agents to spawn, with their briefings, and the exact `interlock` argv to call once they return. `workflows/ship.js` and the experimental `bin/interlock-run` are interpreters of that program, not two copies of it: each spawns what a step names and calls what it names next, and branches on nothing — not a flag, not a mode, not a count, not a verdict. Control flow written as prose is control flow the model can talk itself out of; control flow written twice in two drivers is control flow that drifts.

Without a shape flag, the classifier recommends `solo` or `waves` and the planner honours it inside the envelope `interlock limits` publishes; `--solo` and `--waves` force it. The plan preview names the mode before anything is spawned.

Tasks in a wave run in parallel in one working tree. The planner takes each task's predicted file list and moves any task that would collide with a sibling into a later batch of the same wave. Collision is compared on the **canonical** path, so `src/a.ts` and `./src/a.ts` are one file; a path that is absolute or escapes the repo root is reported as unusable rather than rewritten into scope. After that, consecutive batches that each hold one lane are fused into one chain lane — they were already serial — and a batch of two or more lanes is left parallel. The prediction is still a model's — but with `--isolate-waves`, each lane in a batch runs in its own git worktree, so a mis-predicted shared write can no longer overwrite a sibling lane. Their worktrees fold back afterward (`interlock merge-lanes`); a prediction miss surfaces as a named halt at merge time, never as a silently discarded write. Each isolated batch forks from a snapshot of the shared tree rather than from HEAD, which does not move until the ship commit, so a later batch or wave starts from every earlier fold. That snapshot carries untracked files `.gitignore` does not exclude, so they now reach the lane trees; an ignored generated file still does not. On the Workflow host, whose runtime forks lanes from `worktree.baseRef`, `--isolate-waves` is bannered at `run start` and halts with `LANE BASE MISMATCH` after the first fold until a follow-up change.

### Where a run's records go: the state home

A ship run writes two kinds of file. Its working state — the run manifest, the wave state, the briefings, the spill, the stage marker, the agent-usage sidecar — belongs to the tree it works on. Its corpora — the trajectory, the outcome line, the review metrics, the resume card, the interrupted-run note, the autonomy ledger — belong to the project, because `interlock report` reads every run the project has had. In a main checkout the two are one directory. In a linked worktree they are not, and the corpora go to the **state home**: the main checkout, found from git's common directory. Interlock's own lane worktrees are always their own home. [11](./11-the-indicators.md#where-they-live) has the full split, and [04](./04-when-it-stops.md#corpora-in-main-checkout-and-corpora-in-state-home) what a run in a worktree prints.

| Flag / variable | Effect |
|---|---|
| `--state-home <dir>` | Pins the state home. On `interlock run start` it is recorded on the run manifest, and every later `run` step uses the recorded home. On the commands that read or write a corpus — `report`, `run-log`, `outcomes`, `review --metrics`, `gate --metrics`, `evals capture`, `autonomy`, `wave-state`, `verify judge` and `doctor` — it names the home for that invocation. `--state-home .` keeps a worktree's records in the worktree. |
| `INTERLOCK_STATE_HOME` | The same, when no flag is given. |

Without either, a command uses the home that the run manifest at its root recorded, so a lane's `wave-state` append or a report taken mid-run agrees with the run; with no manifest it asks git. When git cannot answer, the home is the root and `run start` banners `STATE HOME UNRESOLVED`. A pinned home never changes the surface a run records — `main`, `linked-worktree`, `lane-worktree` or `unknown` — because the surface describes where the session is, not where its records go.

**`--root` is not the override.** It keeps its meaning: the working tree the command operates on. `interlock-run` passes `--root .` on every call it makes, so a rule that switched resolution off whenever `--root` was given would switch it off on the host most likely to run in a worktree.

The two inputs a fresh worktree lacks are read through, never copied. `run start` looks for `.claude/testing/profile.json` and `.claude/graph/graph.json` in the root first and the state home second, records the path it used on the manifest, and says which it read: `TEST PROFILE FROM MAIN CHECKOUT`, `GRAPH FROM MAIN CHECKOUT`, or `NO TEST PROFILE` / `GRAPH UNAVAILABLE` when neither place has one. No driver probes either file any more.

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

**In a linked worktree.** `.claude/graph/` is gitignored, so a fresh worktree has no graph. The commands that read the graph — `query`, `consumers`, `path`, `explain` and the graph half of `context` — read `<root>/.claude/graph/graph.json`, and when the root has none they read the [state home](#where-a-runs-records-go-the-state-home)'s instead and print one line on stderr, `GRAPH FROM MAIN CHECKOUT: <path>`, because that graph was built before this worktree's edits. `build`, `update`, `report` and `docs-index` write under the root they are given and never into the main checkout, so building a graph in the worktree makes it the one every later query finds first.

**Language coverage.** Structural indexing — import and symbol edges — covers **JavaScript/TypeScript, Python, and shell**. Other languages (Go, Rust, Java, Ruby) get everything else: docs and OpenSpec indexing, spec→file links, prose retrieval, and the full workflow. When `interlock-graph build` finds nothing to index it says so and explains why, rather than reporting an empty graph as success. Everything else in the plugin is stack-agnostic; `bootstrap` reads your dependency manifest and phrases its explorer agents in your stack's vocabulary.

---

## Model routing

The planner assigns a slug — `haiku`, `sonnet` or `opus` — to every spawn. A lane of two or more tasks is `opus` when its hardest tier is at or above the published multi-task opus floor (`LANE_CAPS.opusMinTier`, printed by `interlock limits`); below that floor it is `sonnet`. A lane of one task is that task's clamped model. On Claude Code those pass through unmapped. These environment variables change what actually runs. `interlock run start --host workflow` reads the first three from its own environment, against the version `claude --version` reports, and `interlock doctor`'s `claude-env` row prints the same reading before a run:

| Variable | Meaning |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL` | **Leave it unset.** From Claude Code 2.1.251 it sets only the *default* subagent model, and the model each spawn names wins. The run notes it (`MODEL ROUTING NOTE`) and the plan's tiers apply. On an older host, or when the version cannot be read, it overrides every per-tier model the planner assigned, so `ship` runs entirely on that model. The run banners this as `MODEL ROUTING OVERRIDDEN` rather than hiding it — see [04](./04-when-it-stops.md#model-routing-overridden). |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` | **Leave it unset.** Set to `1` on Claude Code 2.1.257 or later, it forces one model onto every agent, whatever the plan or the spawn asked for. The run banners `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and records the Workflow host's model selection as `forced`. |
| `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` | The Workflow runtime's concurrency (vendor default 16, which the runtime may reduce on a small machine). Interlock never resizes a plan to it. A batch wider than an override is bannered `WAVE WIDER THAN RUNTIME SLOTS`, and the extra lanes queue. `interlock limits` prints what it observed. |
| `CLAUDE_CODE_EFFORT_LEVEL` | **Leave it unset.** If set, the Claude CLI applies it to every agent, above its own `--effort` flag and above every per-step effort the plan assigned from `interlock limits`. Both drivers banner it as `EFFORT ROUTING OVERRIDDEN`, and neither strips it — see [04](./04-when-it-stops.md#effort-routing-overridden). The runner banners it on `--host claude` and on `--host acp` when the command is the Claude binary or a known wrapper (`claude-agent-acp`, `claude-code-acp`). |
| `INTERLOCK_MODEL_MAP` | Runner only. A JSON object keyed by host id, each entry mapping the planner's slugs to that host's model ids. Codex and Qwen have no idea what the slugs mean, so an unmapped spawn there gets **no model flag** and is named in a `MODEL ROUTING UNAVAILABLE (<host>)` banner with its reason — never quietly run on your default. Map `opus` as well as `sonnet`: a multi-task lane whose hardest tier clears the opus floor (and every solo lane) still asks for `opus`. `INTERLOCK_ACP_MODEL_MAP` is an alias of the `acp` entry. |

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

| `--host` | Drives | Result schema | Model selection | Effort | Plugin hooks | Token usage | Billing path |
|---|---|---|---|---|---|---|---|
| `claude` | `claude -p` | enforced by the CLI | the planner's slugs, passed through | `--effort`, when the CLI's help lists it | yes (`--plugin-dir`) | yes | Anthropic, programmatic |
| `acp` | your `INTERLOCK_ACP_COMMAND` | recovered from text | negotiated on `session/new` | negotiated with `session/set_config_option`, when advertised | only over the Claude binary | no | whatever the agent is |
| `codex` | `codex exec` | enforced by the CLI | mapped, or unrouted | **not routed** | **no** | yes | ChatGPT plan or API key |
| `qwen` | `qwen -p` | enforced by the CLI | mapped, or unrouted | **none** | **no** | no | whatever you configured |

An adapter under `lib/host/` is a transport plus a declaration of what that host cannot do, and the run program reads the declaration rather than branching on a name. What that means for a run:

- **The whole loop, including `--strict`.** Adversarial review, bounded remediation, the verdict and the handoff artifacts are steps `interlock run` emits, so every host interprets them the way it interprets a batch. A strict run here halts on the same terms as one on Claude Code.
- **Isolation is the runner's, on every host.** Under `--isolate-waves` the step names one worktree path per lane, the runner creates it from the batch's merge base — a snapshot of the shared tree, never HEAD, so a later batch sees every earlier fold — and `interlock run record-batch` halts with `LANE BASE MISMATCH` before folding anything if a lane's worktree is not checked out at that snapshot, then folds the clean lanes and halts naming the path and both lanes when two of them mutated the same file — created, modified or deleted it, so a rename's source counts against a lane that edited it.
- **The runner names the billing path it is on.** Every summary prints `RUNNER HOST: <id> (experimental)`. A run over the Claude binary — directly, or through ACP — prints `SUBSCRIPTION PATH: programmatic`, because `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit; the interactive Workflow runtime is the path that change exempted, which is why `/interlock:ship` stays the default and this runner is not started for you. A Codex run with neither `CODEX_API_KEY` nor `OPENAI_API_KEY` prints `CHATGPT PLAN PATH`. A host with no hooks prints `HOOKS NOT IN FORCE (<host>)`. The receipt records the host, its billing path and its hook availability.
- **What a host cannot do is declared, not discovered.** Codex and Qwen have no equivalent of the `PreToolUse` guards, so nothing stops a repair step from weakening a test there except the CLI's own unit-suite shrink check. Qwen reports no token accounting, so every wave and the run total are recorded as `unknown` — never as zero.
- **Effort is forwarded, and what landed is reported per spawn.** Each spawn carries the effort `interlock limits` publishes for it, or none, and the runner hands it to the adapter unchanged. Each host declares an `effort` capability — `flag`, `negotiated` or `unsupported` — recorded in the manifest and in the receipt's host block. `--host claude` reads the CLI's `--help` once, when the host is created, to see whether it has the `--effort` flag; a CLI without it, or one whose help cannot be read, is declared `unsupported` for the run and is passed no flag, so it does not reject the spawn. The summary says `effort routing: applied on N/N spawns`, or prints `EFFORT ROUTING UNAVAILABLE (<host>)` with one line per spawn that missed, naming the level it requested and the reason. A missed effort never fails a spawn.
- **What the host saw is read whatever the exit code, and travels on its own channel.** On `--host claude` the adapter reads the whole `claude -p` envelope — subtype, error flag, errors, permission denials by tool name, session id, turn count, the models the session called — and the lane session's own transcript for the models that served its turns. The runner writes those host records to `host-records.json` beside `results.json` and passes `--host-records <file>` on every continuation; `interlock run` accepts `--host-records <file|->` on every subcommand that accepts `--results`. A result is the agent's report and a host record is the host's observation, so the two never share a file, and the runner reads no field of a record: the CLI raises `LANE STOPPED BY HOST`, `SCHEMA RESULT MISSING (claude)`, `TOOLS DENIED IN LANE` and `MODEL SUBSTITUTED` from them and appends one `agent-result` trajectory event per lane ([04](./04-when-it-stops.md#lane-stopped-by-host-schema-result-missing-claude-and-tools-denied-in-lane)). The Workflow driver passes none.
- **No prompt the runner would wait on.** The default permission mode is `bypassPermissions`, which asks nobody anything. Set `INTERLOCK_CLAUDE_PERMISSION_MODE` to another mode and a lane can ask for permission with nobody there to answer, so the adapter adds `--permission-prompts none` — only when the CLI's `--help`, read once when the host is created (the same read that decides `--effort`), lists the flag, because a CLI that does not know a flag rejects the whole invocation. A CLI that does not list it gets no flag and a `PERMISSION PROMPTS NOT SUPPRESSED (claude)` banner. Under the default mode the argv is unchanged. The adapter never passes `--no-session-persistence` — the lane's transcript is where its served models are read, and what `claude --resume` needs — and passes `--plugin-dir` whenever the checkout is the plugin.
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
| `INTERLOCK_CLAUDE_PERMISSION_MODE` | `interlock-run --host claude` | The lanes' `--permission-mode`; default `bypassPermissions`. Any other mode adds `--permission-prompts none` where the CLI lists it, and a `PERMISSION PROMPTS NOT SUPPRESSED (claude)` banner where it does not |
| `INTERLOCK_STATE_HOME` | `interlock run start` and every command that reads or writes a corpus; `interlock-graph`'s query commands | Pins the [state home](#where-a-runs-records-go-the-state-home) when no `--state-home` is given |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Claude Code; `run start --host workflow` | **Leave unset.** Below 2.1.251, or with the version unknown, every tier runs on that model (bannered); from 2.1.251 it is only the default (noted) |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` | Claude Code; `run start --host workflow` | **Leave unset**, or every agent runs on one model (bannered, model selection recorded `forced`) |
| `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` | Claude Code; `run start --host workflow`, `interlock limits` | Workflow runtime slots. Observed and printed, never used to resize a plan |
| `CLAUDE_CODE_EFFORT_LEVEL` | Claude Code | **Leave unset**, or every agent runs at that effort, whatever the plan assigned (bannered as `EFFORT ROUTING OVERRIDDEN`, never stripped) |
| `CLAUDE_CODE_DISABLE_WORKFLOWS` | Claude Code | **Must be unset**, or `/interlock:ship` cannot start |
| `CLAUDE_CODE_WALNUT_SPIRE` | `claude plugin eval` | Maintainers only: enables the early-access eval harness. Environment only, never committed — see [14](./14-evals.md#running-the-model-evals) |

---

## Next

[**11 — The indicators**](./11-the-indicators.md) — what `interlock report` reads from the corpora these commands write, and why it gates nothing.
