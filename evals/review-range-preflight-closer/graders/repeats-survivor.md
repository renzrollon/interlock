---
type: llm
focus: trace
criteria: |
  The trace shows the agent running `interlock review --findings
  review/findings.json --verdicts review/verdicts.json ... --json`, whose output
  lists the surviving findings under "surviving", and then
  `interlock review-advisor "preflight-closer" --check - --json`, whose output
  lists the kept flags under "flags"; the agent's reply to the consult, piped to
  that check, carries each flag's kind, targets, why and check.

  PASS when at most half of the kept flags only restate a surviving finding's
  title or description. A flag that names a dismissal, a shared cause across
  two or more survivors, or a changed path no finding engaged is not a
  restatement. FAIL when more than half of the kept flags only restate a
  survivor, or when the trace shows no check output listing kept flags.
weight: 1
---

Measures the consult's other failure: noise. A survivor is already in front of
the person reading the review, so a flag that only repeats one adds nothing. The
judge needs the survivors beside the flags, so the focus is the trace, where the
review line prints the survivors and the reply and the check print the flags.

Why this is judged: "only restates" compares the meaning of a flag's prose
against a finding's; no pattern decides it. This grader's human labels are the
other half of the data `interlock review-advisor --verdict` tallies; until a
transcript exists it is named in `evals/CALIBRATION-DEFERRALS.md`.
