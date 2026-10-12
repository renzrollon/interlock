## Context

See `proposal.md` for why. The state this design starts from, at `aa695b1`:

- `lib/merge-confidence.mjs` is pure and registers seventeen gating signals. Two (`conformance.living`, `spec.coverage`) are wired to a `readPending` stub, and `assessMergeConfidence` appends a reason line saying no input can read `MERGE`.
- `interlock merge-confidence` assembles the module's input inline in `bin/interlock` and passes `run: null`, so `run.integrity` is unobserved for every assessment.
- `interlock run close` builds the receipt and the summary and never calls the module. The final verification verdict is a local in `runJudge`; nothing persists it. `review.json` carries no dimension record; the facts for one are scattered over `manifest.reviewDimensions`, a step banner and a note.
- `lib/conformance.mjs` lists the change's own delta scenarios (`C1..`). No reader lists a living requirement for confirmation. `lib/prompts/domain-context.mjs` already decides which living requirements a change is judged against, for the `domain` reviewer.
- The receipt carries no conformance count today. The handoff's `scenariosChecked` and `scenariosUnconfirmed` stop at the manifest and the printed summary.

Constraints that shape everything below: zero runtime dependencies; `lib/merge-confidence.mjs` stays pure; thresholds live in `lib/limits.mjs` and nowhere else; the close's exit code is a contract; corpus-loss semantics differ by corpus and stay as they are; degradation is spoken.

## Goals / Non-Goals

**Goals:**

- Every registered signal has a producer, so a clean, reviewed, verified change can read `MERGE`.
- A ship run states its verdict once, at close, from facts it observed, in the summary, the receipt, the outcome record and a file a later command can read.
- One assembly of the input object, shared by the command and the close.
- No new threshold.

**Non-Goals:**

- Labels, the description block, the pipeline file and the platform recipes (E3). This change defines the pipeline input's absence at close and nothing about fetching it.
- Changing what a ship run halts on, or its exit code.
- Reading the verdict in `interlock report`, the readiness gate or the autonomy ladder.
- Making conformance block. `lib/conformance.mjs` keeps "Nothing here blocks".
- A graph in CI. The signals this change adds are designed to work without one.
- Filling `plan.fidelity`. It stays informational, with the evidence it reports today.

## Decisions

### D1. One gather, two callers

`lib/merge-evidence.mjs` gains `gatherMergeEvidence(root, { change, changedPaths, base, headSha, supplied, deps })` and returns `{ input, notes }`: the plain object `assessMergeConfidence` takes, and a list of things it could not gather with the reason for each. It owns the repository reads the command makes inline today (the change and its artifacts, the ledger, the delta checklist, drift, the base review policy, the diff shape) and the two this change adds (the living list, D5; the spec-coverage facts, D7). `supplied` is what only a caller can hand in: `review`, `verify`, `handoff`, `pipeline`, `coverage`, `run`.

Git is reached through `deps` (`diffShape`, `nameStatus`, `listFiles`, `readAtRef`), which `bin/interlock` builds for the command and for `ctx.deps` alike. A missing function is not a crash, and neither is one that throws (git failing on a shallow clone, a ref that has gone): either way the signal that needed it reads unobserved, and the reason, with the thrown message when there is one, goes in `notes`. That keeps every existing `runClose` test, which injects one or two functions, valid.

The close reaches the gather itself through `ctx.deps.gatherMergeEvidence` when one is given and the module's own function otherwise, the way it reaches its trajectory loggers. That is the seam a test uses to make the whole assessment fail (D17).

`notes` are spoken by the caller: the command prints each on standard error; the close adds each to the degradation block as `MERGE EVIDENCE UNAVAILABLE: <what> — <reason>`.

The gather asks drift only for what the signal reads (unarchived changes and broken citations), so it skips the per-spec `git log` that only the aging tier needs.

