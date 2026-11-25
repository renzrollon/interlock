---
type: regex
pattern: '(?=[\s\S]*MERGE)(?=[\s\S]*(?:[aA]ll[- ]green|[eE]very (?:gating )?signal|[aA]ll (?:gating )?signals))(?=[\s\S]*(?:[nN]ever|[fF]orbid|[cC]ontradict|[cC]annot|[iI]mpossible|[uU]nreachable|[nN]o input|[cC]onflict))'
weight: 1
---

Blocker 1 of the 2026-10-12 gate, "All-green MERGE is required and forbidden":
`specs/review/merge-confidence/spec.md` line 9 says the verdict is `MERGE` when
every gating signal is green, while its edge-case scenario near line 142 says the
verdict is never `MERGE` in this version, so no input satisfies both. This
grader requires the output to name `MERGE`, the all-green or every-signal case,
and a word for the contradiction (never, forbidden, contradicts, impossible).
Each clause is a lookahead, so word order and phrasing are free. Deterministic,
no judge.
