# Proposal

## Why

Interlock never tells the person which model and effort to run a skill on, yet most of what a run spends follows that choice: the planner, the verify step, the skeptics, the settle fixer and the strict reviewers all inherit the session's model and effort on purpose. A session left on the strongest model at a high effort after a spec makes the ship that follows expensive, and nothing says so. Anthropic's model-selection guide now gives a starting model and effort per kind of work, and the host exposes the session's live effort to a command the session runs, so the plugin can say what fits each skill and how the session compares.

This is Brief 1 of an epic of two. Brief 2, `route-spawn-effort-by-the-model-guide`, changes what spawned agents run at and is specified as its own change.

## What Changes

- **A published suggestion table.** `lib/limits.mjs` gains `SESSION_ADVICE`: one row per skill where the session does the judgment or leads the spawns (`explore`, `spec`, `review-artifacts`, `bootstrap`, `ship`, `settle`, `review-code`, `fix-tests`). A row holds a model, an effort, an optional ceiling the effort may rise to, and an optional best-results pair. The table names the guidance it was read from.
- **A verb that reads it.** `interlock suggest [skill] [--json]` prints the row, the session's observed effort, how the two compare, and what to type to follow the suggestion. With no skill it prints every row. It reads and prints; it changes no setting and never exits non-zero for a session that differs from the suggestion.
- **`interlock limits` prints the rows**, and `interlock limits --json` emits them.
- **The checkpoint card says what the run should be started on.** One keyed line under the outcome that starts `/interlock:ship`, the same for the CLI verb and the spec pane.
- **Seven of the eight skills print their suggestion when they start**, and `dispatch` prints the suggestion for the skill it routes to. `ship` is the exception: it is a launcher that runs no command, so its row reaches the person on the checkpoint card and in dispatch's answer. No skill names a model or an effort level; each prints what the verb returns.
- **Docs.** The CLI reference documents the verb, and the checkpoint document mentions the line.

Nothing here selects a model, sets an effort, or writes a setting. No skill gains `model` or `effort` frontmatter. No hooks-module code changes.

## Capabilities

### New Capabilities

- `session-advice`: the published per-skill session suggestion — the table, the `interlock suggest` verb, how the session's observed effort is compared and spoken, and where the skills print it.

### Modified Capabilities

- `spec/checkpoint-card`: the card gains one line carrying the published suggestion for the ship run, which is the one line that is neither a passed field nor a title of the checkpoint document.

## Impact

- `lib/limits.mjs` — the new table, its basis string, and rows in `formatLimits`.
- `lib/session-advice.mjs` (new) — the only reader of the table; Node-free, because the checkpoint card imports it and the hooks module imports the card.
- `cli/interlock` — a thin `suggest` case and its usage line; `limits --json` gains `sessionAdvice`. The file sits near the directory's per-file size limit, so the logic lives in `lib/`.
- `lib/cli-flags.mjs` and `scripts/postinstall-smoke.mjs` — the verb's flag entry and its smoke rows.
- `lib/checkpoint-card.mjs` — one keyed line after the fifth outcome.
- `skills/{explore,spec,review-artifacts,bootstrap,settle,review-code,fix-tests,dispatch}/SKILL.md` — one instruction each, and a narrow `Bash(interlock suggest *)` grant in `bootstrap` and `fix-tests`. `skills/ship/SKILL.md` is not edited. Skill prose is a shipped surface, so each instruction is pinned in `test/skills.test.mjs`.
- `docs/07-cli-and-configuration.md`, `docs/02-the-checkpoint.md`, `CHANGELOG.md`.
- Tests: `test/spine/session-advice.test.mjs` (new), `test/spine/limits.test.mjs`, `test/spine/cli.test.mjs`, `test/spine/cli-arguments.test.mjs`, `test/spine/cli-inventory.test.mjs`, `test/spine/checkpoint-card.test.mjs`, `test/skills.test.mjs`.
- No dependency is added. No hook, hooks-module event or engine call is added.
