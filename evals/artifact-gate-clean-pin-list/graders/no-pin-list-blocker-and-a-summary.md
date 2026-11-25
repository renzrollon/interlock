---
type: regex
pattern: '(?<![\s\S])(?![\s\S]*?(?:(?<![^\n])(?=[^\n]*(?<![nN]ot a )(?<![nN]on-)(?<![nN]o )(?<!NOT A )(?:[bB]locker|BLOCKER))[^\n]*(?:(?:[pP]in(?:ned)? (?:list|assertions?|set)|[lL]ist of (?:pins|pinned)|[tT]est[- ]pins?)[^\n]*(?:[iI]ncomplete|[nN]ot (?:a )?complete|[nN]ot exhaustive|[dD]oes(?:n.t| not) name|[mM]issing|[aA]ll existing|[eE]very existing)|(?:[iI]ncomplete|[nN]ot (?:a )?complete|[nN]ot exhaustive)[^\n]*(?:[pP]in(?:ned)? (?:list|assertions?|set)|[lL]ist of (?:pins|pinned)|[tT]est[- ]pins?))|(?<![^\n])[ \t]*(?:#+[ \t]*)?(?:\*\*|__)?(?:[bB]lockers?|BLOCKERS?)(?:\*\*|__)?[ \t]*(?:\([^\n)]*\))?[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*(?=\n)(?:\n(?![ \t]*(?:#|(?:\*\*|__)?[ \t]*(?:[wW]arnings?|WARNINGS?|[sS]uggestions?|SUGGESTIONS?|[cC]leared|CLEARED|SUMMARY:)))[^\n]*)*?\n(?![ \t]*(?:#|(?:\*\*|__)?[ \t]*(?:[wW]arnings?|WARNINGS?|[sS]uggestions?|SUGGESTIONS?|[cC]leared|CLEARED|SUMMARY:)))[^\n]*(?:(?:[pP]in(?:ned)? (?:list|assertions?|set)|[lL]ist of (?:pins|pinned)|[tT]est[- ]pins?)[^\n]*(?:[iI]ncomplete|[nN]ot (?:a )?complete|[nN]ot exhaustive|[dD]oes(?:n.t| not) name|[mM]issing|[aA]ll existing|[eE]very existing)|(?:[iI]ncomplete|[nN]ot (?:a )?complete|[nN]ot exhaustive)[^\n]*(?:[pP]in(?:ned)? (?:list|assertions?|set)|[lL]ist of (?:pins|pinned)|[tT]est[- ]pins?))))(?=[\s\S]*SUMMARY:)'
weight: 1
---

The false blocker this case encodes: `tasks.md` line 3 of
bound-the-reviewers-by-agent-type states the bounded pin rule and calls its pin
list "the known ones, not a complete list". A blocker that the pin list is
incomplete, or does not name every existing test, is the known false blocker,
and this grader fails on it. A blocker on any other ground does not fail the
case, because a fresh reader of any change can find a real one. Nor does a
mention of the pin list at another severity: a suggestion that the list is
incomplete by design, or a line saying it is not a blocker, is a correct review.

A pin-list claim fails the case in one of two places. On a line that also names
the blocker severity (`BLOCKER tasks.md:3 ...`, a table row whose severity cell
is `blocker`), unless the word is negated (`not a blocker`, `no blockers`,
`non-blocker`). Or inside a blockers section: a line that is only a
`Blockers` heading (`## Blockers`, `**Blockers (1)**`, `Blockers:`), up to
the next heading, the next warnings, suggestions or cleared heading, or the
`SUMMARY:` line.

The pattern opens with `(?<![\s\S])`, which holds only at the very start of the
text, with or without a multiline flag. A bare negative lookahead is true at the
end of the text, and a `^` under a multiline flag holds at every line, so either
would make the answer depend on the flag (design D34); a line start is written
`(?<![^\n])` for the same reason. Every lookbehind is fixed-width. The pattern
then refuses a pin-list blocker anywhere in the output and requires the review's
`SUMMARY:` line, so an output that never reviewed cannot pass. Deterministic, no
judge.
