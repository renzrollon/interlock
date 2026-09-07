## Context

See proposal.md — Why. What follows is only the state that constrains the approach.

- **The loop has two hosts.** `workflows/ship.js` runs inside the Claude Code workflow runtime and needs the Workflow tool, which nothing can drive headlessly. `bin/interlock-ship-acp` runs the same loop from an ordinary shell: it takes every decision from `bin/interlock`'s exit codes and stdout, and differs only in where its agents come from. It already refuses `--strict` and already prints `MODEL ROUTING UNAVAILABLE` because ACP has no per-prompt model selector.
- **The graders already exist.** `interlock validate` reports the tick state of every task, `verify unit` judges a unit result including the weakened-suite check, `run-log check` decides reconstructability, and the `run-receipt` event carries tallies, spend, remediation rounds and leftover task ids. Nothing needs a new judgement.
- **The receipt cannot measure spend on this host.** `bin/interlock-ship-acp` writes `outputTokens: null` per wave and for the run, deliberately and in writing: it has no token accounting and refuses to estimate one. `openspec/specs/ship-run/spec.md` already requires absent-not-zero for such a host.
- **Zero runtime dependencies.** `package.json` has no `dependencies` key and CI installs nothing. Anything this change runs must be stdlib Node on Node >= 18.
- **The corpora were purged once already**, on 2026-08-29, after test runs polluted them. Any design that lets a fixture run write into `.claude/` under this repository repeats that.
- **Numeric thresholds live in `lib/limits.mjs` or a CLI decision.** Not in a skill, a README, a workflow file, or a spec.

## Goals / Non-Goals

**Goals:**

- Grade an *outcome* — files, ticks, a commit, a green suite — rather than a transcript, for the first time in this repository.
- Introduce no new judgement: every criterion is an exit code the CLI already produces.
- Produce a control arm, so the comparison docs/06 §14 records as missing exists.
- Produce a committed time series, so "did this release get slower or worse while staying green" is answerable from the repository.
- Keep every fixture run outside this repository's corpora, structurally rather than by convention.

**Non-Goals:**

- Measuring the full product. This eval runs on the ACP host, so per-tier model routing and the Claude Code launch behaviour are not under test, and the eval says so in its own README.
- Measuring the `--strict` tail. The ACP host refuses it, and the default is the thing that has never been measured.
- Any gate, promotion rule, or threshold on an eval result. Nothing reads a result except a human and the report.
- A general-purpose agent. The eval's ACP agent exists to make the fixture runs happen; it is apparatus, not product.
- Replacing the transcript-grading suite under `evals/<case>/`. That suite answers a different question and is untouched.

## Decisions

### D1 — Run over the ACP host, and say what that costs

The loop arm runs `interlock-ship-acp <change> --root <scratch>`. *Alternative considered:* driving `workflows/ship.js`. Rejected because it needs the Workflow tool and cannot be driven from a shell — the review's own constraint, adopted rather than rediscovered. *Consequence, stated in the eval's README and carried on every result row:* tier model routing is not in effect and the interactive runtime's trampoline behaviour is not exercised. What *is* exercised is the CLI-governed loop, the planner's classification, the implementer briefing (which the ACP host reads out of `workflows/ship.js` rather than copying), the wave state machine, verification, the receipt and the trajectory.

### D2 — The model reaches the loop through a stdlib-only ACP agent committed with the eval

The eval ships its own ACP agent under `evals/ship/agent/`, speaking the same JSON-RPC-over-stdio subset `test/fixtures/acp/agent.mjs` already proves (`initialize`, `session/new`, `session/prompt`, `session/update`), and running a tool-use loop against the model API over global `fetch` with a small tool set — read a file, write a file, run a command in the scratch root.

*Alternatives considered.* (a) An external ACP-speaking agent CLI supplied through `INTERLOCK_ACP_COMMAND`. Rejected as the default: it is an unpinned dependency the repository cannot test, cannot install in a zero-dependency CI job, and cannot version-key a result against. It stays supported as an override, because the host already reads that variable. (b) `claude -p` per step. Rejected: it is not an ACP agent, so the host cannot drive it, and it would reintroduce an early-access surface this eval does not need.

*Why this is not a new dependency:* `fetch` is global on Node >= 18, stdio JSON-RPC is `node:process`, and command execution is `node:child_process`. Nothing is installed.

*Why this is honest:* the agent is part of the measuring apparatus, not part of the product. Both arms use the same agent, so the harness is the only variable between them. Its identity is recorded on every row (D8) so a change to it cannot silently confound a version comparison — which is the same lesson the *Don't Blame the LLM* result teaches, applied to our own instrument.

### D3 — Isolation is structural: a scratch root outside the repository, and a refusal

Every run copies a fixture into a fresh directory under the system temporary directory and passes that as `--root`. All run state — `.claude/ship/`, `.claude/learning/`, work files, the git repository the commit lands in — lives there and is never copied back. The runner **refuses** a root that resolves inside this repository rather than trusting itself to pass the right one, and `npm test` asserts that no committed fixture directory holds run state.

