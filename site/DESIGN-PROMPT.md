# Claude Design prompt: the Interlock landing site

**How to use this file.** Open Claude Design (claude.ai/design, or the `design` skill inside Claude Code), start a new project, and paste everything from `BEGIN PROMPT` to the end of the file. Ask for the output as one `index.html`. When it comes back, drop it at `site/index.html` in this repository; `.github/workflows/pages.yml` deploys it on the next push to `main`. Every fact the page states is in the appendices, pinned to Interlock **v0.3.0**. When a fact changes, change it here first and regenerate.

---

BEGIN PROMPT

## 0. What to build

Build a single-page, interactive landing site for **Interlock**, an open-source Claude Code plugin for autonomous spec-driven development, layered on OpenSpec. Deliver it as **one self-contained `index.html`**: inline CSS, inline SVG, vanilla JavaScript, no framework, no build step, no runtime fetch except web fonts. It is served as-is from GitHub Pages at `https://renzrollon.github.io/interlock/`.

The page has one job: convince an engineering team that already uses Claude Code to install Interlock and run one change through it this week. Everything on the page serves that, and everything it states must be true of Interlock v0.3.0 exactly as the appendices describe it. Do not invent features, numbers, quotes, logos, customer names, testimonials, or benchmarks. If a section would need something the appendices do not supply, leave the section out.

## 1. Who is reading, and what they need to believe

Readers are staff and principal engineers, engineering managers, and platform or developer-experience leads. They already run coding agents every day. They have been burned: an agent that argued its way past a rule, a run that stopped to ask a question at two in the morning, two parallel agents that overwrote each other, a review so noisy they learned to skim it, a spec that rotted the week after it shipped. They are allergic to hype and will judge the page by whether its claims can be checked.

For a reader to say yes, the page has to establish these six things, in this order:

1. **The problem is structural, not a prompting problem.** A rule written in a prompt is a suggestion. A plan carried in a context window gets forgotten mid-run. Context runs out before a forty-file change does.
2. **Interlock's answer is structural.** The loop is a script a runtime executes. The rules are a CLI that exits with a number. The model does the judgement work and nothing else. The axis Interlock competes on: **how many decisions the model is not allowed to make.**
3. **There is exactly one human stop, and it is the cheap one.** You read the spec. Everything after that runs unattended and is structurally unable to ask you anything.
4. **Every decision the loop made can be re-run on a laptop** without a model or the network, and every run leaves a receipt, a trajectory and an outcome record.
5. **The costs are stated next to the benefits.** Claude Code only. Workflow runtime required. Adversarial review is opt-in. Structural graph indexing covers three language families. The project is at 0.3.0.
6. **The first hour is concrete.** Six commands, one ten-minute read, one commit.

## 2. Voice

Dry, precise, confident, slightly contrarian. Short declarative sentences. Every benefit has its cost stated beside it. No exclamation marks. No emoji in copy. Headlines are claims, not labels: "A dismissal must cite evidence" rather than "Adversarial review". Where Appendix H has a line that says it, use that line verbatim rather than paraphrasing.

Banned words and phrases: revolutionary, seamless, supercharge, unleash, effortless, magical, AI-powered, 10x, game-changing, next-generation, cutting-edge, "simply", "just", "easily", "powerful", "robust", "leverage", "unlock", "empower", "delight".

## 3. Brand and visual system

The project already has one visual, a flow diagram, and the site extends it. You cannot see it, so here it is in words: an off-white paper ground; a wordmark **INTERLOCK** in a wide-tracked monospace, vermilion, over a thin vermilion rule; a very large, very heavy grotesk headline in near-black ("Two commands. One human checkpoint."); on the right, a vertical ladder of four commands (`bootstrap`, `spec`, `ship`, `mr`) separated by hairlines, each with a small uppercase mono eyebrow above it ("RUN ONCE, AFTER YOU CLONE", "THEN, EVERY CHANGE") and a right-aligned mono summary ("explore → artifacts → review"); between `spec` and `ship`, one solid vermilion block, full width, white text: "THE ONLY STOP — You read the spec." Small tags in mono boxes read `SKILL` and `WORKFLOW`. Footer in mono: "The script holds the loop / the CLI holds the rules / the agents do the work".

**Colour tokens.**

| Token | Light | Dark |
|---|---|---|
| paper (page ground) | `#F5F3EE` | `#161512` |
| ink (text) | `#161512` | `#F5F3EE` |
| muted (secondary text) | `#6B675F` | `#A39E94` |
| hairline (rules, table borders, 1px) | `#161512` at 100% for section rules, `#D9D5CC` for table rows | `#F5F3EE` / `#3A3733` |
| accent (vermilion) | `#C8451B` | `#D9552A` |
| accent-ink (text on accent) | `#FFFFFF` | `#FFFFFF` |
| code ground | `#ECE9E1` | `#201E1B` |

The accent is reserved. Use it for: the human-checkpoint block, eyebrow labels, the `WORKFLOW` tag, the active tab underline, halt nodes and halt banners, and the primary install button. Never for decoration, never for a whole section background other than the checkpoint block. A page where the accent appears in one big block and a scatter of small labels is correct.

**Type.** Headlines in a heavy geometric grotesk with tight tracking: Inter Tight 800 or Space Grotesk 700, fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. Hero H1 at `clamp(48px, 8vw, 96px)`, line-height 0.95, letter-spacing -0.03em. Body in Inter 400/500 at 17px, line-height 1.55, measure 60 to 70 characters. Mono in JetBrains Mono or IBM Plex Mono for every command, path, flag, label, table cell that holds a value, and eyebrow; eyebrows are uppercase, 11 to 12px, letter-spacing 0.15em. Google Fonts are allowed; every face gets a system fallback in the stack.

**Layout language.** Swiss datasheet. Sections separated by 1px hairlines, not cards. Left-aligned text. Wide gutters (max content width 1120px, 16px side padding at every width). Tables with hairline rows and mono values. Big numerals in the headline face. No gradients, no glass, no drop shadows, no pill buttons (2px radius at most), no stock illustration, no 3D, no rounded blob shapes.

**Diagrams.** Inline SVG. 1.5px strokes in ink. Mono labels. Boxes are rectangles with square corners. Arrows are plain lines with small closed heads. The human node is the only accent-filled shape in any diagram. Halt nodes are outlined in accent with accent text. Decision nodes are diamonds or rectangles with a dashed outline; use one convention and keep it.

**Motion.** Minimal. 150ms fades on tab change. A stepper animates by changing a highlighted node, not by moving things. Respect `prefers-reduced-motion`: no animation at all when set.

## 4. Page structure

**Sticky header** (48 to 56px): wordmark `INTERLOCK` in mono, accent, letter-spaced, at left; the tab bar in the centre; at right an `Install` button (scrolls to the install block), a `GitHub` link (`https://github.com/renzrollon/interlock`), and a light/dark toggle.

**Hero, above the tabs**, always present on arrival:
- Eyebrow: `AUTONOMOUS SPEC-DRIVEN DEVELOPMENT FOR CLAUDE CODE · LAYERED ON OPENSPEC · v0.3.0`
- H1: **Two commands. One human checkpoint.**
- Lede (Appendix A.1).
- The **flow strip**: an interactive SVG version of the existing diagram (Appendix A.2, interaction in §5).
- The **install block**: three captioned code panels (Appendix A.3), one copy button per panel.
- The **proof strip**: five figures in the headline face with mono captions (Appendix A.4).

**Tab bar** with six tabs, hash-routed so each is deep-linkable: `#why` · `#harness` · `#run` · `#first-hour` · `#deep-dive` · `#compare`. On arrival with no hash, `#why` is selected.

1. **Why** — the pitch: eight pains and the mechanism that answers each, the five bets, what the model still decides (Appendix A).
2. **Harness** — where Interlock sits inside Claude Code: the layer diagram, the step contract, the host contract and the four adapters, the guards, the corpora (Appendix B).
3. **The run** — the ship state machine with a stepper, a strict/lean toggle, the halt table, a worked example (Appendix C).
4. **First hour** — the commands in order, the ten-minute checkpoint read, what you will be asked and what is never asked, the prompt-to-workflow ladder (Appendix D).
5. **Deep dive** — adversarial review and the citation rule, the caps table, verify and the shrink check, spec drift, `REVIEW.md`, evals, cost and tokens, receipts and the report (Appendix E).
6. **Compare** — the landscape table, objections and answers, who it is for and not for, the stated limits (Appendix F).

**Footer**: repo link, npm package link (`https://www.npmjs.com/package/@renzrollon/interlock`), OpenSpec link (`https://github.com/Fission-AI/OpenSpec`), the thirteen docs by number and title as links into the repo's `docs/` folder (Appendix G.4), MIT licence, and the three-line mono sign-off: "The script holds the loop / the CLI holds the rules / the agents do the work".

## 5. Interactions, per section

Build each of these. They are the reason the page is interactive rather than a README.

**Hero flow strip.** Five nodes in a row: `bootstrap` → `spec` → **You read the spec** → `ship` → `mr`. Hovering or focusing a node shows a one-line tooltip (Appendix A.2). The checkpoint node is the accent-filled block and is 1.5x the width of the others. `spec` carries a small `SKILL` tag; `ship` carries an accent-outlined `WORKFLOW` tag. Clicking `ship` switches to the `#run` tab; clicking `spec` or the checkpoint switches to `#first-hour` and scrolls to the checkpoint table. Under the strip, one mono line: "ship is a dynamic workflow, so there is nobody to ask."

**Why tab: the pain ledger.** Eight rows (Appendix A.5). Each row is a three-column line: the pain in the reader's words (headline face, 22px) · the mechanism (body, with the mono name of the command, hook or property) · the cost (muted). On phones the three collapse into one stacked block. Below it, the five bets as five numbered blocks with a verbatim quote each (Appendix A.6), then "What the model still decides" (Appendix A.7).

**Harness tab: the layer diagram.** An SVG of the layers (Appendix B.2 gives the nodes and edges) stacked top to bottom: Claude Code host → guards → skills (prose) → drivers → the run program and decision modules (policy) → the CLI spine → the host port and adapters → the OpenSpec CLI → the corpora. Clicking any node opens a drawer on the right (a bottom sheet on phones) with three fields from Appendix B.2: **Owns**, **Forbidden from**, **Path**. A toggle above the diagram labelled **Decision lens** recolours nodes using the lens column in B.2: nodes where a model decides get a dotted outline, nodes where code decides get a solid outline, and a legend says "dotted: a model decides · solid: code decides, no model, no network". Below the diagram: the step contract (B.3), the host contract and adapter table (B.4), the guards (B.5), the corpora (B.6), the two agent types (B.7).

**Run tab: the state machine and stepper.** An SVG state machine from Appendix C.3, drawn left to right in lanes: pre-flight, plan, waves (an inner loop), verify, tail, commit, close. Controls above it: **Step**, **Play**, **Reset**, and three toggles: `--strict` (reveals the review, remediation, verdict and handoff states, which are otherwise drawn at 30% opacity with a dashed outline), `--isolate-waves` (adds the merge-lanes halt), `--solo` (collapses the wave loop to one lane). Below the diagram, a faux terminal panel (mono, code ground) whose contents advance with the stepper: it prints the lines from the worked example in Appendix C.7, in order, one block per step; C.8 specifies exactly what each control and toggle changes. Beside it, a **Halts** panel listing every halt and every degradation banner from Appendix C.6, filterable by stage; clicking a halt highlights its node in the SVG and prints its banner line in the terminal. The eight-node hero version of the graph (C.2) is used as the tab's opening figure; the full graph is below it. Clicking a node in the full graph shows that state's row from C.4.

**First hour tab: the timeline.** A vertical timeline with seven steps (Appendix D.1), each with a mono timestamp on the left ("min 0–2"), the command in a code panel with a copy button, and the expected output where D.1 gives one. A checkbox on each step persists in `localStorage` so a reader can come back. Then the ten-minute checkpoint table (D.2) with the four files and the one question each answers. Then two columns, **What you will be asked** and **Never asked, decided in code** (D.3, D.4). Then the ladder, **If you have only ever prompted** (D.5): fifteen terms as a numbered list where clicking a term reveals its one-line definition, followed by the three failures and the punchline verbatim.

**Deep dive tab.** A sticky sub-navigation of anchors down the left on desktop (top on phones): Review · Caps · Verify · Drift · REVIEW.md · Evals · Cost · Receipts. Inside **Review**, build the **adjudication simulator**: four sample findings from Appendix E.1.6 in a table; a button **Adjudicate** runs them one by one through the rules and reveals, per finding, the two skeptic verdicts, whether a dismissal carried a `file:line` citation inside the diff, the quality band decision, and the outcome (survives / dismissed / dropped as too weak / refutation refused), ending with the count lines given in E.1.6, computed from the four rows, and the **Cite it** follow-up button E.1.6 describes. Inside **Caps**, render Appendix G.1 as a searchable table with a fixed header line reading "read from `interlock limits` at v0.3.0". Inside **Drift**, the four findings as a ladder of confidence (E.4). Inside **Cost**, the tier table and the cache multipliers (E.7) with the billing-path note.

**Compare tab.** The landscape matrix (Appendix F.1) with hover on a row highlighting it. Under it, the objections as an accordion (F.2), one open at a time. Then two columns, **For** and **Not for** (F.3). Then **Stated limits** as a plain list (F.4). This tab must not disparage any named tool; where the other tool is better, say so in its row.

## 6. Technical constraints

- One file, `index.html`, under 600KB. Inline everything except Google Fonts.
- Vanilla JavaScript, no framework, no bundler. Progressive enhancement: with JavaScript off, all six tab panels render stacked in order with their headings, so the content is still readable.
- Hash routing: selecting a tab sets `location.hash`; loading with a hash selects that tab and scrolls to the top of it; the browser back button moves between tabs.
- Tabs use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, arrow-key navigation, and a visible focus ring in accent.
- Theme: honour `prefers-color-scheme`; the toggle overrides it and persists in `localStorage`. Define every colour once as a CSS custom property on `:root`; redefine only the tokens under the dark media query and under `[data-theme="dark"]`.
- Responsive from 375px to 1600px. No horizontal scroll on the body at any width; tables and diagrams scroll inside their own container. Side gutter of at least 16px at every width.
- Every SVG diagram has a `<title>` and its labels are real text, not paths, so they can be searched and read by a screen reader.
- Copy buttons use the Clipboard API and fall back to selecting the text.
- No analytics, no cookies, no forms, no external images, no iframes.
- `<title>Interlock</title>`, a meta description, and Open Graph title and description. No OG image is available; do not reference one.
- Print: nothing special required.

## 7. Rules of honesty

These follow the project's own rules and the page breaks trust if it breaks them.

- Every number on the page is from Appendix G and is labelled as v0.3.0 where it appears in a table. Do not round a cap, do not average anything.
- Present the caps as **read from `interlock limits`**, never as "the rule is". The project's principle is that thresholds live in the CLI, not in prose; the page quotes the CLI, it does not restate the rule as its own.
- Do not draw a trend arrow, a health colour, a score, a gauge or a progress ring on any indicator. The project's own report refuses to; the page follows.
- Label the runner (`interlock-run`) and earned autonomy as **experimental** wherever they appear. Say plainly that `/interlock:ship` is the supported path.
- State that Interlock is a Claude Code plugin and that Cursor and Copilot are not supported in 0.x, on the Why tab and again on Compare. Do not bury it.
- Where a tool in the Compare tab is better than Interlock at something, say so.
- No testimonials, no logos, no star counts, no "trusted by".
- Do not claim a passing-test count. Say "63 test files, `npm test`, nothing to install".
- If you are unsure whether a claim is in the appendices, leave it out.

## 8. Deliverable checklist

Before returning the file, confirm each of these:

- [ ] One `index.html`, no external scripts or stylesheets other than Google Fonts.
- [ ] Six tabs, hash-routed, keyboard-navigable, readable with JavaScript disabled.
- [ ] Hero flow strip with tooltips and the accent checkpoint block.
- [ ] Harness layer diagram with clickable nodes, drawer, and the decision lens.
- [ ] Run state machine with Step / Play / Reset, three toggles, faux terminal, and the halts panel.
- [ ] First-hour timeline with persisted checkboxes and copy buttons.
- [ ] Deep-dive adjudication simulator and the searchable caps table.
- [ ] Compare matrix, objections accordion, for / not for, stated limits.
- [ ] Light and dark themes, both readable, accent identical in role in both.
- [ ] No banned words. No invented facts. Every number traceable to Appendix G.
- [ ] Works at 375px with no horizontal body scroll.

---

