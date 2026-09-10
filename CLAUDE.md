# Interlock

Autonomous spec-driven development orchestration for Claude Code, layered on OpenSpec.

This file is the canonical root instruction file. `AGENTS.md`, if present, is a pointer to it — do not maintain a second copy of this content there.

## Commands

- **Test**: `npm test` — `node --test` over a `find`-piped file list. Run it this way; a bare `node --test 'test/**/*.test.mjs'` relies on runner-side glob expansion, which collects **zero** tests on Node 18 and 20 and reports success.
- **Validate the plugin**: `npm run validate` — `claude plugin validate . --strict`. Manifest and marketplace shape.
- **There is no lint or build step.** Do not invent one, and do not add one to a verification block.

## Conventions

- **Zero runtime dependencies.** `package.json` has no `dependencies` key and CI installs nothing — the whole toolchain is stdlib Node. Adding a dependency is a design decision, not an implementation detail; it belongs in a change's `design.md` with a pinned exact version.
- Node >= 18, `"type": "module"`, `.mjs` throughout.
- `openspec/` belongs to the OpenSpec CLI. Write into it through `openspec new change` / `openspec instructions`, not by hand-scaffolding directories.

## Architecture

- `bin/` — the executables that land on a user's PATH (`interlock`, `interlock-graph`, `interlock-run`, plus the `interlock-ship-acp` deprecation shim). Exit codes are the contract; a gate blocks by exiting non-zero.
- `lib/` — pure decision modules, one concern each. No I/O beyond what a module's name implies. `lib/run.mjs` is the ship loop itself: it emits the whole program as versioned steps (agents to spawn, briefings, the exact CLI argv to call next); `lib/prompts/` assembles every briefing those steps carry.
- `skills/` — model-facing prose. This is a shipped surface: a reworded instruction is a behaviour change.
- `hooks/` — `PreToolUse` and `SessionStart` guards, registered in `.claude-plugin/plugin.json`.
- `workflows/ship.js` — the drivers are interpreters, not orchestrators: this script (and `bin/interlock-run`) spawn what a step from `interlock run` names, create the lane worktree it names, and call what it names next. Neither holds loop logic; `lib/run.mjs` does.
- `lib/host/` — one adapter per vendor coding CLI (`claude-cli`, `acp`, `codex`, `qwen`), plus the registry that declares what each host cannot do and the one model map they all read. A capability is declared so the run program can branch on it and the runner can banner it; a host that could not be bannered is a run that degraded silently.
- `docs/` — numbered, human-facing. `.claude/graph/` holds the agent-facing digests instead.

## Things to get right

- **Thresholds live in the CLI, not in prose.** Caps, bands and gate verdicts are code specifically so a model cannot re-argue them. Never restate a numeric threshold in a skill or a review prompt — read it from `interlock limits`, or let the gate decide. See `docs/12-repository-review-policy.md`.
- **Guards fail open, never closed.** Every hook allows on anything it cannot establish — unknown stage, unresolvable path, missing profile, its own crash. A guard that blocked whenever its marker was absent would break ordinary work the moment the plugin is installed.
- **Corpus-loss semantics differ by corpus, and the difference is deliberate.** The outcome corpus and review metrics report their own write failures and never touch the exit code. The run trajectory (`.claude/ship/runs`) and spill are `fatal: true` — a failed append exits 1, because a run nobody can reconstruct defeats the reason the file exists. Do not "make it consistent."
- **A prose instruction nobody asserts silently stops running.** `interlock review --metrics` existed for a year and no skill ever passed it; the corpus stayed empty and read exactly like a loop that never ran. When you add an instruction to a skill, pin it in `test/skills.test.mjs` — and assert tokens, not sentences, or the first reword deletes the pin.
- **Degradation is spoken, never silent.** If a path degrades — a missing graph, an absent credential, an unreadable file — say so in the output. Never fall back quietly.

## Verifying your work

Before reporting a task complete, run the tests that pin what you changed, and paste the output. Which tests that is depends on the diff, not on habit:

- **Code:** anything under `lib/`, `bin/`, `hooks/`, `workflows/`, `skills/`, `agents/`, `shared/`, `evals/`, `test/`, `.claude-plugin/`, or `package.json` gets the whole suite, `npm test`.
- **Prose:** `docs/`, `README.md`, `CHANGELOG.md`, `site/`, `openspec/`, `.github/`. Find what reads each touched file — `grep -rl '<filename>' test/` — and run only the test files that come back, with `node --test <file>`. If nothing comes back, skip the suite and say so in the report. Do not assume prose is untested: `test/workflows.test.mjs` reads `docs/04`, `docs/06`, `docs/10`, `docs/14` and `README.md`, and `test/skills.test.mjs` pins every skill. CI runs the full suite on every pull request either way, so the local run exists for changes whose fix loop is local.

This is the rule the ship loop applies to itself — `isDocsPath` in `lib/risk.mjs` skips a docs-only wave's verification — so a hand-run task should not be stricter than the loop.

If a test fails, fix the code. Do not edit, weaken, skip, or delete the test — `hooks/guard-tests.mjs` denies test edits during a run's `remediation` and `fix-tests` stages for exactly this reason, and doing it by hand outside a run is the same mistake without the guard.
