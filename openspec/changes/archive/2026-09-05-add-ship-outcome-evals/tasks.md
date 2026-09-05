## 1. Fixtures

- [x] 1.1 Create `evals/ship/fixtures/` with a per-fixture description format that names the shape the fixture exercises and what a failure on it would mean
- [x] 1.2 Fixture `docs-and-code`: starting state (source + `node:test` suite + `.claude/testing/profile.json`) and an OpenSpec change mixing a documentation task with code tasks, with at least one task depending on an earlier task's output
- [x] 1.3 Fixture `docs-and-code`: reference implementation, held outside the starting state
- [x] 1.4 Fixture `dependent-export`: starting state and a change whose second task consumes an export the first task creates
- [x] 1.5 Fixture `dependent-export`: reference implementation
- [x] 1.6 Fixture `red-until-task`: starting state and a change whose suite stays red until one specific task lands
- [x] 1.7 Fixture `red-until-task`: reference implementation
- [x] 1.8 Test: each fixture's change is reported implementable by `interlock validate` run from that fixture's own root
- [x] 1.9 Test: each fixture's starting-state suite is red, and applying its reference implementation turns it green and satisfies every task the change declares
- [x] 1.10 Test: no committed fixture directory holds run state (no ship work directory, no trajectory, no outcome corpus, no metrics)
- [x] 1.11 Test: every fixture's `.claude/testing/profile.json` is present in `git ls-files`, pinning that the root-anchored ignore rule does not reach into a fixture
- [x] 1.12 Extend `test/evals.test.mjs`'s non-case entry list with the new directories and pin the discovered case set, so a fixture cannot join the metered case suite

## 2. The eval's ACP agent and scratch-root isolation

- [x] 2.1 `evals/ship/agent/`: the ACP stdio subset — `initialize`, `session/new`, `session/prompt`, streamed `agent_message_chunk`, `end_turn` — stdlib only
- [x] 2.2 Agent tool loop against the model API over global `fetch`, with read-file, write-file and run-command tools scoped to the session's working directory
- [x] 2.3 Agent accumulates its own input/output token usage per session and reports it to the runner
- [x] 2.4 Agent selection: default to the committed agent, defer to `INTERLOCK_ACP_COMMAND` when set, and record which was used
- [x] 2.5 Test: the agent answers the wire subset against a stub transport with no network and no model call
- [x] 2.6 `evals/ship/run.mjs`: scratch-root preparation — copy a fixture into a fresh directory under the system temporary directory and initialize its repository there
- [x] 2.7 Runner refuses a root that resolves inside this repository, with the reason stated
- [x] 2.8 Test: the refusal fires for a root inside the repository, and a completed scratch run leaves this repository's outcome, trajectory and metrics corpora byte-identical

## 3. Graders and the loop arm

- [x] 3.1 Add `EVAL_CAPS.shipEvalCostUsd` and the price table it needs to `lib/limits.mjs`, and print both through `formatLimits()`
- [x] 3.2 Test: the new cap and price-table identifier appear in `interlock limits --json`, and the runner and the scheduled job are their readers
- [x] 3.3 Runner: execute the loop arm as `interlock-ship-acp <change> --root <scratch>`, capturing agents spawned and wall-clock duration
- [x] 3.4 Grader: every task the state machine recorded as succeeded is ticked and no other, from `interlock validate --json` against the run's recorded outcomes
- [x] 3.5 Grader: a commit exists in the scratch repository, cross-checked against the receipt's commit field, or the run was invoked to make none and none exists
- [x] 3.6 Grader: unit suite green via `interlock verify unit`, including its weakened-suite check against the fixture's committed baseline
- [x] 3.7 Grader: `interlock run-log check` reports the run reconstructable
- [x] 3.8 Grader: the receipt is present and carries tallies, spend, remediation rounds and leftover task ids as observed values, with an unknown failing the criterion rather than reading as clean
- [x] 3.9 Runner: the measures block — agents spawned, wall time, remediation rounds, agent-measured output tokens and receipt-reported output tokens kept as separate fields, each recorded absent-with-reason rather than zero when unmeasured
- [x] 3.10 Runner: the no-signal path — absent credential, absent agent, unreachable model or a fixture failing its own solvability check reports its reason and records no graded result
- [x] 3.11 Runner: read the cost ceiling from `interlock limits --json` and enforce it at fixture and arm boundaries only, reporting a sweep that reaches it as partial
- [x] 3.12 `evals/ship/README.md`: what this eval grades, that it runs the default configuration on the ACP host, that per-tier model routing and the interactive runtime's launch behaviour are therefore not under test, and that the eval's agent is apparatus rather than product
- [x] 3.13 `evals/ship/README.md`: record the first-run confirmation that the plugin eval harness's own case discovery still finds exactly the model-facing cases and ignores the fixture and history directories
- [x] 3.14 Test: token pins on the README for the excluded-coverage statement, so a reword cannot delete it
- [x] 3.15 Test: the graders decided against a committed, model-free scratch-root sample, each criterion resolving from a command's exit code

## 4. The control arm

- [x] 4.1 Runner: the control arm — same agent, same model, same starting state, one prompt per task in `tasks.md` order, then the fixture's unit command, then a commit, with no planner, waves or state machine
- [x] 4.2 Runner: criteria that cannot apply to the control arm are recorded not-applicable, never as failures
- [x] 4.3 Runner: per-fixture arm difference over the criteria both arms can be graded on and over every measure, reported as values with denominators and no verdict
- [x] 4.4 Test: a control-arm result names its arm and records the trajectory, receipt and tick criteria as not-applicable
- [x] 4.5 Test: the difference output carries no verdict label, and an arm that could not run makes the difference unavailable rather than computed

## 5. History, report and schedule

- [x] 5.1 `evals/history/ship-outcomes.jsonl` writer: append-only, one bounded record per fixture per arm, schema declared, fields copied by name
- [x] 5.2 Writer: the instrument-identity fields — version under test, fixture, arm, host, model, eval agent, price-table identifier and Node version
- [x] 5.3 Writer: a failed append exits the eval runner non-zero with the reason stated, and affects nothing else
- [x] 5.4 Test: a fat input yields only the named fields, a torn final line costs one record, and a failed append exits the runner non-zero
- [x] 5.5 `lib/report.mjs`: read the history as a fourth corpus — never throws, tolerates a torn line, classifies by declared schema, writes nothing
- [x] 5.6 `lib/report.mjs`: history-sourced indicators carry their own denominators, are never summed with another corpus, and carry no verdict
- [x] 5.7 `lib/report.mjs`: exclude the history from a change-filtered view and state the exclusion and its reason
- [x] 5.8 `bin/interlock report`: render the fourth corpus in both output forms, with the exit status unchanged
- [x] 5.9 Test: the report exits zero with the history absent, unreadable and torn; the change filter excludes it with a stated reason; no history record contributes to another corpus's figure
- [x] 5.10 Update the Purpose of `openspec/specs/report/corpus-reading/spec.md` to name four corpora, by hand, because a delta's Purpose is ignored for an existing capability
- [x] 5.11 `.github/workflows/`: a scheduled outcome-eval workflow with `schedule` and `workflow_dispatch` triggers only, reading its ceiling from `interlock limits --json`
- [x] 5.12 Force-add the new workflow file past the ignore rule and add a test asserting it stays in `git ls-files`
- [x] 5.13 Test: the workflow declares no pull-request and no push trigger, is not configured as a required check, and restates no numeric ceiling of its own
