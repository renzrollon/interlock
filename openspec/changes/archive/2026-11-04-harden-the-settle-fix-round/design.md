# Design

## Context

See `proposal.md` — Why. The ground is `.docs/SETTLE-REVIEW-2026-10-31.md` (§5 findings C2, Q5, C13, H11, H12, H16, H18, Q9; §6 ranks 1–4) and the explore brief `.claude/handoff/explore-harden-the-settle-fix-round-20261102-094911.md`, which verified the report's citations at `87c310c` and gathered the surface below. Nothing here re-measures the passes.

Constraints that shape the approach:

- **The loop is prose interpreted by the model**, pinned by about 150 token assertions in `test/skills.test.mjs` (`settleSkillProblems`, line 1451 onward). Every reworded line is a behaviour change, and every pin that moves must move in the task that moves its meaning, never in a remediation stage (the test guard denies test edits there).
- **Thresholds live in the CLI.** The round cap, the depths and the verify budget stay in `lib/limits.mjs`; the skill names no number. The round rule is stated in words only.
- **Verification already exists as a CLI answer.** `interlock verify plan --context inter-wave` (`cli/interlock:4172-4210`, `lib/verify.mjs:247-330`) plans unit and typecheck from a profile, drops coverage and e2e, derives its budget (`lib/verify.mjs:208-220`), and plans no step for documentation-only paths. `verify exec` inherits stdio and exits with the suite's code. `verify judge --context inter-wave` halts on typecheck or unit (`lib/verify.mjs:71-73`) and exits 1 on a halt.
- **The settle meter groups by argv.** `lib/settle-meter.mjs` keys `interlock verify …` as kind `verify` targeting the rank-4 section (141, 296-340, 920-925); `place()` (572-581) opens that section mid-round and later `git commit`/`git push` rows are dropped (896-911).
- **The comment is one renderer.** `commentCommand` (`lib/settle-cli.mjs:256-293`) renders every surviving finding in record order at every severity; `lib/merge-confidence.mjs:1406-1419` is the house `<details>` pattern.
- **Agents are discovered by convention.** `agents/worker.md:1-7` is the shape; `.claude-plugin/plugin.json` has no `agents` field; `package.json` ships the directory; `test/spine/plugin-agents.test.mjs` scans every agent file for `effort` and advisor names, and checks frontmatter shape only for ping and worker; `lib/doctor.mjs:508-514` lists the required agent files.
- **`.claude/ship/` is gitignored** (`.gitignore:30`), so per-round verify files and `verify-timings.jsonl` never reach `tree-check` or the staging pathspecs.

## Goals / Non-Goals

**Goals:**
- A fix round never pushes a head whose unit suite (or typecheck) is red, and a red round is said in a fixed token.
- The round-0 comment leads with the findings skeptics judged; nothing is dropped from the record.
- The fixer cannot spawn agents, invoke skills or run the suite more than one time, by definition and by briefing.
- The meter keeps drawing rounds after a round verified.
- The depth banner says what the depth governed and what the triggers added.
- The skill, docs/15, README and CHANGELOG stop contradicting the code; archive task 8.5 is closed against the pass that ran.

**Non-Goals:**
- Carrying a red round into the next round's briefing (D1), a `--resume`, a pass record, per-finding resolution, re-review scope, a cited handoff, outcome capture, the step emitter, inline threads, an extra round for re-review-added warnings, ready-on-`BLOCK`. Each is listed in the proposal as out of scope.
- Shrinking the comment. Collapsing hides rows; it does not cut bytes, and no cap guard exists today (see Risks).
- A fixer timeout (D4). No surface enforces one.
- Any change to `lib/remediate.mjs`, the round cap, the depths, or the verify budget.

## Decisions

**D1 — A red per-round verification stops the round early; nothing is carried.**
After `verify judge` exits non-zero the skill prints `ROUND FAILED: unit red — <reason>`, commits nothing, pushes nothing, leaves the round's changes staged, and stops the loop early. The pass then behaves as every early stop does: §5e–§5g are skipped, the draft stays a draft, and the assessment runs on the records the pass wrote (the last review record is the round before's, which the platform head still matches).
*Why:* the only carrier into round r+1 is `remediate-brief --previous`, which reads `notFixed` alone and turns each id into a `declined` deferral (`lib/settle-cli.mjs:451-462, 473-500`), the opposite of a retry; `ok:false` is a hard refusal (607-637); and the round-start `tree-check` refuses a dirty tree, so a carry would also need a revert or an exemption. The `TESTS STILL STAGED` precedent (`skills/settle/SKILL.md:301`) already stops a round with its changes staged and a token.
*Alternative rejected:* a carry (new `remediate-brief` input, new briefing block, revert of the staged set). Ship's in-place fix attempts (`lib/waves.mjs:2732-2795`) are the shape a later change could borrow once there is a step emitter.

