# Proposal

## Why

The settle loop's fix round commits and pushes the fixer's tree before anything verifies it, so a round can push a red commit and the pull request can be marked ready before the loop learns it: on PR #30 the head carried a failing test under the round-1 commit, and CI caught it, not the loop. The same pass posted a round-0 comment of 28 rows, 26 of them suggestions no skeptic judged and no fixer may touch, ahead of the two warnings a reader needed; its fixer ran 49 minutes as a `general-purpose` agent with every tool; and four lines of the skill's prose still contradict the code it drives. The 2026-10-31 architect review of the loop (`.docs/SETTLE-REVIEW-2026-10-31.md`, §5 and §6) ranks these as the small tier of its eleven recommendations. This change is that tier, and nothing above it.

## What Changes

- **A fix round verifies before it commits.** After `fixer-result` accepts the round and the protected-path revert has run, and only when something is staged, the skill plans and runs the inter-wave verification the ship loop already has (`interlock verify plan --context inter-wave` over the staged paths, `verify exec`, `verify judge --context inter-wave`) from the round's own profile snapshot. Green commits and pushes as today. Red commits nothing and pushes nothing: the skill prints `ROUND FAILED: unit red` with the judge's reason, leaves the round's changes staged, and stops the loop early, so the draft stays a draft and the assessment runs on the records the pass wrote.
- **The findings comment leads with what was verified.** `interlock settle comment` renders blockers and warnings as the table and the bodies it renders today; suggestions move into one `<details>` block headed by their count, same rows, same bodies, same ids. `--json`, the reply table, the briefing and the verdict read the same list as before.
- **The fixer is a bounded plugin agent.** A new `agents/settle-fixer.md` with the worker's tools (`Read, Write, Edit, Grep, Glob, Bash`) and no `Agent` or `Skill`; the skill spawns `interlock:settle-fixer` where it spawned `general-purpose`. The briefing gains two lines: run the unit suite one time at most, and never the whole suite while another agent may be running. No timeout is added: nothing in the repository or the Agent tool takes one.
- **The settle meter files a round's verification in its round.** A verify line that crosses while a round is open appends to that round instead of opening the pass-level `verify` section, so later rounds and their commit and push rows keep being drawn.
- **The depth banner says how many dimensions ran.** `review-code` prints `REVIEW DEPTH: <depth> (<n> dimensions: <a> always-on + <t> triggered)` once the dimension set is selected and before any dimension is spawned; settle relays the line as it is.
- **The prose stops contradicting the code.** The GitHub "not exercised end to end" marker is retired from the skill, the README and docs/15, with a correction under CHANGELOG `[Unreleased]` and archive task 8.5 of `close-the-merge-request-loop` ticked against PR #25; docs/15's "`--strict` runs every dimension again" is corrected; the round rule (blockers and warnings in the first round, a later round only while a blocker survives, suggestions never) is stated once in the skill and once in docs/15 without a number; the three `merge-confidence` lines pass `--changed <files>`; the conformance briefing tells its worker to read, not to run the suite.
- **Not in this change**, each its own later change or an open owner decision: per-finding resolution (Q3), re-review scope (Q4), `--resume` (O6), a cited handoff (Q14), a pass record (O10), outcome capture (Q8), the step emitter (S1), inline threads (Q7), an extra round for re-review-added warnings (Q9's second half), ready on `BLOCK` (Q15).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review/settle-loop`: the loop's order gains the round's verification before the commit; `interlock settle comment` renders suggestions collapsed; `interlock settle conformance-brief` tells the worker to read and not run; the posting requirement commits only a green round; the round-guard requirement names the bounded fixer type and the new red-round stop; two added requirements, the per-round verification and the bounded fixer agent.
- `hooks/settle-meter`: the grouping requirement files a round's verify lines into the open round.
- `review/review-depth`: the banner `review-code` prints and settle relays carries the dimension counts.

## Impact

- Code: `lib/settle-cli.mjs` (comment renderer, conformance briefing), `lib/settle-meter.mjs` (round verification kind), `lib/prompts/settle-remediate.mjs` (two briefing lines), `lib/doctor.mjs` (required agent file), new `agents/settle-fixer.md`.
- Prose: `skills/settle/SKILL.md` (§5 marker, §5c round, §6b, §6c, §9c), `skills/review-code/SKILL.md` (banner), `docs/15-merge-confidence.md`, `docs/07-cli-and-configuration.md`, `README.md`, `CHANGELOG.md`, the archived `close-the-merge-request-loop/tasks.md`.
- Tests: `test/skills.test.mjs` (settle and review-code pins), `test/spine/settle-cli.test.mjs`, `test/spine/settle-meter.test.mjs` and its fixtures, `test/spine/plugin-agents.test.mjs`, `test/spine/doctor.test.mjs`.
- No new dependency, no new CLI flag, no new limit. The round cap, the depths and the verify budget stay where `interlock limits` publishes them.
- A pass costs one more unit-suite run per fix round that staged something (about two minutes on this repository, nothing for a prose-only round, which plans no step).
