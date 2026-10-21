## Context

See `proposal.md — Why` for motivation and the reproduction. The design-relevant state:

- `lib/report.mjs:590` `buildReport()` already returns a complete, serializable report object; `formatReport()` renders it to text and `--json` emits it directly. A third renderer is additive and needs no new computation.
- `lib/report.mjs:280` classifies a metrics file strictly by `parsed.schema !== REVIEW_METRICS_SCHEMA`. `openspec/specs/report/corpus-reading/spec.md` requires that strictness by name, in the scenario *"A skill-written file with a matching filename prefix is excluded"*.
- `lib/metrics.mjs:66` `writeReviewMetrics` already returns `{written, path, reason}` and never throws — the non-gating bookkeeping contract this change needs already exists.
- `bin/interlock` `case 'review'` already implements `--metrics <change>` correctly, including `die('--metrics requires a change name')` on a valueless flag and `warn(...)` on a failed write. `case 'gate'` has no equivalent.
- `test/skills.test.mjs:195` already asserts on a documented skill command line (`/interlock wave-state/`), so pinning a skill's flag is an established pattern here, not a new one.
- `package.json` declares no `dependencies` at all. The repo is dependency-free and every artifact is hand-emitted.

## Goals / Non-Goals

**Goals:**
- Make review-metrics emission reachable from both gated review paths, and make its omission a test failure rather than a silent zero.
- Give the corpora a scannable visual surface that cannot disagree with the text and JSON surfaces, and cannot acquire a verdict by virtue of being visual.
- Leave the trajectory corpus measuring the loop rather than the test suite.

**Non-Goals:**
- No live monitoring. A ship run is minutes long and already prints stage lines; a streaming view would be substantial machinery for a progress bar (D5).
- No server, daemon, port, or watch mode (D3).
- No charting dependency, and no charting beyond what inline SVG does in a few lines (D6).
- No change to indicator arithmetic, to the recognizer, or to what the report is permitted to claim.
- No session browsing or cross-session analytics (D7).

## Decisions

### D1 — Fix the writer path, not the reader

**Chosen:** leave `lib/report.mjs`'s recognizer strict and make the review paths emit a conforming record.

The tempting alternative is to teach the report to derive counts from the skill-written findings files already sitting in `.claude/metrics/` — it would make all five existing files count immediately, with no skill changes. It is rejected because `openspec/specs/report/corpus-reading/spec.md` has a scenario requiring exactly the opposite, and because those files carry full finding *bodies*: recognizing them would route finding text into an indicator corpus that `lib/metrics.mjs:19` deliberately keeps free of it. A reader loosened to admit prose is a worse instrument than an empty one.

### D2 — Mirror the existing flag onto `gate`; pin the skills with a test

**Chosen:** `gate` gains `--metrics <change>` with semantics copied from `review`; both review skills pass it; `test/skills.test.mjs` asserts both command lines carry it.

Two alternatives were considered and rejected:

- *Only update the skills' command lines.* Minimal, but leaves `gate` unable to emit at all, so `review-artifacts` — the gate-only path — stays permanently unobservable.
- *Make emission default-on whenever a change name is derivable.* Robust against a future caller forgetting, but it changes `review`'s existing behaviour for every ad-hoc CLI invocation, and it needs a change name the gate does not otherwise have. Inferring one from the findings file's path is exactly the guess `review/metrics-emission` forbids.

The test is what carries the robustness the default-on option was reaching for, at no behavioural cost. It also encodes the actual lesson: this defect is a year of a flag existing and nobody passing it, and only an assertion notices that.

### D3 — A generated file, not a served application

**Chosen:** `interlock report --html [path]` writes one self-contained document; the reader opens it.

A local web server or TUI was considered. Both are rejected on the same ground: the value here is reading accumulated history, not watching live state, and a served app buys interactivity the data does not need while adding a process to start, a port to collide, a lifecycle to manage, and a runtime the repo currently does not have. `openspec/specs/report/non-gating/spec.md` also requires that nothing in the loop read the report — a file a human opens honours that structurally; a service invites a fetch.

The file also composes: it can be committed to an issue, attached to a PR, or handed to someone without the repo.

### D4 — Rendering is a pure function of the report object

**Chosen:** `lib/report-html.mjs` exports a renderer taking the `buildReport()` result and returning a string. It performs no I/O, reads no corpus, and computes no indicator.

This is what makes *"the three surfaces cannot disagree"* testable rather than aspirational: the test renders one object to all three surfaces and compares values. It also keeps `bin/interlock`'s `report` case a one-line branch, and keeps the renderer trivially unit-testable without a corpus on disk.

### D5 — Absence is a first-class rendering case, not a fallback

**Chosen:** unobserved and not-computable indicators render at full weight, carrying their reason.

