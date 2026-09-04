---
name: report
description: Read the indicator report over Interlock's three recorded corpora — outcome records, run trajectories, review metrics — and say what it does and does not license. Use when someone asks how the loop is actually performing, whether continuity is working, how often review findings survive, which gate blocks most, or whether there is yet enough evidence to change a cap or a gate. The figures come from `interlock report`, never from your own counting; the judgement you add is about denominators, not about thresholds.
license: MIT
compatibility: Node.js >= 18 and the bundled interlock CLI. Offline — no model, no network, and nothing is written.
allowed-tools: Bash(interlock *) Read Grep Glob
metadata:
  type: reading
  outputs:
    - a written reading of the census, with what each figure licenses
---

`interlock report` computes the numbers. You do not. Your job is the sentence
that stops a number being misused — which is almost always a sentence about its
denominator.

## 1. Get the report

```
interlock report --json
```

Add `--since <iso>` for a window and `--change <name>` for one change. The
command always exits 0: it gates nothing, and per §4.15(a) nothing in the loop
reads its output. If you find yourself wanting an exit code, you have started
designing a gate — that is decision §4.16 / slice F6.6 and it has not been made.

Never recompute a figure by hand. If a number you need is absent, the corpus did
not record it; say that instead of deriving a substitute from something nearby.

When someone wants to *look* at the corpora rather than have them read to them:

```
interlock report --html > report.html
```

This renders the same report object as one self-contained HTML document — no
stylesheet, script or font is fetched, so it opens offline and can be attached
to an issue. It is **a generated file, not a service**: there is no server, no
port and no watch mode to start, and nothing in the loop reads it. It is also
**not a verdict**, and gains none by being visual: it draws no threshold, target
or trend, no colour on it encodes health, and an unobserved indicator renders as
`UNOBSERVED` with its reason at the same weight as a figure. Bare it writes to
stdout; given a path it writes only there. It cannot be combined with `--json`.

Handing someone the document does not discharge your job. The reading below is
still yours to write — the page reports, and reporting is not interpretation.

## 2. Read coverage first, and let it govern everything after it

The `coverage` group is not preamble. It decides whether any indicator below it
means anything:

- `trajectories.withReceipt` is the denominator behind **every**
  receipt-derived indicator — first-pass ship, remediation rounds, plan-reuse
  status, the receipt finding series. If it is 0, all of those are unobserved,
  and the finding to report is *that the receipt path has not fired*, not that
  the runs were clean.
- `outcomes.exists: false` means no ship run has recorded an outcome at all. The
  continuity question — should the human checkpoint have been skipped — is then
  unanswerable, and no amount of trajectory data substitutes, because the
  trajectories hold no human judgement.
- `metrics.unrecognized` names files that reached no indicator. That is normal:
  `skills/review-artifacts` and `skills/fix-tests` both write into
  `.claude/metrics/` in their own shapes. Report the count; do not treat an
  unrecognized file as a missing one.
- `trajectories.truncated` means the scan hit its cap. Narrow with `--since`
  before reading any rate, or say the rate covers only the most recent files.

## 3. State what each figure licenses

For every indicator you present, give the value, the denominator, and one
sentence on what it supports. The pattern:

> **first-pass ship** — unobserved, 0 receipts. Licenses nothing. Would become
> readable once ship runs write receipts; the trajectories on disk predate that
> event type.

> **gate exits non-zero** — 12.6% of 1 785 recorded exits, and 150 of the 225
> are `wave-state record-batch`. Licenses a claim about which gate stops a run
> most often. Licenses no claim about whether stopping was correct.

Three rules hold without exception:

1. **A denominator under ~20 licenses no trend.** Say "too few to read", name
   what would have to accumulate, and stop. Do not soften it into a provisional
   reading.
2. **Never sum across provenance.** `fromMetrics` and `fromReceipts` are
   different writers over different runs; the report keeps them apart and so do
   you. The same rule separates a value a run *observed* from one an agent
   *reported* — check each indicator's `source`.
3. **`diffMatchesPlan` is computed one way only, and the other two plan figures
   are not it.** It is the share of paths a run TOUCHED that its plan predicted
   — read `direction` and quote it. Do not answer "does the merged diff match
   the plan" with `planStatus` or with the mid-run revision rate: both are about
   the plan, neither observes the diff. Read `excluded` before reading the
   figure: a share over three qualifying runs while forty were excluded for a
   recording gap is a fact about the recording, and saying so is the reading.

## 4. Do not recommend a gate

You may report a figure, name its denominator, and name what would have to be
recorded for it to mean more. You may not recommend that a cap be raised, a
threshold be set, a band be adjusted, or a gate be relaxed or tightened on the
evidence of a figure — not even when the figure looks decisive, and not even
when asked directly. The corpora exist to inform §4.16 later; converting them
into a recommendation now is the decision that has not been made.

If asked for a recommendation, answer with the evidence that is missing.

## 5. Report the caps rather than restating them

The scan bound comes from `interlock limits`, not from a number typed here. Cite
the command.

## Output

A short written reading: the coverage headline, then each indicator with its
value, denominator, and what it licenses. Close with the single most valuable
missing measurement — the one whose absence blocks the most indicators. That
sentence is usually the most useful thing in the report.
