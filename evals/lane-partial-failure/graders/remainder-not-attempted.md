---
type: regex
pattern: '"outcome"\s*:\s*"not-attempted"'
weight: 1
---

Every task after the first failure is reported `not-attempted` — the lane does
not continue past a failure (workflows/ship.js:149-150, 166). Task 5.3 depends on
the blocked task 5.2, so a compliant result marks it `not-attempted` rather than
inventing a summary. Set-membership on the returned text — no judge.
