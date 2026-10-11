## Context

See `proposal.md` for the motivation and `briefs/merge-confidence-gate-epic.md` §3 for the design the eight briefs share. This document covers only what E1 has to decide to land alone.

Constraints the codebase already imposes:

- **Pure decision modules.** `lib/` holds one concern each with no I/O beyond what the name implies (`.claude/CLAUDE.md`). `lib/risk.mjs`, `lib/findings.mjs` and `lib/ready.mjs` are the precedents: a plain object in, a decision with evidence out, and the CLI does the reading.
- **Thresholds live in `lib/limits.mjs`.** The cap-authority sweep (`test/spine/limits.test.mjs:235-300`) fails any printed cap with no reader in `lib/`, `bin/`, `workflows/` or CI, and the positive-integer invariant (`:29-35`) is over `LIMITS` only; `EVAL_CAPS`, `LANE_CAPS`, `SOLO` and `EFFORT` are separate exports for exactly that reason.
- **Recorded history gates nothing.** `docs/14-evals.md:13-15, 328-329` and `lib/outcomes.mjs` forbid wiring outcome scores, report figures or the autonomy ladder into a gate. Every signal here reads the current run's own facts or a file the caller names.
- **Fail closed on absence.** `lib/risk.mjs:14-21` ("absence of evidence is never evidence of safety") and `lib/ready.mjs:12-22`. `lib/verify.mjs:83-101` already distinguishes `coverage-not-configured` and `disabled-by-caller` from `verify-budget-exceeded` and `no-test-profile`, and `BLOCKING_KINDS = ['typecheck', 'unit']` (`:53`) names the kinds the loop will not proceed without.
- **CLI conventions.** `parseArgs` (`bin/interlock:853-891`) treats `--changed` as variadic and anything not in `BOOLEAN_FLAGS` as value-taking; `readInput` accepts `-` once per invocation; `die()` exits 1 on bad input, so `gate` already shares exit 1 between "blocked" and "unreadable input". `emit(json, obj, text)` prints one or the other. Every gating command exits 1 when it blocks; `risk`, `drift` and `conformance` never do.
- **Pinned field names.** `gate --json` keys are read by name by skills and the spec meter (`test/spine/cli.test.mjs:483`); the review-metrics record is pinned to exactly four counts (`test/spine/metrics.test.mjs:41`); the report bans verdict words (`test/spine/report.test.mjs:698`). None of those surfaces changes here.
- **Shapes this module composes.** `resolveReview` returns `{ surviving, dismissed, droppedByQuality, droppedByPolicy, counts: { raised, droppedByPolicy, dismissed, droppedByQuality, surviving, dismissalsRejected }, dimensionStats, anomalies }` and `run reviewed` writes exactly that to `.claude/ship/review.json`; each surviving finding carries `votes: { real, notReal, uncited, total }` and a severity. `judgeVerification` returns `{ halt, reason, context, haltingKinds, unit, e2e, coverage, signals, banners, skipped }`, where `skipped` is `[{ kind, reason, detail }]`; it records a type check only when it fails (a `warn` signal at `final`, a `halt` at `inter-wave`), so this change adds a `typecheck` field (D6). `summarize(readLedger(root, change))` returns `{ needsHuman, invalidCount, missing, unparseable, blocking, … }`. `analyzeDrift(root, { changed })` returns `{ unarchived: [{ change, tasks, path }], stale: { skipped, reason, broken: [{ spec, file }], aging }, orphans }`; `unarchived` is repo-wide and `stale.skipped` is true with an empty `broken` when no graph exists. `inspectChange(root, name)` returns `specFiles`, the delta-spec paths under `specs/`. `classifyRisk` returns `{ riskClass, signals, reasons, basis }`. `buildChecklist` returns `{ skipped, reason, verdictsRequired, changedFiles }`, `changedFiles` being the changed paths that pass `isCoverableSource`; the handoff result carries `scenariosChecked` and `scenariosUnconfirmed`.

## Goals / Non-Goals

**Goals:**

- One pure module whose verdict and score are reproducible from a saved input object, with every threshold read from `MERGE_BANDS`.
- A registry of signals that is the single place a signal is declared, so adding one is one entry plus one fixture, and the formula never changes.
- A subcommand that composes the existing readers (`classifyRisk`, `readLedger`, `analyzeDrift`, `buildChecklist`, git) and takes the rest as files, so a CI job on a plain checkout can run it with no platform credential.
- The full signal table from the first release, with the three not-yet-producible signals declared unobserved, so the verdict's growth across E4 and E6 is visible.

