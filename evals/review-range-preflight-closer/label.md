# Review Range label: review-range-preflight-closer

fix: cb6313a fix(skills): narrow the preflight closer and tell a broken openspec from a missing one
introduced: fea376c
file: hooks/preflight.mjs:148
dismissed: The preflight closer warns users off spec and bootstrap when only ship is blocked
bug: The session-start closer tells the user to apply the fixes before `/interlock:spec`, `/interlock:bootstrap` or `/interlock:ship` whatever check failed, though only an openspec or binaries failure stops spec and bootstrap; a test-profile, allowlist or git failure holds back ship alone.

Provenance. The bug is the first item of `cb6313a`'s message ("session-start
closer names /interlock:spec and /interlock:bootstrap only when an openspec or
binaries check fails"); the fixture's `hooks/preflight.mjs` is the file as
`fea376c` shipped it, which is where that commit made the closer name spec and
bootstrap. The planted review is authored, not observed: both skeptics dismiss
the real finding citing the block's header and per-check lines and the
fail-only filter. Both citations resolve to the changed file and pass the
evidence gate, and neither reads line 148 against which checks fail: a missing
test profile is a `fail` in the doctor, so the closer fires on it. The decoy
(unparseable doctor output) is dismissed correctly at 100-112, and the trimmed
fix indentation survives.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
