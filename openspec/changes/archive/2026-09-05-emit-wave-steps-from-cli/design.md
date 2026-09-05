## Context

See proposal.md — Why. The constraints that shape the how:

- **The Workflow script has no filesystem and no shell** (`test/workflows.test.mjs:47-65`, `docs/06-why-it-works.md:42`). Every CLI call it makes is a `interlock:ping` agent that runs the command and copies stdout into a result field (`workflows/ship.js:767-778`, `:1007-1040`). It cannot read a briefing file itself; only the agent it spawns can.
- **Every text-bearing result field is capped** (`openspec/specs/ship/cap-authority/spec.md:80`, `LIMITS.verifyPreviewChars`). A briefing is several kilobytes; asking a haiku ping to copy it verbatim into a result would either breach the cap or invite truncation.
- **The ACP driver is ordinary Node but may import only `node:*` and `lib/host*`** (`.claude/memory/coupling/acp-driver-import-allowlist.md`, `test/workflows.test.mjs`). It shares code with `ship.js` today by evaluating marked blocks of the script's source (`bin/interlock-ship-acp:235-300`).
- **The state machine is pure and already emits the wave-level step** (`lib/waves.mjs:1808-1880`, `nextStep`); `wave-state record-batch --write-state` returns the next step in the same call (`bin/interlock:726-800`). The planner already derives label, model and effort per lane (`lib/waves.mjs`, `laneEffort`; `openspec/specs/effort-routing/spec.md`).
- **The stage marker shape is duplicated in `ship.js` as a literal** and drift-tested against `lib/ship-stage.mjs` (`workflows/ship.js:704-737`, `lib/ship-stage.mjs:37-42`). The prompt fragment that asks an agent to publish it is host-agnostic text.
- **Prompts are pinned byte for byte** (`openspec/specs/implementer-prompts/spec.md`, ten fixtures under `test/fixtures/prompts/`) and checked for coercion artifacts against assembled output (`openspec/specs/ship/prompt-integrity/spec.md`). Moving assembly must keep the fixtures unchanged and keep every assembled prompt reachable by the integrity check.
- **`MAX_LOOP_STEPS = 200` is a literal in both drivers** (`workflows/ship.js`, `bin/interlock-ship-acp:44`), which `openspec/specs/ship/cap-authority/spec.md:9` forbids for a loop bound.
- **The trajectory records every spawn the workflow requested** (`openspec/specs/ship-run/spec.md:23-27`); today `wave-state next` logs implementer spawns and the drivers log pings and other agents themselves.

No new library. Nothing to pin.

## Goals / Non-Goals

**Goals:**

- One statement of every briefing and every loop decision, in `lib/`, read by the CLI, obeyed by two interpreters that cannot drift because they hold nothing that could.
- Byte-identical implementer prompts and unchanged banners, trajectory event types and receipt fields on a lean run.
- A driver-side loop small enough to read in one screen, on both hosts.
- The Workflow host keeps its properties: native schema enforcement, per-agent model, worktree isolation, no mid-run input.

**Non-Goals:**

- The strict tail (review, remediation, handoff, conformance). It stays inline in `ship.js` behind the `host-tail` seam and moves in `emit-strict-tail-from-cli`.
- New hosts or adapters (`promote-interlock-run-with-host-adapters`).
- Cross-session resume of a run. The manifest this change writes is the seed for it, not the feature.
- Changing what any prompt says. This change moves text; it does not reword it.

## Decisions

### D1 — A `run` family wraps the pure state machine; `wave-state` is untouched

`interlock run` is a new dispatch case backed by `lib/run.mjs`. It calls the same functions `wave-state`, `waves`, `plan`, `verify`, `merge-lanes`, `tasks` and `run-log` already expose, and adds only what no existing command does: assembling briefings, writing them, and packaging a step. `wave-state` stays pure, stays tested, and stays the thing `run` obeys.

*Alternative rejected:* extending `wave-state next` to emit briefings. `wave-state` is a pure function of the state file and is replayed on resume (`lib/waves.mjs:36-53`); briefing assembly reads the change's artifacts and writes files, which does not belong in a pure transition.

### D2 — Briefings are files with their hash on line one; the Workflow host delivers by reference and fails closed on a missing acknowledgement

`lib/run.mjs` writes each briefing to `.claude/ship/briefings/<label>.md` whose first line is `<!-- interlock briefing v1 label=<label> sha256=<hex> -->`, followed by the assembled text. Each spawn in a step carries `promptPath`, `promptSha256` and `prompt`.

