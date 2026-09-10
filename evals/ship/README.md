# The outcome eval

Every other eval in this repository grades a **transcript** — what an agent said
and which tools it touched. This one grades an **outcome**: files on disk, ticks
in `tasks.md`, a commit, a green suite. It copies a committed fixture to a
scratch root outside this repository, runs the real ship loop there against a
real model, and then decides what happened using only exit codes the CLI already
produces.

```sh
node evals/ship/run.mjs --help          # what it does and what it costs
node evals/ship/run.mjs --prepare-only  # no model, no spend, no row
node evals/ship/run.mjs                 # METERED: every fixture, both arms
```

**Ordinary CI runs the prepare-only path**, on every pull request and every push
to the default branch, as its own job in `.github/workflows/ci.yml`. That job
invokes no model, needs no credential, records no spend and appends no history
row — it copies, isolates and discards each fixture, and a non-zero exit fails
the build. So a broken fixture, a failed copy or an isolation refusal is caught
where changes land, not by the metered sweep a week later.

The metered sweep is the other half of the split: schedule and
`workflow_dispatch` only, never a pull request, in its own workflow file. A red
prepare job in ordinary CI is apparatus hygiene and not a graded outcome-eval
result — nothing in the loop reads either one.

## What it grades

Six **outcome** criteria, each an invocation against the scratch root, none of
them a new judgement:

| Criterion | Decided by |
|---|---|
| ticks match what the state machine recorded | `interlock validate --json` against the run's own recorded outcomes |
| a commit exists (or the run was invoked to make none, and none does) | the scratch repository's log, cross-checked against the receipt's commit field |
| the unit suite is green | `interlock verify unit` — the same decision the loop itself uses |
| no test was weakened | the same judgement's weakened-suite check, against the fixture's committed baseline counts |
| the trajectory is reconstructable | `interlock run-log check` |
| the receipt is present and observed | `interlock run-log query --type run-receipt` — tallies, spend, remediation rounds and leftover ids as observed values |

…and, **on the loop arm only**, three **process** criteria, decided by walking
the events the run already wrote (`interlock run-log show --json`):

| Criterion | Decided by |
|---|---|
| `trajectory-required-event-types` | a run that closed with `run-complete` emitted `wave-action`, `cli-exit`, `verify-judgement` and `run-receipt`, and carries no event type the writer would refuse. A `run-halt` close is not held to the types only a completed ship emits |
| `trajectory-known-actions` | every recorded `action` is one the run program allows. An invented value — `report`, say — fails, because `lib/run-log.mjs` copies the field as text without checking it |
| `trajectory-halt-on-unit-red` | a `verify-judgement` whose `unitStatus` the CLI already recorded as halting (`red`, `error`, `weakened`) closed with `run-halt` and not with `run-complete` |

**These walk JSONL events, not chat.** The run-log is the loop's own record of
its CLI invocations — the same file the reconstructability criterion reads — so
grading it is not reading a transcript. No chat message, plugin-eval trace or
implementer tool-call list is consulted, and **implementer tool order is not a
criterion**: the walk checks that the required event types are present, never
that they arrived in a particular sequence.

The process checks sit **beside** `interlock run-log check` and never inside it.
A log carrying an invented action is still reconstructable, and stays so: the
reconstructability check is an in-run gate, and folding an eval-only check into
it would halt a consumer's ship over a finding this eval only observes.

An **unknown fails its criterion**. A receipt field the run never observed is
recorded `unobserved`, never as a clean value: reading absence as cleanliness
would flatter exactly the runs this eval exists to explain. A loop arm that wrote
no trajectory leaves all three process criteria `unobserved` for the same reason.

Nothing here reads a transcript. A run that claimed success while leaving the
suite red grades red, because the suite was consulted and the claim was not.

## What it does NOT measure, and why

**This eval runs on the ACP host** (`bin/interlock-ship-acp`), because that is
the only host the loop can be driven from a shell on: `workflows/ship.js` needs
the Workflow tool and cannot be driven headlessly. Three consequences follow, and
they are stated here rather than left for a reader to infer from a number:

- **Per-tier model routing depends on the agent under measurement.** The adapter
  negotiates the plan's per-tier assignment — the haiku pings, the opus clamp —
  through the model options the configured agent advertises on `session/new`.
  Against an agent that advertises none — the eval's own apparatus agent included
  — the ladder is **not in effect**, and every agent in that measured run costs
  whatever the configured agent costs; the host prints
  `MODEL ROUTING UNAVAILABLE (ACP host)` naming each unrouted spawn. So a cost
  figure here is only comparable against the run's own routing line, which says
  which way it went.
