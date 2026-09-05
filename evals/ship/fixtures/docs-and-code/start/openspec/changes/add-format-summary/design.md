## Context

`src/format.mjs` holds one export, `formatCount`. The test suite already pins
the behaviour of everything this change adds, so the shape is not open: the
tests are the specification and they are committed.

## Decisions

### D1 — One decimal place at every scale above the base unit

`formatBytes(2048)` is `"2.0 KB"`, not `"2 KB"`. A fixed decimal keeps columns
aligned in a report, which is the only place these strings are used.
Thresholds are 1024 and 1024², and the base unit prints as an integer (`512 B`).

`formatDuration` follows the same rule at 1000 and 60000: `250 ms`, `1.5 s`,
`1.5 min`.

### D2 — `summarize` composes rather than reimplements

`summarize` imports both formatters and joins them with `" in "`. It does no
formatting of its own, so a rounding change lands in one place. This is why it
cannot be written before the formatters exist.

### D3 — The README's `## API` section is part of the change, not a follow-up

The suite asserts the section exists and names every export, so documentation
that lags the code is a red suite rather than a note in a backlog.

## Risks / Trade-offs

- Fixed one-decimal output is lossy for very large values. Accepted: these
  strings are for a human reading a report, and the caller still has the number.
