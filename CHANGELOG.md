# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Two passes landed together.

The first was **honesty and adoption**: several things the 0.1.0 README described
as enforced were prose, and one was not wired up at all. Those claims are now
either true or gone.

The second **made them true** — the ship loop moved out of prose and into a
dynamic-workflow script backed by a policy CLI, and the opt-in continuity path
gained the fail-closed readiness gate it needs.

> **Breaking:** `/interlock:ship` is now a [dynamic workflow](https://code.claude.com/docs/en/workflows)
> rather than a skill. Interlock requires **Claude Code v2.1.154+ with dynamic
> workflows enabled**. Where workflows are disabled — `disableWorkflows`, org
> policy, `CLAUDE_CODE_DISABLE_WORKFLOWS`, or a Pro plan that has not enabled
> them in `/config` — there is no ship path. The command name is unchanged.

### Added

- **`docs/` — four human-facing pages.** [The first hour](docs/01-first-hour.md)
  (install → `bootstrap` → one `spec` → read it → `ship` → archive, plus an
  explicit do-not-run-yet list), [the checkpoint](docs/02-the-checkpoint.md)
  (how to read four artifacts in ten minutes, and what "looks wrong" looks like
  in each), [OpenSpec vs Interlock](docs/03-openspec-vs-interlock.md) (who owns
  what, and why `spec` drives the CLI instead of forking the stock skills), and
  [when it stops](docs/04-when-it-stops.md) (every halt and banner, and the
  three-way split between harness-enforced, code-enforced, and model-followed).
- **The tolerance band is now applied.** `lib/findings.mjs` exported
  `TOLERANCE_BAND` since 0.1.0 and nothing called it. `applyToleranceBand()`
  now partitions findings into `{ reportable, dropped }`, and `evaluateGate()`
  applies it after the skeptics' dismissals and before counting blockers — so a
  finding scored below 3 of 5 for how well-grounded it is can no longer block a
  change. Unscored findings are kept: absence of a score is not evidence of low
  quality. When two skeptics disagree by more than `drift`, the disagreement is
  treated as signal and the finding survives. Gate results carry
  `droppedByQuality`, counted separately from `dismissedCount`.
- `interlock gate --min-quality <n>` and `--no-tolerance` to move or disable the
  band per run. It is on by default, in the CLI rather than in review prose,
  so it cannot be quietly re-argued on each run.
- **Loud failure banners** in `ship`'s final summary — `GRAPH UNAVAILABLE`,
  `NO TEST PROFILE`, `VERIFICATION SKIPPED`, `E2E FAILED (non-blocking by
  policy)` — printed whenever the condition holds, including on otherwise
  successful runs. A degraded run no longer reads like a clean one.
- Structural tests: a skill whose body instructs spawning subagents must list
  `Agent` in `allowed-tools`, and `shared/` + `lib/` are scanned for
  predecessor-project strings the way `skills/` already was.

**The ship loop became a program**

- **`workflows/ship.js`** — the eleven numbered headings of `skills/ship/SKILL.md`
  are now a script the runtime executes. The script holds the loop, the
  branching and the intermediate results; the `interlock` CLI holds the rules;
  the agents do the work. A cap is no longer a sentence a tired model can talk
  itself out of.
- **`lib/limits.mjs`** — every cap in one place: 8 parallel agents, 2 inter-wave
  fix attempts, 2 replans, 2 remediation rounds, 5 root-cause iterations, 2
  tolerated task failures. The CLI help text interpolates them, so the
  documentation cannot drift from the constant.
- **`lib/waves.mjs`** gained a pure execution state machine beside the planner:
  wave order, inter-wave verification, replan eligibility and the task-failure
  halt. Every transition returns a new deep-frozen state, because a resumed
  workflow replays transitions from cached results and a machine that mutated in
  place would answer differently on the replay than on the first pass.
- **`lib/remediate.mjs`** — blockers are fixed, suggestions are deferred,
  same-file findings never run in parallel. Rounds 1–2 fix; round 3 is a
  verdict-only round that is the sole round able to halt, so the last fix pass
  is never pre-empted by a halt it had not yet earned.
- **`lib/review-core.mjs`** — skeptic majority survival, severity refinement, and
  the quality band, with counts that distinguish *dismissed by a skeptic* from
  *dropped as too weak to report*. Ties keep the finding: a surviving false
  positive costs ten seconds of reading, and a wrong dismissal is invisible.
- **`lib/verify.mjs`** — plans verification from the test profile and judges the
  results, without ever running anything itself. Commands come from the profile
  verbatim; a red unit suite halts; coverage is advisory; e2e is reported and
  never repaired. Failures cluster by normalized error signature so a shared
  root cause is fixed once. Whether a typecheck halts now depends on where
  verification was called from — blocking between waves, reported but
  non-halting at the final gate, so the three documented hard halts stay three.
- **`lib/metrics.mjs`** — the review's dismissed and quality-dropped counts, and
  nothing else, under `.claude/metrics/`. This is the number the README points
  at as evidence a review is worth trusting; it is now real.
- **CLI**: `limits`, `remediate`, `review`, `verify plan|judge|unit|cluster|repair`,
  `wave-state create|next|record-batch|record-verify|replan`, `risk`, `ledger`,
  `ready`, `outcomes`. Every gating command exits non-zero when it blocks, and
  the workflow branches on exit status rather than on parsed prose.

**Opt-in continuity (`/interlock:spec --continue`)**

- **`lib/risk.mjs`** — classifies a change `low`/`medium`/`high`/`critical` from
  its paths and artifact text, and **fails closed**: no usable signal classifies
  as `high`, never `low`, and source paths matching no rule floor at `medium`
  because unrecognised is not safe. Every classification carries the signals and
  evidence that produced it.
- **`lib/ledger.mjs` + `shared/DECISION-LEDGER.md`** — a durable decision ledger
  at `openspec/changes/<name>/decisions.md`. An `agent_resolved` row without a
  written resolution *and* evidence is invalid, and an invalid row blocks exactly
  like an unanswered one.
- **`lib/ready.mjs`** — the gate. Fifteen named checks; `ready` is true only when
  every one affirmatively passed. A check that could not run is never a pass, an
  omitted artifact-review result is an unrun check rather than a clean one, and
  an exception while gathering evidence becomes a blocker.
- **`lib/outcomes.mjs`** — `.claude/learning/outcomes.jsonl`, appended for
  checkpoint and continuity runs alike. **Nothing gates on it yet** (§4.15a);
  it exists so that a later decision can be made on evidence instead of feel.

### Changed

- **Earned autonomy is demoted to experimental, and documented as storage
  only.** The ladder records outcomes, resets on blockers, and assigns blame
  transitively — but nothing reads the level to change what the workflow does,
  and the `spec` → `ship` checkpoint is not skippable at any level. The README
  previously said autonomy "changes whether the flow waits for you." It does
  not. Skills keep recording, so the evidence accumulates for a decision that
  has not been made yet.
- README leads with the three commands and links the docs. Nine of the thirteen
  remaining skills moved behind an "advanced surface" fold; `bootstrap`, `spec`,
  `ship` and `mr` are the product. No skill was hidden from the `/` menu — they
  are demoted in documentation, not disabled.
- README states plainly that this is a **Claude Code plugin**; Cursor and
  Copilot are not supported in 0.x.
- Corrected README claims that overstated what runs: `review-code` fans out *up
  to* six dimensions (devops and security are conditional on the diff), and
  only `ship` genuinely asks nothing — `bootstrap` and `spec` ask where the
  repo holds no correct answer.
- The README no longer implies the orchestration inside `ship` is code. Wave
  execution, remediation rounds and verification order are instructions the
  model follows; moving them into engines is planned, not shipped.
- `review-code` defers the quality threshold to `interlock gate` rather than
  restating a number in markdown.
- `bootstrap` no longer swallows a failed graph build with `2>/dev/null ||
  true`; it reports why the graph is unavailable and continues.

### Fixed

- Agent-facing strings naming the private predecessor project: the graph report
  header, a walker comment, and four `shared/` contracts that still referred to
  `propose`, `grill`, `review-ts`, `apply-change` and `openspec-create-pr`.
  Tests now prevent regression.
- `Agent` added to `allowed-tools` on the skills that spawn subagents
  (`bootstrap`, `explore`, `review-code`; `ship` too, before it became a
  workflow and stopped needing frontmatter at all). To be precise about what this
  fixes: `allowed-tools` is a per-turn **pre-approval**, not a restriction —
  Claude Code's documentation is explicit that it "does not restrict which tools
  are available" — so fan-out was never silently broken. What the omission cost
  was a possible approval prompt under a user's own restrictive permission
  rules, which in `ship` would interrupt a run that is contractually supposed to
  ask nothing.

### Removed

- `skills/ship/SKILL.md`. Its logic is `workflows/ship.js` and the CLI
  subcommands above; the `/interlock:ship` command name is unchanged.

### Notes

The version number is not yet decided, but this is not a patch. `ship` changed
category, the plugin gained a hard requirement on the workflow runtime, and the
gate now drops findings it previously reported.

Two decisions were deliberately **not** taken. Continuity does not gate on the
learning corpus (§4.15a) — records accumulate, nothing reads them, and turning
that on should be a decision made against real data rather than an intuition.
And earned autonomy stays storage-only (§4.2 D) for the same reason: a feature
that gates a workflow should earn its own trust first.

## [0.1.0] — 2026-08-12

Initial release. Interlock is a Claude Code plugin that layers autonomous
spec-driven orchestration on top of the OpenSpec CLI.

### Added

**Distribution**
- Claude Code plugin with a single-plugin marketplace — installs in two commands.
- `bin/` executables (`interlock`, `interlock-graph`) join the Bash tool's `PATH`
  automatically when the plugin is enabled.

**The deterministic spine (`interlock`)**
- `waves` — plans execution waves from classified tasks: orders groups, clamps
  over-eager model assignments, defers test tasks, and **caps parallel fan-out**
  (default 8).
- `surface` — classifies changed files as UI-TESTABLE / UI-INDIRECT /
  NOT-UI-TESTABLE, and decides whether a manual test plan or devops review is
  warranted.
- `gate` — decides whether a review blocks, and partitions findings per file for
  parallel remediation. Exits non-zero when blocked.
- `validate` / `changes` — OpenSpec change readiness and discovery.
- `autonomy` — the L2→L3 earned-autonomy ladder with transitive blame.

**The code graph (`interlock-graph`)**
- Local, deterministic import/symbol graph with OpenSpec and memory overlays.
  Zero dependencies, no network, no vector store.
- Token-budgeted retrieval: `query`, `consumers`, `path`, `explain`, `context`,
  `docs`, `docs-index`.

**Skills**
- Onboarding: `graph`, `docs-digest`, `bootstrap`.
- Loop: `explore`, `spec`, `ship`, `mr`.
- Supporting: `review-code`, `review-artifacts`, `manual-test-plan`,
  `explain-code`, `commit`, `fix-tests`, `dispatch`.

**Guardrails enforced by the harness rather than by prose**
- `ship` sets `disallowed-tools: AskUserQuestion` — its zero-touch contract is
  structural, not aspirational.
- `ship`, `commit` and `mr` set `disable-model-invocation: true`, so Claude
  cannot decide on its own to commit or open a merge request.

**Testing**
- 171 tests, no dependencies. Covers the spine, the graph, and structural
  validation of every skill (frontmatter fields, description budget, and whether
  every bundled-file reference resolves).
- CI validates the plugin manifests with `claude plugin validate --strict` and
  smoke-tests the CLIs as executables.

### Notes

- Interlock **composes** OpenSpec rather than forking its skills. `/interlock:spec`
  drives the `openspec` CLI directly, so it does not drift when OpenSpec
  releases. Stock `openspec-*` skills remain available alongside it.
- Structural graph indexing covers JavaScript/TypeScript, Python and shell. Other
  languages get docs and spec indexing plus the full workflow, but no
  import/symbol edges — the skills state this rather than implying completeness.
- The autonomy ladder ships opt-in until it has accumulated real run data.

[0.1.0]: https://github.com/renzrollon/interlock/releases/tag/v0.1.0
