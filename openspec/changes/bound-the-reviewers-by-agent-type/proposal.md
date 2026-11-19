# Proposal

## Why

Every read-only agent of the review loop is spawned with no agent type, so it inherits every tool the session has: it can edit files, spawn agents, invoke skills and reach MCP servers. The only thing stopping it is a sentence in its prompt, and that has failed on record: on dial PR #1 the settle conformance worker spawned seven agents of its own, and their tokens were never reported. The fix round already runs as a bounded plugin agent (`interlock:settle-fixer`); the readers do not.

A host probe on 2026-11-19 (Claude Code 2.1.310 and 2.1.318) settled the one thing the fixer's design had assumed and never checked: a plugin agent's `tools` list is enforced for a spawned agent, and a call naming a type that does not exist fails with an error instead of running as the default type. So a tool list in an agent file is a bound, and it needs no hook.

This is not a change for review consistency. Reviewers already start in a fresh context with the CLI's brief as their whole prompt, and a typed agent will not make two rounds agree.

## What Changes

- A new plugin agent, `agents/reviewer.md` (`interlock:reviewer`): tools `Read, Grep, Glob, Bash`; `Write`, `Edit`, `Skill`, `Agent` and `mcp__*` disallowed; no model and no effort. `interlock doctor` counts the file among the plugin's required files.
- The four read-only spawn sites name that type: review-code's dimension reviewers (first pass and proof re-runs), review-code's skeptics, settle's conformance worker and the artifact gate's strict reviewer. Model and effort still come from `interlock routing`, on the call.
- A reviewer that cannot be spawned is never replaced by another type. Each site prints its own line: review-code stops with `REVIEW FAILED: reviewer type unavailable`, and settle treats that as an early stop; settle's confirmation prints `CONFORMANCE SKIPPED: reviewer type unavailable` and goes on with no handoff; the strict artifact gate prints `STRICT REVIEWER UNAVAILABLE:` and falls back to its inline read.
- The conformance worker no longer writes its answer file. `interlock settle conformance-brief` asks for the answer as the reply, one JSON object, and the settle skill writes `.claude/ship/settle/handoff.json` from that reply as returned. A reply that holds no such object prints `CONFORMANCE UNREAD:` and writes no handoff.
- The reviewers' write-nothing prompt line stays. The shell can still write, so the type is the first bound and the prompt the second.
- Not changed: the ship workflow's review step. Its reviewers write answer files and stay `interlock:worker`.

## Capabilities

### New Capabilities

- `review/reviewer-agent`: the read-only plugin agent type the review loop's readers run as. It owns the type's tool bound, which spawn sites name it, and what a skill does when the type cannot be spawned.

### Modified Capabilities

- `review/settle-loop`: `interlock settle conformance-brief` asks its worker to reply with the answer instead of writing the result file, and the skill writes the handoff from that reply.
- `review/review-briefs`: the reason given for the write-nothing line changes. The prompt was the only bound; it is now the second one, behind the agent type. The prompt text does not change.

## Impact

- New file: `agents/reviewer.md`.
- Skills (shipped prose, so behaviour): `skills/review-code/SKILL.md`, `skills/settle/SKILL.md`, `skills/review-artifacts/SKILL.md`.
- CLI: `lib/settle-cli.mjs` (the last paragraph of the conformance briefing, the `--result` usage text), `lib/doctor.mjs` (the required-files list and its count wording).
- Tests: `test/spine/plugin-agents.test.mjs`, `test/spine/doctor.test.mjs`, `test/spine/package.test.mjs` (the frozen tool-grant inventory gains `agents/reviewer.md`, because the type holds `Bash`), `test/spine/settle-cli.test.mjs`, `test/spine/settle-meter.test.mjs`, `test/skills.test.mjs`.
- Docs: `docs/04-when-it-stops.md`, `docs/06-why-it-works.md`, `docs/08-harness-landscape.md`, `docs/15-merge-confidence.md`, `CHANGELOG.md`.
- No new dependency, no new routing role, no new published limit, no hook.
- A session whose plugin was installed before this change has no `interlock:reviewer` type. The skill and the agent file ship in one plugin version, so this only happens when a session reads a newer skill than the plugin it loaded; the lines above say what each site does then.
