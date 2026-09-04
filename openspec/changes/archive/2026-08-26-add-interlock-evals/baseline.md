# Eval baseline — add-interlock-evals

## Status: RECORDED — first metered smoke run, 2026-09-04

The first smoke-suite baseline run was executed on 2026-09-04 under a provisioned
model credential and `CLAUDE_CODE_WALNUT_SPIRE=1`. Its observed scores, cost and
exact parameters are recorded below. The results file is committed, redacted, as
the fixture `test/fixtures/evals/smoke-2026-09-04.json`.

Per design D3 the gate stays **advisory**; no threshold is tuned from this single
run. This is the first observed baseline, not a trend.

> Superseded state (kept for the record): before this run the environment had no
> model credential and no early-access enablement, so the run was correctly
> `DEFERRED` rather than faked — the path design D12 was built to survive.

## Verified offline (task 4.1's non-metered half)

- `npm test` — **1171 pass, 0 fail** (includes the new `test/spine/evals-triage.test.mjs`
  and `test/evals.test.mjs` structural gate over `evals/**`).
- `claude plugin validate . --strict` — **passed**.
- `interlock limits --json` publishes the eval caps (`smokeCostUsd`,
  `fullRunCostUsd`, `runsPerCase`, `reportingThreshold`).

## How to record the baseline once a credential exists

```bash
export CLAUDE_CODE_WALNUT_SPIRE=1
CEIL=$(interlock limits --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).evals.smokeCostUsd))')
claude plugin eval . --tag smoke --runs 1 --ablation none --no-publish \
  --max-cost-usd "$CEIL" --json evals-results.json
interlock evals triage --results evals-results.json
```

Then paste the per-case scores below as the first observed baseline. **Do not
tune a threshold from a single run** (design D3): the gate stays advisory until
run-to-run variance is observed across more than one run.

### Smoke cases in scope

- `handoff-status-enum` — handoff `status` ∈ {ok, blocked, partial}
- `tier-read-scope` — a tier-1 lane reads neither design.md nor the delta specs
- `cited-cap-resolution` — the implementer resolves the char cap via `interlock limits`
- `control-plane-action` — a ping copies the CLI's `action`, never inventing one

### Observed scores — 2026-09-04

Exact parameters: `claude plugin eval . --tag smoke --runs 1 --ablation none
--no-publish --max-cost-usd 2 --json <file>`; ceiling `2` resolved from
`interlock limits --json` (`.evals.smokeCostUsd`); harness `claude` 2.1.260,
results `schemaVersion: 1`; `ablation: none`, one run per case.

- Run `cost_usd`: **0.7222594999999999** (under the `$2` smoke ceiling).
- Run self-report: `partial: false`, `aggregates.casesPassed: 3` of `4`,
  `overallScore: 0.75`.

| Case | Score | Passed | Graders (name = passed) |
|---|---|---|---|
| `cited-cap-resolution` | 1 | ✓ | `limits-invoked` = true |
| `control-plane-action` | 1 | ✓ | `action-copied` = true, `no-invented-action` = true |
| `handoff-status-enum` | 1 | ✓ | `status-enum` = true |
| `tier-read-scope` | 0 | ✗ | `no-design-read` = false, `no-spec-read` = false |

`tier-read-scope` is a real failure the run recorded: the tier-1 lane read
`design.md` and/or the delta specs it is scoped out of, so both deterministic
graders failed. It is data, not a blocked task — recorded as observed.

### Triage disagrees with the run — recorded defect

