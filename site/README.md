# site/

The GitHub Pages landing site for Interlock. Served at
`https://renzrollon.github.io/interlock/`.

The page is a Claude Design export, installed as it came: a landing artboard,
one component per tab, one stylesheet, and the small runtime that renders them.
It needs JavaScript; there is no build step.

- `DESIGN-PROMPT.md` — the prompt that produces the page. It carries every
  fact the page states, so the page can be regenerated or revised without
  re-reading the repo. **When a claim on the page goes stale, fix it here
  first**, then regenerate. Never hand-edit a number into the HTML.
- `index.html` — the landing artboard (`Main.dc.html` in the export): header,
  hero, flow strip, install panels, the film, the proof strip, footer, and the
  tab routing.
- `Why.dc.html`, `Run.dc.html`, `FirstHour.dc.html`, `Limits.dc.html` — the
  four tabs, fetched by the runtime when a tab is selected.
- `site.css` — the page's styles. Its tokens mirror the design system.
- `ds/interlock/tokens.json` — the Interlock design system the page was built
  with (revision 2, 2026-10-11: white ground, cobalt accent, IBM Plex), every
  token with its usage note. Nothing loads it; it is here so the brief's §3
  and the stylesheet have a source to be checked against.
- `support.js`, `vendor/react.js`, `vendor/react-dom.js` — the export's
  runtime. Not ours; replaced whole on every install.
- `assets/` — the images the page reads by relative path. Nothing here is over
  200 KB.
  - `poster-hero.jpg`, `poster-full.jpg` — the first frame of the 34 s loop and
    the frame at 1:35 of the whole run, cut with `ffmpeg -ss <t> -frames:v 1
    -q:v 5` from the renders below.
  - `ship-meter.webp` — `docs/assets/ship-meter.png` through `cwebp -q 82`.
  - `social-preview.png` — a copy of `docs/assets/social-preview.png`, the
    page's `og:image`. Still in the first, warm palette; due for re-export.
- `.nojekyll` — tells Pages to serve the folder verbatim.

## Installing an export

In Claude Design, with the Interlock design system attached and the four files
in `assets/` uploaded, paste the prompt and export the landing artboard as an
HTML zip. Then, from the unzipped folder:

1. Copy `Why.dc.html`, `Run.dc.html`, `FirstHour.dc.html`, `Limits.dc.html`,
   `site.css`, `support.js`, `vendor/` and `ds/` over the ones here.
2. Copy `Main.dc.html` to `index.html`.
3. Point the three uploaded images back at their names here. The export
   renames uploads to a content hash under its own `assets/`; replace each
   `./assets/<hash>.jpg|webp` in `index.html` and `Run.dc.html` with
   `assets/poster-hero.jpg`, `assets/poster-full.jpg` or
   `assets/ship-meter.webp`. Do not copy the export's `assets/` folder.
4. Put the static head block back in `index.html`, between the
   `<!-- site head -->` comments: the viewport meta, the description, the
   Open Graph and Twitter tags, the favicon. The export has none of them, and
   a crawler does not run the runtime, so they cannot live in the component.
5. Re-apply the local patches below, unless the regenerated export no longer
   needs them.
6. Do not copy the export's `README.md`, and do not commit the zip.

Then serve the folder and look at it (`python3 -m http.server -d site`); the
runtime fetches the tab files, which a browser blocks over `file://`.

### Local patches

Each entry gives the file, what the export does, what the patch does, and the
brief section that now asks for it. A regeneration should carry every one.
`test/site-patches.test.mjs` pins each by token.

- **`onHash` selects Why on the entry URL** (`index.html`, brief §6).
  As exported, going back to the entry URL, which has no hash, changed the URL
  and left the tab where it was. The patch makes the `onHash` handler select
  the Why tab when the hash is empty or `#`; an in-page anchor (`#install`,
  `#top`) is left alone.
