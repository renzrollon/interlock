## Why

`reportkit` can pluralise a count and nothing else. A report that says
"3 files" still has to print the bytes and the elapsed time by hand, so every
caller re-invents the same two formatters and they disagree about rounding. The
README documents one export and the package is about to have four.

## What Changes

- Two new formatters in `src/format.mjs`: `formatBytes` for a byte count and
  `formatDuration` for a millisecond duration, both scaling to one decimal place
  at each threshold.
- A new `src/summary.mjs` exporting `summarize({ bytes, ms })`, which composes
  the two formatters into the one line a report actually prints.
- The README grows an `## API` section naming every export, so the documented
  surface and the real surface match.

## Impact

- **New**: `src/summary.mjs`.
- **Modified**: `src/format.mjs`, `README.md`.
- **Dependencies**: none. The package is stdlib-only and stays that way.
