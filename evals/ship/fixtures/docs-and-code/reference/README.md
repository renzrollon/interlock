# reportkit

Small formatting helpers for the numbers a report prints: counts, byte sizes and
durations.

## Install

Nothing to install. Node >= 18, stdlib only.

## Test

```sh
npm test
```

## API

- `formatCount(n, unit)` — a count with its unit, pluralised: `3 files`.
- `formatBytes(n)` — a byte count: `512 B`, `2.0 KB`, `5.0 MB`.
- `formatDuration(ms)` — a millisecond duration: `250 ms`, `1.5 s`, `1.5 min`.
- `summarize({ bytes, ms })` — both of the above on one line: `2.0 KB in 1.5 s`.