- **The interactive runtime's launch behaviour is not under test.** No trampoline,
  no session, no plugin registry, no skill dispatch. A change to how
  `/interlock:ship` starts inside Claude Code would not move a single figure
  here.
- **The `--strict` tail is not measured.** The ACP host refuses `--strict`,
  `--review`, `--handoff` and `--conformance` rather than quietly running lean
  under a strict invocation. The eval runs the **default** configuration, which is
  what consumers run and the thing that has never been measured.

What *is* exercised: the CLI-governed loop, the planner's classification, the
implementer briefing, the wave state machine, verification, the receipt and the
trajectory.

**The eval's ACP agent is apparatus, not product.** `evals/ship/agent/` is a
stdlib-only ACP agent with three tools, written so the fixture runs can happen at
all — it is not something Interlock ships, recommends, or measures. Both arms use
it, so the harness is the constant between them and not a variable in the
comparison, and its identity (`interlock-eval-acp-agent/N`) travels on every
recorded row so a change to it cannot silently confound a comparison across
plugin versions. `INTERLOCK_ACP_COMMAND` overrides it; a row produced that way
records the command string rather than a version-keyed identity, because the
repository cannot know what an external agent is.

## The two arms

- **loop** — `interlock-ship-acp <change> --root <scratch>`. The product.
- **control** — the same agent, the same model, the same starting state, prompted
  once per task in `tasks.md` order with the task text and nothing else, then the
  fixture's unit command, then a commit. No planner, no waves, no state machine.

The control arm has no state machine and no trajectory, so the tick, trajectory,
receipt and the three process criteria **do not apply to it**. They are recorded
not-applicable, never as failures — recording an inapplicable criterion as a
failure would manufacture exactly the difference the eval exists to measure. The
reported difference therefore covers the criteria both arms can be graded on
(suite green, no weakened test, commit present) plus every measure, and carries
no verdict.

## What it costs, and what stops it

The ceiling is published as `evals.shipEvalCostUsd` by `interlock limits --json`,
and both the runner and `.github/workflows/ship-outcome-eval.yml` read it from
there. The number appears in no prose, no YAML and no skill.

It is enforced at **fixture and arm boundaries only**. It stops the next arm from
starting; it never kills a run in flight, because a half-killed run cannot be
graded and would be recorded as a failure it did not earn. A sweep that reaches
the ceiling reports itself **partial**, names the ceiling, and does not record
the fixtures that did not run as failures.

Spend is converted from measured tokens by the price table `interlock limits`
publishes beside the ceiling. The table's identifier is recorded on every row, so
a later price revision is a new identifier rather than a silent reinterpretation
of old rows. A model the table does not price yields no spend figure — absent
with that reason, never a zero and never a guessed tier.

## Isolation

Every run copies its fixture into a fresh directory under the system temporary
directory. All run state — the ship work directory, the trajectory, the learning
corpus, the git repository the commit lands in — lives there and nothing is
copied back. The runner **refuses** a root that resolves inside this repository
rather than trusting itself to have passed the right one; this repository's
corpora were purged once already after exactly that kind of pollution, and a
record written by a fixture run is indistinguishable from one written by a real
run.

The only thing that travels back is one line per fixture per arm in
`evals/history/ship-outcomes.jsonl`, under its own schema, which no other
corpus's reader recognizes.

## No signal is not a failure

No credential, no available agent, an unreachable model, or a fixture that failed
its own solvability check: each reports that it produced **no signal** with its
reason, and records no graded result and no row. An eval that could not run has
not measured a regression.

## Nothing reads a result

No gate, readiness check, risk classification, autonomy record, promotion
decision or workflow step consumes an outcome-eval result, its measures, or the
difference between its arms. The scheduled job is not a required check. One run
per fixture per arm is a weak signal by construction — the row is the deliverable
and the accumulated history is the answer.

## Harness case discovery — confirmation record

`evals/ship/` and `evals/history/` sit inside the directory
`claude plugin eval` scans for cases, so the question "does the harness discover
a fixture as a case" has to be answered rather than assumed.

**Confirmed from the shipped binary, 2026-09-05.** `claude plugin eval --help`
documents the discovery rule in its own words: cases are
`<eval dir>/**/case.yaml or prompt.md`. No file under `evals/ship/` or
`evals/history/` carries either name, and `test/evals.test.mjs` pins both the
non-case entry list and the discovered case set, so a fixture that acquired one
of those filenames would fail `npm test` before it could ever join a metered run.

**Still to confirm on the first metered run after this lands.** The rule above is
the documented one; the results of an actual `claude plugin eval` run are the
observed one. On the first scheduled full-suite run, check that
`evals-results.json` names exactly the model-facing cases and no fixture. Record
the outcome here. Until that line exists, this section is a documented rule and a
pinned test, not an observation.