**D2 — Plan and judge both use `--context inter-wave`.**
The plan drops coverage and e2e and derives its budget from the profile; the judge halts on typecheck or unit. `final` would halt on unit only, and a red typecheck is still a commit nobody should push.
*Why:* `lib/verify.mjs:71-73`; the report's own recommendation (§5 C2).

**D3 — Suggestions render inside one `<details>` block headed by their count; no flag.**
`commentCommand` partitions `survivingOf(record)` into the findings whose normalised severity is not `suggestion` (blockers, warnings, and any unrecognised severity, which is never hidden) and the suggestions, keeping first-appearance order inside each tier. The first tier renders exactly as today; when the second is non-empty the renderer appends a blank line, `<details>`, `<summary><n> suggestion(s)</summary>`, a blank line, the same table header and rows, the bodies, `</details>`, a blank line, and then the coverage or `REVIEW NOT PROVEN` line, which stays last. A suggestions-only record renders the heading, the block and the coverage line, with no empty table before the block. `--json` lists every finding as before.
*Why:* the record stays complete (the reply table lists the same ids: `lib/settle-cli.mjs:316-361`), there is no new flag to thread through `lib/cli-flags.mjs:56` and `BOOLEAN_FLAGS`, and `lib/merge-confidence.mjs:1406-1419` is the pattern. The report lists this as owner item D3 with three options; the user's 2026-11-02 request to spec the report's recommendations takes the first.
*Alternatives rejected:* a `--suggestions` flag that omits by default (shrinks the comment, but drops ids from the record unless a count line is added); omitting outright.

**D4 — No fixer timeout is published.**
The bound is the agent definition (tools) plus the two briefing lines.
*Why:* `workflows/ship.js:302-316` passes no timeout to any spawn, `RUNTIME` in `lib/limits.mjs` has no time key, and the Agent tool takes none; a `LIMITS` key with no reader would be a number nobody enforces.

**D5 — The stage-marker route to the existing guards is not taken.**
*Why:* `readStage` (`lib/ship-stage.mjs:103-124`) scans every `.claude/ship/*/stage.json`; a `remediation` marker would make `guard-commit` deny the skill's own commit at `skills/settle/SKILL.md:318` and deny every other session's test edits and commits in the root; no CLI writes or clears the marker, and `rm -rf .claude/ship/settle` would collide with one placed under `settle/`. The marker would not remove `Agent` or `Skill` from the fixer either.

