# When it stops

This page tells you how to read a Interlock run that halted, or that finished with a warning banner you did not expect.

There are two categories, and they are not the same thing.

**Loud halt** — the run stops, nothing is committed, and it reports what completed and what you need to decide. Something was genuinely undecidable or unsafe.

**Soft continue** — the run keeps going with a documented default, and prints a banner in the final summary saying what it degraded. The work is done, but a capability was missing or a check did not run. These are the lines people skim past; they are the ones worth reading.

Almost everything is a soft continue. The halts are deliberately few.

## The loud halts

`/interlock:ship` has two hard halts on the default (lean) path, plus two preconditions that stop it before it starts. `--review` / `--strict` adds a third halt: unresolved review blockers.

| Condition | What it means | What to do |
|---|---|---|
| `interlock validate` exits non-zero | The change is not implementable: an artifact is missing or empty, or `tasks.md` has no real checkbox tasks | Run `interlock validate <change-name>` yourself and read the reason. Usually the change was never fully specced — go back to [the checkpoint](./02-the-checkpoint.md) or re-run `/interlock:spec`. |
| Subagents unavailable | `ship` orchestrates and never implements inline — context isolation is the entire point, so it stops rather than falling back | Usually your own permission settings restrict the `Agent` tool. Allow it and re-run. Do not work around it by asking the model to implement in the main conversation. |
| Unresolved blockers after two remediation rounds | `--review` / `--strict` only. The diff review found problems the fixers could not close in two passes | Read the surviving findings. Two failed rounds usually means the design was wrong, not the code — consider re-speccing rather than a third round. A lean run never reaches this halt. |
| Unit suite still red | Repair by root cause was capped and the suite did not go green | Fix it yourself, or run `/interlock:fix-tests`. Note what `ship` did **not** do: it will not weaken a test, loosen an assertion, or narrow the suite to get green. |
| More than two task failures across waves | Enough tasks failed that the remaining plan is not trustworthy | Read which tasks failed. Repeated failures in one area usually mean `tasks.md` was underspecified there. |
| Ship-run trajectory is not reconstructable | The `record-outcome` ping ran `interlock run-log check --state` and it exited non-zero — a sequence gap, a missing `run-start`, or a `wave-state`/`verify judge` invocation with no logged `cli-exit`. An otherwise-clean run still halts on this, because an unreconstructable run defeats the reason this file exists. | Read the reported problems with `interlock run-log check --run-id <id>` yourself. Usually a write to `.claude/ship/` failed mid-run (disk full, permissions) — fix that and re-run. This is new: until this halt existed, the writer degraded silently on a failed append. |

On any halt: nothing is committed, and it will not ask you a question. `ship` is a dynamic workflow, and the workflow runtime accepts no mid-run user input at all — there is no one listening, by construction rather than by policy. The report is the whole interface.

Every one of those halts is a non-zero exit from a `interlock` subcommand rather than a judgement call: `validate` when the change is not implementable, `remediate` when blockers survive the verdict round, `verify unit` when the suite is red or was weakened, `wave-state record-*` when a recorded result halts the run. The workflow branches on the exit status, so a halt is not something the model can decide it has earned its way past.

### Reading a `SHIP HALTED` run

The final summary tells you *that* a run halted and why in one sentence. To see the whole walk that led there — every wave-state action, every agent the loop spawned, every verify judgement — read the run's trajectory instead of re-deriving it from git history or from the summary alone:

```bash
interlock run-log list                       # every recorded run: change, halted?, event/skip counts
interlock run-log show <runId>                # one run's events, in sequence order
interlock run-log query --run <runId> --halted   # only the events that explain the halt
interlock run-log query --run <runId> --type verify-judgement   # e.g. just the verify verdicts
```

The trajectory lives at `.claude/ship/runs/<runId>.jsonl` — an append-only JSON Lines file, one line per wave-state action, CLI exit, agent spawn, and verify judgement. `list` prints every run's id, so if you do not have the run id handy, start there. `run-log show`/`query` never fail on a torn or unreadable line — they skip it and say so, the same way `outcomes list` does, so a crash mid-append costs you at most that one record, not the read.

