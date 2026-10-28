# Proposal

## Why

The `/interlock-settle` and `/interlock-spec` panes are flat columns of grey text: one row after another, bold or dim the only emphasis. A reader cannot see where the review ends and a round begins, which agents are skeptics and which is the fixer, or what the merge-confidence verdict said, without reading every row. The ship meter in the same module already draws bordered cards, theme-key colour and coloured words, so the two panes read as an afterthought beside it. And a settle pass without `--review` draws nothing at all, though it still assesses, labels and publishes.

## What Changes

- The settle meter starts on every `/interlock:settle` load, with or without `--review`. The record keeps which it was, and the pane says so: `with --review` or `without --review`. In a pass without `--review`, a line with no section of its own opens a `resolve` section (the settle skill's §2 word) instead of `review`.
- The settle pane is drawn as cards:
  - a header card;
  - one bordered card per section and per round, the open one's border in the current colour while the run is live;
  - role blocks (dimensions, skeptics, fixer, worker) indented under their section;
  - coloured words: the CLI's exit code, a `STOP:` line, an unread result, and an agent's turn word;
  - the merge-confidence verdict row in its own card, the border and the verdict word coloured by the verdict: `MERGE`, `HUMAN` or `BLOCK`.
- The spec pane is drawn the same way: a header card, then cards titled `artifacts`, `explore`, `gates`, `writes` and `record`. The artifact status words, the fields the gate, ledger, validate and readiness lines printed, `not run yet`, and the checkpoint are coloured by what they mean.
- Every pane line keeps its text exactly as it reads today. The pure modules add structured fields beside the text: a kind, a section, the open mark, coloured spans whose concatenation is the text, and the verdict. The hooks module maps those fields to the person's theme keys and wraps the keyed rows in unkeyed bordered boxes.
- Below the card floor the ship meter publishes (`wave board min width`), both panes draw the same rows flat.
- The status line, toasts, reading rules and end rules are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hooks/settle-meter`: the run starts on any settle load and records whether `--review` was passed; a pass without it groups under `resolve`; the pane draws cards, role blocks, toned words and a verdict card from fields the pure module adds beside unchanged row texts.
- `hooks/spec-meter`: the pane draws a header card and titled section cards, with toned status words, from fields the pure module adds beside unchanged row texts; a row may now carry a tone that names a word the CLI printed.

## Impact

- `lib/settle-meter.mjs`: `settleLoad`, `freshSettle`, `place`, `GROUPS`, `settlePaneLines`.
- `lib/spec-meter.mjs`: `specPaneLines`. It stays import-free.
- `lib/meter-palette.mjs`: a tone-to-props map.
- `hooks/mod.mjs`: `drawSettlePane`, `drawSpecPane`, and the settle load observer.
- Tests: `test/spine/settle-meter.test.mjs`, `test/spine/spec-meter.test.mjs`, `test/mod/settle-meter.test.ts`, `test/mod/spec-meter.test.ts`.
- No new dependency, no new engine call, no new hooked event, no new limit.
