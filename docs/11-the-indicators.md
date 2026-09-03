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

## The indicators

Every indicator carries `source`, `value`, `observedOf` (the denominator) and
`notObserved`. When `observedOf` is 0, `value` is `null` and `reason` says why.
It is never `0`.

### Coverage — printed first, and it governs the rest

How many trajectories exist, how many carry a `run-start`, a terminal event, and
a **receipt**; how many outcome records exist by mode; how many metrics files
were recognized.

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

### plan fidelity — two recorded figures and one declared gap

- **plan-reuse status** (receipt) — the distribution over the `REUSE_*`
  vocabulary in `lib/plan-fingerprint.mjs`. A distribution, not a rate: the
  statuses are unordered, so there is no numerator.
- **plan revised mid-run** (trajectory) — the share of runs recording at least
  one wave action whose source is a replan. Counted per run, not per event.
- **does the merged diff match the plan** — **`computable: false`.**

That last one is the playbook's sharpest indicator and nothing records the
comparison. The two figures above are both about the *plan*; neither observes the
*diff*. Publishing either under that name would be a restatement defect, so the
report states the gap and what would close it: a receipt field pairing the plan
fingerprint with the paths the commit actually touched.

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
