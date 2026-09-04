## Context

See `proposal.md` — Why. The source of truth for this slice is `.docs/EVALS-REVIEW-2026-09-03.md` §5 "Slice E2" (R5–R10), justified by §3.2 gaps G4, G5, G6, G8, G9, G10 and bounded by §6 "What not to do".

The constraints that actually shape the design here are the repository's, not the review's:

- **Zero runtime dependencies.** `package.json` has no `dependencies` key. Anything that must read `case.yaml` reads it the way `test/evals.test.mjs` already does — a minimal top-level scalar reader, no YAML parser. This change introduces no dependency.
- **Thresholds live in `lib/limits.mjs` or a CLI decision, never in prose,** and every published cap needs a reader (`test/spine/limits.test.mjs`, "every cap the limits surface prints is read by the code path it governs"). The promotion rule's numbers are therefore new `EVAL_CAPS` entries with readers on the day they land — this change must not repeat the `runsPerCase` / `reportingThreshold` failure it is landing next to.
- **A prose instruction nobody asserts silently stops running.** R6 is an instruction in a skill; without a token pin it is the `--metrics` failure again.
- **Degradation is spoken, never silent.** Every "could not measure" path in R7, R8 and R10 names what was missing rather than reporting a zero or an absence.
- **`bin/` and `lib/` never import from `test/`.** This is what decides R10 (see D3).

Existing surfaces this touches: `evals/` (8 cases, 17 graders, 2 judged), `test/evals.test.mjs` (the structural gate), `test/skills.test.mjs` (the token-pinning precedent), `lib/evals-triage.mjs` and `lib/limits.mjs`, `skills/evals/SKILL.md`, `.github/workflows/evals.yml`, and the four living specs under `openspec/specs/evals/`.

## Goals / Non-Goals

**Goals:**

- Give the promotion rule an executable home so it is decided once, in code, rather than argued per pull request.
- Make the two structural claims this slice adds — a twin's citation and a case's coverage declaration — *resolvable*, so a dangling reference fails loudly instead of reading as coverage.
- Keep every new measurement honest about its denominator, and make "not measured" distinguishable from "measured and bad" everywhere it can occur.
- Land everything that does not need a real model run, and say plainly which parts wait for one.

**Non-Goals:**

- No eval result reaches `ready`, `gate`, `autonomy` or the ship loop (review §6). R7 governs the eval job's own blocking posture and nothing else.
- No numeric threshold enters a skill, a spec, a doc, or the workflow YAML.
- No judged grader replaces a deterministic assertion, and no `tool_order` grader is introduced — including in the three new twin cases (review §6). `tool_used` with `min`/`max` bounds is outcome-shaped and is what the twins use.
- No custom eval harness. The `claude -p` fallback stays the documented contingency it is.
- No pre-committed case count for R9. It is an audit; it produces the cases provenance supports and no others.
- Not building Slice E1. This change assumes it and states the dependency (D9).

## Decisions

### D1 — R7 (`promote`) is a `bin/interlock` subcommand, not a test

`interlock evals promote --history <dir>` joins `interlock evals triage` as a second `evals` subcommand backed by a pure module (`lib/evals-promote.mjs`).

*Why a command:* three reasons, each sufficient.

1. **The consumer is CI, not `npm test`.** The review's acceptance criterion is that the eval workflow's `continue-on-error` is *driven* by the decision. A GitHub step can consume a command's exit code or JSON output; it cannot consume a `node:test` assertion.
2. **Exit-code-as-verdict is the repository's contract for a decision with a correct answer.** `triage`, `gate`, `verify`, `remediate` all hold it, and `lib/evals-triage.mjs`'s own header states the argument: the one rule a model could re-argue per run is exactly the rule to put behind an exit code. Promotion is that rule one layer up.
3. **Its input is runtime state, not repository state.** The history is a set of results files produced by prior runs. A test over repository files structurally cannot see them.

*Alternative considered:* a test asserting "these cases are promoted and these are not", with the promoted set hand-maintained. Rejected — that is the hand-edited posture the requirement exists to remove, relocated into a test file.

