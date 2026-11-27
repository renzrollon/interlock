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

## Overview

**Creative North Star: "The Datasheet"**

Interlock looks like an engineering datasheet: a page you check rather than a page that pitches. Every section earns its place by showing something the tool printed or recorded, whether that is film, a still, an output panel or a table of values. Prose that shows none of those gets no box, no fill and no border. It is a subhead and paragraphs. The system exists to make a claim checkable at a glance, so its density is high and its decoration is close to zero.

The ground is plain white, with cool greys for structure and IBM Plex for every word. One cobalt accent marks the human checkpoint and what you can act on. One red means a halt and nothing else. Sections are separated by 1px hairlines and whitespace, never by tinted bands. Light is the default and dark is the reader's preference, not a mood. Revision 2 (2026-10-11) explicitly replaced the first version's warm paper, vermilion, Archivo 800 and uppercase mono kickers. Treat those as anti-references.

Source of truth: `site/ds/interlock/tokens.json` (revision 2, with a usage note on every token), implemented in `site/site.css` under the `.il` scope.

**Key Characteristics:**
- White ground, cool neutrals, one accent, one semantic red.
- Two families, IBM Plex Sans and IBM Plex Mono. Nothing heavier than 600.
- 1px rules everywhere. The only 2px line marks a selection or a current node.
- 4px corners, flat surfaces and no shadow anywhere on the landing page.
- Mono for everything the tool would print: commands, paths, flags, values and captions.
- Near-black output panels in both themes.

## Colors

The palette is cool and spare: neutrals do the structural work, and colour is a count, not a mood.

### Primary
- **Checkpoint Cobalt** (`checkpoint-cobalt`; dark `checkpoint-cobalt-dark`): the one brand hue. It is used for the primary button fill, links, eyebrows, the selected tab's underline, focus rings, the checkpoint block in the flow strip, and the human node in a diagram. Its hover and pressed steps darken in light and lighten in dark. Text on a cobalt fill uses `on-accent`: white in light, near-black in dark.
- **Cobalt Tint** (`accent-subtle`, edged by `accent-border`, text in `accent-strong`): a tinted ground for a callout, the current step in the state machine, a selected table row, or an accent tag.

### Secondary
- **Halt Red** (`halt-red`; dark `halt-red-dark`): semantic, never decorative. It outlines and labels halt nodes, the halt tag and a `SHIP HALTED` banner. `halt-subtle` and `halt-border` form the ground and edge of the halt tag and of a highlighted halt node.

### Neutral
- **White Ground** (`bg`; dark `bg-dark`, a cool near-black): the page and the sticky header. Never tinted warm.
- **Quiet Fill** (`surface`): the one quiet fill. It is used for code panels, table heads, the install panels' header bars and table-row hover. **Pressed Fill** (`surface-2`) covers hover and pressed states on surfaces and the neutral tag.
- **Ink** (`text`), **Soft Ink** (`text-soft`), **Muted Ink** (`text-muted`): copy, then secondary copy (ledes, captions, table heads, nav at rest), then provenance and small print. Nothing lighter than Muted Ink is used for text.
- **Hairline** (`divider`) for section rules, table rows and panel edges; **Rule** (`border`) for the stronger line under a table head and around the flow strip and command panels; **Control Edge** (`border-strong`) for borders on secondary buttons, inputs, checkboxes and diagram nodes, so that a control reads as a control.
- **Terminal Ground** (`term-ground`): output panels and film frames, near-black in both themes. Inside a panel, `term-text` is the output, `term-dim` the page's own narration (lines starting `#`), `term-accent` marks the two or three lines that matter (`SHIP COMPLETE`, the commit, `GATE` lines), and `term-halt` marks halts only.

The report page (`lib/report-html.mjs`) has its own green-grey palette (`report-*` in tokens.json). It never mixes with the brand palette, and its mark encodes quantity only.

