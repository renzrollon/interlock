## Context

See proposal.md — Why. The design-relevant state:

- `lib/evals-triage.mjs` reads `cases[].runs[].graders[].passed`, `loaded`, `partial` and `reason` from a results file produced by `claude plugin eval`, an early-access command with no published schema. Twelve unit tests exist; all twelve build the input by hand, so the field names are pinned to the assumption, not to the harness.
- `EVAL_CAPS` is exempt from the reader-invariant test at `test/spine/limits.test.mjs:106`, which walks `lib/`, `bin/` and `workflows/` and matches the token `LIMITS.<cap>`. The comment in `lib/limits.mjs` justifies the exemption by saying `EVAL_CAPS`' readers "live in CI YAML the test cannot see". The test can see `.github/workflows/`; it simply does not walk it.
- The CI job does not read caps as `EVAL_CAPS.<cap>`. It pipes `interlock limits --json` through Node and reads `.evals.smokeCostUsd` / `.evals.fullRunCostUsd`. The published field name, not the export name, is the token a CI reader uses.
- `bin/interlock:1429` contains `evals: EVAL_CAPS` — a whole-group forward to the printed surface.
- `.gitignore` ignores `.github/workflows/` under a `#Copilot` heading grouping it with `.github/agents/`, `.github/prompts/` and `.github/skills/`. Both `ci.yml` and `evals.yml` are tracked today, force-added.
- Repo constraints that bind: zero runtime dependencies, Node >= 18, `.mjs`, `npm test` as the only verification command, no lint and no build step, and no numeric threshold restated in prose.

The constraint that shapes the whole plan: **R1 cannot be executed by an agent or by an unattended job.** It needs a metered credential and an early-access enablement variable that only a human with account access can provision.

## Goals / Non-Goals

**Goals:**

- Split the slice cleanly along the credential boundary, so the two requirements that need nothing land now and the two that need a human are unblocked the moment the run happens.
- Leave the eval caps in a state where the reader-invariant test can cover them with no exemption comment surviving.
- Make the loss of the CI definition loud rather than silent, without pretending an ignore rule can be argued with.
- State precisely what the first fixture does and does not pin, so nobody reads a green triage test as "the schema is verified".

**Non-Goals:**

- No new eval case, no twin case, no calibration set, no promotion command. Those are Slice E2 requirements (R5–R10) and depend on this slice's baseline existing.
- No custom eval harness, and no work toward one. The `claude -p` fallback stays a documented contingency until the harness is shown to be unusable — the review names building it early as a thing not to do.
- No change to what the gate blocks. The job stays advisory; nothing here promotes it.
- No outcome-level eval, no control arm, no fixture repository. Slice E3.
- No second metered run beyond the one R1 needs. This slice buys one baseline, not a trend.

## Decisions

### D1 — R1 is a task with a stated human prerequisite, not an automatable step

The first metered run needs two things no part of this repository can supply: a model credential (`ANTHROPIC_API_KEY`) and the early-access enablement variable (`CLAUDE_CODE_WALNUT_SPIRE=1`). The archived `baseline.md` already records both as absent, and the gate spec already requires that enablement come from the environment and never from committed settings — so provisioning is a human configuration action by design, not an oversight.

The task list therefore carries R1 as a single explicitly-blocked checkbox whose prerequisite is written into the task text: a human with account access exports both variables and runs the command the archived `baseline.md` already spells out (`--tag smoke --runs 1 --ablation none --no-publish`, ceiling resolved from `interlock limits --json`). An implementer without those variables stops at that checkbox and says so; it does not get "worked around" by fabricating a results file, which would defeat the entire point of the slice.

*Alternative rejected:* synthesising a plausible results file to unblock R2. That reproduces the exact defect the slice exists to fix — an assumed schema dressed as evidence — and would be worse than the current state, because the current state is honestly labelled `DEFERRED`.

### D2 — R3 and R4 land immediately; R2 lands the moment R1 does

Landing order and the credential dependency:

