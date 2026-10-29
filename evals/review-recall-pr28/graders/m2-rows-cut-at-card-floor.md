---
type: regex
pattern: '(?=[\s\S]*[cC]ard)(?=[\s\S]*(?:[fF]loor|48-col|48 col|[mM]inimum width|[nN]arrow))(?=[\s\S]*(?:(?:[tT]runc[a-z]*|[cC]ut|[cC]lipp[a-z]*|[lL]ose|[lL]ost|[dD]rops?|[dD]ropped|[eE]llips[a-z]*)[^.]{0,120}(?:[rR]eason|[rR]ows?|[wW]ord)|(?:[rR]eason|[rR]ows?|[wW]ord)[^.]{0,120}(?:[tT]runc[a-z]*|[cC]ut|[cC]lipp[a-z]*|[lL]ose|[lL]ost|[dD]rops?|[dD]ropped|[eE]llips[a-z]*)))'
weight: 1
---

M2 (comment 6471559316): at the 48-column card floor the card border, padding and
agent gutter take 13-15 columns, so `truncate-end` cuts the reason word off compact
agent rows. This grader requires the output to name the cards, the floor (or a
narrow width), and a row or its reason being truncated or cut, in any order.
Deterministic, no judge.
