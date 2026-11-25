# Proposal

## Why

The owner asked whether a separate reviewer agent should own the smaller checks: types, lint, the production build and the pipeline. No agent is needed to run them, because the CLI already plans, runs and judges these checks from the test profile. The gaps are in what exists and what counts:

- There is no build check. A project cannot register one, so a change that does not build is seen only if the platform's pipeline happens to have a job for it.
- A lint result is read by nothing. A failed lint prints one warning line (`lib/verify.mjs:932-935`) and no merge signal reads it.
- No reviewer is told to leave this ground to tooling, so model reviewers can spend findings on what a formatter, a linter or a type checker already decides.

Brief: `.claude/handoff/explore-let-tooling-own-the-small-checks-20261119-164337.md` (brief 5 of the 2026-11-19 review-process revisit).

## What Changes

- **A `build` check kind.** The test profile gains a `build` section (`command`, `cwd`, `timeout_ms`). `/interlock:fix-tests` discovers the command the way it discovers the type check's, and never asks for one or invents one. `interlock verify plan` plans the build at the final gate only, never between waves.
- **A red build stops the final gate.** At the final gate a failed build halts, as a red unit suite does, so a ship run does not commit a change that does not build. This is ledger row D1, which the owner answered on 2026-11-23.
- **The verification verdict carries the lint's and the build's own results**, each beside the type check's: whether it ran, its exit code, whether it passed.
- **The merge verdict reads both.** `verify.suite` takes the worst of four results in place of two: the unit suite, the type check, the lint and the build. A failed build is red. A failed lint is amber, marked as needing a fix (ledger row D2, answered the same day). A project with no lint command or no build command reads green with a new flag, `no-lint` or `no-build`, as a project with no type check reads `no-typecheck` today.
- **One line in every review dimension's prompt.** The shared assembler tells each reviewer that formatting, lint rules and type-check errors belong to the project's tools, and that a finding which is only one of those is not raised.
- **A step's time allowance reaches whatever runs it.** Settle's final verification gives each step its own allowance when the plan carries one, so a build is not cut off at the unit suite's. The ship verify briefing names each planned step's allowance to the agent, so its shell tool does not end a build, or a suite, at its own default.
- **No new agent type.** Test focus is not changed either: it already has an owner in the review.

Three visible effects on a project that changes nothing:

- A project with no lint or build command gains the two flags on `verify.suite`. A flag lowers the score and moves no band, so `MERGE` stays `MERGE`.
- A project whose registered lint fails reads `HUMAN` where it read `MERGE`.
- A verification verdict recorded before this change carries no lint or build record, and reads `verify.suite` unobserved until the head is verified again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verify`: the plan gains a build kind planned at the final gate only; the verdict carries the lint's and the build's own results; a failed build halts the final gate and a failed lint halts nothing; the profile contract names a build command that discovery never invents; the verify briefing states each planned step's time allowance.
- `review/merge-confidence`: the suite signal reads four results in place of two, with a band for each lint and build outcome and two new flags.
- `review/review-briefs`: every dimension prompt carries the line that leaves formatting, lint and type-check findings to the project's tools.
- `review/settle-loop`: the pass's final verification runs each planned step under that step's own time allowance.

## Impact

- **Code:** `lib/verify.mjs` (kinds, profile validator, planner, judge), `lib/merge-confidence.mjs` (the suite reader and the flag list), `lib/prompts/review-dimension.mjs` (the assembler), `lib/prompts/verify.mjs` (the briefing's allowance paragraph), `lib/run.mjs` (the record a run writes when final verification ran nothing), `cli/interlock` (usage text only).
- **Shipped prose:** `shared/TEST-PROFILE.md`, `skills/fix-tests/SKILL.md`, `skills/settle/SKILL.md` (the final verification's timeout sentence).
- **Docs:** `docs/04-when-it-stops.md` (the halt table gains the build), `docs/06-why-it-works.md`, `docs/07-cli-and-configuration.md`, `docs/15-merge-confidence.md` (the `verify.suite` row and two flag rows), `CHANGELOG.md`.
- **Tests:** `test/spine/verify.test.mjs`, `test/spine/merge-confidence.test.mjs` and its 88 fixtures, `test/spine/prompts.test.mjs`, `test/skills.test.mjs`, plus whichever run and CLI tests pin the final halting set or a clean suite reading.
- **No dependency** is added, and this repository's own profile is not changed: it has no lint and no build step, so its `verify.suite` will carry `no-lint` and `no-build` beside the `no-typecheck` it carries today.
- **Not touched:** the signal registry (still seventeen gating signals), the score formula, the inter-wave plan and its budget, the pipeline signal, the review rubric files, the agent definitions, and the landing site, whose prompt is refreshed at the release that ships this.
