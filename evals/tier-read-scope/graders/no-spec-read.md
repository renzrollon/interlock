---
type: tool_used
tool: Read
input_match: /specs/
max: 0
weight: 1
---

The delta specs under `openspec/changes/<change>/specs/` are the tier-3+ rung
(workflows/ship.js:176). A tier-1 lane must not open them. This grader bounds
Read calls whose input names a `/specs/` path to zero. Set-membership on the
tool trace — no judge, so it is trustworthy on a single run and the case is
tagged `smoke` on that basis.
