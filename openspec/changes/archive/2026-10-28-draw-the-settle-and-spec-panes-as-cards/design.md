# Design

## Context

The explore brief `.claude/handoff/explore-draw-the-settle-and-spec-panes-as-cards-20261028-105230.md` holds the findings. In short:

- `drawSettlePane` (`hooks/mod.mjs:1168`) and `drawSpecPane` (`hooks/mod.mjs:1157`) draw one `Box{key} > Text` per line of `settlePaneLines` (`lib/settle-meter.mjs:1440`) or `specPaneLines` (`lib/spec-meter.mjs:566`). Bold and dim are their only props.
- The ship meter in the same module already draws `borderStyle: 'single'` cards with `borderColor` or `borderDimColor`, nested coloured spans in one `Text`, and theme keys from `lib/meter-palette.mjs` (`hooks/mod.mjs:1940-2000`, `lib/meter-palette.mjs:3-9`).
- Tests on both panes read rows by `text` and by `key`:
  - `section()` / `headingAt()` need a heading's text to start with the section word and carry a clock;
  - the header is `rows[0]`;
  - an empty pane is exactly one Text;
  - the mod tests read every Box whose `key` is a string.
- `settleLoad` (`lib/settle-meter.mjs:169`) starts a run only on `--review`. A pass without it reaches `merge confidence`, `publish` and `drift`. Its one null-target line, `interlock changes` (`skills/settle/SKILL.md:61`), would open `review` through `place()` (`lib/settle-meter.mjs:528`).

