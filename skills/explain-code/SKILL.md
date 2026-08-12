---
name: explain-code
description: Explain code to a beginner in that stack — either a module walkthrough (what each function does, how calls link, where data flows, which patterns recur) or a commit teach-in (why each file changed, what changed, blast radius, what would break if it were left out). Use when asked to explain code, walk through a directory, or explain the last commit.
license: MIT
compatibility: Requires git for commit teach-in mode. Optional openspec CLI for change scoping.
argument-hint: "[path | --commit | --commits N]"
allowed-tools: Bash(git *) Bash(interlock-graph *) Bash(openspec *) Read Write Grep Glob
metadata:
  type: teaching
  autonomy_level: L2
---

Teach code to someone new to this stack. **Not reviewing, not judging — teaching.**

Calibrate to a reader who knows programming fundamentals but is new to this project's language and framework. Explain the idioms that stack takes for granted, one short aside each. Do not explain what a function is.

## Modes

| Mode | When | Load |
|------|------|------|
| **Module walkthrough** (default) | A file or directory is named, or the user asks how an area works | `${CLAUDE_SKILL_DIR}/module-walkthrough.md` |
| **Commit teach-in** | Last commit, a hash or range, "what changed", `--commit` / `--commits N` | `${CLAUDE_SKILL_DIR}/commit-teachin.md` |

When ambiguous, prefer the module walkthrough unless the user mentioned a commit or "what changed".

**After choosing a mode, read the matching sibling file and follow it** for steps, structure, and output format. This file only routes.

## Output path

Resolve the destination before writing. Both modes use the same rule:

| Situation | Write to |
|---|---|
| Scoped to an OpenSpec change — a change name was passed, or one resolves via `openspec status --json` | `openspec/changes/<change-name>/code-explanation.md` |
| No change context (ad-hoc walkthrough) | `docs/CODE_EXPLANATION.md` |

**Do not "simplify" this back to a single path.** A change-scoped explanation belongs beside `manual-test-plan.md` in its own change directory. Writing every run to `docs/CODE_EXPLANATION.md` overwrites the previous change's explanation — and because `docs/` is the corpus `/interlock:docs-digest` indexes, each rewrite permanently marks `.claude/graph/DOCS_DIGEST.md` stale through its `source_hashes`.

## Shared rules

- **Single agent, no fan-out.** Understanding builds sequentially; parallel investigators produce four disconnected fragments, which is the opposite of a walkthrough.
- Write the full explanation to the resolved path (overwrite), then tell the user the file is ready with a 5–10 line summary.
- Pull domain context on demand: `.claude/graph/DOCS_DIGEST.md` first, then `interlock-graph context` / `docs`. Never preload all of `docs/` — see `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md` Rule 0.5.
