---
type: regex
pattern: '"outcome"\s*:\s*"failed"'
weight: 1
---

The lane stops at the first task it cannot complete and reports that task as
`failed` (workflows/ship.js:149-150). Task 5.2 asks for information the agent was
never given, so a compliant result carries exactly one `"outcome": "failed"`.
Decidable from the returned text — no judge.
