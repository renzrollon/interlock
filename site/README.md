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
- **Halt-row click reveals its node** (`Run.dc.html`, brief §5). `pickHalt`
  sets a flag and the next update calls `scrollIntoView` on the lit node, with
  `behavior: 'auto'` under `prefers-reduced-motion`.
- **Optional states are outlined, not faded** (`site.css`, brief §5 and C.3).
  As exported, `.sm-dim` and the dimmed edges, heads and labels used `opacity`.
  The patch drops it for a dashed `--color-border-strong` outline and
  `--color-text-muted` ink; dimmed halts keep `--color-halt`; `.sm-current`
  and `.sm-hl` are restated as `.sm-node.sm-current` and `.sm-node.sm-hl` so a
  lit node still wins.
- **Tab click and tab hash reveal the panel** (`index.html`, brief §6).
  As exported, a header tab click left the panel below the fold. The patch adds
  `revealPanel()`, called from a header tab click and from mount when the hash
  names a tab; `#install`, `#top` and the hashless entry are untouched.
  `behavior: 'auto'` under reduced motion.
- **Selected tab centred in the strip** (`index.html`, brief §4). The patch
  centres the selected tab from `componentDidUpdate`.
- **`cramped-padding` waivers** (`Run.dc.html`, `index.html`,
  `FirstHour.dc.html`, `Limits.dc.html`, brief §5). The design hook flagged
  cells the rendered scans (1440 and 390 px) did not reproduce. An inline
  `impeccable-disable-next-line cramped-padding` comment, with the evidence,
  sits above `.sm-scroll`, each `.tbox` and the three proof-strip figures.

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
