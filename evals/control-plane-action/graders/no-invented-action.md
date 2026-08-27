---
type: regex
pattern: '"action"\s*:\s*"report"'
match: not_contains
weight: 1
---

The exact failure this case reproduces: a ping that emitted `action: "report"`,
a value the CLI never produces (CHANGELOG.md:163-170). This grader asserts the
response does not name `report` — the specific fabrication that happened in
production. Deterministic, no judge.
