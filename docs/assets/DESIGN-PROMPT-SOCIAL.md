# Design prompt — the social card (`social-preview.png`)

This file is the source for the next export of `docs/assets/social-preview.png`, the 1280 × 640 card that link previews show for the repository and the landing site. It supersedes artboard 3 in [`DESIGN-PROMPT.md`](./DESIGN-PROMPT.md). Same convention: **when a line on the card goes stale, fix it here first**, then regenerate.

Two reasons to re-export:

- **The palette.** The card in the repository today is in the retired warm palette: an off-white ground and a burnt red-orange wordmark. The README badges, the flow diagram and the site are white and cobalt. `tokens.json` already says the PNGs "are due for re-export".
- **Settle.** The card names two commands and stops at the commit. The README now carries the change to a pull request with a verdict on it, and the card should say so in one line without becoming a third headline.

**Brand.** The current design system under `site/ds/interlock/` (`tokens.json` version 2: white ground, cobalt, IBM Plex).

---

## The prompt

Attach the Interlock design system (the `site/ds/interlock/` folder), then paste everything from here to the end of Appendix B into Claude Design.

---

You are producing one PNG, the social card for **Interlock**, a Claude Code plugin for spec-driven development. It appears as the link preview on GitHub, in chat apps and on social sites, usually about 640 px wide and sometimes smaller, always on someone else's background.

Take every colour, typeface, radius and spacing value from the attached Interlock design system. Where this brief and the design system disagree, the design system wins; tell me where they disagreed.

The rules that matter here, repeated so this brief stands alone:

- **Ground** `poster-ground` (`#ffffff`). **Ink** `poster-ink` (`#151a21`). **Secondary** `poster-grey` (`#475161`).
- **One hue**, cobalt `poster-accent` (`#1d5bd6`), and it appears exactly twice: the square before the wordmark, and the checkpoint block. Nothing else is cobalt: not the headline, not a rule, not a command.
- **No red.** Red means a halt in this brand, and the card shows none.
- **Type.** IBM Plex Sans for the headline, IBM Plex Mono for the wordmark and every command. Nothing heavier than 600.
- **A datasheet, not a poster.** Left-aligned. 4 px radius. 1 px rules. No shadow, no gradient, no glow, no icon, no mascot, no logo of any vendor, no screenshot, no window chrome.

**The text is fixed. It is given verbatim in Appendix B. Do not add a tagline, a URL, a version number, a download count or a call to action.** A number on a link preview goes stale the day after it is exported.

### The card

One artboard: `social-preview.png`, 1280 × 640, light theme only. A link preview has no dark mode, so there is no dark variant.

Top to bottom, in one left-aligned column:

1. **Wordmark.** A cobalt square, then `INTERLOCK` in tracked IBM Plex Mono capitals, `poster-ink`. This is the site header's wordmark at a larger size; the square is as tall as the capitals. No rule under it.
2. **Headline** (S1), IBM Plex Sans 600, letter-spacing −0.02em, line height 1.08, `poster-ink`, on two lines broken exactly as Appendix B breaks them. As large as the two lines allow inside the safe area, and no smaller than 84 px.
3. **The flow strip** (S2): one row of three cells inside a single 1 px `color-border` outline with a 4 px radius, the cells divided by 1 px rules.
   - Cell 1: the first command, IBM Plex Mono, `poster-ink`, on white.
   - Cell 2: the checkpoint. Filled `poster-accent`, text `poster-on-accent` (`#ffffff`), IBM Plex Sans 600. It is the only filled shape on the card.
   - Cell 3: the second command, IBM Plex Mono, `poster-ink`, on white.
   - No arrows. The order and the filled block carry the sequence, as they do on the site's flow strip.
4. **The settle line** (S3), IBM Plex Mono, `poster-grey`, directly under the strip and aligned to its left edge. It is deliberately the quietest line on the card.

### Layout rules

- **Safe area.** Keep everything at least 64 px from every edge. Some previews crop the sides or round the corners.
- **Legibility at half size.** The card is read at 640 px wide. Nothing is set below 28 px, and the settle line is not an exception.
- **Width.** The strip may run the full width of the safe area. If the three cells do not fit on one row at 28 px, widen nothing and shrink nothing: stack the strip as three rows, in the same order, and tell me you did.
- **Space.** The headline is the heaviest thing on the card and gets the most room. At least 40 px between the headline and the strip, and 24 px between the strip and the settle line. Leave the bottom margin empty.
- **One heavy line.** Only the headline is heavy. The wordmark, the commands and the settle line are all regular or medium weight.

### Alt text (deliver beside the artboard)

`Interlock. Two commands. One human checkpoint. /interlock:spec, then you read the spec, then /interlock:ship. Then /interlock:settle for the pull request.`

---

## Appendix B — the text, verbatim

### S0 — wordmark

```
INTERLOCK
```

### S1 — headline, two lines

```
Two commands.
One human checkpoint.
```

### S2 — the flow strip, three cells in this order

```
/interlock:spec "<idea>"
You read the spec.
/interlock:ship
```

### S3 — the settle line

```
then /interlock:settle for the pull request
```

---

## Appendix C — where the text comes from

Nothing on this card is output, so there is nothing to re-run. Each line is quoted from a source that a test or a generator already holds still:

| Text | Source |
|---|---|
| `Two commands. One human checkpoint.` | The design system's `display-hero` sample in `site/ds/interlock/tokens.json`, and the headline of the card this one replaces |
| `/interlock:spec "<idea>"`, `/interlock:ship` | Block B0 of `DESIGN-PROMPT.md`; the first block of code in the README |
| `You read the spec.` | The label of the checkpoint node in `scripts/gen-flow-svg.mjs`, so the card and the README's flow diagram say the same words |
| `/interlock:settle` | The skill's name; the README's "Then settle the pull request" section |

The settle line is new and is the only judgement on the card. It is one quiet line, not a third command in the strip, because `spec` and `ship` are local and `ship` asks nothing, while `settle` pushes under your own `gh` or `glab` sign-in and is the step you choose to run. A three-cell strip that ended in `settle` would also disagree with the headline above it.

Regenerate when the headline, a command name or the checkpoint label changes.

## Appendix D — where the file goes

One export, three destinations:

| Destination | How |
|---|---|
| `docs/assets/social-preview.png` | Replace the file |
| `site/assets/social-preview.png` | Copy the same file. It is the site's Open Graph and Twitter image (`site/index.html`), and `site/README.md` describes it as a copy of the one above |
| GitHub → Settings → General → Social preview | Upload it by hand. GitHub does not read this from the repository |

After the export, check the card against Appendix B, look at it scaled to 640 px and to 320 px wide, and add a `## Produced <date>` section here recording any deviation, as `DESIGN-PROMPT.md` does. Then mark artboard 3 in `DESIGN-PROMPT.md` as superseded by this file.

Link previews are cached. After the upload, a site that has already fetched the old card keeps showing it until its cache expires or you ask it to re-scrape.
