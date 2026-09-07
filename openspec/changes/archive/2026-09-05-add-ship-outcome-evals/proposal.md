## Why

Every eval Interlock owns grades a *transcript* — what an agent said and which tools it touched. Nothing grades an *outcome*: files on disk, ticks in `tasks.md`, a commit, a green suite. So the question the repo's own docs admit is open — does the ship loop produce a better result than a simpler one, and is a given release cheaper or dearer than the last — is not answerable from the repository, and every argument for the loop's design is an argument from mechanism rather than from measurement.

The external evidence that this gap bites is specific: 35 harness releases of one coding agent, model held constant, produced no significant resolve-rate trend while token spend nearly doubled — and every release passed its functional tests. Interlock's own changelog shows a comparable cadence of unmeasured changes to the ship loop. The receipt now records the instruments (per-wave output-token spend, tallies, remediation rounds, leftover task ids); nothing yet takes those readings twice and compares them.

## What Changes

- **A committed fixture set that can actually be shipped.** Three minimal repositories, each with a reviewed OpenSpec change spanning at least two waves, a testing profile, and a reference implementation that proves the change is solvable and turns the fixture suite green. Every fixture is executed from a scratch root outside the repository, so no fixture run can write into the repository's own corpora.
- **A scheduled outcome eval that runs the real loop and grades the environment.** The eval copies a fixture to a scratch root, runs the lean ship loop there over the ACP host with a real model, then grades what is on disk using only decisions the CLI already makes — task ticks against recorded outcomes, commit presence, unit verification including the weakened-suite check, trajectory reconstructability, and a receipt whose fields are observed rather than unknown. No new judgement is introduced: every grader is an exit code that exists today.
- **A control arm.** The same fixtures, the same model, the same graders, run through a sequential single-agent apply with no wave loop — the control group the docs record as missing. The eval reports the per-fixture delta on every recorded measure and nothing branches on it.
- **A committed results history.** One append-only record per fixture per arm per run, keyed by plugin version and fixture, holding counts and measures only — no transcripts, no diffs, fields copied by name like every other corpus writer. Two releases produce two comparable rows.
- **The report may read that history as a fourth corpus**, under exactly the rules the existing three are read by: denominators everywhere, no verdict, no threshold, exit zero, nothing in the loop consuming it.
- **A new published cap** for the outcome eval's cost ceiling, read by the scheduled job from the moment it is added.
- The eval runs **on a schedule only, never on a pull request**, and its first arm runs the **lean** loop — the default product — not `--strict`.

## Capabilities

### New Capabilities

- `evals/outcome-fixtures`: what a shippable fixture repository is, the reference implementation that proves it solvable, and the isolation rules that keep fixture runs out of the repository's corpora.
- `evals/outcome-run`: how one outcome eval executes — host, arms, scheduling, cost ceiling — and what it grades, using only existing CLI exit codes and receipt fields, including the stated limits of the host it runs on.
- `evals/outcome-history`: the committed results record — its shape, its keying, what it may never carry, and what a failed append means.

### Modified Capabilities

- `report/corpus-reading`: the reader gains a fourth corpus (the outcome-eval history) and must read it under the same never-throw, torn-line-tolerant, schema-classified, write-nothing rules as the other three.

## Impact

- **New**: `evals/ship/` — fixtures, the eval runner, the ACP agent the runner drives, and the eval's own README stating what this host does and does not exercise; `evals/history/ship-outcomes.jsonl`; one scheduled CI workflow.
- **Modified**: `lib/limits.mjs` (one new eval cap, with its reader); `lib/report.mjs` and `bin/interlock report` (a fourth corpus, read-only); `test/evals.test.mjs` (case discovery must keep finding exactly the model-facing cases and no fixture); documentation of the eval surface.
- **Not modified**: `workflows/ship.js`, `bin/interlock-ship-acp`, the ship-run receipt, and every gate. The eval observes the loop; it does not change it, and no result it produces feeds any decision.
- **Dependencies**: none added. The repository has no runtime dependencies and this change adds none — the ACP agent the eval drives is stdlib-only, and the eval harness is `node:test`-free plain Node.
- **Cost**: metered model calls on a schedule, bounded by a published ceiling. Zero cost on pull requests, because the eval never runs on one.
