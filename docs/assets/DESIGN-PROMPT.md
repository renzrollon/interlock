# Design prompt — README hero and docs frames

This file is the source for the images under `docs/assets/`. It carries every line of text the images show, with where that text came from, so an image can be regenerated when the CLI's output changes without re-running anything expensive. Same convention as `site/README.md`: **when a line on an image goes stale, fix it here first**, then regenerate.

Every terminal line in Appendix B was produced by this repository's own code (`interlock waves`, `interlock doctor`, `interlock limits`, and `lib/receipt.mjs`'s `formatRunSummary`). Appendix C says exactly how. The three run summaries are renderer output over constructed inputs, not a run that happened; alt text says "example output", never "a real run".

---

## The prompt

Paste everything from here to the end of Appendix B into Claude Design.

---

You are producing a set of PNG artboards for the GitHub README and docs of **Interlock**, a Claude Code plugin for spec-driven development. The existing brand is the poster at `docs/assets/interlock-flow-wide.png`: a warm off-white ground, near-black ink, one accent (a burnt red-orange used for the wordmark, rules and the single highlighted block), a tight grotesque headline face, and a monospace face for labels and terminal text. Match it exactly. Do not introduce a second accent colour, gradients, drop shadows, glassmorphism, or a fake macOS window chrome with traffic-light dots.

Every artboard is a **terminal frame**: a rounded rectangle (radius 12) filled with a near-black terminal ground in the light theme, carrying monospace text at a size that stays legible when the PNG is displayed at half its pixel width. One-line monospace caption above or beside the frame in the brand's small-caps label style, in ink on the off-white page ground. Nothing else: no mascots, no icons, no vendor logos, no stock illustrations.

**The text inside every frame is fixed. It is given verbatim in Appendix B. Do not invent, shorten, paraphrase, reorder or "improve" any line. Do not add lines that are not there.** If a frame needs to be shorter, cut whole lines from the bottom of the block and say which ones you cut. If you believe a line is wrong, leave it and flag it in a note beside the artboard. The value of these images is that every line is something the tool actually prints.

Colour inside the frame: default text in the terminal's light grey; the lines marked **[accent]** in Appendix B in the brand accent; the lines marked **[dim]** in a dimmer grey. No other colouring, no syntax highlighting.

### Artboards

Produce these artboards, each exported as a PNG at the stated pixel size and filename.

| # | Filename | Size | Theme | Frame content (Appendix B block) | Caption |
|---|---|---|---|---|---|
| 1 | `hero-light.png` | 1800 × 1000 | light | **B1** plan preview (top ~55%) then a thin rule then **B2** summary tail | `/interlock:ship — the plan is named before anything is spawned, and the run ends in a commit` |
| 2 | `hero-dark.png` | 1800 × 1000 | dark | same as 1 | same as 1 |
| 3 | `social-preview.png` | 1280 × 640 | light | No terminal. Poster crop: wordmark `INTERLOCK`, headline `Two commands. One human checkpoint.`, and beneath it the two commands from **B0** in monospace | none |
| 4 | `doctor.png` | 1600 × 880 | light | **B3** | `interlock doctor — one failing check, and the fix, before a run starts` |
| 5 | `plan-preview.png` | 1600 × 1300 | light | **B1** in full | `interlock waves — two tasks share a file, so they run in one lane, in order` |
| 6 | `halted.png` | 1600 × 720 | light | **B4** | `SHIP HALTED — the budget was spent, the leftover is named, the banner says what degraded` |
| 7 | `strict-complete.png` | 1600 × 800 | light | **B5** | `ship --strict — 9 raised, 4 dismissed by skeptics, 3 survived to a human` |
| 8 | `limits.png` | 1600 × 900 | light | **B6** | `interlock limits — every cap the run obeys, none of them in a prompt` |

