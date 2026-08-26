---
type: tool_used
tool: Skill
input_match: spec
max: 0
arm: with-only
weight: 1
---

The discrimination the case is about: an already-reviewed, ready change must not
be routed back into `spec`, which re-plans it. This grader asserts the `spec`
skill was not invoked. Also `arm: with-only` — a skill-invocation assertion is a
plugin-fired indicator, not part of the score.
