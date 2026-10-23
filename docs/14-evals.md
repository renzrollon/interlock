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

### Asked or reported, never decided

Some commands deliberately never exit non-zero on what they find. They ask a
question or report a figure, and no step of a run branches on their status:

| Asked or reported | By |
|---|---|
| Which of the change's own delta scenarios the handoff must answer for | `interlock conformance` — the questions, never the verdicts; exit 0 |
| Which living requirements already in force the handoff must answer for | `interlock conformance --living` — the list the `domain` reviewer is judged against, from the same base; exit 0. The answers are read by the merge verdict's `conformance.living` signal and never halt a run |
| Which completed changes were never archived, and which specs cite files that are gone | `interlock drift` — exit 0 |
| How much contract each living capability carries | `interlock spec-audit` — exit 0 whenever it completes |
| Indicators over the recorded corpora | `interlock report` — barred from a non-zero status as policy, not as convenience: a non-zero exit is exactly the comparison it may not make |

A run's close also states a merge-confidence verdict, and that too is reported
and never enforced: the verdict does not change the close's exit code, and
nothing in a run consults it. Run by hand, `interlock merge-confidence` is a
deciding command like the ones above: exit 1 on `BLOCK`, or on anything but
`MERGE` with `--require-merge` ([15](15-merge-confidence.md)).

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

