# 11 — The indicators

`interlock report` is the only command in this repository that reads the corpora
the others write. It computes indicators, prints each one's denominator beside
its value, and does nothing else — no threshold, no verdict, no exit code, and no
step of any run consults it.

```bash
interlock report
```

```bash
interlock report --json --since 2026-08-01T00:00:00Z --change add-widget
```

## Why a reader had to exist before the corpora filled

Interlock writes three corpora and, until this command, read none of them.

| corpus | writer | what it holds |
|---|---|---|
| `.claude/learning/outcomes.jsonl` | `interlock outcomes append` | one line per planning→ship attempt, partitioned into what the run **observed** and what an agent **reported** |
| `.claude/ship/runs/*.jsonl` | `interlock wave-state`, `verify`, `run-log append` | one trajectory per run: wave actions, command exits, agent spawns, and a closing receipt |
| `.claude/metrics/review-*.json` | `interlock review --metrics` and `interlock gate --metrics` | one review's four counts — raised, dismissed, dropped by quality, surviving |

A halted run also leaves a **resume card** at
`.claude/handoff/ship-<change>-<runId>.md`, and it is not a fourth corpus. It is
one markdown file written for a person, pointing at the three above; it holds no
counts of its own, `interlock report` never opens it, and no indicator on this
page has it as a source. It is documented where the halts are, in
[04 — When it stops](04-when-it-stops.md#reading-a-ship-halted-run).

The first run of this command against its own repository found three things
nobody knew: the receipt path had never once fired, 727 of 729 trajectories were
attributed to no change at all, and every file in `.claude/metrics/` had been
written by a skill in a different shape than the counts reader expected. None of
that was discoverable while the corpora were write-only. **A corpus nobody can
read is a corpus nobody notices is empty.**

The metrics row above understates how that third finding happened. `--metrics`
existed on `interlock review` for a year and no skill ever passed it, so the
review-finding indicators read `unobserved` the entire time — not because
nothing was reviewed, but because nothing recorded that it had been. `gate` had
no equivalent flag at all, which left `review-artifacts` — the path that reaches
its verdict through `gate` rather than `review` — permanently unobservable.

Both are closed now: `gate` accepts `--metrics <change>` with the same
semantics, and both review skills pass it on their documented command lines.
That last part is asserted by a test, because nothing else notices when a skill
stops asking: the corpus simply stays empty, and an empty corpus reads exactly
like a loop that never ran.

Emission is bookkeeping in both commands. It cannot alter the verdict, the exit
status or the existing machine-readable output; a failed write reports its
reason and never raises. A record is attributed to the change the caller named
and to no other — a missing name writes nothing rather than guessing one from
the findings file's path.

## Where they live

Every corpus above is written to, and read from, the **state home**. In a main
checkout that is the checkout itself, and nothing in this section changes
anything. In a linked worktree — `claude --worktree`, a Desktop worktree
session, anything `git worktree add` made — it is the main checkout, read from
git's common directory. A worktree is deleted with its session, so corpora
written inside it would go with it, and this command run from the main checkout
would never have seen them.

The split is by kind. Append-only records about runs go to the state home;
per-run working state stays with the run:

| files | lives in | what it is |
|---|---|---|
| `.claude/ship/runs/` | state home | trajectories — fatal-class |
| `.claude/learning/outcomes.jsonl`, `.claude/metrics/` | state home | outcome records and review metrics — outcome-class |
| `.claude/handoff/`, `.claude/ship/interrupted/`, `.claude/autonomy.json` | state home | resume cards, interrupted-run notes, the autonomy ledger — outcome-class |
| `.claude/ship/run.json`, the wave state, briefings, `.claude/ship/spill/`, the stage marker, the launch ledger, `.claude/ship/agent-usage/` | working root | per-run working state, read back by the same run in the same tree |
| `.claude/testing/profile.json`, `.claude/graph/` | working root first, then the state home | inputs, read through and never copied |

Each corpus keeps its loss semantics wherever it lands: a trajectory append that
fails in the main checkout still exits 1, and an outcome or metrics write that
fails there is still only reported. The spill a trajectory line points at stays
with the run, in the worktree, and the `run-start` event records that worktree
as `cwd` so a reader in the main checkout can find it.

`interlock run start` resolves the home once and records it, with the run's
**surface** — `main`, `linked-worktree`, `lane-worktree` (one of Interlock's own
lane worktrees, which is always its own home) or `unknown` — on the run
manifest, the `run-start` event and the receipt. Every later step of that run
uses the recorded home. A command with no run of its own, this one included,
takes `--state-home <dir>`, else `INTERLOCK_STATE_HOME`, else the home the run
manifest at its root recorded, else asks git
([07](07-cli-and-configuration.md#where-a-runs-records-go-the-state-home)). When
git cannot answer, the home is the root and the output says
`STATE HOME UNRESOLVED`. The outcome-eval history under `evals/history/` is the
one exception this command makes: it is a committed file in the working tree
rather than a corpus a run appends to, so it is read from the root.

## Whether to keep them

The three corpora above are runtime state, and whether they belong in git depends
on what the repository *is*. There is one rule and it has two sides.

**A repository that runs `/interlock:ship` against its own product should commit
them.** There, the trajectory, the outcome record and the review metrics are the
audit trail of how the code got written — what was planned, what each wave did,
which findings survived, what the gate decided. Gitignoring them means that
record exists on one developer's laptop and dies with it, and that `interlock
report` can never answer a question about the team, only about the last person
to run something.

**A repository that develops the harness itself should exclude them.** There, a
ship run is development exhaust rather than a record of shipping a product, and
committing it commits noise. This repository takes that side, and the evidence
for why is on disk: `.claude/ship/runs.polluted-2026-08-29/` holds roughly a
thousand trajectory files that the `add-report-dashboard` diagnosis attributed
5690 of 5704 events to `change: "unnamed"` — test exhaust, written because the
CLI test suite spawned the real binary against the real root. Committing that
would have been committing pollution and calling it an audit trail.

```gitignore
# Repo that develops the harness: runtime state, never committed
.claude/ship/
.claude/learning/
.claude/metrics/
.claude/handoff/
```

```gitignore
# Repo that ships its own product with Interlock: keep the audit trail.
# Ignore only the volume, not the record.
.claude/ship/spill/
.claude/handoff/
```

`.claude/handoff/` is on **both** sides, which is the one line that does not
follow the volume-versus-record split above. It holds explore briefs and halt
resume cards, and neither is a record anybody should keep: both are written for
a person to read once, in this checkout, and nothing reads either back. A halt
card also carries the absolute `cwd` the close ran in, so committing one leaks a
local path into a shared history for no gain.

Three caveats worth knowing before choosing the commit side.

**A run shipped from a linked worktree records into the main checkout.** Its
trajectory, outcome line and metrics land in the main checkout's working tree,
not on the worktree's branch, so on the commit side they are committed from
there rather than riding along with the change they describe.

**`outcomes.jsonl` is a single append-only file, and therefore a merge-conflict
site.** Two branches that each ship a change both append to the same file at the
same end, and git will ask a human to resolve it. The other two corpora are
conflict-free by construction — a trajectory is one file per run and a metrics
record is one file per review, so parallel work writes to different paths and
never collides. If the conflicts become tiresome, the honest fix is a merge
driver or a union merge attribute on that one path, not gitignoring the corpus
and losing the record.

**Spill is volume, not record.** `.claude/ship/spill/` holds full suite output
for runs that overflowed the context budget — hundreds of KB per run, referenced
from the trajectory by locator. Exclude it even when committing everything else;
the trajectory line that points at it is the part worth keeping.

## The indicators

Every indicator carries `source`, `value`, `observedOf` (the denominator) and
`notObserved`. When `observedOf` is 0, `value` is `null` and `reason` says why.
It is never `0`.

### Coverage — printed first, and it governs the rest

How many trajectories exist, how many carry a `run-start`, a terminal event, and
a **receipt**; how many outcome records exist by mode; how many metrics files
were recognized.

Runs with no terminal event are split in two, each over the scanned runs.
**Interrupted** runs are named by an interrupted-run note: the `SessionEnd`
recorder wrote one because the session that owned the run ended mid-run. Every
other run without a terminal event is **unexplained**:

```
    with terminal   12   (run-complete or run-halt)
    without terminal 2 — interrupted 1 (a SessionEnd note names the run), unexplained 1
```

An unexplained run is the one worth opening with `interlock run-log show`.
Nothing recorded why it stopped. A note whose run is not among the scanned
trajectories is counted on its own line rather than joined to nothing, and a
note that cannot be read is named. The JSON carries the same fields as
`coverage.trajectories.withoutTerminal`,
`interruptedNotesWithoutTrajectory` and `interruptedNotesUnreadable`.

Coverage also says where the runs it read came from, and what it did not read.
The report's first lines name the [state home](#where-they-live) every corpus
was read from and the surface of the directory the command ran in. Then each
scanned run is counted under the surface its own `run-start` recorded — where
the run ran, which has nothing to do with the [three renderings](#three-surfaces-one-object)
below. A trajectory written before the field existed is `unrecorded`, never
guessed:

```
    surfaces        main 9, linked-worktree 3, lane-worktree 0, unknown 0, unrecorded 2 — over 14 scanned, as each run-start recorded it
```

And it counts the trajectories still sitting in the repository's **other linked
worktrees**: every run recorded in a worktree before corpora moved to the state
home, in a worktree that still exists. `git worktree list` names the worktrees,
and each one's run-log directory is listed by name, never opened. They are
counted, and no figure on this page includes them:

```
    trajectories recorded in other linked worktrees and not read: 5 across 2 worktrees — counted, never opened, in no figure below
```

When git cannot list the worktrees, or the home is not a repository, the line
says the trajectories `could not be counted` and gives the reason — never a
zero, because a scan that was not made did not find nothing. Nothing migrates
those files; the count is how they stay spoken about. The JSON carries
`stateHome`, `coverage.surfaces` and `coverage.unreadInLinkedWorktrees`, and the
HTML renders the same fields.

This is not preamble. `withReceipt` is the denominator behind every
receipt-derived indicator below, so when it reads 0 the correct finding is *the
receipt path has not fired* — not *the runs were clean*. `lib/outcomes.mjs` puts
the reason plainly: a corpus that read absence as cleanliness would flatter
exactly the runs it exists to explain.

### first-pass ship — source: receipt

The share of runs whose receipt reports the run did not halt **and** reports zero
remediation rounds.

Deliberately **not** called a CI success rate: no CI result is recorded in any
corpus, and borrowing the name would claim an observation nothing made. A receipt
that observed the halt state but not the remediation count is counted as *not
observed* and leaves the denominator short — reading that absence as zero rounds
would score the runs that died earliest as the cleanest.

### rework — two figures, never one

- **remediation rounds per run** (receipt) — with the full distribution, not only
  a mean, because a mean of 1.0 over `{0: 5, 4: 1}` describes nothing.
- **runs per change** (trajectory) — how many separate runs one change took. A
  change shipped in four attempts is rework no receipt can see.

They are not summed. One counts repair inside a run; the other counts runs
against one change. Runs attributed to `unnamed` are excluded from the per-change
tally and their share is stated.

### plan fidelity — three figures, and none may be read as another

- **plan-reuse status** (receipt) — the distribution over the `REUSE_*`
  vocabulary in `lib/plan-fingerprint.mjs`. A distribution, not a rate: the
  statuses are unordered, so there is no numerator.
- **plan revised mid-run** (trajectory) — the share of runs recording at least
  one wave action whose source is a replan. Counted per run, not per event.
- **does the merged diff match the plan** (receipt) — the share of paths a run
  **touched** that its executed plan **predicted**, pooled over paths across
  qualifying runs.

The third was published as a declared gap for as long as nothing recorded the
comparison. The receipt now records both halves: the paths the commit touched,
read from version control by `interlock paths touched` rather than reported by
the commit agent, and the paths the executed plan predicted, from
`interlock paths predicted`. The first two figures are still about the *plan*
and neither observes the *diff*, so neither is ever published under the third's
name — that restatement is what the old gap text existed to prevent.

The direction is fixed and stated on the figure: **touched paths are the
denominator.** The converse — predicted paths that were touched — answers a
different question (a plan that predicted work the run never did) and is not
published here.

A run contributes only when both sets were observed, the prediction was complete
and neither set was truncated. Every other run is **excluded and counted under
the reason it was excluded**: no commit was made, a set could not be read, the
plan did not predict for every task, or a set exceeded its bound. Path
prediction is optional per task by design, so a plan that declined to predict is
excluded rather than imputed as predicting nothing — imputing would depress the
share for a planner's silence and read as an implementer going off-plan. When
nothing qualifies, the share is unobserved with its reason, never zero.

If you run Interlock against your own product rather than developing it, the
consumer-facing version of all of this — what is checked, what is recorded, and
how to file a failure — is [14 — Evals](14-evals.md). The same page is where
Interlock's own eval layers and the rules for growing the suite live.

### review findings — two series, kept apart

- **from review metrics** — raised, dismissed, dropped by quality, surviving,
  plus a **dismissal share** where raised is non-zero. This is the trust
  evidence for adversarial review: how often a skeptic verified a finding away.
- **from receipts** — raised, surviving, blockers, warnings, plus a **survival
  share**. The receipt records what survived, not what was dismissed, so a
  dismissal share is not computed from it. Naming one would assert a count
  nothing wrote.

The two are never summed: different writers, different runs.

### gate exits non-zero — source: trajectory

How often each deterministic command exited non-zero, grouped by command. This
answers which gate actually stops runs. A command with no recorded exits is
absent from the group rather than reported as zero — an unexercised command and a
command that never failed are different facts.

This indicator and *plan revised mid-run* are the two derived from event types
that exist on runs with no receipt, which is why the report says something useful
before the receipt path has ever fired.

## Why it gates nothing

Decision §4.15(a) is that the recorded corpora inform a later decision and drive
no current one. `lib/outcomes.mjs` says it in its own header; `README.md` says it
in the Experimental section; and this command is where the temptation to break it
is strongest, because every value here is one comparison away from a threshold.

So the prohibition is a property, not a convention:

- **Always exits 0** — including when every indicator is unobserved, when a
  corpus is absent, and when files could not be read.
- **No verdict** — nothing is labelled pass, fail, blocked, healthy or degraded,
  and no value is compared against anything.
- **Nothing reads it** — no gate, readiness check, risk classification, autonomy
  record or workflow step consults the output. It is reachable by a human reader
  and by `/interlock:report`, which explains a census and is forbidden from
  recommending a change to any cap or gate on the strength of a figure.
- **Writes nothing** — not even a cache. The mitigation for a slow scan is
  `--since`, not an index.

Wiring a gate to these numbers is decision §4.16 / slice F6.6. It has not been
made. This command is the instrument that decision will need, not the decision.

## Reading it honestly

Three habits, in order of how often they are needed:

1. **Read the denominator before the value.** A rate over 3 observations is not a
   rate. Under roughly 20, say "too few to read" and name what would have to
   accumulate.
2. **Do not sum across provenance.** Check each indicator's `source`. A value a
   run measured and a value an agent reported are different kinds of evidence,
   and averaging them launders the second into the first.
3. **Answer a missing measurement with the measurement, not a proxy.** When an
   indicator is unobserved, the useful output is which recording would fix it.
   That sentence is usually worth more than every figure above it.

## Three surfaces, one object

`buildReport()` computes the report once. The text output, `--json` and
`--html` are three renderings of that one object — none of them recomputes,
re-derives or rounds an indicator differently, so no two of them can disagree
about a value or a denominator. A test renders one object to all three and
compares them figure by figure.

```bash
interlock report --html > report.html
interlock report --html docs/report.html
```

`--html` writes one self-contained document: no stylesheet, script, font or
image is fetched, so it opens with no network and can be attached to an issue or
handed to someone without the repo. Bare, it writes to stdout; given a path, it
writes only there, and an unwritable destination is reported without leaving a
partial file behind. It is mutually exclusive with `--json` — passing both is
refused rather than one silently winning.

**It is a generated file, not a service, and it issues no verdict.** There is no
server, port, daemon or watch mode, because the value here is reading
accumulated history rather than watching live state — and because nothing in the
loop may read the report, which a file a human opens honours structurally while
a service invites a fetch. The document draws no threshold, target, goal line,
trend arrow or pass/fail label, and no colour on it encodes health; colour and
weight carry structure and reading order only.

The constraint that took the most care is the one a dashboard gets wrong by
default: an unobserved indicator renders at the same visual weight as one
carrying a number, with the report's reason as the cell's content. Never a zero,
never a dash, never a greyed row, never collapsed behind an interaction. Every
one of those idioms translates *"we never measured this"* into *"this measured
zero"*, and on these corpora that mistranslation would be near-total.

## Operational notes

- The trajectory scan is bounded; the cap is published by `interlock limits` and
  truncation is reported in the output rather than sampled silently.
- Metrics files are classified by their `schema` key, never by filename.
  `skills/review-artifacts` writes `review-artifacts-<change>-<stamp>.json` into
  the same directory, which the glob `review-*.json` also matches while carrying
  finding bodies instead of counts. Unrecognized shapes are named and excluded.
- A torn final line costs that one record and no more, in every corpus. An
  append-only log truncated by a crash is expected, not exceptional.
- The command is offline: no model, no network.