A `verify-judgement` line never carries the raw suite log — a red unit suite's full stdout lives under `.claude/ship/spill/<runId>/`, and the trajectory line points at it with a locator and a short preview instead. If a judgement's preview does not tell you enough, open the locator with `offset`/`limit` rather than reading the whole file — it can be hundreds of KB.

### `/interlock:spec` stops too

**Blockers at the artifact review.** It reports them and stops rather than fixing and continuing, because a blocker there means the spec was wrong and you should see that.

**Continuity paused.** Only on a run you started with `--continue`. The readiness gate exited non-zero, so `spec` did not invoke `ship`. You get a short list — the decisions still marked as needing a person, and the named blockers — and nothing else; you opted out of reading the spec, so it does not hand the spec back.

Answer the questions and it writes them into the ledger, re-runs the gate, and continues if it now passes. To see the same verdict yourself:

```bash
interlock ready <change-name> --review <review-result.json> --paths <planned paths>
interlock ledger <change-name>       # non-zero while a decision still needs a person
interlock risk <change-name> --paths <planned paths>
```

`ready` fails closed: a check that could not run is a blocker, not a pass. If the answer is that the blast radius is too wide, that is not something to answer your way out of — read the spec and run `ship` yourself. [**05 — Continuity**](./05-continuity.md) explains what each check means.

## When the run never starts, or stalls

Two failure shapes that are about your environment rather than your change, and neither reads like the halts above.

**`/interlock:ship` is unknown, or the trampoline halts.** `/interlock:ship` is a skill that launches `workflows/ship.js` on the Workflow runtime. The Skill tool will find the command in any repo where the plugin is installed. What still has to be true for the *run* to start: Claude Code **v2.1.154+** with dynamic workflows enabled. Where they are off — `disableWorkflows`, an org policy, `CLAUDE_CODE_DISABLE_WORKFLOWS`, a Pro plan that has not turned them on in `/config`, or an IDE that never exposes the Workflow tool — the trampoline **halts rather than implementing the loop in conversation.** Everything else in Interlock still works, including `spec`, the reviews and `commit`, so you can implement the change another way, but the loop this tool is built around needs the workflow runtime.

That halt is unchanged by the existence of a second host. There is now an experimental ACP driver that runs the same lean loop off the workflow runtime — but it is **a separate path you invoke yourself, not a fallback.** The trampoline will never reach for it: an automatic downgrade from "the runtime guarantees nobody can interrupt this" to "some other agent is driving it" is exactly the quiet degradation this file exists to make impossible. If you want it, run it deliberately:

```bash
INTERLOCK_ACP_COMMAND="<your-acp-agent>" interlock-ship-acp <change-name>
```