- The ACP driver (ordinary Node) reads `prompt` from the step and sends it inline. Nothing changes for the agent.
- The Workflow script cannot hold a briefing without a ping copying it, so it spawns the worker with a fixed bootstrap: *your briefing is `<path>`; read it in full before doing anything else and follow it as the whole of your instructions; report the sha256 on its first line as `briefing` in your result.* The spawn's schema is the step's schema with `briefing` added as a required string. A result whose `briefing` is absent or differs from `promptSha256` is treated as a null result — the task fails closed with reason `briefing not acknowledged`, exactly as a missing handoff packet fails a task closed today (`openspec/specs/waves/spec.md`, oversized or missing packets).

The bootstrap text is a host-side constant pinned by a fixture (`test/fixtures/prompts/bootstrap.txt`). It is plumbing, not policy: it names a file and a field and says nothing about the work.

*Alternative rejected:* the ping copies the briefing into `cliStdout`. It breaches the result-field cap the cap-authority spec pins, and a relay miss on a 4 KB string is silent under-instruction, the failure prompt-integrity exists to catch.

### D3 — A step is a versioned record that names its own continuation

Schema `interlock.run-step/1`:

```
{ schema, action, then: { argv: ['run', '<subcommand>', ...flags] } | null,
  spawns: [{ label, kind, model, effort, type, tools, schema, promptPath, promptSha256, prompt,
             isolation: 'worktree' | null, worktree: { path } | null }],
  mergeBase, ...the wave-state fields the action already carries (wave, batchIndex, remainingBatches, previousHandoffs, changed, mode, reason) }
```

`action` is one of the six wave-state actions plus `classify`, `verify-final`, `commit`, `host-tail`, `close` and `complete`. `then.argv` is the exact `interlock` argv the driver calls after the spawns return; the driver appends `--results <file>` where `<file>` holds the spawn results in spawn order. A terminal step (`complete`, or `halt` after `close`) has `then: null`.

The interpreter on either host is therefore: *spawn everything in `spawns` in parallel; write the results; call `then.argv`; repeat until `then` is null.* A driver never branches on a flag, a mode, a count or a verdict. Every branch the loop has today (apply-only, no-commit, skip-e2e, isolate-waves, replan allowed, verify skipped, done) is taken inside `lib/run.mjs` from the manifest (D4) and the state.

*Why `then.argv` rather than an action table in the driver:* an action table is loop knowledge, and loop knowledge in two files is the drift this change removes.

### D4 — The invocation becomes a run manifest the CLI reads on every call

`run start` writes `.claude/ship/run.json` (`interlock.run/1`): change, the parsed flags (`applyOnly`, `noCommit`, `skipE2e`, `skipCoverage`, `isolateWaves`, `laneMode`, `maxParallel`, `mode`, `review`, `handoff`, `conformance`, `strict`), `host`, `startedAt`, and a `steps` counter. Every later `run` subcommand reads it. The drivers keep their own invocation parsing (`parseInvocation` in `ship.js`, `parseArgv` in the ACP driver) because argument delivery is host-specific; they pass the parsed flags to `run start` once and never consult them again.

### D5 — `run record-batch` folds the merge, the record and the tick into one call

Given the batch's results: (1) when the manifest says `isolateWaves`, fold the lanes whose every task reported `ok` with `lib/merge-lanes.mjs` against the `mergeBase` the step captured (the CLI runs `git rev-parse HEAD` itself when it emits a `run-batch` step under isolation — no ping); (2) adjudicate the results with the logic now in `ship.js`'s `RECORDED_VERDICT` block, moved to `lib/run.mjs`; (3) `wave-state record-batch --write-state`; (4) `tasks tick` for the recorded-ok ids; (5) surface `LANE STOPPED EARLY`, `TASK TICK FAILED` and the claim-derived / override banners on the step; (6) return the next step. A lane with any failed task is neither folded nor ticked and its worktree is named, per `openspec/specs/ship/lane-merge/spec.md`.

### D6 — Where the truth of the tail lives during this change: the `host-tail` seam

When the manifest carries any tail flag and the wave state reaches `done`, `run next` emits `{ action: 'host-tail', flags, then: { argv: ['run', 'verify-final'] } }`. The Workflow script runs its existing sections 4–5 (review, remediation) and, after final verification, section 7 (handoff), which stay inline and unchanged; it then continues the program. The ACP driver treats `host-tail` as unsupported and exits `2` with today's message. This is the one place a driver still holds loop text, it is named as a seam in the code and in the tests, and `emit-strict-tail-from-cli` deletes it.

