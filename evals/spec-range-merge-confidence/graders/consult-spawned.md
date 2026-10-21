---
type: tool_used
tool: Agent
input_match: interlock:advisor
min: 1
max: 1
weight: 1
arm: with-only
---

The plugin-fired indicator: one Agent spawn of `interlock:advisor`, exactly
once, because the consult is never retried. `arm: with-only`, so it is
reported against the baseline arm rather than counted in the score; the
baseline has no advisor agent to spawn.