It ships lean only, and it **refuses** `--strict`, `--review`, `--handoff` and `--conformance` with exit code `2` rather than running something smaller than what you asked for. Exit `0` is a terminal summary, `1` is a halt, `2` is "not supported on this host". Its two banners are in [the soft continues](#acp-host-experimental--model-routing-unavailable-acp-host) below, and the README's Experimental section says what it is for.

**The run stops halfway and waits for you.** Workflow agents inherit your own permission settings, so a command that is not allowlisted raises an approval prompt mid-run — which is exactly what a zero-touch run should never do, and the one interruption the runtime cannot prevent, since it is your setting being honoured. Allowlist `interlock`, `interlock-graph`, `openspec`, `git`, and your test runner before a long run. If you find a run sitting on a prompt, approve it and allowlist that command so the next run does not.

**You stopped the run, and resuming re-ran more than you expected.** Resume from `/workflows` keeps completed agents' results, but two rules decide which ones survive, and the second one surprises people:

- An agent still running when you stopped is not saved, so it starts over.
- Replay follows the order agents *started*. Caching stops at the first agent that did not finish, and **every agent that started after it re-runs — even the ones that completed.**

So stopping mid-wave costs the whole rest of that wave. This is one place Interlock's shape pays off: a run fanned out across many small agents preserves far more progress across a pause than one long agent would, because there is less work sitting behind the first unfinished agent.

**Do not edit a control-plane prompt to "cache-bust" a bad `action`.** Workflow cache keys on the exact prompt text. Changing `next-1`, a shared step suffix, or any earlier agent to force a live re-run of a ping that returned `action: "report"` (or any other invented value) makes that step a cache miss — and **every agent that started after it re-runs**, including implementers whose work is already on disk. `ship` retries an unknown action once itself by re-asking `wave-state next` under a new `next-retry-*` label. That misses cache for the ping only. If a live run on older code already cached a garbage action, change **only** that step's label (for example `record-batch-12` → `record-batch-12b`), never an earlier prompt.

Resume also only works **within the same Claude Code session**. If you exit Claude Code while `ship` is running, the next session starts it fresh — no cached results, no partial credit. On a long run, leave the session open.

**A `Large workflow` warning appears in the task panel.** Claude Code flags a run scheduling more than 25 agents or projecting more than 1.5M tokens (v2.1.203+). A **`--strict`** run crosses that easily — several waves of up to 8 implementers, four to six review dimensions, two skeptics per blocker and warning, then one fixer per file. Default (lean) ship is implementers plus verify plus commit, and usually stays under the warning. **The warning is advisory: it does not pause, cap, or halt the run.** It is pointing you at `/workflows` in case the size is a surprise. If it is not, ignore it.

The related `workflowSizeGuideline` setting (`/config`, default `medium`) is advice Claude follows when it *writes* a workflow. `ship` ships as a pre-written script, so the guideline should not throttle it — but that is read from how the setting is documented rather than measured, so if you see wave sizes that disagree with `interlock limits`, that would be the first thing to check.

## Retrigger and `/goal`

There are three loops. Mixing them up is how leftover checkboxes burn a second 20+ agent `Workflow()` call.

**Inner retries stay inside one `ship.js` run.** They are already capped (`interlock limits`): a one-shot `next-retry-*` when `wave-state` stdout is not a real action, inter-wave verify fix attempts, replan of unexecuted groups, remediation rounds 1–2 (round 3 is verdict-only), unit root-cause repair, and mechanical `interlock tasks tick` after a successful batch. Do not promote any of those to a second `Workflow()`.

**Start a new outer run only when:**

| Trigger | Why it is valid | Who says so |
|---|---|---|
| New user message `/interlock:ship` (or "ship leftover tasks") | New intent | Human |
| After **SHIP HALTED**, you fix the cause (artifacts, allowlist, re-spec) then ship | A fail-closed gate can now pass | Human + CLI |
| `spec --continue`: you answer the ledger, `interlock ready` exits 0, ship launches **once** | Continuity's one legal bridge | Human answers + `interlock ready` |
| Resume the **same** workflow from `/workflows` after an interrupt | Cache replay, not a new plan | Human |

**Never auto-retrigger.** Leftover `- [ ]` after `SHIP COMPLETE WITH LEFTOVERS` is a report (failed tasks under the halt cap). Unticked-but-done work is `interlock tasks tick`, not a second implementer pass. A classifier drop is a halt via `interlock tasks coverage`. Dispatch must not route "unchecked tasks → ship" after a workflow just returned. The `Large workflow` warning is advisory. Failed leftovers are retried only by a new human ship — preferably `--apply-only` so review and commit are not paid twice.

Claude Code's [`/goal`](https://code.claude.com/docs/en/goal) is a *session* Stop hook: a transcript evaluator that starts a new parent turn when the condition is unmet. It does not run commands or read files. Interlock does not invoke `/goal`, and it does not ship a plugin Stop hook that blocks until boxes are empty — that re-creates the token leak and fights the eight-block cap.

`finish()` and the spec checkpoint print a greppable line so a user-set `/goal` can stop:

```text
GOAL MET: interlock ship returned a terminal summary.
GOAL MET: interlock spec stopped at the checkpoint.
```

Leftovers and a halt still print the ship line. They are terminal summaries, not a missing second ship.

**Safe** (the evaluator can yes on the transcript):

```text
/goal The transcript contains "GOAL MET: interlock ship" or "GOAL MET: interlock spec". Leftover checkboxes and a second Workflow call are not required.
```

**Unsafe** (do not use — leftover boxes, a red e2e banner, or "keep going" will start another turn): `all tasks.md boxes checked`, `tests pass`, `keep implementing until done`.

## The skip receipt

### `LEAN SHIP`

Default `ship` skipped one or more of review, handoff, and conformance. This is not a degradation — it is the advertised default. The line lists what was skipped so a lean run cannot look like `--strict`.

```text
LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable
```

`--strict` (or all three flags together) omits this line. Continuity (`spec --continue`) also launches lean unless you pass a tail flag.

## The soft continues

### `GRAPH UNAVAILABLE`

The code knowledge graph is not usable: `/interlock:bootstrap` reports it when the build errors or indexes nothing, and `/interlock:ship` reports it when no graph was ever built for this repo. Either way the agents fall back to grepping — slower and more token-hungry, but correct.

If the reason is `never built`, the fix is to run `/interlock:bootstrap` once.

The most common cause is language coverage. **Structural indexing — import and symbol edges — covers JavaScript/TypeScript, Python, and shell only.** A Go, Rust, Java, or Ruby repo will produce little or no structural graph, and that is expected. Those projects still get docs and OpenSpec indexing, spec-to-file links, prose retrieval, and the complete workflow. Nothing in the loop requires the graph.

If your repo *is* JS/TS, Python, or shell and the graph is still empty, build it directly and read the error:

```bash
interlock-graph build .
interlock-graph report .
```

### `NO TEST PROFILE`

There is no `.claude/testing/profile.json`, so `ship` had to infer how to run your tests. It will not interview you about it — that is a different skill's job, and `ship` could not ask even if it wanted to.

Fix it once, and every later run is faster and more accurate:

```bash
/interlock:fix-tests --reconfigure
```

### `MODEL ROUTING OVERRIDDEN`

You have `CLAUDE_CODE_SUBAGENT_MODEL` set in your environment, and it wins over everything the plan decided. Per the [workflow docs](https://code.claude.com/docs/en/workflows), that variable overrides both your session model *and* a per-agent model a script asks for — so every agent in the run used it, whatever tier the planner assigned.

That matters because the tier ladder is most of Interlock's cost story. Normally the planner pins trivial one-file edits and the mechanical CLI pings to `haiku`, clamps over-eager `opus` down to `sonnet` for everything below tier 5, and lets `opus` survive only on genuinely novel architecture. With the override set, none of that applies: a run of forty tier-1 tasks costs forty `opus` calls if that is what you exported.

The work is still correct — this is a cost and latency degradation, not a quality one. To check and clear it:

```bash
printenv CLAUDE_CODE_SUBAGENT_MODEL
unset CLAUDE_CODE_SUBAGENT_MODEL
```

Then confirm what the planner *would* have assigned:

```bash
interlock limits
```

If the override was deliberate — pinning a whole run to `haiku` to sanity-check a change cheaply, say — this banner is just the receipt, and there is nothing to fix.

### `ACP HOST (experimental)` / `MODEL ROUTING UNAVAILABLE (ACP host)`

Only from `interlock-ship-acp`, never from `/interlock:ship`. The first banner prints on every run of that driver: it is saying that you are on the second host, and that the supported path has more around it.

The second is the one worth reading, and it is a different failure from `MODEL ROUTING OVERRIDDEN` above — nothing in your environment caused it. ACP v1 has no per-prompt model selector, so the planner's tier ladder — the thing most of the cost story rests on — **is not in effect on this host**. The plan still assigns a tier per task, and the slug still travels to the agent as a hint it is free to ignore, but whatever model your ACP agent is configured with is the model every task gets. `interlock limits` still prints what the planner decided; on this host, read it as intent rather than as what ran.

There is nothing to fix, and no flag that restores it. If per-tier routing matters for the run — a long change with forty tier-1 tasks — run it on Claude Code.

### `VERIFICATION SKIPPED`

The inter-wave checks did not run, with a reason attached. The documented reasons are: no test or typecheck commands were detectable, the failures were pre-existing before the run started, or verification would have exceeded roughly a minute (in which case it degrades to typecheck only).

This does not mean the final unit suite was skipped — that one is a hard halt when red. It means the fast between-waves feedback loop was missing, so problems surfaced later than they should have. A test profile usually fixes it.

### `E2E FAILED (non-blocking by policy)`

The end-to-end suite ran and went red, and the commit happened anyway. This is intentional: `ship` reports e2e failures and never repairs them. E2E failures are frequently environmental, and auto-fixing them is exactly how a real regression gets papered over.

**You have to look at this one.** The commit is not a statement that e2e passed. Run the suite yourself, decide whether it is your change or your environment, and fix or revert before the MR merges. To skip e2e entirely on a run where you know the environment is broken:

```bash
/interlock:ship --skip-e2e
```

### No manual test plan

Only on `--handoff` / `--strict`. If `interlock surface` classified every changed file as not UI-testable, `ship` skips the manual test plan and says why. A backend-only change does not get a UI test script. Default lean ship does not write a plan at all — run `/interlock:manual-test-plan` if you need one. You can check the classification yourself:

```bash
interlock surface --changed src/Button.tsx docs/readme.md app/api/login/route.ts
```

## What is enforced, and what is followed

Worth knowing when you are deciding how much to trust a clean run.

**Enforced by the harness:**

- The workflow runtime accepts no mid-run user input, so `ship` cannot stop to ask you anything. This is structural: there is no tool to remove, because there is nobody listening. This one is the *Claude Code* runtime's guarantee, and it is the main thing the experimental ACP driver does not inherit — that driver answers its agent's permission requests itself and never prompts you, which is a policy in a file rather than a property of a runtime. It is the honest reason ACP is not the default.
- `commit` and `mr` set `disable-model-invocation: true` — the model cannot trigger them on its own; you invoke them.

(A skill's `allowed-tools` is a pre-approval list, not a restriction — it stops mid-run permission prompts, it does not remove capabilities.)

**Enforced by control flow**, in `workflows/ship.js`: the wave loop, the halt conditions, the order of verification, and (on `--review` / `--strict`) the remediation rounds. These used to be numbered headings a model was asked to follow. They are now a script, and a script does not talk itself into a third remediation round.

**Enforced by code**, in the `interlock` CLI — every decision the script makes is a subcommand, and gating subcommands exit non-zero when they block:

| Command | Decides |
|---|---|
| `validate` | Whether a change is implementable at all |
| `waves`, `wave-state` | Wave order, per-task model, the parallel-agent cap, and what the run does next. `record-*` / `replan --write-state` write the new state and emit that next step, so ship does not pay a second agent turn after every batch. |
| `gate`, `review` | Whether a review blocks, and which findings survive the skeptics and the quality band |
| `remediate` | Whether another fix round is allowed, or the verdict has landed |
| `verify plan\|judge\|unit\|cluster\|repair` | Which checks to run, what a result means, and when repair is out of budget |
| `surface` | UI testability, and so whether a manual test plan is written |
| `limits` | Every cap above, in one place, so nothing restates a number in prose |
| `risk`, `ledger`, `ready` | Whether continuity may skip the human checkpoint |
| `run-log check` | Whether the ship-run trajectory is reconstructable — `wave-state` and `verify judge` now exit non-zero on their own failed trajectory appends too, not just on `record-outcome`'s closing check |

Run any of them yourself; they need no model and no network.

**Left to the model**, because it is what a model should decide: how to classify a task, how to implement it, what a review finding means, and how to synthesize. The agents report structured results and the script branches on them — so if a run's summary does not mention a step, it is still worth checking, but the loop itself is no longer the thing you are trusting to remember.

## Still stuck

Re-read the final summary before re-running anything — it names every default that was applied. If the artifacts were the problem rather than the run, go back to [the checkpoint](./02-the-checkpoint.md) and re-spec; that is cheaper than a third ship attempt almost every time.

## Next

Back to [**01 — Your first hour**](./01-first-hour.md), or the [README](../README.md) for the full skill surface. If you got here from a paused continuity run, [**05 — Continuity**](./05-continuity.md) has the rest of that story.
