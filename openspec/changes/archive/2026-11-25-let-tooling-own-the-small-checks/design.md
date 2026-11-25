# Design

## Context

See `proposal.md` for the motivation. The facts that shape the approach, each checked against the tree on 2026-11-23:

- **The CLI plans, something runs, the CLI judges.** `planVerification` emits the profile's commands verbatim (`lib/verify.mjs:247-387`), an agent or the session's shell runs them through `interlock verify exec`, and `judgeVerification` rules (`lib/verify.mjs:846-963`). The agent never sees a threshold (`lib/prompts/verify.mjs:1-11`).
- **Five kinds, two of them gates.** `VERIFY_KINDS` is `typecheck, unit, lint, coverage, e2e` and `BLOCKING_KINDS` is `typecheck, unit` (`lib/verify.mjs:46, 53`). Between waves both blocking kinds halt; at the final gate only `unit` does (`lib/verify.mjs:71-74`).
- **Lint leaves no record.** A lint that ran and failed adds one warning signal (`lib/verify.mjs:932-935`). A lint that passed, or could not run, adds nothing, and the verdict has no lint field.
- **The suite signal reads two kinds.** `readSuite` maps `BLOCKING_KINDS` through a two-entry lookup (`lib/merge-confidence.mjs:489, 505-512`). A third blocking kind with no entry there would throw.
- **Every kind is a step or a skip.** A plan names each kind exactly one way, and the judge prints one skip line per skipped kind. Measured on 2026-11-23 with `node cli/interlock verify plan --context inter-wave` on a unit-only profile: four skip entries and four `VERIFICATION SKIPPED` lines.
- **Every dimension prompt comes from one assembler**, `assembleDimensionPrompt` (`lib/prompts/review-dimension.mjs:181-243`), called by `interlock review brief` (`lib/review-cli.mjs:363`) and by the strict ship review (`lib/run.mjs:1837`). The remediation briefing calls only `renderProofRules` (`lib/prompts/remediate.mjs:143`).
- **This repository has no lint and no build step**, and its profile registers the unit suite alone (`.claude/CLAUDE.md` Commands, `.claude/testing/profile.json`).

## Goals / Non-Goals

**Goals:**

- A project can register a build, and the final gate runs it.
- A lint result and a build result are facts of the verification verdict, and the merge verdict reads them.
- Reviewers are told once, in the prompt every dimension gets, that formatting, lint and type-check errors belong to tools.
- A step's time allowance reaches whatever runs the step: the session in settle, the verify agent in a ship run.

**Non-Goals:**

- No new agent type (D3). The run-and-report role exists (`agents/ping.md`, the verify spawn) and the decisions are in `lib/verify.mjs`.
- No new merge signal (D9), no change to the score formula, the inter-wave plan or its budget.
- No change to test focus (D23). If the owner wants it sharper, the lever is running `qa` at the lean depth, a `REVIEW_DEPTH` value in `lib/limits.mjs`, in its own change.
- No change to the rubric files (D20), to the pipeline signal or to where required check names come from (D26).
- No change to the run log's `verify-judgement` event or to the receipt (D27).
- No change to this repository's own profile (D25).
- No edit to `site/DESIGN-PROMPT.md` or the generated pages (D30). The site describes a released version and is refreshed by the per-bump checklist in `site/README.md`; `tasks.md` names the lines under Workflow follow-up.

## Decisions

### Four questions the owner answered (D1, D2, D7, D8)

These rows were `needs_human` in `decisions.md`. The owner answered each on 2026-11-23, as recommended, and the artifacts are written to those answers. This section keeps what any other answer would have edited.

**D1: a red build at the final gate halts.** A change that does not build cannot ship, so the final gate treats a failed build as it treats a red unit suite. The other answer is to report it without halting, as a failed type check is reported there. That answer edits: the `verify` requirement "A failed build SHALL halt the final gate, and a failed lint SHALL halt nothing" (the final halting kinds stay the unit suite alone, and its two build-halt scenarios become "reported and does not halt", with a banner `BUILD FAILED (non-blocking at the final gate): <detail>`); the words "and SHALL mark it blocking" in the plan requirement; `BLOCKING_KINDS` and the final halting set in `lib/verify.mjs`; the build row of `docs/04-when-it-stops.md`; and the pins at `test/spine/verify.test.mjs:676` and `test/spine/cli.test.mjs:868`, which then stay as they are. The merge verdict's reading does not change with this answer: a failed build is red on `verify.suite` either way, as a failed type check is today. A halt is only as sound as the step's chance to finish, which is why the ship verify briefing now names each step's time allowance (D29).

