# One-pager: Interlock

## 1. Change log

- 2026-09-08: first draft.

## 2. Problem and outcomes

### 2.1 Who

Engineers who want to improve their agentic coding workflow. They are hiring
Interlock to run a productized version of one engineer's own spec-driven
workflow on Claude Code, instead of assembling a workflow from prompts
themselves.

### 2.2 Problem

Some engineers are still not using spec-driven development at all. Others
prompt or vibe-code their way through implementing code changes, with no
spec between the intent and the code.

Interlock is a Claude Code workflow for spec-driven development, layered on
OpenSpec, where the main human gate separates the "spec" workflow from the
"ship" workflow.

### 2.3 Metrics

| Name | Baseline | Target | Date |
|------|----------|--------|------|
| TBD | unknown | unknown | unknown |

No metric has been named yet. Baselines are `unknown` until measured.

## 3. Strategy bets

### One human gate

The checkpoint between spec and ship is the product. Everything on either
side of that gate runs unattended.

### Gates are code, not prose

Thresholds, bands, and verdicts live in the CLI so a model cannot re-argue
them. A skill reads a limit; it never restates one.

## 4. Roadmap initiatives

### Reviewed specs before the gate

- Serves bet: One human gate
- Intent: explore, propose, and artifact review, so the checkpoint has
  something worth approving.

### Unattended ship runs

- Serves bet: One human gate
- Intent: tasks to commit with no questions asked, stopping loudly when
  something breaks.

### Run inspectability and cost

- Serves bet: One human gate
- Intent: receipts, trajectory, report, and prompt-cache accounting, so a
  run nobody watched can still be reconstructed and priced.

### Guards and evals that prove the gates

- Serves bet: Gates are code, not prose
- Intent: fail-open hooks plus the eval suites that show each gate actually
  fires.

## 5. Risks and open questions

- No metric is named. §2.3 carries a TBD row until one is chosen and a
  baseline measured.
- "Gates are code, not prose" has one initiative; whether review policy in
  the CLI deserves its own is open.

## 6. Delivery

### 6.1 Delivered

<!-- Filled when work lands. -->

### 6.2 In flight

<!-- Pointers to epics and ready tasks, not a second tracker. -->
