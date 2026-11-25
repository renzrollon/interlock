---
type: regex
pattern: '(?=[\s\S]*[uU]nobserved)(?=[\s\S]*[aA]mber)(?=[\s\S]*(?:[nN]o result|[mM]issing result|[nN]o (?:final )?verdict|reported no|[nN]ot (?:been )?(?:run|produced)|[nN]ever ran))(?=[\s\S]*(?:[bB]locking kind|[pP]lanned verification|[sS]uite))'
weight: 1
---

Blocker 2 of the 2026-10-12 gate: a blocking kind that was planned and has no
result is `unobserved` in the "missing result" requirement and its scenario
(`spec.md` near line 103), and `amber` in the suite signal's requirement ("amber
when a blocking kind was skipped or reported no result", and design D3). This
grader requires the output to put `unobserved` and `amber` together with a
blocking kind or the suite and a missing result. Deterministic, no judge.
