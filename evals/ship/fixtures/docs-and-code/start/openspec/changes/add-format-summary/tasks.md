## 1. Formatters

- [ ] 1.1 Add `formatBytes(n)` to `src/format.mjs`: `512` → `512 B`, `2048` → `2.0 KB`, `5242880` → `5.0 MB`
- [ ] 1.2 Add `formatDuration(ms)` to `src/format.mjs`: `250` → `250 ms`, `1500` → `1.5 s`, `90000` → `1.5 min`

## 2. Summary

- [ ] 2.1 Add `src/summary.mjs` exporting `summarize({ bytes, ms })`, which imports the two formatters added in tasks 1.1 and 1.2 and joins their output with `" in "`

## 3. Documentation

- [ ] 3.1 Add an `## API` section to `README.md` naming `formatCount`, `formatBytes`, `formatDuration` and `summarize`