The outcome record's observed group carries one more value from the close,
`mergeVerdict`: the merge-confidence verdict (`MERGE`, `HUMAN` or `BLOCK`) taken
from the run's receipt, or `null` for a run that was halted, never assessed, or
closed before the receipt carried one. It is observed, because the orchestrator
saw it, and stored, so a later question can be answered from evidence. Nothing
that decides reads it back: no gate, readiness check or autonomy level consults
it, `interlock outcomes append` refuses it in the reported group, and
`interlock report` reads neither it nor the receipt block it comes from.

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
node evals/ship/matrix.mjs        → cost-per-task rows (same harness, by hand)
interlock evals triage|calibrate|promote|capture  → verdicts, never models
```

The cost-per-task sweep is not a fourth framework. It reuses the outcome
harness's fixtures, isolation, graders and pricer, and is described below.

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

### Running the model evals

```bash
export CLAUDE_CODE_WALNUT_SPIRE=1          # early-access enablement — env only, never committed
claude plugin eval . --tag smoke --trust-plugin --allow-tools Bash --no-publish --json evals-results.json
interlock evals triage --results evals-results.json   # regression / variance / no signal — exit code is the verdict
```

- **Trust and tool grants are part of the command.** With `--json`, or with no terminal, the harness refuses a plugin directory you have not trusted before any case runs; `--trust-plugin` answers for it. Bash, Write, Edit and WebFetch are operator-gated: a case's `allowed_tools` alone does not grant them, and a grader that needs a withheld tool cannot pass. Grant what the cases you run list, as both CI jobs do (`test/evals.test.mjs` pins the set).

- **Enablement is a local prerequisite.** `claude plugin eval` is early-access and does nothing until `CLAUDE_CODE_WALNUT_SPIRE=1` is set *in the environment*. Do not commit it to `.claude/settings.json` — a committed value produces a suite that looks configured and does not run.
- **The verdict is model-free.** `interlock evals triage` classifies a results file without a model or the network; its exit code is the verdict, so the one gate a model could otherwise re-argue is on the deterministic spine like every other decision.
- **Advisory, pending a baseline.** The CI eval job reports and does not block. No baseline scores exist yet, so any blocking threshold would be a guess; promotion needs observed variance across more than one run. The offline structural gate `test/evals.test.mjs` runs in `npm test` and *does* gate every pull request.
- **CI skips until access is provisioned.** The eval job (`.github/workflows/evals.yml`) skips fork pull requests and skips cleanly when no model credential is present, so the suite lands and is maintained before paid access exists.
- **No schedule until a credential exists.** Neither `evals.yml` nor `ship-outcome-eval.yml` has a `schedule:` trigger; the `full` job runs on `workflow_dispatch` alone. A weekly run that skipped for want of a key finished green, and a green that measured nothing reads as a passing eval; failing weekly instead would go red for good if the key is never provisioned. Adding a cron back is the edit that records the credential's arrival. The pull-request smoke still skips quietly, so a fork stays mergeable.

The cases each encode a reproduced failure: tier read-scope, cited-cap resolution, lane partial-failure reporting, handoff enum conformance, control-plane action invention, trampoline halt, skill routing, and evidence-locator fabrication. Each case cites the failure it encodes.

### Spec Range — measuring the checkpoint advisor

The Spec Range cases (`evals/spec-range-*/`) measure the checkpoint consult the
spec skill runs before it hands off (see [02 — The checkpoint](02-the-checkpoint.md)).
Each one seeds a frozen copy of an archived change folder — its proposal,
design, tasks and delta specs, without the decision ledger, because the ledger
carries the answer — and runs the consult on it. `label.md` in each case holds
the question a human actually had to answer for that change, copied from the
archived ledger.

- **Seeding needs `--scaffold`.** Each case places its fixture through
  `context.scaffold_script`, which the harness runs only under `--scaffold`.
  The dispatched full job passes it; the smoke job does not, and these cases
  carry no `smoke` tag. A run without it starts in an empty workspace, writes
  no `advisor.md`, and fails `advisor-written` — the absence is how the report
  shows the run was unseeded rather than the advisor wrong.
- **What is graded.** Deterministically: that `advisor.md` was written, that
  the `interlock advisor … --check` line ran, and (as a with-only indicator)
  that `interlock:advisor` was spawned once. By a judge: `matches-label`,
  whether a kept question asks the human's question or one whose answer would
  settle it, and `answered-already`, whether the kept questions merely restate
  what the artifacts already answer.
- **The labels are the kill criterion's data.** Human labels for those two
  judged graders, stored under `evals/spec-range-*/calibration/` in the
  [calibration layout](../evals/CALIBRATION-LAYOUT.md), are what
  `interlock advisor --verdict --labels evals` tallies into keep, kill or
  insufficient labels. Until they exist the graders are named in
  `evals/CALIBRATION-DEFERRALS.md` and the verdict says the labels are
  insufficient.
- **No threshold lives here.** How many labels the verdict needs, and the
  match and repeat bounds it applies, are caps in `interlock limits`; read them
  there.

#### Running the advisor end to end, on demand

`scripts/advisor-e2e.mjs` runs the consult for real, once, by hand. It is development tooling that never ships, and it never launches `claude` itself. It prepares a scratch run, prints the two metered commands for `scripts/host-probe.mjs`, then reads what they left behind:

```bash
node scripts/advisor-e2e.mjs setup --out "$TMPDIR/adv"     # plugin copy, logger mod, seeded scratch repo, prompt
# run the two host-probe commands it prints: a headless consult, then the case through `--mode eval`
node scripts/advisor-e2e.mjs verify --out "$TMPDIR/adv"    # PASS/FAIL per fact; exit 1 names what failed
```

- **What it answers.** The probe half checks that the engine raised one `agent.spawn` for `interlock:advisor` with a string model (what the spec meter's consult counter keys on), that the draft landed where the meter reads it, and that `advisor.md` was written. The eval half runs the Spec Range case with the full job's flags (`--scaffold` included). It then triages the real results file with `--eval-dir evals`, scales the run's cost to the Spec Range share of the full job against the ceiling in `interlock limits`, and lists every grader field the harness wrote.
- **It is paid for once.** `--mode eval` refuses to start without `--max-cost-usd`. `verify --write-fixtures` turns the run into scrubbed fixtures (`test/fixtures/mod/agent-spawn-advisor.json` and a results file under `test/fixtures/evals/`), and from then on `npm test` and `claude plugin test` re-check those for free. A fixture that would still name a local path is not written, and the output says so.
- **The probe never touches this repository.** The session's `--plugin-dir` is an rsync'd copy, so the `tsconfig.json` and `types/` a plugin-dir session writes land in the copy.

### Review Range — measuring the findings advisor

The Review Range cases (`evals/review-range-*/`) measure the opt-in findings
consult that `/interlock:review-code --advisor` runs after its gate. Each one
plants a real bug, taken from a later `fix(...)` commit, as a finding the
skeptics dismissed on a weak citation: a `path:line` that resolves to the
changed file and passes the evidence gate, but points at code that does not
decide the defect. The fixture holds the buggy file as it stood before the fix,
a short `proposal.md` for the change, and the planted `review/findings.json` and
`review/verdicts.json`. Beside the real bug sit a decoy the skeptics dismissed
correctly and a finding that survived. `label.md` names the fix commit, the
buggy `path:line` and the title of the dismissed finding a human would want
doubted.

- **Seeding needs `--scaffold`.** Each case places its fixture through
  `context.scaffold_script`, which the harness runs only under `--scaffold`.
  The dispatched full job passes it; these cases carry no `smoke` tag. A run
  without it finds no review to resolve, the check records a consult that did
  not run, and `check-drafted` fails, which is how the report shows the run was
  unseeded rather than the advisor wrong.
- **No Write is granted.** The case runs the review line with
  `--advisor-brief`, spawns `interlock:review-advisor` once, and pipes the reply
  to `interlock review-advisor <change> --check -`, which persists the draft and
  renders `review-advisor.md` itself.
- **What is graded.** Deterministically: that the check printed a drafted
  result (`check-drafted`; a did-not-run check fails it), that the
  `interlock review-advisor … --check` line ran, and (as a with-only indicator)
  that `interlock:review-advisor` was spawned once. By a judge: `matches-label`,
  whether a kept `dismissal-doubt` flag targets the dismissal `label.md` names,
  and `repeats-survivor`, whether the kept flags merely restate what survived.
- **The structural suite keeps the plant honest.** `test/evals.test.mjs` runs
  `interlock review` over every fixture, so an edit that turns the planted bug
  into a survivor fails it, and compares the fixture's copy of the buggy file
  with the fix commit's, so a fixture cannot carry the fix.
- **The labels are the kill criterion's data.** Human labels for the two judged
  graders, stored under `evals/review-range-*/calibration/` in the
  [calibration layout](../evals/CALIBRATION-LAYOUT.md), are what
  `interlock review-advisor --verdict --labels evals` tallies into keep, kill or
  insufficient labels. Until they exist the graders are named in
  `evals/CALIBRATION-DEFERRALS.md` and the verdict says the labels are
  insufficient. The cases gate nothing.
- **No threshold lives here.** How many labels the verdict needs, the bounds
  it applies, and the consult's flag and brief caps are caps in
  `interlock limits`; read them there.

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

**Grading a run that already happened.** An interactive `/interlock:ship` run
leaves the same disk and the same trajectory the outcome fixtures leave, so the
outcome graders can read it where it ran, with no model and no credential:

```bash
node evals/ship/run.mjs --grade-root <dir> --change <name> --baseline-commit <sha> \
  --fixture-id <id> [--run-id <id>] [--baseline-counts <file>] [--history-root <dir>] [--no-history] [--json]
