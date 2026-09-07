## Why

`themekit` is an empty package with a committed test suite and no source. The
palette values exist only in the suite's expectations, so nothing can consume
them, and there is no way to ask for "the dark theme" by name.

## What Changes

- A token table in `src/tokens.mjs` exporting `TOKENS`, holding the `light` and
  `dark` palettes as the single place a colour value is written down.
- A resolver in `src/theme.mjs` exporting `themeFor(name)`, which reads `TOKENS`
  and returns the named palette with its name attached, and which names the
  theme it could not resolve rather than returning undefined.

## Impact

- **New**: `src/tokens.mjs`, `src/theme.mjs`.
- **Dependencies**: none.
