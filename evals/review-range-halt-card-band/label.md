# Review Range label: review-range-halt-card-band

fix: 29ede89 fix(meter): stop halt resume cards holding the session-start band
introduced: 4c66f1e
file: lib/preflight-file.mjs:126
dismissed: Any listed halt resume card holds the session-start band
bug: `shouldDraw` draws the session-start band for any listed halt resume card, and a card stays on disk until its change is archived, so one halted run holds the band at every session start with nothing to fix.

Provenance. The bug is the first item of `29ede89`'s message ("The
AbovePrompt band no longer draws for a halt resume card or lists one"); the
fixture's `lib/preflight-file.mjs` is the file as `4c66f1e` shipped it, and it
is unchanged up to `29ede89^`. The planted review is authored, not observed:
both skeptics dismiss the real finding citing `cardsOf`'s filtering and
`bandLines`' docstring. Both citations resolve to the changed file and pass the
evidence gate, and neither weighs line 126 against a card's lifetime: a listed
card is one whose change is not archived yet, so it draws the band at every
session start until then. The decoy (a card with no `writtenAt`) is dismissed
correctly on the `NaN` guard, and the strict schema stamp survives.

`graders/matches-label.md` judges whether the rendered review-advisor.md keeps
a `dismissal-doubt` on the dismissal titled above.
