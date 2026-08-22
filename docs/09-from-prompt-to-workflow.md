# From prompt to workflow

## Who this is for

You type instructions into a chat box and get code back. That is your whole model of working with an LLM, and it works. This page assumes exactly that and nothing more.

It is not the install guide — that is [the first hour](./01-first-hour.md). It is not the mechanism doc — that is [why it works](./06-why-it-works.md), and this page exists to make that one readable.

The promise: by the end you will know why `/interlock:ship` is a JavaScript file instead of a prompt, and why that is the entire point rather than an implementation detail.

---

## 1. What you already know, named

Take a prompt you have typed a hundred times: *add a `--json` flag to the report command.*

Here is what actually happened. A program read your text, pulled some files in alongside it, and sent the whole bundle to the model. The model replied with an edit. The program applied the edit, ran your tests, and sent the output back to the model. Then it did that again until something looked done.

Three parts of that are worth names, because you have been using all three without needing to.

- **Harness** — the program doing the reading, sending and applying. Claude Code is a harness. The model never touched your filesystem; the harness did, on its behalf.
- **Context window** — the fixed amount of text the model can see at once. Everything the harness sends competes for the same room.
- **Tool-use loop** — the *again* in that paragraph. The model does not run your tests. It asks the harness to, and reads what comes back.

A prompt, then, is a work order handed to a contractor who has no memory between jobs and can carry exactly one clipboard's worth of paper onto the site. That is not an insult to the contractor. It is a description of the clipboard.

---

## 2. Where prompting stops working

Prompting fails at three specific scales. Every strange-looking decision in Interlock is a response to one of them, so it is worth being precise about what breaks.

**The clipboard runs out.** A forty-file change, plus the plan for it, plus the test output it produces, does not fit in one context window. And it degrades before it overflows: paste a 2,000-line file and you have spent the room the model needed in order to think. The model does not warn you when it starts skimming.

**The plan gets forgotten while it is being carried out.** Forty minutes into a change, the plan you agreed on is thirty turns back in the conversation, competing for attention with stack traces and diffs. An agent that was tracking three constraints is now tracking one, and it will not tell you which two it dropped — it does not know either.

**A rule written in a prompt is a suggestion.** This is the one that matters most, and the one that is least obvious.

Write `cap remediation at two rounds` into a prompt. Now imagine the situation where that cap has to hold: the model has spent forty minutes on this change, two rounds have not fixed it, and it is close. Ask it whether it has earned a third round. It will say yes. It will be articulate about why. And it will be right in the specific way that an interested party is right — it is not lying to you, it is reasoning from inside the situation the cap exists to constrain.

The real cap is `remediationRounds: 2` in [`lib/limits.mjs`](../lib/limits.mjs), read by a script that has no opinion and cannot be persuaded.

A speed limit painted on the road and a governor fitted in the engine are both "the rule". Only one of them still holds when the driver is late.

---

## 3. The three words you need

There are only three new nouns in this system. Each answers exactly one failure from §2, so take them in order.

**A skill** is a markdown file of instructions that the model reads and follows. `/interlock:spec` is a skill — you can open [`skills/spec/SKILL.md`](../skills/spec/SKILL.md) right now and read the exact instructions it was handed. Nothing is hidden.

The property that matters is in the word *follows*. Instructions the model follows are instructions it can also decide not to follow, for reasons that will sound good at the time. A skill on its own solves none of the three failures. It is the baseline the other two improve on.

**A subagent** is a second, fresh copy of the model with its own empty context window, handed one task, returning a short summary. It answers the first failure. `ship` runs one subagent per checkbox in `tasks.md`, so the agent implementing the auth change never sees the migration task's test output — not because it was told to ignore it, but because it was never in the room. Instead of walking every room yourself with one clipboard, you hire one contractor per room.

**A workflow** is a JavaScript file that a runtime *executes*, and which calls the model from inside itself. This is the inversion worth slowing down for. In a skill, the program is a suggestion made to the model. In a workflow, the model is a step inside the program. [`workflows/ship.js`](../workflows/ship.js) is that file. Handing a cook a recipe is one thing; putting the cook inside a machine that will not open the oven until step 3 came back green is another.

A workflow answers the second and third failures at once. The plan cannot be forgotten mid-execution, because the plan is not in anyone's memory — it is the control flow. And a cap cannot be argued past, because there is nothing there to argue with.

One distinction carries the rest of this page: **a skill is control flow the model can talk itself out of; a workflow is control flow it cannot.** [Why it works §2](./06-why-it-works.md) makes that argument at depth.

---

## 4. Why a rule goes in a CLI and not a prompt

There is a fourth piece, and it is the one a newcomer is most likely to dismiss as over-engineering. It is worth the paragraph.

A **CLI** is a program you run in a terminal. It prints an answer and exits with a number — `0` conventionally meaning fine, anything else meaning stop. That number is the part that matters here.

Take a real question from the middle of a run: *which of these twelve tasks can safely run at the same time?* You could put that in a prompt — "group the independent tasks" — and get an answer that reads perfectly well. Interlock instead runs `interlock waves --classified tasks.json`, which prints the batches, and `interlock tasks coverage`, which exits non-zero if the plan quietly dropped a checkbox. The script branches on the exit code and on named fields, never on a sentence the model composed.

Two things fall out of that, and they are the whole payoff.

1. **You can check it yourself.** Run the same command, with no model and no network, and see the same decision the run made. Every one of the nineteen subcommands works this way.
2. **The rule cannot be quietly re-argued next run.** It is not written anywhere a model can read and reinterpret — only somewhere a model can *call*. There is no wording to soften.

