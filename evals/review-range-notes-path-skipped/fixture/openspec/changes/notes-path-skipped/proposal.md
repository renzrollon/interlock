## Why

The surprises a review finds about a repository's own invariants, a sibling reader missed or a convention no spec stated, die with the findings file, and the next change on the same files starts from zero. A per-repository table of compound notes keeps one row per surprise and the rule it implies, derived from surviving findings marked `specGap`.

## What Changes

- `docs/notes/compound.md` holds the notes table under a contract in `shared/COMPOUND-NOTES.md`.
- The ship loop's review adjudication derives rows from the surviving findings that carry `specGap: true`, appends them non-fatally and dedupes rows already present.
- When the table was written, the commit briefing names it so the commit carries it.
- The diff under review is `lib/run.mjs`: `adjudicateReview` and the commit step.

## Impact

- `lib/run.mjs`: the notes write beside the review metrics, and `notesPath` on the manifest.