| Requirement | Needs a credential | Blocked by |
|---|---|---|
| R4 (tracked workflow assertion) | no | nothing |
| R3 (cap readers + extended invariant) | no | nothing |
| R1 (first baseline) | **yes** | a provisioned credential and enablement variable |
| R2 (results fixture + triage test) | no, but needs R1's output file | R1 |

R3 and R4 are ordinary offline work and should be implemented and merged without waiting. R2's only input is the file R1 produces, so it is written against a file that does not exist yet; it cannot be started earlier and must not be started with a stand-in. Three of the four requirements are therefore landable on the day the run happens, and two are landable today.

R3 must land before or with R4 in one respect only: both touch the same test surface (`test/spine/limits.test.mjs` for R3; a tracked-file assertion for R4), and R3's extension of the invariant to `.github/workflows/` makes the eval workflow file load-bearing for a test — which is an additional reason R4's assertion should exist. Ordering them R4 then R3 keeps that dependency pointing forwards.

### D3 — `runsPerCase` becomes the `--runs` the scheduled full-suite job passes (recommendation adopted)

Evaluated against the code, the review's recommendation holds. The full-suite job passes no `--runs` today and inherits each case's own `runs:` value — which is `1` for six of eight cases and `3` for the two cases carrying judged graders. That is precisely backwards for the scheduled arm: the review's §G8 argument (single-run pass@1 wobbles even at temperature zero; a workflow that asks nothing needs pass^k) applies hardest to the run that is off the critical path and can afford repetition, and per-case `runs: 1` values were chosen for the fast per-change subset.

So: the scheduled job resolves `evals.runsPerCase` from `interlock limits --json` exactly as it already resolves `evals.fullRunCostUsd`, and passes it as `--runs`. The smoke job keeps `--runs 1`, which is not a restatement of the cap — it is the single-run posture of the per-change subset, a different thing that happens to be a number.

*Consequence to accept deliberately:* the scheduled run's cost rises, because six cases that ran once now run the published number of times. `fullRunCostUsd` bounds it, and a breached ceiling reports partial rather than passing (gate spec, "A cost ceiling bounds every metered run"). Both ceilings were always first guesses to be tuned from observed `cost_usd` (archived design D15); this makes the first scheduled run's cost the input for that tuning. If the scheduled run comes back partial on the ceiling, the fix is to tune `fullRunCostUsd` from the observed number — not to un-wire the cap.

*Alternative rejected:* removing `runsPerCase` alongside `reportingThreshold`. It has a real governing path (how many trials the unhurried arm buys), that path is currently ungoverned, and E2's promotion rule (R7) needs a published trial count to reason about. Removing it would delete a cap that is about to be needed.

### D4 — `reportingThreshold` is removed from `EVAL_CAPS` and from `formatLimits()` together (recommendation adopted)

Also holds against the code, and more strongly than the review states it. `reportingThreshold: 1` is documented as "score at or above which a completed run reports a case as passing", but `lib/evals-triage.mjs` never reads a score: `classifyCase` branches on each grader's `passed` boolean, on whether the grader is judged, and on the run count. There is no score anywhere in the module, so there is no path the threshold could govern without inventing one. Publishing it tells a contributor reading `interlock limits` that a scoring rule exists that does not.

Removal follows the `memoryEntriesPerRun` precedent set in `lib/limits.mjs` — removed rather than wired, because wiring it would have meant inventing an enforcement point to justify a number — and gets the same treatment: gone from the object, gone from the printed rows, and pinned by a test asserting both, mirroring the existing `memoryEntriesPerRun` removal test.

**This has a spec consequence that must land with it.** Two `evals/gate` scenarios describe a case scoring "below the reporting threshold". With the threshold removed those scenarios describe a rule that exists nowhere, so the delta restates them in terms of what the job actually reports — the triage verdict. That is the `evals/gate` MODIFIED block; it is not optional tidying.

One artefact of that restatement is deliberate and worth flagging to a reviewer: the scenario heading "Completed run below threshold is reported as a regression" is kept verbatim even though its body no longer mentions a threshold. `openspec validate --strict` rejects a MODIFIED block that drops a scenario the current spec still has, and a scenario heading is its identity — so renaming it here would delete it at archive time. The stale word survives in one heading; renaming it is a separate, purely editorial change.

