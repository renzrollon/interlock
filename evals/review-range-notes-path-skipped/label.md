# Review Range label: review-range-notes-path-skipped

fix: 133aa8a fix(advisor): address PR #20 review findings
introduced: 590ebae
file: lib/run.mjs:2218
dismissed: A resumed run whose compound notes dedupe as skipped never names compound.md to the commit
bug: `adjudicateReview` names the compound-notes table to the commit only when rows were appended, so a resumed run whose rows all dedupe as skipped under its own run id never names the `docs/notes/compound.md` its first attempt dirtied.

Provenance. The bug is the fourth item of `133aa8a`'s message ("a resumed ship
run whose notes are already in the table, under its own run id, still names
compound.md to the commit brief"); the fixture's `lib/run.mjs` is the file as
`590ebae` shipped it, the commit that added compound notes. The planted review
is authored, not observed: both skeptics dismiss the real finding citing the
commit step's read of `manifest.notesPath` and the notes block's
spoken-never-fatal comment. Both citations resolve to the changed file and pass
the evidence gate, and neither reads line 2218 against a halt that lands before
the manifest persists. The decoy (a throwing `deriveNotes`) is dismissed
correctly on the try/catch, and the prefix-matched policy banners survive.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
