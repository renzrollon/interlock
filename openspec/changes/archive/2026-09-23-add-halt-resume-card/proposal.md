## Why

A halted ship run already records everything a reader needs, and records it in five places that only make sense together: the reason in a terminal summary nobody was watching, the walk in `.claude/ship/runs/<runId>.jsonl`, the plan and its fingerprint in `.claude/ship/`, the unfinished boxes in `openspec/changes/<change>/tasks.md`, and the degradation banners in whatever scrollback the session left behind. A person picking the change up in a new session has none of that conversation in context. They reassemble it by hand, every time, from the one state the loop is worst at communicating — the state where it stopped on purpose.

The reassembly is deterministic. Everything it needs is in the manifest the close already holds. Nothing about it needs a model, a network call, or a new corpus.

The hazard is the obvious implementation. A markdown file named for resuming invites two assumptions that would each be a defect: that something consumes it, and that it knows what the next run will do. It must be neither. `/interlock:ship` decides whether to skip the classifier from the plan fingerprint and from nothing else, and the fingerprint is recomputed at the next `run start` against artifacts that may change in between.

## What Changes

- **A halted close writes exactly one resume card**, at `.claude/handoff/ship-<change>-<runId>.md`, and a clean close writes none — a completed run has nothing to resume and its summary already ends in the archive reminder. The change name and run id are untrusted path components and are reduced to filename-safe segments, so a card can never land outside the handoff directory. A run that halted before a plan was adopted has no run id and gets a card named for that absence rather than a blank or a clock.
- **The card is a record, never a trigger.** Nothing reads it back — not the ship loop, not dispatch, not plan reuse. It says so in the file, and it carries the same `Do not start another ship run unless the user asks.` instruction the summary ends with, because a "resume" artifact a model finds lying around is exactly the thing that would otherwise be read as permission.
- **It never predicts the next reuse verdict.** It reports this run's own `PLAN REUSED` / `PLAN REBUILT` verdict — or that the run ended before the plan-reuse check reported — plus whether a stored plan and fingerprint on disk name this change, and then states the reuse rule. A prediction would be wrong exactly when a reader relied on it.
- **It carries what a reader with no context needs, and states each absence rather than printing an empty section**: the halt reason, where the run stopped (change, run id, project slug, cwd, trajectory path and the `run-log` commands that replay it), the leftover task ids with a ready-to-paste `interlock tasks tick`, the plan section, the wave tallies, the banners raised before the halt, and how to pick it up.
- **Every list is bounded by a published cap, and the truncation is spoken** — the card says how many rows it left out and names where the full list is. A silent head would make the card lie about the thing it exists to summarize.
- **Losing the card costs convenience, not evidence.** `writeResumeCard` never throws; it returns a reason. A failed write becomes a `RESUME CARD NOT WRITTEN: <reason>` degradation banner and never moves the exit code, and the summary's `resume card:` row is then absent. This is deliberately the outcome-corpus class of the repository's corpus-loss semantics, not the trajectory's: the card points at records that were already written.
- **The terminal summary names the card when one was written**, as a `  resume card: <repo-relative path>` row, and only then.

**Not in scope, and deliberately so:** mid-run cursor resume; `resumeFromRunId`; any consumer that reads the card back, dispatch included. Resuming a partially executed run was rejected when plan reuse landed (`2026-08-23-fold-serial-batches-into-lanes` names `resumeFromRunId` and `state.json` replay out of scope there), and this change does not reopen it. The card states that limitation about itself: `.claude/ship/state.json` is replaced at wave 0 by the next run, so the wave cursor and the previous wave's handoff packets are not restored.

## Capabilities

### New Capabilities

- `ship/halt-resume-card`: what a halted close leaves on disk for the next session. One card per halted run at a path derived from untrusted components that cannot escape the handoff directory; a record nothing consumes, which says so in the file; this run's own plan verdict and the stored-plan facts, never a prediction of the next one; each absence stated rather than printed blank; every list bounded by the published cap with the omission named; and a write failure that becomes a banner rather than an exit code.

  This is not a requirement `ship/close-summary` could absorb. That capability is about what a terminal summary carries; this one is about a file that outlives the terminal and is read by someone who never saw it. Folding the two would put "what is printed once" and "what is left behind" under one identity, and the card's load-bearing rule — that nothing reads it back — has no counterpart in a summary that is by definition read once and discarded.

### Modified Capabilities

- `ship/close-summary`: gains one requirement — on a halt whose card was written, the summary carries a `resume card: <repo-relative path>` row, printed after the identity rows and before the archive-reminder block and the closing `Do not start another ship run unless the user asks.` line. It is printed only when a card was actually written; a row naming a file that is not there would be worse than no row, and the close that could not write one reports that in the degradation block instead. The capability's existing requirements are unchanged: the first line, the exit code, the `LEAN SHIP` line and the degradation block all stay exactly as they were.

`plan-reuse` is unchanged, and that is the point of the change rather than an omission. Reuse is still decided from `.claude/ship/plan-fingerprint.json` alone, so a missing, stale or hand-edited card cannot change what a later run does.

## Impact

- **New**: `lib/resume-card.mjs` — `resumeCardPath`, the pure `formatResumeCard`, the one impure `writeResumeCard`, plus `HANDOFF_DIR`, `RESUME_CARD_SCHEMA` (`interlock.resume-card/1`) and `NO_RUN_ID`.
- **Modified**: `lib/run.mjs` — `runClose` calls `writeResumeCard` on a halt, last, after every banner this close could raise, and turns a failure into a banner; `lib/receipt.mjs` — `formatRunSummary` takes `resumeCard` and prints the row; `lib/limits.mjs` — the `resumeCardListRows` cap, published by `formatLimits`.
- **Tests**: `test/spine/resume-card.test.mjs` (new), plus the halt/clean pair and the unwritable-tree banner in `test/spine/run.test.mjs`, the row-only-when-written assertion in `test/spine/receipt.test.mjs`, and `.claude/handoff` added to the corpora `test/spine/root-isolation.test.mjs` forbids an unpinned test from writing into.
- **Not modified**: `lib/plan-fingerprint.mjs` and the reuse decision, `.claude/ship/state.json` and the wave cursor, `workflows/ship.js`, `bin/interlock-run`, the host adapters, `interlock ready`, `interlock gate`, and every skill — no prose instruction asserts the card, because nothing is asked to read it.
- **Dependencies**: none. Stdlib `node:fs` and `node:path` only.
- **Not a gate**: the card feeds no verdict, no exit code and no later run. A close that cannot write one halts exactly as it would have halted anyway.
- **Gitignore**: unchanged. `.claude/handoff/` was already ignored.
