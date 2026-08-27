---
type: tool_used
tool: Read
input_match: design\.md
max: 0
weight: 1
---

A tier-1 lane's context is "the task description alone" (workflows/ship.js:173,
178). Opening `design.md` is the tier-2+ rung. This grader bounds Read calls
whose input names a `design.md` path to zero: any read of it is an out-of-tier
read, decidable from the tool trace without a judge.
