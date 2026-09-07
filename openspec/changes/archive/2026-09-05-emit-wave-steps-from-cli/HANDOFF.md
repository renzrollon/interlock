# Handoff — emit-wave-steps-from-cli

**Progress: 16 of 22 tasks complete.** Sections 1 and 2 are done and green.
Section 3 is done in the code (3.1–3.3) and part-done in the tests (3.4–3.5).
Sections 4 and 5 are untouched.

**Suite: 1547 pass, 26 fail.** Every failure is in `test/workflows.test.mjs` and
every one is a test still pinning a property at its OLD home. There is no known
production defect outstanding — see "What is actually broken" below.

Run `npm test` to reproduce; `node --test test/workflows.test.mjs` for just the
failures.

---

## What landed

### The run program (new)

- **`lib/run.mjs`** — the whole lean loop. Manifest (`.claude/ship/run.json`),
  step builder (`interlock.run-step/1`), briefing writer, step budget,
  `decorate()`, and the seven subcommands: `runStart`, `runClassified`,
  `runRecordBatch`, `runJudge`, `runVerifyFinal`, `runReplan`, `runNext`,
  `runClose`. Adjudication (`laneOutcomes`, `adjudicateBatches`,
  `recordedOutcomes`, the banners) moved here from `ship.js`'s
  `RECORDED_VERDICT` block.
- **`lib/receipt.mjs`** — `buildReceipt` (moved from `BUILD_RECEIPT`),
  `closingFromWaveState`, `capExhaustedSkipReason`, `degradationLines`,
  `formatRunSummary`.
- **`lib/prompts/`** — `implementer`, `planner`, `verify`, `replan`, `commit`,
  `stage`, `schemas`, `index` (the `PROMPTS` registry).
- **`bin/interlock`** — the `run` dispatch case, usage text, the sequence guard,
  and a `haltStep` for an unresolvable change name.
- **`lib/limits.mjs`** — `LIMITS.maxRunSteps: 200`, its `formatLimits` row.
- **`lib/waves.mjs`** — `laneLabel` exported (one derivation, three former
  copies).

### The drivers

- **`workflows/ship.js`**: 2718 → 854 lines. A four-line interpreter plus host
  plumbing, the environment probe, and the `HOST_TAIL_SEAM` (review,
  remediation, handoff, autonomy record) behind `step.action === 'host-tail'`.
- **`bin/interlock-ship-acp`**: 1026 → 298 lines. Same interpreter over
  `host.spawn`/`host.mapPipeline`/`host.runCli`; `host-tail` → exit 2. All four
  `new Function` source evaluators are gone.

### Tests

