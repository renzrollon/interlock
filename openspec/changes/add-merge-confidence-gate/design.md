## Context

See `proposal.md` for the motivation and `briefs/merge-confidence-gate-epic.md` §3 for the design the eight briefs share. This document covers only what E1 has to decide to land alone.

Constraints the codebase already imposes:

- **Pure decision modules.** `lib/` holds one concern each with no I/O beyond what the name implies (`.claude/CLAUDE.md`). `lib/risk.mjs`, `lib/findings.mjs` and `lib/ready.mjs` are the precedents: a plain object in, a decision with evidence out, and the CLI does the reading.
- **Thresholds live in `lib/limits.mjs`.** The cap-authority sweep (`test/spine/limits.test.mjs:235-300`) fails any printed cap with no reader in `lib/`, `bin/`, `workflows/` or CI, and the positive-integer invariant (`:29-35`) is over `LIMITS` only; `EVAL_CAPS`, `LANE_CAPS`, `SOLO` and `EFFORT` are separate exports for exactly that reason.
- **Recorded history gates nothing.** `docs/14-evals.md:13-15, 328-329` and `lib/outcomes.mjs` forbid wiring outcome scores, report figures or the autonomy ladder into a gate. Every signal here reads the current run's own facts or a file the caller names.
- **Fail closed on absence.** `lib/risk.mjs:14-21` ("absence of evidence is never evidence of safety") and `lib/ready.mjs:12-22`. `lib/verify.mjs:83-101` already distinguishes `coverage-not-configured` and `disabled-by-caller` from `verify-budget-exceeded` and `no-test-profile`, and `BLOCKING_KINDS = ['typecheck', 'unit']` (`:53`) names the kinds the loop will not proceed without.
- **CLI conventions.** `parseArgs` (`bin/interlock:853-891`) treats `--changed` as variadic and anything not in `BOOLEAN_FLAGS` as value-taking; `readInput` accepts `-` once per invocation; `die()` exits 1 on bad input, so `gate` already shares exit 1 between "blocked" and "unreadable input". `emit(json, obj, text)` prints one or the other. Every gating command exits 1 when it blocks; `risk`, `drift` and `conformance` never do.
- **Pinned field names.** `gate --json` keys are read by name by skills and the spec meter (`test/spine/cli.test.mjs:483`); the review-metrics record is pinned to exactly four counts (`test/spine/metrics.test.mjs:41`); the report bans verdict words (`test/spine/report.test.mjs:698`). None of those surfaces changes here.
- **Shapes this module composes.** `resolveReview` returns `{ surviving, dismissed, droppedByQuality, droppedByPolicy, counts: { raised, droppedByPolicy, dismissed, droppedByQuality, surviving, dismissalsRejected }, dimensionStats, anomalies }` and `run reviewed` writes exactly that to `.claude/ship/review.json`; each surviving finding carries `votes: { real, notReal, uncited, total }` and a severity. `judgeVerification` returns `{ halt, reason, context, haltingKinds, unit, e2e, coverage, signals, banners, skipped }`, where `skipped` is `[{ kind, reason, detail }]`. `summarize(readLedger(root, change))` returns `{ needsHuman, invalidCount, missing, unparseable, blocking, … }`. `analyzeDrift(root, { changed })` returns `{ unarchived, stale: { broken, aging }, orphans }`. `classifyRisk` returns `{ riskClass, signals, reasons, basis }`. `buildChecklist` returns `verdictsRequired`; the handoff result carries `scenariosChecked` and `scenariosUnconfirmed`.

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

The verdict is `max` over bands with `unobserved` ranked as amber, the way `classifyRisk` takes the maximum over signals. The score is `floor + round((ceiling − floor) × clean / gating)`, where `clean` counts gating signals that are green with no flag and `ceiling`/`floor` come from `MERGE_BANDS.ceiling`. Informational signals (`plan.fidelity`) are reported and excluded from `gating`.

