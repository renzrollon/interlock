---
type: tool_used
tool: Bash
input_match: interlock limits
min: 1
weight: 1
---

The briefing cites `interlock limits` for the cap rather than stating it
(workflows/ship.js:194-195). A model that resolves the cap correctly runs the
command; a model that invents the number never does. This grader asserts a Bash
call whose command names `interlock limits` was actually made — tool-invocation
shaped, so no judge, and the case is `smoke` on that basis.

Requires the operator grant `--allow-tools Bash` when the suite runs, which the
CI job supplies.
