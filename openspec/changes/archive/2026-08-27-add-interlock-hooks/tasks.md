## 1. Stage marker (`lib/ship-stage.mjs`)

- [x] 1.1 Add `lib/ship-stage.mjs` with `writeStage(change, stage)`, `readStage()`, `clearStage(change)`, and a `stagePath(change)` deriving `.claude/ship/<change>/stage.json`. The module never throws: a write error returns a warning value, a read of an absent/malformed marker returns `{ stage: 'unknown' }`.
- [x] 1.2 Encode the staleness rule in `readStage()`: a marker whose `pid` has no live process, or whose `index` is not the current run's, resolves to `stage: 'unknown'`. Document that `pid` is a hint backstopped by `index`.
- [x] 1.3 Add `test/spine/ship-stage.test.mjs`: round-trip write/read, absent marker → unknown, malformed JSON → unknown, stale `index`/dead `pid` → unknown, clear removes the marker.

## 2. Workflow publishes and clears the marker

- [x] 2.1 In `workflows/ship.js`, write the stage marker on entry to each stage (implement, verify, review, remediation, fix-tests, commit) using literals duplicated from `lib/ship-stage.mjs`, with a cross-referencing comment on both sides (mirror the `PING_AGENT`/`WORKER_TOOLS` pattern at `workflows/ship.js:600`).
- [x] 2.2 Clear the marker on every terminal path — commit, halt, abort/apply-only exit — so no stage leaks into the next session.
- [x] 2.3 Add a test asserting the marker path and JSON shape literals in `workflows/ship.js` match `lib/ship-stage.mjs` exactly (drift guard).
- [x] 2.4 Record a non-fatal warning on the run trajectory when a marker write fails; the run continues.

## 3. PreToolUse guards

- [x] 3.1 Add `hooks/guard-tests.mjs`: deny Edit/Write to a resolved test path (from `.claude/testing/profile.json`) when `readStage()` is `remediation` or `fix-tests`; allow otherwise; allow on unresolvable path; on internal error exit allow-direction with stderr diagnostics.
- [x] 3.2 Add `hooks/guard-tasks.mjs`: deny Edit/Write that changes a checkbox line (`- [ ]`/`- [x]`) in the change's `tasks.md` during an implementation stage; allow prose-only edits that leave every checkbox byte-identical; allow when stage unknown.
- [x] 3.3 Add `hooks/guard-commit.mjs`: deny a Bash command performing `git commit` (incl. `git -C <path> commit`) unless stage is `commit`; allow when there is no active run marker.
- [x] 3.4 Each guard emits a machine-readable deny reason (guard name, path/command, current stage) in the host's PreToolUse hook shape.

## 4. SessionStart preflight

- [x] 4.1 Add `hooks/preflight.mjs`: run `interlock doctor --json`, print each `fail` check with its `fix` string as advisory output, exit non-blocking. If the `interlock` binary is unresolvable, report that and exit non-blocking.

## 5. Declaration and docs

- [x] 5.1 Add the `hooks` key to `.claude-plugin/plugin.json` declaring the `SessionStart` hook and the three `PreToolUse` hooks (matchers: Edit/Write for the edit guards, Bash for the commit guard) pointing at the `hooks/` scripts.
- [x] 5.2 Add `test/hooks.test.mjs` covering each guard's deny/allow decisions against synthetic PreToolUse events and stage markers (happy/failure/edge per the specs).
- [x] 5.3 Add a `docs/` page documenting the four hooks, the stage marker's lifecycle, and the fail-open rule; note in `README.md` that the guards bind only agents inside an Interlock ship run and are inert outside one.
- [x] 5.4 Run `openspec validate add-interlock-hooks --strict` and the full test suite; fix any failures.
