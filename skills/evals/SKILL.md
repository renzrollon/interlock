---
name: evals
description: Author an Interlock eval case from an observed model-behaviour failure, and read a completed eval results run. Use when you have a reproduced failure — an archived proposal, a changelog entry, a run artifact, or a transcript — worth regression-testing against a real model, or when an eval run has finished and you need to know whether it is a regression, run-to-run variance, or no signal. Authoring needs cited evidence; the verdict comes from `interlock evals triage`, never from your own reading.
license: MIT
compatibility: Requires the early-access eval harness (`claude plugin eval`, enabled with CLAUDE_CODE_WALNUT_SPIRE=1) to RUN a suite. Authoring a case and triaging an existing results file need only Node.js >= 18 and the bundled interlock CLI.
allowed-tools: Bash(interlock *) Bash(claude plugin eval *) Read Grep Glob Write
metadata:
  type: authoring
  outputs:
    - evals/<case>/case.yaml
    - evals/<case>/graders/*.md
---

This skill covers the two jobs the eval harness does not do for you: turning an
observed failure into a case, and reading a finished run. Everything with a
correct answer — is this a regression? — belongs to `interlock evals triage`, not
to you. Your job is evidence, grader choice, and explanation.

## 1. Authoring a case — only from an observed failure

A case regression-tests a **reproduced** failure: a model read correct
instructions and did the wrong thing anyway. Before you write anything, require
the evidence:

- an archived proposal (`openspec/changes/archive/*/proposal.md` `## Why`),
- a `CHANGELOG.md` entry,
- a run artifact or a transcript, or
- a `file:line` span in the prompt or skill under test that shows the surface
  the model talked past.

**If no observed failure is offered, say so and stop.** Do not author a
speculative case. A suite of hypotheticals teaches the team to ignore it, which
is the one thing an advisory gate cannot survive. A case that only duplicates an
existing `node:test` assertion is refused for the same reason — the unit suite
already covers it deterministically.

Record the citation in the case (`provenance:` in `case.yaml`, plus a comment
explaining what went wrong). The structural gate `test/evals.test.mjs` fails a
case with no provenance.

### The case files

Every case pins `schema_version` and lives in its own directory under `evals/` —
never under `skills/`, `agents/`, `commands/` or `workflows/`, which would shadow
a component. Follow `evals/handoff-status-enum/` as the format exemplar; it was
written to establish these conventions. Where a case needs a fixture workspace,
use `case.yaml` with `context.scaffold_script` and run with `--scaffold`;
otherwise the same `case.yaml` shape without it.

## 2. Choosing a grader — cheapest that expresses the assertion

The harness has six grader types. Four are free and deterministic — `regex`,
`tool_used`, `tool_order`, `file_exists` — and two call a judge — `llm`,
`baseline`.

**Pick the cheapest grader that expresses the assertion.** If the assertion is
set-membership, tool-invocation, file-existence, or ordering shaped, it is
deterministic and a judged grader is the wrong tool — more expensive, and prone
to run-to-run variance triage will (correctly) refuse to call a regression. The
strongest seed case, `handoff-status-enum`, needs no judge at all: the status is
in a fixed set, so a `regex` decides it.

**When you do reach for a judged grader, state in the grader body which part of
the assertion could not be expressed deterministically.** If you cannot name
that part, the assertion was deterministic and you chose the wrong grader.

A case you intend to run per-pull-request tag `smoke`, and a smoke case uses
**only** deterministic graders — the gate enforces this. A grader that asserts a
skill *fired* (`tool_used: Skill`) is marked `arm: with-only`: it is a
plugin-fired indicator, reported against the baseline arm, not part of the score.

## 3. Reading a run — triage owns the verdict

Given a finished results file, **get the classification from
`interlock evals triage --results <file>`, do not derive it yourself.** Its exit
code is the verdict: `0` pass, `1` regression, `2` no signal, `3` configuration.
This is deliberate — the one gate whose rule a model could re-argue on each run
would be exactly the wrong gate to ship in a suite built to catch models
re-arguing rules.

Your contribution is **explanation, not classification**:

- When triage reports a **regression**, explain which recent change to the
  surface under test plausibly caused it — the prompt sentence, the skill edit,
  the contract change. Do not reclassify it as variance because it looks flaky;
  triage already separated a single judged dip (variance) from a judged majority
  (regression).
- When triage reports **variance**, report it as variance and say what would
  confirm it (further runs failing the same judged grader).
- When triage reports **no signal** — a partial run, an interrupted run, a
  rejected credential — report that evals could not run. Do not present any case
  as passing or failing.

Never restate, override, or soften a verdict triage gave you.

## 4. A failing case is a report, never a prompt edit

When a case fails, your output is a report: the case, the grader that failed, and
the sentence in the surface under test that plausibly caused it. **Do not edit
the skill, shared contract, agent definition, or prompt under test to make a case
pass.** Changing the surface under test is a separate, explicit decision the user
makes — silently editing a prompt to turn a case green is exactly the "edit the
test until it passes" failure the suite exists to prevent, one layer up.

## 5. When the harness is gated

`claude plugin eval` prints `` `plugin eval` is currently in early access `` and
does nothing until `CLAUDE_CODE_WALNUT_SPIRE=1` is set in the environment — never
in committed `.claude/settings.json`, which would produce a suite that looks
configured and does not run.

When the harness refuses because early access is not enabled, **report the
prerequisite and where to set it** (the environment, or the CI job's `env:`
block). Do not report an empty run as a passing suite. Authoring a case and
triaging an existing results file both work without the harness enabled — only
running a suite needs it.
