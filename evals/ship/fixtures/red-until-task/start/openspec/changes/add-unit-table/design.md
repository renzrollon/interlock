## Context

The suite is red on a committed test, not on a missing file: `parseDuration`
exists and works for the two units it knows. That is the constraint this change
is shaped by — one of its three tasks is the one that turns the suite green, and
the other two can land without changing that fact.

## Decisions

### D1 — Units become a table, and the parser reads it

`UNIT_MS` maps `ms`, `s`, `min` and `h` to milliseconds. `parseDuration` matches
the numeric part and the unit, looks the unit up, and multiplies. Adding a unit
is then an entry in the table rather than a branch in the parser.

*Alternative considered:* extending the existing ternary to a switch. Rejected —
the unit set has to be readable by callers that validate a config before parsing
it, and a switch is not readable.

### D2 — The rejection message keeps the input

Both parsers name the value they could not handle. A parser that throws
"invalid duration" loses the only thing the caller needs to fix the file.

### D3 — `parseList` drops empty entries rather than preserving them

`a,,b,` yields `['a', 'b']`. Trailing and doubled commas are typing accidents in
a hand-written config, not empty values a caller meant.

## Risks / Trade-offs

- Reading `UNIT_MS` at parse time means an unknown unit fails the regex before
  the table is consulted, so the table and the pattern must agree. Accepted:
  the pattern is built from the table's own keys, so they cannot drift.
