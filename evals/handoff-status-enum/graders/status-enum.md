---
type: regex
pattern: '"status"\s*:\s*"(ok|blocked|partial)"'
weight: 1
---

Set-membership, not judgment: the returned handoff packet must carry a
`status` field whose value is exactly one of `ok`, `blocked`, or `partial` —
the three states `interlock.wave-handoff/1` defines. This is the assertion the
provenance case failed: a live run reported `"status": "done"`, a value the
enum does not contain, and nothing rejected it.

The pattern matches the packet as emitted in the final message. No judge is
involved — the answer is decidable from the text, so a deterministic grader is
both cheaper and more reliable than an LLM one, and this case is tagged `smoke`
on that basis.