# APPENDIX A — Hero and the Why tab

Everything in this appendix is page copy. Use it as written; trim only if a block will not fit, never rephrase a quoted line.

## A.1 Hero

**Eyebrow:** `AUTONOMOUS SPEC-DRIVEN DEVELOPMENT FOR CLAUDE CODE · LAYERED ON OPENSPEC · v0.3.0`

**H1:** Two commands. One human checkpoint.

**Lede:** Spec a change, read it, then ship it start-to-commit with parallel agents. Every cap the run obeys is a CLI you can run yourself, with no model and no network. Zero-touch is a property of the runtime, not a promise in a prompt.

**Under the lede, one mono line:** Every change is spec, then ship. Bootstrap runs once per repo; mr when you want the merge request.

## A.2 Flow strip

Five nodes, left to right. Tooltip text follows each.

| Node | Tag | Tooltip |
|---|---|---|
| `bootstrap` | — | Once per repo. Reads the code, writes an architecture doc and one spec per existing feature. Never modifies source. |
| `spec` | `SKILL` | Explore, then OpenSpec artifacts, then an artifact review. Stops having written specs and no code. |
| **You read the spec.** | accent block | Ten minutes. Four files, one question each. The only required stop. A spec is the cheapest place to catch a wrong idea. |
| `ship` | `WORKFLOW` (accent outline) | Waves → verify → commit. A dynamic workflow: the runtime takes no mid-run input, so it cannot ask you anything. |
| `mr` | — | The merge request, when you want it. Ends by reminding you to archive the change. |

Eyebrows above the strip, in mono: over `bootstrap`: `RUN ONCE, AFTER YOU CLONE`; over `spec` through `mr`: `THEN, EVERY CHANGE`; a right-aligned `↺ REVISE IDEA → RE-SPEC` on the checkpoint block.

Mono line beneath the strip: **ship is a dynamic workflow, so there is nobody to ask.** The runtime takes no mid-run input at all; zero-touch is a property of the runtime, not a promise in a prompt.

## A.3 Install block

Three code panels, each with a copy button.

Panel 1, caption `INSTALL`:
```
npm install -g @fission-ai/openspec@latest
cd your-project && openspec init
/plugin marketplace add renzrollon/interlock
/plugin install interlock@interlock
```

Panel 2, caption `ONCE PER REPO`:
```
interlock doctor              # prints the exact allowlist an unattended run needs
/interlock:bootstrap          # code → understanding → graph
```

Panel 3, caption `EVERY CHANGE`:
```
/interlock:spec "<idea>"      # explore → artifacts → review, then stops
/interlock:ship               # waves → verify → commit
/interlock:ship --strict      # + adversarial review, remediation, handoff, conformance
```

Small print under the panels: Requires Claude Code v2.1.154+ with dynamic workflows enabled, the `openspec` CLI, and Node.js 18 or newer. Interlock is a Claude Code plugin; Cursor and Copilot are not supported in 0.x. The three CLIs also install on their own with `npm install -g @renzrollon/interlock`.

## A.4 Proof strip

Five figures in the headline face, each with a mono caption. No trend arrows, no colour.

| Figure | Caption |
|---|---|
| **1** | required human stop, between spec and ship |
| **17** | decisions moved out of prose and into a CLI with an exit code |
| **0** | runtime dependencies. Stdlib Node, nothing to install |
| **35** | changes shipped through its own loop, 22 Aug to 7 Sep 2026 |
| **63** | test files. `npm test`, no model, no network |

## A.5 The pain ledger (Why tab, first section)

Section headline: **How many decisions the model is not allowed to make.**

Intro paragraph: Most of the category competes on how much structure you write before coding. Spec Kit adds phases, BMAD adds roles, Kiro adds an IDE. Interlock competes on a different axis. Every row below is a decision a model used to make in prose, on every run, usually differently. Each now has a command, a hook or a runtime property that makes it, and a cost stated beside it.

