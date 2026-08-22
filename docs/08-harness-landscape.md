# The harness landscape

Three projects come up constantly right now: **OpenClaw**, **Nous Research's
Hermes Agent**, and **DeepSeek Harness (`dsh`)**. Between them they hold roughly
790,000 GitHub stars. If you already run Interlock and ship changes with it, the
obvious question is what any of them are for and whether you are missing
something.

The short answer, argued at length below: **two of the three sit at a layer
Interlock does not occupy, and the third sits at the layer Interlock is welded
to.** None of them does spec-driven development. One of them is a slow-moving
strategic problem for a plugin that only runs on Claude Code.

This page is written the way [03 — OpenSpec vs Interlock](./03-openspec-vs-interlock.md)
is written: who owns what, and when to reach for which. It opens in plain language
because the useful part of the answer needs no vocabulary; the low-level sections
come after and go as deep as the primary sources support. Every claim is either
linked to a source that was actually read or marked as judgement. Repository
numbers were observed **2026-08-20** via the GitHub API and are stated as of that
date.

---

## Read this first: what each one actually is

### OpenClaw

**What this is.** A personal assistant that runs as a long-lived process on a
machine you own, and that you talk to from the chat apps you already have open.
Its own README puts it as "your assistant, on your devices, in your chats"
([README](https://github.com/openclaw/openclaw)). One process — the **Gateway** —
holds your sessions, tools, and model credentials, and connects out to WhatsApp,
Telegram, Slack, Discord, Google Chat, Signal, and iMessage.

**What it replaces.** The assumption that your agent lives in a terminal on your
laptop, and stops existing when you close the lid.

**When you'd reach for it.**

- You are on a train. CI failed. You want to message your agent on Telegram, have
  it open the repo on the box at home, read the failure, and push a fix — with no
  laptop involved.
- You want one assistant, with one set of memories and credentials, reachable
  from Slack during the day and WhatsApp in the evening, rather than two
  disconnected chat histories.
- You want long-running work — a scrape, a migration, a build — to keep running
  after you disconnect, and to message you when it is done.

**When it buys you nothing.** Nothing about `spec → read → ship` improves. OpenClaw
does not know what a wave is, will not cap your remediation rounds, will not
refuse a review dismissal that cites no `file:line` span, and will not tell you
that a change finished but was never archived. It changes *where you type* and
*what stays running*. It does not change what happens between the typing and the
commit. If your complaint about Interlock has ever been "I wish I could kick off
a ship from my phone", OpenClaw is aimed at you; if it has never been that, it is not.

### Hermes Agent

**What this is.** A single-user agent, written in Python, whose distinguishing
feature is that it accumulates. It writes its own notes about you, searches its
own past conversations, and writes new skills for itself after it finishes
something complicated. Nous Research calls it "the only agent with a built-in
learning loop" ([README](https://github.com/NousResearch/hermes-agent)). It also
ships a messaging gateway like OpenClaw's, and it can run its shell on seven
different backends, including sandboxes that hibernate when idle.

**What it replaces.** Re-explaining yourself. The `CLAUDE.md` you keep meaning to
update. Also, at the infrastructure end, the assumption that the agent's shell is
your shell.

**When you'd reach for it.**

- You told it three weeks ago that deploys go through a tagged release and never
  from `main`, and you want it to still know that today without you saying it
  again — and to be able to find the conversation where you said it.
- You want a scheduled job in plain language — "every night, check whether any
  dependency has a published CVE and message me on Signal" — that runs unattended
  and delivers to whichever chat app you use.
- You want the agent's `rm -rf` to happen in a Modal or Daytona sandbox that
  costs nothing while idle, not in your home directory.

**When it buys you nothing — and where it actively disagrees with you.** Hermes'
central bet is that an agent should edit its own instructions based on how things
went. Interlock's central bet is the opposite: a decision with a correct answer
belongs in a tested CLI, not in prose the model can revise. Those are not
compatible philosophies, and the incompatibility is the interesting part rather
than a detail. Interlock already has the disciplined version of this loop:
[`session-retro`](https://github.com/renzrollon/shippable-skills) (now a
standalone skill) *proposes* a wire-in and a human applies it. Hermes skips
the human. If you adopted its self-improving
skills wholesale you would be re-introducing exactly the unaudited, un-tested,
silently-drifting prose that `lib/limits.mjs` exists to abolish.

### DeepSeek Harness (`dsh`)

**What this is.** Not a model. This is the single most common confusion, so it is
worth saying flatly: DeepSeek publishes model weights, and separately, since
2026-08-13, publishes **`dsh`**, a TypeScript program that runs an agent loop.
`dsh` is the thing that holds the conversation, assembles the system prompt,
calls whatever model you configured, dispatches tool calls, and writes it all
down. It is the same *kind* of thing as Claude Code or the OpenClaw runtime,
not the same kind of thing as DeepSeek-V3.

Its slogan is "Everything is a Plugin", and it means it literally: the model
adapter, the tool registry, the session log, and the agent loop itself are all
plugins, "so every part is replaceable from configuration"
([architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)).

**What it replaces.** The coding agent you currently run, if you are the sort of
person who wants to rebuild it.

**When you'd reach for it.**

- You are *building* an agent product rather than using one, and you want the
  loop, the tools, and the storage to be swappable without forking anything.
- You want a complete, replayable record of every fact the model saw, as an
  append-only typed event log rather than a chat transcript — because you intend
  to audit, replay, or fork runs.
- You need to run an agent headlessly inside other software, with the UI and the
  server as optional layers you simply do not mount.

**When it buys you nothing.** `dsh` is a harness. Interlock is a process that runs
*on* a harness. Moving Interlock onto `dsh` would mean rewriting who spawns the
agents and nothing else — you would not gain a single gate, cap, or check,
because those already live in `bin/interlock` and are host-agnostic by
construction. It is a port, not an upgrade. That said, `dsh` is the one of the
three with implications for Interlock's future, and the last section says why.

---

## The layers

The reason these three feel confusingly similar is that they are all "an AI agent
thing", and the reason they are actually easy to tell apart is that they sit on
different floors.

OpenClaw's own documentation draws the cleanest version of the bottom half of
this, and it is worth quoting because it is a better articulation than most
projects manage
([Agent runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)):

| Layer | Examples | Meaning |
|---|---|---|
| Provider | `anthropic`, `github-copilot`, `openai` | How OpenClaw authenticates, discovers models, and names model refs. |
| Model | `claude-opus-4-6`, `gpt-5.6-sol` | The model selected for the agent turn. |
| Agent runtime | `claude-cli`, `codex`, `copilot`, `openclaw` | The low-level loop or backend that executes the prepared turn. |
| Channel | Discord, Slack, Telegram, WhatsApp | Where messages enter and leave OpenClaw. |

Extend that upward and you get the whole stack, with all four projects placed:

```
process / workflow    what gets built, in what order,      Interlock, Spec Kit, BMAD
                      under which gates, and when a
                      human is required to look

memory / continuity   what survives a session boundary     Hermes memory + skills + FTS5 recall
                                                           Interlock: explore briefs, decision
                                                           ledger, OpenSpec specs

tool surface          what the model may touch, and        dsh tools/sandbox/terminal seams
                      where the touching happens           Hermes seven terminal backends
                                                           OpenClaw tool policy + sandboxing

harness / runtime     who owns the loop, the transcript,   dsh, OpenClaw embedded runtime,
                      compaction, and tool dispatch        Claude Code, Codex app-server

model                 the weights                          Claude, GPT, DeepSeek, Hermes models

                      -- orthogonal edge --
channels / transport  where a human reaches the agent      OpenClaw Gateway, Hermes gateway
```

Read down the right-hand column and the answer falls out.

**OpenClaw** is a harness *plus* a channel layer, and its distinctive work is the
channel layer. **Hermes** is a harness plus a channel layer plus a memory layer,
and its distinctive work is the memory layer. **`dsh`** is a harness and nothing
else, and its distinctive work is making every part of the harness removable.
**Interlock** is a process layer, and it has no harness at all — it borrows Claude
Code's.

That last sentence is the whole relationship. Interlock does not compete with any
of these three, because it does not do the thing any of them do. It sits on top
of one of their peers.

The corollary is less comfortable, and this page will not soften it: a process
layer with no harness of its own is a tenant. [06 — Why it works](./06-why-it-works.md#14-what-this-costs-honestly)
already books this under "portability", and the honest 2026 version is that
portability is not a nice-to-have when the floor beneath you has three
well-funded new implementations in one year.

---

## OpenClaw, in detail

[github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) · TypeScript ·
created 2025-11-24 · 386,889 stars, 81,269 forks · MIT per the README badge ·
docs at [docs.openclaw.ai](https://docs.openclaw.ai)

### The gateway is the product

The Gateway is "the local control plane for sessions, tools, events, and channel
connections". Everything else — the Control UI, the CLI, the TUI — is a client
that connects to it. You install with a shell one-liner, run
`openclaw onboard --install-daemon`, and thereafter `openclaw gateway status` and
`openclaw dashboard`. Channels attach to the Gateway; companion apps and device
nodes add voice, camera, screen and device-local actions on supported platforms.

The interesting architectural consequence is that the *session* is a Gateway
object, not a terminal object. That is what makes "start it on the laptop,
continue it from Telegram" a property of the design rather than a feature someone
bolted on. The Gateway is a real supervised daemon, too — `openclaw gateway
install` writes a launchd LaunchAgent, a systemd user unit, or a Windows Scheduled
Task depending on the platform.

If you have seen this project under another name, you have: its own
[lore page](https://docs.openclaw.ai/start/lore) records the chain from **Warelay**
through **Clawdbot** to **Moltbot** on 2026-01-27 and finally **OpenClaw** on
2026-01-30, with the first rename prompted by Anthropic making trademark contact
over the closeness of "Clawd" to "Claude".

### Runtimes versus harnesses, precisely

OpenClaw draws a distinction that most of this category leaves mushy, and getting
it right is necessary to compare it with anything else.

> An **agent runtime** owns one prepared model loop: it receives the prompt,
> drives model output, handles native tool calls, and returns the finished turn
> to OpenClaw. […] A **harness** is the implementation that provides an agent
> runtime (code term).
> — [Agent runtimes](https://docs.openclaw.ai/concepts/agent-runtimes)

So "runtime" is the configuration-facing noun and "harness" is the code-facing
noun for the same slot. There are two families. **Embedded harnesses** run inside
OpenClaw's prepared agent loop: the built-in `openclaw` runtime, plus registered
plugin harnesses such as `codex` and the opt-in `copilot`. **CLI backends** shell
out to a local CLI process while keeping the model reference canonical —
`anthropic/claude-opus-5` with a model-scoped `agentRuntime.id: "claude-cli"`
means "select the Anthropic model, execute through Claude CLI". The docs are
explicit that `claude-cli` "is not an embedded harness id and must not be passed
to AgentHarness selection".

### What core keeps, and what a harness gets

The [agent harness plugin SDK](https://docs.openclaw.ai/plugins/sdk-agent-harness)
defines the contract, and its opening line is the useful one: "An agent harness is
the low level executor for one prepared OpenClaw agent turn. It is not a model
provider, not a channel, and not a tool registry."

Before a harness is selected, core has already resolved the provider and model,
auth state, thinking level and context budget, the OpenClaw transcript file, the
workspace, sandbox and tool policy, the channel reply and streaming callbacks,
and the model-fallback policy. "A harness runs a prepared attempt; it does not
pick providers, replace channel delivery, or silently switch models."

Registration is small. From `openclaw/plugin-sdk/agent-harness`, an
`AgentHarnessV2` is an object with an `id`, a `label`, a `supports(ctx)` predicate
and an async `runAttempt(params)`, handed to `api.registerAgentHarness(...)` inside
a `definePluginEntry`. `supports` returns either `{ supported: true, priority }`
or `{ supported: false, reason }`.

The parts worth stealing conceptually are in the details around that:

- **Support is decided from prepared facts, not from config.** `supports(ctx)`
  receives `ctx.modelProvider.runtimePolicy.compatibleIds` and
  `requestTransportOverrides: "none" | "present"`. The docs specifically forbid
  inferring support by reading raw config after selection, and state that "an
  absent policy means the provider did not declare route-level compatibility; it
  is not permission to assume support." That is the same fail-closed instinct as
  `interlock ready`.
- **Policy that must be shared is passed as a bundle, not re-derived.** Each
  prepared attempt carries `params.runtimePlan` with
  `runtimePlan.tools.normalize(...)`, `runtimePlan.transcript.resolvePolicy(...)`,
  `runtimePlan.delivery.isSilentPayload(...)` and
  `runtimePlan.outcome.classifyRunResult(...)`, and harnesses are told to treat it
  as host-owned attempt state rather than mutate it. This is `interlock limits`
  wearing a different hat: one owner for a rule, and everybody else cites it.
- **Facts are reported from the execution boundary, and logging belongs to the
  host.** `AgentHarnessAttemptParams.observeToolTerminal` must be called for every
  tool reaching a terminal outcome, with `executionStarted: false` only when a
  guard stopped the call before the implementation began — report `true`
  conservatively once dispatch may have happened, and never infer failure from
  display text. Separately, `params.hostCapabilities.trajectory` exposes
  closure-bound `recordEvent(...)` and `flush()`; the host adds attribution,
  bounds and redacts. Plugins are told not to infer storage paths or build their
  own fallback.

### Selection policy

Resolution happens after provider and model, in a fixed order: model-scoped
runtime policy wins; then provider-scoped policy; then `auto`, in which registered
plugin harnesses are asked whether they support the resolved effective route; and
if nothing claims it, the embedded `openclaw` runtime handles the turn. A provider
or model *prefix* never selects a harness on its own.

Two properties make this more than a lookup table. **Explicit selection fails
closed** — `agentRuntime.id: "codex"` means Codex or a clear error, never a silent
reroute, and only `auto` may fall back. And **a claimed run is never replayed
through another runtime**, because that could change auth semantics or duplicate
side effects. Whole-session and whole-agent pins are ignored outright as legacy,
with `openclaw doctor --fix` owning the migration.

The bundled Codex plugin is the reference pairing — harness id `codex`, preferred
model refs `openai/gpt-5.6-sol`, synthetic provider availability because the
harness owns the native Codex login — and OpenAI is the documented exception to
the general conservatism, since unset runtime and `auto` both resolve to Codex.
The `copilot` runtime, from the external `@openclaw/copilot` plugin backed by the
GitHub Copilot CLI, is the opposite: "never selected by `auto`", opt-in only.

### Session state and the transcript mirror

When a native harness owns the thread — Codex owns its own thread id, resume
behaviour and compaction — OpenClaw keeps mirroring visible output into its own
transcript anyway, for channel-visible history, transcript search, generic
`/new` and `/reset`, and the ability to switch back to the built-in harness on a
later turn. A harness holding a sidecar binding must implement `reset(...)` so
the host can clear it. The mirror is what makes the native runtime replaceable
*after* the fact rather than only before it, and Interlock has no equivalent.

### Security posture

Stated bluntly in the README: "Treat inbound messages as untrusted input."
DM-capable channels pair unknown senders by default, approved with
`openclaw pairing approve <channel> <code>`. And the sentence that should govern
how you deploy it: "Tools run on the host for the main session unless you
configure sandboxing." An agent gateway reachable from WhatsApp, executing tools
on the host by default, is a posture you should choose deliberately rather than
inherit.

---

## Hermes Agent, in detail

[github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) ·
Python · created 2025-07-22 · 233,410 stars, 46,729 forks · MIT ·
docs at [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/)

The repository description is "The agent that grows with you", and unusually for
this category the tagline is also the architecture.

### The closed learning loop

Four mechanisms, described in the README and expanded in the
[skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
and [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
guides:

- **Agent-curated memory with periodic nudges.** The agent decides what is worth
  writing down and is prompted to do so rather than waiting to be asked. The
  implementation is smaller than the phrase suggests: two character-capped plain
  files under `~/.hermes/memories/` — `MEMORY.md` at 2,200 characters and
  `USER.md` at 1,375 — written through a `memory` tool with `add` / `replace` /
  `remove` and deliberately **no read action**, because both files are rendered
  into the system prompt at session start. The snapshot is then frozen for the
  rest of the session to protect the provider's prefix cache, so a write lands on
  disk immediately but does not reach the prompt until next time.
- **Autonomous skill creation after complex tasks**, with skills that "self-improve
  during use". Skills are the same procedural-memory idea Interlock uses, except
  authored by the agent about itself. Hermes states compatibility with the
  [agentskills.io](https://agentskills.io) open standard — a `SKILL.md`-in-a-folder
  format originally developed by Anthropic and released as an open standard — and
  is listed on that standard's own client showcase.
- **FTS5 session search for cross-session recall.** SQLite full-text search over
  every past conversation, from every surface, in one `~/.hermes/state.db`.
  Worth being precise here, because the README oversells it: the README says
  "FTS5 session search **with LLM summarization**", and the documentation
  contradicts that twice — "It makes no LLM calls and returns views of actual
  messages from the DB rather than generating summaries." The retrieval path is
  free. That makes it *more* interesting rather than less: it is a search index
  over durable records, not a memory the model narrates to itself.
- **[Honcho](https://github.com/plastic-labs/honcho) dialectic user modeling** — an
  external service, one of eight pluggable memory providers, that maintains a
  model of the user across sessions so "who you are" is queryable rather than a
  paragraph in a config file.

### Zero-context-cost turns

The mechanism most relevant to anyone who cares about token economy, and the
strongest single idea in the project. The README calls it "Write Python scripts
that call tools via RPC, collapsing multi-step pipelines into zero-context-cost
turns."

A multi-step tool pipeline — call A, inspect, branch, call B, aggregate — normally
costs one model turn per step, and every intermediate result re-enters the context
window. Instead, the `execute_code` tool generates a `hermes_tools.py` stub, opens
a Unix domain socket, and runs the model's script in a child process; tool calls
travel back over the socket and are dispatched through the same handler as any
other call. Intermediate results are consumed inside the child and never enter the
transcript.

"Zero-context-cost" is marketing rather than mechanism — the script's `print()`
output does return to the model, capped at 50 KB, and the documentation's own
phrasing is the defensible one: "collapsing multi-step workflows into a single
LLM turn." The saving is real; it is just not zero.

If that sounds familiar it should. It is the identical argument to
[§2 of Why it works](./06-why-it-works.md#2-where-the-plan-lives-and-why-that-decides-everything):
in a workflow, results land in `const` bindings instead of the orchestrator's
window. Hermes gives that lever to the *model*, at the tool layer, per pipeline.
Interlock takes it from the model and gives it to a script, at the loop layer,
per run. Same physics, opposite trust assumption. Interlock's version is safer and
less flexible, which is the trade it makes everywhere.

### Terminal backends

Seven, per the README: **local, Docker, SSH, Singularity, Modal, Daytona, and
Vercel Sandbox**. Daytona and Modal are called out for serverless persistence —
the environment hibernates when idle and wakes on demand.

This is the layer where Hermes is furthest ahead of Interlock and it is not close.
Interlock's wave engine runs parallel implementers **in one working tree**, and
[§5.2](./06-why-it-works.md#52-independence-is-now-checked) is candid that
predicted-path collision detection narrows the race rather than closing it. A
per-task container or worktree would close it. Interlock cannot currently do that,
because the Claude Code workflow runtime owns the spawn.

### Everything else

A gateway process serving Telegram, Discord, Slack, WhatsApp, Signal and email; a
cron scheduler with delivery to any of those platforms; isolated subagents for
parallel workstreams; MCP servers; 40+ tools behind a toolset system; provider
switching via `hermes model` across Nous Portal, OpenRouter, OpenAI and custom
endpoints; `/compress`, `/usage` and `/insights` as first-class context commands.
Security is documented as command approval, DM pairing and container isolation.

### Why a model lab built this

The README's last row is the tell: "Batch trajectory generation, trajectory
compression for training the next generation of tool-calling models."

Nous Research trains models. An agent in wide use is a trajectory factory, and
tool-calling trajectories are among the most valuable and least available training
data there is. This is not a criticism — it is disclosed in the README, the code
is MIT — but it does explain the design, and the batch runner makes the intent
unambiguous. `batch_runner.py` replays the same agent over a prompt dataset and
emits ShareGPT-format conversations; samples where no assistant turn contains
reasoning are **discarded** "to avoid polluting training data with non-reasoning
examples"; tool-statistics schemas are padded to a fixed shape to prevent Arrow
mismatches on load. Those are the choices of a pipeline whose consumer is a
training job, not a human. Features that maximise long-horizon, tool-heavy,
self-directed behaviour are the same features that maximise trajectory yield, and
the roadmap gets much more predictable once you read it that way.

The "trajectory compression" half of that sentence is the one claim here I could
not stand up: the phrase appears nowhere in the documentation corpus. Three
documented things are near it — per-session context compression, a `tail_mode:
lean` digest mode with published evals, and the ShareGPT export normalisation —
but none is called that. Treat it as a README phrase, not a feature.

One more datapoint on positioning: Hermes ships `hermes claw migrate`, which
imports `~/.openclaw` — persona file, memories, user-created skills, command
allowlist, messaging settings, allowlisted API keys. These two projects are
direct competitors for the same user, and Hermes says so in a CLI verb.

---

## DeepSeek Harness (`dsh`), in detail

[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) ·
TypeScript · created 2026-08-13 · 172,413 stars, 18,610 forks · MIT ·
default branch `master` · docs at
[deepseek-harness.github.io/deepseek-harness](https://deepseek-harness.github.io/deepseek-harness/)

Run it with `npx @deepseek-ai/dsh web`, which starts a Web UI on
`http://127.0.0.1:3080`. The README labels it a **developer preview** and warns in
capitals that there will be compatibility-breaking changes.

**Check the org and the registry before you install.** The official repository is
under `deepseek-ai`, and the official package is npm `@deepseek-ai/dsh`. Within
days of launch a large ecosystem of independently-owned repositories appeared with
near-identical names — `deepseek-harness-desktop`, `deepseek-harness-studio`,
`Deepseek-Harness-EAC` and others, several bundling their own Node runtime. Some
are useful; none are official.

Two specific traps. There is a separate `deepseek-harness` GitHub org which *is*
project-affiliated — it hosts the docs site and the vendored forks — so "not
`deepseek-ai`" is not by itself a red flag. And there is an unrelated Python
project of the same name on PyPI, published three months *before* the official
launch by an individual author who says so plainly in his own README; at least one
widely-circulated write-up tells readers to `pip install deepseek-harness`, which
installs his package instead. There is no official PyPI package by that name.

### Cordis, and what "everything is a plugin" buys

`dsh` is built on [Cordis](https://github.com/cordiverse/cordis), a plugin
framework where "plugins contribute services, typed events, and reversible
effects to a shared context". The architecture doc states the consequence
directly: "There is no privileged core to patch: you extend dsh by mounting a
plugin beside the others, and registrations are effects that unwind when their
plugin unloads."

Two things about that dependency are worth stating precisely, because most
write-ups get them wrong. Cordis is not a DeepSeek invention — it has existed
since 2022 and `dsh` adopted it. And `dsh` does not depend on it from npm: nine
Cordis packages are **source-vendored** into the monorepo, renamed into the
`@deepseek-ai` scope, and modified, with an exhaustive local-change log recording
substantive divergence such as lifecycle hardening that "closes three reentrant
disposal gaps". The accurate phrasing is "a hardened fork of Cordis v4", not
"Cordis". The stated reason is worth respecting on its own terms: the harness
wanted to own its framework layer, auditable and pinned.

Composition is layered. A **profile** is a named composition stored in the Harness
home; a **bundle** is a distribution format for Cordis config rows plus the code
they mount. `dsh-base` is the first layer of every profile (model adapters, tools,
persistence, sandbox and approval policy, settings, credentials, telemetry);
`dsh-web-app` adds the browser application; `dsh-headless` adds "a one-shot runner
with no server at all". Layers apply in order — bundles, then the profile's
`cordis.patch.yml`, then the home-level one, then any `--patch` overlay — and
`dsh --profile web --dump-config` prints the tree your machine actually boots.

Web UI versus headless is therefore not a mode flag. It is which bundle you
mounted.

### The event-sourced session log

The claim that matters most, and the one Interlock has already decided to steal a
narrow version of.

A `Session` is an append-only log of typed `SessionEvent`s and it is the single
source of truth. Crucially, **the LLM message history is derived from the log
rather than stored beside it** — `deriveMessages()` projects model history from
the events. Each entry carries a monotonic `seq`, a `time`, and a
`type`-discriminated `data` payload.

The base set is thirteen variants: `turn/start`, `turn/end`, `step/start`,
`step/end`, `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`,
`tool/result`, `todo/write`, `request/header`, `request/context`, and
`session/end-seed`. Plugins add their own by declaration merging, and roughly
eighteen in-tree packages do — `plan/mode`, `approval/asked`, `permission/preset`,
`llm/retry` and so on. Durability is a separate seam: `SessionPersistence` with
JSONL and SQLite backends, crash recovery that closes dangling calls with synthetic
`TOOL_OUTCOME_UNKNOWN` results, and an immutable `SessionHeader`.

Read that list from the source rather than the documentation site, which still
publishes twelve variants including a `steering/message` that no longer exists.
The correction is small but the lesson is not: this is a `0.1.0-rc.8` whose README
promises compatibility-breaking changes, and its own docs have already drifted from
its own source.

The design property to take away is not "they use JSONL". It is **model-visible
implies logged**: if the model saw it, it is an event, and a runtime invariant
enforces it. What makes that affordable is the second half, which is easy to miss —
**logged does not imply model-visible**. Only three types are surface-eligible
(`user/message`, `assistant/message`, `tool/result`); the rest, including every
plugin-contributed type and the token-level `assistant/chunk` deltas kept for replay
fidelity, are explicitly log-only and never enter derived history. Event sourcing
buys durable audit volume on disk while keeping the model-visible projection narrow.
That asymmetry is the whole trick, and it is the same one Interlock's tool economy
runs on.

### The turn loop, verbatim

The architecture doc prints the loop, and it is worth reproducing because it
shows where the extension points are:

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

A **step** is one model request plus the tools it calls. A **turn** is zero or more
steps: it opens before its first input is claimed and closes once nothing is owed.
`agent/pre-step`, `agent/request`, `llm/stream` and the three `tools/*` events are
**waterfalls** whose listeners must call `next()` to delegate; `agent/turn-stopping`
is **serial** and has no `next()`.

`agent/pre-step` is the one to notice. It returns a
`PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[] }`,
which means a plugin can veto a step or rewrite exactly what the model is about to
see — and a rejected first claim still closes a durable turn that spent no step, so
the log records the attempt. Refusal is a logged fact, not an absence. That is the
same instinct as Interlock's "degradation is always spoken".

### The `agent` / `agent-loop` split

Six packages make up `packages/core`: `session/` (`ctx.sessions`), `system-prompt/`
(`ctx.systemPrompt`), `tools/` (`ctx.tools`), `agent/` (`ctx.agents`), `agent-loop/`
(`ctx.agentLoop`), and `scope/`, a dependency-free library (`createScope`,
`scopeOf`, `scopeTarget`) that sits below the others in the module graph
specifically so they can use it without a cycle.

The split between the last two is the design decision the project is proudest of.
`agent/` declares the public `Agent` interface and the live registry; `agent-loop/`
is "the one concrete implementation of the public `Agent` contract". The rule that
makes it work is stated as a dependency constraint:

> Extension plugins depend on `agent` — including when they need the initiating
> Agent — and never on `agent-loop` directly, so the loop stays swappable.
> — [subsystems/core.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)

The loop registers its factory through `ctx.agents.setFactory()`, so consumers call
`ctx.agents.create()` / `resume()` without ever naming the concrete loop package.
Creation returns an `AgentHandle { agent, dispose() }` in which the disposer is
described as a capability: among consumers, only the holder can tear that agent
down.

The public `Agent` handle is compact and unusually well specified. Beyond `id`,
`options`, `session`, `inbox`, `status` and `ctx`, it exposes `cancel(cause)`,
`whenIdle()`, `runMaintenance(task)`, and a unified `send(message, target, wakeup)`
with `followup` / `steer` / `inject` as fixed-preset aliases. Every one of those
vocabularies is a closed union: status is exactly `'idle' | 'running'` and
disposal is explicitly not a third value, delivery targets are exactly
`'next-turn' | 'next-step'`, and cancellation causes are `user`, `parent`, `hook`
or `disposed`. The durable `turn/end` deliberately keeps only the coarse
`{ kind: 'aborted' }` outcome, because "recording who requested cancellation would
require a separate durable event rather than overloading the terminal result."

`ctx.agents` also carries the **initiating Agent** through one process-local
asynchronous chain — `currentInitiator()`, `requireInitiator()`, `withInitiator()`,
`withoutInitiator()` — under a guardrail stated as clearly as any security note in
this landscape: "Ambient presence is neither liveness proof nor authorization."
Extensibility itself rests on two repo-wide type patterns: the **`…Map` →
derived-union pattern**, where a plugin adds a variant to a sum type by TypeScript
declaration merging rather than by editing the owning package, and **branded IDs**
(`type Branded<B> = string & { readonly [BRAND]: B }`) that stop a `SessionId`
being passed where a `CallId` belongs.

### The seams worth knowing about

The [subsystems index](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md)
lists around forty documented seams. The ones a reader of this repo will care about:

| Seam | What it owns |
|---|---|
| `tools.md` | `ToolDefinition` (a model-facing `ToolSchema` plus `execute`), the `defineTool` schema DSL, and the guarded execution pipeline |
| `sandbox.md` | Per-session policy resolution and process confinement: file-effect modes, execution and provider policies, `ConfinedArgv`, enforcement and **fail-closed errors** |
| `approval.md` | The one-shot user-approval seam: `ApprovalRequest`, `ApprovalOutcome`, per-session policy, audit events |
| `spill.md` | Spill storage: `SaveTextSpill`, `SpillOwner` / `SpillSource`, `SpillRef`, the branded `SpillLocator` |
| `compaction.md` | The `compaction/*` session events, `CompactionResult`, the `CompactionEngine` interface |
| `subagent.md` | The named-provider registry, `SubagentStartRequest` / `Result` / `Run`, and a start-time-vs-runtime capability split |
| `terminal.md` | Persistent terminal ids, backend/session contracts, bounded reads |
| `session-query.md` | Bounded exact-event reads, relationship traces, semantic filters, full-text result pages |

**Spill is the one to look at first if you care about tokens.** Oversized output is
written to storage and the model receives a `SpillLocator` — a reference — instead
of the payload. That is Rule 1 of [`shared/TOOL-ECONOMY.md`](../shared/TOOL-ECONOMY.md)
("locate before you read") enforced by the harness rather than requested of the
agent.

---

## Does this change anything for Interlock?

The stated position is that Interlock ships features at efficient token cost and
these three projects do not obviously add anything. That position is mostly right,
and it is right for a structural reason rather than by luck: **none of these three
does process.** None has a spec artifact, a human checkpoint, a wave planner, a
cap that a model cannot argue with, or a review whose dismissals require a cited
span. Nothing in this landscape competes with the thing Interlock is.

But "mostly right" is not "entirely right", and three of the specific mechanisms
are worth taking. Encouragingly, the repository has already scoped exactly those
three, before this page was written — `openspec/changes/add-ship-run-inspectability`,
`add-wave-handoff-and-prompt-snapshots`, and `add-interlock-acp-host` all cite
`dsh` as prior art. What follows ranks them and adds the ones that should be
refused.

### Worth taking, ranked by benefit over effort

**1. Spill oversized tool output. Low effort, immediate benefit.**
`dsh`'s `SpillRef` / `SpillLocator` seam gives the model a locator and a preview
instead of a full test-suite log. Interlock's verify agents currently swallow whole
suite logs into context, which is the exact waste `TOOL-ECONOMY.md` Rule 1 forbids
everywhere else. This is a CLI side effect on commands agents already run, so the
workflow script does not need to touch the filesystem. Already scoped in
`add-ship-run-inspectability`. Do it first; it is the cheapest real token win
available.

**2. An append-only run trajectory. Medium effort, high benefit.**
Take the `dsh` principle — model-visible implies logged, history derived from the
log — and apply it to the ship run rather than to a conversation. Today
`workflows/ship.js` overwrites `.claude/ship/state.json` on every mutation and
`lib/outcomes.mjs` appends one summary line per attempt; neither is a transcript,
so a halted run cannot be reconstructed. A JSONL trajectory of every wave-state
action, CLI exit, agent spawn and verify judgement makes a halt readable and gives
[`session-retro`](https://github.com/renzrollon/shippable-skills) something to
score other than the live transcript.

Take the principle and leave the type system. `dsh`'s thirteen `SessionEvent`
variants exist to derive an LLM message history; Interlock's log has one consumer,
a human reading a halt. Porting `deriveMessages()`-shaped machinery would be
cargo cult.

The half of the principle to copy deliberately is the log-only tier. In `dsh` most
event types never reach the model at all, which is what makes it safe to log
generously. An Interlock trajectory should be written the same way — verbose on
disk for the human, invisible to every agent unless something explicitly reads it
back — otherwise a feature justified by inspectability quietly becomes a context
cost.

One further `dsh` detail is worth stealing wholesale if Interlock ever compacts
anything: its compaction pass replays the conversation's own system prompt and
tools verbatim and appends the compaction instruction as the final message,
specifically so the summarisation call reuses the provider's warm prefix cache
rather than invalidating it. It also tries a model-free pruning pass first and
skips summarising entirely if that relieves the pressure. Cheapest fix first,
and never pay twice for the same prefix.

**3. A second host, via ACP. High effort, and the highest strategic benefit.**
This is the recommendation that follows from the layering section rather than from
any single feature. Interlock is a process layer renting a harness, the harness
layer just became crowded, and `dsh` demonstrates that a coding agent can be
hosted over ACP without adopting the host's architecture. The right shape is the
one already designed in `add-interlock-acp-host`: a small port object —
`spawn`, `mapPipeline`, `runCli` — with `bin/interlock` unchanged as the policy
engine, Claude Code remaining the default host, and lean ship as the MVP. The
guarantees do not move, because they were never in the host.

Note how much OpenClaw's harness SDK independently validates that boundary. Its
core keeps provider, model, auth, budget, transcript, sandbox and tool policy, and
hands the harness one prepared attempt. Interlock's split is the same split with
different nouns: the CLI keeps the rules, the host gets a labelled spawn.

**4. Frozen prompt snapshots and validated wave handoffs. Medium effort, medium benefit.**
The tier-ladder prompt is currently an untested string inside `workflows/ship.js` —
the same silent-drift risk caps had before `lib/limits.mjs`. Snapshotting the
assembled prompt against fixtures, and requiring each implementer to return a
bounded schema-validated packet rather than leaving the next wave to infer
history from git, are both straightforward. Scoped in
`add-wave-handoff-and-prompt-snapshots`. The `dsh` influence here is only the
discipline; do not import `pnpm run test:snapshot` or an ACP replay harness for it.

**5. Full-text search over the trajectory corpus. Low effort, low-to-medium benefit — later.**
Hermes' FTS5 recall is the right *shape* for `interlock run-log` once trajectories
exist. It is a search index over durable records, which is a completely different
thing from agent-curated memory, and the difference is exactly why this one is
acceptable and the next section's is not.

### Worth refusing, and why

**Agent-curated memory and self-improving skills.** A memory store the model writes
and later trusts is an unaudited claim, and this repository has already decided
twice that unaudited claims do not count: a decision-ledger row marked
`agent_resolved` is invalid without evidence a human can follow, and a review
dismissal without a cited `file:line` span dismisses nothing. Persisting "what the
agent learned" with no citation and no test is the same failure with a friendlier
name. `session-retro`'s wire-in, a proposal a human applies, is the version of
this idea that survives Interlock's own rules. See
[shippable-skills](https://github.com/renzrollon/shippable-skills).

To be fair to Hermes: it is not careless about this. `memory.write_approval` and
`skills.write_approval` stage every write for human review, the curator snapshots
before it acts and can roll back a single mutation from an append-only ledger, and
autonomous maintenance is scoped to skills the background pass authored. Those are
good answers to *"can I undo it?"*. They are not answers to *"was it true?"* — a
reviewed diff of a sentence the agent inferred about your codebase is still a
sentence with no citation behind it. That second question is the one Interlock is
built around, which is why the gap survives even the careful version.

**A channel layer.** Reaching a running `ship` from Telegram sounds appealing until
you remember why `ship` is a workflow: the runtime accepts no mid-run user input,
and that is the zero-touch contract rather than an omission. A channel into a run
that cannot answer you is a notification, and a notification is a webhook on halt,
not a gateway process with seven messaging integrations. Build the webhook if you
want it; do not build the gateway.

**Cordis, or plugin-everything of any flavour.** Extensibility is a cost, and for a
policy engine it is the wrong cost. Interlock's leverage is precisely that
`LIMITS.remediationRounds` is not pluggable — a cap you can mount a plugin over is
not a cap. `dsh` is right for `dsh`, whose product *is* the substrate. The
repository's own design notes already record this as a non-goal in all three
in-flight changes, which is the correct call.

**In-loop interception.** `agent/pre-step` is elegant, and Interlock should not
want it. Interlock's gates run *between* waves, in a script, because a gate the
model can reach is a gate the model can talk past. Moving checks inside the turn
loop would trade an unarguable boundary for a flexible one.

### The part that is genuinely a problem

Two things, stated plainly.

**Per-task isolation is a real gap and it is blocked on the host.** Hermes runs its
shell on seven backends including hibernating cloud sandboxes; `dsh` has a
documented sandbox seam with per-session policy and fail-closed confinement.
Interlock runs parallel implementers in one working tree and detects collisions
from a model's *prediction* of which files each task will touch. Predicted-path
collision detection narrows that race honestly and does not close it. Per-task
worktrees or containers would close it, and Interlock cannot do that today because
the workflow runtime owns the spawn. This is the strongest argument for the host
port, stronger than portability-as-marketing.

**`dsh` is a slow-moving strategic problem, and not for the reason it looks like.**
It will not out-spec Interlock; it has no opinion about specs at all. The risk is
that the harness floor becomes contested and standardised — ACP is already the
lingua franca between Claude Code, Gemini CLI, OpenCode, Cursor and Codex, per
OpenClaw's own routing docs — while Interlock remains structurally unable to run
anywhere but Claude Code. Every guarantee in this repository comes from
`bin/interlock`, which is portable, except the one that comes from the workflow
runtime, which is not. That is a narrow dependency and it is worth paying to widen
it while there is no urgency.

Neither of these is a reason to change what Interlock is. Both are reasons to
finish the host port.

---

## Hype decoder

One line each, separating what is technically real from what is distribution.

**OpenClaw — real merit:** the provider / model / runtime / channel separation is
more carefully specified than almost anything else in this category, and the
Gateway genuinely solves "my assistant should exist when my laptop is closed".
**Distribution:** a well-known maintainer with a large pre-existing audience, a
non-profit foundation behind it, sponsor logos from OpenAI, GitHub, NVIDIA and
Vercel, and a mascot people enjoy repeating. Three renames in ten weeks, one of
them triggered by an Anthropic trademark approach, is three launches and a news
cycle. The star count also measures a far larger audience than developer tooling
does, because "personal AI assistant" is a consumer phrase and "spec-driven
development harness" is not.

**Hermes Agent — real merit:** the `execute_code` RPC design is a genuine
architectural answer to context bloat rather than a prompt trick, and the consent
machinery around self-modification is unusually careful — staged writes behind
`write_approval`, tarball snapshots before curator runs, a content-addressed
append-only audit ledger with per-mutation rollback, and a policy that autonomous
maintenance only touches skills the *background* pass created, never yours.
**Distribution:** the Nous Research name, "self-improving agent" being close to the
most clickable phrase in the field, and a shipped `hermes claw migrate` aimed
squarely at OpenClaw's installed base. The most-cited statistic — Hermes at roughly
four times Claude Code's cumulative OpenRouter tokens — measures token volume on
one routing platform, and an always-on agent accrues tokens with no human present
while a session-based tool does not. Two further things a reader should weigh
before adopting: HN engagement is far below what the star count implies, and there
is an unresolved public dispute alleging the project is derivative of another
without attribution, together with documented deletion of issue comments about it.
I did not evaluate that claim and this page takes no position on it.

**DeepSeek Harness — real merit:** the cleanest architecture of the three, and
documentation quality that is genuinely unusual — around forty subsystem pages,
generated API catalogs verified in CI, and published postmortems. The
`agent`/`agent-loop` dependency rule is a small idea executed exactly right.
**Distribution:** DeepSeek's name on the repository, and a launch that shipped
alongside a model release with a marketing site, a docs site, a paper and a
plugin topic all on the same day. 172,000 stars within a week of a v0.1 developer
preview is not a week of technical evaluation. The clearest tell is the ratio: 730
watchers against those stars, which is drive-by starring rather than adoption. The
9,226 repositories carrying the `dsh-plugin` topic are worse as a signal — sorted
by stars, the top of that list includes a resume builder from 2020 and several
image-prompt libraries with no relationship to the project. Do not quote it as a
plugin count. The architecture deserves the attention; neither number measures it.

The general rule this landscape illustrates: in agent tooling right now, star
count measures *who published it* and *how quotable the tagline is* far more
reliably than it measures whether the thing works. All three of these happen to be
worth reading anyway, which is why they are here — but the reading is the
evidence, not the count.

---

## Sources

Primary sources actually read for this page.

**OpenClaw**
- [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) — README
- [Agent runtimes](https://docs.openclaw.ai/concepts/agent-runtimes) — the layer table, runtime families, selection order, Codex surfaces
- [Agent harness plugins](https://docs.openclaw.ai/plugins/sdk-agent-harness) — `AgentHarnessV2`, `supports`/`runAttempt`, selection policy, transcript mirror, `hostCapabilities`
- [Gateway](https://docs.openclaw.ai/gateway) · [Channels](https://docs.openclaw.ai/channels) · [Plugins](https://docs.openclaw.ai/plugins) · [Lore](https://docs.openclaw.ai/start/lore) — the rename chain

**Hermes Agent**
- [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — README
- [Documentation](https://hermes-agent.nousresearch.com/docs/) — [memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory), [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), [curator](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator), [sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions), [code execution](https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution), [delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), [batch processing](https://hermes-agent.nousresearch.com/docs/user-guide/features/batch-processing), [tools and terminal backends](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools), [messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)
- [`llms-full.txt`](https://hermes-agent.nousresearch.com/llms-full.txt) — the full 3.9 MB documentation corpus, searched to establish the negative finding on "trajectory compression"
- [Honcho](https://github.com/plastic-labs/honcho) · [agentskills.io](https://agentskills.io)

**DeepSeek Harness**
- [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — README
- [architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — Cordis, profiles and bundles, the turn flow, the session log
- [subsystems/core.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md) — the `agent`/`agent-loop` split, `Agent`, `AgentHandle`, `PreStepDecision`, scopes and the initiator, branded ids
- [subsystems/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/README.md) — the seam index
- [Cordis](https://github.com/cordiverse/cordis)

**Repository metadata** — stars, forks, watchers, licences, creation dates and the
`dsh-plugin` topic count were read from the GitHub REST API on 2026-08-20, and npm
publish dates from the registry API the same day. The `dsh` sections above were
checked against a local clone at tag `dsh-v0.1.0-rc.8` rather than against the
rendered documentation, which is why they diverge from it in two places: the
session-event list, and the preset-selection event, which the source declares as
`permission/preset` and the package README calls `permissionPresets/preset`.

Two notes on things that look like discrepancies and are not. GitHub's licence
detector reports `NOASSERTION` for OpenClaw even though the `LICENSE` file is
verbatim MIT; the likely cause is a trailing third-party-notices sentence that
defeats the matcher, so cite MIT. And three feature phrases in the Hermes README —
"with LLM summarization", "zero-context-cost", and "trajectory compression" — are
each contradicted or unsupported by that project's own documentation; the sections
above use the documentation's wording and say so where they diverge.

---

## Next

- [**03 — OpenSpec vs Interlock**](./03-openspec-vs-interlock.md) — the other "who owns what" page, one layer down
- [**06 — Why it works**](./06-why-it-works.md) — why the loop lives in a script, and what that costs in portability
