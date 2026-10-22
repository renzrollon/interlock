# Review Range label: review-range-doctor-openspec-probe

fix: cb6313a fix(skills): narrow the preflight closer and tell a broken openspec from a missing one
introduced: fea376c
file: lib/doctor.mjs:581
dismissed: doctor reports openspec ok when its version probe returns nothing
bug: `checkOpenSpec` reports the openspec check `ok` when the CLI is on PATH but `openspec --version` returns nothing, though `/interlock:spec` and `/interlock:bootstrap` stop at that same probe.

Provenance. The bug is the doctor item of `cb6313a`'s message ("doctor warns
when openspec is on PATH but its version probe does not run, instead of reporting
ok while the skills stop"); the fixture's `lib/doctor.mjs` is the file as
`fea376c` shipped it. The planted review is authored, not observed: both
skeptics dismiss the real finding citing `probeVersion`'s "best-effort,
non-gating" docstring and the evidence line that says the probe returned
nothing. Both citations resolve to the changed file and pass the evidence gate,
and neither weighs that the status at 582-588 is still `ok` while the skills
`fea376c` added stop at the same probe. The decoy (a missing CLI in a
configured project) is dismissed correctly on the `warn` at 594-598, and the
discarded stderr survives.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