**Light theme** means the off-white page ground with a near-black terminal frame. **Dark theme** means a near-black page ground with a slightly lighter charcoal terminal frame, ink and captions inverted to off-white, accent unchanged. Only the hero has a dark variant; GitHub swaps it with `<picture>`.

### Layout rules

- Page margin 72 px on the 1800-wide boards, 56 px on the 1600-wide boards. Caption sits above the frame, left-aligned to the frame edge, 20 px gap.
- Frame padding 40 px. Monospace text 26 px on 1800-wide boards, 24 px on 1600-wide boards, line height 1.45. If a block does not fit at that size, cut lines from the bottom as instructed above; do not shrink below 22 px.
- The hero (artboards 1–2) is the only board with two blocks. Separate them with a 1 px rule in the dim grey and 28 px of space either side. B2 is the last five lines of the block only if space is short; keep `commit:` and the final `No degradation banners` line at all costs.
- The social preview (artboard 3) follows the poster's left column: wordmark top-left with the accent rule under it, headline at roughly 96 px, the two commands at 30 px monospace, 40 px below the headline. Leave the right 30% empty. It is displayed at 640 px wide in link previews, so nothing below 28 px.
- Long lines in B3 wrap in the real terminal. Wrap them at the frame edge with a 4-space hanging indent, exactly as a terminal would; do not truncate with an ellipsis.

### Alt text (deliver beside each artboard, it goes in the README)

- hero: `Example output of /interlock:ship: the plan preview names the mode, six tasks in two waves with a maximum of eight parallel agents, two tasks serialized because they share a file; the run ends with SHIP COMPLETE, a commit hash and no degradation banners.`
- doctor: `Example output of interlock doctor: nine checks, one FAIL on the missing test profile with the command that fixes it, and the permission allowlist reported as complete.`
- plan-preview: `Example output of interlock waves: mode, wave and lane layout, and the warnings explaining each fold and serialization.`
- halted: `Example SHIP HALTED summary: the halt reason, the one leftover task, a push notification sent, and a MODEL ROUTING OVERRIDDEN banner.`
- strict-complete: `Example ship --strict summary: nine findings raised, four dismissed by skeptics, two dropped as too weak, three surviving; three fixed; six of six spec scenarios confirmed; a commit.`
- limits: `Example output of interlock limits: the caps the ship loop obeys, printed by the CLI.`

---

## Appendix B — the text, verbatim

### B0 — the two commands (social preview only)

```
/interlock:spec "<idea>"
/interlock:ship
```

### B1 — plan preview (`interlock waves`)

```
$ interlock waves --classified .claude/ship/classified.json
mode: waves (default)                                                        [accent]
6 tasks → 2 wave(s), 5 impl + 1 test, max 8 parallel                        [accent]
  Wave 1: 2 task(s)
    lane [sonnet/T2] 2 tasks, one agent, in order:
    - [haiku/T1] 1.1 Add formatCount and formatBytes to src/format.mjs
    - [sonnet/T2] 1.2 Add formatDuration with sub-second rounding
  Wave 2: 3 task(s) in 2 batches
    lane [sonnet/T3] 2 tasks, one agent, in order:
    - [sonnet/T3] 2.1 Add summarize() over a receipt in src/summary.mjs
    - [sonnet/T2] 2.2 Wire summarize into the CLI report path
    - [haiku/T1] 3.1 Document every export under an API heading in README.md
  Test wave: 1 task(s)
    - [sonnet/T2] 4.1 Unit tests for format and summary
  serialized 1.2: same lane in wave 1 (src/format.mjs held by 1.1)           [accent]
  folded 3.1: 1-task wave 3 → later batch of wave 2
  lane 1.1 → 1.2: 2 tasks in wave 1 on one sonnet/T2 agent
  cohesion 2.1 → 2.2: 2 path-disjoint tasks in wave 2 on one sonnet/T3 agent (cap 6)
  effort 1.1 → 1.2: low (tier 2)
  effort 2.1 → 2.2: inherited (by policy) (tier 3)
projected agents: 9 (4 implementers + 3 record + 2 verify)
  warning: effectively serial: 2 waves for 3 implementation lane(s)          [dim]
  warning: tasks 1.1, 1.2 share a file in wave 1; folded into one lane run by a single tier-2 agent in that order   [dim]
  warning: tasks 2.1, 2.2 are path-disjoint tier-3 work in wave 2; packed into one cohesion lane run by a single agent in that order (tier-3 lane cap 6)   [dim]
  warning: task 3.1 was a 1-task wave in group 3; folded into wave 2 as a later batch — ordering is kept, the checkpoint is not   [dim]
  warning: task 1.2 serialized in wave 1: it claims src/format.mjs, already claimed by 1.1 — they run in one lane, in task-id order   [dim]
```

