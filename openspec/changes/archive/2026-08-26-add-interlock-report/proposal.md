## Why

Interlock writes three corpora and reads none of them.

`lib/outcomes.mjs` says so in its own header: per decision §4.15(a) it "records and nothing else", and its README tells anyone wiring a gate to it that they are implementing a decision nobody made. `README.md:230` repeats the promise — "nothing reads either to change what the workflow does". `lib/run-log.mjs` accumulates a trajectory per ship run. `lib/metrics.mjs` writes a review's counts. All three are write-only.

That was the correct call for gating. It is the wrong call for *reading*. The ladder in §4.16 / F6.6 is waiting on evidence, and the evidence is accumulating unread — so the question "should we have skipped the human that time?" stays unanswerable not because the data is absent but because nothing computes over it.

A census of this repository, taken while authoring this change, shows how far the corpora are from answering it:

| corpus | on disk | usable for the question |
|---|---|---|
| `.claude/learning/outcomes.jsonl` | **absent** — 0 records | nothing |
| `.claude/ship/runs/*.jsonl` | 729 trajectories, 4 296 events | 1 785 `wave-action`, 1 785 `cli-exit`, 724 `agent-spawn`, **2** `run-start`, **0** `run-complete`, **0** `run-halt`, **0** `run-receipt` |
| `.claude/metrics/*.json` | 3 files | **0** carrying `interlock.review-metrics/1`; 2 written by `skills/review-artifacts` with finding bodies, 1 by `skills/fix-tests` |
| change attribution | 4 296 events | 4 282 read `change: "unnamed"`; 14 name a change |

The right response to that table is not to wait until it improves. It is to build the reader that prints it, because a corpus nobody can read is a corpus nobody notices is empty. Every figure above was obtained by hand-rolling `grep | sort | uniq -c` over 729 files — which is precisely the re-derivation `bin/interlock` exists to abolish.

## What Changes

- Add `lib/report.mjs`: a pure-ish reader that computes indicators over the three corpora and reports each one's **denominator alongside its value**. Read-only, never throws, and an unobserved value is reported unobserved — never floored to a clean one.
- Wire `interlock report [--json] [--since <iso>] [--change <name>]` into `bin/interlock`, with its `USAGE` entry and its exit code documented as **always 0**.
- Compute six indicator groups: corpus coverage, first-pass ship rate, rework, plan fidelity, review findings, and deterministic-gate exit health. Each names its source corpus and what it could not observe.
- State one indicator as **explicitly not computable**: the playbook's "does the merged diff still match the plan" needs a diff↔plan comparison nothing records. It is reported as a named gap with the reason, not approximated by a nearby number.
- Publish the reader's caps through `interlock limits` (`lib/limits.mjs`), so no scan bound is restated in prose.
- Add `skills/report/SKILL.md` — reading a corpus census and saying what it does and does not license is judgement work; computing it is not.
- Add `docs/11-the-indicators.md`: each indicator, its denominator, and why the command deliberately gates nothing.
- Amend `README.md:230` so its promise stays true and precise: `interlock report` reads all three corpora and still changes nothing about what the workflow does.

Not included, and deliberately: no threshold, no verdict, no exit code, and no feedback into `ready`, `risk`, `gate` or `autonomy`. §4.16 / F6.6 remains unmade. This change builds the instrument, not the decision.

## Capabilities

### New Capabilities
- `report/indicators`: which indicators exist, how each is defined, which corpus each is derived from, and which one is declared uncomputable rather than approximated.
- `report/corpus-reading`: how the three corpora are read — schema branching over filename globbing, torn-line tolerance, scan caps, denominators, and the rule that a reader must never throw.
- `report/non-gating`: the exit status, the absence of verdicts, and the standing prohibition on any gate reading this output.

### Modified Capabilities
<!-- None. The report observes the corpora; it does not change what writes them,
     and it adds no requirement to any existing capability. -->

## Impact

- **New files:** `lib/report.mjs`, `test/spine/report.test.mjs`, `skills/report/SKILL.md`, `docs/11-the-indicators.md`.
- **Modified:** `bin/interlock` (the `report` subcommand, its `USAGE` entry, and its line in the exit-code table), `lib/limits.mjs` (publish the scan caps), `README.md` (docs table row; the `:230` precision fix).
- **Reused, not reimplemented:** `readOutcomes` (`lib/outcomes.mjs`) already tolerates a torn final line and returns `skipped`; `listRunLogs` / `readRunLog` / `queryRunLog` / `checkRunLog` (`lib/run-log.mjs`) already enumerate and validate trajectories; the `REUSE_*` vocabulary in `lib/plan-fingerprint.mjs` is the `planStatus` value set. The reader adds arithmetic over these, not new I/O paths.
- **Mechanical trap:** `.claude/metrics/` is heterogeneous. `lib/metrics.mjs:91` writes `review-<change>-<stamp>.json`, and `skills/review-artifacts/SKILL.md:104` writes `review-artifacts-<change>-<stamp>.json` — **which the glob `review-*.json` also matches**, and which carries full finding bodies rather than counts. A filename-glob reader would silently mix a skill's prose into a counts indicator. The reader branches on the `schema` key and names unrecognized shapes as uncounted.
- **`test/skills.test.mjs` needs no edit** — the new skill enters its existing structural gate automatically and must satisfy the frontmatter allowlist, the name-matches-directory rule, and the description-length window.
- **No new dependency.** Offline, filesystem-only, no model, no network.
