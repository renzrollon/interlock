## Why

Interlock has two drivers of one loop — `workflows/ship.js` on the Claude Code Workflow runtime and `bin/interlock-ship-acp` over ACP — and each carries its own copy of the loop's control flow and of the text every agent is handed. Policy is shared only by smuggling marked blocks of `ship.js` source through `new Function` (`workflows/ship.js:96-110`, `bin/interlock-ship-acp:235-300`) and by parity tests that compare the two drivers' prompts after the fact (`test/spine/planner-prompt.test.mjs`, `.claude/memory/coupling/classifier-policy-lives-in-two-drivers.md`). Every new classifier field, banner or prompt sentence has to be added twice, and the repository's own memory records the times it was added once. The explore brief's first recommendation is to end the duplication at its source: let the CLI emit the whole run program, so a driver has nothing left to duplicate (`.claude/handoff/explore-creating-or-reusing-harness-20260904-171500.md` §Recommended Direction 1).

## What Changes

- **A `run` subcommand family emits every step of the lean loop.** `interlock run start | classified | next | record-batch | judge | replan | close` wrap the existing pure state machine, planner, verifier and receipt code and return a versioned step record: the action, the agents to spawn with their label, model, effort, agent type, tool allowlist, result schema and briefing, and the exact CLI argv to call once those agents return. A driver obeys the record; it decides nothing.
- **Briefings become files the CLI writes.** Every prompt an agent receives is assembled by `lib/prompts/` and written to `.claude/ship/briefings/<label>.md` with its SHA-256 on the first line. The step carries the path, the hash and the text. A host that cannot pass a large prompt through a mechanical relay delivers the briefing by reference with a fixed bootstrap and fails closed any result that does not acknowledge the hash.
- **Both drivers become interpreters.** The Workflow script and the ACP driver each shrink to a loop that spawns what a step names and calls the argv the step names. The marked blocks (`ASSEMBLE_IMPLEMENTER_PROMPT`, `LANE_DISPATCH`, `LANE_EFFORT`, `RECORDED_VERDICT`, `STEP_SHAPE`, `BUILD_RECEIPT`), the duplicated stage-marker literal, and the cross-driver parity tests are retired; a new test asserts that neither driver contains briefing text or loop policy.
- **Recording a batch ticks tasks and folds isolated lanes in one CLI call.** `run record-batch` runs the lane merge (when the run is isolated), records the batch, ticks completed tasks and returns the next step, replacing three agent-mediated calls.
- **The run-step budget becomes a published cap.** The `MAX_LOOP_STEPS` literal that both drivers restate moves to `lib/limits.mjs` as `maxRunSteps`, enforced by the CLI.
- **The strict tail is untouched by this change.** When a run carries `--review`, `--handoff`, `--conformance` or `--strict`, the program emits a `host-tail` step at the end of the waves: the Workflow script runs its existing inline review, remediation and handoff sections and resumes the program at final verification; the ACP driver exits `2` exactly as it does today. `emit-strict-tail-from-cli` removes that seam.

## Capabilities

### New Capabilities

- `ship/run-program`: the versioned step record the CLI emits for the lean loop, briefing files and their acknowledgement, the rule that a driver carries no policy or briefing text, batch recording as one CLI call, the published run-step cap, and the closing step that produces the summary both hosts print.

### Modified Capabilities

- `workflow-host`: the "Hosts share a spawn and CLI boundary" requirement now says a host obtains every step, including every briefing, from `interlock run`, and branches on nothing else.
- `ship/prompt-integrity`: the "Classifier tier policy SHALL be stated identically across hosts" requirement becomes "stated once, in the CLI's prompt module, and carried by no host driver".

## Impact

- **Code**: new `lib/prompts/{implementer,planner,verify,replan,commit,stage,schemas,index}.mjs`, `lib/run.mjs`, `lib/receipt.mjs`; `bin/interlock` (`run` dispatch and usage); `lib/limits.mjs` (`maxRunSteps`); `workflows/ship.js` (lean loop, final verify, commit and close replaced by the interpreter; inline strict tail kept behind `host-tail`); `bin/interlock-ship-acp` (interpreter; import allowlist unchanged).
- **Tests**: `test/spine/prompts.test.mjs` (new; fixtures under `test/fixtures/prompts/` unchanged), `test/spine/run.test.mjs` (new, end to end against a temp repo), `test/spine/implementer-prompt.test.mjs`, `test/spine/planner-prompt.test.mjs`, `test/spine/prompt-integrity.test.mjs`, `test/spine/plugin-agents.test.mjs`, `test/spine/ship-stage.test.mjs`, `test/spine/limits.test.mjs`, `test/spine/host.test.mjs`, `test/workflows.test.mjs`, `test/helpers/ship-harness.mjs` (pings that name an `interlock run` command execute it).
- **Docs and memory**: `README.md`, `CLAUDE.md` (Architecture), `docs/06`, `docs/10`, `docs/04`, `CHANGELOG.md`; `.claude/memory/` entries about the two-driver coupling are deleted or retargeted.
- **Dependencies**: none. No new library; nothing to pin.
- **Compatibility**: a lean run on either host produces the same banners, the same trajectory event types and the same receipt fields as today. `--strict` on the Workflow runtime behaves as today through the `host-tail` seam; the ACP driver keeps refusing it until the follow-on change.
