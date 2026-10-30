# The Interlock harness

Interlock does not own a model loop. One conversation with a model — the prompt, the tool calls, the transcript, compaction — belongs to a **host**: Claude Code's Workflow runtime by default, or a vendor coding CLI under the experimental runner. What Interlock owns is the harness around that loop: the program that says which agent runs next, the rules that decide whether a run continues, the guards that bind an agent while it holds a tool, and the records that let you read a run back.

This page is the map. Each part gets a line and a link to the page that has the detail. A short table at the end places Interlock beside the other projects that get called harnesses.

Most of it is about `ship`. `/interlock:spec` is a skill in your own session, because it has to ask you questions; the harness is what takes over once nothing may be asked.

---

## What is borrowed, and what is owned

| Layer | What it is | Whose |
|---|---|---|
| Model | The weights | The host's |
| Agent loop | One conversation: prompt assembly, tool dispatch, transcript, compaction | The host's |
| Tool surface | What an agent may touch | The host's tools, narrowed by Interlock's two agent types and its `PreToolUse` guards |
| Run program | Which agents run, in what order, with which briefing | Interlock — `lib/run.mjs` |
| Policy | Caps, gates and verdicts | Interlock — `cli/interlock` |
| Records | What a run leaves on disk | Interlock — trajectory, spill, receipt, corpora |
| Process | Spec, checkpoint, ship | Interlock, over [OpenSpec's](./03-openspec-vs-interlock.md) artifacts |

The line between the two halves is deliberate. A decision with a correct answer is code that a test can call with no model and no network. Judgement — how to classify a task, how to implement it, what a review finding means — stays with the model. [06 — Why it works](./06-why-it-works.md#2-where-the-plan-lives-and-why-that-decides-everything) argues for the split; this page only shows where each side lives.

---

## The parts

| Part | Lives in | Job | Detail |
|---|---|---|---|
| **Run program** | `lib/run.mjs`, called as `interlock run …` | Emits the ship loop one versioned step at a time: the agents to spawn (label, model, effort, tools, result schema, briefing) and the exact argv to call when they return | [06 §5.4](./06-why-it-works.md#54-the-loop-is-a-state-machine) |
| **Policy engine** | `cli/interlock`, `lib/` | Every decision with a correct answer: wave order, the caps, the verify verdict, the review gate, readiness. A gating command exits non-zero when it blocks | [07](./07-cli-and-configuration.md#interlock--the-deterministic-spine), [04](./04-when-it-stops.md#what-is-enforced-and-what-is-followed) |
| **Briefings** | `lib/prompts/` | Assembles every prompt a step carries. Each one is written to `.claude/ship/briefings/` with its own hash on the first line, and the implementer prompts are pinned by the fixtures in `test/fixtures/prompts/` | [06 §5.4](./06-why-it-works.md#54-the-loop-is-a-state-machine) |
| **Drivers** | `workflows/ship.js`, `cli/interlock-run` | Interpreters. Spawn what a step names, create the worktree it names, call the argv it names. They hold no loop logic and branch on nothing | [07](./07-cli-and-configuration.md#where-the-loop-itself-lives) |
| **Host adapters** | `lib/host/` | One file per vendor CLI: a transport, plus a declaration of what that host cannot do | [07](./07-cli-and-configuration.md#interlock-run--the-experimental-runner) |
| **Agent types** | `agents/ping.md`, `agents/worker.md` | The tool allowlist every spawn runs under. Neither may use `Skill`, `Agent` or an MCP tool, which also keeps the host's catalog out of each spawn's prefix | [06 §5.1](./06-why-it-works.md#51-isolation-is-the-point) |
| **Guards** | `hooks/guard-*.mjs`, and the launch guard's branch of `hooks/mod.mjs` | Hooks the host runs outside the agent. During a run they deny a test edit in a repair stage, a hand-ticked task box, a commit outside the commit stage, and a second ship launch nobody asked for. Inert outside a run, and they fail open | [13](./13-the-guards.md) |
| **Recorder and meters** | `hooks/recorder.mjs`, `hooks/mod.mjs` | Observe and decide nothing: what each agent spent, each permission event, a session that ended mid-run, and the live pane that draws a run | [13](./13-the-guards.md#the-ship-meter) |
| **Records** | `.claude/ship/`, and the [state home](./07-cli-and-configuration.md#where-a-runs-records-go-the-state-home) | The run trajectory, spilled output, the receipt and the outcome corpus | [06 §5.5](./06-why-it-works.md#55-inspectability-a-run-leaves-a-transcript), [11](./11-the-indicators.md) |
| **Graph** | `cli/interlock-graph` | Deterministic code retrieval inside a token budget, so an agent locates before it reads | [07](./07-cli-and-configuration.md#interlock-graph--the-local-code-knowledge-graph) |

---

## One step, end to end

```
interlock run start --change <name>      the CLI emits the first step
        │
        ▼
step { spawns: [...], then: { argv } }
        │
        ├─ the driver spawns every agent       the host runs each agent's loop;
        │  the step names                      the guards fire on its tool calls
        │
        ├─ the driver writes the results
        │  to disk
        │
        └─ the driver calls then.argv          the CLI judges the results, records them,
                                               ticks the tasks and emits the next step
        ▼
... and again, until a step names nothing to call next
```

On the way out, `interlock run close` writes the receipt, appends the outcome record and clears the stage marker. A halt closes the same way a commit does.

The two drivers differ in one place. `cli/interlock-run` is ordinary Node and runs the argv itself. A Workflow script has no shell, so `workflows/ship.js` hands the argv to a small relay agent that runs it and copies the step back. A relay that returns an action the program does not emit is retried once, and then the run halts; it is never obeyed.

Because neither driver branches, the loop exists once. `test/spine/host.test.mjs` drives a batch through a host that cannot reach a model at all, and the halt still comes out of the CLI's exit code.

---

## The hosts

| Host | Started by | Reaches a model through | Status |
|---|---|---|---|
| Workflow runtime | `/interlock:ship` | Claude Code's `agent()` and `pipeline()` | Default, supported |
| `claude` | `interlock-run --host claude` | `claude -p` | Experimental |
| `acp` | `interlock-run --host acp` | Any [Agent Client Protocol](https://agentclientprotocol.com) agent | Experimental |
| `codex` | `interlock-run --host codex` | `codex exec` | Experimental |
| `qwen` | `interlock-run --host qwen` | `qwen -p` | Experimental |

An adapter implements three functions: spawn one labelled agent, spawn a batch, and run `interlock` and hand back its exit code. It also declares what its host cannot do — schema enforcement, model selection, effort, who creates a lane's worktree, whether the plugin's hooks fire, token usage, cache accounting, and which account the run bills. The run program reads the declaration, never the host's name, and the runner prints a banner for each weakness. A host that could not be bannered would be a run that degraded silently. The full capability table is in [07](./07-cli-and-configuration.md#interlock-run--the-experimental-runner), and every banner in [04](./04-when-it-stops.md#runner-host-id-experimental-and-the-rest-of-the-runners-banners).

You start the runner yourself. `/interlock:ship` never falls back to it, and the reason is billing: `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit, and the interactive Workflow runtime is the path that change exempted. A run over the Claude binary prints `SUBSCRIPTION PATH: programmatic`.

---

## What holds on every host, and what does not

| Guarantee | Comes from | Holds on |
|---|---|---|
| Wave order, the caps, the verify verdict, the review gate | The CLI's exit codes | Every host |
| A run can be read back | The trajectory; a failed append exits 1 | Every host |
| Nobody can be asked a question mid-run | The Workflow runtime has no channel for one | The Workflow host. On the runner it is a policy in a file, not a property of a runtime |
| An agent cannot weaken a test, tick a task box or commit early | The `PreToolUse` guards | Hosts that load the plugin's hooks: the Workflow host, `claude`, and `acp` over the Claude binary. `codex` and `qwen` print `HOOKS NOT IN FORCE` |
| Parallel lanes cannot overwrite each other, under `--isolate-waves` | One git worktree per lane, folded back by `interlock run record-batch`, which halts naming the file and both lanes on a collision | The runner hosts. The Workflow host warns `ISOLATION BASE NOT CONTROLLED (workflow)` and [halts after the first fold](./04-when-it-stops.md#lane-base-mismatch), until lane worktrees are created from the CLI |
| Per-agent token figures | The host's own report, or the recorder hook | `claude` and `codex` report them, and the recorder reads them on the Workflow host. `acp` and `qwen` report none, and the run records `unknown`, never zero |

Without `--isolate-waves`, parallel lanes share one working tree and the planner keeps apart the tasks whose predicted paths collide. That narrows the race; the prediction is a model's.

Every row that is weaker than the default is printed in the run summary. [Degradation is always spoken](./06-why-it-works.md#13-degradation-is-always-spoken).

---

## Not in the harness, on purpose

- **A memory the agent writes and later trusts.** What survives a session is durable and cited: explore briefs, the decision ledger, OpenSpec specs, the trajectory. A ledger row an agent resolved needs evidence a person can follow, and a review dismissal needs a `file:line` span. [`session-retro`](https://github.com/renzrollon/shippable-skills) proposes a change to a skill and a person applies it.
- **A channel into a running ship.** The run takes no input, so a message sent to it could not be answered. The need behind the idea is a notification, and that exists: with a topic set, `run close --notify` [pushes one message](./07-cli-and-configuration.md#the-one-network-call-push-notifications) per terminal outcome.
- **Pluggable policy.** Transports are pluggable; rules are not. A cap you can mount a plugin over is not a cap. `interlock limits` prints every one of them.
- **An agent loop of its own.** Owning the transcript, compaction and tool dispatch would rebuild what the hosts already do, and none of the guarantees above need it.

---

## Beside the others

Several projects are called harnesses, and they sit on different layers. This is how they read in August 2026; all three of the first rows move fast.

| Project | What it is | Layer it owns | Against Interlock |
|---|---|---|---|
| [OpenClaw](https://github.com/openclaw/openclaw) | A personal assistant that runs as a daemon and is reached from chat apps | Agent loop, plus a channel layer | Changes where you type and what stays running. It has no spec, checkpoint or gate |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | A single-user agent that keeps its own memory and writes its own skills | Agent loop, channels and memory | The opposite bet. The agent revises its own instructions; Interlock moves an instruction with a correct answer into tested code |
| [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) | An agent loop in which every part is a replaceable plugin | Agent loop only | The same kind of thing as Claude Code, not as Interlock: moving onto it would be a port, not an upgrade. Its append-only session log and spilled tool output are the prior art for Interlock's trajectory and spill |
| Spec Kit, BMAD, Kiro | Spec-driven process layers | Process, as prompt templates or an IDE | The same layer. They compete on how much structure you write before coding; Interlock on how many decisions the model may not make. Spec Kit runs on thirty agents, and Interlock does not ([README](../README.md#how-it-compares)) |
| **Interlock** | Spec-driven process, with a harness around a borrowed loop | Run program, policy, guards, records | — |

None of the first three does spec-driven process, so none competes with what Interlock is. What they show is that the loop layer is crowded, which is why the host-specific part of Interlock is kept to an adapter.

---

## What this costs

- **Interlock is a tenant.** The default host's behaviour above the plugin contract — agent caps, warning thresholds, resume semantics — moves across patch versions and cannot be pinned.
- **The strongest guarantee is the least portable.** Zero-touch is structural only on the Workflow runtime. Everywhere else the driver declines to ask.
- **The second host has a price.** A runner run over the Claude binary spends metered programmatic credit, and a host with no hooks runs without the guards.
- **The surface is not small.** Four commands are the product; the machinery on this page sits underneath them.

The longer version, including what has not been measured, is [06 §14](./06-why-it-works.md#14-what-this-costs-honestly).

---

## Next

- [**06 — Why it works**](./06-why-it-works.md) — why the loop is a program and not a prompt, mechanism by mechanism
- [**07 — CLI and configuration**](./07-cli-and-configuration.md) — every subcommand, the host table and every environment variable
- [**13 — The guards**](./13-the-guards.md) — the hooks, the stage marker and the fail-open rule
- [**04 — When it stops**](./04-when-it-stops.md) — every halt and banner the harness prints
