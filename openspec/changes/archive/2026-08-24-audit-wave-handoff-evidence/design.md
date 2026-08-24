## Context

See proposal.md — Why. The state this design has to fit:

```
IMPLEMENTER returns                    STORED TODAY
─────────────────────                  ────────────
{ ok, filesChanged[], handoff }        state.handoffs[taskId] = handoff
        │         │                            ▲
        │         └── DROPPED ─────────────────┘  (absent from lib/waves.mjs)
        │
        └── handoff.evidence[]  validated for SHAPE only
                                validateHandoff → EVIDENCE_LOCATOR
                                /^[^\s:]+(:\d+(-\d+)?)?$/
```

`lib/review-core.mjs` already solved the same problem for review findings, and its `hasEvidence(verdict, diff)` is the shape this design copies: a pure predicate taking the changed-path set as an argument, two conditions, path membership only, no semantic judgement. It also already owns the pieces — `CITATION_TOKEN`, `citesLineIn`, `canonicalizePath`, `diffIndex` — which is why this change extracts rather than reimplements.

Module purity constraints:

- `lib/waves.mjs` is pure (`deepFreeze`, no fs, no clock). The predicate must therefore take the path set as input, not fetch it.
- `lib/drift.mjs:40` establishes the precedent for git in `lib/` via `execFileSync('git', …)`, wrapped so it never throws.

## Goals / Non-Goals

**Goals:**

- Close the `lib/nowhere.ts:1` hole on handoff packets, using the definition of "locator" the codebase already has.
- Observe the path set at the only moment it is meaningful.
- Make the verdict's provenance legible: observed path set vs. self-reported one.

**Non-Goals:**

- No semantic check. Whether the cited span supports the summary is out of scope, by `review-core`'s own argument.
- No line-existence check. Explicitly excluded to avoid false rejections.
- **No gate.** No halt, no failure-budget entry, no continuity input. This change adds a recorded verdict and nothing that reads it for a decision.
- No per-agent or per-lane attribution of the changed-path set beyond what `record-batch` is already given per task.

## Decisions

**Decision 1: extract the locator vocabulary into one shared home rather than duplicating it.**

`review-core`'s `CITATION_TOKEN`, `citesLineIn`, `canonicalizePath`, and `diffIndex` move to a shared pure module; `review-core` and `waves` both import them. The alternative — a second regex in `waves.mjs` — was rejected because two definitions of "what a locator looks like" will drift, and the drift would be silent: each surface would keep passing its own tests.

Note the two surfaces already disagree slightly. `validateHandoff`'s `EVIDENCE_LOCATOR` anchors the whole string (`^…$`) and forbids colons in the path; `review-core`'s `CITATION_TOKEN` scans within free text and tolerates a trailing `:column`. Handoff evidence is an array of discrete locators, review evidence is prose, so both behaviors are correct for their input. The extraction shares the canonicalizer and the membership test, **not** the anchoring — stated here so an implementer does not "unify" them into one regex and loosen handoff validation as a side effect.

**Decision 2: git is the authority; the packet's `filesChanged` is the declared fallback.**

At `record-batch` the CLI resolves the changed-path set from version control and passes it to the pure predicate. When git is unavailable the predicate is given the task's own `filesChanged` instead, and the verdict records `source: "observed" | "reported"`.

This distinction is the whole point. Auditing self-reported evidence against a self-reported path set is a consistency check, not verification — it catches an agent that contradicts itself, not one that fabricates coherently. Recording the two cases identically would present the weaker check as the stronger one, which is the defect class this whole change set exists to remove. So the fallback is kept (a consistency check beats nothing) and labeled.

Alternatives considered:

- *Only ever use `filesChanged`.* Rejected: pure, simple, and never rises above self-consistency.
- *Only ever use git, `not-audited` otherwise.* Rejected: discards a real signal whenever the run is in a worktree or sandbox where git is awkward, which is common.

**Decision 3: which git question to ask.**

`git status --porcelain` at `record-batch` time reports the working tree's uncommitted changes — which, mid-run and pre-commit, is the accumulated diff of *this run*, not of this task. So membership confirms "a path this run touched", not "a path this task touched".