Eight rows. Columns: **The pain** (in the reader's words) · **The mechanism** · **The cost**.

1. **"The agent talked itself past its own cap."**
   Caps are code. `lib/limits.mjs` holds every one and `interlock limits` prints them. Skills are forbidden from restating a number; a test walks the codebase and fails on any published cap nothing reads. The planner prompt is forbidden from naming the solo envelope, because a model that can read a bound can argue with it.
   *Cost:* changing a cap is a code change with a test, not a prompt edit. There are no per-repo caps, on purpose.

2. **"The run asked a question at 2am and sat there."**
   `/interlock:ship` is a dynamic workflow, a script the Claude Code runtime executes. The runtime takes no mid-run input. There is no question to remove because nothing is listening. Everything that needs a human is settled in `spec`, before the run starts.
   *Cost:* one interruption survives: a permission prompt for a command you did not allowlist. `interlock doctor` derives the exact list from what the flow shells out to plus your own test profile, and a session-start hook runs it for you.

3. **"Two parallel agents overwrote each other."**
   The planner compares each task's predicted files on the canonical path and folds any two that collide into one lane, run in order by one agent. With `--isolate-waves`, each lane runs in its own git worktree and `interlock merge-lanes` folds them back; two lanes that wrote the same file halt the run naming the path and both lanes, never last-writer-wins.
   *Cost:* the file prediction is still a model's. Without the flag the race is narrowed, not closed.

4. **"The review reports everything, so we skim it."**
   Up to six review dimensions run in parallel, then two skeptics attack every blocker and warning. A finding that does not survive is never shown to you. A dismissal must cite a `file:line` inside the reviewed diff or it dismisses nothing. The report prints how many findings were dismissed and how many refutations were refused.
   *Cost:* review is opt-in (`--review`, `--strict`, or `/interlock:review-code`) and it is the expensive part of a run. Default ship does not pay for it.

5. **"Nobody can reconstruct what the run did."**
   Every run appends a JSONL trajectory, one line per wave action, CLI exit, agent spawn and verify judgement, plus a receipt and an outcome record. The summary names the run id, project and directory. `interlock run-log check` halts an otherwise clean run whose trajectory cannot be replayed.
   *Cost:* the corpora live in the repo tree. Decide once whether they are an audit trail to commit or exhaust to ignore.

6. **"Specs rot, so we stopped writing them."**
   `interlock drift` reports four findings at three separate confidence levels, never averaged: unarchived changes (certain), specs citing deleted files (evidence), changed files no spec describes (evidence, always with a repo-wide denominator), specs older than the code they cite (inference, printed last). Every clean ship prints `ARCHIVE PENDING`.
   *Cost:* drift never blocks. A gate built on regex-inferred links would be wrong often enough to get switched off, and a gate everyone disables protects nothing.

7. **"The suite went green because it got smaller."**
   During remediation and final verification, a `PreToolUse` guard denies edits to test files. Given a baseline, `interlock verify` flags a test count that fell or a skipped count that rose, and a weakened suite outranks a green one. Repair is by root cause: failures cluster by normalised error signature and the largest cause is fixed first, bounded by a cap.
   *Cost:* the guard binds only on Claude Code. On the experimental Codex and Qwen hosts you get the shrink check alone and a `HOOKS NOT IN FORCE` banner.

8. **"The run degraded and the summary looked identical to a clean one."**
   Every degradation is a named banner: `GRAPH UNAVAILABLE`, `NO TEST PROFILE`, `MODEL ROUTING OVERRIDDEN`, `VERIFICATION SKIPPED`, `LEAN SHIP`, `PUSH FAILED`, `CACHE ACCOUNTING NOT REPORTED`, `HOOKS NOT IN FORCE`. A clean run prints the banner block too, saying nothing degraded, because silence and cleanliness must not look alike. The banner strings are asserted verbatim in the test suite: a reworded banner is a banner nobody greps for.
   *Cost:* summaries are longer.

## A.6 The five bets (Why tab, second section)

Section headline: **Five bets, with the wager stated.**

**1. The human checkpoint between spec and ship is the product.**
One required stop, placed where a wrong idea is cheapest to kill, buys an uninterrupted implementation run on the other side. `/interlock:spec` writes specifications and stops. `/interlock:ship` asks nothing. The one opt-out, `spec --continue`, is argued against in its own documentation: "Continuity cannot catch a wrong idea. Every check it runs asks whether the change is implementable. None of them asks whether it is right."
> "The gap between `spec` and `ship` is the product. A spec is the cheapest place to catch a wrong idea, so that is the one place a person is required to look."

**2. Thresholds are code, not prose.**
The test for what belongs in the CLI: if two competent runs could reach different answers from the same inputs and only one is right, it was never a judgement. Seventeen such decisions are subcommands with exit codes. A cap nothing reads was removed rather than wired. A removed cap is removed, not aliased, so a stale reader fails at import.
> "A speed limit painted on the road and a governor fitted in the engine are both 'the rule'. Only one of them still holds when the driver is late."

**3. Zero-touch is a property of the runtime, not a promise.**
You cannot get autonomy by instructing a model to be autonomous. You get it by running the loop somewhere that has no channel for a question. `lib/run.mjs` emits the whole ship program as versioned steps: the agents to spawn, their briefings, and the exact argv to call next. The two drivers interpret those steps and branch on nothing.
> "`ship` asks nothing not because it was instructed to be autonomous, but because the workflow runtime has no channel for mid-run input at all. There is nobody listening."

**4. A dismissal must cite evidence. A report needn't.**
The two review errors are not symmetric. A surviving false positive costs a human ten seconds. A wrongly dismissed finding is invisible, and nobody can catch a mistake they never see. So only the dismissing direction is gated: a "not real" verdict must carry a `file:line` span whose path is in the reviewed diff. An uncited refutation is a non-vote, and the report counts how many were refused.
> "Confident prose is the single thing an LLM produces most reliably, so it is the one thing a dismissal must not rest on." Cited: Refute-or-Promote (arXiv 2604.19049) documents eighty-plus agents, dedicated skeptics among them, unanimously endorsing an OpenSSL padding oracle that did not exist.

**5. Degradation is spoken, never silent.**
The compounding failure is not a bad run. It is a bad run that looks like a good one. Token usage a host cannot report is `unknown`, never zero. An unobserved indicator renders at the same weight as a measured one, with its reason as the cell content. An empty graph build says so and explains why.
> "What you cannot see, you cannot correct."

Three supporting principles, as a short list under the bets:
- **Guards fail open, never closed.** The three deny hooks bind only agents inside a ship run and allow whenever they cannot establish the stage. Installing Interlock does not change how your own editing or committing behaves.
- **Spec drift is measured at three confidence levels, never averaged.** Collapsing them into one number would launder the weakest signal through the strongest.
- **Corpora are recorded but never consulted.** Earned autonomy is a ledger nobody reads yet. No autonomy level and no accumulated outcome relaxes a gate. "Reading a corpus and branching on it are different acts, and only the first has been built."

## A.7 What the model still decides (Why tab, third section)

Section headline: **What stays with the model.**

Read the two sections above quickly and you could conclude the design distrusts the model. That is the wrong takeaway. Everything that is genuinely a judgement stays with it: reading an unfamiliar codebase, deciding what a task is worth, writing the code, reviewing a diff, synthesising a summary a person will read. What moved out is only what has a correct answer. The split is the point:

> **The script holds the loop, the CLI holds the rules, the agents do the work.**

## A.8 What this costs, honestly (Why tab, closing callout, full width)

Headline: **No published benchmark.**

> "The unit suite proves the policy engine behaves as specified. It does not prove the workflow produces better outcomes than a simpler loop. That comparison has not been run, and until it has, everything above is an argument from mechanism rather than from measurement. The outcome corpus exists to close that gap and currently has no control group."

Then three stated trades, one line each:
- Portability. Spec Kit runs on thirty agents. Interlock runs on one, because the guarantees come from Claude Code's workflow runtime. A portable version of this would be a folder of prompts, which is the thing it exists not to be.
- Surface area. Twenty-eight top-level subcommands, sixteen skills, four host adapters, four hooks. The repository books this as a cost.
- Review is opt-in. Lean ship trusts your unit suite. If `tasks.md` and the suite are thin, lean ship is a cost default, not a quality default.

---

# APPENDIX B — The Harness tab

Source of truth: `CLAUDE.md`, `lib/run.mjs`, `lib/host.mjs`, `lib/host/registry.mjs`, `workflows/ship.js`, `bin/interlock-run`, `hooks/*.mjs`, `lib/ship-stage.mjs`, `docs/06-why-it-works.md`, `docs/13-the-guards.md`.

## B.1 Headline and intro

Headline: **Where Interlock sits inside Claude Code.**

Intro: Interlock is a process layer with no harness of its own. It borrows Claude Code's: the Skill tool, the slash namespace, the Workflow runtime, subagent fan-out, the hook dispatch, and the injection of the plugin's `bin/` onto the PATH. Everything the loop decides lives below that line, in a zero-dependency Node CLI any host can shell out to. The diagram reads top to bottom: what the host provides, what the plugin adds in prose, what interprets, what decides, and what is written to disk.

## B.2 The layer diagram (nodes and edges for the interactive SVG)

Stack the layers top to bottom: **host · guards · prose · drivers · policy · cli · port and adapters · external · corpora**. Each node opens a drawer with **Owns**, **Forbidden from**, and **Path**. The **Decision lens** toggle marks nodes with a dotted outline where a model decides and a solid outline where code decides. Legend: "dotted: a model decides · solid: code decides, no model, no network".

| id | label | layer | lens | Owns | Forbidden from | Path |
|---|---|---|---|---|---|---|
| `cc-host` | Claude Code | host | — | The Skill tool, the slash namespace, hook dispatch, the agent ceilings (16 concurrent, 1000 per run) | — | external, v2.1.154+ |
| `slash` | `/interlock:bootstrap` · `spec` · `ship` · `mr` | host | — | The four commands that are the product | — | `.claude-plugin/plugin.json` |
| `workflow-rt` | Workflow runtime | host | code | Zero-touch: it accepts no mid-run user input | `import()`, the filesystem, a shell | external |
| `subagents` | `interlock:worker` · `interlock:ping` | host | model | Isolated context per lane; reading, writing, running commands | `Skill`, `Agent`, `mcp__*` | `agents/worker.md`, `agents/ping.md` |
| `path-inject` | plugin `bin/` on the PATH | host | code | Making `interlock` and `interlock-graph` bare commands | — | host behaviour |
| `hooks` | four hooks: one preflight, three guards | guards | code | Denying a test edit during repair, a checkbox flip, an out-of-stage commit | Blocking on anything it cannot establish | `hooks/*.mjs` |
| `skills` | sixteen `SKILL.md` | prose | model | Judgement framing; model-facing instruction | Restating any numeric threshold | `skills/` |
| `ship-js` | `workflows/ship.js` | drivers | code | Spawning what a step names, the CLI relay, briefing by reference, the token counter | Branching on a flag, a mode, a count or a verdict | `workflows/ship.js` |
| `runner` | `bin/interlock-run` (experimental) | drivers | code | The same loop over a vendor CLI; lane worktrees; banners | The same, plus holding any rule | `bin/interlock-run` |
| `run-mjs` | `lib/run.mjs`, the run program | policy | code | Emitting every step; taking every branch | Spawning, printing, importing a transport | `lib/run.mjs` |
| `lib` | thirty-six pure decision modules | policy | code | One concern each: waves, verify, findings, remediate, risk, ready, ledger, drift, receipt | I/O beyond what the module's name implies | `lib/*.mjs` |
| `prompts` | `lib/prompts/` | policy | code | Every briefing an agent receives | Being unregistered; the suite fails | `lib/prompts/` |
| `limits` | `lib/limits.mjs` | policy | code | Every cap, once | A cap with no reader | `lib/limits.mjs` |
| `cli` | `bin/interlock` | cli | code | Twenty-eight subcommands; exit codes are the contract | A model or the network, except `notify` | `bin/interlock` |
| `graph-cli` | `interlock-graph` | cli | code | A deterministic import, symbol and spec graph with token-budgeted retrieval | Embeddings, a vector store, the network | `bin/interlock-graph`, `lib/graph/` |
| `report` | `interlock report` | cli | code | Indicators over the corpora, each with its denominator | Any verdict; any write | `lib/report.mjs` |
| `hostport` | `lib/host.mjs` | port | code | Three operations: `spawn`, `mapPipeline`, `runCli` | A fourth operation | `lib/host.mjs` |
| `registry` | `lib/host/registry.mjs` | port | code | Seven capability declarations per adapter | An adapter missing a key | `lib/host/registry.mjs` |
| `adapters` | `claude` · `acp` · `codex` · `qwen` | adapters | code | A transport plus a declaration of what the host cannot do | Wave order, verify judgement, limits, the gate | `lib/host/*.mjs` |
| `openspec` | the `openspec` CLI and `openspec/` | external | code | Artifact formats, templates, validation, the change lifecycle, `archive` | — | `openspec/` |
| `stage` | the stage marker | corpora | — | The only channel from a run to a hook | Being written by a driver | `.claude/ship/<change>/stage.json` |
| `runstate` | run state, briefings, worktrees, spill | corpora | — | The manifest, the cursor, every briefing with its hash, lane trees | — | `.claude/ship/` |
| `corpora` | trajectory · outcomes · review metrics · receipt · ledger | corpora | — | The audit trail | Deciding anything | `.claude/ship/runs/`, `.claude/learning/`, `.claude/metrics/` |

Edges, with labels:

| from | to | label |
|---|---|---|
| `cc-host` | `slash` | exposes |
| `cc-host` | `path-inject` | injects |
| `cc-host` | `hooks` | runs, one process per tool call |
| `slash` | `skills` | invokes |
| `skills` | `workflow-rt` | `ship` launches, once |
| `workflow-rt` | `ship-js` | executes |
| `ship-js` | `subagents` | spawns what a step names |
| `ship-js` | `cli` | shells out, through a ping |
| `runner` | `adapters` | spawns through |
| `runner` | `cli` | shells out |
| `cli` | `run-mjs` | dispatches `run *` |
| `cli` | `lib` | dispatches every other subcommand |
| `run-mjs` | `ship-js` | **emits step** |
| `run-mjs` | `runner` | **emits step**, the same program |
| `run-mjs` | `lib` | calls |
| `run-mjs` | `prompts` | assembles briefings |
| `run-mjs` | `runstate` | writes manifest, state, briefings with sha256 |
| `run-mjs` | `corpora` | writes trajectory, receipt, outcome |
| `run-mjs` | `stage` | clears on every terminal path |
| `subagents` | `stage` | publishes; the agent holds the live pid |
| `hooks` | `stage` | reads |
| `hooks` | `subagents` | **denies** |
| `hooks` | `cli` | session start runs `interlock doctor` |
| `lib` | `limits` | reads every cap |
| `skills` | `cli` | cites `interlock limits`, never restates a number |
| `runner` | `registry` | creates the host, reads its capabilities |
| `registry` | `adapters` | declares what each cannot do |
| `adapters` | `hostport` | implement |
| `skills` | `openspec` | drives: `new change`, `status --json`, `instructions` |
| `run-mjs` | `openspec` | reads the change's artifacts |
| `skills` | `graph-cli` | queries, token-budgeted |
| `report` | `corpora` | reads |
| `path-inject` | `cli` | makes it a bare command |
| `runner` | `runstate` | creates lane worktrees |

Draw two edges dashed and struck through, because their absence is the design: `run-mjs` to `registry` (the policy engine never loads a transport) and `report` to any gate (nothing in the loop consults the report).

## B.3 The step contract

Headline: **The whole loop is emitted, not written.**

`interlock run` emits every step of a ship run as a record with exactly four guaranteed fields: `schema` (`interlock.run-step/1`), `action`, `then`, and `spawns`. The action is one of fifteen frozen values. Each spawn carries a label, a kind, a model, an effort, the tools it may use, a result schema, and a briefing delivered by path and sha256. `then` is the exact argv to call once the spawns return, or null when the run is over.

The driver's entire loop, in prose: while there is a step with a continuation, spawn everything the step names, then call the continuation. `workflows/ship.js` has no switch on the action. The only reads of it in the file are token accounting and one cosmetic word in the final line. The experimental runner has the identical loop. A test runs a sweep over both drivers for any policy literal and allows none.

Three details worth a line each:
- **Briefing by reference.** The CLI writes `.claude/ship/briefings/<label>.md` with its sha256 on line one. The Workflow host hands the worker the path and requires the hash back. An unacknowledged or wrong hash fails the task closed rather than risking a silently under-instructed agent.
- **The CLI relay.** The Workflow runtime has no shell, so every `interlock` call is a haiku ping told to run one command and copy its stdout verbatim. An invented action gets one re-ask and then a halt; it is never obeyed.
- **The sequence guard.** The manifest records the last continuation the program emitted. A call that is not the expected one halts the run naming the expected one, so a driver that skips or repeats cannot advance the state machine twice.

Every briefing ends with one appended line, stated once so neither driver holds it: "You are one step of an automated ship run. Do not ask questions; there is no one listening. If something is undecidable, put it in the result fields rather than guessing at product intent."

## B.4 The host contract and the four adapters

Headline: **What a host cannot do is declared, never discovered.**

`lib/host.mjs` states the whole host contract as three operations: spawn one labelled agent, spawn a batch in parallel, and run `interlock` and hand back its exit code and stdout. A host may not decide wave order, judge a verify result, apply a cap or a gate; those live behind the CLI on purpose, so a second host cannot quietly grow a second copy of the rules. The CLI path resolves from the module's own location, never from the PATH or a caller string. A non-zero exit is an answer, not an error: a host that threw on it would turn a halt into a crash.

An adapter under `lib/host/` is a transport plus a declaration of seven capabilities. Every one describes a way a run on that host is weaker than the default, and the run program branches on the declaration, never on the host's name. `/interlock:ship` on the Workflow runtime is the supported path. The runner is experimental, no slash command starts it, and it refuses `--host workflow` from the other side.

| Host | Drives | Result schema | Model selection | Plugin hooks | Token usage | Cache accounting | Billing path |
|---|---|---|---|---|---|---|---|
| Workflow (default, `/interlock:ship`) | the Claude Code Workflow runtime | enforced | the planner's tiers | yes | yes | **no**: one cumulative scalar | Claude subscription, interactive |
| `claude` (runner) | `claude -p` | enforced | the planner's tiers | yes | yes | yes | Claude subscription, **programmatic** (metered) |
| `acp` (runner) | your `INTERLOCK_ACP_COMMAND` | recovered from text | negotiated on session start | only over the Claude binary | no | no | whatever the agent is |
| `codex` (runner) | `codex exec` | enforced | mapped, or unrouted | **no** | yes | no | ChatGPT plan or API key |
| `qwen` (runner) | `qwen -p` | enforced | mapped, or unrouted | **no** | no | no | whatever you configured |

Model routing on the runner comes from one published map, `INTERLOCK_MODEL_MAP`, parsed once at startup and fatal on malformed input. An unmapped tier on Codex or Qwen gets no model flag at all and is named in a `MODEL ROUTING UNAVAILABLE` banner with its reason. A model is never guessed, because a wrong model that ran is invisible in a summary and a banner is not.

Every runner summary prints `RUNNER HOST: <id> (experimental)`. A run over the Claude binary prints `SUBSCRIPTION PATH: programmatic`, because `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit; the interactive Workflow runtime is the path that change exempted. That is why the default did not move.

## B.5 The guards

Headline: **Four hooks. One advisory, three deny. All fail open.**

| Hook | Event | Denies |
|---|---|---|
| `preflight.mjs` | session start | Nothing. Runs `interlock doctor` and surfaces failures with their fix strings. Every path exits 0. |
| `guard-tests.mjs` | before Edit or Write | An edit to a test file while the stage is `remediation` or `fix-tests`. Test edits during `implement` are allowed: adding coverage for the feature you are building is the point, not a hazard. |
| `guard-tasks.mjs` | before Edit or Write | An edit that changes the sequence of checkbox states in the active change's `tasks.md`, in any active stage. The tick is the CLI's job, keyed off recorded outcomes. |
| `guard-commit.mjs` | before Bash | A `git commit` unless the stage is `commit`. It canonicalises `git -C`, `git -c`, environment prefixes, and command chains across `&&`, `;`, pipes and newlines. |

The guards read a stage marker at `.claude/ship/<change>/stage.json` carrying the stage, the change, a monotonic index and the writing process's pid. The agent performing each step publishes it; the run program clears it on every terminal path. There is exactly one definition of the marker, and a test fails if any driver declares a marker literal at all.

When a guard cannot establish the stage, because the marker is absent, unreadable, malformed, stale, the process is gone, or the guard itself crashed, it allows. The asymmetry is argued rather than hidden: a lost marker during a real run silently disables the guard for that window; fail-closed would, on the same lost marker, brick every edit in the session. A guard that blocked test edits whenever it could not find a marker would break ordinary test-driven work the moment the plugin is installed.

The consequence, stated plainly on the page: **installing Interlock does not change how your own editing or committing behaves.** The guards bind only agents inside a ship run and are inert outside one.

## B.6 The corpora and what happens when a write fails

Headline: **Three corpora, recorded and never consulted.**

| Corpus | Path | On a failed write |
|---|---|---|
| Run trajectory | `.claude/ship/runs/<runId>.jsonl`, one line per wave action, CLI exit, agent spawn and verify judgement | A run whose trajectory cannot be replayed exits 1, even beside `SHIP COMPLETE`. A run nobody can reconstruct defeats the reason the file exists. |
| Spill | `.claude/ship/spill/<runId>/`, suite output over the spill threshold | Fatal on an unwritable tree. |
| Outcome record | `.claude/learning/outcomes.jsonl`, one line per ship run | Reported, never touches the exit code. Losing a corpus line must not fail the run that produced it. |
| Review metrics | `.claude/metrics/review-<change>-<stamp>.json` | Reported as `REVIEW METRICS NOT WRITTEN`, never touches the exit code. |
| Receipt | a `run-receipt` event inside the trajectory | Inherits the trajectory's semantics. |
| Decision ledger | `openspec/changes/<change>/decisions.md` | Read-only. A missing ledger blocks readiness, because an absent file reads as "nothing needs a human", which is the one conclusion a file that was never written cannot support. |

The difference is deliberate, and the repository's own review policy pre-classifies "make the two corpus-loss policies consistent" as a nit. Every corpus tolerates a torn final line: an append-only log truncated by a crash loses one record, not the read.

Nothing reads any of these to change what a run does. `interlock report` reads all three, always exits 0, applies no threshold, labels nothing pass or fail, and writes nothing, not even a cache. Its first run against this repository found three things nobody knew: the receipt path had never once fired, 727 of 729 trajectories were attributed to no change at all, and every metrics file had been written in a shape the reader did not expect. A corpus nobody can read is a corpus nobody notices is empty.

## B.7 The agents

Two plugin agent types, and only the drivers spawn them. `interlock:worker` may Read, Write, Edit, Grep, Glob and run Bash. `interlock:ping` may run Bash, Read and Write. Neither lists the Skill or Agent tools and both deny MCP servers. That is the spawn-prefix shrink: on a loaded operator machine a spawned agent otherwise inherits tens of thousands of tokens of tool schemas and skill descriptions per spawn, and a lean run pays that floor thirty times before any task prompt. Isolation of tasks is not isolation of prefix.

---

# APPENDIX C — The Run tab

Source of truth: `lib/run.mjs` (the ship program, which emits every step), `lib/waves.mjs` (the pure planner), `lib/verify.mjs`, `lib/receipt.mjs`, and `docs/04-when-it-stops.md`. The names below are the real ones.

## C.1 Headline and intro

Headline: **The run, as a state machine.**

Intro: `interlock run` emits the whole ship loop as versioned steps: the agents to spawn, the briefing each one carries, and the exact argv to call once they return. `workflows/ship.js` on Claude Code and the experimental `bin/interlock-run` are interpreters of those steps. Each spawns what a step names, writes the results, calls what the step names next, and branches on nothing: not a flag, not a mode, not a count, not a verdict. Control flow written as prose is control flow the model can talk itself out of. Control flow written twice in two drivers is control flow that drifts.

Two vocabularies the diagram uses:
- **Stage markers**, six, written to `.claude/ship/<change>/stage.json` and read by the guard hooks: `implement`, `verify`, `review`, `remediation`, `fix-tests`, `commit`.
- **Run actions**, the step records the program emits: `classify`, `run-batch`, `test-wave`, `verify`, `verify-final`, `replan`, `review`, `remediate`, `verdict`, `handoff`, `commit`, `close`, `done`, `halt`, `complete`.

## C.2 The hero graph (opening figure, eight nodes)

```
NODES
bootstrap   Bootstrap — once                 stage
spec        Spec — explore, write, review    stage
checkpoint  You read the spec (~10 min)      human   (accent fill)
waves       Waves — parallel implementers    stage
verify      Verify — unit suite              decision
commit      Commit                           stage
halt        Halt — nothing committed         halt    (accent outline)
mr          Merge request                    human

EDGES
bootstrap  → spec        once per repo, then every change
spec       → checkpoint  spec stops here, having written nothing but specs
checkpoint → waves       /interlock:ship — asks nothing from here on
waves      → waves       next batch / next wave (parallel lanes, capped)
waves      → verify      wave complete
verify     → waves       green → next wave
verify     → commit      green → one feature-level commit
verify     → halt        red unit suite, or a cap exhausted
waves      → halt        task failures over the cap
commit     → mr          SHIP COMPLETE
halt       → checkpoint  fix the cause, then ship again
```

## C.3 The full state machine (render this as the interactive SVG)

Draw left to right in seven lanes: **pre-flight · plan · waves · verify · tail (strict only) · commit · close**. Every halt node is accent-outlined and every halt routes to `close`, because a halted run writes the same receipt, outcome record and terminal trajectory event a completion does. Only the exit code differs.

```
NODES  (id · label · kind)
ship_launch        /interlock:ship → Workflow(), once            stage
trampoline_halt    No Workflow tool → HALT                       halt
run_start          run start: validate + plan reuse              stage
preflight_halt     HALTED: validate / coverage / plan            halt
classify           classify — one planner agent                  stage
plan               run classified: coverage → waves → plan.json  stage
batch              run-batch: up to 8 lanes in parallel          stage
record_batch       run record-batch                              decision
failure_halt       HALTED: more than 2 task failures             halt
merge_halt         HALTED: merge-lanes collision (isolate)       halt
replan             replan (haiku ping, max 2 per run)            stage
interwave_verify   verify (inter-wave)                           stage
judge_interwave    run judge --context inter-wave                decision
interwave_halt     HALTED: inter-wave checks still red           halt
done               done                                          decision
review             review: dimensions + two skeptics             stage   (strict)
reviewed           run reviewed: adjudicate                      decision (strict)
remediation        remediate, rounds 1..2                        stage   (strict)
verdict_gate       verdict round                                 decision (strict)
blocker_halt       HALTED: unresolved blockers                   halt    (strict)
final_verify       verify-final (marker: fix-tests)              stage
judge_final        run judge --context final                     decision
unit_halt          HALTED: unit suite red / weakened             halt
handoff            handoff: test plan, walkthrough, conformance  stage   (strict)
commit             commit: one feature-level commit              stage
close              run close → receipt, outcome, trajectory      terminal
mr                 /interlock:mr                                 human

EDGES  (from → to · condition · scope)
ship_launch → trampoline_halt     Workflow tool unavailable, or --solo with --waves         all
ship_launch → run_start           Workflow() called once                                    all
run_start → preflight_halt        interlock validate exits non-zero                         all
run_start → close                 plan reused and every task already ticked                 all
run_start → batch                 stored plan matches its inputs → classifier skipped        all
run_start → classify              no plan, inputs changed, or format changed → rebuild       all
classify → plan                   classified.json written                                   all
plan → preflight_halt             a checkbox omitted, or the edge set rejected              all
plan → batch                      plan.json + state.json written; the plan preview prints   all
batch → record_batch              every lane returned                                       all
record_batch → merge_halt         two lanes wrote the same canonical path                   --isolate-waves
record_batch → failure_halt       accumulated failures over the cap                         all
record_batch → batch              another batch remains in this wave                        all
record_batch → replan             replan pending at a wave boundary, budget left            all
record_batch → interwave_verify   wave done, another wave follows                           all
record_batch → batch              wave done, verify skipped (docs-only, red wave, cap)      all
record_batch → done               no wave follows                                           all
replan → batch                    revision applied, or declined                             all
interwave_verify → judge_interwave  the agent reported exit codes and counts                all
judge_interwave → batch           green → next wave                                         all
judge_interwave → interwave_verify  red, fix attempts remain (2 per wave)                  all
judge_interwave → interwave_halt  budget spent and the errors block the next wave           all
judge_interwave → batch           budget spent, reported not blocking → warn and advance    all
done → close                      --apply-only                                              all
done → final_verify               lean ship (no --review)                                   default
done → review                     --review or --strict                                      strict
review → reviewed                 findings.json + verdicts.json written                     strict
reviewed → final_verify           nothing survived to fix — no round spent                  strict
reviewed → remediation            round 1 has fixers to dispatch                            strict
remediation → remediation         round < 2 and blockers remain                             strict
remediation → verdict_gate        budget spent, or every blocker cleared                    strict
verdict_gate → blocker_halt       blockers still standing → no commit step is ever emitted  strict
verdict_gate → final_verify       clean                                                     strict
final_verify → judge_final        the agent reported                                        all
judge_final → unit_halt           unit red, weakened, did not run, or a step unreported     all
judge_final → handoff             green and --handoff or --conformance                      strict
judge_final → commit              green, no tail flags                                      default
handoff → commit                  artifacts written                                         strict
commit → close                    one commit made, or --no-commit recorded                  all
close → mr                        SHIP COMPLETE → the human opens the merge request         all
every halt → close                receipt, outcome record, trajectory, exit 1               all
```

Rendering notes: the four strict-only states and `handoff` are drawn at 30% opacity with dashed outlines until the `--strict` toggle is on. `batch → record_batch → batch` is the inner batch loop; `record_batch → interwave_verify → judge_interwave → batch` is the outer wave loop. Two self-loops carry counters worth labelling: inter-wave verify (2 fix attempts per wave) and remediation (2 rounds, then the verdict). `checkpoint` in the hero graph is the only node a human must pass through; inside the run there is no human node at all.

## C.4 What each state does

Render as a table under the diagram, or as the drawer content when a node is clicked. Columns: state · agents spawned · CLI called after · branch.

| State | Agents spawned | Then | Branch |
|---|---|---|---|
| `run start` | none | validates the change; asks whether the stored plan still matches its inputs | validate red → halt. Plan matches and all tasks ticked → close with `NO REMAINING WORK`. Plan matches with work left → narrow it, skip the classifier. Anything else → classify. The summary always says `PLAN REUSED (<status>)` or `PLAN REBUILT (<status>)`. |
| `classify` | one planner (session model). Reads proposal, design, tasks and specs in full: the artifact leash. Classifies every unchecked task with a tier 1–5, a model, predicted paths and `dependsOn`, and recommends `solo` or `waves`. Is told not to run the CLI itself. | `interlock run classified` | — |
| `run classified` | none | coverage check → `planWaves` → `plan.json` and its fingerprint → `state.json` | a checkbox omitted → halt naming the ids. A dangling edge, a backward edge or a cycle → halt naming it. Otherwise the plan preview is written before a single implementer spawns. |
| `run-batch` / `test-wave` (marker `implement`) | one implementer per lane, up to 8 in parallel. Model and effort follow the lane's hardest task. Each reads only what its tier needs, receives the previous wave's handoff packets, and must return its briefing's sha256 or the task fails closed. | `interlock run record-batch` | — |
| `run record-batch` | none | records outcomes against the run's own `git status`, not the agent's claim; folds worktrees under `--isolate-waves`; ticks the recorded-ok tasks | another batch → next batch. Wave done and another follows → inter-wave verify unless skipped (docs-only wave, red wave, or the per-run cap). No wave follows → done. Failures over the cap → halt. A real collision → halt naming the path and both lanes. |
| `verify` (inter-wave) | one verify agent, or none when the plan has no steps. Runs the commands the test profile names, verbatim, and reports exit codes and counts. It is never asked whether the run may continue. | `interlock run judge --context inter-wave` | green → next wave. Red → a retry briefed as a repair, up to 2 attempts per wave. Budget spent and blocking → halt. Budget spent and not blocking → warn, advance, and print `UNRESOLVED ERRORS CARRIED PAST A WAVE` at close. |
| `replan` | one haiku ping | `interlock run replan` | a declined or empty revision → carry on. A revision that touches an already-executed group → halt. Two per run. |
| `review` (strict) | one review worker at `xhigh` effort. Inside its own context it fans out one reviewer per dimension, then two skeptics per finding. The CLI selects the dimensions from the observed changed paths and inlines each rubric and the repo's `REVIEW.md` into the briefing. | `interlock run reviewed` | nothing survived → straight to final verify, no round spent. Otherwise → remediation round 1. |
| `remediate` (strict) | one fixer worker per round at `xhigh`; its plan is one fixer per file group, unscoped findings last, re-reviewing only the dimensions that raised something | `interlock run remediated --round n` | every blocker cleared → jump to the verdict. Otherwise the next round, up to 2. |
| `verdict` (strict) | one worker that fixes nothing and re-reviews nothing | — | blockers remain → halt, and no commit step is ever emitted. Clean → final verify. |
| `verify-final` (marker `fix-tests`) | one verify agent. The marker is `fix-tests` because the final step repairs a red suite by root cause, and that repair is exactly when weakening a test is the hazard, so the guard is in deny for test files. | `interlock run judge --context final` | unit red, weakened, or unrun → halt. Typecheck red → `TYPECHECK FAILED (non-blocking at the final gate)`. E2E red → `E2E FAILED (non-blocking by policy)` and the commit happens anyway. Green → handoff or commit. |
| `handoff` (strict) | one handoff worker. The CLI decides whether the diff needs a manual test plan and builds the conformance checklist; the agent writes `manual-test-plan.md`, `code-explanation.md`, `conformance.md` and memory entries. | `interlock run commit` | — |
| `commit` (marker `commit`) | one commit agent. One feature-level commit, a verb-phrase message from the artifacts, only the files this run touched. Never `git add -A`, never amend, never push. A hook denies `git commit` in any other stage. | `interlock run close` | `--no-commit` skips the agent and records it. |
| `run close` | none | reads the host's own token counter, the leftover task ids, builds the receipt, clears the stage marker, appends the outcome record, writes the terminal trajectory event, checks the trajectory can be replayed, pushes a notification if configured, runs the archive check | exit 0 on completion. Exit 1 on any halt, and on a clean run whose trajectory cannot be reconstructed. |

## C.5 How the plan is built

Section headline: **Waves, lanes and batches.**

The plan is a pure function of `classified.json` plus three options: the parallel cap, the mode, and the red wave. No filesystem, no clock, no randomness, so the same input produces the same plan every run.

- **Validation fails closed.** A `dependsOn` that names no task, points at a later section, or forms a cycle is a halt naming the ids. Dropping an unresolved reference would produce a plan that looks successful and runs in the wrong order.
- **The model clamp.** Only tier 5 may be opus. Classifiers reliably over-assign opus to anything touching several files, so the planner clamps after classification and prints every clamp: `clamped 1.4: opus → sonnet (tier 3)`.
- **Mode.** A `--solo` or `--waves` flag wins. Otherwise the classifier's recommendation is honoured inside the published solo envelope; above it, refused and named. Otherwise waves. The planner prompt is forbidden from naming the envelope, because a model that can read the bound can argue with it.
- **Sections are waves.** Tasks numbered `1.x` share a wave, `2.x` the next. A shared file is not a reason for a new section; name the path and let the planner fold. A cross-file dependency is a `dependsOn` edge, not a new section; an edge orders one task, a new section serialises every task in it.
- **Edges become layers.** Each section is split by dependency depth, and each layer is a wave. With no edges every task is depth zero and the plan is what it always was.
- **Hardest first.** Inside a layer, descending tier, so the tier-5 task whose failure means the design was wrong is discovered in the first batch rather than the third.
- **Collision on canonical paths.** Two tasks that claim a common canonical path, directly or transitively, join one lane run in order by one agent. `src/a.ts` and `./src/a.ts` are one file. A path that is absolute or escapes the repo root joins nothing and is reported, never rewritten into scope. This narrows the race; `--isolate-waves` closes it within a batch by making isolation a filesystem fact.
- **Cohesion packing.** Path-disjoint components at tier 3 or below pack into a shared lane, bounded by the lane's per-tier cap. Seven tasks each writing one `case.yaml` used to be seven spawns that then had to be told, by an eighth task, what convention to agree on.
- **Batches.** Lanes fill a batch while no path is double-claimed and the batch is under the parallel cap. A lane pushed out because the batch was full waits for a later batch; it is never folded into another lane's agent.
- **Singleton waves fold.** A wave holding one implementation task buys a checkpoint to express one thing: that its task runs after the previous wave. A later batch expresses the same ordering and costs nothing, so it folds, and the fold is printed. Never folded: a leading singleton, two real waves, the trailing test wave, or work onto the red wave.
- **Test tasks trail.** Every test task outside the red wave defers to a single trailing wave, so a cross-cutting test failure is diagnosed once against the finished implementation.
- **The red wave under TDD.** When `tasks.md` opens with the heading `## 1. Failing tests first`, that section runs first as an ordinary implementation wave and its inter-wave check is skipped without consuming a verification slot. The planner refuses the claim, with a warning and never a halt, when the section holds no test task or is not the first section.
- **The bill is in lanes, not tasks.** Projected agents = lanes + one record ping per wave + inter-wave verifications. Four tasks in one lane cost one spawn prefix, not four.

## C.6 The halts

Section headline: **Every halt, and what you do next.**

Intro: Two categories, and they are not the same thing. A **loud halt** stops the run, commits nothing, and reports what completed and what you need to decide. A **soft continue** keeps going with a documented default and prints a banner saying what it degraded. Almost everything is a soft continue. The halts are deliberately few. On any halt: nothing is committed, and it will not ask you a question. Every one is a non-zero exit from a CLI subcommand rather than a judgement call.

Loud halts (render in the Halts panel; each row is clickable and highlights its node):

| Banner | Trigger | Stage | Next |
|---|---|---|---|
| `SHIP HALTED — validate failed: <problems>` | an artifact missing or empty, or `tasks.md` has no real checkbox tasks | run start | `interlock validate <change>`; usually the change was never fully specced. |
| `SHIP HALTED — subagents unavailable` | ship orchestrates and never implements inline | pre-run | Allow the Agent tool. Do not ask the model to implement in the main conversation. |
| `SHIP HALTED — plan omitted unchecked tasks: <ids>` | the classifier dropped a checkbox | run classified | Re-run; if it recurs the checkbox wording is the problem. |
| `SHIP HALTED — waves failed: <message>` | a dangling, backward or cyclic `dependsOn` | run classified | Fix the edge in `tasks.md`. |
| `SHIP HALTED — <n> task failures accumulated across waves; more than 2 halts the run` | failures over the cap | record-batch | Repeated failures in one area mean `tasks.md` was underspecified there. Re-spec that slice. |
| `SHIP HALTED — inter-wave checks after wave <n> still failing after 2 fix attempts, and the caller reported the errors block <next>` | fix budget spent and blocking | judge, inter-wave | Fix by hand or `/interlock:fix-tests`. |
| `SHIP HALTED — verification reported no result for <kinds>` | a planned step nobody reported on | judge | An unverified step is not a passing one, and an unverified run does not commit. |
| `SHIP HALTED — unit suite is red (<n> failing, <k> root-cause cluster(s))` · `unit suite was weakened (<signal>)` · `unit suite did not run` | final verification | judge, final | Fix it, or `/interlock:fix-tests`. Ship will not weaken a test, loosen an assertion, or narrow the suite to get green. |
| `SHIP HALTED — <n> unresolved blocker(s) after 2 remediation round(s)` | strict only | verdict | Two failed rounds usually means the design was wrong, not the code. Re-spec rather than a third round. |
| `SHIP HALTED — merge-lanes halted on wave <n>: real collision on <paths>` | isolate-waves: two lanes wrote the same file despite a disjoint prediction | record-batch | Resolve the writes by hand from the named worktrees. Merge-lanes never applies a guess. |
| `SHIP HALTED — the run exceeded the published run-step cap without reaching a terminal state` | the loop is not converging | any | Read the trajectory. |
| `SHIP HALTED — out of sequence: the run program's last step named interlock <x> and this call was interlock <y>` | a driver skipped, repeated or invented a subcommand | any | A driver bug. |
| `SHIP HALTED — contradictory plan-shape flags: --solo and --waves were both passed` | both flags | parse | Pass one. Halting here costs one invocation; guessing costs a whole run of the wrong shape. |
| `RUN NOT RECONSTRUCTABLE: <problems>` (exit 1 even beside `SHIP COMPLETE`) | a sequence gap, a missing run-start, or a CLI call with no logged exit | close | `interlock run-log check`. Usually a write to `.claude/ship/` failed mid-run. `interlock doctor` probes exactly that. |
| Trampoline halt | Workflow tool unavailable | before the run | Enable dynamic workflows. Everything else still works. It does not fall back to chat and does not start the experimental runner. |
| `spec`: blockers at the artifact review | a reviewer reported a blocker | spec | Fix the cause, not the report. No silent fix-and-continue. |

Receipt lines that are not degradations, listed under the halts in muted text: `LEAN SHIP` (the advertised default, printed so a lean run cannot look like a strict one) · `ARCHIVE PENDING` (clean completion only; a reminder, never an action) · `PLAN REUSED` / `PLAN REBUILT` (always, in one of the two forms) · `leftover tasks (boxes still unchecked)` (a report, not authorisation to relaunch) · `run:` / `project:` / `cwd:` (always; the run id is the trajectory filename) · `No degradation banners — graph, test profile, model routing, verification and e2e were all clean.` (printed when the block would otherwise be empty, so silence and cleanliness are distinguishable).

Soft continues, the degradation banners (a second, filterable list in the Halts panel):

| Banner | Meaning |
|---|---|
| `GRAPH UNAVAILABLE: <reason>` | Agents fall back to grep: correct, slower, more tokens. Expected on Go, Rust, Java and Ruby repos. Nothing in the loop requires the graph. |
| `NO TEST PROFILE: run /interlock:fix-tests --reconfigure once` | Ship worked without discoverable commands. There is no branch where a command gets guessed. |
| `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=<value>` | Every agent runs on that model; the tier ladder is not in effect. A cost degradation, not a quality one. |
| `VERIFICATION SKIPPED: reason=<r>` | The fast between-waves loop was missing. The final unit suite was not skipped; that one halts when red. The reason strings are a contract: added to, never reworded. |
| `VERIFY CAP EXHAUSTED` | Inter-wave checkpoints beyond the per-run cap were skipped. |
| `UNRESOLVED ERRORS CARRIED PAST A WAVE: <n>` | The fix budget was spent and the run continued because the errors were reported as not blocking. Look at them. |
| `E2E FAILED (non-blocking by policy)` | The commit is not a statement that e2e passed. E2E is run and never repaired, because auto-fixing e2e is how a real regression gets papered over. You have to look at this one. |
| `TYPECHECK FAILED (non-blocking at the final gate)` | Halting between waves, reported at the end, because the published halt list does not include it and it must not become a fourth halt silently. |
| `LANE STOPPED EARLY: <ids> not attempted` | Tasks behind a failed sibling in the same lane are not counted as failures and stay unchecked. |
| `LANE WORKTREE PRESERVED: <label> at <path>` | A failed lane's writes were not folded. Inspect the worktree. |
| `BRIEFING NOT ACKNOWLEDGED: <label>` | The agent did not return its briefing's hash; the task fails closed. An agent that did not read its instructions did not do this task. |
| `CLAIM OVERRIDDEN: <ids>` | The implementing agent reported one thing and the run acted on what it recorded. |
| `CLAIM-DERIVED TALLIES` | No usable recorded outcomes, so the wave was counted from claims. The weaker source, said out loud. |
| `TASK TICK FAILED` | The work was done, the checkbox was not. Not a reason to re-ship. |
| `STAGE MARKER NOT PUBLISHED` / `NOT CLEARED` | A window in which a guard was not in force, or a marker left armed for the session. Never an exit code. |
| `REVIEW RUBRIC UNAVAILABLE: <dimension>` | That reviewer still ran, from the name alone. |
| `REVIEW METRICS NOT WRITTEN` | Bookkeeping only; the indicators will read unobserved. |
| `PLAN FINGERPRINT NOT STORED` | The next run pays a classifier pass. Said out loud rather than discovered as a slow run. |
| `TDD SHAPE REFUSED` / `INFERRED` / `UNAVAILABLE` | A shape the operator asked for and did not get is a banner, not a line in a plan file. |
| `TOKEN USAGE NOT REPORTED` | Recorded as unknown, never zero. A wave that ran agents did not spend nothing. |
| `CACHE ACCOUNTING NOT REPORTED` | The host exposes no cache decomposition. The Workflow runtime is such a host. Recorded as unknown rather than a measured zero. |
| `PUSH FAILED: <reason>` | The notification did not go out. Never echoes the topic. Never moves the exit code. |
| Runner only: `RUNNER HOST: <id> (experimental)` · `SUBSCRIPTION PATH: programmatic` · `CHATGPT PLAN PATH` · `HOOKS NOT IN FORCE (<host>)` · `MODEL ROUTING UNAVAILABLE (<host>)` | The billing path, the missing guards, and unrouted spawns, each named. A model is never guessed, because a wrong model that ran is invisible in a summary and a banner is not. |

Three conditions that are not halts at all, one line each under the tables: the preflight (`interlock doctor`, advisory, also a session-start hook); the mid-run permission prompt (the one interruption the runtime cannot prevent, since it is your setting being honoured); and Claude Code's `Large workflow` warning (advisory; a strict run crosses it easily, lean ship usually stays under).

## C.7 A worked example (the stepper script)

The change: `add-report-json-flag`, seven tasks across two numbered sections plus paired test tasks. Two tasks in section 1 both name `lib/report.mjs`. Default lean ship, no flags. Everything printed below is what the code does; nothing is invented. Each step names the node to highlight and the text the faux terminal appends. Task names are generic on purpose.

**Step 1 · node `ship_launch`**
```
/interlock:ship
```
The skill parses the arguments, calls the Workflow tool once, and stops narrating. From here nothing can ask the human anything.

**Step 2 · node `run_start`**
```
probe: hasGraph=true hasTestProfile=true subagentModelOverride=none
interlock run start --change add-report-json-flag --host workflow
validate: ok
plan reuse: no-plan → rebuild
```

**Step 3 · node `classify`**
```
spawn plan-waves (planner) — reads proposal.md, design.md, tasks.md, specs/** in full
wrote .claude/ship/classified.json: 7 tasks, recommendedMode=waves
```

**Step 4 · node `plan`** (the plan preview, printed before any implementer spawns)
```
interlock run classified --classified .claude/ship/classified.json
coverage: 7/7 unchecked boxes covered
mode: waves (classifier: two dependency layers across four files)
7 tasks → 3 wave(s), 5 impl + 2 test, max 8 parallel
  Wave 1: 3 task(s)
    lane [sonnet/T3] 2 tasks, one agent, in order:
    - [sonnet/T2] 1.1 add the --json flag to the report command
    - [sonnet/T3] 1.3 shape the JSON payload
    - [sonnet/T2] 1.2 thread the flag through the argument parser
  Wave 2: 2 task(s)
    - [sonnet/T3] 2.1 render the payload
    - [sonnet/T2] 2.2 document the flag
  Test wave: 2 task(s)
    lane [sonnet/T2] 2 tasks, one agent, in order:
    - [sonnet/T2] 3.1 unit tests for the payload shape
    - [sonnet/T2] 3.2 unit tests for the flag parsing
  clamped 1.3: opus → sonnet (tier 3)
  serialized 1.3: same lane in wave 1 (lib/report.mjs held by 1.1)
  cohesion 3.1 → 3.2: 2 path-disjoint tasks in the test wave on one sonnet/T2 agent
projected agents: 10 (5 implementers + 3 record + 2 verify)
```
Read that: seven tasks became five agents, not seven. The collision rule folded 1.1 and 1.3 into one lane because both write `lib/report.mjs`. Cohesion folded the two tier-2 test tasks into one lane. The classifier's opus on 1.3 was clamped to sonnet.

**Step 5 · node `batch`** (wave 1, batch 1)
```
spawn 1.1+1 (sonnet, effort inherit): tasks 1.1 then 1.3, one agent, briefing sha256 acknowledged
spawn 1.2   (sonnet, effort low):     task 1.2, briefing sha256 acknowledged
```

**Step 6 · node `record_batch`**
```
interlock run record-batch
lane 1.1+1: 1.1 ok, 1.3 ok   lane 1.2: 1.2 ok   (recorded against git status, not the claim)
ticked 1.1, 1.2, 1.3
wave 1 complete; another wave follows → verify (1 of 3)
```

**Step 7 · node `interwave_verify`**
```
spawn verify: typecheck, unit, lint — commands from .claude/testing/profile.json, verbatim
reported: typecheck exit 0 · unit exit 0 (212 pass) · lint exit 0
```

**Step 8 · node `judge_interwave`**
```
interlock run judge --context inter-wave
green → advance to wave 2
```

**Step 9 · node `batch`** (wave 2, batch 1)
```
spawn 2.1 (sonnet): receives wave 1's handoff packets
spawn 2.2 (sonnet): receives wave 1's handoff packets
```

**Step 10 · node `record_batch`** then **`interwave_verify`** then **`judge_interwave`**
```
interlock run record-batch — 2.1 ok, 2.2 ok — ticked
verify (2 of 3): green
```

**Step 11 · node `batch`** (the test wave)
```
spawn 3.1+1 (sonnet, effort low): tasks 3.1 then 3.2, one agent
interlock run record-batch — 3.1 ok, 3.2 ok — ticked
no wave follows → done → lean ship → verify-final
```

**Step 12 · node `final_verify`**
```
stage marker: fix-tests (guard-tests now denies edits to test files)
spawn verify: typecheck, unit, lint, coverage — e2e not enabled in this profile
reported: unit exit 0 (219 pass, was 212) · coverage 81% (advisory)
```

**Step 13 · node `judge_final`** then **`commit`**
```
interlock run judge --context final — unit green → completion gate passes → commit
stage marker: commit (guard-commit lets git commit through)
spawn commit: one feature-level commit, only the files this run touched
```

**Step 14 · node `close`**
```
interlock run close --notify
SHIP COMPLETE — add-report-json-flag
  PLAN REBUILT (no-plan): no stored plan at .claude/ship/plan.json
  wave 1 (run-batch): 3 ok, 0 failed
  wave 2 (run-batch): 2 ok, 0 failed
  wave ? (test-wave): 2 ok, 0 failed
  commit: 4a91c0e
  run: 7f2c1b8e-3d4a-4c11-9e02-5b6a7c8d9e01
  project: -Users-you-src-yourrepo
  cwd: /Users/you/src/yourrepo
ARCHIVE PENDING — add-report-json-flag: after merge, run openspec archive add-report-json-flag
Do not start another ship run unless the user asks.

LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable
No degradation banners — graph, test profile, model routing, verification and e2e were all clean.
GOAL MET: interlock ship returned a terminal summary.
```
Exit 0. Total agents: 20. One probe, nine control-plane pings, one planner, five implementers, three verify agents, one commit. Under Claude Code's advisory threshold for a large workflow. A `--strict` run of the same change adds a review worker, up to two remediation workers, possibly a verdict worker, and a handoff worker.

**Alternate ending (shown when the reader clicks the inter-wave halt in the Halts panel):**
```
SHIP HALTED — inter-wave checks after wave 2 still failing after 2 fix attempts, and the caller reported the errors block the test wave
  leftover tasks (boxes still unchecked): 3.1, 3.2
  PLAN REBUILT (no-plan): no stored plan at .claude/ship/plan.json
  wave 1 (run-batch): 3 ok, 0 failed
  wave 2 (run-batch): 2 ok, 0 failed
  run: 7f2c1b8e-3d4a-4c11-9e02-5b6a7c8d9e01
  project: -Users-you-src-yourrepo
  cwd: /Users/you/src/yourrepo
Do not start another ship run unless the user asks.

LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable
GOAL MET: interlock ship returned a terminal summary.
```
Exit 1. No commit. No question. Leftover tasks are a report, not authorisation to relaunch.

## C.8 Stepper behaviour

- **Step** advances one step and highlights that step's node; earlier nodes stay in a visited state (ink at 60%).
- **Play** runs the steps at 1.2 seconds each; **Reset** clears the terminal and the highlights.
- The `--strict` toggle, when on, inserts three steps between step 11 and step 12: `review` ("spawn review (xhigh): 4 dimensions selected from the changed paths — language, architecture, qa, technical-lead; devops and security not triggered"), `reviewed` ("7 raised, 4 dismissed by skeptics, 1 dropped as too weak to report, 2 surviving → remediation round 1"), and `remediation` ("round 1: 2 fixers by file → every blocker cleared → verdict → clean → verify-final"). It also inserts `handoff` between steps 13 and 14 ("manual test plan: skipped, none of the 6 changed paths is a UI-testable surface · code-explanation.md written · conformance: 5/5 scenarios confirmed") and adds two summary lines to the close: `review: 7 raised, 4 dismissed by skeptics, 1 dropped as too weak to report, 2 surviving` and `remediation: 2 fixed, 1 deferred`, and removes the `LEAN SHIP` line.
- The `--isolate-waves` toggle adds "lane worktrees created from the batch's merge base; merge-lanes: clean fold, 2 lanes" to each record-batch step and reveals the merge halt node.
- The `--solo` toggle replaces the plan preview with: `mode: solo (flag)` · `7 tasks → 1 lane, one opus agent, in order: 1.1 1.2 1.3 2.1 2.2 3.1 3.2` · `promoted 1.1: sonnet → opus (tier 2, solo lane)` (one line per task) · `projected agents: 3 (1 implementer + 1 record + 1 verify)`, and collapses steps 5 through 11 into one batch step.

---

# APPENDIX D — The First hour tab

## D.1 The timeline

Seven steps. Each has a mono timestamp, a one-line purpose, the command in a code panel with a copy button, and where given, the output to show.

**min 0–2 · Install**
```
npm install -g @fission-ai/openspec@latest
cd your-project && openspec init
/plugin marketplace add renzrollon/interlock
/plugin install interlock@interlock
```
Interlock drives the `openspec` CLI; it does not replace it. `openspec init` creates `openspec/` and installs OpenSpec's own skills, which stay available beside Interlock's.

**min 2–5 · Allowlist the commands**
```
interlock doctor
```
Workflow agents inherit your permission settings, so a command that is not allowlisted stops the run on an approval prompt, possibly while you are away. `doctor` derives the required list from what the flow shells out to plus whatever your own test profile runs, exits 1 when something would stop an unattended run, prints the settings snippet that fixes it, and changes nothing itself. The same check runs at every session start as an advisory hook.

Show this output, verbatim, as an example of a healthy repo:
```
PREFLIGHT OK — 8 passed
  [ok  ] node: Node v24.16.0 (plugin requires >=18, OpenSpec requires 20.19.0+)
  [ok  ] plugin: plugin 0.3.0 complete: workflow, both agent types, both binaries
  [ok  ] binaries: interlock and interlock-graph resolve on PATH
  [ok  ] openspec: openspec CLI available and this project is initialised
  [ok  ] git: git version 2.54.0 in a work tree
  [ok  ] test-profile: unit suite: npm test
  [ok  ] permissions: all 9 required commands are allowed
  [ok  ] state-dirs: every run-state directory is writable or creatable
  [skip] notify: INTERLOCK_NTFY_TOPIC is not set — optional; an unattended run that stops will not reach you
  [skip] prompt-cache: a prompt-cache lifetime is unset, so its bucket runs on the host default
  [skip] evals-harness: CLAUDE_CODE_WALNUT_SPIRE is not set
```

**min 5–20 · Onboard the repo, once**
```
/interlock:bootstrap
```
Initialises OpenSpec if the repo never was, builds the code graph, fans out five read-only explorers phrased in your stack's vocabulary, and writes `openspec/initial-architecture.md` plus one spec per feature that already exists. It confirms the feature list with you first, never overwrites an existing spec, and never modifies source. `--quick` on a small repo, `--scope packages/api` on a monorepo. If the repo is Go, Rust, Java or Ruby, expect `GRAPH UNAVAILABLE: nothing indexable found`; that is the ordinary case, not a defect. Structural indexing covers JavaScript/TypeScript, Python and shell. Nothing in the loop requires the graph.

**min 20–30 · Spec one small change**
```
/interlock:spec add a --json flag to the report command
```
Pick something genuinely small: one endpoint, one flag, one bug with a known repro. It explores first, drives the OpenSpec CLI to produce the artifacts, then reviews them. It writes:
```
openspec/changes/<change-name>/
├── proposal.md      what and why
├── design.md        how, and the decisions taken
├── tasks.md         ordered checkbox tasks — this is the wave plan
├── decisions.md     the decision ledger (Interlock's addition)
└── specs/**         delta specs, Given/When/Then
```
Then it stops, having written no code. If you asked for a bug fix, it refuses to create anything until you give it real error output and a reproduction. That gate is deliberate.

**min 30–40 · Read the spec**
The checkpoint. See the table in D.2. Two cheap machine checks that do not replace reading: `openspec validate` and `interlock validate <change-name>`. Ship runs the second one first and refuses to start on a failure.

**min 40–55 · Ship it**
```
/interlock:ship
```
Runs start-to-commit without asking anything. Before a single implementer spawns it prints the plan: waves, lanes, the model per task, every clamp and every fold. At the end it prints one summary, always ending in a degradation block. Useful flags for a first run: `--no-commit` to see the diff before git touches it, `--apply-only` to stop after the waves, `--strict` to see what the review and the bill look like.

Show this summary, verbatim, as the expected ending:
```
SHIP COMPLETE — add-json-flag
  PLAN REBUILT (no-plan): no stored plan at .claude/ship/plan.json
  wave 1 (run-batch): 3 ok, 0 failed
  wave 2 (run-batch): 2 ok, 0 failed
  wave ? (test-wave): 2 ok, 0 failed
  commit: 4a91c0e
  run: 7f2c1b8e-3d4a-4c11-9e02-5b6a7c8d9e01
  project: -Users-you-src-yourrepo
  cwd: /Users/you/src/yourrepo
ARCHIVE PENDING — add-json-flag: after merge, run openspec archive add-json-flag
Do not start another ship run unless the user asks.

LEAN SHIP: skipped review, handoff, conformance — pass --review / --handoff / --strict to enable
No degradation banners — graph, test profile, model routing, verification and e2e were all clean.
GOAL MET: interlock ship returned a terminal summary.
```

**min 55–60 · Merge request, then archive**
```
/interlock:mr --create              # detects GitLab or GitHub from the remote
openspec archive <change-name>      # after it merges. Stock OpenSpec; Interlock does not wrap it.
```
`openspec archive` folds the change's delta specs into the living specs, so the next `spec` plans against what is now true. Interlock never archives for you. It prints `ARCHIVE PENDING` and counts the backlog in `interlock drift`.

**Do not run these yet** (a small muted list under the timeline): `dispatch`, `graph`, `docs-digest`, `explore`, `review-artifacts`, `review-code`, `fix-tests`, `manual-test-plan`, `explain-code`, `commit`, `spec --continue`. Every one is either called by the four commands above or is a recovery tool. "Skipping the read before you have done it once is skipping the part of the loop that earns the rest."

## D.2 The ten-minute read (the checkpoint table)

Headline: **You read the spec. That is the whole ask.**

Intro: A wrong idea costs a paragraph here and a day after shipping. Read cheapest-to-reject first.

| Minutes | File | The one question you are answering | Red flags |
|---|---|---|---|
| 0–2 | `proposal.md` | Is this the change I asked for? | A change name broader than the request. Work nobody asked for. A bug fix that grew a refactor. |
| 2–5 | `design.md` | Would I have made these decisions? | An abstraction for a single caller. A decision with no rationale. A dependency named without a version. "We'll handle X later" where X is the hard part. |
| 5–8 | `tasks.md` | Could someone else do this without asking me anything? | "update accordingly", "handle edge cases", "refactor as needed", "etc." Consecutive checkboxes naming the same file. |
| 8–10 | `specs/**` | Does this describe behaviour I can verify? | "should work correctly". Missing empty, error, loading, boundary and permission-denied cases. |

Four exits, as four short lines under the table:
- Wrong idea: re-run `spec` with a sharper intent and an explicit out-of-scope boundary.
- Right idea, wrong approach: say what you want instead and re-spec. The explore brief is reused, so the second pass is fast.
- Right idea, small gaps: edit `design.md` or `tasks.md` by hand. Plain markdown; ship reads whatever is on disk.
- Looks right: `/interlock:ship`.

## D.3 What you will be asked

Headline: **Every question the loop can ask you.**

Intro: `spec` is conversational where it has to be. `ship` is not, and cannot be.

| When | The question | Trigger |
|---|---|---|
| `spec` | What change do you want to work on? | The request is not clear enough to name a change. |
| `spec` | Real log output or the error message, **and** a reproduction: a failing test path or a command that triggers it | The request is a bug fix. No artifact is created until both exist. "A repro is required so the fix has a pass/fail signal; without it we are fixing a symptom." |
| `spec` | Which version of this dependency? | The design names a dependency without one. A plausible-looking wrong pin is worse than an open question. |
| `spec` | Test-first or implementation-first? | `--tdd` and `--no-tdd` were both passed. |
| `spec` | Continue the existing change or start a new one? | A change with that name already exists. |
| `spec --continue` | "Continuity paused — N decisions need you", listing only the ledger rows and blockers | `interlock ready` exited 1. The last place a question is possible. |
| `bootstrap` | Generate specs for all discovered features, or select some? | Always, before generating. |
| `bootstrap` | This project already has N specs; add specs for undocumented features without overwriting any? | `openspec/specs/` is non-empty. |
| `fix-tests` | At most four questions, once: the unit command, the single-file filter syntax, required environment, the e2e command | First run or `--reconfigure`. The only skill permitted to interview you about tests. |
| `mr` | GitLab or GitHub? | Only when both or neither of `glab` and `gh` resolve. |
| `mr` | Overwrite this description? | It contains hand-written prose. |

## D.4 Never asked, decided in code

Headline: **What is never asked, because a CLI already decided.**

Intro: Read the values from `interlock limits`. The page does not restate a threshold as its own rule.

| Never asked | Decided by |
|---|---|
| How many agents run in parallel | `interlock waves`, from the published cap |
| How many tasks one agent's lane may hold | the lane-cap table, keyed by the lane's hardest task tier |
| Which model and reasoning effort each task earns | the tier ladder; opus is clamped to sonnet below tier 5 and every clamp is printed |
| Whether two tasks may share a batch | `interlock waves`, on canonical-path collision |
| How many remediation rounds, root-cause repairs, replans, inter-wave fix attempts, task failures | the caps, each with one reader in the loop |
| Whether a review finding survives | `interlock review`: a dismissal needs a `file:line` inside the diff |
| Which findings are too weak to report | `interlock gate`'s quality band, in the CLI, never in the review prose |
| Whether a review blocks | `interlock gate`: the exit status is the verdict |
| Whether a diff needs a manual test plan | `interlock surface` |
| Whether a change may skip the checkpoint | `interlock ready`, fail-closed: a check that could not run is a blocker |
| The blast radius of a change | `interlock risk`: the maximum over every signal, never an average |
| Which checkboxes may be ticked | `interlock tasks tick`, keyed off recorded outcomes; a hand edit is denied by a hook |
| Whether the plan dropped a checkbox | `interlock tasks coverage`; an omitted box halts |
| Whether a run can be reconstructed | `interlock run-log check`; an unreplayable trajectory halts a clean run |
| Whether a `REVIEW.md` may move the bar | it may change scope and advice; a threshold-shaped key is reported and ignored |

## D.5 If you have only ever prompted

Headline: **From prompt to workflow.**

Intro: You type instructions into a chat box and get code back. That is your whole model of working with an LLM, and it works. This section assumes exactly that and nothing more. By the end you will know why `/interlock:ship` is a JavaScript file instead of a prompt, and why that is the entire point.

The ladder. Fifteen terms, each defined in one sentence, no definition using a term below it. Render as a numbered list where clicking a term reveals its definition.

1. **prompt** — Text you send the model, hoping for the right thing back.
2. **harness** — The program that gathers files, sends them with your prompt, and applies what comes back. Claude Code itself.
3. **context window** — The fixed amount of text a model can see at one time.
4. **tool-use loop** — The model asking the harness to act, reading the result, and going again.
5. **skill** — Instructions in a markdown file that the model reads and follows.
6. **subagent** — A fresh model instance with an empty context window and one task.
7. **orchestrator** — Whatever spawns the subagents and decides what happens next.
8. **workflow** — A script a runtime executes, which calls the model as a step inside itself.
9. **workflow runtime** — The part of Claude Code that runs that script and accepts no user input while it does.
10. **CLI** — A terminal program that prints an answer and exits with a number.
11. **exit code** — That number. Zero means fine; anything else means stop.
12. **wave** — A set of tasks that must finish before the next set starts.
13. **batch** — A slice of one wave that runs simultaneously, capped.
14. **tier** — How much spec context and which model a task earns, one to five.
15. **checkpoint** — The single deliberate stop, between spec and ship.

The three failures prompting hits, in order:

1. **The clipboard runs out.** A forty-file change plus its plan plus its test output does not fit in one context window, and it degrades before it overflows. The model does not warn you when it starts skimming.
2. **The plan gets forgotten while it is being carried out.** Forty minutes in, the plan is thirty turns back, competing with stack traces. An agent that was tracking three constraints is now tracking one, and it will not tell you which two it dropped. It does not know either.
3. **A rule written in a prompt is a suggestion.** Write "cap remediation at two rounds" into a prompt. Now imagine the situation the cap exists for: forty minutes in, two rounds have not fixed it, and it is close. Ask the model whether it has earned a third round. It will say yes. It will be articulate about why. It is not lying to you; it is reasoning from inside the situation the cap exists to constrain.

The three nouns, each answering one failure:
- A **skill** answers none of them. Instructions the model follows are instructions it can also decide not to follow, for reasons that will sound good at the time.
- A **subagent** answers the first. Instead of walking every room yourself with one clipboard, you hire one contractor per room.
- A **workflow** answers the second and third at once. The plan cannot be forgotten because it is not in anyone's memory; it is the control flow. A cap cannot be argued past because there is nothing there to argue with.

The fourth piece, why a rule goes in a CLI: a CLI prints an answer and exits with a number, and the number is the part that matters. The script branches on the exit code and on named fields, never on a sentence the model composed. Two payoffs: you can run the same command yourself, no model, no network, and see the same decision the run made; and the rule cannot be quietly re-argued next run, because it is not written anywhere a model can read and reinterpret, only somewhere a model can call.

The punchline, verbatim, set large:

> `/interlock:spec` is a skill. It can ask you questions, because a skill runs inside a conversation and there is a person on the other end of it. Then you read the spec. `/interlock:ship` is a workflow. It cannot ask you anything. Every tool in this category promises autonomy in a prompt; this one gets it from the shape of the thing it runs on.

## D.6 The order for four kinds of work

Render as four short numbered lists in a two-by-two grid.

**A feature**
1. `/interlock:spec add a --json flag to the report command`
2. Read the spec. Ten minutes.
3. `/interlock:ship`
4. `/interlock:mr --create`
5. `openspec archive <change-name>` after it merges.

**A bug fix**
1. Collect the evidence first: real log output or the error, and a reproduction. `spec` refuses to create anything without both.
2. `/interlock:spec fix the 500 on /api/export when the tenant has no rows`. Task 1 of `tasks.md` is the failing repro test. Later tasks are constrained to the root cause, plus every consumer of a shared value the sweep found.
3. Read the spec. Is task 1 the repro? Did a refactor sneak in?
4. `/interlock:ship`
5. `/interlock:mr --create`, then archive after merge.

**A change that touches UI**
1. `/interlock:spec <the UI change>`
2. Read `specs/**` especially: empty, error, loading, boundary and permission-denied states.
3. `/interlock:ship --handoff` emits the manual test plan and a code walkthrough.
4. `/interlock:mr --create --test-plan --explain`. Both land as comments, never in the description.

**After a halt**
1. Read the summary before re-running anything. It names every default that was applied.
2. `interlock run-log query --run <id> --halted` shows only the events that explain the halt.
3. Fix the cause. A red suite: `/interlock:fix-tests`. More than two task failures: `tasks.md` was underspecified there; re-spec that slice. Blockers after two rounds: re-spec. "Two failed rounds usually means the design was wrong, not the code."
4. `/interlock:ship --apply-only`, so review and commit are not paid twice.

Never auto-retrigger. Leftover unchecked boxes after a run are a report, not authorisation for a second run.

---

# APPENDIX E — The Deep dive tab

Eight anchored sections: Review · Caps · Verify · Drift · REVIEW.md · Evals · Cost · Receipts.

## E.1 Review: a dismissal must cite evidence

Headline: **A dismissal needs a citation. A report doesn't.**

Intro: An unverified review reports everything it notices, so you learn to skim it. A review where every blocker survived two adversaries is one you read line by line. Review is opt-in: `/interlock:ship --review`, `--strict`, or `/interlock:review-code` on its own. Default ship does not pay for it.

### E.1.1 Dimensions

Four dimensions always run: `language`, `architecture`, `qa`, `technical-lead`. Two are added by a deterministic rule over the run's observed changed paths, never by a reviewer's judgement: `devops` when a path suggests deploy, CI, config or infrastructure impact; `security` when a path matches the authentication, permissions or tenancy signal. The rule is the same classifier the rest of the loop uses, so the two places the question is answered cannot drift apart. A dimension name that resolves to no rubric file is an error that names the six, never a silent partial review.

In a ship run, one review worker at the highest reasoning effort fans out one reviewer per dimension, then two skeptics per finding, inside its own context, and returns counts only. The rubric for each dimension is read from the plugin, not the target repo, and inlined into the briefing. A rubric that could not be read still gets a heading and a `REVIEW RUBRIC UNAVAILABLE` banner; that reviewer works from the name alone.

### E.1.2 Two skeptics per finding

Every blocker and warning gets two independent skeptics, in parallel. Suggestions pass through unverified; they are cheap to ignore and not worth the tokens.

- **Skeptic one is told to refute.** Read the actual file and its surrounding context. Try to prove the finding is a false positive, overstated, or missing context. Default to real when genuinely uncertain.
- **Skeptic two gives a second opinion.** Read the file. Is this real? Is the severity right? Is the fix appropriate?

Both must read the file. A verdict reached from the finding text alone is worthless; the mechanism depends on the skeptic having context the original reviewer lacked. Each returns a verdict with `isReal`, a confidence, reasoning, optional evidence, a refined severity, a quality score from 0 to 5 (0 incomprehensible, 3 usable, 5 exemplary) and a severity score from 0 to 5 (0 cosmetic, 3 user-visible bug, 5 data loss or security breach).

### E.1.3 The citation rule

Voting a finding real needs nothing but the vote. That direction already ends with a human reading it, which is the cheap error.

Voting a finding not real needs a citation, checked mechanically in two halves, because either alone is defeated: a `path:line` or `path:start-end` token, and a path that canonicalises to one actually present in the reviewed diff. Non-emptiness alone was once satisfied by a thumbs-up emoji; shape alone is satisfied by inventing a file that does not exist. The line is not required to still exist in the file, because a review runs against a diff. What is deliberately not checked is whether the cited span supports the claim: that needs a model, and a model there recreates the problem one layer down.

An uncited refutation is a non-vote, never a deleted verdict. It does not dismiss, and it is not a vote to keep. Its quality score still counts, because a skeptic can be too lazy to cite and still be right that a finding is badly written. Every refused refutation is counted and printed. A high count means the skeptics are asserting rather than reading, which is itself the signal you want.

The precedent: Refute-or-Promote (arXiv 2604.19049) documents eighty-plus agents, dedicated adversarial reviewers among them, unanimously endorsing a padding oracle in OpenSSL's CMS module that did not exist. Confident prose is the single thing an LLM produces most reliably, so it is the one thing a dismissal must not rest on.

### E.1.4 The vote

1. A finding survives when at least as many skeptics voted it real as voted it not real, counting only cited not-real votes.
2. A tie keeps the finding. With two skeptics a one-to-one split is the common case, so this is the rule that matters most. The two errors are not symmetric: a surviving false positive costs ten seconds of reading; a wrongly dismissed finding is invisible.
3. No verdicts means survival. Absence of adjudication is not dismissal.
4. Severity is refined to the most severe opinion among skeptics who thought the finding real. A blocker demoted to a warning by verification is a feature.
5. The quality band runs after survival.

### E.1.5 The quality band and the gate

`interlock gate` applies a band before counting blockers, so a vague blocker cannot hold up a change. Unscored findings are kept: absence of a score is not evidence of low quality. A scored finding below the floor is dropped, unless the two skeptics disagree by more than the tolerated drift, in which case the disagreement is itself signal and the finding is kept. Dropped-by-quality is reported separately from dismissed, because "the skeptics refuted it" and "it was too vague to act on" are different facts. The floor lives in the CLI and nowhere else; a repository cannot move it.

A severity outside `blocker`, `warning`, `suggestion` is a rejection, not a bucket. A reviewer once emitted `critical`, a more alarming word than the enum's maximum, and it landed in a bucket the gate did not block on, so the scarier word passed more easily than `blocker` did. The gate now refuses to pass while a malformed severity is outstanding. The verdict is a count, not a judgement: the gate passes when there are zero surviving blockers and zero malformed findings.

Findings partition into fixers by file. One group per file is the parallel-safe partition; findings with no owning file are applied last, sequentially. Blockers are always fixed. Warnings are fixed alongside them but never halt. Suggestions are always deferred by policy, because a model asked to triage its own review will negotiate with itself. Nothing is dropped silently: every deferred finding carries its reason, and the receipt prints how many were fixed and how many deferred.

The report always prints the counts, and they always sum back to the number raised: dropped by policy, dismissed by skeptics, dropped as too weak, surviving. Example line: `review: 7 raised, 4 dismissed by skeptics, 1 dropped as too weak to report, 2 surviving`. Those numbers are the evidence the review is worth trusting; hiding them makes a verified review look identical to an unverified one.

### E.1.6 The adjudication simulator (sample data)

Four findings for the interactive simulator. The diff under review touched `app/api/export/route.ts`, `lib/report.mjs`, `lib/cache.mjs`. Note that `src/utils.ts` is **not** in the diff.

| # | Severity | File | Title | Skeptic one | Skeptic two | Outcome |
|---|---|---|---|---|---|---|
| 1 | blocker | `app/api/export/route.ts:31` | Unauthenticated tenant data access | real · quality 5 · severity 5 | real · quality 4 · severity 5 | **Survives.** Two real votes. Blocker stands. |
| 2 | warning | `lib/report.mjs:88` | Unused import of `formatDate` | not real, cites `lib/report.mjs:12-14` (in the diff) · quality 2 | not real, cites `lib/report.mjs:88` (in the diff) · quality 2 | **Dismissed by skeptics.** Two cited not-real votes, zero real. Never shown. |
| 3 | blocker | `lib/cache.mjs:40` | Cache key built from the raw email, not the canonical form | not real, evidence: "👍" · quality 3 | real · quality 4 · severity 4 | **Survives; one refutation refused.** The uncited dismissal is a non-vote. One real vote against zero counted not-real votes. Blocker stands. |
| 4 | warning | `src/utils.ts:5` | Consider refactoring for clarity | real · quality 1 | real · quality 2 | **Dropped as too weak to report.** It survived the vote, but the higher score (2) is below the floor and the two scores are within drift, so the band drops it. Deferred with its reason. |

When the reader presses **Adjudicate**, reveal each row's verdicts one at a time, then print:

```
review: 4 raised, 1 dismissed by skeptics, 1 dropped as too weak to report, 2 surviving
refutations refused: 1 (a "not real" vote with no file:line citation inside the diff)
GATE BLOCKED — 2 blockers of 4 findings
```

Then a second button, **Cite it**, that replaces finding 3's skeptic-one evidence with `lib/cache.mjs:40`. Re-adjudicating gives one cited not-real vote against one real vote: a tie, which keeps the finding. Print: "A tie keeps the finding. The two errors are not symmetric."

## E.2 Caps: every number the loop obeys

Headline: **Read from `interlock limits`. Never restated.**

Intro: Every value below lives in one file and is printed by one command. A threshold restated in a skill or a reviewer prompt is a blocker-severity finding in this repository's own review policy. A published cap that nothing reads fails a test; two were deleted on that rule rather than documented. The raw output is in Appendix G.1; this table adds the reason each cap exists.

| Cap | Value at v0.3.0 | Why it exists |
|---|---|---|
| max parallel agents per batch | 8 | The original implementation put thirty classifier-grouped tasks into thirty concurrent agents. Waves wider than this split into batches. |
| inter-wave fix attempts, per wave | 2 | A failed check buys bounded targeted repair; after that the run halts if the errors block the next wave, or warns and continues. |
| replans, per run | 2 | A plan revision is legitimate; an unbounded re-planning loop is a run that never converges. |
| remediation rounds | 2 | Blockers surviving the verdict round after this halt. Two failed rounds usually means the design was wrong, not the code. |
| root-cause iterations, per run | 5 | Repairing by root cause is slow by design; this bounds it before a ship becomes an open-ended debugging session. |
| task failures tolerated | 2 | Strictly more halts. A run losing three tasks is not producing a coherent change. |
| run steps, per run | 200 | A run that has taken this many CLI steps without a terminal state is not converging. |
| inter-wave verify budget | 60s | Past this, drop to typecheck only, rather than letting the checks outweigh the work they guard. |
| inter-wave verifications, per run | 3 | A wave boundary is ordering; a checkpoint is an agent. Ordering is free, so the cap is on checkpoints. Docs-only and red waves skip without consuming one. |
| verify spill threshold | 8192 bytes | Above this a step's output goes to disk instead of into an agent's context. |
| verify preview budget | 4096 chars | The head-and-tail preview of a spilled log, and the ceiling every verify result field must stay under; a field over budget is rejected as a leak. |
| wave handoff budget, per task | 2000 chars | Over budget fails the task rather than truncating: a next wave reading half a sentence is worse off than one told the report was rejected. |
| review policy scan cap | 65536 bytes | Bounds the `REVIEW.md` read, so a committed build log with that name cannot make the reader do unbounded work. |
| push timeout | 5000 ms | A hanging notification must not stall the close. |
| lane caps by tier | T1 8 · T2 8 · T3 6 · T4 4 · T5 8 | Keyed by the lane's hardest task. Tier 4 stays small because cross-file pattern-following is where a fresh context per task still pays. Tier 5 is larger because the point of an opus worker is that it can hold more of one design in its head. |
| cohesion tier ceiling | 3 | Path-disjoint siblings pack into one lane only at or below this tier. |
| solo envelope | 20 tasks | The classifier supplies the shape judgement; this supplies the ceiling. The planner prompt is forbidden from naming it. |
| reasoning effort | T1 low · T2 low · T3 inherit · T4 inherit · T5 xhigh · review skeptics xhigh | The two steps whose whole job is catching what an implementer missed get the most reasoning. |
| runtime ceilings | 16 concurrent, 1000 agents per run | The host's, not policy. The planner clamps below them rather than discovering them the hard way. |

## E.3 Verify: what red means

Headline: **A suite that went green by shrinking is not green.**

`lib/verify.mjs` decides and never verifies. It spawns nothing, reads nothing, executes nothing. The CLI plans which commands should run, an agent runs them and reports exit codes and counts, and the CLI judges what the results mean. The agent is never told a threshold and never renders a verdict.

- **Every command comes from your test profile, verbatim.** Five kinds in a fixed order: typecheck, unit, lint, coverage, e2e. There is no branch where a command gets guessed. "Use the test profile" became "run `npm test`" the moment a model could not find the profile quickly, which is why the profile is a file and the plan reports `hasProfile: false` with a skip reason instead of inventing one.
- **Two contexts, two halting sets.** Between waves, a red typecheck or unit suite halts, because a type error must not let the next wave build on top of it. At the final gate only the unit suite halts; a red typecheck is reported, because the published halt list is exhaustive and a fourth halt must not appear silently. Coverage is advisory by construction. E2E is run and never repaired.
- **Red has five meanings, in priority order.** The suite did not run (halt). The suite was weakened (halt, and it outranks a green exit). Green. Red but pre-existing (a warning, not a halt). Red (halt).
- **Failures cluster by root cause.** A failure line is reduced to a signature by erasing what differs between two occurrences of one cause: paths, line numbers, addresses, hashes, timings. The error class, the message and the expected-versus-actual survive. Clusters sort by size, so the repair budget goes to the biggest cause first.
- **The shrink check.** Given a baseline, a test count that fell means tests were removed, not fixed; a skipped count that rose means failures were silenced, not fixed. Without a baseline the check says it is unavailable rather than pretending. This is the only thing standing between a repair step and a weakened test on a host with no hooks.
- **The guard.** The final verification publishes the `fix-tests` stage marker, so the test-file guard is in deny exactly when the hazard is live. The retry briefing flips from "do not repair unless you can fix the root cause without weakening a test" to "repair the root cause of each listed failure, then re-run". Both end the same way: never weaken a test, loosen an assertion or narrow the suite.

## E.4 Drift: specs that don't quietly rot

Headline: **Measured at three confidence levels. Never averaged.**

OpenSpec is spec-anchored: `openspec archive` merges a completed change's deltas into the living specs. Interlock never archives for you. It stops the step being forgotten.

Render as a ladder, most certain at the top:

| Finding | Confidence | Basis |
|---|---|---|
| Unarchived changes | **certain** | Every task ticked, the change still in `openspec/changes/`. Read off the filesystem. |
| Broken references | **evidence** | A living spec cites a file that is not there. The file existed when the graph was built. |
| Orphan code | **evidence, scoped** | Changed source files no spec describes. Always reported with a repo-wide coverage figure: "2 files have no spec" is alarming, "2 of 6, in a repo where 34% of source files have one" is informative. |
| Aging specs | **inference** | A spec older than a file it cites. Dates, not behaviour. Printed last for that reason. |

A deleted file appears under broken references only, never also under aging. Absence is never reported as cleanliness: no graph, no living specs and no changed files are three distinct messages, not a pass. `interlock conformance` is the other half: it lists the scenarios a change's delta specs promised, so each can be checked against what was built. It emits questions, never verdicts.

Neither blocks. Every other gating subcommand exits non-zero when it blocks; these two never do. A gate built on regex-inferred spec-to-file links would be wrong often enough to get switched off, and a gate everyone disables protects nothing. Archiving rewrites the living specs, which is a decision for whoever merged the change, not for a tool that noticed a date.

## E.5 REVIEW.md: what a repo may own

Headline: **Scope and advice, never the bar.**

An optional file at the repository root, read on every review. Two consumers, one per trust level:

| Part of the file | Consumer | Trust | Effect |
|---|---|---|---|
| Prose: who owns the bar, what "Important" means here, why paths are excluded | the reviewer prompt | advice | Injected into every reviewer as quoted repository context. It cannot lower survival. |
| `## Do Not Report` paths | the CLI | enforced | Findings on those paths are dropped before the band applies, and each drop is reported with the excluding path. |

A model is never handed the path list as something to honour. A path exclusion a model can choose to ignore is not an exclusion. What the file cannot change is the quality band or the nit cap: a threshold-shaped key is reported as not an accepted field and ignored, never adopted. Exclusions shrink the input set; they never lower the bar. No file means the feature is off. A malformed file is reported and the run proceeds under default policy, with each half validated independently, because a typo in a policy file must never block a ship run but must be visible. Path matching is canonical and case-sensitive: `dist` excludes `dist/bundle.js` and not `distant/a.js`, and Interlock accepts a visible under-exclusion over a silent over-exclusion.

## E.6 Evals: what your run is checked by

Headline: **No model evals run in your CI.**

The deterministic spine is densely unit-tested. The prompts and skills that steer a model are regression-tested against a real model by an eval suite of eleven cases, each citing the reproduced failure it encodes: tier read scope, cited-cap resolution, lane partial-failure reporting, handoff enum conformance, control-plane action invention, trampoline halt and launch, skill routing, and evidence-locator fabrication. The case list is pinned in a test that compares it to directory discovery, on the same rule as everything else here: a list nobody asserts silently drifts.

The verdict is model-free. `interlock evals triage` classifies a results file as regression, variance, or no signal, with no model and no network, and its exit code is the verdict, so the one gate a model could otherwise re-argue is on the deterministic spine like every other decision. The suite is advisory pending a baseline; no blocking threshold exists because it would be a guess.

For a team running Interlock against its own product: the model-facing surface is identical in every consumer, your own suite and your read at the checkpoint answer what you actually want to know, and the eval harness is early-access and metered on terms you do not control. So Interlock runs no model evals in your CI. A misbehaving run becomes a citable report with `interlock evals capture`.

## E.7 Cost: reading less is accuracy, not thrift

Headline: **Cost is not the point. Degradation is. The two are the same lever.**

Context rot is the reason; cost is the side effect. Chroma measured accuracy degradation across eighteen frontier models as context grows, even when every relevant token is present. Four mechanisms, each visible in the plan or the receipt:

1. **Context tiering.** Tier 1 reads the task description and nothing else; tier 2 adds the relevant section of the design; tier 3 the relevant spec file; tier 4 and above the design and specs in full. Tiers 1 and 2 carry a stop instruction: after typecheck and lint pass, stop; do not refactor or polish. The exception is load-bearing: an agent implementing against an active change reads the proposal, design, tasks and delta specs in full. Budgeted retrieval replaces exploratory preload, not the implementation contract.
2. **Model routing with a clamp.** Tier 1 to haiku, tiers 2 to 4 to sonnet, tier 5 to opus. Control-plane pings run on haiku; they parse JSON and report it verbatim. Classifiers reliably over-assign opus to anything touching several files, so the planner clamps after classification and prints every clamp. Reasoning effort is tabled per tier; the verify and skeptic steps are pinned to the highest.
3. **Locate before you read.** Query the graph before you grep; locate the line, then read a span. Retrieval is budgeted in tokens: the docs digest at roughly 2500, a graph context bundle at 2000, a docs query at 800, a structural query at 1500.
4. **Spawn weight, not just spawn count.** Two named plugin agents with tool allowlists that exclude Skill, Agent and MCP, so workers stop inheriting tens of thousands of tokens of schemas per spawn. Cohesion lanes fold sixteen tier-2 test tasks into one agent reading the design once. Singleton waves fold into batches. Solo mode ships a small change on one opus agent.

| Tier | Work | Model after clamp | Effort |
|---|---|---|---|
| 1 | trivial one-file edit | haiku | low |
| 2 | single-concern change | sonnet | low |
| 3 | new logic in one domain | sonnet | inherit |
| 4 | cross-file work following existing patterns; breadth is not depth | sonnet | inherit |
| 5 | genuinely novel architecture; the only tier that may be opus | opus | xhigh |

**Prefix lifetime**, the axis the four above never touch. Writing a prefix to cache costs more than not caching (1.25x base input for the five-minute tier, 2x for the one-hour tier); reading one back costs 0.1x. A prefix that survives to be read is a large saving; one that expires before the next wave is a surcharge on work you would have paid for anyway. Wave boundaries measured in this repository's own trajectory ran to 363 and 1017 seconds, both past the short default lifetime. Interlock cannot set either lifetime, because a plugin has no settings component, and says so. What it does: `interlock doctor` reports the two settings keys and which scopes configure them, advisory and never failing; a run records cache reads and cache creation per wave, creation split by lifetime tier and never summed; and cache accounting is a declared host capability, bannered where absent. The Workflow runtime exposes one cumulative scalar, so a ship run prints `CACHE ACCOUNTING NOT REPORTED` and records unknown, never zero. The price table carries an id, and a revised price is a new id rather than an edit, so old rows keep meaning what they meant. The multipliers have no reader yet; the change records the data so a dollar figure becomes computable, and stops there.

**The billing note, as a callout.** A Claude subscription can only be spent through the interactive `claude` binary. `claude -p`, the Agent SDK and ACP are the usage Anthropic flagged for separate metered credit; the interactive Workflow runtime is the path that change exempted. So `/interlock:ship` stays the default, no skill ever starts the runner, and every run on the runner prints `SUBSCRIPTION PATH: programmatic`.

**Two cost kill-switches to name.** `CLAUDE_CODE_SUBAGENT_MODEL` overrides every per-tier model; a run of forty tier-1 tasks costs forty opus calls if that is what you exported, and Interlock banners it rather than reporting a clean run. A missing allowlist entry parks the run on a permission prompt, and a parked run re-runs work on resume.

## E.8 Receipts and the report

Headline: **A run nobody watched can still be reconstructed and priced.**

Four artifacts, in increasing depth:
- **The summary** names every default applied, the run id, the project slug and the directory, and prints the banner block even when clean.
- **The receipt** records the host, its billing path, its hook availability and cache-accounting declaration; per-wave and per-run token spend; the plan-reuse status; remediation rounds; the paths the commit touched, read from version control rather than reported by the commit agent; and the paths the plan predicted.
- **The trajectory** is append-only JSONL: `interlock run-log show <runId>`, `query --halted`, `query --type verify-judgement`.
- **The report**, `interlock report --html`, renders indicators over all three corpora as one self-contained offline document. Every value carries its denominator. An unobserved indicator renders at the same weight as a number, with its reason, never as a zero, a dash, a grey row or a collapsed cell. No threshold, no target, no trend arrow, no colour encodes health. It gates nothing, and that is policy: a rate over three observations is not a rate.

---

# APPENDIX F — The Compare tab

## F.1 The landscape

Headline: **Most tools compete on how much structure you write. This one competes on how many decisions the model is not allowed to make.**

Intro: Read down the layer column and the map resolves. OpenClaw is a harness plus a channel layer. Hermes is a harness plus a channel plus a memory layer. DeepSeek Harness is a harness and nothing else. Interlock is a process layer with no harness of its own; it borrows Claude Code's. Against the tools that sit at Interlock's layer, the difference is where the enforcement lives.

| Tool | Layer | Competes on | Where Interlock differs | Where it is honestly better |
|---|---|---|---|---|
| Spec Kit | process | phases before code; breadth of host support | caps, gate verdicts and the review band are a tested CLI with exit codes, not prompts a model follows | portability: it runs on roughly thirty agents; Interlock runs on one |
| BMAD | process | roles and ceremony: PM, architect, dev, QA agents | no role-play; tiers, lanes and a model clamp. Judgement stays with the model, sequencing does not | the role vocabulary is legible to non-engineers |
| Kiro | IDE and process | an IDE experience around specs | a terminal plugin with CLIs on your PATH; nothing renders | the IDE. Interlock has none and is not building one |
| OpenSpec, stock | artifact format and lifecycle | the spec contract, templates, validation, archive | Interlock composes it and does not fork it; it drives the CLI because the CLI is the stable contract | simplicity and artifact portability. For a one-line change, propose it and implement it yourself. Uninstall Interlock and `openspec/` is still valid |
| OpenClaw | harness and channel | your assistant exists when your laptop is closed: messaging apps into one gateway | a different floor entirely. It does not know what a wave is and will not cap a remediation round | reach: start work from your phone and keep it running after you disconnect |
| Hermes Agent | harness, channel and memory | an agent that accumulates: self-written memory, self-authored skills | philosophically opposed: Hermes bets an agent should edit its own instructions; Interlock bets a decision with a correct answer belongs in a tested CLI | continuity and isolation, including hibernating cloud sandboxes |
| DeepSeek Harness | harness only | everything is a plugin: adapter, tools, session log and the loop itself | a harness is what Interlock runs on, not what it is. Moving Interlock onto it would be a port, not an upgrade | the architecture and its documentation: an event-sourced session log with the LLM history derived from it |
| A folder of prompts | process, unenforced | zero install cost; works everywhere | every guarantee on this page is absent | you already have it and it costs nothing. For a small repo with a careful operator this is fine |
| Plain Claude Code with CLAUDE.md | harness and always-on instructions | the baseline everyone runs | CLAUDE.md is read every turn and followed; Interlock's caps are called. Interlock adds the checkpoint, wave isolation, the gates, the trajectory and the drift measure | simplicity and always-on context. Interlock does not replace it |

Closing line: The price is portability, and it is not hidden. Spec Kit runs on thirty agents and Interlock runs on one, because the guarantees come from Claude Code's workflow runtime. A portable version of this would be a folder of prompts, which is the thing it exists not to be. The host-specific part turned out to be small, so it is a stated contract with four adapters behind it. Portability here means a second host adapter, not thirty prompt templates.

## F.2 Objections and answers (accordion)

Each answer ends with the honest limit.

**"This locks us into Claude Code."**
Correct, in 0.x, for the supported path, and the README says so in bold before it says anything else. The zero-touch contract, the PATH injection, the subagent fan-out and the guards all come from Claude Code. What is not locked in is everything the loop decides: the run program emits steps, and a host is one file that declares what it cannot do. Four exist. The CLIs install standalone from npm with no plugin at all.
*Limit:* `/interlock:ship` runs on the workflow runtime or halts. The runner is experimental, no slash command starts it, and on Codex and Qwen the guards do not exist.

**"We already have a CLAUDE.md."**
A CLAUDE.md is instructions the model reads and follows, and following is a decision. Take the situation where the rule has to hold: forty minutes in, two rounds have not fixed it, and it is close. Ask the model whether it has earned a third round. It will say yes, articulately. The real cap is a number in a file read by a script that has no opinion.
*Limit:* CLAUDE.md is portable, always on, and costs nothing. Interlock does not replace it.

**"Parallel agents will cost us a fortune."**
Context tiering gives tier-1 tasks the task description and nothing else. The model clamp stops classifiers escalating to opus. Retrieval is token-budgeted. Workers are named plugin agents with tool allowlists that exclude the schemas they would otherwise inherit per spawn. Cohesion lanes fold sixteen small tasks into one agent reading the design once. Default ship does not pay for review at all.
*Limit:* `--strict` is expensive. One environment variable, `CLAUDE_CODE_SUBAGENT_MODEL`, defeats the entire ladder, and Interlock banners it rather than hiding it. The prompt-cache lifetime is a setting Interlock cannot set.

**"Our repo is Go, Rust or Java. The graph won't index it."**
Structural indexing covers JavaScript/TypeScript, Python and shell. Everything else gets docs and spec indexing, spec-to-file links, prose retrieval, and the complete workflow. Nothing in the loop requires the graph; agents fall back to grep, and the run says `GRAPH UNAVAILABLE` rather than pretending. Bootstrap phrases its explorers in your stack's vocabulary; verification runs whatever your profile names.
*Limit:* you lose the structural half of the invariant sweep, the one gate that catches a value canonicalised in one place and still read raw in three others. The grep half still runs.

**"Another spec format."**
Interlock writes nothing Interlock-shaped. It drives the `openspec` CLI directly. The artifacts are plain markdown readable by any OpenSpec tool or a human with an editor. A change proposed by the stock skill can be shipped by Interlock; ship does not care who wrote the markdown.
*Limit:* one file is an Interlock addition, the decision ledger. It is plain markdown, committed with the change.

**"Autonomy is scary."**
Then do not skip the read, and the default is that you don't. One flag removes you, it is opt-in permanently, spec never suggests it, and `--force-checkpoint` beats it unconditionally. Its gate fails closed without exception: a check that could not run is a blocker, not a pass. Risk never averages; a docs change bundled with a payment change is a payment change, and high or critical risk may not continue at all.
*Limit:* the documentation argues against its own feature: continuity cannot catch a wrong idea. Only a person reading the proposal catches that.

**"What if it commits garbage?"**
Six things stand between a wave and a commit, each an exit code. Validation refuses an unimplementable change. Inter-wave verify halts the next wave on a red typecheck or suite. Final verify halts on a red suite and repairs by root cause, bounded. The shrink check catches a suite that went green by getting smaller. More than the tolerated task failures halts. A hook denies `git commit` outside the commit stage, and the commit is one feature-level commit that never adds everything, never amends, never pushes.
*Limit:* e2e failure is reported and never repaired, and the commit happens anyway with a banner. You have to look at that one. And lean ship never reviews the diff; it trusts your unit suite.

**"How do I know what it did?"**
The summary names every default applied and carries the run id. The receipt records the host, the billing path, the spend, the paths touched and the paths predicted. The trajectory is one line per action and can be queried. The report renders indicators with their denominators as an offline HTML file.
*Limit:* the report gates nothing and is barred from ever doing so. Under roughly twenty observations it tells you to say "too few to read".

**"Reviews are noise."**
That is the diagnosis. Every blocker and warning is attacked by two skeptics before you see it, a dismissal must cite a line in the diff, the report prints how many were dismissed and how many refutations were refused, and a quality band drops what is too vague to act on. You can own the scope with a `REVIEW.md`.
*Limit:* opt-in and priced accordingly. Diff review is structurally blind to a value read in more than one place, which is why the invariant sweep exists as the one licensed exception to the diff leash.

**"Does this work on our monorepo?"**
`bootstrap --scope` restricts onboarding to a subdirectory. The planner schedules from `tasks.md` and predicted paths, not a directory layout. `REVIEW.md` at the root declares out-of-scope paths. Verification runs the commands your profile names.
*Limit:* no monorepo-specific feature exists: no per-package specs, no package-scoped run state. Two teams shipping concurrently in one repo both append to one outcomes file, which is a merge-conflict site. This is the weakest answer on the page.

**"We don't have dynamic workflows enabled."**
Then there is no ship, and the trampoline halts rather than implementing the loop in conversation. Claude Code v2.1.154 or newer with workflows enabled; on a Pro plan, enable it in `/config`. Everything else still works: spec, both reviews, commit, mr, the graph, the full CLI.
*Limit:* the runner is experimental, weaker on zero-touch, and on the Claude binary it is a metered billing path.

**"Show me the benchmark."**
There isn't one. The unit suite proves the policy engine behaves as specified. It does not prove the workflow produces better outcomes than a simpler loop. That comparison has not been run, and until it has, everything on this page is an argument from mechanism rather than from measurement. The outcome corpus exists to close that gap and currently has no control group.

## F.3 For and not for

**For**
- Teams already on Claude Code v2.1.154 or newer with dynamic workflows enabled, who have watched an agent do something confident and wrong.
- Teams who want one place a human is required to look, and no places a human is required to babysit.
- Repos where being wrong is expensive: auth, money, migrations, tenancy, public API surface.
- Engineers who will read a spec for ten minutes to buy an uninterrupted implementation run.
- JavaScript/TypeScript, Python and shell repos, which get the full structural graph. Everything else gets the full workflow minus import and symbol edges.
- Teams who want the audit trail in git: the trajectory, the outcome record and the review metrics as the record of how the code got written.
- People who want the CLIs alone: `interlock` gating a CI job, `interlock-graph` indexing a repo for whatever agent they run.

**Not for**
- Cursor, Copilot, or any non-Claude-Code host as the primary path. Not supported in 0.x.
- Teams who want an IDE. Kiro exists.
- Teams who want portability across thirty agents. Spec Kit exists.
- Anyone who wants a self-improving agent. Interlock's answer to "the agent learned something" is a proposal a human applies.
- Anyone who wants configurable gates. The remediation round cap is not pluggable, on purpose. A cap you can mount a plugin over is not a cap.
- A one-line change with an obvious implementation. Propose it with the stock skill and do it yourself.
- Teams who need a published benchmark before adopting anything.

## F.4 Stated limits (plain list)

- Claude Code only in 0.x. The supported path requires v2.1.154 or newer with dynamic workflows enabled.
- Adversarial review, handoff artifacts and conformance are opt-in (`--strict`), not the default.
- Structural graph indexing covers JavaScript/TypeScript, Python and shell.
- The experimental runner over `claude -p` is a metered billing path; the interactive Workflow runtime is not.
- On Codex and Qwen hosts the guard hooks do not exist; only the shrink check stands between a repair and a weakened test.
- E2E failures are reported and never repaired; the commit proceeds with a banner.
- Drift and conformance never block.
- The corpora are recorded and nothing reads them to change a run.
- No monorepo-specific features.
- No published benchmark. Version 0.3.0.

---

# APPENDIX G — Numbers at v0.3.0

## G.1 `interlock limits`, verbatim

Render this block as the searchable caps table with the fixed caption "read from `interlock limits` at v0.3.0".

```
  max parallel agents per batch                   8
  inter-wave fix attempts (per wave)              2
  replans (per run)                               2
  remediation rounds                              2
  root-cause iterations (per run)                 5
  task failures tolerated                         2
  run steps (per run)                             200
  inter-wave verify budget                        60s
  inter-wave verifications (per run)              3
  verify spill threshold (bytes)                  8192
  verify preview budget (chars)                   4096
  wave handoff budget (chars, per task)           2000
  review policy scan cap (bytes)                  65536
  push timeout (ms)                               5000

  lane cap: tier 1 lane (also untiered)           8
  lane cap: tier 2 lane                           8
  lane cap: tier 3 lane                           6
  lane cap: tier 4 lane                           4
  lane cap: tier 5 lane                           8
  cohesion tier ceiling (packs at or below)       3
  solo envelope (max tasks in one lane)           20

  eval smoke cost ceiling (per PR)                $2
  eval full-run cost ceiling (scheduled)          $15
  eval outcome-run cost ceiling (scheduled)       $20
  eval runs per case                              3
  eval promotion: consecutive qualifying runs     3
  eval promotion: trials per qualifying run       3
  eval promotion: judge agreement floor           80%

  price table id                                  anthropic-list-2026-09b
  price: claude-haiku-4-5 ($/Mtok)                in 1, out 5
  price: claude-opus-5 ($/Mtok)                   in 15, out 75
  price: claude-sonnet-5 ($/Mtok)                 in 3, out 15
  cache write multiplier: ephemeral_1h (x input)  2
  cache write multiplier: ephemeral_5m (x input)  1.25
  cache read multiplier (x input)                 0.1

  report trajectory scan cap                      2000

  effort: tier 1 lane                             low
  effort: tier 2 lane                             low
  effort: tier 3 lane                             inherit (session default)
  effort: tier 4 lane                             inherit (session default)
  effort: tier 5 lane                             xhigh
  effort: inter-wave verify step                  xhigh
  effort: review skeptic step                     xhigh

runtime ceilings: 16 concurrent, 1000 agents per run
```

## G.2 Repository figures

| Figure | Value | How established |
|---|---|---|
| Version | 0.3.0 | `package.json`, `plugin.json` and `marketplace.json`, held in lockstep by a test |
| Runtime dependencies | 0 | `package.json` has no `dependencies` and no `devDependencies` key; CI installs nothing |
| Node floor | 18 or newer for Interlock; the OpenSpec CLI needs 20.19.0 or newer | `package.json` engines; OpenSpec's own requirement |
| Test files | 63 | `find test -name '*.test.mjs'` |
| Tests | roughly 2,500 | `npm test`; do not print an exact passing count |
| Top-level `interlock` subcommands | 28 | the dispatch in `bin/interlock` |
| Decisions moved out of prose | 17 | the README's decision table; this is the number to print |
| `interlock-graph` subcommands | 11 | `build, update, report, query, consumers, path, explain, docs, context, docs-index, which` |
| Modules under `lib/` | 67 | 36 top-level, 19 graph, 12 prompts, 6 host |
| Skills | 16 | four are the product; the rest are called by them |
| Hooks | 4 | one advisory session-start preflight, three deny guards |
| Host adapters | 4 | `claude`, `acp`, `codex`, `qwen` |
| Eval cases | 11 | pinned by name in a test |
| Docs pages | 13 | numbered 01 to 14, with no 07 |
| Changes shipped through its own loop | 35 | `openspec/changes/archive/`, dated 22 Aug to 7 Sep 2026 |
| Commits | 48 | since the first commit on 12 Aug 2026 |
| Licence | MIT | |

## G.3 Requirements

| Requirement | Why |
|---|---|
| Claude Code v2.1.154 or newer | `/interlock:ship` launches a dynamic workflow. Known-good on 2.1.229. |
| Dynamic workflows enabled | Off via `disableWorkflows`, org policy, or `CLAUDE_CODE_DISABLE_WORKFLOWS` means no ship. On Pro, enable it in `/config`. |
| `CLAUDE_CODE_SUBAGENT_MODEL` unset | If set, it overrides every per-tier model, and ship banners it. |
| The `openspec` CLI | Interlock drives it; it does not replace it. |
| Node.js 18 or newer | For the three bundled CLIs. |

## G.4 The docs, for the footer

| Doc | Title |
|---|---|
| 01 | The first hour |
| 02 | The checkpoint |
| 03 | OpenSpec vs Interlock |
| 04 | When it stops |
| 05 | Continuity |
| 06 | Why it works |
| 08 | The harness landscape |
| 09 | From prompt to workflow |
| 10 | Ship and spec for prompt-only engineers |
| 11 | The indicators |
| 12 | Repository review policy |
| 13 | The guards |
| 14 | Evals and the consumer posture |

Link each to `https://github.com/renzrollon/interlock/blob/main/docs/<file>` where the file is the number, a dash, and the kebab-case title (for example `docs/02-the-checkpoint.md`, `docs/09-from-prompt-to-workflow.md`, `docs/10-agentic-workflow-ship-and-spec.md`, `docs/12-repository-review-policy.md`, `docs/14-evals.md`). If unsure of a filename, link to the docs folder instead.

## G.5 The seventeen decisions (the README table)

| Command | Decides |
|---|---|
| `interlock waves` | Wave order, per-task model, a hard cap on parallel agents, and whether two tasks in one wave would edit the same file |
| `interlock surface` | Whether a diff touches UI, and therefore needs a manual test plan |
| `interlock gate` | Whether a review blocks, which findings are too weak to report, and how the rest partition for parallel fixers |
| `interlock review` | Which findings survive two skeptics, and how many were dismissed versus dropped as too weak |
| `interlock remediate` | What gets fixed, what gets deferred, and when the round budget is spent |
| `interlock verify` | What to run, what a red result means, and which failures share a root cause |
| `interlock wave-state` | What happens next in the wave loop, and when to stop |
| `interlock risk` | How dangerous a change is, from its paths and artifacts |
| `interlock drift` | Which completed changes were never archived, which specs cite files that are gone, and which changed files no spec describes |
| `interlock conformance` | Which spec scenarios a change must be checked against: the questions, never the verdicts |
| `interlock ready` | Whether a change may skip the human checkpoint, fail-closed |
| `interlock ledger` | Whether the decision ledger still holds an unanswered product question |
| `interlock validate` | Whether a change is actually implementable |
| `interlock tasks` | Whether the wave plan covers every unchecked box, and which ids may be ticked |
| `interlock run-log` | Whether a finished run's trajectory can actually be replayed |
| `interlock run` | The whole ship loop, as steps: every briefing and every branch a driver obeys next |
| `interlock limits` | Every cap the loop obeys, so nothing restates one |

Every one runs without a model and without the network, with one exception: `interlock notify` opens a connection, and only when `INTERLOCK_NTFY_TOPIC` is set.

## G.6 Links

- Repository: `https://github.com/renzrollon/interlock`
- npm: `https://www.npmjs.com/package/@renzrollon/interlock`
- OpenSpec: `https://github.com/Fission-AI/OpenSpec`
- Claude Code workflows: `https://code.claude.com/docs/en/workflows`
- Refute-or-Promote: `https://arxiv.org/pdf/2604.19049`
- False consensus in multi-agent review: `https://arxiv.org/abs/2608.18167`
- Context rot: `https://www.trychroma.com/research/context-rot`

---

# APPENDIX H — Quotable lines

All verbatim from the repository. Use them as headlines, pull quotes and captions in preference to new phrasing.

1. "The gap between `spec` and `ship` is the product." (README)
2. "A skill is control flow the model can talk itself out of; a workflow is control flow it cannot." (docs/09)
3. "The script holds the loop, the CLI holds the rules, the agents do the work." (docs/09, README)
4. "A speed limit painted on the road and a governor fitted in the engine are both 'the rule'. Only one of them still holds when the driver is late." (docs/09)
5. "A wrong idea costs a paragraph here and a day after shipping." (docs/01)
6. "That is not a fix; it is the bug plus a lie." (skills/fix-tests, on a suite that goes green by shrinking)
7. "A green suite that runs fewer tests than it did before is a regression wearing a green badge." (skills/fix-tests)
8. "An unverified review reports everything it notices, so the reader learns to skim it. A review where every blocker survived two skeptics is a review worth reading line by line." (skills/review-code)
9. "A decision that exists only in chat does not exist." (shared/DECISION-LEDGER)
10. "A gate everyone disables protects nothing." (docs/03)
11. "This is archaeology, not design. Every spec you write describes behavior that exists in the code today." (skills/bootstrap)
12. "One call site fixed and its siblings left reading the raw value is the same bug surviving its own fix." (docs/02)
13. "Instead of walking every room yourself with one clipboard, you hire one contractor per room." (docs/09)
14. "Degradation is spoken, never silent." (CLAUDE.md)
15. "`ship` asks nothing not because it was instructed to be autonomous, but because the workflow runtime has no channel for mid-run input at all. There is nobody listening." (docs/09)
16. "A wrongly dismissed finding is invisible, and nobody can catch a mistake they never see." (docs/06)
17. "Confident prose is the single thing an LLM produces most reliably, so it is the one thing a dismissal must not rest on." (README)
18. "Reading a corpus and branching on it are different acts, and only the first has been built." (README)
19. "A corpus nobody can read is a corpus nobody notices is empty." (docs/11)
20. "A prose instruction nobody asserts silently stops running." (CLAUDE.md)
21. "A cap you can mount a plugin over is not a cap." (docs/06)
22. "Continuity cannot catch a wrong idea. Every check it runs asks whether the change is implementable. None of them asks whether it is right." (docs/05)
23. "If you find yourself passing `--continue` by habit, that is the signal to stop passing it." (docs/05)
24. "A portable version of this would be a folder of prompts, which is the thing it exists not to be." (README)
25. "Cost is not the point. Degradation is. But the two are the same lever." (docs/06)
26. "Every gate fails closed. Every degradation is spoken. Every claim an agent makes about its own work is audited against evidence." (docs/06)
27. "Interlock composes OpenSpec. It doesn't replace it." (README)
28. "Two failed rounds usually means the design was wrong, not the code." (docs/04)

Taglines for section headers, in the repository's register:
- How many decisions the model is not allowed to make.
- One human checkpoint. Everything else is a script.
- A cap written in prose is a suggestion.
- Nobody is listening.
- A dismissal needs a citation. A report doesn't.
- Silence is the failure mode.
- Read the spec. That's the whole ask.
- We record the corpus. We don't read it yet.

END PROMPT