**Non-Goals:**

- Writing the verdict at `run close` or onto the receipt (E2). This module exposes the function; the run does not call it yet.
- Fetching pipeline state, labelling, or editing a PR (E3). The pipeline file is an input defined here and produced there.
- The coverage baseline writer and `totalPct` in the lcov reader (E8). The coverage file is an input defined here and produced there.
- Reading `REVIEW.md` from the base ref, the `## Always Human Review` section (E4), the `domain` dimension (E5), living conformance and the spec-coverage edge logic (E6), `spec-audit` (E7).
- Any indicator in `interlock report`, any entry in the outcome corpus, any change to the autonomy ladder.

## Decisions

### D1. Worst band wins; the score is the clean share inside the band's range

The verdict is `max` over bands with `unobserved` ranked as amber, the way `classifyRisk` takes the maximum over signals. The score is `floor + round((ceiling − floor) × clean / gating)`, where `clean` counts gating signals that are green with no flag and `ceiling`/`floor` come from `MERGE_BANDS.ceiling`. An `unobserved` worst band takes amber's ceiling and floor; `worstBand` still reports `unobserved` when no signal is amber or red, so a reader can see that only missing evidence holds the change. Informational signals (`plan.fidelity`) are reported and excluded from `gating`, from the worst band and from `driving`.

The combination is its own export, `combineSignals(results, { bands })`, and `assessMergeConfidence` is the registry run followed by that call. The split is for the tests: no input to this version can read `MERGE` (Risks), so the `MERGE`, green-ceiling and flag-does-not-move-a-band pins are written against synthetic result lists, and the fixtures through `assessMergeConfidence` assert `HUMAN` or `BLOCK`.

*Alternatives.* A weighted sum (PR-Agent's 0 to 100, MergeShield's six-dimension score) was rejected because weights are numbers that get re-argued and a weighted sum is the arithmetic that lets a red be outvoted. A verdict with no number (SonarQube) was rejected by the owner (epic §6, answer 2) because a sortable number is what platforms filter on; the band ceiling keeps the number from contradicting the verdict.

### D2. A frozen `SIGNALS` registry with one `read` contract, and a frozen `FLAGS` list

`SIGNALS` is `Object.freeze([{ id, family, gating, read }])` in the order the spec's registered-signal requirement lists, and every `read(input, bands)` returns `{ band, flags, evidence, reason, kind }` where `kind` is `'person' | 'evidence' | 'finding'` for a non-green gating signal (what would lift it) and `null` for green. The one informational entry, `plan.fidelity`, returns `band: null` and `kind: null` with its evidence; in this change it always reads "no run record", because `run` is `null` (D4). `assessMergeConfidence` iterates the registry and never names a signal; `formatMergeConfidence` prints them in registry order. `FLAGS` is `Object.freeze(['no-e2e', 'no-typecheck', 'no-coverage', 'no-baseline', 'no-pipeline', 'docs-only-changes', 'dimensions-unrecorded', 'domain-skipped', 'legacy-unspecced', 'no-graph'])`; a `read` returning a flag outside it throws, and a test asserts every flag any fixture produces is in the list.

*Why.* The owner's condition on the number was maintainability (epic §3.7). A registry makes "add a signal" a local edit with a test that fails when the fixture or the output drifts, and makes "the formula" a function that cannot special-case a signal.

### D3. Three kinds of absence, and one band per skip reason

