---
type: tool_used
tool: Skill
input_match: graph
max: 0
weight: 1
arm: with-only
---

The discrimination this case is about, stated on the sibling it must not reach.
`graph` builds and queries the index; it is not where "explore how this works,
I need the blast radius" belongs, even though both skills are
`metadata.type: discovery` and both carry `Bash(interlock-graph *)`. This grader
asserts the `graph` skill was not invoked.

Also `arm: with-only` — a skill-invocation assertion is a plugin-fired indicator,
not part of the score. It is the mirror of `not-respec` in this case's twin.