For the hero, use the first two lines, the two `Wave` headers with their task lines, the `serialized` line and the `projected agents` line. Cut the `effort`, `cohesion`, `lane`, `folded` and `warning` lines.

### B2 — summary tail, lean run (rendered by `formatRunSummary`)

```
SHIP COMPLETE — add-format-summary                                           [accent]
  PLAN REBUILT (no-prior-plan): no stored plan for this change
  wave 1 (code): 2 ok, 0 failed
  wave 2 (code): 2 ok, 0 failed
  commit: 7316321                                                            [accent]
  run: 2026-09-13T14-02-11Z-add-format-summary
  project: interlock
  cwd: /Users/you/projects/interlock
ARCHIVE PENDING — add-format-summary: after merge, run openspec archive add-format-summary
Do not start another ship run unless the user asks.

LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable   [dim]
No degradation banners — graph, test profile, model routing, verification and e2e were all clean.
```

### B3 — preflight (`interlock doctor`, this repository, 2026-09-13)

```
$ interlock doctor
PREFLIGHT BLOCKED — 1 check(s) would stop a zero-touch run, 1 warning(s)     [accent]
  root: /Users/you/projects/interlock
  [ok  ] node: Node v24.19.0 (plugin requires >=18, OpenSpec requires 20.19.0+)
  [ok  ] plugin: plugin 1.0.2 complete: workflow, both agent types, both binaries
  [warn] binaries: interlock, interlock-graph not on PATH — present in the plugin's bin/, which Claude Code injects inside a session
      fix: Nothing to do for a run inside Claude Code. For a plain shell: export PATH="/Users/you/projects/interlock/bin:$PATH"
  [ok  ] openspec: openspec CLI available and this project is initialised
  [ok  ] git: git version 2.55.0 in a work tree
  [FAIL] test-profile: .claude/testing/profile.json is missing, so verification has no command to run and continuity refuses to start   [accent]
      fix: Run /interlock:fix-tests once to discover and persist the project test setup.   [accent]
  [ok  ] permissions: all 7 required commands are allowed
  [ok  ] state-dirs: every run-state directory is writable or creatable
  [skip] notify: INTERLOCK_NTFY_TOPIC is not set — optional; an unattended run that stops will not reach you   [dim]
```

(The real output continues with three more `[skip]` rows — `prompt-cache`, `evals-harness`, `evals-credential`. Cut for length; the frame ends at `notify`.)

### B4 — halted run (rendered by `formatRunSummary`)

```
SHIP HALTED — unit suite red after 2 root-cause repairs — budget spent       [accent]
  leftover tasks (boxes still unchecked): 3.1
  PLAN REUSED (fingerprint-match): planning inputs unchanged
  wave 1 (code): 2 ok, 0 failed
  wave 2 (code): 1 ok, 1 failed
  run: 2026-09-13T15-40-52Z-add-format-summary
  project: interlock
  cwd: /Users/you/projects/interlock
  push: sent (ntfy)
Do not start another ship run unless the user asks.

LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable   [dim]
MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=sonnet — every tier ran on sonnet   [accent]
```

