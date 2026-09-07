## 1. Tokens and resolver

- [x] 1.1 Add `src/tokens.mjs` exporting `TOKENS` with exactly two palettes: `light` (`bg` `#ffffff`, `fg` `#111111`) and `dark` (`bg` `#111111`, `fg` `#ffffff`)
- [x] 1.2 Add `src/theme.mjs` exporting `themeFor(name)`, which imports `TOKENS` from the module added in task 1.1, returns the named palette with `name` attached, and throws an error naming the theme when it is unknown
