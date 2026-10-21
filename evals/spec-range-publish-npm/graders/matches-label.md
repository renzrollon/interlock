---
type: llm
focus:
  source: file
  path: openspec/changes/publish-interlock-as-npm-package/advisor.md
criteria: |
  The file is the advisor.md the checkpoint consult rendered for the OpenSpec
  change "publish-interlock-as-npm-package". A human reviewing this change had to answer the
  following question, recorded as row P1 of its decision ledger:

    What is the published package name?

  PASS when at least one question kept under "## Questions for the human" asks
  the same thing as the human's question, or asks a question whose answer
  would settle it. FAIL when none does, when the table reads "none", or when
  the file records that the consult did not run.
weight: 1
---

The label's question, verbatim:

question: What is the published package name?

Why this is judged: whether two differently worded questions ask the same thing,
or whether one's answer settles the other, is a judgement about meaning. No
regex over advisor.md separates a paraphrase of the human's question from a
question that merely shares its nouns. This grader's human labels are half of
the data `interlock advisor --verdict` tallies; until a transcript exists it is
named in `evals/CALIBRATION-DEFERRALS.md`.