*Alternatives.* A weighted sum (PR-Agent's 0 to 100, MergeShield's six-dimension score) was rejected because weights are numbers that get re-argued and a weighted sum is the arithmetic that lets a red be outvoted. A verdict with no number (SonarQube) was rejected by the owner (epic §6, answer 2) because a sortable number is what platforms filter on; the band ceiling keeps the number from contradicting the verdict.

### D2. A frozen `SIGNALS` registry with one `read` contract, and a frozen `FLAGS` list

`SIGNALS` is `Object.freeze([{ id, family, gating, read }])` in registry order, and every `read(input, bands)` returns `{ band, flags, evidence, reason, kind }` where `kind` is `'person' | 'evidence' | 'finding'` for a non-green signal (what would lift it) and `null` for green. `assessMergeConfidence` iterates the registry and never names a signal; `formatMergeConfidence` prints them in registry order. `FLAGS` is `Object.freeze(['no-e2e', 'no-coverage', 'no-baseline', 'no-pipeline', 'docs-only-changes', 'dimensions-unrecorded', 'domain-skipped', 'legacy-unspecced', 'no-graph'])`; a `read` returning a flag outside it throws, and a test asserts every flag any fixture produces is in the list.

*Why.* The owner's condition on the number was maintainability (epic §3.7). A registry makes "add a signal" a local edit with a test that fails when the fixture or the output drifts, and makes "the formula" a function that cannot special-case a signal.

### D3. Three kinds of absence, told apart by where the signal's input says it came from

- **Unobserved**: the input for the signal is absent, or present but says a planned result never arrived (`verify.skipped` with `verify-budget-exceeded`, a pending pipeline check, a baseline whose `baseIsAncestor` is false, a pipeline file for another `sha`). Band `unobserved`, `kind: 'evidence'`.
- **Not configured**: the input says the repository has no such tool (`coverage.configured === false`, `verify.skipped` with `coverage-not-configured` or `disabled-by-caller` for e2e, a pipeline file with zero checks). Band `green`, with the flag naming the tool. Applies only to advisory kinds.
- **Blocking kinds**: `unit` and `typecheck` skipped for any reason, including `no-test-profile`, are amber (`kind: 'evidence'`). `docs-only-changes` is the one skip reason that is green with a flag on the suite signal, because the planner skipped on the strength of the paths and the ship loop commits on it.

This maps one to one onto `SKIP_REASONS` and `BLOCKING_KINDS` in `lib/verify.mjs`; the module imports both rather than restating the strings.

### D4. The input is a plain object the CLI assembles; the module reads no file

`assessMergeConfidence(input, { bands = MERGE_BANDS, allowedClasses = MERGE_ALLOWED_CLASSES })` takes:

```
{
  changedPaths: string[],
  headSha: string|null,
  artifacts: Record<string,string>,          // the change's proposal/design/tasks text, for the risk classifier
  review: ReviewResult & { dimensions?: { selected: string[], ran: string[], unavailable: string[], completed: boolean } } | null,
  verify: VerifyVerdict | null,               // `interlock verify judge --context final --json`
  handoff: { scenariosChecked, scenariosUnconfirmed, verdictsRequired } | null,
  pipeline: { sha, checks: [{ name, state: 'pass'|'fail'|'pending'|'skipped', required: boolean }] } | null,
  coverage: { configured, headTotalPct, baseTotalPct, baseSha, baseIsAncestor, diffPct, changedLines } | null,
  diff: { changedLines, changedFiles } | null,
  ledger: LedgerSummary | null,               // `summarize(readLedger(...))`
  drift: DriftReport | null,
  run: { halted, trajectoryComplete, stageMarkerGaps, rejectedReports, permissionPrompts, autoModeDenials, policyDiffersFromBase } | null
}
```