One thing that looks wrong and is not: `.gitignore` lists `.claude/testing/`, `.claude/ship/` and `.claude/learning/`. Those patterns contain an interior slash and are therefore anchored at the repository root, so a fixture's own `evals/ship/fixtures/<n>/.claude/testing/profile.json` **is** tracked. Verified with `git check-ignore` before writing this. A task pins it, because the next contributor will assume otherwise.

The only thing that travels from a run back into the repository is one line per fixture per arm in the history file (D7), which lives at a different path under a different schema and can therefore never be read as a record of a real run.

### D4 — The graders, and which of them the control arm cannot have

Loop arm criteria, each an invocation against the scratch root:

| Criterion | Decided by |
|---|---|
| ticks match what the state machine recorded | `interlock validate --json` tick state vs. the run's recorded outcomes |
| a commit exists (or was deliberately not asked for) | the scratch repository's log, and the receipt's commit field |
| unit suite green, no weakened test | `interlock verify unit` against a result built from the fixture's unit command, with the fixture's committed baseline |
| trajectory reconstructable | `interlock run-log check` |
| receipt present and observed | `interlock run-log show` — tallies, spend, remediation rounds, leftover ids present as observed values |

The control arm has no planner, no state machine and no trajectory, so the last two criteria and the tick criterion **do not apply to it**. They are recorded as not-applicable, never as failures — recording an inapplicable criterion as a failure would manufacture the exact result the eval exists to test for. The arm-to-arm difference is therefore reported over the criteria both arms can be graded on (suite green, weakened test, commit present, and the fixture's own reference suite standing in for the tick criterion) plus every measure. This asymmetry is a property of the comparison and is stated in the output rather than hidden in an average.

### D5 — The control arm is the same agent with the loop removed

Control: the same ACP agent, the same model, the same fixture starting state, prompted once per task in `tasks.md` order with the task text and nothing else, then the fixture's unit command, then a commit. No planner, no waves, no `interlock` in the loop. *Alternative considered:* a different model or a different agent for the control. Rejected — it would vary two things at once and answer nothing.

### D6 — The cost ceiling is a published cap with a reader on day one

`EVAL_CAPS.shipEvalCostUsd` is added to `lib/limits.mjs` and printed by `interlock limits`. Both the runner and the scheduled job read it from `interlock limits --json`; the number appears nowhere else.

Converting measured token usage to dollars needs prices, and a price is a number. It goes beside the cap in `lib/limits.mjs`, and the price table's own identifier is recorded on every result row so a later price revision cannot silently reinterpret old rows. *Alternative considered:* a token ceiling, which needs no prices — rejected because a token ceiling is not comparable across models and the operator's real constraint is money.

The ceiling stops the runner from **starting** the next fixture or arm; it does not kill a run in flight, because a half-killed run cannot be graded and would be recorded as a failure it did not earn. A ceiling reached mid-sweep makes the sweep partial, named as such.

This cap has a reader from the moment it is added, which is what `EVAL_CAPS.runsPerCase` and `EVAL_CAPS.reportingThreshold` do not. This change neither fixes nor depends on that; it just declines to add a third.

### D7 — The history file is fatal-on-write-failure to the eval run, and to nothing else

`evals/history/ship-outcomes.jsonl`, append-only, one bounded JSON object per line, schema `interlock.ship-outcome-eval/1`, fields copied by name.

The repository's corpus-loss classes differ deliberately: the outcome corpus and review metrics report their own write failures and never touch an exit code, because losing a bookkeeping line must not fail a run that otherwise succeeded; the run trajectory and the verify spill are fatal, because a run nobody can reconstruct defeats the reason the file exists.

The history belongs to the **fatal** class, by that same test read literally: the row *is* the product of a metered scheduled run. A run that spends real money and then drops its only durable result has defeated the reason it exists, and silence would be indistinguishable from a run that was never scheduled. The fatality is scoped to the eval runner's own exit code — it cannot halt a ship run (none is in the path when it appends) and it cannot change the exit status of `interlock report`, which keeps the never-throw, always-zero contract of `report/corpus-reading` and `report/non-gating`.

### D8 — Every row records the instrument as well as the measurement

Per row: schema, timestamp, plugin version, fixture id, arm, host, model identifier, eval-agent identifier, price-table identifier, Node version, the graded criteria with their deciding exit codes, and the measures (agents spawned, wall-clock duration, remediation rounds, agent-measured output tokens, receipt-reported output tokens). Nothing else.

The two token fields are deliberately separate and must not be merged. The **receipt** field is `absent` on this host with the host's reason — that is a fact about the loop's own accounting and is specified in `ship-run`. The **agent-measured** field can carry a real number, because the eval's agent makes the API calls itself and reads usage off the responses. Merging them would let an apparatus measurement masquerade as a product measurement. Neither is ever recorded as `0` when it was not measured.

### D9 — The report reads it as a fourth corpus and nothing else changes

`lib/report.mjs` gains a source and a corpus entry; indicators derived from it carry their own denominators and never sum with another corpus. The `--change` filter keys on a change name a fixture result does not have, so the corpus is excluded from a change-filtered view with the exclusion stated — silently returning it unfiltered would be the quiet degradation this repository forbids.

`openspec/specs/report/non-gating/spec.md` needs **no delta**: its requirements ("exits zero", "issues no verdict", "nothing in the loop reads the report", "the skill does not recompute or recommend") are already written over the report as a whole, not per corpus. Restating them for a fourth corpus would put the same rule in two places, which is the failure `docs/12` exists to prevent.

### D10 — `ship-run` needs no delta either

Every receipt field the graders read is already required by `openspec/specs/ship-run/spec.md`, including "A host without token accounting SHALL record unknown, not zero". This change *consumes* those requirements as its acceptance criteria. Adding a delta that restated them would create a second authority for the same behaviour.

### D11 — Scheduled-only, in its own workflow file, force-added

A new workflow with `schedule` and `workflow_dispatch` triggers and no `pull_request` or `push` trigger at all — not a path filter that happens to match nothing. It is separate from `evals.yml` so neither job's trigger surface constrains the other.

`.gitignore` ignores `.github/workflows/`, so the file must be force-added and a test must assert it stays in `git ls-files`. This is the same trap the existing eval workflow sits in; the assertion here covers the new file only and does not depend on that being fixed elsewhere.

### D12 — Fixtures live under `evals/ship/`, and case discovery is pinned

`test/evals.test.mjs` discovers a case only in a directory holding `case.yaml` or `prompt.md`, so `evals/ship/` and `evals/history/` are invisible to it. They are added to its non-case entry list anyway, and the discovered case set is pinned to the named cases so a fixture cannot silently join the metered suite.

*Risk this does not close:* `claude plugin eval`'s own discovery rule is undocumented and early-access, and this change deliberately runs no `claude plugin eval` command. Whether the harness ignores `evals/ship/` must be confirmed on the first run after this lands. *Alternative considered:* placing the fixtures under `test/fixtures/` instead, which removes the risk entirely — rejected because it files metered-run inputs under a directory that `npm test` walks, and because the review names `evals/ship/fixtures/<n>/`.

### D13 — This is a large change, and here is where a reviewer may cut it

Kept as one change because the fixtures are useless without a runner and the runner is unreadable without a record. `tasks.md` is ordered in five dependency-ordered groups, one per concern, and the **natural split point is after group 3**: groups 1–3 (fixtures, runner and isolation, graders and the loop arm) are a complete, useful change on their own — they answer "does the loop ship this fixture" and print the result. Groups 4 (control arm) and 5 (history, report, schedule) could land as a second change without reworking anything in 1–3. A reviewer who wants the smaller change should cut there, not inside a group.

## Risks / Trade-offs

- **The eval measures its own agent as much as the product.** → Both arms share the agent, so the harness is the only variable between them; the agent's identity is on every row so cross-version comparisons can exclude runs whose instrument differed; the eval's README states the agent is apparatus.
- **One run per fixture per arm is a weak signal.** Single-run pass rates wobble measurably even at temperature zero. → No conclusion is drawn from one run by construction: the row is the deliverable and the history is the answer. Nothing gates, so a noisy row costs nothing but its own price.
- **A fixture run could pollute the repository's corpora.** → Scratch root outside the repository, a refusal on a root inside it, a test asserting committed fixtures hold no run state, and a separate schema so a stray row is still not readable as a real run.
- **The harness might discover `evals/ship/` as a case.** → Discovery pinned in `npm test`; the undocumented harness rule is named as a first-run confirmation rather than assumed. (D12)
- **The price table drifts and old rows get reinterpreted.** → The table's identifier is recorded per row; a price revision is a new identifier, not an edit to the meaning of existing rows.
- **`.github/workflows/` is gitignored and the new file can be lost on a rebase.** → Force-added and asserted in `git ls-files` by a test. (D11)
- **The scheduled run costs money for a result nobody is required to read.** → Ceiling published in `lib/limits.mjs` and read by both the runner and the job; the sweep stops at fixture and arm boundaries; a partial sweep is reported partial, never as a pass.
- **The model or credential is unavailable and the job looks broken.** → No-signal is a first-class outcome with its reason, distinct from a graded failure, and no row is written for it.
- **Fixture rot: a fixture stops being solvable as the reference implementation ages.** → Every fixture's solvability is asserted offline in `npm test` by applying its reference implementation and running its suite, so rot fails the ordinary suite rather than a metered run.

## Migration Plan

Purely additive. Nothing existing changes behaviour: `lib/limits.mjs` gains one cap, `lib/report.mjs` gains one read-only corpus, and everything else is new files. Rollback is deleting the scheduled workflow — no gate, no run, and no consumer path depends on any of it, and a history file left behind is inert.

## Open Questions

- How many scheduled runs are needed before the history supports any statement about a version difference? Answerable only from observed variance in the history itself, and it changes nothing here because nothing compares automatically.
- Whether a fourth fixture shape (a change whose reference suite is green from the start, so that "the loop changed nothing and called it done" is directly gradable) earns its cost. Deferrable: it adds a fixture, not a requirement.