That is weaker than ideal and it is accepted, because the stronger version is not available: tasks in a wave run concurrently against one working tree, so no git question can attribute a path to a lane. The narrower cross-check — is this path in the task's *own* reported set — is still performed, and the two together read as: the path is one the run demonstrably changed, and the task claimed it. Both conditions are recorded so a reader can tell which held.

This is stated in the spec as an aggregate, not sold as per-task attribution.

**Decision 4: three verdict values, and `not-audited` is not a synonym for failure.**

`confirmed` / `unconfirmed` / `not-audited`. The third exists because "we could not check" and "we checked and it failed" are different facts, and collapsing them would make an unavailable git binary look like a fabricating agent. This mirrors the tri-state discipline in `lib/outcomes.mjs` (`null` means "nobody said", not "no").

**Decision 5: record the verdict, and make the no-gate rule a spec requirement rather than a convention.**

The spec carries an explicit requirement that the verdict does not affect control flow, with a scenario asserting a run of entirely-unconfirmed packets still completes. Without that, the first person to read a corpus full of `unconfirmed` verdicts will reasonably reach for a threshold, and a halt built on an aggregate check whose per-task attribution is admittedly weak (Decision 3) would stop good runs.

**Decision 6: the invariant is "evidence is auditable against a changed-path set"; every consumer of stored evidence is in scope.**

| Consumer of stored handoff evidence | In scope |
|---|---|
| `recordBatchResult` — stores packets | yes: stores `filesChanged` + verdict |
| `nextStep` — hands previous wave's packets forward | yes: must pass verdicts through, unchanged behavior |
| `assembleImplementerPrompt` — renders `evidence:` into prompt text | **no change**: an unconfirmed packet still renders identically. Annotating the prompt with audit verdicts would tell an implementer to distrust its predecessor on a signal that is admittedly aggregate. |
| `formatRunState` — CLI rendering | yes: surfaces the verdict |
| `checkResultFieldSizes` / handoff char cap | no: verdicts are not part of the counted budget |

The prompt-rendering row is a deliberate non-change and is listed so the sweep does not read as an omission.

## Risks / Trade-offs

**Membership is run-scoped, not task-scoped (Decision 3)** → A task can cite a path a *sibling* task in the same wave changed and be `confirmed`. Mitigated by also recording the task's own reported-set match, so both conditions are separable by a reader. Not mitigated further, because per-lane git attribution is not obtainable.

**`git status` cost at every `record-batch`** → One subprocess per batch, negligible against a wave of agent turns. Guarded by the never-throw wrapper so a slow or missing git degrades to `reported`/`not-audited`.

**A repository with unrelated uncommitted changes inflates the observed set** → A dirty tree from before the run makes membership easier to satisfy, weakening the check. Accepted and unmitigated: narrowing it would require a baseline snapshot at run start, which is a larger change than this one and belongs with the receipt work if it is wanted.

**Extraction touches `review-core`, which is gated code** → `review-core` feeds the artifact-review blocker count that `spec/continuity-provenance` governs. A refactor there must be behavior-preserving. Mitigated by extracting without altering `hasEvidence`'s logic and keeping its existing tests green as the contract.

**Someone wires a gate to the verdicts later** → Partly mitigated by the spec requirement. Fundamentally this is a governance risk, not a technical one, and the requirement is the strongest available lever.

## Migration Plan

Additive to the run state. A state written before these fields exists is handled the way `recordBatchResult` already handles the pre-handoff case (`if (!next.handoffs || typeof next.handoffs !== 'object') next.handoffs = {}`) — initialize the missing container rather than reject the state.

No data migration. Old trajectories and old states carry no verdicts, which reads as `not-audited` by absence. Rollback is a revert; the extra state fields are ignored by the prior code.

## Open Questions

- Whether the observed path set should be narrowed by a baseline captured at run start, to exclude pre-existing uncommitted work. Deferrable: it changes the *strength* of the observed source, not the shape of the verdict, the specs, or the task breakdown. Worth revisiting once there are enough verdicts to see whether `confirmed` discriminates at all — if nothing ever comes back `unconfirmed`, the check is free but uninformative, and that is the signal to tighten it.
