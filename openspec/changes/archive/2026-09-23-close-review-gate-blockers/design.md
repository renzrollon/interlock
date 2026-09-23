## Context

See proposal.md — Why. Two shared-value invariants, both already named in shipped prose and only half-enforced:

1. **Fold-mutation identity.** `ship/lane-merge` collides on canonical paths. `laneDiff` already parses rename `oldPath`; `applyLaneDiff` already deletes it; `runMergeLanes` drops it before `mergeDecision`. Canonicalization of `./` vs bare is tested; rename vs edit is not.
2. **Run-trajectory append fatality.** `lib/doctor.mjs` `STATE_DIRS` marks `.claude/ship/runs` `fatal: true`. `wave-state` and `verify judge` already `process.exit(1)` on `!logOk`. The live `interlock run` path in `lib/run.mjs` `ctx.warn`s and continues into ticks and close. Outcomes stay non-fatal.

`shared/INVARIANT-SWEEP.md` fires: both values are identities used in comparison / control flow. No graph is present (`.claude/graph/graph.json` absent); consumers below are from grep.

`mergeDecision` is pure and has one production caller (`runMergeLanes` in `bin/interlock`). The live run injects that function as `ctx.deps.runMergeLanes`. Expanding the path list at the plumbing boundary leaves the decision function a set-intersection; it does not need to learn git status letters.

## Goals / Non-Goals

**Goals:**

- One expansion of git `name-status` rows into the set of paths the fold will mutate; every contention reader consumes that set, then the existing `canonicalizePath` inside `mergeDecision`.
- One fatality rule for run-trajectory writes on the live path, matching `wave-state`: failed append → halt before tick/commit. Outcome and metrics writes stay warn-only.
- Process tests for the SessionStart hook; token pins for the two skill contracts. No skill reword unless a pin is actually missing.

**Non-Goals:**

- The rest of the 2026-09-14 warning list (review-code arithmetic, stage-pid, ACP timeout, CI SHA pins, briefing-path `..`, effort banner, and so on).
- Making outcomes or review metrics fatal.
- Teaching `mergeDecision` about `R`/`C` status letters, or changing `canonicalizePath`.
- Writing `verify-judgement` events from `lib/run.mjs` (the CLI `verify judge` path already appends them and already exits 1 on `!logOk`).
- New dependencies, new plugin agents, new CLI flags.

## Decisions

### D1 — Expand mutation paths at `runMergeLanes`; keep `mergeDecision` a path-set intersection

Export `foldMutationPaths(diffEntries)` from `lib/merge-lanes.mjs`:

- `A` / `M` / `D`: the destination `path`
- `R`: destination `path` **and** `oldPath` when it is a non-empty string distinct from `path`
- `C`: destination `path` only (copy does not delete the source; `applyLaneDiff` does not `rmSync` it)

`runMergeLanes` sets `changedByLane[label] = foldMutationPaths(diff)` instead of `diff.map(d => d.path)`. `mergeDecision` keeps canonicalizing that list. `applyLaneDiff` is unchanged.

*Alternatives rejected:* (1) Passing raw `{status, path, oldPath}` into `mergeDecision` — the decision module would grow git-status knowledge the caller already has, and every existing test that feeds string arrays would have to change shape. (2) Canonicalizing inside `foldMutationPaths` as well — two sites, the exact split `INVARIANT-SWEEP` forbids; `canonicalizePath` stays the single transform, inside `mergeDecision`, as today.

**Invariant sweep — fold-mutation identity** (normalize once: `foldMutationPaths` then `canonicalizePath` in `mergeDecision`):

| Reader | Form today | After |
|---|---|---|
| `runMergeLanes` `changedByLane` | `d.path` only | `foldMutationPaths(diff)` |
| `mergeDecision` contention set | canonical of whatever it is handed | unchanged logic; now handed mutation paths |
| `applyLaneDiff` | mutates `path`; deletes `oldPath` on `R` | unchanged |
| `mergeDecision` folds report `files` | raw git-reported list | still the expanded mutation list (destination + rename source). Acceptable: the report is "paths this lane contended with", not porcelain status |
| `lib/waves.mjs` predicted-path collision | `canonicalizePath` on `task.paths` | **out of this invariant** — predictions, not fold mutations. Do not touch |
| `observedChangedPaths` | porcelain parser, includes rename old path for audit | **out of this invariant** — shared-tree audit at record-batch, not lane fold |

A test that only feeds `mergeDecision` `['lib/b.mjs']` vs `['lib/a.mjs']` still reports clean — that is correct for the decision function. The failing repro is: `foldMutationPaths` of a rename includes the source, **and** `interlock merge-lanes` over two real worktrees (rename vs edit of the source) exits non-zero naming that source. The second test fails on `main` today.

### D2 — Live-path trajectory write failure is `haltStep`, not `ctx.warn`

Add a tiny helper next to `logCliExit` in `lib/run.mjs` (name as implementer prefers; behaviour is the contract): if a trajectory write did not land and a `runId` is active, return `haltStep('trajectory append failed: <site>: <reason>')` and do not tick, do not commit. Sites:

- `logWaveMutation` `ok === false` at run start, record-batch, record-verify, replan — halt **after** in-memory/disk wave-state was updated if that already happened, **before** `adjudicateBatches` ticks and before any commit spawn
- `appendRunLogEvent` returning `written: false` for `agent-spawn`, `cli-exit`, `run-start`, `run-receipt`, `run-halt`, `run-complete`

Leave `if (!outcome.written) ctx.warn(...)` exactly as it is.

`wave-state` / `verify judge` in `bin/interlock` already exit 1 on `!logOk`. Do not duplicate that logic; add a pin that those call sites still branch on `!logOk` so a future warn-only edit fails.

