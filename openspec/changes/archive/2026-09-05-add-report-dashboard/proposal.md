## Why

`interlock report` already computes every indicator a dashboard would show, but on this repo it answers `unobserved` or `NOT COMPUTABLE` for almost all of them. The cause is not missing machinery — it is machinery nobody invokes.

**The review-metrics writer exists and is never asked to run.** `interlock review --metrics <change>` calls `writeReviewMetrics` and writes exactly the schema the report recognizes. But `skills/review-code/SKILL.md:95` invokes `interlock review` *without* `--metrics`, and `skills/review-artifacts/SKILL.md:122` invokes `interlock gate`, which has no `--metrics` flag at all. So the emission is an opt-in flag that no caller on any review path has ever passed: 0 of 5 metrics files are recognized, and the dismissal-share indicator is structurally unobservable. This is not a new diagnosis — the archived `2026-08-26-add-interlock-report` proposal recorded the same zero, and it has stayed zero since, which is what an optional flag does.

**The trajectory corpus is 99.75% test exhaust.** `test/spine/cli.test.mjs:26` spawns the real binary with neither `cwd` nor `--root`, so the CLI's default root resolves to the repository and every `wave-state create` in the suite lands in the live corpus. Reproduced below at +11 files from one test file; the corpus now stands at 5690 of 5704 events attributed to `change: "unnamed"`, against 14 events from two real changes.

So the *reading* surface is genuinely the missing piece, but building it first would have rendered an honest and almost entirely empty page. Make emission unskippable, stop the tests poisoning the well, then give the corpora a surface a person can scan: one self-contained HTML file, no server, no daemon, no dependency.

**Reproduction (both defects, on this repo):**

```
$ ls .claude/ship/runs/*.jsonl | wc -l          # 971
$ node --test test/spine/cli.test.mjs           # writes into the live corpus
$ ls .claude/ship/runs/*.jsonl | wc -l          # 982   (+11, all change:"unnamed")

$ interlock report
  review metrics    0 recognized of 5 file(s)
    not counted     review-code-feat-interlock-report-20260827-131200.json (no schema key)
    ... (4 more)
  review findings   from 0 metrics file(s): 0 raised, 0 dismissed, 0 dropped, 0 surviving
                    dismissal share: unobserved (no review-metrics file was recognized)
```

## What Changes

- **`interlock gate` gains `--metrics <change>`, mirroring `interlock review`.** The gate already computes exactly the counts the report wants (raised, dismissed, dropped by the tolerance band, surviving) and currently discards them. It gains the same bookkeeping call `review` already makes — reported on failure, never affecting the verdict or the exit status.
- **Both review skills pass the flag, and a test pins them.** `skills/review-code/SKILL.md:95` and `skills/review-artifacts/SKILL.md:122` are updated to request metrics, and `test/skills.test.mjs` — which already asserts on documented skill command lines — gains an assertion that fails if either skill drops it. An opt-in flag that nobody passes is the defect being fixed; a test is what stops it recurring.
- **The metrics recognizer is left alone.** `openspec/specs/report/corpus-reading/spec.md` *requires* that a skill-written findings file with no recognized schema be excluded. The gap is an uninvoked writer, not a strict reader, so the fix is upstream and that spec is untouched.
- **`interlock report --html` renders one self-contained HTML document.** Single file, inline CSS and SVG, no network fetches, no bundler, no runtime dependency, written to a caller-named path (or stdout). It renders the same `buildReport()` object `--json` returns, so the three surfaces cannot disagree.
- **The HTML surface inherits the non-gating rule.** It states `unobserved` and `NOT COMPUTABLE` as prominently as it states a number, and never renders a threshold, a target, a pass/fail colour, or a trend arrow. Exit status stays 0 regardless of content.
- **The CLI test suite stops writing into the repository.** `test/spine/cli.test.mjs` (and any sibling with the same shape) pins a temporary root, and the 971 accumulated `unnamed` trajectories are purged once so the corpus starts honest.

**Not in scope** — deliberately, see `decisions.md` D-04: session browsing and cross-session analytics over `~/.claude/projects/` (1276 transcripts, 482 MB here). Claude Code Desktop already lists and searches sessions, and the `agent-insights` skill already mines that corpus. The interlock-shaped slice is a `runId` ↔ `sessionId` join so "which session shipped this change" becomes answerable, and it is recorded as a follow-on rather than built here.

## Capabilities

### New Capabilities
- `review/metrics-emission`: the deterministic gate emits a schema-carrying review-metrics record as a side effect of evaluating findings, without that emission being able to change the gate's verdict, its exit status, or its output.
- `report/html-surface`: a self-contained single-file HTML rendering of a report, derived from the same report object as the text and JSON surfaces, carrying the non-gating guarantees into a visual medium.

### Modified Capabilities
<!-- None. `report/corpus-reading` and `report/indicators` keep their current
     requirements exactly: the recognizer's strictness is the specified
     behaviour and the indicators' arithmetic does not change. This change
     supplies data the existing requirements already describe how to read. -->

## Impact

- **Code**: `bin/interlock` (the `gate` and `report` cases); new `lib/report-html.mjs`; `skills/review-code/SKILL.md` and `skills/review-artifacts/SKILL.md` (one command line each); `test/spine/cli.test.mjs` and any sibling spawning the binary without a pinned root; `test/skills.test.mjs`; new tests for both capabilities.
- **Not touched**: `lib/report.mjs` (the indicator arithmetic and the recognizer are correct as specified), `lib/findings.mjs`, `lib/metrics.mjs` (the writer already exists, is tested, and needs no change — only callers).
- **Docs to correct**: `docs/11-the-indicators.md:24` names `interlock review --metrics` as the review-metrics writer without noting that no skill passes it; it should name both entry points once `gate` has the flag.
- **Dependencies**: none added. The HTML is hand-emitted from a template function; no charting library, no server, no build step.
- **Data**: a one-time purge of `.claude/ship/runs/` on this repo. The directory is gitignored, per-machine, and holds no committed state, so the purge is local and reversible only by re-accumulation — which is the point.
- **Contract**: `interlock report --html` is additive. `report`, `report --json`, and the gate's existing stdout/exit behaviour are unchanged.