- **Unobserved**: the input for the signal is absent, or present but says a planned result never arrived: a skip with `verify-budget-exceeded`, a planned verify step with neither a result nor a `skipped` entry, a pending pipeline check, a baseline whose `baseIsAncestor` is false, a pipeline file for another `sha`. Band `unobserved`, `kind: 'evidence'`.
- **Not configured**: the repository has not set the tool up: `coverage.configured === false`, or no coverage file and the final verdict skipped coverage as `coverage-not-configured`; e2e skipped as `e2e-not-enabled`, `no-detectable-command`, `no-test-profile` or `e2e-not-requested` (e2e is opt-in, so not requesting it is the caller opting out); the type check skipped as `no-detectable-command`; a pipeline file with zero checks; no usable graph for drift (D12). Band `green`, with the flag naming the tool (`no-coverage`, `no-e2e`, `no-typecheck`, `no-pipeline`, `no-graph`).
- **The unit suite is never a flag.** `unit` skipped as `no-test-profile` or `no-detectable-command` is amber, `kind: 'evidence'`: the ship loop refuses to run unattended without a test profile (`STRICTNESS.requireTestProfile`), so a repository with no unit evidence has not merely skipped a tool. The type check is the other `BLOCKING_KINDS` entry and is treated as a tool: the planner skips it as `no-detectable-command` whenever the profile has no `typecheck.command`, the ship loop runs without one, and this repository's own profile has none. Amber there would mean no untyped repository, Interlock included, could ever read `MERGE`.
- **Neither absent nor clean.** `failures-are-pre-existing`, as the plan's skip and as the judged `red-pre-existing` status alike, is amber with `kind: 'person'`: the suite is red, this change did not make it red, and merging onto a red suite is a person's call. `docs-only-changes` is green with the flag `docs-only-changes` on the suite signal and with no flag on e2e, because the planner skipped on the strength of the paths, the ship loop commits on it, and one flag is enough to say so.
- **Anything else fails closed.** A skip reason on a verify kind that this table does not name is amber, so a reason added to `SKIP_REASONS` later reads amber until this table names it.

This maps one to one onto `SKIP_REASONS` and `BLOCKING_KINDS` in `lib/verify.mjs`; the module imports both rather than restating the strings.

### D4. The input is a plain object the CLI assembles; the module reads no file

`assessMergeConfidence(input, { bands = MERGE_BANDS, allowedClasses = MERGE_ALLOWED_CLASSES })` takes:

```
{
  change: { name, capabilities: string[] } | null,   // the change under assessment; capabilities from `inspectChange(...).specFiles`
  changedPaths: string[],
  headSha: string|null,
  artifacts: Record<string,string>,          // the change's proposal/design/tasks text, for the risk classifier
  review: ReviewResult & { dimensions?: { selected: string[], ran: string[], unavailable: string[], completed: boolean } } | null,
  verify: VerifyVerdict | null,               // `interlock verify judge --context final --json`, with `typecheck` (D6)
  checklist: { skipped, reason, verdictsRequired, changedFiles } | null,   // `buildChecklist(root, change, { changed })`, computed by the CLI
  handoff: { scenariosChecked, scenariosUnconfirmed } | null,             // a `verdictsRequired` in the file is ignored
  pipeline: { sha, checks: [{ name, state: 'pass'|'fail'|'pending'|'skipped', required: boolean }] } | null,
  coverage: { configured, headTotalPct, baseTotalPct, baseSha, baseIsAncestor, diffPct, changedLines } | null,
  diff: { changedLines, changedFiles } | null,
  ledger: LedgerSummary | null,               // `summarize(readLedger(...))`
  drift: DriftReport | null,                  // `analyzeDrift`, each `unarchived` entry carrying `capabilities` (D12)
  run: { halted, trajectoryComplete, stageMarkerGaps, rejectedReports, permissionPrompts, autoModeDenials, policyDiffersFromBase } | null
}
```

A capability is a delta-spec path under `specs/` without its `/spec.md` (`review/merge-confidence`, `ship/cap-authority`). The CLI gathers what it can itself: `change` and `artifacts` from the change (`inspectChange`, `readChangeArtifacts`), `ledger` from `decisions.md`, `checklist` from `buildChecklist`, `drift` from `analyzeDrift(root, { changed })` with `inspectChange` run on each `unarchived` entry, `headSha` from `git rev-parse HEAD`, `diff` from `git diff --numstat <base>...HEAD` when `--base` is given. It takes the rest as files: `--review`, `--verify`, `--handoff`, `--pipeline`, `--coverage`. `run` is always `null` in this change (`run.integrity` reads unobserved with "no run record"); E2 fills it at close. Shelling to git in the CLI is the existing practice (`lib/drift.mjs` `gitLastCommit`).

*Alternative.* Having the module read `.claude/ship/*.json` itself was rejected: it would make the decision depend on the filesystem and the run layout, and `run close` (E2) already holds every value in memory.

### D5. `--review` accepts what `run reviewed` writes, with an optional dimension record

