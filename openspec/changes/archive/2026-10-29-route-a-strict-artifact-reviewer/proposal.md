# Proposal

## Why

The artifact gate, `/interlock:review-artifacts`, runs inline in the session that wrote the artifacts, so it reads its own work. When an unanchored read is wanted, the plugin offers none: on 2026-10-29 a session improvised it by spawning unrouted general-purpose agents outside the routing table every other prose spawn reads, and that is where the real defects of a wide change were found (the second gate) and where the cost ran away (the third to fifth). The depth should be a flag the person chooses, with a routed role, as `review-code` and `settle` already have.

## What Changes

- `/interlock:review-artifacts <change> [--strict]`. Lean, the default, stays the inline read. `--strict` spawns one independent reviewer whose whole brief is this skill's reviewer sections, the artifact paths and the emit shape; the reviewer reads and runs read-only checks, writes nothing, and returns its findings as JSON. The skill writes the findings file and runs the gate line itself, so the emit contract, the gate line and the autonomy record are unchanged at both depths.
- A sixth routing role, `artifact-reviewer`, in the published routing table, read through `interlock routing artifact-reviewer --json` before the strict spawn, with every banner printed verbatim and `ROUTING UNAVAILABLE:` on failure, as the five existing spawn sites do.
- `/interlock:spec [--strict]` passes the flag to its gate line, as `settle --strict` reaches every `review-code` pass.
- The living `spawn-routing` requirements, `shared/TOOL-ECONOMY.md` Rule 5, the tests that enumerate the roles, `docs/07-cli-and-configuration.md` and the CHANGELOG name six roles.
- Not in this change: a cap on the warnings a lean gate reports, any change to the gate's verdict, the `--since` re-gate (shipped as prose on 2026-10-29), and a CLI-assembled artifact brief. `prove-the-review-covered-the-diff` moves the code-review briefs into `interlock review brief`; until it lands the strict brief is the skill's own sections, and moving the artifact brief into the CLI afterwards is a change of its own.

## Capabilities

### New Capabilities

- `spec/artifact-gate-depth`: how the artifact gate runs at each depth: the inline lean read and the routed strict read, what the strict reviewer is handed, what it returns, and that the skill, not the reviewer, writes the findings file and gates it.

### Modified Capabilities

- `spawn-routing`: the published role table gains `artifact-reviewer`; the spawn sites become six, with the artifact gate's strict read routed by role; the unknown-role error names six roles.

## Impact

- `lib/limits.mjs`: one table row. `lib/routing.mjs` derives the role list from the table and does not change. `bin/interlock` gains no bytes; the `routing` verb is unchanged.
- `skills/review-artifacts/SKILL.md`: `--strict` in the argument hint, `Agent` in `allowed-tools`, a depth section that routes and spawns, a `REVIEW DEPTH:` line. `skills/spec/SKILL.md`: a flag-table row and the §5 gate line. `shared/TOOL-ECONOMY.md` Rule 5.
- `openspec/specs/spawn-routing/spec.md` by delta. Tests that enumerate the roles: `test/spine/routing.test.mjs`, `test/spine/cli.test.mjs`, `test/spine/limits.test.mjs`, `test/skills.test.mjs` (Rule 5 and the new site's pins), the routing fixture in `test/spine/settle-meter.test.mjs`, and `test/spine/spec-meter.test.mjs`, whose unread-by-name list takes the new fenced routing line.
- `docs/07-cli-and-configuration.md` (the `routing` row and `## Model routing`), `CHANGELOG.md`.