This is the single most important design constraint, and it is the one a conventional dashboard gets wrong by default. Every dashboard idiom — the empty state, the grey cell, the zero, the sparkline that flatlines — converts *"we never measured this"* into *"this measured zero"*. On this corpus that mistranslation would be near-total: the honest reading of `interlock report` today is that almost nothing has been observed, and a surface that renders it as a wall of zeroes would be actively misleading. The renderer therefore treats a reason string as content, not as a placeholder.

### D6 — Graphics only where a shape beats a number

**Chosen:** inline SVG, hand-emitted, only for the per-command gate-exit distribution and the coverage proportions. Everything else is a table.

No dependency is added (`package.json` has none), and no chart is drawn for a figure a number already states. A bar needs no library; a library needs a bundler, and a bundler needs a build step this repo does not have.

### D7 — Session organization is out of scope, and mostly not this project's job

**Chosen:** record the follow-on, build nothing.

`~/.claude/projects/` holds 1276 transcripts across 10 projects (482 MB) on this machine, so the corpus is real. But Claude Code Desktop already lists and searches sessions, and the `agent-insights` skill already mines exactly this corpus for cross-tool usage reporting. Duplicating either inside interlock would be a second-rate copy of a solved problem, and it would pull interlock's scope from *the spec-driven loop* to *the whole agent workspace*.

The slice that is genuinely interlock-shaped is narrow: a `runId` ↔ session join, so *"which session shipped this change"* is answerable from a receipt. That needs a session identifier on the run-start event, which needs the workflow host to expose one — a question this change does not need to answer to be useful, so it is deferred rather than guessed.

### D8 — Purge the polluted trajectories rather than filter them at read time

**Chosen:** delete the accumulated `unnamed` run files once, as part of landing the test-isolation fix.

Filtering `change: "unnamed"` at read time was considered and rejected: `report` already reports unattributed runs as a first-class figure (*"969 run(s) attributed to 'unnamed' and excluded"*), so a read-time filter would hide a real signal — a genuine ship run that failed to carry its change name should still be visible as unattributed. The pollution is a writer defect, and the fix belongs at the writer.

The purge loses 14 events from two real changes alongside 5690 of exhaust. That is an acceptable trade at this ratio, and the directory is gitignored, per-machine, and holds no committed state — but it is a deletion of the only trajectory history that exists, so it is called out here rather than performed quietly.

### D9 — Default to stdout; write a file only when a path is named

**Chosen:** `interlock report --html` writes the document to stdout; `--html <path>` writes it there.

`report/html-surface` requires that the command "writes only to the destination the caller named". A default path — `.claude/report.html` would be the discoverable choice — makes an invocation write to disk unasked, which is a poor default for a command whose sibling surfaces are pure readers. Stdout composes (`interlock report --html > report.html`) and keeps the no-surprise-writes property that the rest of `report` already has.

### D10 — `--html` and `--json` are mutually exclusive

**Chosen:** passing both is refused with a message, rather than one silently winning.

`bin/interlock` threads a single `json` flag into a shared `emit(json, obj, text)` helper, so a silent precedence rule would be invisible at the call site and would differ from every other subcommand. Refusing is one line and cannot be misread.

## Risks / Trade-offs

- **The purge destroys the only real trajectory data (14 events, 2 changes)** → the ratio is 400:1 against them and the corpus regenerates from the next ship run. The task moves the directory aside rather than `rm -rf`, so the old corpus survives one session for anyone who wants it.
- **A hand-emitted HTML string is an injection surface** → every interpolated value is escaped at a single choke point in the renderer, and a test asserts that a corpus file named with angle brackets and a `<script>` tag renders inert. Corpus content is untrusted input: file names and reason strings come from disk.
- **A second renderer can drift from `formatReport`** → mitigated structurally by D4 plus the cross-surface equality test. It is the reason the renderer is a pure function rather than a second pass over the corpora.
- **Adding `--metrics` to the gate writes files where a review previously wrote none** → bookkeeping only, in a gitignored directory, reported on failure, and unable to touch the exit code (`review/metrics-emission`). A read-only checkout still returns a verdict.
- **Fixing the test root may reveal tests that were passing on repo state** → a real possibility, and the correct outcome: a test asserting against the developer's accumulated corpus was never testing what it claimed. Any such failure is a finding, not a regression to paper over.
- **The HTML surface could be mistaken for a status page** → the strongest mitigation is D5 plus the no-verdict requirements in `report/html-surface`, and it is why colour is barred from encoding health. Residual risk accepted: a reader determined to read a verdict into an instrument can do so from the text output too.

## Migration Plan

Additive throughout; no rollback plan needed beyond reverting the commit.

1. `gate --metrics` is a new optional flag — every existing invocation is unaffected.
2. `report --html` is a new optional flag — `report` and `report --json` are byte-identical to before.
3. The skill command-line edits change what agents run, not any published contract.
4. The purge is a one-time local operation on a gitignored directory, performed by moving it aside.

## Open Questions

None that can be deferred without changing the specs or the task breakdown. The one genuinely open item — what session identifier the workflow host could expose for a `runId` ↔ session join (D7) — is deferred with the follow-on rather than left open here, because this change does not depend on its answer.
