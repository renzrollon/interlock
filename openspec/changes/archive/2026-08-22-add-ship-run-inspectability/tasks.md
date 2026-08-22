## 1. Trajectory writer (never-throw)

- [x] 1.1 Add `lib/run-log.mjs` with schema `interlock.ship-run/1`, path `.claude/ship/runs/<runId>.jsonl`, torn-line heal copied from `lib/outcomes.mjs`, seq assigned by the writer, and key-by-key payloads for `run-start`, `wave-action`, `cli-exit`, `agent-spawn`, `verify-judgement`, `run-halt`, `run-complete`
- [x] 1.2 Put `runId` on `createRunState` output in `lib/waves.mjs` so it survives `--write-state` into `.claude/ship/state.json`
- [x] 1.3 Add `test/spine/run-log.test.mjs` covering append order, torn last line, unknown keys dropped, and outcomes file untouched
- [x] 1.4 Wire `interlock run-log append --event <file|->` in `bin/interlock` (never-throw; print `{ written, path, reason }`)

## 2. CLI side effects on wave-state and verify

- [x] 2.1 Make `wave-state create|next|record-batch|record-verify|replan` append `wave-action` + `cli-exit` from the state `runId` without a new agent turn
- [x] 2.2 On wave-entry `next` / `--write-state` steps, append one `agent-spawn` per task in `remainingBatches` (fallback `tasks[]`; `label`, `model`, `kind=implementer`, `taskId`). Mid-wave `record-batch --write-state` MUST NOT duplicate those events
- [x] 2.3 Make `verify judge` append `verify-judgement` when `--state` or `--run-id` is present; do not put suite stdout on the line
- [x] 2.4 Extend `test/spine/cli.test.mjs` so create → record-batch produces a JSONL with contiguous `seq` and a reconstructable walk
- [x] 2.5 CLI test: a three-batch serialized wave logs three `agent-spawn` events on the first `next`, and `record-batch --write-state` of batch 0 does not append more

## 3. Spill oversized verify output

- [x] 3.1 Add `LIMITS.verifySpillBytes` (8192) and `LIMITS.verifyPreviewChars` (4096) in `lib/limits.mjs` and print them from `interlock limits`
- [x] 3.2 Add `lib/spill.mjs` writing `.claude/ship/spill/<runId>/<seq>-<kind>.log` and returning `{ locator, bytes, preview, truncated, sha256 }`
- [x] 3.3 Add a verify helper (CLI or small wrapper, not inside pure `judgeVerification`) that spills over-threshold stdout/stderr and rejects result fields larger than the preview budget
- [x] 3.4 Add `test/spine/spill.test.mjs` plus CLI tests for threshold, head/tail preview, hash, and oversized-result reject
- [x] 3.5 Update the inter-wave and final verify prompts in `workflows/ship.js` to pass `--state ${STATE}`, spill, and return locator+preview+counts+clusters — never the full log
- [x] 3.6 Document locator-then-Read-spans for suite output in `shared/TOOL-ECONOMY.md`

## 4. Instrument ship.js pings (still no extra turns)

- [x] 4.1 Teach the existing cheap pings (`record-batch-*`, `inter-wave-verify-*`, `replan-*`, `record-outcome`, `verify`, `halt`/`finish`) to `run-log append` spawn/halt/complete events in the same prompt
- [x] 4.2 Assert in `test/workflows.test.mjs` that `ship.js` still has no `import()`/`fs` and that it invokes only dispatched `interlock` subcommands including `run-log`

## 5. Session-query (after log + spill)

- [x] 5.1 Implement `interlock run-log list [--change]`, `show <runId>`, and `query --run [--type] [--halted]` with `--json`; skip torn/bad lines and report them
- [x] 5.2 Add CLI tests for list/show/query on a fixture JSONL that includes a halt and a spilled verify judgement
- [x] 5.3 Document `run-log show` as the way to read a `SHIP HALTED` run in `docs/04-when-it-stops.md`

## 6. Reconstructability as a gate (after query)

- [x] 6.1 Add `run-log check --state` that requires contiguous `seq` from 1, a `run-start`, a `run-halt` or `run-complete`, and a `cli-exit` per `wave-state` / `verify judge` invocation
- [x] 6.2 Switch trajectory write failures on `wave-state` and `verify judge` from reported no-op to non-zero exit; keep `outcomes append` never-throw
- [x] 6.3 Call `run-log check` from ship halt and finish (same ping pattern as `record-outcome`); treat non-zero as `SHIP HALTED`
- [x] 6.4 Tests: unwritable log halts; seq gap fails check; outcomes write failure still does not halt
- [x] 6.5 Add the reconstructability halt to `docs/04-when-it-stops.md` and a short inspectability paragraph to `docs/06-why-it-works.md`
