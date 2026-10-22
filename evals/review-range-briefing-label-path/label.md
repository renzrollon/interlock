# Review Range label: review-range-briefing-label-path

fix: be8a234 fix(ci): stop fork runs from rolling back the release branch
introduced: 82b1981 (be8a234^)
file: lib/run.mjs:1156
dismissed: writeBriefing joins an unchecked lane label into the briefing path
bug: `writeBriefing` joins a lane label built from the task ids the planner returned into the briefing path with no shape check, so a label carrying a separator or a leading dot writes outside `.claude/ship/briefings/`.

Provenance. The bug is the briefing item of `be8a234`'s message ("Keep
every briefing inside .claude/ship/briefings/: a label carrying a separator or
leading dot is cleaned and hash-suffixed"); the fixture's `lib/run.mjs` is the
file as `be8a234^` (`82b1981`) held it. The planted review is authored, not
observed: both skeptics dismiss the real finding citing `laneWorktreePath`'s
sanitiser and the `spawn` helper. Both citations resolve to the changed file and
pass the evidence gate, and neither reads line 1156, where the briefing path is
joined from the raw label: the sanitiser guards the worktree path only. The decoy
(a missing briefings directory) is dismissed correctly on the recursive
`mkdirSync`, and the in-place write survives.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
