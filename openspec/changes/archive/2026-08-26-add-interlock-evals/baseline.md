# Eval baseline — add-interlock-evals

## Status: DEFERRED (no model credential provisioned)

The first smoke-suite baseline run (task 4.1) has **not** been recorded, because
this environment has no model credential and no early-access enablement:

- `CLAUDE_CODE_WALNUT_SPIRE` is unset.
- No `ANTHROPIC_API_KEY` is present.

This is the path the change was deliberately built to survive (design D12): the
suite, its structural gate and its triage subcommand all land and run offline,
and the metered run becomes a configuration action rather than a prerequisite for
merging. Recording invented scores would be worse than recording none.

## Verified offline (task 4.1's non-metered half)

- `npm test` — **1171 pass, 0 fail** (includes the new `test/spine/evals-triage.test.mjs`
  and `test/evals.test.mjs` structural gate over `evals/**`).
- `claude plugin validate . --strict` — **passed**.
- `interlock limits --json` publishes the eval caps (`smokeCostUsd`,
  `fullRunCostUsd`, `runsPerCase`, `reportingThreshold`).

## How to record the baseline once a credential exists

```bash
export CLAUDE_CODE_WALNUT_SPIRE=1
CEIL=$(interlock limits --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).evals.smokeCostUsd))')
claude plugin eval . --tag smoke --runs 1 --ablation none --no-publish \
  --max-cost-usd "$CEIL" --json evals-results.json
interlock evals triage --results evals-results.json
```

Then paste the per-case scores below as the first observed baseline. **Do not
tune a threshold from a single run** (design D3): the gate stays advisory until
run-to-run variance is observed across more than one run.

### Smoke cases in scope

- `handoff-status-enum` — handoff `status` ∈ {ok, blocked, partial}
- `tier-read-scope` — a tier-1 lane reads neither design.md nor the delta specs
- `cited-cap-resolution` — the implementer resolves the char cap via `interlock limits`
- `control-plane-action` — a ping copies the CLI's `action`, never inventing one

### Observed scores

_(none yet — run pending credential provisioning)_