**D2: a red lint is amber on `verify.suite`, needing a fix.** It holds the verdict at `HUMAN` and never blocks, so it is answered before a merge without stopping a fix round. The other answer is a flag that lowers the score and moves no band. That answer edits: the lint bullet of the modified `review/merge-confidence` requirement (green with a flag `lint-failed`), the scenarios "a red lint is amber and needs a fix" and "the worst of four holds the signal", one more entry in `FLAGS`, and one more row in the flags table of `docs/15-merge-confidence.md`.

**D7: a project with a `tsconfig.json` and no registered type check stays green with `no-typecheck`.** The flag already says it, and guessing a project's type tool is what the profile exists to avoid. Nothing in these artifacts implements D7 either way. The other answer needs a new input (whether the tree holds a `tsconfig.json`) gathered for the assessment, and is its own change.

**D8: a discovered build command is run without a separate opt-in.** The brief's direction is "discovered the way typecheck is". The cost is that a project whose `scripts.build` is slow, or does more than build, gets it run at every final gate once a profile is written or reconfigured, with a halt behind it (D1). The profile has no `enabled` switch for the type check or the lint, and this design adds none for the build. The other answer adds `build.enabled` (a boolean, `false` when discovery writes the section), a validator check for it, a skip reason for a build that is known and not enabled, which the suite signal reads as green with `no-build`, and one sentence in `/interlock:fix-tests` saying the build was found and is off.

### The kind, and where it sits (D4, D12, D13, D14, D15)

`build` is the sixth kind. It is planned only when the context is not `inter-wave` (D4): a build is slow, and between waves it proves little that the type check does not. Nothing plans it there, so the inter-wave plan, its budget and the budget's derivation from `unit.timeout_ms` are untouched.

Between waves the plan still names the kind, as a skip with a reason of its own, `final-gate-only` (D12). The alternative was to leave the kind out of an inter-wave plan altogether, which would break the rule that every kind is a step or a skip. The cost is one more `VERIFICATION SKIPPED` line per checkpoint, beside the ones coverage and end-to-end already print there. `SKIP_REASONS` is extended and no existing string is reworded.

In execution order the build follows the lint and precedes coverage and end-to-end (D13): the cheap checks fail first, and an end-to-end suite that needs built output finds it.

The command comes from the profile and nowhere else (D5, D14). `verify plan` gains no `--build-command` and no `--no-build`. The type check and the lint have caller overrides because a caller used to be their only supplier; the build has had a profile section from its first day, and a build nobody registered should not be one a flag can hand in.

With D1 answered "halt", `build` joins `BLOCKING_KINDS`, the final halting kinds are `unit` and `build`, and the inter-wave halting kinds stay `typecheck` and `unit` (D15). The build is never planned between waves, so a build in that halting set would be a rule that can never fire.

### The profile section and its discovery (D5, D8, D16)

The section is `{ command, cwd, timeout_ms }`, validated by the one validator `interlock doctor` and `run start` already share (`lib/verify.mjs:147-161`). Discovery follows the type check's ladder: the profile's own value, then `package.json` `scripts.build`, then the step of the CI job that runs it. Nothing found is `null` (D5).

`timeout_ms` is written by a person (D16). `/interlock:fix-tests` records `unit.timeout_ms` from a green suite run it makes itself (`skills/fix-tests/SKILL.md:114`); it makes no build run, so it has nothing to measure and writes `null`. The plan carries the value on the step as `timeoutMs`, as it does for the unit suite.

Two readers have to pass a step's allowance on to whatever runs the command, and this change moves both:

- **Settle's final verification** sets every step's timeout to the profile's `unit.timeout_ms` today (`skills/settle/SKILL.md:439`). It will use a step's own `timeoutMs` when the plan carries one and `unit.timeout_ms` otherwise. Type-check, lint and coverage steps carry none, so they run as they do now. The round's verification already reads the step's own field (`skills/settle/SKILL.md:343`).
- **The ship verify briefing** names no timeout for any kind today (`lib/prompts/verify.mjs:48-51`), the unit suite included, so an agent's shell tool ends a long command at its own default. The artifact gate raised this against D1: a build ended that way is recorded as failed and halts. The briefing gains one paragraph, `TIME ALLOWANCES`, naming every planned step whose plan entry carries a positive allowance (D29). It covers the unit suite and end-to-end as well as the build, in both contexts and on a fix attempt, because the module briefs both contexts in one form (`lib/prompts/verify.mjs:1-11`). It sits after the sentence that says to run each line as written, and its entries are not lines of their own: the planned lines are shell commands and nothing else, and a labelled line among them would be run. A plan in which no step carries an allowance is briefed byte for byte as before. The values are the profile's own, put there by the CLI; no threshold is restated in prose.

### What the judge records (D24)

