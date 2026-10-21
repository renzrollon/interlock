## Context

See proposal.md — Why. This document covers how, and one thing the proposal deliberately did not: the enumeration of every reader of a value this change canonicalizes.

Three constraints shape the approach:

**The change edits its own gates.** Every fix here lands in the machinery that gates this repo's changes. A ship run of this change is therefore gated by the *pre-change* versions of the very predicates it repairs. Ordering has to keep the `lib/` fixes ahead of the `workflows/ship.js` edits that read them, and the completion-gate fix ahead of anything that would rely on it.

**The reviewers already ran the red state.** Several of the tests this change needs were written and executed during the review, with reported outcomes: the assembled-prompt test fails twice and is fixed by deleting one character; the collision invariant passes over 500 randomized plans while normalization fails; the evidence-gate test fails on all five probe inputs. That is a known-red baseline, not a guess, so implementation starts from a failing test rather than producing one.

**There is a canonical path transform already, and it is private.** `lib/risk.mjs:128` defines `normalizePath` — trim, backslash to forward slash, strip leading `./` — and `classifyRisk` reads paths through it. `lib/waves.mjs` does not. That asymmetry is the whole of defect 2: one module treats predicted paths as canonical identities, its sibling treats them as strings.

## Goals / Non-Goals

**Goals:**

- One canonical form for a predicted path, defined once, read by every consumer.
- Every substance gate replaced by a **shape predicate**: deterministic, testable, no second model in the loop.
- Prompt correctness asserted against assembled output, as a general rule rather than for one prompt.
- Every cap derived from `lib/limits.mjs` at its point of use; every cap it prints traceable to a reader.
- Docs and skills that describe a changed gate updated in the same change, so no claim outlives its implementation.

