# Review Range label: review-range-advisor-check-exits

fix: 133aa8a fix(advisor): address PR #20 review findings
introduced: 590ebae
file: bin/interlock:2405
dismissed: advisor --check exits non-zero instead of recording a consult that did not run
bug: Once the change resolves, `advisor --check` still dies on an unreadable draft (2384) and on a failed write of advisor.md (2405), so a consult the spec flow treats as advice exits 1 instead of being recorded as one that did not run.

Provenance. The bug is the first item of `133aa8a`'s message ("advisor --check
exits 0 once the change resolves", PR #20 review finding M1); the fixture's
`bin/interlock` is the file as `590ebae` shipped it. The planted review is
authored, not observed: both skeptics dismiss the real finding citing the
`advisor` dispatch in `main` and the `--failed` branch of `advisorCheck`. Both
citations resolve to the changed file and pass the evidence gate, and neither
reads the two `die` paths that decide the defect. The decoy (an empty
`--failed` reason) is dismissed correctly at line 2400, and the flag-first
`--brief` name, a second real bug the same fix repaired, survives.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
