# site/

The GitHub Pages landing site for Interlock. Served at
`https://renzrollon.github.io/interlock/` once Pages is enabled.

- `index.html` — the whole site. One self-contained file: inline CSS, inline
  SVG, vanilla JS, no build step, no framework, no runtime fetch except web
  fonts. It is produced from `DESIGN-PROMPT.md` in Claude Design and dropped
  here as-is.
- `DESIGN-PROMPT.md` — the prompt that produces `index.html`. It carries every
  fact the page states, so the page can be regenerated or revised without
  re-reading the repo. **When a claim on the page goes stale, fix it here
  first**, then regenerate.
- `.nojekyll` — tells Pages to serve the folder verbatim.

## Deploying

`.github/workflows/pages.yml` deploys this folder on every push to `main`
that touches `site/**`. One-time setup: repository **Settings → Pages →
Source → GitHub Actions**. Nothing deploys from a branch or a pull request.

## Keeping it honest

The page states numbers — caps, test counts, prices, version. Every one of
them is read from the repository at a named version (`interlock limits`,
`npm test`, `package.json`). The prompt says which version. When the
version bumps, re-run those commands and update the prompt's appendix before
regenerating; a page that quotes a cap the CLI no longer enforces is the one
thing this repository exists to prevent.
