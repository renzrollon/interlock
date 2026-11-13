# Design prompt — README proof frames (the guard and the settle verdict)

This file is the source for four images that do not exist yet: `guard-deny-light.png`, `guard-deny-dark.png`, `settle-verdict-light.png` and `settle-verdict-dark.png`, all under `docs/assets/`. It carries every line of text they show and where each line came from. Same convention as [`DESIGN-PROMPT.md`](./DESIGN-PROMPT.md): **when a line on an image goes stale, fix it here first**, then regenerate.

The README does not reference these images. Its "Why Interlock" and "Then settle the pull request" sections read complete as text. Appendix D has the snippets to paste once the PNGs are exported.

The two frames are different kinds of evidence, and the alt text keeps them apart:

- **W1 is example output.** The reason line is what `hooks/guard-tests.mjs` returns, produced by running the hook itself (Appendix C). The run around it is constructed: a temporary directory and a stage marker written for the purpose. Its alt text says "example output".
- **W2 is a real pull request.** It is the merge-confidence block `/interlock:settle` wrote into the description of [#33](https://github.com/renzrollon/interlock/pull/33), merged on 2026-11-05. Its alt text says so.

**Brand.** The current design system under `site/ds/interlock/` (`tokens.json` version 2: white ground, cobalt, IBM Plex). Not the warm palette described at the top of `DESIGN-PROMPT.md`, which the older boards were exported in.

---

## The prompt

Attach the Interlock design system (the `site/ds/interlock/` folder), then paste everything from here to the end of Appendix B into Claude Design.

---

You are producing four PNG artboards for the GitHub README of **Interlock**, a Claude Code plugin for spec-driven development. Take every colour, typeface, radius and spacing value from the attached Interlock design system. Where this brief and the design system disagree, the design system wins; tell me where they disagreed.

The rules that matter here, repeated so this brief stands alone:

- **Ground.** `poster-ground` (`#ffffff`) in the light theme, `color-bg` (`#0d1117`) in the dark theme.
- **One hue.** Cobalt: `poster-accent` (`#1d5bd6`) on the page, `term-accent` (`#79a9ff`) inside a terminal panel. No second accent. No amber and no green anywhere, even though the word `amber` appears in the text: it is the tool's name for a band, and it stays as text.
- **Red means a halt and nothing else.** Neither board shows a halt, so neither uses `color-halt` or `term-halt`.
- **Type.** IBM Plex Sans and IBM Plex Mono only. Nothing heavier than 600. Every command, path, signal name and quoted value is mono.
- **Panels.** 4 px radius, a 1 px edge, no shadow, no gradient. No window chrome, no traffic-light dots, no GitHub chrome (no avatar, no logo, no fake comment box), no icons, no mascots, no stock illustration.
- **One mono caption line above each panel** says what printed it, in `poster-grey` (light) or `color-text-soft` (dark).

**The text on every board is fixed. It is given verbatim in Appendix B. Do not invent, shorten, paraphrase, reorder or "improve" any line, and do not add lines that are not there.** If a board cannot hold its block, make the board taller; do not shrink the type below 22 px and do not cut a line. If you believe a line is wrong, leave it and flag it in a note beside the artboard. The value of these images is that every line is something the tool actually printed.

### Artboards

| # | Filename | Size | Theme | Content | Caption above the panel |
|---|---|---|---|---|---|
| 1 | `guard-deny-light.png` | 1600 × 700 | light | **W1**, a terminal panel | `guard-tests — mid-fix, an edit to the test is denied; an edit to the code is not` |
| 2 | `guard-deny-dark.png` | 1600 × 700 | dark | same as 1 | same as 1 |
| 3 | `settle-verdict-light.png` | 1600 × 1100 | light | **W2**, a document panel | `/interlock:settle — the verdict it wrote on Interlock's own pull request #33` |
| 4 | `settle-verdict-dark.png` | 1600 × 1100 | dark | same as 3 | same as 3 |

Heights are a starting point. Take a board taller when its block does not fit, and tell me the size you used.

### Boards 1 and 2 — the terminal panel (W1)

- Panel fill `term-ground` (`#0f141a` light theme, `#161c24` dark theme). Default text `term-text` (`#d6dce4`).
- Lines marked **[dim]** in Appendix B are the page's own narration: `term-dim` (`#8e98a6`). They start with `#` so nobody reads them as output.
- The line marked **[accent]** is `term-accent` (`#79a9ff`). It is the only coloured line on the board.
- The long reason line wraps at the panel edge, as a terminal would. Do not truncate it and do not put an ellipsis on it.
- One blank line between the denied edit (the first four lines) and the allowed edit (the last two).
- Page margin 56 px, panel padding 40 px, mono 24 px, line height 1.45.

### Boards 3 and 4 — the document panel (W2)

This block is markdown in a pull request description, not terminal output, so it does not go on `term-ground`. Set it as a document:

- Panel fill `color-surface` (`#f5f7fa` light, `#151b23` dark) with a 1 px `color-divider` edge. Text in `color-text`.
- `Merge confidence` is the panel's heading: IBM Plex Sans, `title-lg`, 500.
- The verdict line is the one heavy line on the board. Set the word `HUMAN` as a filled block: `poster-accent` ground with `poster-on-accent` text in the light theme, `color-accent` ground with `color-on-accent` text in the dark theme. It is the only filled shape on the board. In this brand the filled cobalt block is where a person decides, and `HUMAN` means exactly that. The rest of the line (`· score 54 (amber range 40–79; 6 of 17 gating signals clean)`) follows it in `color-text`, IBM Plex Sans.
- `Needs a fix`, `Needs a person` and `Needs more evidence` are group labels: IBM Plex Sans, 600, with a 1 px `color-divider` rule above each.
- Every item under a group: the signal name (`spec.coverage`, `risk.class`, …) in IBM Plex Mono 500, the band in parentheses in `color-text-soft`, then the reason in IBM Plex Mono 400. A long reason wraps under itself, aligned with the start of the reason, not under the signal name.
- The last line: the word `Labels` in IBM Plex Sans 600, then the two label names as neutral tags (`color-surface-2` ground, 1 px `color-border` edge, IBM Plex Mono). Not GitHub's label colours, and not cobalt.
- Page margin 56 px, panel padding 40 px, body 24 px, line height 1.5.

### Alt text (deliver beside each artboard; it goes in the README)

- guard-deny: `Example output of Interlock's guard-tests hook. While a run is fixing a failing check, an edit to test/pricing.test.mjs is denied, with the reason that a run making a failing check pass must fix the code under test, not weaken the check. An edit to src/pricing.mjs is allowed.`
- settle-verdict: `The merge-confidence block /interlock:settle wrote on Interlock's pull request 33: HUMAN, score 54, 6 of 17 gating signals clean. One signal needs a fix (two added source files no spec names), three need a person (risk class high, a diff over the size bands, two open decisions) and three need more evidence. Labels: interlock/human-review and interlock/score-54.`

---

## Appendix B — the text, verbatim

### W1 — the guard's denial (`hooks/guard-tests.mjs`)

```
# A run is fixing a failing check. An agent tries to edit the test.              [dim]
Edit test/pricing.test.mjs
"permissionDecision":"deny"                                                       [accent]
guard-tests: editing the test file test/pricing.test.mjs is blocked during the remediation stage — a run making a failing check pass must fix the code under test, not weaken the check. If the test itself is wrong, stop the run and correct it outside remediation.

# The same agent edits the code under test. The hook prints nothing: allowed.    [dim]
Edit src/pricing.mjs
```

The `[dim]` and `[accent]` markers are instructions, not text. They do not appear on the board.

### W2 — the merge-confidence block on pull request #33

Render the markdown: `**…**` is the bold run, a backticked run is mono, and a line starting `- ` is a list item. The asterisks, backticks and hyphens themselves do not appear on the board.

```
## Merge confidence

**HUMAN** · score 54 (amber range 40–79; 6 of 17 gating signals clean)

**Needs a fix**

- `spec.coverage` (amber): `2 added source file(s) no spec names: lib/review-fanout.mjs, lib/review-scope.mjs`

**Needs a person**

- `risk.class` (amber): `class high is outside MERGE_ALLOWED_CLASSES (low, medium), so a person decides`
- `diff.shape` (amber): `4429 changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = 400; 64 changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = 20`
- `decisions.open` (amber): `the decision ledger holds 2 needs-human row(s)`

**Needs more evidence**

- `review.ran` (amber): `dimension(s) with unread inputs: language, technical-lead, regression, domain, blast-radius`
- `conformance.delta` (amber): `1 of 67 scenario(s) unconfirmed`
- `run.integrity` (unobserved): `no run record: this assessment was not made by a ship run, which writes one at close`

**Labels:** `interlock/human-review`, `interlock/score-54`
```

---

## Appendix C — how Appendix B was produced

### W1

Where each line comes from:

| Line | Source |
|---|---|
| The two `#` lines | Narration, written for this board. The `#` and the dim colour mark them as the page's words, not the tool's |
| `Edit test/pricing.test.mjs`, `Edit src/pricing.mjs` | The hook's input: the tool name and the path from the event it was handed on stdin |
| `"permissionDecision":"deny"` | A fragment of the hook's stdout, verbatim |
| The `guard-tests:` line | The value of `permissionDecisionReason` in the same stdout, verbatim |

Run this from the repository root. It builds a throwaway directory holding a test profile and a stage marker for the `remediation` stage, then hands the real hook two `Edit` events. Nothing in the repository is touched.

```bash
node --input-type=module -e '
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { writeStage } from "./lib/ship-stage.mjs"
const root = mkdtempSync(join(tmpdir(), "guard-capture-"))
mkdirSync(join(root, ".claude", "testing"), { recursive: true })
mkdirSync(join(root, "test"), { recursive: true })
writeFileSync(join(root, ".claude", "testing", "profile.json"), JSON.stringify({ unit: { command: "npm test", cwd: "." } }))
writeFileSync(join(root, "test", "pricing.test.mjs"), "// a test\n")
writeStage("open-the-second-counter", "remediation", { root, pid: process.pid })
for (const file of ["test/pricing.test.mjs", "src/pricing.mjs"]) {
  const event = { hook_event_name: "PreToolUse", tool_name: "Edit", cwd: root,
    tool_input: { file_path: join(root, file), old_string: "a", new_string: "b" } }
  const r = spawnSync(process.execPath, ["hooks/guard-tests.mjs"], { input: JSON.stringify(event), encoding: "utf8" })
  console.log(`Edit ${file}\n${r.stdout.trim() || "(no output: allowed)"}\n`)
}
'
```

Output on 2026-11-13, at version 1.16.1:

```
Edit test/pricing.test.mjs
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"guard-tests: editing the test file test/pricing.test.mjs is blocked during the remediation stage — a run making a failing check pass must fix the code under test, not weaken the check. If the test itself is wrong, stop the run and correct it outside remediation."},"interlockGuard":{"guard":"guard-tests","path":"test/pricing.test.mjs","stage":"remediation"}}

Edit src/pricing.mjs
(no output: allowed)
```

The reason is assembled in `hooks/guard-tests.mjs`. Regenerate the board when that wording changes. Two things the board does not show, and its caption must not claim: how Claude Code presents a denial to the person watching, and that the guard always denies. It **fails open**: with no stage marker it allows every edit ([13 — The guards](../13-the-guards.md#the-fail-open-rule)).

### W2

```bash
gh pr view 33 --repo renzrollon/interlock --json title,mergedAt,labels,body
```

The block is the part of `body` under `## Merge confidence`. Four parts of the real block are left off the board on purpose, each a whole line or element:

- the italic note under the verdict line, which says what `MERGE` does and does not mean (this verdict is `HUMAN`);
- the `Assessed commit …` line;
- the `**Flags:**` line;
- the collapsed `All 18 signals` table.

A merged pull request does not change, so W2 goes stale only if a better example replaces it. Reasons to replace it: a later pull request whose block has a different shape, or the block's format changing in `lib/merge-confidence.mjs`.

## Appendix D — where each file goes

Export all four into `docs/assets/`. After the export, check every board line by line against Appendix B, then add a `## Produced <date>` section to this file recording the sizes used and any deviation, as `DESIGN-PROMPT.md` does.

**`guard-deny`** goes in the README's "Why Interlock" section, between the list and the "Built with itself" line:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/guard-deny-dark.png">
    <img src="docs/assets/guard-deny-light.png" alt="…guard-deny alt text from above…" width="800">
  </picture>
</p>
```

**`settle-verdict`** is for the places markdown does not render: the landing site, a release post, a social post. The README's "Then settle the pull request" section already quotes the same lines as a blockquote, which GitHub renders natively and a screen reader reads in full, so the recommendation is to leave the README as text. To use the image there anyway, replace the blockquote (keep the provenance line under it) with:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/settle-verdict-dark.png">
    <img src="docs/assets/settle-verdict-light.png" alt="…settle-verdict alt text from above…" width="800">
  </picture>
</p>
```

| File | Used by |
|---|---|
| `guard-deny-light.png`, `guard-deny-dark.png` | `README.md`, "Why Interlock" (after you paste the snippet); a candidate for `docs/13-the-guards.md` |
| `settle-verdict-light.png`, `settle-verdict-dark.png` | The landing site and posts; optionally `README.md` and `docs/15-merge-confidence.md` |

Any image added to the README needs its alt text. [`ACCESSIBILITY.md`](../../ACCESSIBILITY.md) says what the README promises about images.