### Named Rules
**The Counted Accent Rule.** Cobalt appears on exactly seven things: the primary button, links (ghost buttons are links), eyebrows, the selected-tab underline, focus rings, the checkpoint block and the human node. Beyond those, cobalt may only mark a control's own state: a pressed toggle and the current state-machine node take the Cobalt Tint, a checked box fills cobalt, and the `WORKFLOW` tag on `ship` is outlined in it. Never on a bullet, an icon, a figure or a section ground.

**The Halt Means Halt Rule.** Red marks a halt and nothing else. It never means "bad", never colours a number, and never decorates.

**The Cool Ground Rule.** The ground is white or cool near-black. A warm or tinted page ground is the old system coming back.

## Typography

**Display Font:** IBM Plex Sans (with -apple-system, Segoe UI, system-ui)
**Body Font:** IBM Plex Sans
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, SFMono-Regular, Menlo, Consolas)

**Character:** A sober engineering pairing. Sans carries argument and explanation; mono carries anything the tool itself would print, so the reader can always tell a claim from an artefact.

### Hierarchy
- **Display** (600, `clamp(36px, 5.2vw, 56px)`, 1.08): the page headline, once. Measure 18ch, with 24px of clear space before the lede at every width.
- **Headline** (600, `clamp(28px, 3.6vw, 40px)`, 1.15): the one headline per tab or long page. Measure about 24–26ch.
- **Title** (500, 20–24px, 1.3): a section subhead under an eyebrow. A plain label of what is under it, not a second heavy claim.
- **Row title** (600, 18px, 1.4): row titles, disclosure summaries, column labels.
- **Numeral** (500, 44px, tabular figures): a figure in the proof row, always over a caption saying what was counted.
- **Pull quote** (400, 20px, 1.45): a quoted line from the docs, under a 24×2px cobalt lead rule.
- **Lede** (400, 19px, 1.6, Soft Ink, 60ch) and **Body** (400, 17px, 1.65, 60–70ch, `text-wrap: pretty`): running copy.
- **Small** (14px) for table cells, buttons, inputs and nav; **Caption** (13px) is the smallest size in the system.
- **Eyebrow** (600, 13px, cobalt, sentence case, no tracking): two to six words above a subhead, a panel or a footer column.
- **Mono roles:** the wordmark (`INTERLOCK`, 600, 15px, 0.12em tracking, after a 10px cobalt square); command names (600, 14px, lower case, exactly as typed); code and output text (13.5px, 1.65; `site.css` currently renders panels at 13px); caption lines and table values (12.5px); tags (500, 12px, lower case). Inline code is mono at 0.9em with no fill and no border.

Long-form pages that are not the landing page use the bare h1–h6 scale in tokens.json (36 / 28 / 22 / 18 / 16 / 14px, 600, sentence case).

### Named Rules
**The 600 Ceiling Rule.** Nothing is heavier than 600. Body is 400; subheads, nav, buttons, numerals and tags are 500.

**The One Heavy Line Rule.** One heavy headline per screen. Every other heading is a medium-weight label, and there is no third heading level on the landing page.

**The Tracked Once Rule.** Uppercase tracking is used for the wordmark only. Eyebrows are sentence case.

## Layout

A single centred content column of 1120px (`.wrap` is 1168px including its 24px gutters), with a 24px gutter that drops to 16px under 640px. A sticky 56px header holds the wordmark, the centred tab bar and the actions; under 760px the tabs scroll horizontally inside it. Text is left-aligned throughout.

The vertical rhythm comes from the spacing scale: 4px between a caption and its panel, 8px between buttons and between an eyebrow and its subhead, 24px under a subhead, 40px between blocks, 48px between the hero's parts, and 64px between sections. Each section opens with a 1px hairline rule. Two-column blocks are 4:7 splits that stack under 860px. The hero is a 5:6 grid that stacks under 960px. The flow strip's five cells run 1 : 1 : 1.5 : 1 : 1, with the checkpoint cell 1.5× wide, and it becomes a vertical list under 640px, never a wrapped grid.

