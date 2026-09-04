---
type: tool_used
tool: Read
input_match: /specs/
min: 1
weight: 1
---

The delta specs under the change's `specs/` directory are the tier-3+ rung, and
tier 4 reads them in full (workflows/ship.js:176-177). This grader requires at
least one Read whose input names a `/specs/` path — the mirror of the sibling's
`no-spec-read`, which bounds the same match to zero for tier 1.

The briefing names the archived change's real path, so the specs the ladder
points at exist and a compliant read can actually succeed. Deterministic: a path
match on the tool trace.