The review file is the `resolveReview` result as `run reviewed` writes `review.json`, or `interlock review --json` output, both of which carry `counts` and `surviving` with `votes`. `review.blockers` is red, `kind: 'finding'`, on any surviving finding whose severity is `blocker` or whose severity `evaluateGate` would file under `malformed` (outside `SEVERITIES`). `review.warnings` is amber, `kind: 'finding'`, when surviving `warning` findings exceed `MERGE_BANDS.maxWarningsForMerge`. `review.adversarial` is amber, `kind: 'evidence'`, when `counts.dismissalsRejected > 0` or when any surviving blocker or warning has `votes.total < MERGE_BANDS.minVerdictsPerFinding`. `review.ran` reads an optional `dimensions` block: amber, `kind: 'evidence'`, when the file is absent (no review ran) and when `completed === false` or `unavailable` is non-empty; green with the flag `dimensions-unrecorded` when the block is absent; green otherwise. The flag rather than amber because the counts prove a review happened; only the record of its coverage is missing, and `interlock review` run by hand produces none. E2 writes the block from `manifest.reviewDimensions`.

### D6. `--verify` is the final judge verdict, read per kind; `conformance.delta` counts its own denominator

`verify.suite` reads each `BLOCKING_KINDS` entry on its own and never reads `verify.halt`. The final context halts on `unit` only (`VERIFY_CONTEXTS.final`), so a type check that failed at the final gate arrives as a `warn` signal with the `TYPECHECK FAILED (non-blocking at the final gate)` banner and `halt: false`. That is the ship loop declining to stop, not a clean result, and the merge verdict reads it as red, which is what the epic's `BLOCK` row says. Per kind: `unit` reads `verify.unit` (`halt` → red, which covers red, weakened and did-not-run; `status: 'red-pre-existing'` → amber per D3); `typecheck` reads `verify.typecheck` (`passed === false` → red); a kind with neither a result nor a `skipped` entry was planned and never reported, and is unobserved. A `skipped` entry resolves per D3. The suite band is the worse of the two kinds, and amber outranks unobserved inside the signal because it is the stated fact. A verdict whose `context` is not `final` makes both verification signals unobserved.

`verify.typecheck` is a field this change adds to `judgeVerification`: `{ ran, exitCode, passed }`, or `null` when no type-check result was reported. Without it a passing type check leaves no trace in the verdict, and "passed" could not be told from "never reported". It is additive: no key is renamed, the halting sets are unchanged, and the banner still prints. A verdict written before the field existed carries no `typecheck` key, and reads as "never reported" unless `skipped` names the type check, which fails closed.

`verify.e2e` reads `verify.e2e` (`passed`, `ran`) and the e2e entry of `skipped`, per D3; a run that failed is amber with `kind: 'finding'`.

`conformance.delta` reads `checklist` and `handoff`, in this order: `checklist` `null` or `skipped` → amber with the checklist's reason (`evidence`); `verdictsRequired === 0` and `checklist.changedFiles` non-empty → amber, "promised no behaviour", the conformance module's own framing (`finding`); `verdictsRequired === 0` otherwise → green; `handoff` `null` → unobserved; `scenariosUnconfirmed > 0` → amber (`evidence`); `scenariosChecked !== verdictsRequired` → amber naming both counts (`evidence`); else green. The denominator is always the CLI's own `buildChecklist` count, and a `verdictsRequired` in the handoff file is ignored, so the caller cannot shrink it.

### D7. The coverage and pipeline file schemas are owned here

Both are defined in this change and produced later (E8, E3). The coverage rule, in order: `configured === false`, or no coverage file and the final verdict skipped coverage as `coverage-not-configured` → green + `no-coverage`; no coverage file otherwise → unobserved; `changedLines < minChangedLinesForCoverage` → green with the floor named (a change of exactly the floor is judged); base present and `baseIsAncestor === false` → unobserved; base present → green iff `headTotalPct ≥ baseTotalPct − maxCoverageDeclinePts` (a decline of exactly the tolerance is green), else amber; no base → green + `no-baseline` iff `diffPct ≥ patchCoverageFloorPct`, else amber. Both ambers are `kind: 'finding'`: both figures were observed, and only a change to the code or its tests lifts them. The pipeline rule: `sha !== headSha` → unobserved; any `fail` with `required` → red (`finding`); any `pending` → unobserved; any `fail` without `required` → amber (`finding`); zero checks → green + `no-pipeline`; else green.

