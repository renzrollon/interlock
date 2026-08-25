## Why

Three facts, each verified against the code:

1. **The richest quality signal in the system is computed and thrown away.** `degradationLines()` (`workflows/ship.js:1646`) exists specifically so that silence and cleanliness are distinguishable — its own doc comment says *"An accumulator can only report what someone remembered to push — which is the exact property this block exists to remove."* It assembles skipped verifications, cap exhaustion, unresolved errors carried past a wave, model-routing degradation, and closing-step outcome into a list, `finish()` joins it into a string, and the string goes to stdout. Nothing reads it. Nothing can.

2. **The commit sha exists only in stdout.** The commit step returns `{ok, sha, detail}` to the script, which prints `commit: <sha>`. Because the sha is never persisted next to the run, no later process can ask the one question that grounds every other measure: *did the files this run touched get reverted, fixed, or re-opened afterwards?*

3. **`.claude/ship/` is not portable.** `state.json`, `plan.json`, `classified.json`, and `plan-fingerprint.json` are all single files clobbered by the next run, so the plan a run executed is unrecoverable the moment another run starts. And a `.claude/ship/` handed to a different machine has no git, no `openspec/changes/`, and no test suite — so the observations that cannot be faked are precisely the ones that do not travel.

A run should leave behind a self-contained, per-run record of what it observed at the moment it was true.

## What Changes

- A new `run-receipt` trajectory event type, appended once at run close, carrying: the wave tally (ok / failed / not-attempted per wave), plan reuse verdict, review blocker and warning counts, remediation rounds, verification skips and cap exhaustion, unresolved-error count, leftover task ids, the halt reason or completion, the commit sha, and the degradation list verbatim.
- Fields are copied by name through a `TYPE_FIELDS` whitelist, exactly as every other event type is. Handing the writer the whole `summary` object cannot leak prompts, diffs, finding bodies, or suite logs.
- `run-receipt` is added to the event enum and to the reconstructability check's vocabulary. It is **not** made mandatory for reconstructability: a run that halted before it could write one must still reconstruct.
- `.claude/ship/runs/<runId>.jsonl` becomes self-sufficient for scoring without a git checkout beside it.

**Not in scope:** any score, grade, threshold, or gate computed from the receipt. This change records; it decides nothing.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ship-run`: the event-type enum gains `run-receipt`, with requirements covering what a receipt must carry, that its payload is whitelisted by name, that it is written once per run for halted and clean runs alike, and that its absence does not by itself make a run unreconstructable.

## Impact

**The constraint that shapes the design.** The default host cannot write files. `workflows/ship.js` contains no `writeFileSync`, no `readFileSync`, and no `import` — every byte reaching disk goes through a prompt (`Write this JSON to …`) and then a CLI call. The ACP host is different: `bin/interlock-ship-acp:180` wraps `host.runCli(argv)` and invokes the CLI directly twelve times.

So the receipt cannot be a free-form JSON file an agent composes — that would be a self-reported artifact wearing the badge of an observed one, which is the defect `derive-outcome-record-from-receipt` exists to fix. It must be **script-authored, agent-transported, CLI-validated**, which is the pattern `run-log append` already implements, with `TYPE_FIELDS` as the integrity boundary.

**Affected code.**

- `lib/run-log.mjs` — `run-receipt` added to `RUN_LOG_TYPES` and `TYPE_FIELDS`; `summarizeRunLog` surfaces the sha and halt state; `checkRunLog` learns the type without requiring it.
- `bin/interlock` — `run-log append` accepts the new type; `run-log show`/`query` render it.
- `workflows/ship.js` — `finish()` serializes the same facts it already prints into the closing step's transported JSON. `degradationLines()` is called once and its result is both printed and recorded, so the banner a human reads and the record a scorer reads cannot disagree.
- `bin/interlock-ship-acp` — writes the receipt directly, no agent in the path.

**Ordering.** `recordOutcome` runs before `finish()`, but the receipt needs `degradationLines()`, which reads `summary.closing` — set *by* `recordOutcome`. The receipt is therefore appended after the closing step reports, not inside it, and a run that dies between the two leaves no receipt. That is correct and must be visible: a missing receipt means "the run did not reach its own close", which is itself a finding.

**Portability.** After this change, copying `.claude/ship/runs/<runId>.jsonl` to another machine carries the run's observed outcome, degradations, and commit sha. What still does not travel is the executed plan (`plan.json`, clobbered) — recording that is deliberately out of scope here; the receipt carries the plan *fingerprint hash*, which is enough to tell whether two runs executed the same plan without carrying 46 KB of it.

**Non-goal.** No composite score, no weighting, no threshold, no eligibility rule. `lib/outcomes.mjs` is explicit that wiring a gate to run records is an unmade decision, and this change does not make it.
