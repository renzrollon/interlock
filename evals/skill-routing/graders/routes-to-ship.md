---
type: tool_used
tool: Skill
input_match: ship
min: 1
arm: with-only
weight: 1
---

The plugin-fired indicator: "implement this change" should reach the `ship`
skill. This grader asserts the Skill tool was invoked for `ship` at least once.
It is marked `arm: with-only`, so it is reported as an indicator that the plugin
fired rather than counted in the score — the case-suite spec requires
skill-invocation assertions to be indicators, so the baseline arm establishes
that the plugin, not the base agent, caused the routing.
