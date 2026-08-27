## Context

Three write-only corpora, one missing reader.

- `lib/outcomes.mjs` — one line per planning→ship attempt, partitioned `observed` (from the run receipt) / `reported` (from an agent). `readOutcomes` and `formatOutcomes` exist, but `formatOutcomes` is a census of record counts by mode, not an indicator.
- `lib/run-log.mjs` — one JSONL trajectory per run, eight event types. The `run-receipt` event carries almost everything an indicator wants: `remediationRounds`, `reviewRaised/Surviving/Blockers/Warnings`, `planReused/planStatus/planReason`, `halted/haltReason`, `committed/commit`, `spend`, `degradations`.
- `lib/metrics.mjs` — a review's four counts, `schema: interlock.review-metrics/1`.

The reason this is worth building now rather than after the corpora fill: the census taken while authoring this change (see `proposal.md`) found the receipt path has never once fired, and 4 282 of 4 296 trajectory events are attributed to `change: "unnamed"`. Neither fact was known to anyone. A reader would have surfaced both on its first run.

## Goals / Non-Goals

**Goals**

- Compute the indicators §4.16 will need, from what is on disk, honestly.
- Make an empty or thin corpus *legible as thin* rather than as clean.
- Carry `lib/outcomes.mjs`'s observed/reported partition through to the printed output, so a reader can tell per figure whether a run measured it or an agent said it.
- Reuse the existing readers. No new file-walking, no new JSONL parser.

**Non-Goals**

- No gate, no threshold, no verdict, no non-zero exit. §4.16 / F6.6 stays unmade.
- No writing. The report creates no file, not even a cache.
- No approximation of an indicator the corpora cannot support.
- No model and no network — the same constraint `lib/evals-triage.mjs` carries.

## Decisions

### D1 — Read all three corpora, label every figure's provenance

The alternative — outcomes only — is the tighter contract, and it prints nothing in this repository. Reading all three costs one extra reader each and gains the only indicators with data today (`cli-exit` health, replan rate). The cost is that a reader must be able to tell an observed figure from a reported one and from a skill-written one, which is exactly what `lib/outcomes.mjs` already partitions for. So the partition is carried forward rather than reinvented: every indicator declares `source` (`receipt` | `outcome.observed` | `outcome.reported` | `trajectory` | `review-metrics`) and every group declares its denominator.

### D2 — Denominator beside value, always

An indicator printed as a bare rate over an unstated denominator is the specific failure `lib/doctor.mjs` names ("an unknown is not a pass") and `lib/outcomes.mjs` names ("a biased control group is worse than none, because it looks like evidence"). So `firstPassRate` is never emitted alone: it travels with `observedOf` and `notObserved` counts, and when the denominator is zero the value is `null` with a `reason`, never `0`.

### D3 — Corpus coverage is the first indicator, not an appendix

The report leads with what the corpora can and cannot answer: trajectories total, how many carry a `run-start`, a terminal event, a receipt; outcome records by mode; metrics files by recognized schema. On this repository that section reads "0 of 729 trajectories carry a receipt", which is the honest headline and makes every subsequent `null` self-explaining.

### D4 — Branch on `schema`, never on a filename glob

`.claude/metrics/` holds three shapes from three writers, and `review-artifacts-*.json` matches the glob `review-*.json` while carrying finding bodies rather than counts. A glob reader would mix a skill's prose into a counts indicator and no test would notice. Files are classified by their `schema` key; anything unrecognized is counted as `unrecognized` with its basename and excluded from every indicator.

### D5 — One indicator is declared uncomputable

"Does the merged diff still match the plan" is the playbook's sharpest indicator and nothing records the comparison. The near-miss candidates are `planStatus` (whether the *stored plan* was reused, which is about planning inputs, not about the diff) and the replan rate (whether the plan changed mid-run, which is not whether the diff matched it). Reporting either under that name would be the restatement defect the artifact review already flagged once in `add-interlock-evals`. So `planFidelity.diffMatchesPlan` is emitted as `{ computable: false, reason, wouldRequire }` — a named gap, with what would close it.

### D6 — Replan rate and gate-exit health earn their place on data, not on theory

They are the two indicators with dense data today: 150 of 1 785 `wave-action` events carry `source: "replan"`, and 225 of 1 785 `cli-exit` events carry a non-zero status. Neither is in the playbook's list. Both answer a real question — which deterministic gate actually blocks, and how often a plan does not survive its own run — from events that already exist. Including them is what makes the command useful before the receipt path fires.

### D7 — Exit 0, always, and say so in three places

`interlock drift` and `interlock conformance` are the precedent: report, never block, with the reason in the module header. The report goes further because the temptation here is stronger — a rate is one `if` away from a threshold. So the prohibition is stated in `lib/report.mjs`'s header, in the `USAGE` exit-code table, and as a requirement in `specs/report/non-gating/spec.md`, and the spine test asserts the exit status is 0 even when every indicator is null.

### D8 — Bounded scan, published cap

729 trajectories today, unbounded tomorrow. The reader caps how many it opens and reports truncation explicitly rather than silently sampling — `no silent caps`. The bound is published through `interlock limits` alongside the existing caps, per the `add-interlock-evals` D14 precedent, so no number is restated in prose.

### D9 — `--since` and `--change`, no other filters

"Trending toward zero" needs a window, and per-change attribution is the corpus's own key. Everything else a reader might want is available from `--json`. Adding filters the indicators do not need would grow a query language nobody asked for.

### D10 — A skill, because reading a census is judgement

Computing `dismissed/raised` is arithmetic and belongs in `lib/`. Saying "0 of 729 receipts means this licenses no conclusion about continuity, and the fix is that the receipt path has never fired" is judgement, and it is the sentence that stops the number being misused. The skill explains the report; it never recomputes a figure, and it never converts one into a recommendation about a gate.

## Risks / Trade-offs

- **The report will be read as a scorecard.** Mitigated by D2, D3 and D7, and by the skill's contract — but not eliminated. A human who wants a threshold can compute one from `--json`. What this change guarantees is that Interlock itself does not.
- **Reading 729 files on every invocation.** Local, offline, ~4 MB; bounded by D8. If it becomes slow the fix is an explicit `--since` default, not a cache — a cache is a write, and this command does not write.
- **Indicator definitions will want to change** as the corpora fill. They are versioned by a `REPORT_SCHEMA` constant on the JSON output, the same way every other payload in this repo is, so a later definition change is legible rather than silent.
- **`change: "unnamed"` makes per-change indicators nearly empty.** That is a finding, not a defect in the reader: `a8e0db5 fix(ship-run): carry the change name on the run state` landed on the current branch, so the 14 attributed events are the post-fix ones. The report states the attributed share rather than hiding it in a denominator.

## Migration Plan

Additive. No existing corpus, writer, gate or skill changes behaviour. `README.md:230`'s promise is amended for precision, not weakened — it still says nothing reads these corpora *to change what the workflow does*.

## Open Questions

None blocking. Whether any indicator ever becomes gating is §4.16 / F6.6 and is out of scope by construction.