The CLI gathers what it can itself: `artifacts` from the change (`readChangeArtifacts`), `ledger` from `decisions.md`, `drift` from `analyzeDrift(root, { changed })`, `headSha` from `git rev-parse HEAD`, `diff` from `git diff --numstat <base>...HEAD` when `--base` is given. It takes the rest as files: `--review`, `--verify`, `--handoff`, `--pipeline`, `--coverage`. `run` is always `null` in this change (`run.integrity` reads unobserved with "no run record"); E2 fills it at close. Shelling to git in the CLI is the existing practice (`lib/drift.mjs` `gitLastCommit`).

*Alternative.* Having the module read `.claude/ship/*.json` itself was rejected: it would make the decision depend on the filesystem and the run layout, and `run close` (E2) already holds every value in memory.

### D5. `--review` accepts what `run reviewed` writes, with an optional dimension record

The review file is the `resolveReview` result as `run reviewed` writes `review.json`, or `interlock review --json` output, both of which carry `counts` and `surviving` with `votes`. `review.blockers` counts surviving findings whose severity is `blocker` plus anomalies the gate would call malformed. `review.warnings` counts surviving `warning`. `review.adversarial` is amber when `counts.dismissalsRejected > 0` or when any surviving blocker or warning has `votes.total < MERGE_BANDS.minVerdictsPerFinding`. `review.ran` reads an optional `dimensions` block: amber when the file is absent (no review ran), amber when `completed === false` or `unavailable` is non-empty, green with the flag `dimensions-unrecorded` when the block is absent, green otherwise. The flag rather than amber because the counts prove a review happened; only the record of its coverage is missing, and `interlock review` run by hand produces none. E2 writes the block from `manifest.reviewDimensions`.

### D6. `--verify` is the final judge verdict; `--handoff` is the handoff result plus the checklist size

