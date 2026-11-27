---
name: Interlock
description: Spec-driven development for Claude Code. A datasheet, not a pitch.
colors:
  bg: "#ffffff"
  surface: "#f5f7fa"
  surface-2: "#edf1f5"
  text: "#151a21"
  text-soft: "#475161"
  text-muted: "#5f6978"
  divider: "#dde2e8"
  border: "#c3cad4"
  border-strong: "#838d9b"
  checkpoint-cobalt: "#1d5bd6"
  checkpoint-cobalt-hover: "#174ab0"
  checkpoint-cobalt-pressed: "#123a8c"
  on-accent: "#ffffff"
  accent-subtle: "#ebf2fe"
  accent-border: "#c3d6fa"
  accent-strong: "#123a8c"
  halt-red: "#c42b1c"
  halt-subtle: "#fdedeb"
  halt-border: "#f2b8b1"
  term-ground: "#0f141a"
  term-text: "#d6dce4"
  term-dim: "#8e98a6"
  term-accent: "#79a9ff"
  term-halt: "#ff8a7d"
  bg-dark: "#0d1117"
  surface-dark: "#151b23"
  surface-2-dark: "#1c232d"
  text-dark: "#e6eaf0"
  text-soft-dark: "#aab3c0"
  text-muted-dark: "#8c96a4"
  divider-dark: "#262e39"
  border-dark: "#343d4a"
  border-strong-dark: "#6b7686"
  checkpoint-cobalt-dark: "#5c9bff"
  checkpoint-cobalt-hover-dark: "#7cb0ff"
  on-accent-dark: "#0d1117"
  accent-subtle-dark: "#12233f"
  accent-border-dark: "#1f3a66"
  accent-strong-dark: "#a1c6ff"
  halt-red-dark: "#ff7b6e"
  halt-subtle-dark: "#3a1714"
  halt-border-dark: "#6b2a23"
  term-ground-dark: "#161c24"
typography:
  display:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(36px, 5.2vw, 56px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(28px, 3.6vw, 40px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title-row:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  numeral:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\""
  pullquote:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  lede:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  body-sm:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "\"IBM Plex Sans\", -apple-system, \"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  wordmark:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
  mono-command:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
  mono-code:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.65
  mono-sm:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  mono-tag:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.2
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.checkpoint-cobalt}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.checkpoint-cobalt-hover}"
  button-primary-pressed:
    backgroundColor: "{colors.checkpoint-cobalt-pressed}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface}"
  button-ghost:
    textColor: "{colors.checkpoint-cobalt}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.accent-strong}"
  tag-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-soft}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  tag-accent:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.accent-strong}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  tag-halt:
    backgroundColor: "{colors.halt-subtle}"
    textColor: "{colors.halt-red}"
    typography: "{typography.mono-tag}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
    height: "36px"
  tab:
    textColor: "{colors.text-soft}"
    typography: "{typography.body-sm}"
    padding: "0 12px"
    height: "56px"
  tab-selected:
    textColor: "{colors.text}"
  output-panel:
    backgroundColor: "{colors.term-ground}"
    textColor: "{colors.term-text}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.md}"
    padding: "16px 20px"
  code-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.mono-code}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
  callout:
    backgroundColor: "{colors.accent-subtle}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "20px 24px"
  flow-checkpoint:
    backgroundColor: "{colors.checkpoint-cobalt}"
    textColor: "{colors.on-accent}"
    padding: "16px"
---

# Design System: Interlock

<!-- impeccable:design-map -->
Name: Interlock
Colors: primary: checkpoint-cobalt #1d5bd6; secondary: halt-red #c42b1c; neutral: bg #ffffff; primary: accent-subtle #ebf2fe; primary: term-accent #79a9ff; secondary: term-halt #ff8a7d (+9 more in the sidecar)
Fonts: IBM Plex Sans (display, headline, title, title-row, numeral, pullquote, lede, body, body-sm, caption, label); IBM Plex Mono (wordmark, mono-command, mono-code, mono-sm, mono-tag)
Spacing: 1 4px, 2 8px, 3 12px, 4 16px, 5 20px, 6 24px, 8 32px, 10 40px, 12 48px, 16 64px
Radius: sm 3px, md 4px, lg 6px, full 9999px
North Star: "The Datasheet"
Rules:
- The Counted Accent Rule. Cobalt appears on exactly seven things: the primary button, links (ghost buttons are links), eyebrows, the selected-tab underline, focus rings, the checkpoint block and the human node.
- The Halt Means Halt Rule. Red marks a halt and nothing else.
- The Cool Ground Rule. The ground is white or cool near-black.
- The 600 Ceiling Rule. Nothing is heavier than 600.
- The One Heavy Line Rule. One heavy headline per screen.
- The Tracked Once Rule. Uppercase tracking is used for the wordmark only.
- The No Card Grid Rule. Never lay tiles out in rows.
- The Flat Page Rule. A landing-page surface is flat at rest and in every state.
Elevation:
- Segment: 0 1px 2px rgba(16, 24, 40, 0.06)
- Float: 0 4px 12px rgba(16, 24, 40, 0.08)
- Dialog: 0 16px 40px rgba(16, 24, 40, 0.16)
Don't:
- Don't lay tiles out in a card grid, or box a paragraph.
- Don't put cobalt outside the Counted Accent Rule, or red on anything that is not a halt.
- Don't cast a shadow on the landing page, or use gradients, glass, 3D, stock illustration or an icon set beyond the few control glyphs.
- Don't set anything heavier than 600, add a third heading level, or track uppercase anywhere but the wordmark.
- Don't round past 4px on controls and panels.
- Don't draw window chrome or traffic-light dots on an output panel.
- Don't draw a trend arrow, health colour, score, gauge or progress ring on an indicator, or a stat tile for a number that changes monthly.
- Don't bring back revision 1: warm paper, vermilion, Archivo 800 or uppercase mono kickers.
Do:
- Do use the tokens by name from `site/ds/interlock/tokens.json`.
- (+6 more)
Map: site/ds/interlock/tokens.json
Map: site/site.css
Map: lib/report-html.mjs
Full: .impeccable/design-full.md (read a section when you need its detail)