The verdict gains `lint` and `build`, each `{ ran, exitCode, passed }` or `null`, built the way `typecheck` is. Both results are validated as the type check's is: a result that ran carries a numeric exit code. A lint result with no exit code is read as "failed" today, by accident of `Number(undefined) !== 0`; it becomes the same user-facing error the type check raises, and the verify result schema already requires the field (`lib/prompts/schemas.mjs:94`).

A lint that could not run is recorded as not passed and warned about. Today it is silent, which is the one lint outcome that reads exactly like a pass.

### What the merge verdict reads (D2, D9, D10, D11)

Lint and build become two more facts of `verify.suite` (D9). Two new signals were the alternative. They would change the registry's length, which is the score's denominator, the documented table, and every recorded verdict's signal list. The suite signal already is "the worst of the kinds a merge depends on", and it grows from two facts to four.

The reader stops deriving its kinds from `BLOCKING_KINDS`. That list answers "what halts"; the lint halts nothing and is read all the same. The reader holds its own list of four, in `VERIFY_KINDS` order.

That decoupling lands in the same task as the list change, not with the rest of the reader. The reader's lookup has no entry for a third blocking kind, and `assessMergeConfidence` does not catch a reader's throw (`lib/merge-confidence.mjs:1303`), so a tree with the new `BLOCKING_KINDS` and the old `readSuite` fails every assessment over a final verdict. Task 2.1 therefore gives `readSuite` its own list of the two kinds it reads today, and task 2.2 grows it to four. The artifact gate's blocker was this ordering.

A project with no lint command or no build command reads green with a flag (D10). The living requirement already says a tool the repository has not set up is a flag naming it (`openspec/specs/review/merge-confidence/spec.md:98-102`), and the type check is its precedent. A flagged signal is not clean, so a project that has a type check and no lint or build scores one signal's share lower than before. The band and the verdict do not move. That living requirement is left unmodified: its general sentence covers the two new tools, and its two verification scenarios are read with a verdict that also records a passing lint and a passing build. A lint the caller turned off is neither absent nor run, and reads amber under the requirement's catch-all for any other skip reason.

A final verdict that records nothing for a kind, neither a result nor a skip, reads that kind unobserved (D11). Two things produce one: a planned step nobody reported, which the reader already treats this way for the type check, and a verdict written by a judge from before this change, which has no build entry at all and no lint field. The reader tells them apart by whether the field is present, and words the reason accordingly. It does not read either as green: an older verdict cannot say whether the project had a build to run. The exposure is small. Settle verifies each head anew, and a ship run's close reads the verdict that run just wrote.

### The reviewer line (D6, D17, D18, D19, D20)

One paragraph, added in `assembleDimensionPrompt` directly after the rubric and before the scope (D6), so the first line of every prompt stays the rubric's `# Dimension:` line the settle meter attributes spawns by. It is not added to `renderProofRules`, which the remediation briefing also prints (D18): a fixer is not choosing what to raise, and neither is a skeptic.

The line is unconditional (D17). It does not ask whether the profile registers a linter or a type checker. Three rubrics already tell their reviewer not to report style (`skills/review-code/dimensions/regression.md:16`, `domain.md:19`, `blast-radius.md:32`), and Anthropic's own review process drops findings that are only style or diagnostics. Its second sentence is the guard for a project with no tools: a defect such an error causes or hides is still a finding.

It does not contradict "Do not filter findings yourself" (D19). That instruction is about thresholds: survival, the quality band and the tolerance are the CLI's. This line is about scope, of the same kind as the rubrics' own "Do not report style" sentences.

The rubric files are not edited (D20). The language rubric's "Type safety" bullet is about what a type checker permits (escape hatches, unchecked casts), which is outside the line. The devops rubric's "Build health" bullet is a judgement about build-time requirements a build command may not exercise.

### Test pins that move, and the fixtures (D21, D22)

An assertion that pins a meaning the delta specs change is updated in the task that changes that meaning, never during a remediation stage, and the update names the assertion and the requirement it now pins. The known pins, not a complete list (D21):

- `test/spine/verify.test.mjs:676` and `test/spine/cli.test.mjs:868`: the final halting kinds are `['unit']`.
- `test/spine/verify.test.mjs:722-739`: the verdict's exact key list.
- `test/spine/merge-confidence.test.mjs:285-304`: the exact `FLAGS` list.

The 88 files under `test/fixtures/merge-confidence/` are each the all-green input with one state changed (`test/spine/merge-confidence.test.mjs:8-14`), and each embeds a final verdict whose lint was skipped for want of a command. Read by the new reader that is `no-lint` on every one of them, and "nothing recorded" for the build. So the test-first task brings every fixture's verdict to the shape the new judge writes, with a passing lint and a passing build, and no row of the expectation table changes (D22). The current reader ignores both fields, so the rewrite passes before the implementation exists. New fixtures carry the new states.