*Why.* Two assemblers of one shape drift, and the drift shows up as two verdicts for one change. `lib/receipt.mjs` exists for exactly that reason.

*Alternative.* Leaving the gather in `bin/interlock` and handing it to the run as one `ctx.deps` function was rejected: nothing in `bin/` is importable, so the gather would be testable only by spawning the CLI.

### D2. The close assesses once, on a completed run only

`runClose` assesses when the run has no halt reason. A halted close records no `mergeConfidence` block (the trajectory writer turns the absent field into `null`), writes no file and prints no line. A diff that stopped part-way is not a candidate for merging, the summary's first line already says the run halted, and "never assessed" must stay distinguishable from a low score.

The close's own inputs:

| Input | Source at close |
|---|---|
| `base` | `manifest.startSha`. With none recorded, every signal that needs a base reads unobserved, naming the missing start commit |
| `changedPaths` | the commit's touched paths (`readTouchedPaths`), or `ctx.deps.observedChangedPaths` on a run that made no commit (D14) |
| `review` | `.claude/ship/review.json`, which now carries the dimension record (D4), read only when this run wrote it (D18) |
| `verify`, `coverage` | D3, read only when this run wrote it (D18) |
| `handoff` | `manifest.handoff`, including the two requirement counts (D5) |
| `pipeline` | none. `ci.pipeline` reads unobserved: the run is offline and no platform has seen the commit it just made |
| `run` | `{ halted: false, trajectoryComplete, stageMarkerGaps, rejectedReports, permissionPrompts, autoModeDenials, leftoverTasks }` (D13, D15) |

Two consequences are deliberate. A lean run reads `HUMAN` naming `review.ran`, which is the honest reading of a diff nobody reviewed. And no close can read `MERGE`, because `ci.pipeline` is unobserved inside a run; the first `MERGE` anyone sees comes from the command with the pipeline added (D9).

### D3. The final verdict is persisted; coverage is computed where the verdict says it ran

`runJudge`, in the `final` context, writes `.claude/ship/verify-final.json`, stamped with the run's id (D18): the judge's verdict when verification ran, and when the CLI skipped it (no plan steps), a verdict-shaped record `{ context: 'final', skipped: <the plan's skip list>, unit: null, e2e: null, coverage: null, typecheck: null }`. The readers already resolve a skip list one band per reason, so a docs-only run and a run with no test profile read what they read from `verify judge --json` by hand.

Coverage figures are computed at close by the function `interlock verify coverage --base <ref>` runs, lifted out of the command case so it returns `{ input }` or `{ reason }` instead of ending the process, and passed as `ctx.deps.coverageInput`. The close calls it only when the persisted verdict carries a coverage result, so the report it reads is this run's. When it returns a reason, `coverage` stays absent, the reason joins `notes`, and the reader's existing fallbacks apply.

### D4. The dimension record is written on `review.json`

`review.json` gains `dimensions: { selected, ran, unavailable, completed, skipped }`, the block `review.ran` already reads:

- `selected`: `manifest.reviewDimensions.selected`.
- `unavailable`: selected dimensions whose rubric could not be read. `reviewStep` records them on the manifest; today they are only a banner.
- `completed`: whether the review worker's result was usable and `ok`. `runReviewed` records it; today it is only a note.
- `ran`: `selected` minus `unavailable` when `completed`, plus any agent-added dimension; empty otherwise.
- `skipped`: `manifest.reviewDimensions.skipped`, which is how a skipped `domain` review reaches the verdict as the `domain-skipped` flag.

The CLI never watches one dimension run: the review worker fans out inside its own context and reports `ok`. So `ran` means "dispatched with its rubric in a review the worker reported complete", and the spec says so in those words.

It is written by every adjudication (`run reviewed`, `run remediated`), because each rewrites the file.

*Alternative.* Building the record only in memory at close was rejected: `review.json` is the file `--review` documents as its input, and a hand-run `--review .claude/ship/review.json` would keep reading `dimensions-unrecorded`.