### B5 — strict run (rendered by `formatRunSummary`)

```
SHIP COMPLETE — add-format-summary                                           [accent]
  PLAN REBUILT (no-prior-plan): no stored plan for this change
  wave 1 (code): 2 ok, 0 failed
  wave 2 (code): 2 ok, 0 failed
  review: 9 raised, 4 dismissed by skeptics, 2 dropped as too weak to report, 3 surviving   [accent]
  remediation: 3 fixed, 0 deferred
  handoff: manual test plan skipped (not UI-testable)
  conformance: 6/6 scenarios confirmed
  commit: 7316321                                                            [accent]
  run: 2026-09-13T16-11-03Z-add-format-summary
  project: interlock
  cwd: /Users/you/projects/interlock
ARCHIVE PENDING — add-format-summary: after merge, run openspec archive add-format-summary
Do not start another ship run unless the user asks.

No degradation banners — graph, test profile, model routing, verification and e2e were all clean.
```

### B6 — the envelope (`interlock limits`, v1.0.2)

```
$ interlock limits
  max parallel agents per batch                   8                          [accent]
  inter-wave fix attempts (per wave)              2
  replans (per run)                               2
  remediation rounds                              2                          [accent]
  root-cause iterations (per run)                 5
  task failures tolerated                         2
  run steps (per run)                             200
  inter-wave verify budget                        60s
  inter-wave verifications (per run)              3

  lane cap: tier 1 lane (also untiered)           8
  lane cap: tier 2 lane                           8
  lane cap: tier 3 lane                           6
  lane cap: tier 4 lane                           4
  lane cap: tier 5 lane                           8
  cohesion tier ceiling (packs at or below)       3
  solo envelope (max tasks in one lane)           20
```

(The real output continues with verify, review-policy, push, eval and price rows. Cut for length.)

---

## Appendix C — how Appendix B was produced

Run from the repository root. Re-run these when a version bumps, diff against Appendix B, and update the blocks before regenerating.

```bash
interlock doctor          # B3 — this checkout; the [FAIL] row appears because the repo has no test profile
interlock limits          # B6
```

B1 is `interlock waves --classified classified.json` over this input (the same shape `test/spine/waves.test.mjs` builds):

```json
{
  "tasks": [
    { "id": "1.1", "group": 1, "description": "Add formatCount and formatBytes to src/format.mjs", "isTestTask": false, "tier": 1, "model": "haiku", "paths": ["src/format.mjs"] },
    { "id": "1.2", "group": 1, "description": "Add formatDuration with sub-second rounding", "isTestTask": false, "tier": 2, "model": "sonnet", "paths": ["src/format.mjs"] },
    { "id": "2.1", "group": 2, "description": "Add summarize() over a receipt in src/summary.mjs", "isTestTask": false, "tier": 3, "model": "sonnet", "paths": ["src/summary.mjs"] },
    { "id": "2.2", "group": 2, "description": "Wire summarize into the CLI report path", "isTestTask": false, "tier": 2, "model": "sonnet", "paths": ["bin/report.mjs"] },
    { "id": "3.1", "group": 3, "description": "Document every export under an API heading in README.md", "isTestTask": false, "tier": 1, "model": "haiku", "paths": ["README.md"] },
    { "id": "4.1", "group": 4, "description": "Unit tests for format and summary", "isTestTask": true, "tier": 2, "model": "sonnet", "paths": ["test/format.test.mjs"] }
  ]
}
```

B2, B4 and B5 are `formatRunSummary` from `lib/receipt.mjs` over constructed summaries whose shape follows `evals/ship/sample/clean-run.json`:

```bash
node --input-type=module -e '
import { formatRunSummary } from "./lib/receipt.mjs"
const id = { projectSlug: "interlock", root: "/Users/you/projects/interlock" }
const waves = [{ wave: "1", kind: "code", ok: 2, failed: 0 }, { wave: "2", kind: "code", ok: 2, failed: 0 }]
const rebuilt = { reused: false, status: "no-prior-plan", reason: "no stored plan for this change" }
console.log(formatRunSummary({ change: "add-format-summary", ...id, runId: "2026-09-13T14-02-11Z-add-format-summary",
  summary: { plan: rebuilt, waves, commit: { ok: true, sha: "7316321" } },
  flags: { review: false, handoff: false, conformance: false }, unarchived: { thisChange: true, others: 0 } }))
console.log(formatRunSummary({ change: "add-format-summary", ...id, runId: "2026-09-13T15-40-52Z-add-format-summary",
  summary: { halted: "unit suite red after 2 root-cause repairs — budget spent",
    plan: { reused: true, status: "fingerprint-match", reason: "planning inputs unchanged" },
    waves: [waves[0], { wave: "2", kind: "code", ok: 1, failed: 1 }] },
  flags: { review: false, handoff: false, conformance: false }, leftoverTaskIds: ["3.1"], push: { sent: true },
  degradations: ["MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=sonnet — every tier ran on sonnet"] }))
console.log(formatRunSummary({ change: "add-format-summary", ...id, runId: "2026-09-13T16-11-03Z-add-format-summary",
  summary: { plan: rebuilt, waves, review: { raised: 9, dismissed: 4, droppedByQuality: 2, surviving: 3 },
    remediation: { fixed: 3, deferred: 0 },
    handoff: { manualTestPlan: false, skipReason: "not UI-testable", scenariosChecked: 6, scenariosUnconfirmed: 0 },
    commit: { ok: true, sha: "7316321" } },
  flags: { review: true, handoff: true, conformance: true }, unarchived: { thisChange: true, others: 0 } }))
'
```

The `MODEL ROUTING OVERRIDDEN` banner text in B4 is the shape `docs/04-when-it-stops.md` documents; check it against `workflows/ship.js` when regenerating.

## Produced 2026-09-13

The boards in this folder were generated from this prompt in Claude Design. Two deviations from the first draft of the table above, both recorded there now:

- **Taller boards where the text did not fit.** At the stated margins and a 22 px floor, a 1800 × 600 hero holds eight lines and a 1600 × 720 board fifteen. The hero, `doctor`, `plan-preview` and `limits` boards were taken at the taller sizes so nothing in their block had to be cut. The hero renders 900 × 500 in the README, which still fits above the fold under a two-line header and one badge row.
- **Accent value on the dark terminal ground is `#ff563c`**, the repository's own dark-theme value of the same token (`site/index.html`), because the poster's `#c4441c` measures 3.3:1 on near-black and is not readable as body text. Same token, not a second accent.

Every frame's text was checked line by line against Appendix B; nothing was invented or reworded. The 600 px hero and the 720 px docs boards from the same run are not used.

## Appendix D — where each file goes

```html
<!-- README.md, replacing the current <p align="center"> block -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.png">
  <img src="docs/assets/hero-light.png" alt="…hero alt text from above…" width="900">
</picture>
```

| File | Used by |
|---|---|
| `hero-light.png`, `hero-dark.png` | `README.md` hero |
| `social-preview.png` | GitHub → Settings → General → Social preview (uploaded, not committed to a path the README reads) |
| `doctor.png`, `plan-preview.png` | `docs/01-first-hour.md` (allowlist step; ship step) |
| `halted.png` | `docs/04-when-it-stops.md` (reading a `SHIP HALTED` run) |
| `strict-complete.png` | `docs/06-why-it-works.md` §7 (reviews) |
| `limits.png` | `docs/07-cli-and-configuration.md` |

`interlock-flow-wide.png` stays: `docs/09` uses it, and it remains the right image for the flow. Its ship strip reads `waves → review → remediate → verify → commit`, which is the `--strict` sequence; if it is regenerated, the default strip is `waves → verify → commit`.