*Exit codes*, extending `EXIT` in the new module rather than reusing triage's: `0` every requested case promotable, `1` at least one refused, `2` insufficient history. `2` is deliberately the same *shape* as triage's `no_signal` — "not enough evidence" must never read as "the evidence says no", which is the distinction the gate spec already draws for the run itself.

### D2 — R8 splits: `calibrate` is a subcommand, calibration *presence* is a test

`interlock evals calibrate` is the third `evals` subcommand (`lib/evals-calibrate.mjs`), because it must cross a *results file* (runtime state — the judge's recorded votes) against *repository state* (the stored human labels). Half its input is not in the repository, so it cannot be a test, for the same reason as D1.

The half that *is* repository state — "every judged grader has a calibration set" — is a shape check over committed files and belongs in `test/evals.test.mjs` beside the existing smoke-graders check.

*The ordering problem this creates, and its resolution.* There are no transcripts yet (review G1), so a structural assertion requiring a populated calibration set for both judged graders would fail on the day it lands. Two bad options: land the assertion disabled (an assertion nobody runs), or land the sets with invented labels (hypothetical calibration, which is worse than none). Instead: **the gate requires a calibration set *or* a named entry in a committed deferral record with a stated reason**, and additionally fails when a deferral entry is stale — it names a grader that no longer exists, or one that now has a set. That is the repository's own idiom: degradation is spoken, and the record cannot outlive the condition it describes. The deferral record is a small committed file under `evals/` (a sibling of the cases, not inside one), listing grader → reason.

*Alternative considered:* fold calibration into the promotion module. Rejected — `promote` issues a verdict and `calibrate` explicitly issues none. Two contracts that opposite in one module is the kind of thing that gets "simplified" into a verdict by a later edit.

### D3 — R10 (coverage) is a test, not a CLI subcommand

Coverage lands as a test in `test/evals.test.mjs` (or a sibling under `test/`), not as `interlock evals coverage`.

*Why a test:*

1. **Its inputs are entirely repository state:** the files under `skills/`, `shared/`, `agents/`, the case definitions under `evals/`, and the prompt labels the ship harness enumerates. Nothing runtime.
2. **`EXPECTED_PROMPT_LABELS` lives in `test/helpers/ship-harness.mjs`.** A `bin/` command reading it would make `bin/` import from `test/`, inverting the dependency direction the repository holds. Relocating the label list into `lib/` to enable a CLI is a change to the prompt-integrity contract with its own blast radius, and it is not this slice's business.
3. **"It SHALL exit 0 regardless" removes the only thing a CLI buys.** A command whose exit code carries no verdict is a printer, and the repository already has a printer that runs on every change: the test suite.

*The hazard this creates, and its resolution.* A test that only prints is precisely the "instruction nobody asserts silently stops running" failure in `CLAUDE.md`. So the test **asserts totality and prints the partition**: every discovered model-facing file and every prompt label must land in exactly one of `exercised` / `unexercised`, and every surface a case *declares* must resolve to something that exists. The size of the unexercised set is printed, never asserted — coverage never gates. If the classifier silently stops discovering surfaces, totality over an empty set would still pass, so the test also asserts the discovered surface set is non-empty and includes the known component directories.

*Alternative considered:* both — a test plus a thin CLI wrapper. Rejected as two readers of one map, with the CLI's dependency inversion still unresolved.

### D4 — `twin_of:` and `exercises:` are `case.yaml` fields read without a YAML parser

`twin_of: <case-name>` is a top-level scalar; `exercises: [path, path]` is a top-level list in the same inline-or-block form `tags:` already takes. `test/evals.test.mjs` already carries `readTopLevel` and `readTags` — the list reader generalises to `exercises` by parameterising the key. No dependency, and the two fields are optional, so the eight existing cases stay valid unchanged.

*Why a dedicated field rather than reusing `provenance:`* — the review's own point in §2: the structural test today cannot tell an observed failure from a gap-class citation, because both are free text in one field. Separating them is what makes "three of eight cases are hypotheses with a citation" a computable fact instead of a review finding.

*The harness risk:* an unknown top-level key could be rejected by the eval harness at load. This is unverified (the schema is early-access and undocumented) and is recorded in Risks with its mitigation.

### D5 — The promotion rule's numbers are `EVAL_CAPS` entries with readers on day one

Three new entries beside `smokeCostUsd` and `fullRunCostUsd`: the consecutive-qualifying-run count the window requires, the per-run trial count a qualifying run must carry, and the judge-agreement floor a judged case must meet. `lib/evals-promote.mjs` reads all three by name; `formatLimits()` prints them.

This is deliberately the opposite of the failure sitting next to it — `runsPerCase` and `reportingThreshold` are printed and unread, which is Slice E1's R3 to resolve. This change must not add a fourth unread cap. If E1's extension of the reader-invariant test to `EVAL_CAPS` has not landed when this does, the three new entries still have real readers in `lib/`, so the extension will pass over them when it arrives.

The rule itself, stated once here and nowhere else in prose: a case is promotable when it passed **every trial of every run** across at least the published number of consecutive qualifying runs (this is pass^k, not pass@k — review §1); a run that triage classified as no-signal or configuration does not qualify and does not break the chain, it is excluded and named; a case with a judged grader additionally requires a measured agreement at or above the published floor for each of its judged graders.

### D6 — The history directory is committed and populated deliberately, not written by CI

`promote --history <dir>` reads a directory of results files. The directory this change establishes is `evals/history/` — one small record per scheduled run, per-case pass/fail counts and the run's triage verdict only, no transcripts, copied by name like every other corpus writer in the repository.

*Why committed rather than assembled from CI artifacts:* GitHub artifact retention is finite and the history must outlive it; a committed history is diffable, reviewable, and answers the "did this release get worse" question from the repository alone (which is Slice E3's whole thesis, and this is its cheap precursor).

*Why populated deliberately rather than by a CI commit step:* a scheduled workflow that commits to the default branch needs `contents: write` and introduces a bot-authored commit on every run. That is a permissions and provenance decision larger than this slice, and it is not needed to make R7 real — the decision module and its CI reader work over whatever is committed. The scheduled job continues to upload its results as an artifact; appending it to `evals/history/` is a maintainer action. Recorded as an Open Question, not smuggled in.

### D7 — CI consumes the decision through a computed step output

The eval workflow gains a step that runs `interlock evals promote --history evals/history --json` and sets an output; the triage step's `continue-on-error` becomes an expression over that output rather than the literal `true` it is today. With no history committed, `promote` exits insufficient-history and the expression resolves to advisory — the current behaviour, reached by decision rather than by default. That satisfies the gate spec's added "no history yields the advisory posture" scenario without a special case in the YAML.

### D8 — R9 is an audit with no pre-committed output

The sweep reads `openspec/changes/archive/*/proposal.md` (`## Why` sections), `CHANGELOG.md`, `.docs/WORKFLOW-REVIEW-2026-08-21.md`, and the run corpora (`.claude/ship/runs`, `.claude/learning`, `.claude/metrics`) for observed model-behaviour failures on `spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap`. Cases are authored **only** where provenance exists. Surfaces with none are named in `baseline.md` as unexercised-no-provenance.

Two things the sweep must state rather than paper over: the local run corpora were purged on 2026-08-29 (review §2, layer 4), so a sweep over them will most likely find nothing and must record *that*, not silence; and the distinction between "this surface has no observed failure" and "this surface was not swept" must be visible in the record.

*Alternative considered:* seed one case per uncovered surface so coverage looks complete. Rejected outright — it is the hypothetical-case failure the case-suite spec and the `evals` skill both already refuse, and a suite of hypotheticals is the one thing an advisory gate cannot survive.

### D9 — Dependency on Slice E1 (`ground-evals-in-a-real-run`), stated per requirement

That change is planned alongside this one under `openspec/changes/ground-evals-in-a-real-run/` and has not been applied; this design assumes it lands first and supplies (E1/R1) a first recorded baseline, (E1/R2) a real results file committed as a fixture under `test/fixtures/evals/`, and (E1/R3) the reader-invariant extension over `EVAL_CAPS`. Nothing in this change reads a file E1 creates, so the two can land in either order — the dependency is on the *trust* E1 establishes, not on its artifacts.

| Requirement | Blocked on E1? |
|---|---|
| R5 — twin cases and `twin_of:` | **No.** Authoring cases and resolving a citation need no run. |
| R6 — transcript step and its token pin | **No.** The instruction and its pin land offline; only its *effect* awaits a run. |
| R7 — `promote` module, command, caps, CI wiring | **Partly.** Module, command, caps and unit tests land now against hand-built history. The CI wiring is safe now (it degrades to advisory), but the decision is only *trustworthy* once E1's fixture proves the results schema triage and promote both read. |
| R8 — `calibrate` command and the presence gate | **Partly.** Command, structural gate and deferral record land now. **Populated calibration sets are blocked**: they require human-labelled transcripts, and no transcript exists. Both judged graders start in the deferral record. |
| R9 — provenance audit | **No.** It reads archives, changelog and corpora, none of which need a model run. |
| R10 — coverage partition | **No.** Entirely repository state. |

The honest summary: five of six land now in full or in their landable half; the one thing this slice cannot deliver before E1 is *calibrated* judged graders, and the design makes that absence a named, gated, expiring record rather than a silence.

## Risks / Trade-offs

- **A new top-level `case.yaml` key is rejected by the early-access harness at load.** → The two new fields are optional, so the fallback is real: if the harness rejects unknown keys, move both into a YAML comment block with a stable prefix the structural reader parses, exactly as the existing cases already carry their gap-class rationale in comments. Verify against one case before authoring the other two. This is the same undocumented-schema exposure the review records as G1/R2 and does not add a new class of risk.
- **`promote` is written against a results schema nobody has seen produced.** → It consumes triage's *output* shape (which this repository owns) wherever it can, rather than the harness's raw results shape, and reads the raw file only for the per-run pass/fail it cannot get otherwise. When E1's fixture lands, one promote test over that fixture closes the gap. Until then the CI wiring degrades to advisory, so a wrong assumption cannot block a pull request.
- **A deferral record becomes a permanent excuse.** → The staleness assertion is the mitigation, but it only catches removal, not age. Accepted trade-off: an entry that is still accurate still passes. The alternative — an expiry date in the file — is a threshold in prose, which the repository forbids.
- **The coverage map inflates on a loose match.** → A case's `provenance:` is free text; matching it loosely against file paths would mark surfaces exercised on a substring coincidence. The classifier matches only paths that exist in the repository and are named exactly; anything else is unexercised. Preferring a false "unexercised" to a false "covered" is the correct direction for a report whose whole purpose is to make absence visible.
- **Three new cases raise the metered cost of the full suite.** → The twins are deterministic-grader cases and can be tagged `smoke`; the full-run ceiling is already published and enforced, and a breach is reported as partial rather than as a pass. No new ceiling is needed. `trampoline-launch` is the one to watch: it needs a host that *has* the Workflow tool, which the smoke environment may not provide — if it cannot be made deterministic there, it stays out of the smoke tag and runs only on the schedule.
- **Six capabilities under `evals/` is a lot of specification for one suite.** → Accepted. Each is one concern with one contract, matching how `lib/` is organised, and the two new ones are exactly as separable as `triage` is from `authoring`: one issues a verdict, one is forbidden from issuing one.

## Migration Plan

Nothing to migrate. Every addition is additive: two optional `case.yaml` fields, three new commands' worth of surface (two subcommands), three new `EVAL_CAPS` entries, new tests, three new cases. The only edit to existing behaviour is the eval workflow's `continue-on-error`, which resolves to its current value on an empty history. Rollback is reverting the change; no state is written outside the repository.

## Open Questions

- **Who appends to `evals/history/`, and when?** D6 keeps CI out of the commit path deliberately. If the scheduled job should write its own history record, that is a `contents: write` permission decision and a bot-commit provenance decision — worth taking on its own, and it does not change these specs, this approach, or the task breakdown.
- **Should the three twin cases carry the `smoke` tag?** Deterministic graders permit it; whether the pull-request smoke environment can present a Workflow tool to `trampoline-launch` is unverified. Decidable after the first run without changing anything here.
