---
type: llm
focus: trace
criteria: |
  The trace shows the agent reading openspec/changes/harden-substantive-gates/proposal.md,
  design.md and tasks.md, then running
  `interlock advisor "harden-substantive-gates" --check ... --json`, whose output lists the
  kept questions under "questions".

  PASS when at most half of the kept questions are answered in so many words
  by proposal.md, design.md or tasks.md as read in the trace. FAIL when more
  than half restate something those artifacts already answer, or when the
  trace shows no check output listing kept questions.
weight: 1
---

Measures the consult's other failure: questions a reader of the artifacts
already has the answer to. The judge needs the artifacts beside the questions,
so the focus is the trace, where the case prompt has the agent read the three
artifacts first, as the spec session that wrote them would hold them in
context, and where the check line prints the kept questions.

Why this is judged: "answered in so many words" compares the meaning of a
question against prose; no pattern decides it. This grader's human labels are
the other half of the data `interlock advisor --verdict` tallies; until a
transcript exists it is named in `evals/CALIBRATION-DEFERRALS.md`.
