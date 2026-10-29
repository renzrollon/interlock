---
type: regex
pattern: '(?=[\s\S]*(?:(?:[oO]nly|[sS]ole|[sS]olely)[^.]{0,120}(?:[dD]rift)|(?:[dD]rift)[^.]{0,120}(?:[oO]nly|[sS]ole|[sS]olely)))(?=[\s\S]*(?:(?:[rR]un|[pP]ass|[pP]ane)[^.]{0,160}(?:[eE]nds?|[eE]nded|[sS]tuck|[sS]tays|[nN]ever|[rR]emains?|[lL]ingers)|(?:[eE]nds?|[eE]nded|[sS]tuck|[sS]tays|[nN]ever|[rR]emains?|[lL]ingers)[^.]{0,160}(?:[rR]un|[pP]ass|[pP]ane)))'
weight: 1
---

M1 (comment 6471559316): every settle load now starts a live run, but only the
drift line ends one, so a pass that stops at "no open pull request" never
reaches drift and the pane stays open. This grader requires the review's output
to say that the drift line is the only (or sole) thing that ends the settle run,
and to speak of the run or pane failing to end. Both clauses are lookaheads, so
word order and phrasing are free. Deterministic, no judge.