*Departure from the epic table.* Epic §3.2's table puts a pending check, a file for another SHA and a non-ancestor baseline in its amber column. That table predates the fourth band, and the epic's own prose under it classes all three as "the run should have produced this result and did not". Here they are unobserved, which ranks as amber for the verdict and scores in the amber range (D1), so no verdict differs; only the band label and `kind: 'evidence'` do. E3 and E8 implement this decision, not the table, and E8's brief already says `unobserved`. The SHA check runs first on purpose: a pipeline file for another commit is unobserved even when it records a failed required check, because the failure was on a commit that is not the one being merged and the head may have fixed it. The evidence names that check, so the failure is not hidden. The owner's e2e answer (epic §6, answer 3) is what makes required-versus-optional the axis: a failed required check is something the platform will refuse anyway, so red is honest; a failed optional check is where a flaky e2e job lives, so a person decides.

### D8. Risk is amber at most, computed over the paths that changed

`risk.class` calls `classifyRisk({ changedPaths, artifacts })` and compares `riskClass` to `MERGE_ALLOWED_CLASSES` (`['low', 'medium']`, a new export in `lib/risk.mjs` beside `CONTINUITY_ALLOWED_CLASSES`, so the two policies can diverge without one silently moving the other). Above the allowed set is amber with `kind: 'person'`; never red (epic §6, answer 4). The classifier's own fail-closed answer for empty input (`high`) is amber here too, not unobserved, because the classifier did answer.

### D9. Exit codes follow the gate convention, and `HUMAN` is not a failure

On a completed assessment, exit 1 iff `BLOCK`; `--require-merge` makes exit 1 iff not `MERGE`. `HUMAN` exits 0 because a CI job that only wants a label must not go red on a change that needs a reviewer. An input that cannot be read or parsed goes through `die()` before any assessment, as it does for `gate`: exit 1, the message on stderr, nothing on stdout. A verdict object on stdout is therefore the only way to tell the two apart, and the usage text says so.

### D10. `MERGE_BANDS` is a separate export with a nested ceiling table

```
export const MERGE_BANDS = {
  ceiling: { green: 100, amber: 79, red: 39 },
  maxWarningsForMerge: 2,
  minVerdictsPerFinding: 2,
  maxCoverageDeclinePts: 1,
  patchCoverageFloorPct: 80,
  minChangedLinesForCoverage: 20,
  maxChangedLinesForMerge: 400,
  maxChangedFilesForMerge: 20
}
```

A separate export, like `LANE_CAPS`, because `ceiling` is a table and the positive-integer invariant is over `LIMITS`. `unobserved` has no row: it takes amber's ceiling and floor (D1), so a fourth number would be one nobody reads. `formatLimits` prints one row per entry and one per ceiling; `interlock limits --json` emits it as `mergeBands`; the sweep's `groups` array gains `{ name: 'MERGE_BANDS', caps: MERGE_BANDS, tokens: cap => [\`MERGE_BANDS.${cap}\`, \`mergeBands.${cap}\`] }` with `ceiling` counting as one cap. `maxDomainSpecChars` has its reader in E5; until then it is **not** in this change's `MERGE_BANDS`, because a printed cap with no reader fails the sweep and the sweep is right. E5 adds it with its reader.

### D11. Tests are fixture-driven and read every expected number from the limits

`test/fixtures/merge-confidence/<state>.json` holds one input object per signal state the spec names: all-observable-green, no-review, review-with-blocker, review-malformed, review-warnings-over-cap, review-no-dimensions, review-incomplete, review-dismissal-rejected, review-votes-below-floor, verify-halt, typecheck-failed-final, typecheck-no-command, typecheck-no-result, unit-pre-existing, verify-skipped-no-profile, verify-skipped-no-command, verify-budget-exceeded, docs-only, verify-not-final, e2e-failed, e2e-not-configured, coverage-decline-inside, coverage-decline-at-tolerance, coverage-decline-beyond, coverage-no-baseline, coverage-patch-at-floor, coverage-not-ancestor, coverage-tiny-diff, coverage-at-size-floor, pipeline-required-fail, pipeline-optional-fail, pipeline-pending, pipeline-stale-sha, pipeline-stale-sha-required-fail, conformance-confirmed, conformance-unconfirmed, conformance-short-denominator, conformance-unavailable, conformance-no-scenarios-source, conformance-no-scenarios-docs, risk-payment, risk-empty, ledger-needs-human, ledger-missing, drift-broken-removed-file, drift-unarchived-same-capability, drift-unarchived-other-capability, drift-unarchived-self, drift-no-graph, no-base. Every one of them reads `HUMAN` or `BLOCK` through `assessMergeConfidence`, because the three not-yet-producible signals are unobserved, and a test asserts that. The formula's own cases (all green, all green with one flag, one red, one unobserved, a worst band of unobserved, no clean signal) are synthetic result lists passed to `combineSignals`. A test asserts that the registry ids, in order, equal the ids every fixture's output carries and the list the spec states, and that every flag produced is in `FLAGS`. Expected scores are computed in the test from `MERGE_BANDS.ceiling`, never written as literals, so a re-tuned ceiling cannot break a test that was only pinning a number. The CLI tests in `test/spine/cli.test.mjs` cover exit codes, `--require-merge`, the only-changed-paths case, an unreadable input file, and the `--json` keys (`verdict`, `score`, `worstBand`, `signals`, `driving`, `counts`, `flags`).