*Alternative rejected:* keeping `reportingThreshold` and giving triage a score-based path. That is a new triage behaviour with no requirement asking for it, and it would duplicate the boolean rule the triage spec already fixes. If a future change gives the harness a numeric score triage should consume, it reintroduces the cap with its reader in the same change.

### D5 — The extended invariant matches published field names, and a group forward is not a reader

Three properties the implementer must get right, because the obvious implementation fails:

1. **Two accepted tokens per cap.** A `lib/`, `bin/` or `workflows/` reader names a cap as `EVAL_CAPS.<cap>`; a CI reader names it as `evals.<cap>`, the field the CLI publishes. Matching only the export name would fail every eval cap on day one; matching only the published name would fail every `LIMITS` cap. The check accepts either token for a given cap group, derived from that group's published field name.
2. **`evals: EVAL_CAPS` must not count.** `bin/interlock:1429` forwards the whole group to the printed surface. A matcher that looked for the bare identifier `EVAL_CAPS` would find it there and mark every cap in the group read, restoring the exact blindness being removed. The matcher requires the per-cap token, never the group name alone — which the existing `LIMITS.<cap>` matcher already does by construction.
3. **A fourth search root.** `.github/workflows/` joins `lib/`, `bin/` and `workflows/`. The walk currently excludes only `lib/limits.mjs`; nothing else changes about it. `REPORT_CAPS` and `EFFORT` stay out of scope here — this slice extends the check to `EVAL_CAPS`, and extending it further is a separate judgement about objects nobody has reported as unread.

If `.github/workflows/` is absent from a checkout, the eval caps lose their readers and the invariant fails. That is the correct outcome and it duplicates R4's signal rather than conflicting with it: two tests naming the same missing file is not ambiguity.

### D6 — R4 asserts tracking via `git ls-files`, and skips with a stated reason outside a checkout

GitHub requires workflow definitions to live in `.github/workflows/`, so "move the file out of the ignored directory" is not available. The assertion is the whole mechanism: run `git ls-files .github/workflows/evals.yml` with `node:child_process` and assert non-empty output.

Where version-control status cannot be determined — a published tarball, an export with no `.git` — the test skips and states why, rather than passing silently or failing a non-git consumer. Silent degradation is the failure mode this repo forbids; a skip that names its reason is not silent. The repo already carries one skipped test, so a second is not a new pattern.

*Alternative rejected:* removing `.github/workflows/` from `.gitignore`. It is tempting as the root fix, but it is not one: un-ignoring makes new files under the directory visible to `git status`, it does not make an already-tracked file stay tracked, and it does not detect the loss. The ignore also sits deliberately alongside `.github/agents/`, `.github/prompts/` and `.github/skills/` — host-generated directories the repo does not want tracked — so narrowing it is a separate decision about host-integration hygiene, out of this slice's scope. The assertion is needed either way; the ignore change is not.

### D7 — The fixture is the run's own results file, redacted by removal, stored outside `evals/`

- **Location:** `test/fixtures/evals/`. Not under `evals/`, which is the harness's discovery root and is walked by `test/evals.test.mjs`'s structural gate — a results file there would be scanned as a case directory.
- **Redaction is removal, not rewriting.** Any credential, environment dump, transcript body or prompt text is deleted from the committed copy; the fields triage reads (`cases[].id`, `loaded`, `runs[].graders[].name`/`type`/`passed`, and the top-level `partial`/`complete`/`reason` when present) are kept byte-for-byte. Editing a retained value would forge the very evidence the fixture exists to be. What was removed is stated in a comment beside the fixture.
- **The asserted verdict is the run's own.** The test asserts the verdict the harness run actually produced. If triage's computed verdict contradicts the run's own report, that is a defect to record, not an assertion to tune — the triage delta says so as a scenario, because "make the test match the code" is the default failure mode here.
- **What one smoke fixture pins, and what it does not.** The smoke subset is four cases, all deterministic graders, one run each, expected to pass. So the fixture pins the case-shape, the grader-shape, the `passed` field and the clean-pass branch. It does **not** pin the judged branch, the indicator branch, the `loaded: false` branch, or the partial-run branch — those stay hand-built. The triage delta requires the unpinned parts to be named rather than presumed, and the fixture's comment is where they are named.

