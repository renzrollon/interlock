# Proposal

## Why

No bundled review rubric asks whether a changed line is correct. `regression`, `blast-radius` and `devops` each hand that question to "another reviewer", and no rubric takes it: `language` asks for type safety, framework idiom, performance and test quality. A comparison with Claude Code's built-in `/code-review` (`.docs/REVIEW-CODE-VS-BUILTIN-2026-11-17.md`) found that gap and four smaller ones in rubric text: nobody asks what a deleted line protected, nobody checks the diff against the repository's written rules, nobody asks whether a fix removes the cause, and "do not filter findings yourself" reaches only ship's reviewers. It also found rubric lines that were never meant for the reviewer who receives them.

All of it is text the reviewers are given. Fixing it adds no agent, no threshold and no field.

## What Changes

- **The `language` brief owns the changed lines.** It opens by claiming them: read every changed hunk and the function around it, and ask of each changed line what input, state, timing or platform makes it wrong. Pitfalls are named for the detected language, not for one framework. Type safety and hot-path performance stay. Its filename and its heading line stay.
- **The `regression` brief asks what the diff removed.** For each line the diff deletes or replaces: what it enforced, and where the new code re-establishes it.
- **The `technical-lead` brief gains two checks.** The diff against the repository's written rules, raised only when the rule and the breaking line can both be quoted; and whether a fix removes the cause or hides the symptom.
- **One owner for the scenario-to-test check.** `technical-lead` keeps it and also takes the test-quality question from `language`; `qa` stops repeating it and keeps untested behaviour and edge cases.
- **Every reader of the proof rules is told not to filter its own findings.** Today only a reviewer that writes an answer file is told.
- **A rubric carries only text for its reviewer.** The unexpanded `${CLAUDE_PLUGIN_ROOT}` pointer in `technical-lead` is replaced by the two sentences it pointed at. The "Run this dimension when" line leaves `devops`. The embedded emit shapes leave `regression` and `blast-radius`; the CLI already prints the one shape.
- **Each new instruction is pinned by token** in `test/skills.test.mjs`.

Not changed, on purpose: the lifecycle bullet in `blast-radius` (a living requirement demands it) and the security-surface bullet in `devops` (on ship's path it can be the only reviewer asking). The report proposed cutting both; `design.md` says why they stay.

No dimension is added, renamed or removed. No finding field, verdict field, gate or limit changes.

## Capabilities

### New Capabilities

- `review/language-dimension`: what the bundled `language` brief asks of its reviewer, starting with the correctness of the changed lines.
- `review/technical-lead-dimension`: what the bundled `technical-lead` brief asks beyond planned-against-built: the repository's written rules, fix depth, and the one copy of the scenario-to-test check.

### Modified Capabilities

- `review/regression-dimension`: adds a requirement that the brief asks what each removed line protected.
- `review/rubric-delivery`: adds a requirement that a bundled rubric carries only text meant for its reviewer.
- `review/review-briefs`: adds a requirement that every prompt carrying the proof rules tells its reader not to filter its own findings.

## Impact

- **Rubrics:** `skills/review-code/dimensions/language.md`, `regression.md`, `technical-lead.md`, `qa.md`, `devops.md`, `blast-radius.md`. These are one set of files read by `interlock review brief` and by ship's strict review, so the change reaches `/interlock:review-code`, `/interlock:settle --review` and `/interlock:ship --strict` together.
- **Prompt assembly:** `lib/prompts/review-dimension.mjs` (one sentence leaves a conditional). The ship remediation briefing prints the same proof rules and gains the sentence.
- **Tests:** `test/skills.test.mjs` (new token pins), `test/spine/prompts.test.mjs` (the sentence with and without an answer path).
- **Docs:** `CHANGELOG.md`.
- **Reviewers' output:** findings about changed-line defects now come from `language`; a repository that reads per-dimension counts will see that dimension's share rise.
- No runtime dependency, no CLI flag, no exit code, no record shape.