A policy in the employee handbook, versus a badge reader on the door. The README's [subcommand table](../README.md#why-this-and-not-a-folder-of-prompts) lists what has moved through that door so far; [why it works §3](./06-why-it-works.md) explains the test for what belongs there.

---

## 5. What the model still decides

Read §3 and §4 quickly and you could come away thinking the design distrusts the model. That is the wrong takeaway, and it is worth correcting before it sets.

Everything that is genuinely a judgement stays with the model: reading an unfamiliar codebase, deciding what a task is worth, writing the code, reviewing a diff, synthesising a summary a person will actually read. What moved out is only the narrow class of decision that has a *correct* answer a program can compute — and the test for that class is sharp: if two competent runs could reach different answers from the same inputs and only one is right, it was never a judgement.

`interlock waves` decides the ordering and the parallelism cap. The model decides what each task is worth and then writes the code.

Or, in the compressed form: **the script holds the loop, the CLI holds the rules, the agents do the work.**

---

## 6. Now read the flow again

You now have six words you did not have on the first page. The two commands you actually type mean something specific.

<p align="center">
  <img src="./assets/interlock-flow-wide.png" alt="Interlock flow: bootstrap once, then spec, then you read the spec, then ship, then mr" width="900">
</p>

`/interlock:spec` is a **skill**. It can ask you questions — about what you actually want, about a dependency version it refuses to guess at — because a skill runs inside a conversation and there is a person on the other end of it.

Then you read the spec. That is the one deliberate stop, and [the checkpoint](./02-the-checkpoint.md) is how to do it in ten minutes.

`/interlock:ship` is a **workflow**. It cannot ask you anything.

That last sentence is the payoff, so here it is without the shorthand: `ship` asks nothing not because it was instructed to be autonomous, but because the workflow runtime has no channel for mid-run input at all. There is nobody listening. Every tool in this category promises autonomy in a prompt; this one gets it from the shape of the thing it runs on. That is what "the shape is the product" means, and it is also why every decision that might need a human has to be settled *before* ship starts — which is why the checkpoint exists at all.

There is one flag that skips the read. It is opt-in, it fails closed, and [continuity](./05-continuity.md) is the honest account of what it cannot catch. Read that page rather than a summary of it; it argues against itself carefully and the argument is the useful part.

---

## 7. Terms you will hear but do not need yet

You can stop here and go run something. The rest of the vocabulary shows up in the README and in the deeper docs, so here it is inoculated in advance — one line each, and when it starts to matter.

| Term | You can ignore this until… |
|---|---|
| **orchestrator** | you want a word for "the thing spawning the subagents". It is `workflows/ship.js`. |
| **structured output schema** | you wonder how the script reads an agent's answer without parsing prose. It asks for named fields. |
| **wave** / **batch** / **tier** | a run prints them at you. Wave = a group that runs in order; batch = a slice of a wave that runs at once; tier = how much context and which model a task earns. |
| **handoff** | you see one wave referring to what the last one did. It is a small structured packet, not a re-read of git. |
| **context tiering** / **model routing** | you start caring what a run costs. [Why it works §4](./06-why-it-works.md) measures both. |
| **MCP** | you want to give agents a new tool from outside the harness. Not needed for any of this. |
| **ACP** | never, unless you are deliberately running the experimental second host. |

[The harness landscape](./08-harness-landscape.md) surveys other systems in this category. Useful later; it will derail you today.

---

## 8. Glossary

Ordered by dependency rather than alphabetically — read top to bottom and it rebuilds this page in miniature. No definition uses a term defined below it.

| Term | In one sentence | Where you meet it |
|---|---|---|
| **prompt** | Text you send the model, hoping for the right thing back. | your chat box |
| **harness** | The program that gathers files, sends them with your prompt, and applies what comes back. | Claude Code itself |
| **context window** | The fixed amount of text a model can see at one time. | every truncation you have hit |
| **tool-use loop** | The model asking the harness to act, reading the result, and going again. | every test run it triggers |
| **skill** | Instructions in a markdown file that the model reads and follows. | `skills/spec/SKILL.md` |
| **subagent** | A fresh model instance with an empty context window and one task. | one per checkbox in `ship` |
| **orchestrator** | Whatever spawns the subagents and decides what happens next. | `workflows/ship.js` |
| **workflow** | A script a runtime executes, which calls the model as a step inside itself. | `workflows/ship.js` |
| **workflow runtime** | The part of Claude Code that runs that script and accepts no user input while it does. | `/interlock:ship` |
| **CLI** | A terminal program that prints an answer and exits with a number. | `interlock limits` |
| **exit code** | That number. `0` means fine; anything else means stop. | `interlock tasks coverage` |
| **wave** | A set of tasks that must finish before the next set starts. | the run summary |
| **batch** | A slice of one wave that runs simultaneously, capped at 8. | `lib/limits.mjs` |
| **tier** | How much spec context and which model a task earns, 1 to 5. | the wave plan |
| **checkpoint** | The single deliberate stop, between `spec` and `ship`. | [02](./02-the-checkpoint.md) |

---

## Next

- [**01 — The first hour**](./01-first-hour.md) — do it, in order, on a real repository.
- [**06 — Why it works**](./06-why-it-works.md) — the sequel to this page: the same subjects at mechanism depth, with the costs stated. This page exists to make that one readable.
- [**04 — When it stops**](./04-when-it-stops.md) — for the first time a run halts and the banner means nothing to you.
