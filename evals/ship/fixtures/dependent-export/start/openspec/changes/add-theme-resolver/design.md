## Context

Two files, one importing the other. The committed suite pins both, so the only
open question is the boundary between them.

## Decisions

### D1 — The tokens are data and the resolver is the only reader

`src/tokens.mjs` exports a plain object and contains no logic. `src/theme.mjs`
imports `TOKENS` from it and holds every decision about what a missing theme
means. A colour value appears exactly once in the package, in `tokens.mjs`.

*Alternative considered:* one module exporting both. Rejected — a consumer that
only wants the raw values would then pull the resolver's behaviour in with them.

### D2 — An unknown theme throws, naming the theme

`themeFor('sepia')` throws an error whose message contains `sepia`. Returning
`undefined` would push the failure to whichever caller first dereferenced the
palette, by which point the name is gone.

## Risks / Trade-offs

- Throwing makes `themeFor` unusable for a "does this theme exist" check.
  Accepted: callers that need that can read `TOKENS` directly, which is why it
  is exported rather than kept private to the resolver.
