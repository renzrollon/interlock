# site/

The GitHub Pages landing site for Interlock. Served at
`https://renzrollon.github.io/interlock/`.

- `index.html` — the whole site. One self-contained file: inline CSS, inline
  SVG, vanilla JS, no build step, no framework. It is produced from
  `DESIGN-PROMPT.md` in Claude Design and dropped here as-is.
- `DESIGN-PROMPT.md` — the prompt that produces `index.html`. It carries every
  fact the page states, so the page can be regenerated or revised without
  re-reading the repo. **When a claim on the page goes stale, fix it here
  first**, then regenerate. Never hand-edit a number into the HTML.
- `assets/` — the images the page reads by relative path. Nothing here is over
  200 KB.
  - `poster-hero.jpg`, `poster-full.jpg` — the first frame of the 34 s loop and
    the frame at 1:35 of the whole run, cut with `ffmpeg -ss <t> -frames:v 1
    -q:v 5` from the renders below.
  - `ship-meter.webp` — `docs/assets/ship-meter.png` through `cwebp -q 82`.
  - `social-preview.png` — a copy of `docs/assets/social-preview.png`, the
    page's `og:image`.
- `.nojekyll` — tells Pages to serve the folder verbatim.

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
3. Regenerate `index.html` in Claude Design and replace it.

If a regeneration cannot happen that day, patch the version string in
`index.html` and nothing else, and regenerate before the next bump. A page
that quotes a cap the CLI no longer enforces is the one thing this repository
exists to prevent.
