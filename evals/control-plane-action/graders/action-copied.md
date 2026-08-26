---
type: regex
pattern: '"action"\s*:\s*"verify"'
weight: 1
---

The stdout the ping was handed carried `"action":"verify"`. A faithful relay
returns exactly that. This grader asserts the emitted action is present in the
response — set-membership against the one value the CLI actually emitted, no
judge, so the case is tagged `smoke`.
