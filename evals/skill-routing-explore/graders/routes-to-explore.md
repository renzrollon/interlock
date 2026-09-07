---
type: tool_used
tool: Skill
input_match: explore
min: 1
weight: 1
arm: with-only
---

The plugin-fired indicator: a blast-radius reconnaissance request should reach
the `explore` skill. This grader asserts the Skill tool was invoked for `explore`
at least once.

`arm: with-only`, like every skill-invocation assertion in this suite — the
case-suite spec requires them to be reported as indicators rather than counted in
the score, so the baseline arm establishes that the plugin, not the base agent,
caused the routing.
