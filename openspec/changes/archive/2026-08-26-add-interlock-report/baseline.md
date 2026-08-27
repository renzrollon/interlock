# Baseline — add-interlock-report

First run of `interlock report` against this repository, 2026-08-26. Recorded as
the change's baseline per task 3.1. **No threshold is tuned from these figures**,
and nothing below is a verdict.

Offline verification: `npm test` — 1 202 pass, 0 fail, 1 pre-existing skip.
`claude plugin validate . --strict` — passed.

## Coverage

| | |
|---|---|
| trajectories on disk | 740 (all scanned; the cap was not reached) |
| with a `run-start` | 2 |
| with a terminal event | 0 |
| **with a `run-receipt`** | **0** |
| outcome corpus | **absent** — `.claude/learning/outcomes.jsonl` does not exist |
| review-metrics files recognized | 0 of 3 |

The three metrics files were all written by skills in their own shapes and are
correctly excluded: two `review-artifacts-*.json` (finding bodies, no `schema`
key) and one `fix-tests-*.json`.

## Indicators

| indicator | source | value |
|---|---|---|
| first-pass ship | receipt | unobserved — no run has written a receipt |
| remediation rounds / run | receipt | unobserved |
| runs per change | trajectory | 1.0 over 2 attributed runs; 738 excluded as `unnamed` |
| plan-reuse status | receipt | unobserved |
| plan revised mid-run | trajectory | **20.5%** of 740 |
| diff matches plan | — | **not computable**, by declaration |
| review findings (metrics) | review-metrics | unobserved — no recognized file |
| review findings (receipts) | receipt | unobserved |
| gate exits non-zero | trajectory | **12.6%** of 1 812 recorded exits |

Non-zero exits by command: `wave-state record-batch` 152 of 422,
`wave-state next` 76 of 358, and zero for `create`, `record-verify` and
`replan`. The 152 record-batch halts and the 152 `replan` wave actions are the
same number, which is the coherent story — a batch that halts is followed by a
replan — and is the one substantive thing this corpus currently supports.

## What this baseline licenses

Almost nothing, and saying so is the point.

- **Every receipt-derived indicator is unobserved** because the `run-receipt`
  event type has never once been written, across 740 trajectories. The receipt
  landed in `b95c545` / `feefa1c`; no run has closed since. The single most
  valuable missing measurement is a receipt from a real ship run.
- **The continuity question is unanswerable.** With no outcome corpus at all,
  there is no evidence either way about whether skipping the human checkpoint
  was ever the right call — and the trajectories cannot substitute, because they
  hold no human judgement.
- **The two computable rates rest on a polluted denominator.** See below.

## Finding: the trajectory corpus is mostly test artifacts

Discovered by this command on its first run, and recorded here because a baseline
that presented 740 test invocations as 740 ship runs would be exactly the
misreading this change exists to prevent.

`test/spine/cli.test.mjs`'s `run()` helper (lines 25–32) spawns `bin/interlock`
with no `cwd` and no `--root`, so `root` defaults to `.` — the repository — and
every `wave-state` call in the suite that omits an explicit `--root` appends a
real trajectory into `.claude/ship/runs/`. The directory grew from 729 to 740
files across one `npm test` run, and every added file carries
`change: "unnamed"`.

So the 738 unattributed runs are not runs. The `12.6%` non-zero exit share and
the `20.5%` mid-run revision share are measured over a population that is
overwhelmingly test invocations, and neither figure describes production
behaviour. `.claude/ship/` is gitignored, which is why this had never surfaced.

The reader is behaving correctly — it reports what the corpus contains and
labels the unattributed share rather than hiding it. The corpus is what is wrong.
Fixing the test helper is out of scope for this change and is filed separately;
the existing polluted files are deliberately left in place, since deleting a
corpus this command reads is the repository owner's call.

## Not tuned

No cap, band, threshold or gate was changed on the strength of any figure above.
Per §4.15(a) and `specs/report/non-gating/spec.md`, nothing in the loop reads
this output, and §4.16 / F6.6 remains unmade.
