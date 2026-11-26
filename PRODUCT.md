# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff and principal engineers, engineering managers, and platform or developer-experience leads on teams that already run Claude Code every day. They have been burned: an agent that argued its way past a rule, a run that stopped to ask a question at two in the morning, two parallel agents that overwrote each other, a review so noisy they learned to skim it, a spec that rotted the week after it shipped. They are allergic to hype and judge a claim by whether it can be checked. (Source: `site/DESIGN-PROMPT.md` §1, confirmed by the owner 2026-11-26.)

Their job: get a change from intent to a tested, reviewed commit without supervising the agents in between, and decide whether to adopt Interlock for their team.

## Product Purpose

Interlock is an open-source Claude Code plugin (`@renzrollon/interlock`, MIT) for spec-driven development, layered on OpenSpec. You read one spec; parallel agents ship it to a tested commit; one more command settles the pull request to a computed verdict. The loop is `bootstrap` → `spec` → **you read the spec** → `ship` → `settle`.

Success: a team installs it, runs one change through it in its first week, and keeps using it because the run did what it said and left a record they could check.

## Positioning

Other spec tools compete on how much structure you write before coding. Interlock competes on **how many decisions the model is not allowed to make.**

- The loop is a script a runtime executes (`ship` is a Claude Code workflow with no input channel), so it structurally cannot ask anyone anything mid-run.
- The rules are a CLI that exits with a number. Caps, gates and the merge verdict (`MERGE` / `HUMAN` / `BLOCK`) are code a model cannot argue with.
- There is exactly one human stop, the cheapest one: reading the spec.
- Every decision can be re-run on a laptop without a model or the network, and every run leaves a receipt, a trajectory and an outcome record.
- It is built with itself: every feature started as a spec in `openspec/changes/archive`.

## Operating Context

Used inside Claude Code sessions in a git repository, from slash commands (`/interlock:spec`, `/interlock:ship`, `/interlock:settle`, `/interlock:bootstrap` and others) and the `interlock` CLIs on the session PATH. Evaluated by reading the README, the numbered docs and the landing site, and by watching the recorded run.

Four surfaces are in scope for design work (confirmed 2026-11-26; see `ACCESSIBILITY.md`):

- **Landing site** — `site/`, a Claude Design export served by GitHub Pages at `https://renzrollon.github.io/interlock/`. Regenerated from `site/DESIGN-PROMPT.md`, never hand-edited for facts; installed per `site/README.md`.
- **Docs** — `README.md` and `docs/NN-*.md`, GitHub-flavoured Markdown read on GitHub and npm.
- **Terminal output** — messages from the CLIs, hooks and skills. Plain text, no ANSI colour; exit codes are the contract.
- **Ship meter** — `hooks/mod.mjs`, the panel that draws a ship run live. It observes and decides nothing.

## Capabilities and Constraints

- Claude Code only, 2.1.154+, with dynamic workflows on; Node.js 22.12+ with npm. Cursor and Copilot are not supported, and that is stated plainly wherever limits are listed.
- Zero runtime dependencies; stdlib Node; no build step. OpenSpec is provisioned on first use from a pinned, lockfile-checked copy.
- Interlock makes no network request of its own. The site has no analytics, no cookies, no forms.
- Adversarial review (`--strict`) is opt-in. `interlock-run` and earned autonomy are experimental; `/interlock:ship` is the supported path.
- Structural graph indexing covers JavaScript/TypeScript, Python, shell, C# and Bicep.
- Thresholds live in the CLI (`interlock limits`), never restated in prose.
- **Fact source:** PRODUCT.md holds durable truth only. Versioned numbers and claims for the site live in `site/DESIGN-PROMPT.md` (currently pinned to v1.5.0 while the package is 1.21.0, so it is due a refresh); live values come from the CLI.

## Brand Commitments

- Name: **Interlock**. Wordmark `INTERLOCK` in tracked mono capitals.
- Voice: dry, precise, confident, slightly contrarian. Short declarative sentences. Every benefit has its cost stated beside it. No exclamation marks, no emoji in copy. Headlines are sentences a person would say aloud.
- Banned words: revolutionary, seamless, supercharge, unleash, effortless, magical, AI-powered, 10x, game-changing, next-generation, cutting-edge, simply, just, easily, powerful, robust, leverage, unlock, empower, delight.
- Sign-off: "The script holds the loop / the CLI holds the rules / the agents do the work".
- Visual identity is bound to the Interlock design system, revision 2 (2026-10-11), vendored at `site/ds/interlock/tokens.json`. It supersedes the first warm-paper version. Its details belong in DESIGN.md, not here.

## Evidence on Hand

- The recorded run: 34 s hero loop and 2:34 full cut, published as v1.5.0 release assets (`interlock-spec-and-ship-full.mp4`, `…-hero.mp4`), recorded on plugin **1.4.2**; the provenance line must say so. Its `180 of 180` is the demo repo's suite in that run, quoted only with the film.
- `docs/assets/`: `spec-and-ship.gif`, guard-deny, settle-verdict, hero and flow SVGs (light/dark), `ship-meter.png`, `halted.png`, `limits.png`, `plan-preview.png`, `doctor.png`, `strict-complete.png`, `social-preview.png` (still the first, warm palette; due for re-export).
- `site/assets/`: `poster-hero.jpg`, `poster-full.jpg`, `ship-meter.webp`, `social-preview.png`. `assets/icon.png`.
- More than 80 archived OpenSpec changes, one folder each.
- **Absent, and never to be fabricated:** testimonials, customer logos, star counts, "trusted by", a published benchmark, a passing-test count for Interlock's own suite, any terminal output line the tool did not actually print.

## Product Principles

1. **Checkable over persuasive.** Every claim traces to a command, a file or a recording. If it cannot be checked, leave it out.
2. **Cost beside benefit.** Limits are stated next to what they buy, never buried.
3. **The CLI is the authority.** Quote what `interlock limits`, the gates and the verdict print; never restate a threshold as prose.
4. **Degradation is spoken, never silent.** Anything that falls back says so.
5. **No meaning carried by colour, layout or symbol alone.** Text first; anything drawn has a plain-text equivalent.

## Accessibility & Inclusion

The site aims for WCAG 2.2 AA (a goal, not a claim; unevaluated). It must work from the keyboard alone with visible focus, honour `prefers-reduced-motion` and `prefers-color-scheme`, and not scroll the body sideways from 375 px to 1600 px. Docs use plain language, headings in order, descriptive link text and alt text on informative images. Terminal output carries no colour. No surface has been tested with a screen reader. Details in `ACCESSIBILITY.md`.
