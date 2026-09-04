## Context

See proposal.md — Why. The design-relevant state, verified on this branch:

- `lib/run-log.mjs` builds the `run-receipt` payload from a field table whose every entry is a named coercer over the orchestrator's whole `summary` object. Two nested groups (`waveTallies`, `waveSpend`) are built element by element specifically so a fat source object cannot leak content through them. Nullable coercers (`nullableCount`, `nullableBool`, `nullableText`) exist to keep "did not" apart from "never found out"; `stringArray` does not — it returns `[]` for a non-array, which is exactly the collapse R15 must not make.
- `lib/report.mjs` declares `planFidelity.diffMatchesPlan` as `{computable: false, reason, wouldRequire}` and renders it as `NOT COMPUTABLE`. Its module header states the rule the new indicator has to obey: a denominator travels with every value, and a zero denominator yields `null` with a reason, never `0`.
- `lib/waves.mjs` reads `task.paths` as the plan's predicted paths and documents them as optional by design — "a classifier that cannot predict which files a task will touch must be able to say nothing rather than guess". That optionality is the reason the receipt needs a completeness marker as well as a set.
- `workflows/ship.js`'s commit step is a model agent returning `{ok, sha, detail}`. The receipt spec already requires tallies to be the state machine's recorded outcomes rather than agent self-reports; the same rule applies here.
- `checkRunLog(root, runId)` in `lib/run-log.mjs` is the published reconstructability decision behind `interlock run-log check`.
- `lib/doctor.mjs` wraps each check in `run(id, fn)`, which converts a thrown error into a **`fail`** row. Any check added naively inherits that, which would violate R18 on its own crash path.
- `lib/drift.mjs` already shells out to `git` from `lib/`, so a deterministic git read in `lib/` is precedented rather than novel.

## Goals / Non-Goals

**Goals:**

- Make `diffMatchesPlan` a computed indicator whose exclusions are named and counted, so the figure cannot be read as stronger than the corpus behind it.
- Keep every new receipt field on the receipt's existing discipline: named, bounded, tri-state, leak-proof.
- Give a consumer's failed run a one-command route to a citable eval-case draft, reusing the reconstructability decision that already exists.
- State the consumer posture once, in a place a test can hold.

**Non-Goals:**

- No model eval runs anywhere in this change, and none is added to any CI job.
- No eval or indicator result feeds a gate, a readiness check, an autonomy record, or a band. `report/non-gating` already binds all of that and is deliberately not deltaed here (D8).
- No outcome eval of the workflow (Slice E3), no suite hygiene work (Slice E2), no drift fixes (Slice E5).
- No change to what the trajectory records per event. Capture reads what is already written; it does not ask the writer for more.

## Decisions

**D1 — Touched paths are read from version control, not reported by the commit agent.**
The commit step is a model agent. `ship-run`'s existing requirement that a run's tallies be its *recorded* outcomes rather than agent self-reports applies here with more force, because this set is the denominator of the indicator: an agent that mis-lists its own commit would silently move the number. A small deterministic reader takes the commit identifier the receipt already carries and reads the touched paths from git, following the precedent in `lib/drift.mjs`. *Alternative rejected:* extend the commit step's response schema with a `paths` array — cheaper, but it makes the sharpest indicator in the report a self-report.

**D2 — Unobserved is a distinct third state, carried by a new nullable array coercer.**
`stringArray` floors a missing value to `[]`. Reusing it would file "no commit was made" as "a commit touched nothing", which is precisely the defect `nullableCount` and `nullableBool` exist to prevent one type down. A `nullableStringArray` coercer returns `null` for an absent source and a bounded array otherwise, and the reason a set is unobserved is recorded beside it. *Alternative rejected:* a sentinel string inside the array — unparseable by any reader that does not know the sentinel, and it would pollute a set comparison.