**D6 — The agent is `agents/settle-fixer.md`, spawned as `interlock:settle-fixer`.**
Frontmatter: `name: settle-fixer`; a description opening with the role and carrying `Never invoke from a user conversation — only /interlock:settle spawns this type.`; `tools: Read, Write, Edit, Grep, Glob, Bash`; `disallowedTools: Skill, Agent, mcp__*`; no `model`, no `effort`. Body like the worker's: follow the prompt, use only the tools given, do not invoke skills, do not spawn agents, do not commit, write the result file the prompt names and stop. The file is added to `lib/doctor.mjs`'s required list and its test stub, and to the plugin-agents frontmatter check beside ping and worker (tools compared against the worker's constant in `lib/host.mjs`). No routing change: `SPAWN_ROUTING` pins roles, not types (`openspec/specs/spawn-routing/spec.md:10`).
*Why:* `agents/worker.md:1-7`; discovery by convention means nothing else registers it.

**D7 — The banner carries the counts, printed after selection and before the first dimension spawn.**
`review-code` prints `REVIEW DEPTH: <depth> (<n> dimensions: <a> always-on + <t> triggered)`, where `<a>` is the length of the routing answer's `review.dimensions`, `<t>` the conditional dimensions the §1/§2 triggers selected, `<n>` their sum; under `--dimensions` it prints `REVIEW DEPTH: <depth> (<n> dimensions: --dimensions)`; on `ROUTING UNAVAILABLE` the same shape with `strict`. The line moves from right after routing (`skills/review-code/SKILL.md:62`) to the point where the set is known, which is still before any dimension is spawned. Settle relays the whole line once (`skills/settle/SKILL.md:187`), unchanged. The skill prose names the counts only as placeholders, so the `depthCountProblems` detector (`test/skills.test.mjs:2293-2304`) stays satisfied.
*Why:* the dimension record has `selected` and `depth` and the routing answer has the always-on set, so the counts are derivable with no new field; the report's H16.

**D8 — Per-round files are `plan-r<r>.json`, `results-r<r>.json` and `verify-r<r>.json` under `.claude/ship/settle/`; the plan reads the round's profile copy.**
The skill writes `results-r<r>.json` with the Write tool as `[{ kind, exitCode }]`, as §5f does for `results.json`. The plan reads `--profile .claude/ship/settle/profile-r<r>.json`, or `--no-profile` when no copy exists, so the rule the round is judged by is the one it started with. The staged paths come from a fenced `git diff --cached --name-only` and are spelled space-separated after `--changed` (variadic argv, no stdin, no comma list: `cli/interlock:1342-1347`). No `--elapsed-ms` is passed: each round gets the full inter-wave budget.
*Why:* `merge-confidence` reads `--verify .claude/ship/settle/verify.json` (skill:465) and the §5f pins anchor on `verify.json.tmp`; the two must never share a name. `test-paths` already reads the snapshot for the same reason (skill:289-293). No new `allowed-tools` line is needed: every new line is `git *`, `interlock *` or a Write, and the round's judge writes `verify-r<r>.json` directly rather than through the pass-level `.tmp` + `test -s` + `mv` lines, whose `allowed-tools` entries name `verify.json.tmp` alone. Nothing later reads the round's file, so an empty one landing is harmless; the skill reads it for the reason and says `the judge printed no verdict` when it is empty.

The round block, between the `git diff --cached --quiet` paragraph and the commit lines, reads in substance: list the staged paths; plan with `interlock verify plan --profile .claude/ship/settle/profile-r<r>.json --context inter-wave --changed <staged paths> --json > .claude/ship/settle/plan-r<r>.json`; for each planned step run `interlock verify exec --kind <kind> --command "<command>"` with the Bash timeout set to `unit.timeout_ms`, and record `{ kind, exitCode }`; judge with `interlock verify judge --plan .claude/ship/settle/plan-r<r>.json --results .claude/ship/settle/results-r<r>.json --context inter-wave --head <sha> --json > .claude/ship/settle/verify-r<r>.json`. Exit 0 commits and pushes as today. Any other exit prints `ROUND FAILED: unit red — <the verdict's reason, or "the judge printed no verdict" when the file is empty>` and stops early. A plan with no step (documentation-only paths) judges green and commits.

**D9 — The round rule is documented, not changed.**
One clause after the stop-rule paragraph (`skills/settle/SKILL.md:233`) and one sentence in the fix-round paragraph of `docs/15-merge-confidence.md:225`, in words and with no number: the first round briefs every surviving blocker and warning; a later round is briefed only while a blocker survives, and then takes the surviving warnings with it; suggestions are never briefed; so a warning a re-review adds is fixed only when a blocker also survives into the next round. The same paragraph of docs/15 replaces "`--strict` runs every dimension again" with: `--strict` sets the depth of each re-review, its always-on set and its skeptic shape, not its scope; the round still re-runs only the dimensions the briefing named.
*Why:* `lib/settle-cli.mjs:433`, `lib/remediate.mjs:195-202`, `skills/review-code/SKILL.md:86`; the extra round is the report's owner item D4 and stays open.

**D10 — The CHANGELOG gets a correction under `[Unreleased]`; the released 1.10.0 entry stands.**
*Why:* `CHANGELOG.md:90` is history; the release conventions keep released entries as written.

**D11 — The meter learns the round's verification by section, not by a new argv key.**
In `lib/settle-meter.mjs` the `verify` case targets the open round when `open.key === 'round'` (a soft append, drawn as `verify <kind> · exit <n>` rows like the pass-level ones) and the `verify` section otherwise. The skill's pass-level verify always follows the `conformance-brief` line, which has opened `conformance` by then, so a verify line inside an open round is the round's by construction; a pass that stopped early runs no pass-level verify at all. The meter's living spec fixture type for the fixer spawn changes from `general-purpose` to `interlock:settle-fixer` where fixtures record it; attribution is by the briefing's first line (`FIXER_LINE`, `lib/settle-meter.mjs:1167`) and does not change.
*Why:* `verify exec` carries no `--context`, so argv alone cannot tell the round's exec from the final one; the section can.

**Prose and pin edits, by site** (the full list the tasks name):
- `skills/settle/SKILL.md:143` — replace the GitHub marker sentence with one that says the GitHub lines ran end to end on PR #25 (2026-10-26, head `161f955`) and that the GitLab lines carry their own `not exercised` markers. Pins: invert `test/skills.test.mjs:1800-1803` (the loop section carries no "not exercised end to end" paragraph) and rewrite the doctored case at 2136 (insert the old sentence, expect the problem); the GitLab-marker pin at 1746-1756 is untouched.
- `skills/settle/SKILL.md:241` — `general-purpose` → `interlock:settle-fixer`; keep `ONE`, `whole prompt`, `no ship guards`, `Do not fix anything yourself` and the routing lines; add that the definition bounds its tools. Pins: 1883-1885, 2088-2089, 2234.
- `skills/settle/SKILL.md:465, 495, 618` — insert `--changed <files>` right after `--base origin/<target branch>` so the doctored copy's literal replace at 2046 still matches; `<files>` is the §3 list, as §11 passes it to `drift`.
- `test/skills.test.mjs:1729` — the `verify judge` anchor takes the first fenced judge line; re-anchor on the line carrying `--context final` so the round's judge line is not it; extend the ordered fence list (1600-1630) with the round's judge line between the quiet check and the push; add pins for `ROUND FAILED: unit red`, for the plan line's `--context inter-wave`, `--profile .claude/ship/settle/profile-r<r>.json` and `--changed`, for the clause's `never briefed` and `blocker survives` tokens, and doctored cases for the moved judge line and the restored `general-purpose`.
- `skills/review-code/SKILL.md:62` — the banner's new shape and position (D7); `test/skills.test.mjs:2308` keeps the `REVIEW DEPTH:` token and gains `always-on` and `triggered` beside it.
- `lib/prompts/settle-remediate.mjs:114-121` — after the `Do not commit, do not push and do not stage` paragraph: "Run the project's unit suite one time at most, after your edits, to check them. Never run the whole suite while another agent may be running beside you, and never run it a second time to make a result pass: the skill verifies the round before it commits." Pin the tokens `one time at most` and `another agent` in `test/spine/settle-cli.test.mjs`; the first-line pin at `test/spine/settle-meter.test.mjs:1596` is untouched.
- `lib/settle-cli.mjs:996-1003` — in the conformance briefing's closing part: "Read the code and the specs. Do not run the test suite or a build: the pass verifies the head separately." Pin the token `Do not run the test suite` in `test/spine/settle-cli.test.mjs`; the first-line pin at `test/spine/settle-meter.test.mjs:1602` is untouched.
- `docs/15-merge-confidence.md:221` (marker), `:225` (verify step, `--strict` sentence, round rule), `:230` (`--changed`); `docs/07-cli-and-configuration.md:222` (comment row); `README.md:106`; `CHANGELOG.md` `[Unreleased]`; archive `tasks.md:69` ticked citing PR #25, head `161f955`, labels `interlock/human-review` and `interlock/score-58`, with a note that its `node bin/interlock` line predates `cli/`.

## Risks / Trade-offs

- [A fenced body inside `<details>` renders as text on GitHub without a blank line after `</summary>`] → the renderer emits the blank line, as `formatMergeConfidenceMarkdown` does; the new test asserts it.
- [`assertInert` in `test/spine/settle-cli.test.mjs:902-940` fails on any `</details>` outside a fence or span] → the test gains a narrow exemption for the renderer's own three exact lines; the hostile title that carries `</details>` stays inside its span and the test still proves it closes nothing.
- [Collapsing does not shrink the comment; GitHub's 65,536-character cap is unguarded] → stated as a non-goal; a later change can add a size guard to `comment`. PR #30's comment would still be about 28 KB.
- [`verify judge` exits 1 on a halt and on a logging failure alike, and the round's file may land empty because it skips the pass-level temporary-file lines] → the skill reads the reason from `verify-r<r>.json` and says `the judge printed no verdict` when the file is empty; either way nothing is committed or pushed, and the guard requirement scopes the `test -s` rule to the pass's `verify.json`.
- [One suite run per round that staged something] → about two minutes on this repository; a prose-only round plans no step. The cost buys never pushing red and never marking a red head ready (report §5 C2).
- [The meter rule "a verify line inside an open round is the round's" is positional] → pinned by the new meter scenario; if a later skill version moves the pass-level verify before `conformance-brief`, the pin fails and says so.
- [The banner now prints after selection; a reader of the old pins expects it right after routing] → the review-depth spec's "before it fans out" still holds; the skill pin asserts the token, not the position.
- [The settle-fixer definition exists only as a file; a plugin install that drops `agents/` makes the spawn fail with an unknown type] → `interlock doctor` lists it as required (D6), so the preflight names the gap.
- [Renaming the fixer's type changes recorded meter fixtures (`test/fixtures/mod/settle-run.mjs`)] → attribution is by first line; the fixtures are updated for accuracy, no assertion compares them to the live prompt.

## Migration Plan

Ships with the plugin; no data, no migration of records. A settle pass started on the previous skill version finishes on it. Rollback is a revert of the commit: the agent file, the renderer branch and the meter rule are additive, and the skill lines return to their previous text with their pins.

## Open Questions

None that change the specs or the tasks. The wording of the `<summary>` (`2 suggestions` / `1 suggestion`) and of the `ROUND FAILED: unit red` reason suffix follows the delta spec's scenarios.