`interlock evals triage --results <file>` returned **`pass` — "scored 4:
0 regression, 0 variance, 4 pass"**, exit `0`, contradicting the run's own
`3 of 4` report. Per `evals/triage` ("Triage disagrees with the run's own
report") this is recorded as a defect and **not** reconciled by tuning any
assertion.

Root cause: `lib/evals-triage.mjs` reads `cases[].id` and `cases[].runs[]`, but
`schemaVersion: 1` writes `cases[].name` and `cases[].arms.with[]`. Every case's
`runs` therefore resolves to `[]`, the grader loop never runs, and every case
falls through to `pass`. Triage never observes `tier-read-scope`'s failure.

Fixing triage's schema reading is out of this slice's scope (design Non-Goals;
carried into the Slice E2 change). Until it lands, the fixture-backed triage test
(task 5.1) cannot assert the run's true verdict without asserting the bug, so 5.1
is recorded as blocked on this defect rather than completed. See
`test/fixtures/evals/README.md`.

## Provenance sweep of the spec path — 2026-09-05 (R9, harden-eval-suite-hygiene)

The five model-facing surfaces with no eval case were swept for **observed
model-behaviour failures** — a model that read correct instructions and did the
wrong thing anyway. Cases are authored only where such a failure is on record;
the alternative, seeding one hypothetical per uncovered surface so coverage looks
complete, is the failure the case-suite spec and the `evals` skill both refuse.

**Result: no observed failure was found on any of the five. No case was authored
from this sweep.** That is the finding, recorded rather than closed.

### Surfaces swept, all recorded unexercised-no-provenance

- `skills/spec/SKILL.md`
- `skills/spec/continuity.md`
- `skills/review-artifacts/SKILL.md`
- `skills/review-code/SKILL.md`, its six `dimensions/*.md`, and `REVIEW.template.md`
- `skills/explore/SKILL.md`
- `skills/bootstrap/SKILL.md`

### Sources read, and what each held

| Source | State | Hits on the five surfaces |
|---|---|---|
| `openspec/changes/archive/*/proposal.md` `## Why` | 23 files, non-empty | 3 mentions, **0 observed failures** |
| `CHANGELOG.md` | 296 lines, non-empty | 4 mentions, **0 observed failures** |
| `.docs/WORKFLOW-REVIEW-2026-08-21.md` | non-empty | 5 mentions, **0 observed failures** |
| `.claude/ship/runs` | **non-empty** — 2 trajectories, 7 events | 0 — every event is a ship-loop `wave-action` / `cli-exit` / `agent-spawn`; none reaches these surfaces |
| `.claude/learning` | **absent — the directory does not exist**, so the outcome corpus was not read at all | not swept |
| `.claude/metrics` | **non-empty** — 10 files | 2 files name a surface, **0 observed failures** |

The run corpora were **not** purged as this change's design predicted. Two ship
trajectories and ten metrics files were present and were read. `.claude/learning`
is the one source that could not be swept, because it does not exist — recorded
here as not-swept rather than as swept-and-empty, which are different facts.

### Why each mention is not provenance

- `add-interlock-report/proposal.md` and `CHANGELOG.md:24` cite
  `skills/review-artifacts` only to explain why metrics files are classified by
  their `schema` key rather than by filename. A corpus-shape fact, not a model
  failing.
- `add-dependency-aware-wave-planning/proposal.md` cites
  `skills/spec/SKILL.md:131-139` as evidence that no per-task dependency signal
  existed. A gap in the tool, not a model talking past an instruction.
- `add-interlock-review-policy/proposal.md` cites `skills/review-code` as the
  thing a team would have to fork. An architecture gap.
- `WORKFLOW-REVIEW-2026-08-21.md:99` (`continuity.md` self-reports the blocker
  count that gates it) and `:107` (`SKILL.md:139` claims `agent_resolved`
  requires an id in `design.md`; no lib file reads `design.md`) are **structural
  vulnerabilities verified by reading files**. Both are real, and neither is an
  observation of a model exploiting them. Authoring a case from either would be a
  regression test for a failure nobody has seen.
- `WORKFLOW-REVIEW-2026-08-21.md:205` records that `ship --review` points no
  reviewer at `skills/review-code/dimensions/*.md`. That is a wiring gap in
  `workflows/ship.js` — the rubric is never delivered — so there is no
  instruction a model read and talked past. An eval here would grade a model on
  criteria it was never shown.
- `WORKFLOW-REVIEW-2026-08-21.md:311` (the fourth review dimension has two names)
  is a static inconsistency a `node:test` assertion decides, which the `evals`
  skill refuses to duplicate in a metered case.
- The two `.claude/metrics/review-artifacts-*.json` files that name
  `skills/spec` and `skills/bootstrap` contain findings the reviewer produced
  **about another change's artifacts**. They are the review skill working, not
  failing.
- `WORKFLOW-REVIEW-2026-08-21.md:346` states `skills/bootstrap/SKILL.md` was
  **not audited**. So bootstrap's absence of provenance is partly an absence of
  looking, and that distinction is recorded rather than flattened into "no
  failure found".

### Cross-check against the R10 coverage report

`test/evals.test.mjs` prints the coverage partition on every run. At the time of
this sweep it reported 4 of 53 model-facing surfaces exercised, and listed every
surface above as unexercised **except one**: `skills/explore/SKILL.md` now counts
as exercised.

The two records do not disagree. `skills/explore/SKILL.md` is exercised by
`evals/skill-routing-explore/`, which is a **gap-class twin** (`twin_of:
skill-routing`) authored to supply the opposite side of a conditional
instruction — not a case encoding an observed failure. Explore therefore has a
case and still has no observed-failure provenance, which is exactly why
`twin_of:` exists as a separate field: without it the two citation kinds are
indistinguishable free text and a reader counts a twin as evidence of a failure
nobody saw. No other surface differs between the two records.
