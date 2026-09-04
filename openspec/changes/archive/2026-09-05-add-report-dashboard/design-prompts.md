# Claude Design prompts — the HTML report surface

Three prompts for `/design`. Run them in order; each assumes the previous one's output exists on the canvas. They exist because `report/html-surface` inverts the normal dashboard brief: the hard problem here is rendering **absence** with the same authority as a number, and every default dashboard idiom gets that backwards.

Feed the designer real input, not invented figures. Generate it with:

```bash
interlock report --json > /tmp/report-sample.json
```

That sample is the honest case — on this repo most indicators come back `unobserved` with a reason string, which is exactly the state the design has to carry.

---

## Prompt 1 — The full report page

> Design a single-page instrument readout called **Interlock Report**. It renders as one self-contained HTML file that a developer opens locally after their spec-driven build loop has been running for a while. It is not a status page and not a dashboard: it reports what has been recorded about a development loop, and it is explicitly forbidden from issuing a verdict.
>
> The page has two parts, in this order:
>
> 1. **Coverage** — what the underlying data can and cannot answer. Three corpora were scanned (run trajectories, outcome records, review metrics). For each: how many files were found, how many were recognized, how many were excluded and why, and the names of the excluded ones.
> 2. **Indicators** — roughly eight measures, each with a value, a denominator, and often a per-item breakdown. Examples: "gate exits non-zero — 12.2% of 2379 observed", broken down by command.
>
> The single hardest constraint, and the thing to design around: **most indicators have no value.** They come back as `unobserved` or `NOT COMPUTABLE`, each carrying a sentence explaining why — for example "no run has written a receipt", or "no corpus records a comparison between the committed diff and the plan that produced it". These are not empty states, not errors, and not zeroes. They are findings, and they must read with exactly the same weight and typographic authority as an indicator that has a number. A reader skimming the page must never come away thinking an unobserved indicator measured zero.
>
> So: no greyed-out cells, no dashes, no collapsed or hidden sections, no "no data available" placeholders, no skeleton rows, no reduced opacity. The reason sentence is the content of that cell, not an apology for its absence. Design the page so it stays composed and purposeful when **every single indicator** is unobserved — that is the current real state of this data, not an edge case.
>
> Equally strict: nothing on this page may encode a judgement. No thresholds, no target lines, no red/amber/green, no trend arrows, no up-is-good, no progress bars implying a goal. Colour and weight carry structure and reading order only. If two indicators have wildly different values, they look identical in treatment.
>
> Aesthetic: a precision instrument or a scientific readout — a lab report, an oscilloscope panel, a well-set statistical table. Dense, calm, and confident. Monospace for figures so digits align in a column. Generous horizontal rules, minimal chrome, no cards-with-shadows. It should look like something that measures, not something that persuades. Support light and dark rendering, and stay fully legible in greyscale.
>
> Produce artboards for: the honest current state (almost everything unobserved), a mature state (most indicators carrying values and breakdowns), and the coverage section at full detail with a list of excluded files.

---

## Prompt 2 — The coverage block

> Refine the **Coverage** section from the Interlock Report page into its own component, at full detail.
>
> Its job is epistemic, and it comes first on the page for that reason: before a reader sees a single figure, they should understand what the figures rest on. It reports, per corpus:
>
> - Trajectories: `971 scanned of 971 on disk`, `with run-start: 2`, `with terminal event: 0`, `with receipt: 0` — plus a note that every receipt-derived indicator below rests on that last number.
> - Outcome corpus: `absent`, with the path that does not exist.
> - Review metrics: `0 recognized of 5 files`, then each unrecognized file named with its reason (`no schema key`).
>
> Design the relationship between a count and its qualifier so that a devastating number — `with receipt: 0` — reads as the load-bearing fact it is, without shouting, and without a warning icon or an alert colour. It is not an error. It is a measurement about the measurements.
>
> The dependency between a coverage figure and the indicators it gates is the interesting design problem: when `with receipt: 0`, four indicators downstream are unobservable *because of it*. Find a way to make that causal link visible on the page without a legend, a tooltip, a footnote marker, or an interaction — this file may be read as a printout.
>
> Excluded files must be named, not counted. Design the list so five names sit comfortably and fifty do not wreck the page.

---

## Prompt 3 — The indicator component, in all its states

