# 14 — Evals, and what a consumer's run is actually checked by

This page answers evals for two audiences. The first half is for a repository
that runs `/interlock:spec` and `/interlock:ship` **against its own product**,
rather than developing Interlock. It answers four questions a consuming team
should not have to read the harness to answer: what is checked on your run and
by what, what is recorded and where, why Interlock runs no model evaluations in
your CI, and how to report a run that misbehaved.

The second half is for people changing Interlock: which layers are evals, which
are not, and how the suite should grow. Skip it if you only ship with Interlock.

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

---

## What Interlock itself is evaluated by

The rest of this page is for maintainers. A consuming team's green `verify unit`
says their product tests passed. It does not say Interlock's trampoline still
halts, or that tier-1 still stays off `design.md`. Those questions belong to
Interlock's own suite, run in this repository, never in a consumer's CI.

**Do not treat `npm test` as an agent eval.** `npm test` is `node --test` over a
`find`-piped file list. It is the policy-engine regression net. Skill-token pins
in `test/skills.test.mjs` are also not agent evals: they assert that instruction
bytes exist, not that a model followed them.

### Four layers that are not substitutes

| Layer | What it is | What it proves | What it does not prove |
|---|---|---|---|
| **Unit tests** (`npm test`) | Deterministic `node:test` over `lib/`, `bin/`, hooks, fixtures, eval *structure* | Policy, CLI exit codes, schema, isolation, fail-open | That a model followed an instruction |
| **Skill-token pins** (`test/skills.test.mjs`) | Regex/token assertions over `SKILL.md` bodies | The instruction is still on disk | The model will halt, route, or copy an enum |
| **In-run CLI gates** | Exit-code decisions the ship loop branches on | One live run's artifacts, suite, trajectory | Recurring model behaviour across versions |
| **True agent evals** (`evals/` cases + `evals/ship/`) | A model (or the real loop) in a controlled task, graded | Instruction-following and/or shipped outcome | Nothing, until they actually run and triage can read the results |

A case that only duplicates a `node:test` assertion is refused for the same
reason the layers are separate: the unit suite already covers it, cheaper and
without a model.

### The spine

Stay on stdlib Node. Three runners, one decision CLI. Do not add a fourth
framework.

```
npm test                          → structure, CLI, isolation, fail-open
claude plugin eval                → transcript cases (early-access vendor harness)
node evals/ship/run.mjs           → outcome cases (this repo's harness)
interlock evals triage|calibrate|promote|capture  → verdicts, never models
```

`claude plugin eval` is already the transcript harness. Replacing it with
AgentEvals, Harbor, Braintrust or LangSmith would duplicate graders this repo
already has, add a runtime dependency CI does not install, and — for AgentEvals
— score the wrong object (chat messages versus Interlock's JSONL events). A
dependency for isolation or a judge SDK is a design decision with a pinned
version in a change's `design.md`. It is not needed to grow this suite.

Metered jobs stay off the pull-request critical path except smoke, stay advisory
until `interlock evals promote` says otherwise, stay bounded by `interlock
limits`, and never feed `interlock ready`, `gate`, or the ship loop. Online
LLM scoring of a live ship would put a judge on the hot path and invent a gate
from a figure, which this page and [11](11-the-indicators.md) refuse.

### Transcript, outcome, process

Three measurements, not one with three names:

| Surface | Grades | Runner |
|---|---|---|
| **Transcript** | One briefing or skill against a real model (`regex`, `tool_used`, `tool_order`, judged graders) | `claude plugin eval` over `evals/<case>/` |
| **Outcome** | Disk after a real ship: ticks, suite, commit, receipt, weakened-suite | `node evals/ship/run.mjs` |
| **Process** | The reconstructable JSONL, not chat: required event types, known `action` values, halt when unit was red | `evals/ship/trajectory.mjs`, on the loop arm only |

The loop's stage sequence is a contract (`lib/run.mjs`). Implementer tool order
is not. Match the former by event type on the run-log. Match the latter with
set-membership (`tool_used` min/max). Strict tool-order on an implementer trace
punishes valid alternatives.

Smoke cases are **regression** evals: they should stay near pass, and they use
deterministic graders only. Outcome fixtures are **capability** evals: small,
distinct hills, two arms, no verdict on the difference. Do not mix a
known-failing capability case into smoke. Cases, fixtures, and the outcome
runner's spoken limits (ACP only, default config, apparatus agent labelled on
every row) live in `evals/` and `evals/ship/README.md` — this page does not
restate them.

