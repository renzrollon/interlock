## 1. Units and parsers

- [x] 1.1 Add `src/units.mjs` exporting `UNIT_MS`, mapping `ms` to 1, `s` to 1000, `min` to 60000 and `h` to 3600000
- [x] 1.2 Rewrite `parseDuration` in `src/parse.mjs` to read the table added in task 1.1 instead of branching on the unit, so that `5min` and `2h` parse, and keep naming the value it could not parse
- [x] 1.3 Add `parseList(text)` to `src/parse.mjs`: split on commas, trim each entry, drop empty entries