## Shapes the tests and the implementation share

Tests and implementation both read these from here.

| Where | Shape |
|---|---|
| `lib/verify.mjs` `VERIFY_KINDS` | `typecheck, unit, lint, build, coverage, e2e` |
| `lib/verify.mjs` `BLOCKING_KINDS` | `typecheck, unit, build` |
| `lib/verify.mjs` `VERIFY_CONTEXTS` | `inter-wave`: `typecheck, unit`. `final`: `unit, build` |
| `lib/verify.mjs` `SKIP_REASONS.FINAL_ONLY` | `final-gate-only` |
| The build step | `{ id: 'build', kind: 'build', command, blocking: true, cwd, timeoutMs }`, `timeoutMs` null when the profile gives none |
| The verdict | gains `lint` and `build`, each `{ ran, exitCode, passed }` or `null`; `exitCode` is null when `ran` is false |
| A halting build | reason `build failed (exit <n>)`, or `build failed (<why it could not run>)`, the default why being `the build command could not be executed` |
| A failed lint | a `warn` signal of kind `lint`, message `lint failed (non-blocking)` as today, or `lint could not run (non-blocking)` |
| `lib/merge-confidence.mjs` `FLAGS` | `no-lint` and `no-build` directly after `no-typecheck` |
| The suite reader's reasons | hold `lint failed` or `build failed` for a failure, and `records neither a result nor a skip` for a kind the verdict says nothing about |
| The reviewer line | opens `TOOLS OWN THE SMALL CHECKS` and holds `still a finding` |
| The briefing's allowance paragraph | opens `TIME ALLOWANCES`, names each step as `<kind> <n> ms`, and holds `non-zero`; listed only for a step whose `timeoutMs` is a positive safe integer |

Test-name prefixes, because section 2 of `tasks.md` runs tests by prefix: `build kind:` for the planner, the judge, the validator and the run program; `suite four:` for the suite reader and its docs rows; `tools own:` for the reviewer line; `allowance:` for the verify briefing's paragraph; `small checks:` for the skill and prose pins.

## Risks / Trade-offs

- **[Scores move for projects that change nothing]** Every project with no lint or no build gains a flag on `verify.suite`. → A flag never moves a band, the two flags have rows in `docs/15-merge-confidence.md`, and the changelog says so. A rule keyed on the verdict label is unaffected; one keyed on a score label is not.
- **[A project with a failing lint reads `HUMAN` where it read `MERGE`]** → This is the intent of D2, and the reason names the lint.
- **[A slow build is ended at a timeout and reads as a failed build]** A step ended this way is recorded as failed, which halts (D1) and reads red. → With `build.timeout_ms` set, settle's final verification and the ship verify briefing both pass the allowance on (D16, D29). With none, settle runs the build under the unit suite's allowance and a ship run's agent under its tool's default, so `shared/TEST-PROFILE.md` says to set it when the build outlasts the suite, and the report names the step and the timeout. An allowance above the tool's own maximum is still cut at that maximum; the briefing says so.
- **[The briefing changes for every run whose profile records `unit.timeout_ms`]** The paragraph is new text in a shipped prompt, between waves as well as at the final gate. → It only asks for a longer timeout than the default, and a plan with no allowance is byte for byte unchanged. Pins on the briefing's text move under the bounded rule.
- **[Discovery turns on a build the project did not ask to gate on]** → Discovery runs only when the profile is missing or `--reconfigure` is passed, and an existing profile is not rewritten. The owner accepted this with D8.
- **[An older recorded verdict reads unobserved]** → It fails closed with a reason that says to verify the head again (D11).
- **[A test pin outside the named list goes red]** → Section 3 of `tasks.md` sweeps the whole suite in an implementation stage, where the test guard allows the edit.
- **[`cli/interlock` is near its size warning]** It is 242,655 bytes and the warning starts at 245,760 (`test/spine/package.test.mjs:392-398`), about 3.1 KB of room. → The change edits usage text there and adds no code.
- **[The literal check on `lib/merge-confidence.mjs`]** That module may hold no number that is a published band value and no comparison against 1 or 2. → The reader's new code compares fields against `true`, `false` and reason strings, and counts nothing.

## Migration Plan

No data moves. A profile with no `build` section plans no build and reads `no-build`. An installed session picks the change up at the next release (D28: the proposal carries no breaking mark, and the release decides the version). Rolling back is reverting the commit; a profile that kept a `build` section then fails nothing, because the validator ignores sections it does not name.