**Non-Goals (design-level, beyond the proposal's scope exclusions):**

- **No semantic evidence checking.** This design will not attempt to judge whether a cited span *supports* the claim. That needs a model, and putting one there recreates the problem one layer down. Shape plus diff-membership is the ceiling.
- **No new path resolution against the filesystem.** Canonicalization is lexical. A predicted path names a file that may not exist yet, so `realpath` and `existsSync` are both wrong instruments.
- **No change to the survival rule.** Whether one skeptic keeps a finding is an architectural question about correlated error, listed in the proposal's non-goals. This change only fixes what counts as a vote.
- **No repair of `--continue`'s reachability.** The review notes 15 of 16 scenarios are unmapped on this repo's own change, making continuity effectively dead code. That is a spec-authoring problem, not a gate defect.

## Decisions

### D1 — Canonicalize predicted paths once, at plan ingestion, and export the one transform

**Decision.** Promote `normalizePath` in `lib/risk.mjs` to an exported `canonicalizePath`, strengthen it beyond `./`-stripping to also collapse `.` and `..` segments, collapse duplicate separators, and drop a trailing separator. Apply it in `lib/waves.mjs` at the point where a plan's tasks are validated — the boundary — so the canonical form is what every downstream reader sees. Keep the authored spelling alongside it for reporting.

**Why here.** `shared/INVARIANT-SWEEP.md` requires the transform to live in one place and every consumer to read the canonical form; scattering it across call sites guarantees one gets missed. `lib/risk.mjs` already owns path interpretation for this repo (`DOC_PATH`, `isDocsPath`, risk signals), so it is the boundary that already exists rather than a new one.

**Alternative rejected — normalize inside `collisionAwareChunk` only.** This is the one-line fix the review proposed, and it closes the reported defect. The sweep below shows it would leave two other raw-form keys in the same file. Fixing the reported call site while sibling readers stay on the raw form is how the original bug survives the fix.

**Alternative rejected — `path.resolve` / `path.relative` against the repo root.** Produces absolute paths, touches the filesystem semantically, and silently rewrites an escaping path into something in scope. `path.posix.normalize` on a validated-relative string is lexical and sufficient.

#### Invariant sweep — every reader of a predicted path

Structural pass by grep over `lib/`, `bin/interlock` and `workflows/ship.js`; `lib/graph/` excluded as unrelated. Each reader classified as canonical or raw:

| Reader | Reads | Verdict |
|---|---|---|
| `lib/waves.mjs:123-125` — plan validation | shape only, no comparison | **Boundary.** This is where D1 applies the transform |
| `lib/waves.mjs:150-151` — `claimed` collision map key | **raw** | **BLOCKER.** Defect 2 as reported |
| `lib/waves.mjs:196` — `uniquePaths` `seen` dedup key | **raw** | **BLOCKER.** A second raw dedup key in the same file, feeding the changed-file list a verification receives. Not in either review |
| `lib/waves.mjs:187` — `isDocsOnlyWave` via `isDocsPath` | raw, but `isDocsPath` lowercases and its regex tolerates a leading `./` | **Latent.** Accidentally robust today; becomes correct-by-construction under D1 rather than by regex luck |
| `lib/risk.mjs:139` — `classifyRisk` | canonical, via the private transform | **Correct.** Becomes the shared definition |
| `workflows/ship.js:658-659` — `wavePaths` for the verify plan's `--changed` | **raw** | **Defect.** Duplicate spellings inflate the changed set. Fixed by consuming canonical paths from the plan |
| `bin/interlock:856` — `--paths` for risk | canonical downstream via `classifyRisk` | **Correct** |
| `bin/interlock:897-899` — `--paths` for readiness | passes through to risk | **Correct** |

Two of the three blockers were not reported by either reviewer. That is the sweep earning its place: the review found the collision key by reading the collision code, and `uniquePaths` is thirty lines away doing the same wrong thing for a different consumer.

**Reporting invariant.** `serialized[]` entries, the plan file, and the changed-file list keep the authored spelling; only comparison uses the canonical form. Rationale: a report naming a path the task author does not recognize is a worse report.

### D2 — Dismissal evidence is a shape predicate plus diff membership

**Decision.** Replace the non-emptiness test in `lib/review-core.mjs` with: the evidence string must contain a `path:line` or `path:startLine-endLine` token, and the path in that token must canonicalize (D1) to a path present in the reviewed diff. Failure yields a **non-vote**, preserving the existing distinction — the verdict is not deleted, so its quality score still reaches the tolerance band.

**Why two conditions.** Shape alone is defeated by inventing `lib/a.ts:1`, which the review confirmed passes today as a bare filename. Diff membership is the cheap half that makes the citation refer to the work under review. Both are deterministic.

**Why not require the line to exist in the file.** Tempting and rejected: a review runs against a diff, the file on disk may have moved on, and a valid citation to a deleted line would be rejected. Path membership is the strongest condition that cannot produce a false rejection.

**Direction.** The requirement applies only to dismissing verdicts. An uncited *confirming* verdict still counts, because that direction resolves toward a human reading the finding — the cheap error. The review notes this asymmetry is currently absent in the other direction too; making confirmations cite would drop real findings, so it stays asymmetric on purpose.

### D3 — Out-of-enum severity is a rejection, not a bucket

**Decision.** `lib/findings.mjs` normalizes severity by casing and surrounding whitespace, then rejects any value outside the enum with a named error. The current `counts.unknown` bucket stops being a silent destination for `"critical"`.

**Rationale.** The bug is that a *more* alarming word than the enum's maximum currently passes the gate more easily than the maximum itself. Casing and whitespace normalization is folded in because that is the transform boundary this value has, and the spec's edge case exercises it.

### D4 — Readiness derives the blocker count from the findings file

**Decision.** Add `interlock ready --findings <path>`. It reads the artifact review's own findings output and runs `evaluateGate` — the same evaluation the review gate uses — to compute the blocker count. `--review <path>` is retained for one release, warns, and no longer satisfies the review-blockers check on its own. When both are passed and disagree, the findings-derived count decides and the disagreement is reported. `skills/spec/continuity.md` stops writing a count file and passes the findings path instead.

**Why reuse `evaluateGate`.** `lib/findings.mjs:269` already computes `autonomyOutcome: { blockers: blockers.length }` from real findings and the value is discarded. A second counting implementation would let the readiness gate and the review gate disagree about the same findings file, which is the divergence class `extractScenarios` is already shared to avoid.

**Fail-closed on unreadable input.** Absent, empty and unparseable findings all resolve to *the review did not run*, never to zero. This matches `readReview`'s existing stance — the module comment already calls it "the gate's softest spot" — and extends it to the new input.

### D5 — Ledger references are resolved against `design.md`

**Decision.** `lib/ledger.mjs` gains an optional design-text argument. When present, an `agent_resolved` row must carry a reference id that appears in that text; when the design document is absent or unparseable, the reference is unresolvable and the row is invalid. `EMPTY_MARKERS` gains `obvious` and the hedges that mean the same, matched after the existing lowercase-and-trim normalization. `interlock ledger <change>` exits non-zero when `decisions.md` is absent, reporting *missing* distinguishably from *present and empty*.

**Why the design text is passed in, not read.** `parseLedger`/`serializeLedger` are pure by contract, with `readLedger`/`writeLedger` as the thin fs wrappers. Reading `design.md` inside the parser would break that split. The wrapper resolves the path through `artifacts.mjs`, which is already the single definition of where a change lives.

**Reference form.** The id is matched as a token in the design text rather than as a heading, because `shared/DECISION-LEDGER.md` does not constrain where in `design.md` a decision is recorded. A stricter form would invalidate ledgers that comply with the documented contract.

**Breaking, and immediately.** All four active changes in this repo have no `decisions.md`, so this surfaces on the first run. That is the intent: the review found the self-check cannot currently catch its own likeliest failure.

### D6 — Prompt integrity is asserted on assembled output, for every prompt

**Decision.** Extend the technique already proven in `test/spine/implementer-prompt.test.mjs` — delimited marker region, extracted and evaluated via `new Function`, compared against a checked-in fixture — to every prompt `workflows/ship.js` assembles. Add a shared assertion applied to each: no `NaN`, `undefined`, `[object Object]` or literal `null` in the assembled string. Add `test/spine/planner-prompt.test.mjs` for the classifier prompt specifically, asserting all six tier rules are present and that both host drivers state the same routing.

**Why not lint or a parser.** `+ +` is valid JavaScript; no parser flags it. The review's decisive observation is that a grep for the broken sentence *passes on the broken file*, because the bytes are intact and only the concatenation is wrong. Only the assembled string can see this class, which is why the rule is stated as "assemble, then assert" rather than as a new lint rule.

**Coverage is enumerated, not sampled.** The suite reports how many prompts it checked, and a prompt it cannot extract is a failure rather than a silent reduction in coverage. Without that, this change fixes one prompt and leaves the same hole for the next eleven.

**Cross-host comparison compares extracted policy, not bytes.** The two drivers word the ladder differently; requiring byte equality would either fail immediately or force a rewrite outside this change's scope. The comparison extracts tier boundaries and the routing rule.

### D7 — Caps are derived at use; unenforced caps are wired or removed

**Decision.** `workflows/ship.js` derives its remediation bound from `LIMITS.remediationRounds` rather than the literal `3`, and records actual round consumption instead of `Math.min(round, 2)` — which is a constant, since `round` is always one past the bound at loop exit. `test/workflows.test.mjs` gains a guard that the derived bound equals the cap. `RESULT_TEXT_FIELDS` in `lib/verify.mjs` gains `summary`, `message`, `error` and `notes`.

For the two unenforced caps, the two directions are taken differently and on stated grounds:

- **`verifySpillBytes` is wired.** `lib/spill.mjs` imports `LIMITS` and reads only `verifyPreviewChars`; the 8 KB spill *trigger* lives in prose. The threshold has a real governing decision, so it becomes a read.
- **`memoryEntriesPerRun` is removed** from `LIMITS` and from the printed surface, and the docs citing it as enforced are corrected. It has zero references outside its own definition and prose. Memory writing is not implemented as a counted operation, so wiring it would mean inventing the enforcement point rather than connecting one.

**A test asserting a cap equals a number does not count as a reader.** `test/spine/limits.test.mjs:35` asserts `verifySpillBytes === 8192` and is the only reference outside `limits.mjs`. Counting that as enforcement is what let the cap look alive; the cap-authority check excludes value-pinning tests explicitly.

### D8 — Completion gate branches on the verdict; degradation is derived, not accumulated

**Decision.** Before commit, branch on the verification result's `ok` and `unitGreen`, treating an absent field as *not verified*. `interlock tasks tick` exits non-zero on an unmarkable id and the ship loop branches on that exit. The degradation block is computed from recorded run conditions — cap-exhausted verifications, skip reasons, unresolved errors, the closing step's own outcome — rather than from whether the `banners` array happens to be non-empty.

**Why derived.** The current block prints "No degradation banners" whenever nothing pushed to an array. The seven push sites cover graph, test profile, model routing, three skip reasons and e2e; cap exhaustion and unresolved errors push nothing. An accumulator can only report what someone remembered to push, which makes silence indistinguishable from cleanliness — the exact property `docs/06 §13` claims the block removes.

### D9 — Rubrics are read from disk and passed per reviewer

**Decision.** The review fan-out reads `skills/review-code/dimensions/<dimension>.md` and includes that text in each reviewer's instructions, and in each re-reviewer's instructions after remediation. A dimension whose criteria cannot be read is reported as a degradation via D8. Dimension name resolution is made single-valued: the review notes the fourth always-on dimension is called **delivery** in `README.md:130` and in `skills/review-code/SKILL.md`'s frontmatter, while the dimension table and the rubric file call it **technical-lead** — so `--dimensions delivery` matches nothing. The rubric filename is canonical; the other surfaces are corrected, and an unresolvable dimension name is rejected at selection.

**Cost.** Roughly 285 tokens per reviewer, six reviewers, on `--review` runs only. Set against two skeptics per finding adversarially verifying findings produced with no criteria, this is the cheaper half of the review.

## Risks / Trade-offs

**A stricter evidence gate raises surviving-blocker counts on the first `--strict` runs** → Expected and correct: findings that were dismissed by an emoji now survive. The tolerance band still drops vague findings before the gate counts them, so the increase should be in *cited* findings. If it is not, the quality band's calibration is the next question — not a reason to loosen the citation rule.

**Canonicalization could merge two paths that denote different files** → Mitigated by keeping the transform lexical and rejecting rather than rewriting absolute or root-escaping paths. The spec's edge case asserts both directions: variant spellings merge, genuinely distinct paths do not.

**The ledger break blocks all four active changes at once** → Intended, and the blast radius is bounded: `interlock ledger` exiting non-zero blocks *continuity*, not `ship`. The checkpoint path is unaffected, so the four changes remain shippable by a human reading them. Rollback is reverting one predicate.

**Deriving the remediation bound could change behavior if the cap and the literal disagree today** → They do not: `remediationRounds` is 2 and the literal is 3, which is cap + 1. The derived expression preserves current behavior exactly, and the new guard test pins that relationship.

**`memoryEntriesPerRun` removal is a visible surface change** → `interlock limits` output loses a row and `docs/06:70` / `docs/10:89` need correcting. Cheaper than the alternative, which is inventing an enforcement point to justify a number.

**This change is gated by the pre-change gates** → Accepted, and the reason the completion-gate and evidence-gate fixes land in `lib/` before the `workflows/ship.js` edits that consume them. A ship run of this change should be reviewed by a human at the checkpoint rather than via `--continue`; the ledger break would block continuity anyway.

**Prompt-integrity coverage could regress silently as new prompts are added** → The enumeration reports its own count and fails on an unextractable prompt, which converts "someone forgot" into a test failure. It does not prevent a prompt built entirely outside the marker convention; that residual is stated rather than solved.

## Migration Plan

Ordering is a dependency chain, not a preference:

1. **`lib/` predicates first** — D1 canonicalization, D2 evidence, D3 severity, D5 ledger, D7 verify-field allowlist. Each is independently testable with no ship run.
2. **CLI surface second** — D4 `ready --findings`, ledger exit status, `tasks tick` exit status. These depend on step 1's predicates.
3. **`workflows/ship.js` third** — D6's one-character defect fix, D7's derived bound, D8's gate and derived banners, D9's rubric passing. These consume steps 1 and 2.
4. **Tests alongside each step**, starting from the known-red baseline the reviewers reported.
5. **Docs and skills last** — `skills/spec/continuity.md`, `skills/spec/SKILL.md`, `shared/DECISION-LEDGER.md`, `README.md:118`/`:128`, `docs/06`, the dimension-name correction. Last so they describe shipped behavior.

**Rollback.** Every item is an independent revert. The two breaking items — the deprecated `--review` input and the ledger's non-zero exit on a missing file — are single predicates, and neither blocks the checkpoint path. No data migration: no persisted format changes.

**Dependencies.** None added. Every change uses Node built-ins already imported by the touched module (`node:path` for D1's lexical normalization; `node:fs` where already present). No new package, so no version to pin.

## Open Questions

- **How long `--review` stays accepted.** Kept for one release here with a warning. Whether it is removed in the next change or lives longer depends on whether anything outside this repo calls it — unknown, and answerable after this ships without changing any spec, task, or predicate in this change.
- **Whether the tolerance band needs recalibrating once dismissals require citations.** Answerable only from real `--strict` runs after D2 lands. It does not change any requirement here; the band is untouched by this change.
