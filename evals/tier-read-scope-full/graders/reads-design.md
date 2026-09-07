---
type: tool_used
tool: Read
input_match: design\.md
min: 1
weight: 1
---

A tier-4 lane's context is "design.md and the specs in full"
(workflows/ship.js:177). This grader requires at least one Read whose input names
a `design.md` path — the exact assertion its sibling `tier-read-scope` bounds to
zero for tier 1.

The pair is why the bound has to run in both directions. `max: 0` on the tier-1
side passes for an agent that opened nothing at all; only the `min: 1` on this
side distinguishes an implementer that honoured its tier from one that read
nothing and guessed. Set-membership on the tool trace — no judge, so it is
trustworthy on a single run and the case is tagged `smoke` on that basis.