**D3 — Completeness and truncation are recorded as markers, not inferred by the reader.**
A predicted set is the union over tasks that declared paths; a plan where one task declined leaves a set that is real but partial. A reader cannot tell that from the set alone, so the receipt records whether every executed task declared paths. Truncation is recorded the same way. The report then excludes those runs by name (D5) rather than computing over a denominator nobody stated. *Alternative rejected:* record the per-task counts and let the report decide — more data on a receipt that is already the largest payload in the table, for a decision the writer can make once.

**D4 — The path-set bound is a module constant in `lib/run-log.mjs`, not a new entry in `lib/limits.mjs`.**
`lib/limits.mjs` publishes *policy* caps through `interlock limits` and is governed by a reader-invariant test; `EVAL_CAPS.runsPerCase` and `EVAL_CAPS.reportingThreshold` are live proof that a published cap with no reader is its own defect class (review G7). A receipt field's payload bound is not a policy ceiling — nothing halts on it — and it belongs beside the existing field bounds in `lib/run-log.mjs`, where `spill` is already bounded the same way. The number stays in code either way, which is the rule that actually binds. *Alternative rejected:* `REPORT_CAPS` — that object bounds what the reader opens, not what the writer writes.

**D5 — The report excludes rather than approximates, and counts each exclusion by reason.**
Four reasons keep a run out of the share: no commit, an unreadable set, an incomplete prediction, a truncated set. Each is counted and printed. Including incomplete-prediction runs would systematically depress the share for a reason that has nothing to do with the implementer's fidelity — a planner that declined to predict would read as a run that went off-plan. *Alternative rejected:* impute unpredicted tasks as predicting nothing — that is the silent-degradation failure this repo forbids, wearing a denominator.

**D6 — The share is pooled over paths, and its direction is fixed.**
Numerator: touched paths that were predicted. Denominator: touched paths, summed across qualifying runs rather than averaged per run, so a run touching one file does not weigh the same as a run touching forty. The converse figure (predicted paths that were touched) answers a different question and is barred from the same name by the spec, because publishing either under the other's label is the restatement defect the current `wouldRequire` text exists to avoid.

**D7 — "Not reconstructable" is `checkRunLog`, reused verbatim.**
`interlock run-log check` already publishes the decision and its problem list. Capture calls the same function and reports the same problems on refusal. A second private notion of reconstructable would be a threshold in a second place — the failure `docs/12` was written to prevent, one capability over. *Alternative rejected:* a laxer capture-only rule ("has a run-start and any event") — it would let capture cite an event range that a reader following the citation could not replay, which destroys the only thing a captured skeleton has going for it.

**D8 — No delta on `report/non-gating`.**
Its requirements are unqualified: the report exits zero, issues no verdict, applies no threshold, and nothing in the loop reads it. A new indicator is already bound by all four. Restating them in a delta would create a second copy of a rule that must have exactly one, and the next reviewer would have two places to re-argue. The `report/indicators` delta therefore defines the new figure and says nothing about gating.

**D9 — R17 gets a new page, `docs/14-evals.md`, not an extension of `docs/11`.**
`docs/11` is scoped to what `interlock report` measures and why it gates nothing; its "Whether to keep them" section answers one of R17's five questions (what is recorded and whether to commit it). The other four — which exit code checks what, why no model evals run in a consumer's CI, how to file a failure, and what the eval suite is for — are not indicator content, and folding them in would make the indicators page about evals. A new numbered page is the established pattern (`docs/13` was added exactly this way; the sequence already skips 07, so 14 is next). `docs/11` gains a cross-link; `README.md`'s doc table and its Experimental section gain the row and the link. *Alternative rejected:* extend `docs/11` — cheaper, but it buries the consumer-facing answer inside a page whose title promises something else.