> Design the repeating **indicator** component from the Interlock Report, as a small set of variants shown side by side so they can be compared directly.
>
> Every variant carries: a name, a value-or-absence, a denominator, and an optional breakdown of two to six sub-rows each with its own count and denominator.
>
> The variants:
>
> 1. **A rate with a breakdown** — `gate exits non-zero — 12.2% of 2379 observed`, then per-command rows like `wave-state record-batch — 194 of 569 non-zero`.
> 2. **A count with an exclusion note** — `runs per change — 1 of 2 observed, 969 not observed`, with a line explaining that 969 runs were attributed to no change and excluded.
> 3. **Unobserved** — no value; a reason sentence such as "no run has written a receipt" occupies the value position.
> 4. **Not computable** — structurally impossible from the recorded data, with a longer explanation *and* a statement of what would have to be recorded to make it computable. This variant carries the most text and must not look like a failure.
> 5. **A split figure that must never be summed** — one indicator reports review findings from two different writers as two separate series, and the page states they are never added together. Design that "these do not combine" so it survives a careless reader.
>
> All five variants must sit in a vertical list and read as one instrument. Variants 3 and 4 must not recede. If, standing back and squinting, the ones with numbers pop and the ones without fade, the design has failed its primary requirement.
>
> Show one bar-style graphic for variant 1's breakdown — inline SVG, hand-drawable in a few lines, no charting library. It has no axis labels, no gridlines, no threshold marker and no colour scale: it exists only so a reader can see the *shape* of a distribution across commands faster than reading six numbers. If the bar cannot earn its place under those constraints, show it as a table instead and say so.

---

## Prompt 4 — WebGL treatment (three.js / ThreeUI), replacing the default look

Run this **after** prompts 1–3 exist on the canvas. It re-skins them; it does not restart. Read the scope note under it before running — this prompt targets the design comp, and what it implies for the shipped file is an open question (D11).

Reference: [ThreeUI — Data Pixel Arc, Predictive Arc](https://threeui.com/backgrounds/predictive-arc/data-pixel) — "an emerald pixel horizon with an organic breathing band."

> Re-skin the Interlock Report page away from a default design-system look and toward a procedural WebGL treatment in the register of ThreeUI's *Data Pixel Arc* — an emerald pixel horizon with a slow organic breathing band. Assume three.js is available and drive the background with a fragment shader over a full-bleed canvas, with the readout composited above it.
>
> The whole difficulty is that this page is an instrument that is forbidden from issuing a verdict, and a glowing animated background is the most persuasive object you can put on a screen. Do not resolve that by turning the effect down until it is wallpaper. Resolve it by making the effect **carry a fact it is allowed to carry**:
>
> **Bind the pixel field to coverage, never to the indicators.** The horizon's pixel density, and how far the arc has resolved across the viewport, are driven by how much of the corpus has actually been observed — files scanned, records recognized, receipts present. It renders *how much has been measured*, which is a real quantity the page already reports. It must never be driven by an indicator's value, because that would make the background a health signal, and no part of this page is allowed to be one.
>
> On this repository's real data that field is almost entirely unresolved: a sparse scatter, an arc that never closes, a horizon that has barely formed. That is the honest state and it should be the default artboard. A reader seeing a near-empty field and a page full of "unobserved" should feel those two things agreeing with each other. Design the mature state too — a dense, fully-resolved horizon — so the range is visible, but the empty one is the one that has to look intentional rather than broken.
>
> Colour: one hue throughout, held constant regardless of any value on the page. Emerald is fine as identity, but nothing may shift toward red, amber or a warmer hue as a figure changes, and nothing may brighten because a number is high. If two artboards with wildly different indicator values are placed side by side, their palettes are indistinguishable.
>
> Legibility outranks the effect everywhere they compete. The readout sits on a solid or near-solid substrate, not directly on live pixels — text contrast is fixed and does not fluctuate as the shader animates beneath it. The breathing band is slow enough to read across (period measured in seconds, not frames), and motion never crosses the reading column. Provide a static-frame artboard that holds up with animation disabled, and treat `prefers-reduced-motion` as a first-class state, not a fallback: it freezes to a composed still, not to a blank rectangle.
>
> Keep every structural rule from prompts 1–3 intact — coverage first, absence at full weight with its reason as content, no thresholds, no trend arrows, no colour encoding health. The WebGL layer changes the register, not the epistemics. If any part of the effect can only be made to work by softening one of those rules, drop that part of the effect and say which rule it collided with.
>
> Produce artboards for: the honest current state (sparse field, near-empty page), the mature state (resolved horizon, populated indicators), a static/reduced-motion frame, and a light-mode variant if the treatment survives one — if it does not, say so rather than forcing it.

**Scope note — read before running.** This prompt targets the **design comp**, not `lib/report-html.mjs`. Three constraints stand between it and shipped output, and D11 records the question rather than settling it:

- `report/html-surface` requires the document to reference no external script and need no runtime dependency. Raw three.js *can* satisfy this if vendored and inlined (~600 KB, one `<script>`, no network) — **ThreeUI itself cannot**, because it is a React npm package (`@designcodeio/threeui`) with its component source behind Pro access.
- `package.json` declares no `dependencies` and the repo has no build step. Vendoring three.js is the first dependency the project would carry.
- D6 chose hand-emitted inline SVG precisely to avoid a library. A WebGL background is not a chart, so it does not contradict D6 directly, but it does contradict the instrument aesthetic D3 and D5 were reasoning from.

If the comp is approved as the shipping target, `report/html-surface` needs an amended self-containment requirement, D6 needs a companion decision, and a task for vendoring three.js belongs in `tasks.md`. If it is approved only as an exploration, none of that applies and the shipped file stays as specified.