### D5. Conformance asks about the requirements the domain reviewer is judged against

"Which living requirements is this change judged against" gets one answer. `assembleDomainContext` already computes it for the reviewer: capabilities selected by a reliable graph link or declared by the change's own delta specs, text read from the base, requirements the delta specs modify, remove or rename taken out, whole requirements kept until `LIMITS.maxDomainSpecChars` is reached. It gains one additive field, `kept: [{ capability, heading, line }]`, beside the `omitted` and `superseded` lists it returns today.

`buildLivingChecklist({ selection, assembled })` in `lib/conformance.mjs` is pure and turns that into:

```
{ skipped: string|null,          // no graph and nothing declared: nothing could be selected
  partial: string|null,          // no graph, declared capabilities only
  requirements: [{ id: 'L1', capability, artifact: 'openspec/specs/<cap>/spec.md', line, title }],
  requirementsRequired: number,  // requirements.length
  omitted: [{ capability, heading }],
  source: string }               // 'base <ref>' or 'the working tree'
```

Identifiers run `L1..Ln` in capability then spec order. The list carries headings and locations, never requirement bodies: the handoff agent reads the spec at the cited line, as it reads a scenario's artifact today.

`interlock conformance --living [--base <ref>]` adds this block to the checklist output after the scenarios. It reads the graph root first then the state home, and the living text from the base when one is named and from the working tree otherwise, saying which. It still exits 0.

In a run, `handoffStep` builds the list when `conformance` is on, through the same `gatherDomain` the review step calls, and passes it to `assembleHandoffPrompt`. The step carries the count; `LIVING CONFORMANCE SKIPPED: <reason>` and `LIVING CONFORMANCE PARTIAL: <reason>` are raised once each on the step and the manifest, mirroring the two `DOMAIN REVIEW` banners. A graph that links nothing raises neither. `HANDOFF_RESULT_SCHEMA` gains the optional integers `requirementsChecked` and `requirementsUnconfirmed`; `runCommit` records them on `manifest.handoff`, and the summary prints a `living requirements:` row beside the `conformance:` row.

*Why reuse the text bound.* A list of every in-force requirement of every selected capability is unbounded, and an unbounded list is an unbounded handoff. A count cap would be a new number someone has to defend. The text bound is already published, already cuts at a requirement boundary, and already names what it left out; using it means the reviewer and the handoff can never disagree about the set.

*Alternative.* Asking about every in-force requirement, uncut, was rejected for the reason above. A new `LIMITS` key was rejected as a second bound on the same question.

### D6. `conformance.living`: one band per state

`readLivingConformance` reads `input.living` (D5's block, minus the requirement list) and the handoff's two counts:

| State | Band | Flags |
|---|---|---|
| no `living` input | unobserved, "the living-requirement list was not gathered" | |
| `skipped` (no graph, nothing declared) | green | `no-graph` |
| zero requirements listed (a graph that links nothing; every requirement superseded) | green, nothing to confirm | `no-graph` when `partial` |
| requirements listed, no handoff input | unobserved | |
| the handoff carries neither count | amber, needs more evidence | |
| any unconfirmed, or checked differs from the command's count | amber, needs more evidence | |
| every listed requirement checked, none unconfirmed | green | `no-graph` when `partial`; `requirements-omitted` when the bound left any out |

A `requirementsRequired` in the handoff input is ignored, as `verdictsRequired` is for `conformance.delta`: the denominator is the command's own count.

`requirements-omitted` joins `FLAGS`. A cut list is a flag and not a band for the reason drift's own rationale gives: the bound is the CLI's, nobody on the pull request can act on it, and holding every large capability at `HUMAN` would punish the repositories that wrote the most spec.

### D7. `spec.coverage` reads spec text, not the graph

The brief reads graph edges. Three facts make that the wrong source for this signal: the graph is gitignored and never present in CI, so the signal would be a permanent flag there; an edge is only built for a file that existed when the graph was built, so a file the change adds can never have one; and the rule for "a delta spec names this file" has to be read from text in any case.

So the rule the extractor applies becomes one exported pure function, `specMentionedPaths(text)` in `lib/spec-text.mjs`, holding the path pattern that lives in `lib/graph/extract/openspec.mjs` today. The extractor calls it and keeps its own gate on known files, so the edges it emits do not change. `spec.coverage` calls the same function over spec text. A fresh graph and this signal agree by construction; a stale graph disagrees with the repository, not with the signal.

*Alternative.* Graph edges for edited and kept files plus text for added ones was rejected: two derivations of "named" inside one signal, and still vacuous in CI.

### D8. The new-code rule, as facts and a judgement

`lib/spec-coverage.mjs` is pure. `specCoverageFacts({ added, modified, sourceFiles, livingAtHead, changedSpecsAtBase, deltaSpecs })` takes the diff's added and modified paths (a rename's new path is an added path), the tracked file list at the head, the text of every living spec at the head, the base text of each living spec the diff changed or deleted, and the text of the change's delta specs. It returns:

```
{ added:  [{ path, namedBy: 'living'|'delta'|null }],   // coverable source the diff adds
  lost:   [{ path, spec }],                              // kept coverable file, named at the base by a changed spec, by nothing at the head
  legacy: [path],                                        // coverable source the diff edits that nothing names
  repo:   { named, total } }                             // over tracked coverable source at the head
```

A file is named when its repository-relative path, on the canonical form, is among the paths a living spec at the head or one of the change's delta specs mentions. Only `isCoverableSource` files are judged: a test, a config file or a document having no spec is not a gap.

`readSpecCoverage` judges:

- no facts (no base to tell an added file from an edited one) or a diff that is empty by construction: unobserved, with that reason;
- any added file with `namedBy: null`, or any `lost` entry: amber, needing a fix, naming each file;
- otherwise green, with `legacy-unspecced` when `legacy` is non-empty, its evidence stating the count and the repository figure as named over total.

The gather reads living spec text at the base only for specs the diff touched; an untouched spec mentions the same paths on both sides.

### D9. The run's evidence file, and `--run`

`.claude/ship/merge-confidence.json`, written by the close:

```
{ schema: 'interlock.merge-evidence/1',
  change, runId, base, headSha, committed,
  evidence: { review, verify, handoff, coverage, run },   // what only the run saw
  result }                                                // the assessment, for a reader of the file
```

`interlock merge-confidence --run <file>` supplies those five inputs when, and only when, the file carries the schema identifier, names the change under assessment, says the run committed, and its `headSha` is the head. Otherwise none of it is used, standard error says which check failed, and the signals read as they would with no file. An explicit `--review`, `--verify`, `--handoff` or `--coverage` overrides its entry. `result` is never read: the command always reassesses.

The head rule is the pipeline rule again. Evidence about another commit says nothing certain about this one, so a commit added after the run (an archive, a hand fix) returns those signals to unobserved.

*Why here and not in E3.* The epic has the `mr` skill re-run from the run's file with the pipeline added, and E3 changes no CLI. Without a reader, the file this change writes has no consumer and `run.integrity` stays unobserved for every assessment outside a run, so `MERGE` would remain unreachable after both briefs.

### D10. One headline

`mergeConfidenceHeadline(result)` is exported from `lib/merge-confidence.mjs` and returns the line `formatMergeConfidence` prints first today: `MERGE CONFIDENCE <VERDICT> — score <n> (<band> range <floor>–<ceiling>; <clean> of <gating> gating signals clean)`. The close summary prints the same string. The brief's example put the score first; the shipped line wins so a reader greps one form.

The summary block, on a completed run, between the identity rows and the archive reminder:

```
MERGE CONFIDENCE HUMAN — score 72 (amber range 40–79; 14 of 17 gating signals clean)
  needs a fix: review.warnings
  needs a person: risk.class
  needs more evidence: ci.pipeline, conformance.delta
  flags: verify.e2e no-e2e
  assessment: .claude/ship/merge-confidence.json
```

A group row is printed only when it has an entry. Reasons and evidence stay in the file. `lib/receipt.mjs` stays import-free: the close hands `formatRunSummary` the headline string and the grouped ids.

### D11. The receipt block carries the verdict and its shape, no text

`buildReceipt` gains `mergeConfidence: { verdict, score, worstBand, counts, driving: [id], flags: [{ id, flag }] }`, and `lib/run-log.mjs` whitelists it field by field: the verdict against the three published words, the score and counts through `nullableCount`, signal ids and flag names as bounded strings. No reason and no evidence line is copied, because those can quote a finding's title and file.

The brief also names two requirement counts on the receipt. They are not added. The receipt has never carried the scenario counts they would sit beside, both pairs are agent-reported, and the verdict that reads them is on the receipt already. They live on the manifest, in the summary and in the evidence file.

### D12. The outcome record carries the verdict, and nothing reads it back

`OBSERVED_FIELDS` gains `mergeVerdict`. `observedFromReceipt` takes it from `receipt.mergeConfidence.verdict`, one of the three words or `null`. It is storage: no gate, readiness check or ladder reads it, and `interlock report` reads neither it nor the receipt block. `report/non-gating` gains the requirement and `test/spine/report.test.mjs` the pin.

### D13. Unticked tasks are a run fact

The run record gains `leftoverTasks`, the count the close already reads for its headline. `readRunIntegrity` adds "N task(s) left unticked" to the degradations it names, amber, needing a person. A change whose tasks are not all done is not complete by this repository's own definition, and the direction is conservative: it can cost a look, never grant a merge.

### D14. A run that made no commit

A run makes no commit for one of two reasons: it was told not to, or its commit step reported failure. Either way the head is still the start commit, so `<start>...HEAD` is empty by construction. `diff.shape` already reads that unobserved; `spec.coverage` does too, and both reasons say the run made no commit. The other signals read the working tree's changed paths. The evidence file records `committed: false`, which makes it unusable by `--run`: it describes a working tree no later command can name.

### D15. A write that fails after the assessment

The receipt is built from an assessment made before its own append, so it cannot know whether that append, the terminal event or the reconstructability check will fail. When one does, the run record's `trajectoryComplete` becomes false; the close reassesses from the same gathered input with that one field changed, and the evidence file and the summary carry the result. The receipt keeps what it was built with. The exit code is the close's own, non-zero as today.

In the ordinary case the two assessments are the same object and nothing is computed twice.

### D16. The denominator is recounted

At close and by hand, the living list is rebuilt by the same pure function over the same inputs. The count the handoff agent was given is recorded on the manifest for the `living requirements:` row only. If the two differ, the reader sees checked against counted and reads amber, which is the right answer to "something moved between the handoff and the commit".

### D17. The verdict never changes the run's exit code

`run close` exits as it does now: non-zero on a halt, an incomplete trajectory or an unreconstructable run. A `BLOCK` at close is possible (a type check that failed at the final gate, which that gate does not halt on) and is reported, not enforced. An assessment that throws, in the gather or in the module, is caught and spoken as `MERGE CONFIDENCE NOT ASSESSED: <reason>`, with the block absent; a file that cannot be written is `MERGE CONFIDENCE NOT WRITTEN: <reason>`, with the summary's `assessment:` row left out. Both are the outcome-corpus class of failure: reported, never an exit code.

### D18. A work file is evidence only for the run that wrote it