New: `test/spine/run.test.mjs` (18 tests, end to end against a real temp repo
with real git), `test/spine/prompts.test.mjs` (16).
Rewritten: `test/helpers/ship-harness.mjs` (drives ship.js against a REAL
`interlock` in a temp repo — a relay ping's command is actually executed),
`test/spine/planner-prompt.test.mjs`, `test/spine/ship-stage-drift.test.mjs`,
`test/spine/prompt-integrity.test.mjs`, and ~40 tests in
`test/workflows.test.mjs`.

---

## Decisions taken beyond the written plan

Four things the design did not specify, decided while implementing. Each is a
place a reviewer should check the judgement, not just the code.

1. **`--host-observed` replaces the design's implied `--host-spend`.** Token
   spend is measured from the Workflow runtime's own counter, which no other
   process can read; the design's Open Questions called recording it
   "deferrable", but `test/workflows.test.mjs` pins it and dropping it would
   have been a silent regression. The strict tail's review/remediation/handoff
   figures ride the same channel for the same reason — the tail still runs on
   the host (D6). When `emit-strict-tail-from-cli` moves the tail, this channel
   narrows back to spend alone. Verified working: a run with a budget records
   `spend: [{wave:"1",outputTokens:100}]`, `outputTokens: 200`.

2. **`run close` is exempt from the sequence guard.** A driver that hit its own
   error closes from wherever it is; refusing would leave the run with no
   receipt, no outcome record and no terminal event. A run nobody can
   reconstruct is the failure the trajectory exists to prevent; a mis-sequenced
   close is not.

3. **The autonomy record moved from the commit briefing into the host tail.**
   It rode on the commit prompt under `--strict`, which put a strict-tail
   measurement on a step the lean loop also runs. It is now beside the review it
   describes and leaves with the tail.

4. **The `host-tail` step carries `stageLines`.** The tail's inline sections
   publish `review` and `remediation` stage markers. Rendering them in the CLI
   (from `lib/ship-stage.mjs`) means even the sections a driver still runs carry
   no marker literal — so `test/spine/ship-stage-drift.test.mjs` could assert
   the duplication is gone rather than that the two copies agree.

## Bugs found and fixed while implementing

Four real defects, all introduced-and-caught within this change except the last,
which is a genuine gap the old design had:

- Host banners and token spend reached the close **only on a halt** — a clean
  run silently dropped them. Both drivers now append the close flags whenever
  the continuation is a close.
- `const` declarations after `ship.js`'s terminal `return` sit in the temporal
  dead zone forever. `worker` and `noteStageMarker` are hoisted function
  declarations; `SKEPTIC_EFFORT` moved above the return.
- A multi-word `--halt` reason was truncated to its first word, because the
  relay builds a command LINE from an argv array. `cli()` now shell-quotes, and
  the harness's relay parses quotes.
- **A verifier that reported nothing passed the completion gate.**
  `judgeVerification` scores what it is given, so an empty or partial report
  came back clean. `runJudge` now halts on any planned step with no reported
  result: "not verified" is not a pass. This closed a hole the old
  agent-declared `unitGreen` field had been covering.

---

## What is left

### 3.4 / 3.5 — the remaining 26 test failures

All in `test/workflows.test.mjs`. Grouped by root cause:

1. **Receipt shape read post-normalization (≈6 tests).** The receipt used to be
   parsed out of a prompt; it is now read off the trajectory, where
   `lib/run-log.mjs`'s whitelist has already normalized it — `wave: 1` becomes
   `"1"`, `notAttempted: []` becomes a count. Update the expectations to the
   STORED shape. Affected: "the receipt carries the tallies…", "a halted run
   records a receipt naming the halt…", "the corpus line derives its observed
   half…", "--no-commit and --apply-only record…", "a run that never
   reviewed…", "a run of three waves…".

2. **Token-spend tests (≈5).** They call `receiptFrom(prompts)` and stub a
   budget. Retarget to `receiptFrom(root)` with `keepRepo: true` — the channel
   itself is verified working (see decision 1).

3. **ACP-driver tests pinning removed blocks (≈6).** "the ACP driver receipt
   builder loads…", "…writes the same receipt from ship.js own builder", "…ticks
   and tallies from ship.js own block", "…declares its lack of token
   accounting", "…asks the CLI what is unchecked", "an ACP-produced receipt
   reads as a host that could not measure". Each should become the structural
   assertion that the driver carries none of it, and the property should be
   pinned at `lib/receipt.mjs` / `lib/run.mjs`.

4. **Path-set tests (≈4).** `readPathSets` in `lib/run.mjs` reads both sets at
   close. The tests still assert on a closing prompt. Retarget to the receipt.

5. **Two stragglers.** "the receipt payload survives assembly with no coercion
   artifacts" and "the receipt prompt asks for verbatim transport" — there is no
   receipt prompt any more; the property (nothing invites correction) is already
   covered structurally by "no agent is in the corpus line's path at all". Delete
   or fold in.

Still to ADD for 3.4 (none written yet):

- The **no-policy sweep** over both drivers with the published token list (tier
  definitions, `dependsOn` rules, `interlock.wave-handoff/1`,
  `remediationRounds`, `laneModel`, `laneEffort`, `assembleImplementerPrompt`,
  verify skip reasons, merge rules) with a named allowance for the
  `HOST_TAIL_SEAM` region. Several narrow versions of this exist; the general
  sweep does not.
- **`test/fixtures/prompts/bootstrap.txt`** and a pin of `BOOTSTRAP` against it.
- Assert the Workflow script calls no `run` subcommand other than `run start` by
  literal (every other call comes from `then.argv`).
- Assert `RUNAWAY_BACKSTOP !== maxRunSteps` and is not it plus a constant.

Still to do for 3.5:

- `test/spine/host.test.mjs` — add an interpreter-through-fake-host run from
  `run start` to `close` with canned spawn results.

### 4.1 — docs (untouched)

`docs/06-why-it-works.md` (§2 table, §5.4, §14 portability),
`docs/10-agentic-workflow-ship-and-spec.md` (§4, §5),
`docs/04-when-it-stops.md` (note `host-tail` is internal), `README.md`,
`CLAUDE.md` Architecture (`lib/prompts/`, `lib/run.mjs`, "the drivers are
interpreters"), `CHANGELOG.md`.

Note for `CLAUDE.md`: the "Guards fail open" and "corpus-loss semantics" entries
are unchanged and still true. The Architecture bullet for `workflows/ship.js`
("the ship orchestrator") is now wrong — it is an interpreter.

### 4.2 — memory (untouched)

Delete `.claude/memory/coupling/classifier-policy-lives-in-two-drivers.md`.
Rewrite `coupling/ship-projection-gates-record-batch-fields.md` and
`coupling/ship-control-plane-signatures-pinned-in-two-tests.md` to name
`lib/run.mjs` and `test/spine/run.test.mjs`. Keep
`coupling/acp-driver-import-allowlist.md` (still true) and
`coupling/ship-prompt-text-vs-workflows-test.md`. Update `MEMORY.md`.

Worth adding: `ship-runtime-globals-need-a-harness-parameter.md` is still true,
and the temporal-dead-zone rule (anything below `ship.js`'s terminal `return`
must be a hoisted function declaration) is a new recurring failure mode.

### 5.1 / 5.2 — validate

`openspec validate emit-wave-steps-from-cli --strict`, `interlock validate`,
`interlock ledger`, then `npm test` and `npm run validate` green with the
implementer fixtures unmodified. **The fixtures are currently unmodified** —
`git status` shows nothing under `test/fixtures/prompts/`, and all 39 tests in
`test/spine/implementer-prompt.test.mjs` pass.

---

## Things to know before continuing

- **`ASSEMBLE_IMPLEMENTER_PROMPT` still sits in `workflows/ship.js`?** No — it
  is gone, along with `LANE_DISPATCH`, `LANE_EFFORT`, `RECORDED_VERDICT`,
  `STEP_SHAPE`, `BUILD_RECEIPT`, `MAX_LOOP_STEPS`, `NEXT_ACTIONS`,
  `publishStageLine`, `captureMergeBase` and `runMergeLanesStep`.
- **The harness runs the real CLI.** `runShip()` builds a temp git repo, writes
  a classification, and executes every `interlock run …` a relay names. Pass
  `keepRepo: true` and read `root` to inspect what a run left behind
  (`receiptFrom(root)`, `outcomeFrom(root)`, `trajectory(root)`), then
  `rmSync` it. `repo: { profile, tasks, broken, readOnlyTasks, reuseRoot }`
  shapes the fixture.
- **Two lanes need tier 4.** `LANE_CAPS.cohesionMaxTier` is 3, so tier ≤3 tasks
  with disjoint paths get folded into ONE cohesion lane. An isolation fixture
  wanting two lanes must use tier 4.
- **`npm test` is `node --test` over a `find`-piped list.** A module-level throw
  in a test file aborts the rest of that file silently — `ℹ tests` drops without
  a visible error. If the count moves, look for one.