The layout is responsive from 375px to 1600px with no horizontal scroll on the body. Tables, diagrams and panels scroll inside their own containers. Controls share a 36px height so they sit side by side.

### Named Rules
**The No Card Grid Rule.** Never lay tiles out in rows. A bordered box is for a control, a code panel or a table, never for a paragraph.

## Elevation & Depth

Flat. Depth comes from tone and line: the Quiet Fill on the white ground, 1px hairline and rule edges, and near-black output panels. Nothing on the landing page casts a shadow; even the selected tab is drawn with an inset 2px underline. Tokens.json defines three shadows for surfaces that genuinely float (a segmented control's selected option, a floating menu, a dialog), and none of them is used on the landing page today.

### Shadow Vocabulary
- **Segment** (`box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06)`): the selected option of a segmented control.
- **Float** (`box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08)`): a card or menu floating over content.
- **Dialog** (`box-shadow: 0 16px 40px rgba(16, 24, 40, 0.16)`): dialogs.

### Named Rules
**The Flat Page Rule.** A landing-page surface is flat at rest and in every state. If something seems to need a shadow to separate it, give it a 1px rule instead.

## Shapes

The geometry is rectangular and barely softened. Buttons, inputs, panels, the flow strip, bordered tables and callouts use a 4px corner (`rounded.md`); tags and checkboxes use 3px; floating dialogs use 6px. A fully round shape is reserved for the radio dot. Every rule and border is 1px. Diagrams are inline SVG with rectangular nodes, 1px strokes (2px for the current node only), plain lines with small closed arrowheads, and mono labels set as real text.

## Components

Instrument-grade: exact, labelled and unornamented. A control looks like a control, and nothing else is boxed.

### Buttons
- **Shape:** gently squared (4px), 36px high, 14px horizontal padding, Plex Sans 14px at 500.
- **Primary:** a Checkpoint Cobalt fill with `on-accent` text. Hover darkens one step and pressed darkens two. Reserved for the main action (`Install`, `Adjudicate`).
- **Secondary:** the white ground with a 1px Control Edge border and ink text. Hover moves to Quiet Fill, pressed to Pressed Fill.
- **Ghost:** cobalt text with no border. Hover adds the Cobalt Tint ground.
- **Toggle (`aria-pressed`):** pressed toggles take the Cobalt Tint ground, the accent border and accent-strong text (the `--strict`, `--isolate-waves` and `--solo` toggles).
- **Small / icon:** 28px small buttons for copy actions; 36px square icon buttons in Soft Ink.
- **Focus:** a 2px cobalt outline at a 2px offset, on every interactive element.
- **Film toggle:** a 36px square on Terminal Ground with a 1px `term-dim` edge, in the hero loop's top-right corner, the one corner the film leaves empty: pause while it plays, play while it waits. Its focus ring is `term-accent`, because cobalt sits near 3:1 on that ground.

### Tags
- **Style:** mono 12px at 500, lower case, 22px high, 3px corners. They name a kind: `skill`, `workflow`, `experimental`, `strict`.
- **Variants:** neutral (Pressed Fill on Soft Ink), accent (Cobalt Tint), outline (a 1px cobalt edge, as on the `WORKFLOW` tag), halt (halt subtle, halt border and red text), and on-accent (a translucent white edge inside the checkpoint block).

### Panels
- **Output panel:** Terminal Ground in both themes, mono, 4px corners, no window chrome and no traffic-light dots. A mono caption line above it says what printed it. Long lines scroll inside the panel.
- **Code panel:** Quiet Fill with a 1px hairline edge, mono, for code and commands. A copy button sits in the corner.
- **Command panel:** a white 40px header bar with a label and a copy button, ruled off from a Quiet Fill body. Each `#` comment drops to its own line in narrow containers.
- **Callout:** Cobalt Tint with a 1px accent border and 20px/24px padding; its title is 15px at 600 in accent-strong.

### Inputs / Fields
- **Style:** the white ground, a 1px Control Edge border, 4px corners, 36px high, 14px text; placeholder in Muted Ink.
- **Focus:** the border turns cobalt with a 3px cobalt halo at 22%.
- **Checkbox:** a 16px box with 3px corners and a Control Edge border. Checked, it fills cobalt with an `on-accent` tick.

### Navigation
- **Header:** sticky, the white ground, a 1px hairline bottom edge. The wordmark sits at left, the tabs in the centre, and the Install button, GitHub link and theme toggle at right.
- **Tabs:** Plex Sans 14px at 500 in Soft Ink, 56px tall. Hover turns the text to ink. Selected is ink with a 2px cobalt inset underline. Tabs are hash-routed and support arrow keys.

### Tables
- **Style:** a 1px hairline box with 4px corners. The head is Quiet Fill, 13px at 600 in Soft Ink, over a stronger rule. Rows are 14px with hairline separators, values are mono 12.5px, numbers are right-aligned tabular mono, and a row hovers to Quiet Fill and selects to Cobalt Tint.

### Disclosures
- **Style:** native `<details>` between hairlines. The summary is 16px at 500, with a drawn chevron that rotates when open and turns cobalt on hover. The mono variant is used for objections.

### Flow strip (signature)
Five ruled cells in a 1px Rule box with 4px corners: `bootstrap` → `spec` → **You read the spec** → `ship` → `settle`. The checkpoint cell is the only filled block, Checkpoint Cobalt at 1.5× width. Cells hover to Quiet Fill. Under 640px the strip becomes a vertical list of full-width rows, with the checkpoint row still filled. The three clickable cells are list items holding a button that fills them; their focus ring draws 4px inside the cell, in `on-accent` on the checkpoint.

### State machine (signature)
An inline diagram of mono nodes with 3px corners and 1px Control Edge borders. The human node is the only accent-filled shape. Halt nodes are outlined in red. The current node has a 2px cobalt border on Cobalt Tint. Optional states are drawn with a dashed `color-border-strong` outline and `color-text-muted` ink, never faded; a dimmed halt keeps `color-halt`. The stepper advances by moving the highlight, never by moving nodes.

### Proof figures and pull quotes
Three figures in a ruled row, each a 44px numeral over a 14px Soft Ink caption, with no colour, arrow or unit, stacking under 640px. Pull quotes sit under a 24×2px cobalt lead rule, never in a box and never against a left border.

## Do's and Don'ts

### Do:
- **Do** use the tokens by name from `site/ds/interlock/tokens.json`. Never introduce a colour, face, radius or shadow it does not define.
- **Do** separate sections with a 1px `divider` rule and 64px of space.
- **Do** set every command, path, flag, value and caption line in IBM Plex Mono.
- **Do** caption every output panel with one mono line saying what printed it.
- **Do** define each colour once as a custom property with its light value, and redefine only the tokens that change for dark.
- **Do** give every interactive element the 2px cobalt focus outline at a 2px offset.
- **Do** honour `prefers-reduced-motion`: the 150ms tab fade and every other animation switch off.

### Don't:
- **Don't** lay tiles out in a card grid, or box a paragraph.
- **Don't** put cobalt outside the Counted Accent Rule, or red on anything that is not a halt.
- **Don't** cast a shadow on the landing page, or use gradients, glass, 3D, stock illustration or an icon set beyond the few control glyphs.
- **Don't** set anything heavier than 600, add a third heading level, or track uppercase anywhere but the wordmark.
- **Don't** round past 4px on controls and panels.
- **Don't** draw window chrome or traffic-light dots on an output panel.
- **Don't** draw a trend arrow, health colour, score, gauge or progress ring on an indicator, or a stat tile for a number that changes monthly.
- **Don't** bring back revision 1: warm paper, vermilion, Archivo 800 or uppercase mono kickers.