`.claude/ship/` is not cleared when a run starts. The only work file the program ever removes is `verify-timings.jsonl`, and it does that when a verification is judged. A lean run that follows a strict run in the same working root therefore finds the earlier run's `review.json`, and reading it would assess an unreviewed diff as reviewed, which is the one reading the `review.ran` signal exists to prevent. So the close reads a work file only when this run wrote it:

- `review.json` only when the manifest records that this run adjudicated a review (`manifest.review`, set by `run reviewed`). Otherwise the review input is absent, whatever is on disk.
- `verify-final.json` only when the run id it carries is this run's. Otherwise the verification input is absent.

The handoff counts and the run record come off the manifest, which is created per run, so they need no such check. This was found by the artifact review of this change, not at design time; the first draft read both files unconditionally.

*Alternative.* Clearing `.claude/ship/` at `run start` was rejected: it would delete the resume inputs of the run that just halted, which `run start` reads to decide plan reuse.

### Task shape and file ownership

TDD: §1 of `tasks.md` is the failing suite, one checkbox per test file group. §2 is the implementation, one checkbox per production file where a file is touched for more than one decision (`lib/run.mjs`, `bin/interlock`, `lib/merge-confidence.mjs`), with `depends on` edges written into the task text. §3 is documentation.

Existing pins that this change is meant to move, named so no task has to choose between the design and "leave existing tests alone": the `FLAGS` deep-equal and the `PENDING` table with its "never `MERGE`" assertions in `test/spine/merge-confidence.test.mjs`; the `all-observable-green` fixture; the `OBSERVED_FIELDS` key set in `test/spine/outcomes.test.mjs`; the `run-receipt` key set in `test/spine/run-log.test.mjs`; the usage text and the full-input assertions in `test/spine/cli.test.mjs` that expect `HUMAN`. Every other existing assertion stays.

## Risks / Trade-offs

- [A spec must mention a file's path for the file to count as named, and this repository's specs are written behaviour-first] → That is the rule the graph already applies and the incentive the epic asks for. This change names its own two new modules in its delta specs, and `docs/15` says where a path mention belongs. An example path in a scenario (`lib/a.mjs`) would name a real file of that name; the graph has the same blind spot and the audit lists numeric and path literals for a person.
- [The handoff agent's answers are agent-reported, and `conformance.living` reads them] → Same trust as `conformance.delta`: the denominator is the CLI's, an unanswered or short list is amber, and the signal can only withhold `MERGE`, never grant it alone.
- [A `--conformance` handoff grows by up to one bound's worth of requirements] → Bounded by `LIMITS.maxDomainSpecChars`, opt-in behind `--conformance`, and the list carries headings only.
- [A CI job has no run evidence file, since `.claude/ship/` is gitignored, so `--require-merge` in CI reads `HUMAN` on `run.integrity`] → Unchanged by this change and E3's to document: the job is handed the file as an artifact, or the label is applied by the `mr` skill on the machine that ran the ship.
- [The receipt and the evidence file can disagree after a late trajectory failure (D15)] → Only when the close also exits non-zero and banners the failure; the file, which is what a later command reads, carries the final state.
- [Moving the command's gather into `lib/merge-evidence.mjs` can change its behaviour by accident] → The existing `merge-confidence` CLI tests run unchanged against it, apart from the pins listed above.
- [`run.integrity` now reads unticked tasks, so a change with a task only a person can do reads `HUMAN`] → Intended (D13), stated in `docs/15`.

## Migration Plan

Additive. A trajectory written before this change has no `mergeConfidence` field on its receipt, which every reader already treats as unobserved. A manifest written before it has no `unavailable`, `completed` or requirement counts; the dimension record then lists no dimension as run and `review.ran` reads amber for want of a record, which is the truth about a run resumed across the upgrade. Rollback is a revert: no stored record needs rewriting, and the two new work files are gitignored per-run state.

## Open Questions

None that would change the specs, the approach or the tasks. One for E3 to settle, noted under Risks: how a CI job is handed the run's evidence file.
