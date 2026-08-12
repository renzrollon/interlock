# Continuity

This page is about `/interlock:spec --continue`, the one flag in Interlock that removes you from the loop.

Read the honest version first, because it is the reason this page exists rather than a footnote:

> **Continuity cannot catch a wrong idea.** Every check it runs asks whether the change is *implementable*. None of them asks whether it is *right*. A spec that is internally perfect and builds the wrong thing passes cleanly. Only a person reading the proposal catches that, and continuity is the decision to skip that person.

Everything below is about narrowing the set of changes where that trade is worth making. It never gets to zero.

## What it does

Normally `/interlock:spec` writes artifacts, reviews them, and stops — [the checkpoint](./02-the-checkpoint.md). You read, then you run `/interlock:ship`.

With `--continue`, after the artifact review, `spec` asks one machine one question:

```bash
interlock ready <change-name> --review <review-result> --paths <planned paths>
```

Exit 0 and it invokes `/interlock:ship` for you. Exit 1 and it stops and shows you what is in the way — not the spec, just the blocking rows.

```bash
/interlock:spec add a --json flag to the report command --continue
/interlock:spec ... --continue --force-checkpoint   # changed your mind: always stops
```

`--force-checkpoint` wins over `--continue` unconditionally, and readiness is not even consulted. Opting back out mid-flight should be free.

## Why it is opt-in, and why it stays that way

Three properties, in the order they matter.

**Opt-in.** The default flow keeps the human checkpoint, in this release and the ones after it. Continuity is not the future default waiting to be switched on — it is a permanent flag, because the risk it accepts does not go away with better tooling. `spec` will never suggest it to you either. A suggestion from the tool is not a decision by you.

**Fail-closed.** `interlock ready` is true only when every check affirmatively passed. A check that could not run is not a pass: an unreadable ledger, an artifact that would not open, a classifier that threw — all blockers. The two ways a gate like this normally gets defeated are both blockers by name: a missing decision ledger ("nobody wrote anything down, so nothing needs a human") and a missing artifact-review result ("no blockers were reported, so there were none"). `spec` branches on the command's **exit code**, never on its own reading of the artifacts.

**Every interrupt happens before ship.** `/interlock:ship` is a dynamic workflow, and the workflow runtime takes no mid-run user input at all. There is no "we will confirm that during implementation" — there is nobody to confirm with. So a question that would have been asked during a manual run has to be answered before the run starts, or the run does not start.

## What it actually checks

In plain language, with the flavour of the failure each one prevents.

| Check | Blocks when |
|---|---|
| Artifacts implementable | `proposal.md`, `design.md` or `tasks.md` is missing or empty, or `tasks.md` has no real checkbox tasks |
| Artifact review | The review found blockers, or no review result was supplied at all |
| Decision ledger present | There is no `decisions.md`, so nothing proves no human is needed |
| Decisions need a human | Any `needs_human` row remains |
| Ledger rows valid | Any row is malformed, or claims `agent_resolved` with no resolution or no evidence |
| Scenarios mapped | A `Scenario:` in the delta specs matches no task — so the behaviour is specified and nobody was asked to build it |
| Tasks are specific | A task says `as needed`, `update accordingly`, `handle edge cases`, `etc.`, `where applicable`, `if necessary`, `appropriately`, `and so on` — instructions to an implementer who will not have you available |
| Risk class allowed | The blast radius is above the continuity ceiling (below) |
| Test profile | There is no `.claude/testing/profile.json`, so `ship` would be guessing how to run your suite |

Two escape hatches, both deliberately greppable rather than clever:

- A scenario no task names by title is covered by writing **`covered by task 4`** under it.
- A task may keep a vague phrase when it also states what done means: **`acceptance: …`**.

Warnings from the artifact review are reported and do **not** block. Blockers always do.

Some things are listed as skipped rather than passed, which is the point of listing them: whether this is the right change, whether a bug fix carries real repro evidence, whether the invariant sweep enumerated every consumer. Those are the human's jobs, and continuity does not pretend to have done them.

## Risk classes

Blast radius is classified from the changed and planned paths plus the text of the artifacts, and the result is the **maximum** over every signal that fired — never an average. A change that is 90% docs and 10% payment code is a payment change.

| Class | Typical signal | May continue |
|---|---|---|
| `low` | Every touched path is docs or tests | **yes** |
| `medium` | Source code that matched no severity rule; shared-value transforms and invariant sweeps | **yes** |
| `high` | Auth, sessions, permissions, tenancy; new public API, schema changes, migrations | no |
| `critical` | Deletes data, changes idempotency, touches payments | no |

`low` is only ever reached by a positive signal. Source code that matched nothing lands at `medium`, and a change with no usable signal at all lands at `high` — "we could not tell" has to stop the machine, so unclassifiable never comes out safe.

You can ask for the classification directly, without running anything else:

```bash
interlock risk <change-name> --paths src/report.ts,docs/report.md --json
```

`risk` never exits non-zero. A high-risk change is a checkpoint, not a failed command — branch on `continuityAllowed`.

## When it pauses

You get a short list titled **`Continuity paused — N decisions need you`**, containing only:

- the `needs_human` rows from the decision ledger — the id and the question
- the named blockers from the readiness gate, each with the line that triggered it

You will not get the spec dumped back at you. You opted out of that read; handing it back would be the tool declining to do the job you asked for. Opening the artifacts is offered as a secondary action, and the change directory is named so you can.

Answer the questions and `spec` writes the resolutions into the ledger, updates `design.md` where an answer changed a decision, re-runs the readiness gate, and continues if it now passes. Rows are edited in place and never deleted — the record of what needed a person is the useful part afterwards.

If it blocks a second time on something that is not a one-sentence answer — an artifact that is not implementable, a risk class above the ceiling — it stops for good and hands you the normal checkpoint. Continuity is not a loop to grind against.

## The decision ledger

Continuity rests on `openspec/changes/<change-name>/decisions.md`, which `explore` and `spec` write as they go. Every ambiguity either got answered with evidence, or is sitting there marked `needs_human`.

```bash
interlock ledger <change-name>
```

Exits non-zero while a `needs_human` row remains, or a row is invalid. Writing the words `agent_resolved` is not a decision — a row claiming it with an empty resolution or empty evidence blocks exactly like an open question, because the alternative is a gate you can pass by asserting confidence.

An absent ledger reads as "no decisions were recorded", which is only honest if the change genuinely raised no ambiguity. That is why an absent ledger blocks continuity rather than passing it.

## When to use it, and when not to

Reasonable: a docs change, a test-only change, a narrow flag on an existing command, a change following a pattern already in the repo — where you would have skimmed the spec and run `ship` anyway.

Not reasonable: anything you would have actually read. The first change in an unfamiliar area, anything where you are unsure the request was understood, anything where being wrong is expensive to undo. Those are exactly the cases where the ten minutes pays, and no gate can tell the difference from artifacts alone — because the artifacts are the thing that might be confidently wrong.

If you find yourself passing `--continue` by habit, that is the signal to stop passing it.

## Next

Back to [**02 — The checkpoint**](./02-the-checkpoint.md) for the read this replaces, or [**04 — When it stops**](./04-when-it-stops.md) for the halts on the other side of it.