`verify.suite` reads `verify.halt` with `haltingKinds`, then `verify.skipped` for any `BLOCKING_KINDS` entry (D3), then whether a blocking kind that was planned has no result (unobserved). `verify.e2e` reads `verify.e2e` (`passed`, `ran`) and the e2e entry of `skipped`. `conformance.delta` reads `handoff.scenariosChecked`, `handoff.scenariosUnconfirmed` and `handoff.verdictsRequired`; the CLI computes `verdictsRequired` itself with `buildChecklist(root, change, { changed })` so the caller cannot shrink the denominator, and is amber when `verdictsRequired === 0` while any changed path is coverable source ("promised no behaviour", the conformance module's own framing).

### D7. The coverage and pipeline file schemas are owned here

Both are defined in this change and produced later (E8, E3). The coverage rule, in order: `configured === false` → green + `no-coverage`; `changedLines < minChangedLinesForCoverage` → green with the floor named; base present and `baseIsAncestor === false` → unobserved; base present → green iff `headTotalPct ≥ baseTotalPct − maxCoverageDeclinePts`, else amber; no base → green + `no-baseline` iff `diffPct ≥ patchCoverageFloorPct`, else amber. The pipeline rule: `sha !== headSha` → unobserved; any `fail` with `required` → red; any `pending` → unobserved; any `fail` without `required` → amber; zero checks → green + `no-pipeline`; else green. The owner's e2e answer (epic §6, answer 3) is what makes required-versus-optional the axis: a failed required check is something the platform will refuse anyway, so red is honest; a failed optional check is where a flaky e2e job lives, so a person decides.

### D8. Risk is amber at most, computed over the paths that changed

`risk.class` calls `classifyRisk({ changedPaths, artifacts })` and compares `riskClass` to `MERGE_ALLOWED_CLASSES` (`['low', 'medium']`, a new export in `lib/risk.mjs` beside `CONTINUITY_ALLOWED_CLASSES`, so the two policies can diverge without one silently moving the other). Above the allowed set is amber with `kind: 'person'`; never red (epic §6, answer 4). The classifier's own fail-closed answer for empty input (`high`) is amber here too, not unobserved, because the classifier did answer.

### D9. Exit codes follow the gate convention, and `HUMAN` is not a failure

Exit 1 iff `BLOCK`; `--require-merge` makes exit 1 iff not `MERGE`. `HUMAN` exits 0 because a CI job that only wants a label must not go red on a change that needs a reviewer. Bad input still goes through `die()` and exits 1, as `gate` does; the JSON on stdout is the only way to tell the two apart, and the usage text says so.

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

A separate export, like `LANE_CAPS`, because `ceiling` is a table and the positive-integer invariant is over `LIMITS`. `formatLimits` prints one row per entry and one per ceiling; `interlock limits --json` emits it as `mergeBands`; the sweep's `groups` array gains `{ name: 'MERGE_BANDS', caps: MERGE_BANDS, tokens: cap => [\`MERGE_BANDS.${cap}\`, \`mergeBands.${cap}\`] }` with `ceiling` counting as one cap. `maxDomainSpecChars` has its reader in E5; until then it is **not** in this change's `MERGE_BANDS`, because a printed cap with no reader fails the sweep and the sweep is right. E5 adds it with its reader.

### D11. Tests are fixture-driven and read every expected number from the limits

`test/fixtures/merge-confidence/<state>.json` holds one input object per signal state the spec names (all-green, one-red, one-unobserved, flagged-green, no-review, review-with-blocker, review-no-dimensions, verify-halt, verify-skipped-no-profile, e2e-failed, e2e-not-configured, coverage-decline-inside, coverage-decline-beyond, coverage-no-baseline, coverage-not-ancestor, coverage-tiny-diff, pipeline-required-fail, pipeline-optional-fail, pipeline-pending, pipeline-stale-sha, risk-payment, risk-empty, ledger-needs-human, ledger-missing, drift-broken, no-base). A test asserts the registry ids equal the set of ids every fixture's output carries, and that every flag produced is in `FLAGS`. Expected scores are computed in the test from `MERGE_BANDS.ceiling`, never written as literals, so a re-tuned ceiling cannot break a test that was only pinning a number. The CLI tests in `test/spine/cli.test.mjs` cover exit codes, `--require-merge`, the only-changed-paths case, and the `--json` keys (`verdict`, `score`, `worstBand`, `signals`, `driving`, `counts`, `flags`).

## Risks / Trade-offs

- [In this version no input can ever read `MERGE`, because three signals are declared unobserved until E4 and E6] → Stated in the output (`reasons` carries one line per not-yet-producible signal naming the capability), in the usage text and in `docs/07`; the alternative, declaring them later, is the silent growth the spec forbids. E6 and E4 flip them.
- [`HUMAN` will be the common verdict early, and readers may learn to ignore it] → `driving` is grouped by `kind`, so the output always says which ambers are *needs a person* and which are *missing evidence*, and every evidence line names the file or option that would supply it.
- [`git diff --numstat` reports `-` for binary files and counts renames as deletions plus additions] → Binary rows count as one changed file and zero lines; a rename is counted as the numstat reports it; both stated in the evidence. The caps are coarse by design.
- [The review file written by `interlock review` by hand carries no dimension record, so `review.ran` can only ever be flagged green outside a run] → Deliberate (D5); E2 writes the record at close, and the flag is visible in the score.
- [A pipeline file could be fabricated] → It is an input like every other file; the trust boundary is the caller. The `mr` skill (E3) is the only producer in this epic and writes names and states only.
- [Exit 1 is shared between `BLOCK` and unreadable input] → Same as `gate`; the JSON is the disambiguator, and the usage text says so.

## Migration Plan

Additive. No existing command, output shape, file or threshold changes. Rollback is deleting the subcommand, the module, the fixtures and the `MERGE_BANDS` export; nothing else reads them in this change.

## Open Questions

None that change the specs or the task breakdown. Whether `interlock review` should itself accept and echo a dimension selection, so a hand-run review can clear the `dimensions-unrecorded` flag, is deferred to E2, where the record's producer lives.