**D10 — The doc-claim pins assert tokens, and the check itself must not be able to pass vacuously.**
Following `test/workflows.test.mjs:393`, which asserts distinguishing tokens (`Code Mode is out of scope`, `default and supported host`) and then adds a negative assertion so a reversal cannot survive. The same shape here: positive token pins for each required claim, a negative assertion that the page never states that Interlock runs model evals in a consumer's CI, and an assertion that the page carries no bare numeric threshold presented as policy. The test must fail if the page is missing entirely, not merely skip.

**D11 — R18's check never contributes `fail`, including when it throws.**
`lib/doctor.mjs`'s `run()` wrapper turns a thrown probe into a `fail` row. The eval-prerequisite check is therefore written to catch its own errors and return `skip` with the reason, rather than relying on the shared wrapper. This is the guards-fail-open rule stated for a preflight: a check that failed whenever it could not establish its own answer would block exactly the hosts it was least able to inspect. The rows are also omitted entirely when no eval suite exists at the plugin root — a repository with no suite has no prerequisite, and a `skip` row there would be noise on every consumer's preflight.

**D12 — The credential row reads presence, never value.**
Doctor's structured output is written to disk and pasted into issues. The check tests only whether the variable is set and never reads, prints or records its value, in either the human or the JSON surface.

**D13 — R16 is the flywheel's first step, and is independent of Slice E2, not blocked on it.**
The flywheel Anthropic describes runs production failure → regression test → outcome measurement. This change builds the first arrow. Slice E2 (`harden-eval-suite-hygiene`, R5–R10) hardens the suite a captured case would land in: twins for one-sided cases, a recorded transcript-reading step, the promotion and calibration commands, the coverage report. **Nothing in R16 depends on any of that**, and nothing in E2 depends on R16 — a skeleton passes today's structural gate as it stands. The two do overlap in *files*: both edit `skills/evals/SKILL.md` and add pins to `test/skills.test.mjs`. They must therefore not be applied concurrently against the same working tree, and whichever lands second rebases its skill edit. That is a sequencing constraint between changes, not a dependency between requirements.

**D14 — Zero new dependencies.**
Everything here is stdlib: `node:fs` for the receipt and the skeleton, `node:child_process` for the git read (as `lib/drift.mjs` already does), and the existing hand-rolled frontmatter reader shape for the emitted case files. No YAML library is added — `test/evals.test.mjs` deliberately hand-rolls its reader to avoid becoming the repo's only dependency, and the emitter writes the same minimal shape it reads.

## Risks / Trade-offs

- **The predicted-path set is a model's prediction, so a low share may indict the planner rather than the implementer.** → The indicator is defined as "touched paths that were predicted" and nothing more; the docs page states what it does and does not license, and `report/non-gating` keeps it away from every decision. The completeness marker keeps declined predictions out of the number entirely.
- **Excluding incomplete and truncated runs could leave the denominator empty for a long time.** → That is the correct outcome, and it renders as unobserved with a reason rather than as zero. The exclusion counts printed beside it tell a reader exactly which recording gap to close first.
- **A git read at close can fail (detached state, a pruned object, a host with no git).** → Unobserved with a stated reason; the receipt is written either way, and the close is never failed on it. Consistent with the token-accounting precedent already in `ship-run`.
- **Two hosts write receipts.** The ACP host may not be able to supply either set. → It records them unobserved with a reason, exactly as it already does for token spend. The difference between hosts is declared, not left to be inferred.
- **A captured skeleton could be filed as if it were a reviewed case.** → It is emitted untagged, its grader pattern and prompt carry explicit unconfirmed markers, capture refuses to write into `evals/`, and the authoring spec forbids authoring a case that still carries an unconfirmed marker.
- **Capture quotes a value out of a trajectory into a file a human will read.** → The trajectory is already written with fields copied by name and bounded, so the quotable values are bounded reason and status strings, not transcript bodies. Capture quotes one such value and bounds it; it never copies an event wholesale.
- **`docs/14` is a fifth place a threshold could be restated.** → The spec forbids stating a value and requires naming the publishing command instead, and the pin test asserts that no bare numeric threshold appears as policy on the page.