### D12. Drift reads what this change did, not the repository's backlog

`drift.stale` reads `drift` in this order: `null` → unobserved; a `stale.broken` entry whose `file` is one of `changedPaths` → amber, `kind: 'finding'` (this change removed a file a living spec cites); an `unarchived` entry other than `change.name` that shares a capability with `change.capabilities` → amber, `kind: 'person'` (two changes will write the same living spec, and a person orders them); `stale.skipped` → green with `no-graph` and the skip reason in the evidence; else green. With no change under assessment every `unarchived` entry counts, because the overlap cannot be computed and the clause fails closed. `stale.aging`, a date proxy the drift module itself calls advisory, and `orphans`, which is the `spec.coverage` question E6 answers, never move this signal.

*Why not repo-wide, and why not every broken citation.* `detectUnarchived` is repo-wide, and the change being merged is itself complete and unarchived when its pull request opens. Counting it, or a finished change in an unrelated capability, would hold every pull request in a repository that archives after merging at `HUMAN`, for a reason nobody on the pull request can act on. A broken citation elsewhere is drift's backlog, which `interlock drift` reports. The epic's wider clause, "a spec linked to a touched file", needs the spec-to-file edges, which the drift report does not carry and E5's capability selector will.

*Why a flag for no graph, not unobserved.* Epic §3.2 lists "no graph" among the tools a repository may not have set up. The flag keeps it spoken and off the clean count; unobserved would hold every repository that never ran bootstrap at `HUMAN`, which is the punishment for missing tooling that D3 refuses everywhere else.

## Risks / Trade-offs

- [In this version no input can ever read `MERGE`, because three signals are declared unobserved until E4 and E6] → Stated in the output (`reasons` carries one line per not-yet-producible signal naming the capability), in the usage text and in `docs/07`; the alternative, declaring them later, is the silent growth the spec forbids. E6 and E4 flip them. The `MERGE` and green-ceiling paths are still pinned, on synthetic lists through `combineSignals` (D1, D11), so the first input that can reach them is not also the first time they run.
- [Reading a failed final type check as red is stricter than the ship loop, which commits on it] → Deliberate (D6): the run's halt list is about whether the run stops, and a change that does not type-check is a defect the machine found. A repository with no type checker is not affected (`no-typecheck`, D3).
- [`HUMAN` will be the common verdict early, and readers may learn to ignore it] → `driving` is grouped by `kind`, so the output always says which ambers are *needs a person* and which are *missing evidence*, and every evidence line names the file or option that would supply it.
- [`git diff --numstat` reports `-` for binary files and counts renames as deletions plus additions] → Binary rows count as one changed file and zero lines; a rename is counted as the numstat reports it; both stated in the evidence. The caps are coarse by design.
- [The review file written by `interlock review` by hand carries no dimension record, so `review.ran` can only ever be flagged green outside a run] → Deliberate (D5); E2 writes the record at close, and the flag is visible in the score.
- [A pipeline file could be fabricated] → It is an input like every other file; the trust boundary is the caller. The `mr` skill (E3) is the only producer in this epic and writes names and states only.
- [Exit 1 is shared between `BLOCK` and unreadable input] → Same as `gate`; the JSON is the disambiguator, and the usage text says so.

## Migration Plan

Additive. No existing command, file or threshold changes, and the one existing output shape that changes, the `verify judge` verdict, gains a key (`typecheck`) and loses none. Rollback is deleting the subcommand, the module, the fixtures, the `MERGE_BANDS` export and the `typecheck` field; nothing else reads them in this change.

## Open Questions

None that change the specs or the task breakdown. Whether `interlock review` should itself accept and echo a dimension selection, so a hand-run review can clear the `dimensions-unrecorded` flag, is deferred to E2, where the record's producer lives.
