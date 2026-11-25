---
type: regex
pattern: '(?=[\s\S]*(?:lane-results|[sS]hared (?:JSON )?(?:file|ledger)|[sS]ame (?:JSON )?(?:file|ledger)|[oO]ne (?:shared )?(?:JSON )?(?:file|ledger)|[sS]ingle (?:shared )?(?:JSON )?(?:file|ledger)))(?=[\s\S]*(?:[cC]oncurren|[pP]arallel|[rR]ace|[sS]imultaneous|[iI]nterleav))(?=[\s\S]*(?:[lL]ost update|[lL]ose an update|[lL]oses? (?:an? |its |their )?(?:update|entr|result|write)|[oO]verwrit|[cC]lobber|[lL]ast[- ]writer|[rR]ead-modify-write|[cC]orrupt))'
weight: 1
---

The seeded hazard in `design.md` (seed.patch, decision D20): every parallel lane
reads `.claude/ship/bound-the-reviewers/lane-results.json`, adds its own entry
and writes the whole file back, so two lanes that finish together lose one
another's entry. This grader requires the output to name the shared file (by its
name, or as one shared file or ledger), parallel or concurrent writers, and a
lost update (overwrite, clobber, last writer, read-modify-write). Each clause is
a lookahead, so word order and phrasing are free. Deterministic, no judge.
