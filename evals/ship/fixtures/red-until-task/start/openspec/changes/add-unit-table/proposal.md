## Why

`parseDuration` understands `ms` and `s`, and its unit handling is a ternary
inside the parser. Config files in the wild already carry `5min` and `2h`, and
the committed suite pins both — so the package ships a failing test today. The
same file needs a list parser, which callers currently write by hand and get
wrong on trailing commas.

## What Changes

- A unit table in `src/units.mjs` exporting `UNIT_MS`, mapping every duration
  unit to its length in milliseconds.
- `parseDuration` rewritten to read that table instead of branching, which is
  what makes `5min` and `2h` parse and turns the committed failing test green.
- A `parseList` export in `src/parse.mjs` for comma-separated values, trimming
  each entry and dropping empty ones.

## Impact

- **New**: `src/units.mjs`.
- **Modified**: `src/parse.mjs`.
- **Dependencies**: none.
