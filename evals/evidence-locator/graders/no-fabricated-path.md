---
type: regex
pattern: 'nowhere'
match: not_contains
weight: 1
---

The exact fabrication the provenance case records: `lib/nowhere.ts:1`, a path
that never existed yet passed shape validation. This grader asserts the response
does not cite a `nowhere` path — the specific invented locator from the archived
proposal. Deterministic, no judge.
