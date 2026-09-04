# 14 — Evals, and what a consumer's run is actually checked by

This page is for a repository that runs `/interlock:spec` and `/interlock:ship`
**against its own product**, rather than developing Interlock. It answers four
questions a consuming team should not have to read the harness to answer: what
is checked on your run and by what, what is recorded and where, why Interlock
runs no model evaluations in your CI, and how to report a run that misbehaved.

One sentence up front, because everything else depends on it: **nothing Interlock
records about your run changes what your run does.** No recorded figure feeds a
gate, a verdict, a readiness decision, a threshold or a band.

## What is checked, and by which command

Interlock checks two different things at two different times, and conflating
them is the mistake worth avoiding. **The preflight grades the machine before
the run starts. The in-run checks grade the run as it proceeds.** A preflight
failure means the run would have died three waves in; an in-run failure means
the work is not ready.

Every one of these is a deterministic command, and **its exit code is the
decision** — the workflow branches on the status, never on parsed prose.

### Before the run — the preflight

| Checked | Decided by |
|---|---|
| Node version, plugin install, `bin/` on PATH, the `openspec` CLI, git, the test profile, the permission allowlist, the writability of the run-state directories | `interlock doctor` — exit 1 if any check would stop a zero-touch run |

`interlock doctor` also reports whether the eval harness is enabled and whether a
model credential is present, when an eval suite exists at the plugin root. Those
two rows are **`skip` when absent and never `fail`**: neither is needed to ship a
change, and a preflight that failed on them would block your work over a
capability your run does not use. They do not affect the exit status.

### During the run

| Checked | Decided by |
|---|---|
| The change's artifacts are complete and implementable | `interlock validate` — exit 1 when the change is not ready |
| Surviving review findings block the gate | `interlock gate` — exit 1 when it blocks |
| Blockers survive the verdict round | `interlock remediate` — exit 1 |
| The reported suite results satisfy the plan for this context | `interlock verify judge` — exit 1 |
| The unit suite is green and was not weakened | `interlock verify unit` — exit 1 |
| The root-cause repair budget is not spent | `interlock verify repair` — exit 1 |
| The decision ledger is parseable and holds no unresolved rows | `interlock ledger` — exit 1 |
| The change may skip the human checkpoint | `interlock ready` — exit 1 when it may not |
| Isolated lane worktrees fold without a real path collision | `interlock merge-lanes` — exit 1 on a halt |
| A completed task id could be marked complete | `interlock tasks tick` — exit 1 |
| The run may proceed / the recorded result did not halt it | `interlock wave-state next` and `record-*` — exit 1 |
| The run's trajectory can be reconstructed later | `interlock run-log check` — exit 1 on a gap, a missing start, or a missing close |

Two commands deliberately never exit non-zero: `interlock drift` and
`interlock conformance` report and ask, and `interlock report` is barred from a
non-zero status as policy, not as convenience — a non-zero exit is exactly the
comparison it may not make.

**Your own test suite is not on this list, and that is the point.** Interlock
decides whether your suite ran, whether it was green, and whether a test was
weakened to make it green. What "green" means is your suite's business.

## What is recorded, and where

Three corpora, all under `.claude/`, all written by your run:

| Corpus | Path | One record per |
|---|---|---|
| Run trajectory | `.claude/ship/runs/<runId>.jsonl` | Step — every wave action, gate exit, agent spawn, verify judgement, and the run's closing receipt |
| Outcome corpus | `.claude/learning/outcomes.jsonl` | Planning→ship attempt |
| Review metrics | `.claude/metrics/*.json` | Review — the finding counts, not the findings |

`interlock report` reads all three and computes indicators over them. **It gates
nothing**: it issues no verdict, applies no threshold to any figure, always exits
0, and no step of any run consults its output. Every value carries its
denominator, and a value nothing observed reads as unobserved with its reason
rather than as a zero.

Whether these three belong in version control depends on what your repository is,
and there is one place that answers it rather than two:
[11 — Whether to keep them](11-the-indicators.md#whether-to-keep-them). Read
that before adding or removing a `.gitignore` line.

Where a cap, ceiling or band governs any of this, **run `interlock limits` to
read its current value.** No number is restated on this page: a threshold copied
into prose is a second copy of a policy only code can be held to, and it drifts
without anyone noticing.

## Why no model evals run in your CI

Interlock ships an eval suite under `evals/` — cases that run a real model
against Interlock's own prompts and skills to catch prompt regressions.
**Interlock does not run those evals in a consuming repository's CI, and you
should not either.** Three reasons:

1. **The model-facing surface is identical in every consumer.** The skills, the
   agent definitions and the implementer briefing are the same bytes in your
   checkout as in anyone else's. A prompt regression is therefore Interlock's to
   catch once, upstream — running the same cases in your CI measures Interlock,
   at your expense, and tells you nothing about your product.
2. **What you want to know is whether *your* change shipped correctly**, and two
   things already answer that: your own test suite, which the run verifies and
   refuses to let an agent weaken, and your read at the checkpoint, where you
   look at the spec before any code is written.
3. **The eval harness is early-access and metered**, on terms you do not
   control. Wiring your pipeline to a flag and a billing surface that can change
   without your involvement buys a signal you did not need.

What you get instead is deterministic per-run grading — the table above — and a
route for reporting a real failure upstream, below.

## How to file a failure

When a run misbehaves — an agent produced a value outside a declared set, took a
step it was told not to take, ignored an instruction it was given — the useful
report is not a transcript. It is a **case skeleton with provenance**: a citation
naming the recorded trajectory and the events the claim rests on, so anyone
reading it can go back to the evidence.

```bash
interlock run-log list
```

```bash
interlock evals capture --run <runId> --out drafts/my-case
```

Add `--task <id>` to narrow the citation to one task's events rather than the
whole run. The command:

- **refuses a run that cannot be reconstructed**, reporting the same problems
  `interlock run-log check` reports — a skeleton citing an event range nobody can
  replay is worse than no skeleton;
- **writes only into the directory you named**, and refuses an output directory
  inside `evals/` or one that already holds a case. Nothing anywhere else in your
  repository is created or modified, and nothing is written at all on a refusal;
- **quotes rather than invents.** Where the trajectory records a value the run
  should not have produced, that value becomes the grader's pattern, quoted. Where
  no such value can be quoted, the skeleton says so and carries a stated
  placeholder.

Everything capture derived rather than read is marked `CONFIRM`. Read the draft,
resolve each marker against the cited trajectory, and file it — the skeleton is a
draft, not a finished case, and the authoring rules refuse a case that still
carries an unconfirmed marker.

## What this page does not license

You can read a figure, name its denominator, and say what would have to
accumulate for it to mean more. You cannot turn one into a gate. If a recorded
figure ever starts deciding whether a run proceeds, that is a change to be
proposed and argued, not a threshold added to a report — see
[11 — Why it gates nothing](11-the-indicators.md#why-it-gates-nothing).