A live-path test injects `logWaveMutation: () => ({ step, ok: false })` on `record-batch` and asserts the returned step is `halt` with a reconstructability reason, that the tick helper was not invoked, and that `ctx.warn` was not the only reaction.

*Alternatives rejected:* (1) Exiting 1 from `appendRunLogEvent` itself — that would make outcome-adjacent tests and any non-run caller fatal, and the writer is shared. Fatality is a policy of the **site**, which is why doctor distinguishes corpora. (2) Waiting for `checkRunLog` at close — close can notice only after ticks and a commit, which is the defect. (3) Making `STATE_DIRS` spill/outcomes consistent — CLAUDE.md forbids "make it consistent."

**Invariant sweep — trajectory append fatality:**

| Writer | Corpus | Today | After |
|---|---|---|---|
| `bin/interlock` `logWaveMutation` via `wave-state` | runs | exit 1 on `!logOk` | unchanged; pin |
| `bin/interlock` `logVerifyJudgement` via `verify judge` | runs | exit 1 on `!logOk` | unchanged; pin |
| `lib/run.mjs` `logWaveMutation` (start / record-batch / record-verify / replan) | runs | `ctx.warn` | halt |
| `lib/run.mjs` `agent-spawn` / `cli-exit` / `run-start` / receipt / terminal | runs | `ctx.warn` | halt |
| `lib/run.mjs` outcome append | learning | `ctx.warn` | **unchanged warn** |
| `lib/doctor.mjs` `STATE_DIRS` `.claude/ship/runs` | — | `fatal: true` | unchanged; already true |
| `checkRunLog` at close | runs | completeness after the fact | still runs; not the only gate |

### D3 — Spawn the SessionStart hook the way `test/hooks.test.mjs` already spawns PreToolUse guards

Extend `test/hooks.test.mjs` (same `spawnSync('node', [hook])` helper; SessionStart has empty or host-shaped stdin). Stub `interlock doctor --json` by putting a fake `bin/interlock` on `PATH` ahead of the bundled binary **or** by exercising the bundled doctor against a temp root:

- Clean temp root that fails some doctor checks is easy (`diagnose` on an empty tmp dir is already `ok: false` in `doctor.test.mjs`). Prefer spawning `hooks/preflight.mjs` with `cwd` at a temp root and `PATH` such that `bin/interlock` is the real bundled binary — doctor-fail is then real, exit must still be 0, stdout JSON carries `additionalContext` with `[FAIL]`.
- ENOENT: `PATH` without `interlock` and a hook copy whose sibling `bin/interlock` does not exist (run the hook from a copied tree, or monkey the lookup by spawning with `cwd` and env). If the bundled binary is always found via `PLUGIN_ROOT = dirname(dirname(import.meta.url))`, ENOENT cannot be triggered without a fixture copy of the hook file. **Copy is allowed in the test tmp dir** — spawn that copy so `PLUGIN_ROOT` has no `bin/interlock`.
- Own-crash: the production `try { run() } catch` already exists. Triggering it without editing production to `throw` on a test flag would require a broken `import`. Skip injecting a throw if it needs a production test hook; cover ENOENT + doctor-fail + clean, and pin `process.exit(0)` is the last statement. Spec edge includes internal throw — if a fixture cannot reach the catch without a seam, document that in the test comment and pin the `catch` + `process.exit(0)` tokens in the hook file (tokens, not sentences).

Pin `.claude-plugin/plugin.json` `hooks.SessionStart[0].hooks[0].command` contains `hooks/preflight.mjs`.

Do not change fail-open behaviour.

### D4 — Skill pins are tokens in `test/skills.test.mjs`; do not reword the skills unless a token is absent

Today both files already contain the tokens. The tasks still add the asserts (that is the defect: the suite would stay green if they were deleted). Distinctive tokens only:

- Report: `interlock report --json`, `Never recompute`, `Licenses nothing`
- Continuity: `interlock ready`, `--findings`, and `/compose a file containing a blocker count|blocker count/` as the forbidden transcription (assert the procedure still says not to compose that file)

No new library. No numeric thresholds in the new test prose.

## Risks / Trade-offs

- **[Risk] Isolate-waves runs that today last-writer-wins a rename vs an edit will start halting.** → Mitigation: that halt is the existing collision policy; the halt report names path and lanes. Not silent. Default isolate-waves is still opt-in.
- **[Risk] A flaky disk full during record-batch will now halt a run that previously ticked green.** → Mitigation: that green tick was the bug. Close still runs (`haltStep.then` is `run close --halt`), so receipt and outcome still land if those writes work.
- **[Risk] Halt-after-writeState leaves wave-state advanced without a trajectory line.** → Mitigation: close's reconstructability check already fails a gap; the halt reason names the append failure. Do not roll back wave-state (no undo API; a partial record plus a named halt is reconstructable enough).
- **[Risk] `foldMutationPaths` reported `files` now include rename sources, which `formatMergeLanes` may print.** → Mitigation: printing the source as a path the lane mutated is accurate. Do not special-case display.
- **[Risk] SessionStart ENOENT fixture is awkward because `PLUGIN_ROOT` is derived from the hook's own URL.** → Mitigation: D3 copy-the-hook fixture; do not add a test-only env override to production.

## Migration Plan

Land on `main` as one change. No flag, no dual-run. Consumer repos get: (1) isolate-waves rename collisions halt instead of folding; (2) an unwritable `.claude/ship/runs` during a live `interlock run` step halts that step. Doctor already called that directory fatal. Rollback is revert; no data migration.

## Open Questions

None. Copy-vs-rename is specified (copy source is not a mutation). Outcome non-fatality is specified. Warning-list leftovers are a later change.
