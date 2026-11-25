---
type: regex
pattern: '(?=[\s\S]*conformance\.delta)(?=[\s\S]*(?:[nN]o (?:requirement|spec|scenario|delta)|[nN]ot (?:specified|covered|defined|described|named)|[wW]ithout (?:a )?(?:requirement|spec|scenario)|[uU]nspecified|[mM]issing|[aA]bsent|[nN]o living))'
weight: 1
---

Blocker 3 of the 2026-10-12 gate: `design.md` D6 (near line 85) defines the
`conformance.delta` signal, but no requirement in the delta specs states it
(`spec.md` has only the living-conformance signal, and the section near line 269
names none). This grader requires the output to name `conformance.delta` together
with a word for its being absent from the specs. Deterministic, no judge.