### D8 — No new dependency, and no YAML parsing

Everything here is stdlib: `node:test`, `node:fs`, `node:child_process`, `JSON.parse`. The invariant test searches workflow files as text (`includes`), exactly as it searches `.mjs` sources today — it does not parse YAML, so no YAML dependency is implied. `package.json` gains no `dependencies` key.

## Risks / Trade-offs

**The smoke fixture pins the branch least likely to break** → Accepted and stated rather than hidden. The clean-pass path is the one a schema change would break most visibly anyway (a renamed `cases` or `passed` field breaks it immediately), and the triage delta forces the unpinned branches to be named. A later full-suite run yields a richer fixture; this slice does not buy one.

**`lib/evals-triage.mjs` may already misclassify judged graders, and this slice will not detect it** → Record it, do not silently absorb it. The harness's grader types are `regex | tool_order | tool_used | file_exists | llm | baseline` (read from `test/evals.test.mjs`), and triage's `JUDGED_TYPES` is `judge | judged | model-judge | llm-judge | semantic` — which contains neither `llm` nor `baseline`. If the results file reports a grader's type using the harness's vocabulary, a judged dip would be classified as a deterministic regression on a single run. The same doubt applies to indicators: cases mark them `arm: with-only`, while `isIndicator` looks for `type: 'indicator'` or `indicator: true`. **Neither is in this slice's scope** — R1's smoke run carries no judged grader and no indicator, so its fixture cannot settle either — and neither should be "fixed" speculatively here, because guessing a second time is what got the module into this state. The correct disposition is a recorded finding that the first *full-suite* run must check, carried into the Slice E2 change. This design records it; the tasks do not act on it.

**The scheduled run gets more expensive under D3** → Bounded by `fullRunCostUsd`, and a breach reports partial rather than a false pass. The first scheduled run after this lands is the input for tuning that ceiling, which the archived design already anticipated (D15).

**R1 may stay unblocked indefinitely** → Then R2 stays unwritten and the slice lands two of four requirements, which is strictly better than today. The failure mode to avoid is not "R1 waits"; it is "R1 gets faked to make the checkbox green". D1 and D7 both close that door explicitly, and `baseline.md` staying honestly `DEFERRED` is an acceptable end state for that half of the slice.

**The first run may itself come back partial, or as a configuration verdict** → That is data, not a blocked task. The gate spec's baseline requirement admits a partial recording: the cases that ran carry scores, the rest carry none, and the record says the run was partial. R2 can still take the fixture from a partial run, provided the test asserts the no-signal verdict that run actually produced.

**Removing a published cap is a visible surface change** → `interlock limits` loses one printed row. Nothing in `skills/`, `docs/` or the workflow YAML restates `reportingThreshold` (its only mentions are `lib/limits.mjs`, the printed row, and the archived `baseline.md`'s record of what the CLI published on 2026-08-26 — an accurate historical statement that is not edited). A grep for the token before removal confirms the blast radius.

## Migration Plan

No runtime migration; nothing persisted changes shape.

1. Land R4 (tracked-file assertion) and R3 (cap wiring, cap removal, extended invariant, gate-spec restatement) together as ordinary offline work, verified with `npm test`.
2. A human provisions the credential and enablement variable and performs R1's run, pasting the observed scores and `cost_usd` into `baseline.md`.
3. R2 follows immediately, using that run's results file.

**Rollback:** each step is independently revertible. Reverting R3 restores the printed row and the exemption comment; reverting R4 removes one assertion; R1 and R2 are additive files.

## Open Questions

- Whether `REPORT_CAPS` and `EFFORT` should also come under the extended reader invariant. Deferrable: they are not reported as unread, and adding them changes no requirement in this slice, only how wide the same check sweeps.
- Whether the redacted fixture is small enough to commit as-is, or needs the harness's per-run transcript references pruned further. Answerable only once a real results file exists; it changes the fixture's size, not the specs or the task breakdown.
