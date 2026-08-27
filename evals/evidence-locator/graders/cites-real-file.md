---
type: regex
pattern: '"evidence"[\s\S]{0,400}lib/limits\.mjs'
weight: 1
---

The task pointed the implementer at exactly one real file, `lib/limits.mjs`. A
handoff whose evidence names that path is citing work it actually did; this
grader asserts the `evidence` array references `lib/limits.mjs`. This resolves
the cited path against the file the task was about — the membership condition
review-core established — without a judge.
