---
type: llm
focus:
  source: file
  path: openspec/changes/doctor-openspec-probe/review-advisor.md
criteria: |
  The file is the review-advisor.md the review-code findings consult rendered
  for the OpenSpec change "doctor-openspec-probe". The review's skeptics dismissed
  a finding that was a real bug, later fixed by commit cb6313a. Its title was:

    doctor reports openspec ok when its version probe returns nothing

  PASS when at least one flag kept under "## Flags" has kind dismissal-doubt and
  targets the dismissal with that title (the targets column names the id with
  the title beside it). FAIL when none does, when the flags table reads "none",
  or when the file records that the consult did not run.
weight: 1
---

The label's dismissed title, verbatim:

dismissed: doctor reports openspec ok when its version probe returns nothing

Why this is judged: the rendered table names a target by its id and title, and
the flag's `why` must be read to tell a doubt aimed at this dismissal from a
table that happens to list it. A pattern over the id alone would pass a flag
whose reasoning is about something else. This grader's human labels are half of
the data `interlock review-advisor --verdict` tallies; until a transcript exists
it is named in `evals/CALIBRATION-DEFERRALS.md`.