Scores are model × harness. The outcome eval already treats the ACP apparatus
agent as a labelled confounder and refuses to pretend ACP is Workflow. A later
host matrix is the same fixture on another headless driver, with `host` on every
row — not a new framework.

### How the suite should grow

The closed loop is already specified: **capture** a real miss → author a case
from resolved evidence → scheduled or dispatched **run** → **triage** → a
maintainer commits a history record → **promote** may move advisory to blocking.
Authoring is `skills/evals/SKILL.md`. Classification is `interlock evals
triage`, never the skill. Caps, windows and floors are `interlock limits --json`
under `evals` — not restated here.

Add a case only from an observed failure (archived proposal, changelog, run
artifact, or a captured skeleton whose every `CONFIRM` is resolved). No
observed failure, no case. Spec, review, explore-as-skill-body, and bootstrap
stay uncased until capture or a changelog cites a miss. Hypothetical coverage
of those skills would teach the team to ignore the suite.

Keep skill-token pins when you add an instruction. Do not replace them with a
model case, and do not add a model case that only re-asserts the pin.

Pick the cheapest grader that expresses the assertion. A judged grader needs a
human-labelled calibration set before promote may consider that case; until
transcripts exist, name the grader in `evals/CALIBRATION-DEFERRALS.md` rather
than labelling invented ones.

Guard fail-open stays a unit test (`test/hooks.test.mjs`). An eval that a live
model in `remediation` was denied a test edit waits for a reproduced miss. The
same for review-band behaviour: plant findings and assert `interlock gate` in
`node:test`. Do not LLM-judge a threshold.

`interlock evals capture` never writes into `evals/`. History under
`evals/history/` is a maintainer commit after a run, not CI committing to the
default branch. Empty history means promote reports insufficient history and
the eval workflow stays advisory — that is the correct posture, not a bug to
work around with a YAML boolean.

Do not wire outcome scores, transcript scores, or `interlock report` figures
into any gate.

### What still needs a run, not a new case

The harness for evals is built. Improving evals means closing the loop above,
not adding frameworks or hypothetical tasks.

1. **Record history.** After a smoke or full-suite run, triage it and commit
   the summary `evals/history/` expects. Promotion cannot fire on an empty
   window, and a single file is a start rather than a window.
2. **Calibrate the judged graders** from those transcripts, then delete the
   deferral rows. Until then those cases cannot promote.
3. **Keep producing outcome rows.** Ordinary CI already runs
   `node evals/ship/run.mjs --prepare-only` (no credential, no spend). A
   metered sweep is schedule and `workflow_dispatch` only. Partial-at-ceiling
   is allowed; the deliverable is rows, not a verdict.
4. **Host matrix and `--strict`** wait until a headless driver exists for the
   host, or until a fixture can plant surviving blockers and assert the loop
   does not emit commit — the latter can start as CLI-driven, without a model.
5. **Optional later:** fire the smoke job on `evals/**` and `lib/evals-*.mjs`
   so a grader or triage-reader edit is metered; a counts-and-denominators
   view over `evals/history/` (not a gate); a harder fixture only when the
   three current ones saturate.

Everything else — Harbor, AgentEvals, spec-path hypotheticals, online judges —
would make the suite look busier while the existing one still needs trials in
git.