Ledger rows: D1 (keep texts), D2 (single border), D3 (tones are meanings), D4 (start without `--review`, `resolve`), D5 (reuse the card floor), D6 (no glyphs), D7 (every choice taken here, no question asked, per the user's instruction).

## Goals / Non-Goals

**Goals:**
- Both panes read as cards: sections, rounds and role blocks are visible at a glance, and the verdict is unmissable.
- The settle meter draws a pass with or without `--review`.
- Every row text, status line, toast and reading rule stays as it is.

**Non-Goals:**
- No change to the status line, which is one plain engine line and takes no colour.
- No change to what any line reads, how a compound command is cut, or when a run ends.
- No new limit, engine call, hooked event, timer or dependency.
- The ship meter's pane is untouched.

## Decisions

### D1. Keep every text; add fields beside it

`settlePaneLines` and `specPaneLines` keep returning `{ key, text, bold?, dim? }` with the same keys and texts in the same order, except the one added settle line in D5. They add:

| field | settle | spec | meaning |
|---|---|---|---|
| `kind` | `none` `header` `mode` `heading` `row` `role` `agent` `verdict` `done` `banners` `banner` | `none` `title` or absent | what the line is |
| `group` | index into `settle.groups` on `heading`/`row`/`role`/`agent`/`verdict` | — | which card it sits in |
| `open` | `true` on the heading of the open group while the run is live | — | the card to mark |
| `depth` | `1` on a `role` line; `2` on an agent row under a role; `1` on an agent row with no role line | — | indentation, applied as layout |
| `verdict` | the CLI's `verdict` string on the `verdict` line | — | the verdict card's tone |
| `section` | — | `header` `artifacts` `explore` `gates` `writes` `record` (`none` on the no-run line) | which card it sits in |
| `spans` | `[{ text, tone }]` | `[{ text, tone }]` | coloured words; `spans.map(s => s.text).join('') === text` after the text cap |

The spans are computed from the final, capped text by one `spansOf` function per module, so they can never disagree with `text`. Rejected: having `mod.mjs` parse texts, which duplicates the reading rules in the engine module, and replacing `text` with parts, which breaks every pin and the status line's reuse of row words. Recorded as ledger D1.

### D2. The tone vocabulary, and where it maps to colour

A tone names what a word means. It is one of `clock`, `dim`, `heading`, `name`, `ok`, `alarm`, `warn`, `current`, `accent`, `running` or `null`. `lib/meter-palette.mjs` gains `toneProps(tone)`, which maps these onto the existing `PALETTE` keys:

| tone | props |
|---|---|
| `ok` | `{ color: PALETTE.ok }` |
| `alarm` | `{ color: PALETTE.alarm }` |
| `warn` | `{ color: PALETTE.warn }` |
| `current` | `{ color: PALETTE.current }` |
| `accent` and `heading` | `{ bold: true, color: PALETTE.accent }` |
| `name` | `{ bold: true, color: PALETTE.identity }` |
| `running` | `turnProps(null)` |
| `clock` and `dim` | `{ dimColor: true }` |
| `null` or unknown | `null` |

`lib/spec-meter.mjs` stays import-free (pinned): it spells tones as string literals. `lib/settle-meter.mjs` needs nothing from the palette either. Colouring the CLI's own word maps a meaning, as `stateProps` already does for the ship board; it is not a verdict of the meter's own (ledger D3).

**Settle spans:**

| line | spans |
|---|---|
| row | the leading `HH:MM:SS` or `time unknown` is `clock`. `exit 0` is `ok`. `exit <n>` for any other `n` is `alarm`. A row whose body starts `STOP: ` is wholly `alarm`. `(unparsed)` is `alarm`. `exit not its own` and `result not seen …` are `dim` |
| heading | the section label is `heading`; the rest is `dim` |
| agent | the leading name, up to the first ` · `, is `name`. The final end word is `running` for `live`, `ok` for `answer` and `alarm` for any other reason, as `turnProps` reads it |
| role | the role words, up to the first ` · `, are `accent`; the rest is plain |
| verdict | the verdict word, at the start of the row's body after its clock: `MERGE` is `ok`, `HUMAN` is `warn`, `BLOCK` is `alarm`, any other word `null`. The rest is plain |
| banner | `warn` |
| mode, done, banners heading | `dim` |

**Spec spans:**

| line | spans |
|---|---|
| artifact row | the status word: `done` is `ok`, `ready` is `current`, `blocked` is `dim`, any other `null` |
| gates | `passed true`, `ready true`, `blocking false`: `ok`. `passed false`, `ready false`, `blocking true`, `missing true`, `unparseable true`: `alarm`. The words `not run yet`: `dim`. A `not read (…)` result: `warn`. The `validate READY`-style words are not drawn on the pane, so they have no rule |
| checkpoint, hand-over | `accent` |
| record line, `no artifact writes yet` | `dim` |

### D3. Cards, drawn by the hooks module from the fields alone

`drawSettlePane` and `drawSpecPane` build each keyed line as `Box{ key, flexShrink: 0, paddingLeft } > Text(props, ...spans)`, with each span a nested `Text` carrying `toneProps(span.tone)`. That is the ship meter's one-Text-with-nested-spans rule, so a row's text still reads whole.

They then wrap runs of lines in **unkeyed** Boxes, so the tests' readers, which collect Boxes with a string key, still see flat rows in document order:

- **Settle header card**: the `header` and `mode` lines, `borderStyle: 'single'`, `borderColor: PALETTE.accent`.
- **One card per `group`**: `borderStyle: 'single'`, `borderColor: PALETTE.current` when its heading is `open`, else `borderDimColor: true`, plus `paddingLeft: 1` and `paddingRight: 1`. A `verdict` line is wrapped in a nested single-border card whose `borderColor` is the theme key for the verdict's tone, or `borderDimColor` when the tone is `null`.
- **The trailing lines** (`done`, banners) are drawn after the cards, outside any card.
- **Spec cards**: a header card (accent border) for `section: 'header'`, then one dim-bordered card per section in the order the lines arrive. Each spec card is titled by an unkeyed `Text` with the `heading` props drawn from the section name. The `writes` section's own keyed `writes` line (`kind: 'title'`) stands as that card's title, and no second title is drawn.
- **Indentation**: `paddingLeft` on the keyed row Box. A `role` line sits at the gutter (`clockText` width plus one, 9 columns) so it lines up under the row bodies; an agent row sits one `INDENT` further in. Never as characters in the text.
- **Flat fallback**: at a `bodyColumns` below `LIMITS.waveBoardMinColumns`, or with no width reported, no wrapper Box is drawn and every keyed line is drawn flat, as today, but still with its spans.
- **No run**: the pane draws its single no-run Text and nothing else.
- **Width**: a card takes `bodyColumns` (no cap, since settle rows are long), and settle rows keep `wrap: 'truncate-end'`.
- **Bad spans**: a line whose `spans` are absent, are not an array, or do not join to its `text` is drawn as its plain `text`, with the line's bold or dim props, and is named once per pane draw on the debug log (`interlock settle: a pane line's spans did not match its text` / `interlock spec: …`). A missing or unknown `group` or `section` draws the line flat after the cards. The pane never throws on a field and never drops a line's text.
- **Props**: only `borderStyle: 'single'` and props the ship meter already draws with are used (ledger D2). `flexShrink: 0` on every Box, as the ship pane sets it.

### D4. The settle start, and the `resolve` section

- `settleLoad` answers `'settle'` for any `interlock:settle` load (a leading `/` dropped) and keeps answering `'review'` for `interlock:review-code`. A new pure export, `settleLoadsReview(args)`, answers whether `args` split on whitespace contains the word `--review`. It is true for `--review` alone and false for `--reviewer`, `--no-review` and `--review-depth`.
- `observeSettleLoad` calls `startSettle($, settleLoadsReview(args))`, and `startSettle` passes `{ review }` to `freshSettle(flags)`, which records `review: flags.review === true`.
- `GROUPS` gains `{ key: 'resolve', label: 'resolve', rank: 0 }`. `place()` opens `resolve` for a null target when the record's `review` is false, and `review` otherwise. Nothing else in the reader changes. `resolve` is the skill's §2 word, "Resolve the PR and the change" (ledger D4).
- The status line already names the open group's label, so a pass without `--review` reads `resolve · …` until `merge confidence` opens.

### D5. The mode line

`settlePaneLines` inserts `{ key: 'settle-mode', kind: 'mode', text: 'with --review' | 'without --review', dim: true }` right after the header. These are the load's own argument words. `rows[0]` stays the header.

### D6. Tests

**Spine** (`test/spine/settle-meter.test.mjs`, `test/spine/spec-meter.test.mjs`):
- the spans of every line, of every fixture pane, join to its text;
- the tone of each case in D2;
- `group`, `open` and `depth`;
- `settleLoadsReview`;
- a pass without `--review` grouping under `resolve` and never under `review`;
- the one existing whole-object assertion (`test/spine/spec-meter.test.mjs:363`), updated to the added fields.

The `settleLoad` pins that expect `null` for a load without `--review` change to `'settle'` (`test/spine/settle-meter.test.mjs:213-233`). This is the spec change itself, not a weakening.

**Mod** (`test/mod/settle-meter.test.ts`, `test/mod/spec-meter.test.ts`):
- the cards' `borderStyle`, `borderColor` and `borderDimColor`;
- the verdict card's border by verdict;
- the flat fallback at 40 columns;
- that the keyed rows' texts are unchanged;
- the no-run pane is one Text.

The case `a load without --review … draws nothing` becomes a case that the load starts a run reading `without --review`. `GROUP_LABELS` in both settle test files gains `resolve`.

**Pins**: `test/spine/mod-pins.test.mjs` needs no change. No new engine call, event or import outside the plugin is added.

### D7. Docs

The pane descriptions in `docs/` that name the settle meter's `--review`-only start are corrected in the same change, if any exist. `grep -rn "interlock-settle\|settle meter" docs README.md` finds them.

## Risks / Trade-offs

- **Real Desktop surface.** Borders and colours there are proven only on the kit's `desktop` mount, as the ship meter's are. The flat fallback and the unchanged texts keep the pane readable if borders are dropped.
- **Run left live.** A pass without `--review` that stops at §2 (no pull request) leaves a live run until the boundary or the next load, as a `--review` pass that stops early already does.
- **Spans pinned.** A tone rule that keys on a word could miss a reworded CLI line and draw it plain. That fails safe: uncoloured, never wrong, and the tests pin the words the CLI prints today.
