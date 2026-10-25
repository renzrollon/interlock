## Why

When the main session runs a frontier model at high effort, every subagent that `/interlock:spec` and `/interlock:settle` reach is spawned at that same model and effort, because none of the five spawn sites names either: explore's investigators (`skills/explore/SKILL.md:89`), review-code's dimension reviewers and skeptics (`skills/review-code/SKILL.md:50`, `:96`), and settle's fixer and conformance worker (`skills/settle/SKILL.md:226`, `:357`). Ship does not have this problem — `lib/waves.mjs` clamps a lane's model and `EFFORT` in `lib/limits.mjs` fixes the effort, `interlock limits` publishes both, and the drivers banner an environment override — but nothing of that reaches a prose skill. The result is that a Fable session pays frontier prices for a read-only investigator that returns a JSON locator list, and the skeptic effort ship pins at one published value is whatever the session happens to be set to when settle runs the same skeptic.

## What Changes

- **A published role table.** `SPAWN_ROUTING` sits beside `EFFORT` in `lib/limits.mjs`: one row per prose spawn role — `explore-investigator`, `review-dimension`, `review-skeptic`, `settle-fixer`, `settle-conformance` — each a `{ model, effort }` pair where `null` means "omit the parameter, inherit the host's default", the meaning `EFFORT.byTier` already gives it. `review-skeptic` reads `EFFORT.skeptic` by reference, so a skeptic runs at one published effort on the ship path and the settle path alike. `interlock limits` prints the rows and `limits --json` emits the table.
- **A one-role query.** `interlock routing <role> [--json]` resolves a role to the `model` and `effort` a spawn passes, and names in `banners` any environment override that makes them not in effect (`CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`), in the words ship already prints. An unknown role exits non-zero and names the roles. With no role it prints the whole table. The resolver lives in a new `lib/routing.mjs`; the `bin/interlock` case is a few lines.
- **The spawn sites read it.** Before fanning out, explore runs `interlock routing explore-investigator --json` once and passes its `model` and `effort` on every investigator call; review-code does the same for `review-dimension` and `review-skeptic`; settle for `settle-fixer` and `settle-conformance`. Each site prints the banners verbatim, and when the command exits non-zero prints `ROUTING UNAVAILABLE: <first line>` and spawns at the session defaults. No skill names a model or a level. Explore's `allowed-tools` gains `Bash(interlock *)`.
- **Spec says where its spawns come from.** `skills/spec/SKILL.md` §1b states that spec spawns nothing itself and that explore's investigators are routed by role, so a reader of spec finds the policy without opening explore.
- **The discipline is shared.** `shared/TOOL-ECONOMY.md` gains a rule: a prose spawn names its model and effort from `interlock routing <role>`, never by omission and never by a literal in prose.
- **The host floor is reported.** `interlock doctor` reports whether the installed Claude Code applies a per-call effort (2.1.292 and later) beside the subagent-model lines it already prints.
- **Pinned, not promised.** `test/skills.test.mjs` asserts each site's tokens; `test/spine/limits.test.mjs` and `test/spine/cli.test.mjs` cover the table and the command; `docs/07` documents the command, `docs/10` §5 names the routed prose spawns; CHANGELOG `## [Unreleased]` gets an entry.

Out of scope, deliberately: ship's run program, `lib/waves.mjs`, `lib/lane.mjs` and the plan's tier routing (the owner judged them fine); `review-artifacts`, which runs its two reviewers inline and spawns nothing; the spec meter's investigator line, which already reads the served model and can show it in a follow-up.

## Capabilities

### New Capabilities
- `spawn-routing`: how a prose skill's subagent spawn gets its model and effort — a table published by the CLI, a one-role query that resolves it and speaks overrides, spawn sites that read it before spawning and say when they could not, and a host-floor report in the doctor.

### Modified Capabilities
<!-- none: `effort-routing` names four run-program spawns as its inheriting set and says nothing about skill-prose spawns; the review capabilities constrain what a reviewer receives, not what it runs on -->

## Impact

- **Code:** `lib/limits.mjs` (table, `formatLimits` rows), new `lib/routing.mjs`, `bin/interlock` (`routing` case, `limits --json` key, USAGE line), `lib/host/claude-env.mjs` (per-call effort floor constant), `lib/doctor.mjs` (one report line).
- **Skills:** `skills/explore/SKILL.md`, `skills/review-code/SKILL.md`, `skills/settle/SKILL.md`, `skills/spec/SKILL.md`, `shared/TOOL-ECONOMY.md`. A reworded instruction is a behaviour change: every edit keeps the tokens `test/skills.test.mjs` already pins and adds its own.
- **Tests:** `test/skills.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/cli.test.mjs`, new `test/spine/routing.test.mjs`, the doctor test.
- **Docs:** `docs/07-cli-and-configuration.md`, `docs/10-agentic-workflow-ship-and-spec.md`, `CHANGELOG.md`.
- **Dependencies:** none added. The per-call `effort` parameter needs Claude Code 2.1.292 or later; an older host ignores it, which the doctor says and nothing else can.
- **Behaviour change for users:** investigators, dimension reviewers and the conformance worker run on the published model and effort instead of the session's. The initial values are the one human decision in this change (ledger D1); each is a single line in `lib/limits.mjs`.
