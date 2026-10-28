# Proposal

## Why

A change that spans many capabilities does not converge at the artifact gate: a fresh reader of that size always finds more. On 2026-10-29 a 12-capability, 20-task change took five gates and about a million subagent tokens before the owner stopped it. The spec skill now says to split such a change into an epic of briefs, but the judgment is prose, and the skill itself says "the CLI publishes no cap for it". Thresholds live in the CLI, not in prose (`docs/12-repository-review-policy.md`), so the width should be measured and its caps published there.

## What Changes

- `interlock validate <change> --json` reports `width`: the count of delta spec files (one per capability the change touches), the count of checkbox tasks, the two published caps, `wide`, and `over` naming the caps exceeded. The text form adds a `CHANGE WIDE:` line naming the capabilities. `ready`, `problems` and the exit code are unchanged: a wide change is implementable, and `ready` stays the verdict.
- Two new caps, `maxChangeCapabilities` and `maxChangeTasks`, printed by `interlock limits`, emitted under `limits` by `--json`, and read by the change inspection alone. The values are the owner's call (decisions ledger D1), with a recommendation drawn from the 75 archived changes.
- `/interlock:spec` §4 reads `width.wide` from the validate line it already runs. When it is true the skill prints the CLI's `CHANGE WIDE:` line, runs no artifact gate, and stops at the checkpoint with a proposed split into an epic of briefs grouped by the delta specs' capabilities. §1b's sentence that the CLI publishes no cap is replaced by the read.
- The spec meter's validate line shows `WIDE` from the field when the record carries it; a record without `width` (an older CLI) still reads as today.
- Not in this change: a width check before the artifacts exist (nothing measurable exists then: the explore brief carries no capability list), a width signal in `interlock ready` or the merge verdict, and any change to `openspec validate`.

## Capabilities

### New Capabilities

- `spec/change-width`: the measurement of a change's width from its own artifacts, the published caps, how the measurement rides on the validate line, and what the spec skill does with a wide change.

### Modified Capabilities

- `spec/machine-readable-gate-lines`: the validate-line requirement gains the `width` fields and the skill's reading of them, with `ready` still the verdict.
- `hooks/spec-meter`: the status-line and pane requirement's validate bullet reads `width.wide` when present and composes `WIDE` from it.

## Impact

- `lib/artifacts.mjs` (`inspectChange`, `formatInspection`: the one reader of the two caps), `lib/limits.mjs` (two rows, two printed rows), `lib/spec-meter.mjs` (the validate reader and its two texts). `hooks/mod.mjs` reads the pure module and does not change. `bin/interlock` gains no bytes: its `validate` case is unchanged.
- `skills/spec/SKILL.md` §1b, §4, §5 and §6. `skills/spec/continuity.md` is unchanged: a wide change has no findings file, so `--continue` already stops.
- Tests: the change-inspection tests, `test/spine/limits.test.mjs` (the cap-authority sweep finds the reader; the printed rows), `test/spine/spec-meter.test.mjs`, `test/skills.test.mjs`, the validate fixture in `scripts/postinstall-smoke.mjs` (keys only; unchanged unless `width` is added to its keys).
- `docs/07-cli-and-configuration.md` (the `validate` row and the spec-meter status table), `CHANGELOG.md`.
