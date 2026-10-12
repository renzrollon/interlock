## Why

`interlock merge-confidence` exists (E1) and can judge against the base and the living specs (E8, E4, E5, E7), but it cannot yet say `MERGE` for any input, and a ship run never states a verdict at all. Two registered signals, `conformance.living` and `spec.coverage`, have no producer and read unobserved by construction. `run.integrity` reads unobserved for every assessment because nothing writes the run record it reads. The close summary, the receipt and the outcome record carry none of it, so the one moment a run holds every fact in memory is the moment it says nothing.

This change lands briefs E2 (`write-merge-confidence-at-close`) and E6 (`confirm-living-requirements-at-handoff`) of `briefs/merge-confidence-gate-epic.md` together. They share one input object, one gather and one test surface, and neither is checkable alone: E2 without E6 writes a verdict that can never be `MERGE`, and E6 without E2 produces counts nothing reads at close.

## What Changes

- **Living requirements are confirmed at handoff.** `interlock conformance --living` extends the checklist with `L1..Ln`, one question per living requirement in force for the capabilities the change touches, after the `C1..Cn` delta scenarios. The set is the one the `domain` reviewer is judged against: the same selection, the same base, the same published text bound, minus the requirements the change's own delta specs supersede. A `--conformance` ship run lists them in the handoff briefing, and the handoff result gains `requirementsChecked` and `requirementsUnconfirmed`. Conformance still blocks nothing.
- **`conformance.living` becomes observable.** It compares the handoff's two counts with the command's own count of listed requirements, exactly as `conformance.delta` does for scenarios. An unconfirmed requirement is amber. No graph is a flag, and requirements left out by the text bound are a new flag, `requirements-omitted`.
- **`spec.coverage` becomes observable, on the new-code rule.** A coverable source file the change adds must be named by a living spec or by the change's own delta specs, and a file the change keeps must not lose the only spec that named it. Either failure is amber. A file the change edits that no spec ever named is the `legacy-unspecced` flag with the repository-wide figure, never a band. "Named" is read from spec text by the same path rule the graph's extractor uses, so the signal works on a clone with nothing but git.
- **`interlock run close` assesses merge confidence once and records it.** It builds the input from what the run observed, writes `.claude/ship/merge-confidence.json`, adds a `mergeConfidence` block to the receipt, carries `mergeVerdict` in the outcome record's observed group, and prints the verdict in the close summary with what drives it. A halted run assesses nothing: the block is absent, never a zero.
- **The run's review record says which dimensions ran.** `review.json` gains the dimension record `review.ran` already reads, so a run's review stops reading `dimensions-unrecorded`, and a skipped `domain` review reaches a verdict as the `domain-skipped` flag.
- **The command can read the run's evidence back.** `interlock merge-confidence --run <file>` takes the review, verification, handoff, coverage and run record from the file a run wrote, only for the commit that run made. Without it `run.integrity` is unobserved for every hand-run assessment and no input could reach `MERGE` after this change either.
- **One gather for both entry points.** The repository reads the command makes today move to one module that the command and the close both call, so the two cannot assemble different inputs for the same change.
- **Unticked tasks hold a run at `HUMAN`.** The run record carries the count of tasks left unticked, and `run.integrity` reads it as amber, needing a person.
- **The "no input can read `MERGE`" statement is removed** from the module, the usage text and the docs, because it stops being true.
- `interlock report` reads none of this. Ship still publishes nothing: no label, no comment, no platform call.

Nothing existing changes shape. Every new output field is additive, and an input that omits the new facts reads the two signals unobserved, as it does today.

## Capabilities

### New Capabilities

- `ship/living-conformance`: the list of living requirements a change is asked to confirm (selection, base, bound, supersession, identifiers), the `--living` option of the conformance command, how the handoff step asks and what it records, and that none of it blocks.

### Modified Capabilities

- `review/merge-confidence`: `conformance.living` and `spec.coverage` gain producers and rules; the run's evidence file becomes an input; `run.integrity` reads unticked tasks; the statement that no input can read `MERGE` is withdrawn.
- `ship/run-program`: the closing step assesses merge confidence from what the run observed and records it; the run's review record carries which dimensions ran.
- `ship/close-summary`: the summary carries the merge-confidence rows on a completed run and none on a halt.
- `ship/outcome-provenance`: the merge verdict joins the observed group, derived from the receipt.
- `report/non-gating`: the report does not read or print the merge verdict.

## Impact

- **New modules:** `lib/merge-evidence.mjs` (the gather and the run's evidence file), `lib/spec-coverage.mjs` (pure: which files a change adds, keeps and edits are named by a spec).
- **Changed modules:** `lib/merge-confidence.mjs`, `lib/conformance.mjs`, `lib/spec-text.mjs`, `lib/graph/extract/openspec.mjs`, `lib/prompts/domain-context.mjs`, `lib/prompts/handoff.mjs`, `lib/prompts/schemas.mjs`, `lib/run.mjs`, `lib/receipt.mjs`, `lib/run-log.mjs`, `lib/outcomes.mjs`, `bin/interlock`.
- **CLI surface:** `interlock conformance --living [--base <ref>]`, `interlock merge-confidence --run <file>`, and their usage text. Exit codes are unchanged.
- **Run artifacts:** `.claude/ship/merge-confidence.json` and `.claude/ship/verify-final.json` (per-run working state, in the working root, gitignored); one new block on the `run-receipt` trajectory event; one new observed field in `outcomes.jsonl`.
- **Limits:** no new threshold. One new flag in the published flag list.
- **Docs:** `docs/04`, `docs/07`, `docs/11`, `docs/14`, `docs/15`, `CHANGELOG.md`.
- **No new dependency.** No skill prose changes: the `mr` skill's labels and description block are E3.