- **Stepper terminal on one line** (`Run.dc.html`, brief §3 "Output panels").
  As exported, the `.term` open tag, `<sc-for>` and `.tline` were on separate
  lines, and the runtime kept the whitespace text nodes inside a `white-space:
  pre` box. The patch writes them with no whitespace between the tags.
- **State machine follows the highlight** (`Run.dc.html`, brief C.8 and §5).
  As exported, the 1,484 px diagram did not move when a later node lit up. The
  patch gives `.sm-scroll` a ref and `componentDidUpdate` centres the lit node
  (`.sm-hl`, else `.sm-current`) by `scrollLeft`, or resets to 0 when nothing
  is lit. It never scrolls the page on Step or Play.
- **Halt-row click reveals its node** (`Run.dc.html`, `site.css`, brief §5).
  `pickHalt` sets a flag and the next update calls `scrollIntoView` on the
  picked node (`.sm-hl` only, never the stepper's current node), with
  `behavior: 'auto'` under `prefers-reduced-motion`. `.sm-node` carries
  `scroll-margin-top: 80px`, so the node lands clear of the sticky header; as
  first patched it landed under it.
- **Halt rows map to the node their halt fires at** (`Run.dc.html`, brief §5
  and C.6). As exported, the contradictory-flags row (`h12`) lit
  `trampoline_halt`, the missing-Workflow halt, because C.3 put both triggers on
  one edge. The Workflow refuses `--solo --waves` before `run start`, so the
  patch maps `h12` to `ship_launch`. The run-step cap, out-of-sequence and
  `spec` rows (`h10`, `h11`, `h15`) lit nothing yet took a click; the patch
  drops their click and button and tags each `not on the diagram`.
- **Optional states are outlined, not faded** (`site.css`, brief §5 and C.3).
  As exported, `.sm-dim` and the dimmed edges, heads and labels used `opacity`.
  The patch drops it for a dashed `--color-border-strong` outline and
  `--color-text-muted` ink; dimmed halts keep `--color-halt`; `.sm-current`
  and `.sm-hl` are restated as `.sm-node.sm-current` and `.sm-node.sm-hl` so a
  lit node still wins.
- **Tab click, arrow keys and tab hash reveal the panel** (`index.html`, brief
  §6). As exported, a header tab click left the panel below the fold. The patch
  adds `revealPanel()`, called from a header tab click, from an arrow-key tab
  change (ArrowLeft, ArrowRight, Home, End; focus stays on the tab), and from
  mount when the hash names a tab; `#install`, `#top` and the hashless entry
  are untouched. `behavior: 'auto'` under reduced motion. Arrow keys were left
  out at first (design decision D15 of `answer-the-design-critique`) and added
  on 2026-11-27.
- **Tab panel takes focus** (`index.html`, `site.css`, brief §6). `#panel`
  carries `tabindex="0"`, as the tabs pattern asks when a panel opens on text
  rather than a control. It runs edge to edge, so its ring draws inside it
  (`outline-offset: -2px`).
- **Flow strip roles** (`index.html`, `site.css`, brief §5). As exported,
  `spec`, the checkpoint and `ship` were `<button role="listitem">`, which
  strips the button role. The patch makes every cell a `div role="listitem"`
  and puts one `.flow-btn` inside each of the three, filling the cell;
  `.flow-act` and `.flow-btn` carry the cell's padding, hover and the 640px
  grid, so the strip measures the same at 390 and 1440 px. The ring draws 4px
  inside the cell, in `on-accent` on the checkpoint, where a cobalt ring on the
  cobalt block could not be seen.
- **Hero film toggle** (`index.html`, `site.css`, brief §5 and A.0). As
  exported, the loop paused only on a mouse click, and a play button appeared
  only under reduced motion. The patch replaces `.film-play` with
  `.film-toggle`, always rendered in the film's top-right corner, whose glyph
  and label follow the film's own `play` and `pause` events. They are bound
  with `addEventListener`, because the runtime maps no media events.
- **Selected tab centred in the strip** (`index.html`, brief §4). The patch
  centres the selected tab from `componentDidUpdate`.
- **Install block, in order** (`index.html`, `site.css`, `FirstHour.dc.html`,
  brief A.3 and D.1). On 2026-11-27 a live install of v1.21.0 into a clean
  home showed `! interlock doctor` answers `command not found` in the session
  the plugin was installed from. As exported, the three panels sat side by
  side with the requirements in the small print and one copy button per panel.
  The patch adds a `You need` checklist above the panels (`.reqs`, real
  checkboxes persisted under `il-reqs`), stacks the panels in order at most
  880 px wide (`.install`), puts the new-session line between the first and
  second panels (`hasLead`), adds `/interlock:fix-tests` to the once-per-repo
  panel, and replaces the panel copy with one icon button per command
  (`.ln-copy`, `copyLine`) that copies the bare command, never its comment.
  The First hour timeline gains the `fix-tests` step (key `st`, so existing
  ticks keep their keys), and `fix-tests` leaves its "Do not run these yet"
  list.
- **Tabs on their own row below 760 px** (`index.html`, `site.css`, brief §4).
  As exported, the phone header kept the tab strip between the wordmark and
  `Install`, so at 375 px it showed only `Why` and a clipped `The r`. The patch
  wraps `.hdr-in` below 760 px: the wordmark and actions keep a 48 px first
  row, and `.tabs` takes a full-width second row, edge to edge after a divider
  rule, its tabs 44 px tall. At 640 px and under, the four tabs share the
  width; under 360 px their padding tightens so all four fit at 320 px. The
  header grows from 57 to 94 px, so the anchor offsets move out of the inline
  styles into `site.css` and grow with it there: `#panel` 56 → 93 px,
  `#install` and `.sm-node` 80 → 117 px.
- **`cramped-padding` waivers** (`Run.dc.html`, `index.html`,
  `FirstHour.dc.html`, `Limits.dc.html`, brief §5). The design hook flagged
  cells the rendered scans (1440 and 390 px) did not reproduce. An inline
  `impeccable-disable-next-line cramped-padding` comment, with the evidence,
  sits above `.sm-scroll`, each `.tbox` and the three proof-strip figures.

The polish pass of 2026-11-27 added the entries below.

- **Paragraph reset at class weight** (`site.css`, brief §3 "Spacing keeps
  its rhythm"). As exported, `.il p { margin: 0 }`, one class plus one
  element, outranked every one-class margin on a paragraph: the `.stack-*`
  gaps, `.term-cap`'s 8 px and `.flow-desc-bar`'s 12 px all collapsed to
  zero, so paragraphs ran together and captions touched their panels. The
  patch writes the reset as `.il :where(p)`.
- **Inline code moves whole** (`site.css`, brief §3 "Type"). As exported,
  inline code broke at its hyphens (`-` / `p`, `--` / `location=global`). The
  patch makes `.il code` an inline-block, so a code span moves to the next
  line whole and wraps inside itself only when it is longer than the line.
  `.nw` keeps a hyphenated name whole in mono text that is not `<code>`: the
  First hour "Do not run these yet" list, its `spec --continue` cell, the
  stepper caption's change name, `docs-index` in G.2, and the checkpoint's
  `re-spec`.
- **First hour: one copy button per command** (`FirstHour.dc.html`,
  `site.css`, brief §5 and D.1). As exported, each step's code panel had one
  `Copy` button in its corner for the whole panel. At 390 px long commands ran
  under it; the install step copied both `/plugin` lines as one paste; the
  last step copied `settle` together with the archive line that runs after
  the merge. The patch rebuilds each panel as the install panels' `.cmd` and
  `.cmd-rows`, with one `.ln-copy` per command (`mkStep` gives every line its
  own `copy`), and drops `.codebox`.
- **The copy fallback is spoken** (`index.html`, `FirstHour.dc.html`, brief
  §6). When the Clipboard API refuses, the command is selected and the polite
  live region says so.
- **The stepper opens with narration** (`Run.dc.html`, brief §5). As
  exported, before the first Step the terminal stood 360 px tall and empty.
  The patch prints three short `#` lines saying what Step and Play do. The
  panel does not wrap, so one long line was cut off at 390 px.
- **The caps table fits a phone** (`Limits.dc.html`, `site.css`, brief §5).
  As exported, the table was 520 px wide inside its scroller, so at 390 px
  every value sat off-screen to the right of its name. The patch moves the
  inline styles to `.dt-capsbox`, `.cap-k` and `.cap-v`. Under 640 px the
  table drops its minimum width, a short value stays beside its name, and a
  value over 12 characters (`dt-caps-long`: the routing, session and depth
  rows) drops under it.
- **Scroll cues** (`site.css`, brief §3). `.tbox` and `.sm-scroll` carry a
  styled scrollbar that is visible at rest. macOS overlay scrollbars appear
  only mid-scroll, which hid the diagram's commit and close columns and each
  wide table's last column. Firefox gets `scrollbar-color` instead.
- **The dark canvas** (`site.css`, brief §6). The export's helmet sets
  `body { background: #ffffff }`, so a dark page overscrolled white and kept
  light native scrollbars. In dark, `html:has(.il[data-theme="dark"])` sets
  `color-scheme: dark` and `color-bg` on the root and the body.
- **Section ends** (`site.css`, brief §3). Where another section follows, the
  last `.rows` row and a trailing `.disc` draw no closing rule
  (`.sec:has(+ .sec)`), so two hairlines no longer frame an empty 64 px band.
- **Small spacing** (`index.html`, `site.css`, brief §4 and §5). The flow
  strip's closing line is `.flow-coda`, 16 px under the strip wherever the
  description bar is hidden (it sat 4 px under it); the stepper's divider is
  hidden below 760 px, where the toggles wrap; a footer doc title that wraps
  hangs under its title, not under its number.

## The film

The two videos are not in git. They are assets on the **v1.5.0** release, and
the page plays them from there:

- `https://github.com/renzrollon/interlock/releases/download/v1.5.0/interlock-spec-and-ship-hero.mp4`
  (34 s, 1676×1052, 2.7 MB)
- `https://github.com/renzrollon/interlock/releases/download/v1.5.0/interlock-spec-and-ship-full.mp4`
  (2:34, 1920×1206, 9 MB; the README links this one too)

GitHub serves release assets as `application/octet-stream` and honours byte
ranges, so each `<source>` carries `type="video/mp4"` and seeking works. The
run was recorded on plugin 1.4.2; the page's provenance line says so even
though the files hang off 1.5.0. A re-cut goes up as a new release asset, and
Appendix A.0 and G.6 of the prompt get the new URLs before regenerating.

## Deploying

`.github/workflows/pages.yml` deploys this folder on every push to `main`
that touches `site/**`. One-time setup: repository **Settings → Pages →
Source → GitHub Actions**. Nothing deploys from a branch or a pull request.

## Keeping it honest

The page states numbers — caps, counts, version. Every one of them is read
from the repository at a named version, and the prompt says which command
produced it (Appendix G.2's third column). The note at the top of the prompt
lists which appendix blocks were re-verified at the current pin and which were
carried forward.

**On every version bump**, the same day:

1. Re-run the commands in the prompt's G.2 table and `interlock limits`, and
   update Appendix G. Re-run `interlock waves` on the C.7 example if the
   planner changed, and `interlock doctor` for D.1.
2. Change the pin (`v1.5.0` in A.1, F.4, G and the header note).
3. Regenerate in Claude Design and install the export as above.

If a regeneration cannot happen that day, patch the version string in
`index.html` and nothing else, and regenerate before the next bump. A page
that quotes a cap the CLI no longer enforces is the one thing this repository
exists to prevent.