### D7 — The planner never runs the CLI; the CLI does the mechanical work after it

The two drivers' planner prompts differ today: the ACP form tells the model to write `classified.json` and report, and the driver runs coverage, waves and state creation itself (`bin/interlock-ship-acp:597-651`); the Workflow form asks the same agent to run those commands. `lib/prompts/planner.mjs` adopts the ACP form for both hosts, and `run classified --classified <file>` does coverage → waves → `wave-state create` → `run-start` event → first step. On the Workflow host that is one ping instead of a frontier agent running four commands.

### D8 — The stage marker's shape leaves `ship.js`

`lib/prompts/stage.mjs` renders the "publish the ship stage" fragment from `lib/ship-stage.mjs`'s own constants and `lib/run.mjs` includes it in the briefings for `implement`, `fix-tests` and `commit` stages (and, in the follow-on, `review` and `remediation`). The duplicated literal and its drift test are removed; the marker's `pid` semantics (the agent's own process) are unchanged because the agent still writes it.

### D9 — `maxRunSteps` is a cap, enforced by the CLI

`LIMITS.maxRunSteps = 200` replaces both drivers' literal. `run` increments the manifest's `steps` on every call and emits `halt` with reason naming the cap once exceeded. Each driver keeps a runaway backstop at the runtime's own agent ceiling (1000, the Workflow runtime's per-run limit), named `RUNAWAY_BACKSTOP` with a comment that it is not a policy cap; the cap-authority reader test lists `lib/run.mjs` as `maxRunSteps`'s reader.

### D10 — `run close` builds the receipt and the summary text; drivers print

The `BUILD_RECEIPT` block moves to `lib/receipt.mjs`. `run close --results <file> [--halt <reason>] [--host-banners <file>]` appends the outcome, records `run-halt` or `run-complete`, runs the reconstructability check, and returns `{ action: 'complete' | 'halt', exitCode, summary, banners }` where `summary` is the human text both drivers print verbatim. Host-only banners (a routing banner, a transport note) are handed in through `--host-banners` so the "no degradation banners" line stays truthful. The `GOAL MET: interlock ship` line is printed by the Workflow script alone, since `/goal` is a Claude Code convention.

### D11 — What each driver still owns

Workflow script: `parseInvocation`, the ping plumbing (`type: interlock:ping`, its tools and model, the copy-stdout instruction), the bootstrap wrapper and the briefing acknowledgement check, `RUNAWAY_BACKSTOP`, the `host-tail` sections (until the follow-on), the `GOAL MET` line. ACP driver: `parseArgv`, `--host`-less ACP transport, `RUNAWAY_BACKSTOP`, the exit-2 refusal of `host-tail`. Everything else is a step.

## Risks / Trade-offs

- **[A worker does not read its briefing]** → The acknowledgement hash is required; a missing or wrong hash is a failed task with a named reason, recorded like any failure, never a silent under-instructed run.
- **[A ping mis-copies a step]** → Unchanged from today: `cliStdout` is parsed first, one `next-retry` re-read, then halt. Steps are the same size class as today's `wave-state next` output plus per-spawn metadata; briefing text is not in `cliStdout`, only its path and hash.
- **[The ship harness loses its prompt captures]** → `test/helpers/ship-harness.mjs` gains a mode in which a ping whose prompt names an `interlock run` command executes it against a temp repo and returns real stdout; briefing files are captured by label. Prompt tests import `lib/prompts` directly and no longer need the harness.
- **[Isolation on the Workflow host]** → Unchanged mechanism (`isolation: 'worktree'` on the spawn); the CLI derives the lane's worktree path with the same function `ship.js` used, so the fold finds the same directory.
- **[Two drivers, briefly three shapes of tail]** → The `host-tail` seam is explicit, tested (the ACP driver exits `2`; the Workflow script's inline sections are asserted present until the follow-on removes them) and short-lived.

## Migration Plan

Land as one change. A run started under the old `state.json` format is not resumable across the change — there is no cross-session resume today, so nothing is lost. Fixtures under `test/fixtures/prompts/` are unchanged; the memory entries that describe the two-driver coupling are deleted or retargeted in the same change so they do not send a future agent to code that no longer exists.

## Open Questions

None that change the specs or the task breakdown. Whether the Workflow runtime exposes a per-agent token count that `run close` could record is deferrable (today the receipt records `unknown`, per `openspec/specs/ship-run/spec.md:261`).
