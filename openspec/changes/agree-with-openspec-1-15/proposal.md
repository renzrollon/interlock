# Proposal: agree with OpenSpec 1.15

## Why

Interlock was built against OpenSpec 1.4.0. That CLI never parsed this repo's nested delta specs, so every archive moved a change and left `openspec/specs/` unsynced, and Interlock never said so. 1.15.0 (2026-10-24) parses nested deltas, refuses a MODIFIED block that drops a living scenario, and counts task lines Interlock cannot see. So a ship run can skip a task the CLI calls open, and the spec skill's bare `openspec validate` checks nothing on either version.

## What Changes

- `interlock doctor` warns when the OpenSpec CLI on PATH is older than a published floor, naming the version found and what goes wrong below it. The floor is a constant in `lib/doctor.mjs`. The SessionStart preflight, `preflight.json` and the meter band carry the row unchanged.
- The tasks.md reader counts every line OpenSpec 1.15.0 counts: `+` and ordered-list markers, any one-character box, an empty description. Only `x`/`X` reads as done. The tick and the plan fingerprint rewrite the box they matched instead of a fixed literal.
- The tick guard reads checkboxes through that same reader instead of its own copy, so a hand flip of a `+ [ ]` line during a run is denied like a `- [ ]` one.
- The spec skill validates the change it wrote (`openspec validate "<name>"`), and bootstrap validates the specs it wrote (`openspec validate --specs`). The spec skill states that a MODIFIED block keeps every scenario title the living spec has.
- The two retired, requirement-free living specs (`evals/spec-range`, `spec/checkpoint-advisor`) are deleted, because 1.15.0 rejects a spec with no requirement. `distribution/npm-package` gets a written Purpose in place of the archive placeholder.
- Docs name the floor through the constant, and the changelog records the change.

## Capabilities

### New Capabilities
- `openspec-cli`: what Interlock owes the OpenSpec CLI it composes. That covers the version floor the doctor reports, task-line parity with the CLI's own counter, named validate targets in the authoring skills, and the scenario-title rule for MODIFIED blocks.

### Modified Capabilities
- `hooks/tool-guards`: the tasks.md checkbox guard covers every line shape the task reader counts, not only `- [ ]` / `- [x]`.

## Impact

- Code: `lib/artifacts.mjs` (`TASK_LINE`, `normalizeTaskMarkers`, `tickTasks`), `hooks/guard-tasks.mjs`, `lib/doctor.mjs` (`checkOpenSpec`), and the `bin/interlock` help text for `tasks tick`.
- Readers inherited through `inspectChange`/`parseTasks`, with no edit expected: `lib/run.mjs`, `lib/ready.mjs`, `lib/plan-fingerprint.mjs`, `lib/drift.mjs`.
- Skills: `skills/spec/SKILL.md` §4 and `skills/bootstrap/SKILL.md` §4.
- Living specs: two retired specs are deleted, and one Purpose is written.
- Docs: `docs/01-first-hour.md`, `docs/07-cli-and-configuration.md`, `CHANGELOG.md`.
- Tests: `test/spine/artifacts.test.mjs`, `test/hooks.test.mjs`, `test/spine/doctor.test.mjs`, `test/spine/spec-meter.test.mjs`, `test/skills.test.mjs`.
- No dependency is added and no exit code changes. A floor miss is a `warn`, never a `fail`.
