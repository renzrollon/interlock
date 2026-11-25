---
type: regex
pattern: '(?=[\s\S]*(?:[tT]ypecheck|[tT]ype[- ]check))(?=[\s\S]*(?:suite signal|verify\.suite|haltingKinds|verify\.halt|[fF]inal (?:verdict|context|verification|judge)|[fF]inal))(?=[\s\S]*(?:[nN]ever|[oO]nly|[cC]annot|[dD]oes(?:n.t| not)|[mM]iss|[iI]gnor|[uU]nread|[sS]ilently|[dD]rop))'
weight: 1
---

Blocker 4 of the 2026-10-12 gate: `design.md` D6 (near line 85) reads the suite
signal from `verify.halt` through `haltingKinds`, and the final verification
context halts only on the unit result, so a failed final typecheck never reaches
the suite signal. This grader requires the output to name the typecheck, the final
verdict or the suite signal, and a word for its not being read (never, only,
cannot, does not, ignored). Deterministic, no judge.