```

It grades the root's newest run (or `--run-id`) with the loop arm's graders and
spawns no agent. Unless `--no-history` is given it appends one row to the outcome
history, and the row says what produced it: the host the run recorded, the plugin
version it recorded (the CLI's when no plugin root was given), the model it
recorded or `unknown`, and an eval agent of `interactive-session`, so it is never
read as a headless-driver row. A run whose trajectory and receipt carry no
version is refused, and nothing is appended: a row with no release to key it on
could not be compared with another. Without `--baseline-counts` the
not-weakened criterion is `unobserved`, with its reason, and never met. A
maintainer commits the rows they mean to keep, as with every history row.

Scores are model × harness. The outcome eval already treats the ACP apparatus
agent as a labelled confounder and refuses to pretend ACP is Workflow. A later
host matrix is the same fixture on another headless driver, with `host` on every
row — not a new framework.

### Cost per task — model × effort

`node evals/ship/matrix.mjs` records what this repository's own fixtures cost
across the models and effort levels a routing edit would choose between.

**What it runs.** Every outcome fixture, crossed with the two Claude API model
ids and the effort levels the sweep declares (`GRID_MODELS` × `GRID_EFFORTS` in
`evals/ship/matrix.mjs` — this page does not restate them). Each cell runs the
control-arm procedure: the committed eval agent prompted once per task at that
cell's model and effort, then the fixture's unit command and graders, in a
scratch root outside this repository. A root inside it is refused before any
cell starts. A model the current price table does not contain is not run, and
makes no request. Each cell that ran appends one row to
`evals/history/cost-per-task.jsonl` (schema `interlock.cost-per-task/1`):
fixture, model, effort, judge pass or fail, tokens, cache reads and writes by
tier, dollars with the price-table id — or the reason there are no dollars —
and wall clock.

**It is not the outcome eval.** It is a different command writing a different
file. The outcome eval holds one model constant and varies the loop. This sweep
holds the procedure constant and varies model and effort. It runs no wave loop,
no planner and no verify step, so a row measures model × effort on the fixture
tasks, not planner or verify spend. It never writes `ship-outcomes.jsonl`, its
rows are not promotion trials, and no pull-request workflow starts it. A red
grader is a field on a row, not a failed run.

**It is bounded and gates nothing.** The dollar ceiling is the one `interlock
limits` publishes for this sweep. It is checked between cells only. It stops the
next cell from starting and never kills one in flight. A sweep stopped there is
partial, and partial is a result, not a failure.

**A dial change cites its rows.** The effort defaults and the multi-task opus
floor are printed by `interlock limits` and are not restated here. An edit to
either cites the `cost-per-task.jsonl` rows it relies on, by fixture, model,
effort and price-table id. The sweep itself changes neither, and a row is
evidence for that edit, not a verdict on it.

### How the suite should grow

The closed loop is already specified: **capture** a real miss → author a case
from resolved evidence → dispatched **run** → **triage** → a
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
   metered sweep is `workflow_dispatch` only. Partial-at-ceiling
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
