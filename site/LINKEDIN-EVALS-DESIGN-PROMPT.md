# Claude Design prompt: Interlock evals — LinkedIn square

**How to use this file.** Open Claude Design (claude.ai/design). New project. Paste everything from `BEGIN PROMPT` to the end. Ask for **square artboards at 1080×1080**, exported as **PNG** (and JPEG, quality 90, if the tool offers both). Not a landing page. Not HTML. Not a carousel of screenshots of a dashboard.

Every fact is pinned to Interlock **v1.0.2**. If a claim is not in the appendices, do not draw it.

Suggested post: a **3-card carousel** (artboards 1–3) or artboard 1 alone. Caption copy is Appendix C — do not put the caption on the image.

---

BEGIN PROMPT

## 0. What to build

Three **square social cards**, 1080×1080 CSS pixels, 1:1, for a LinkedIn post aimed at staff and principal engineers who ship coding-agent harnesses. Export each as PNG (sRGB). Also a JPEG of each at quality 90, same pixels, for LinkedIn's compressor.

This is a **thumb-stop**, then a claim, then enough structure that an engineer believes you did the work. It is not a product screenshot, not a dashboard, not a "we ran evals" collage, not an illustrated robot.

Deliver:

1. **Artboard 1 — the punch.** One sentence. The post image if they only post one.
2. **Artboard 2 — the spine.** Three surfaces: transcript, outcome, process.
3. **Artboard 3 — the rule that makes it believable.** The eval observes. It never gates.

Optional fourth, only if 1–3 are done: a dark-ground twin of artboard 1, same type, same claim. If the dark twin is weaker, drop it and say so.

## 1. Who is reading, in a feed, on a phone

They scroll LinkedIn between CI failures. They have been sold "agent evals" that are LLM-as-judge on a chat log, a SWE-bench number with no harness named, or a unit suite labelled as evals. They will bounce at the first banned word. They will stay for a sentence they could argue in a design review.

They need to believe, in this order:

1. **`npm test` is not an agent eval.** A green policy engine does not mean the loop still ships.
2. **Most of the category grades the transcript.** Interlock also grades the disk after a real ship, and the JSONL the loop wrote.
3. **That split is implemented**, not a wishlist: eleven observed-failure cases, three outcome fixtures with a control arm, a process walker over run-log events, triage that reads the harness file, prepare-only in ordinary CI.
4. **Scores are not the product.** The eval never feeds a gate. A figure that starts deciding the run is a different change.

If the card could be posted by a vendor who only has chat-trace scoring, it has failed.

## 2. Voice

Same register as the Interlock landing site. Dry, precise, slightly contrarian. Headlines are **claims**, not labels. Short declaratives. No exclamation marks. No emoji. No hashtags on the artboard.

Banned: revolutionary, seamless, supercharge, unleash, effortless, magical, AI-powered, 10x, game-changing, next-generation, cutting-edge, simply, just, easily, powerful, robust, leverage, unlock, empower, delight, "SOTA", "beating GPT", "human-level", any pass-rate, any dollar figure, any invented customer.

Do not quote Anthropic, LangChain, SWE-bench, Harbor, or AgentEvals on the image. Those informed the design; name-dropping them on a square looks like a roundup post. The caption may cite them. The card may not.

## 3. Brand

**Colour tokens** (light cards; invert ink/paper for the optional dark twin; accent stays vermilion):

| Token | Hex | Role |
|---|---|---|
| paper | `#F5F3EE` | ground |
| ink | `#161512` | headline, rules |
| muted | `#6B675F` | captions, eyebrows |
| hairline | `#161512` | section rules — **2px minimum** on this format (1px vanishes on mobile) |
| accent | `#C8451B` | one block or one word per card, never decoration |
| accent-ink | `#FFFFFF` | text on accent |
| code | `#ECE9E1` | mono wells |

**Type.** Heavy grotesk for the headline: Inter Tight 800 or Space Grotesk 700. JetBrains Mono or IBM Plex Mono for eyebrows, commands, the three surface names. System fallbacks required.

Headline: as large as the square will take. Line-height 0.92–0.98. Tracking tight. It must remain the dominant object when the PNG is scaled to **400px**. If a secondary line dies at 400px, delete the secondary line.

**Layout language.** Swiss datasheet, not a card-with-shadow. Square corners. No gradients, no glass, no stock illustration, no 3D, no charts, no gauges, no traffic-light colours, no trend arrows, no avatars, no Claude/Anthropic/OpenAI marks.

**Wordmark.** `INTERLOCK` in wide-tracked mono, accent, small, one corner — usually top-left or bottom-left. Eyebrow may read `EVALS · v1.0.2`. No logo mark exists; do not invent one. Do not draw a padlock.

**Safe area.** 72px inset on all sides (content inside 936×936). LinkedIn crops previews; nothing load-bearing in the outer 6%.

## 4. LinkedIn physics (non-negotiable)

- 1080×1080. Not 4:5, not 16:9, not a story.
- Designed to be **read at thumbnail size first**. Squint test: the headline is still a sentence.
- High contrast. Paper/ink. Accent used once.
- No body paragraph on artboard 1. Three short rows max on artboard 2. One sentence plus one mono line on artboard 3.
- Do not put a URL, QR code, or "link in comments" on the image.
- Do not fake a terminal screenshot with unreadably small JSON. If you show a command, it is 3–6 tokens at display size, e.g. `interlock evals triage` or `node evals/ship/run.mjs --prepare-only`.

## 5. The three artboards

Use the copy **verbatim**. Do not paraphrase a headline. You may drop a supporting line if it fails the 400px squint test; you may not rewrite it.

### Artboard 1 — punch (single-image default)

Eyebrow, top, mono, muted: `EVALS · v1.0.2`

Headline, ink, occupying most of the square:

**npm test is not an agent eval.**

One supporting line, muted, under the headline, only if it survives 400px:

A green policy engine does not mean the loop still ships.

Bottom bar, full width, **accent-filled**, accent-ink, mono:

The script holds the loop / the CLI holds the rules

Wordmark `INTERLOCK` sits with the eyebrow, not in the accent bar.

Do not add the three surface names here. That is artboard 2. Greed kills the punch.

### Artboard 2 — spine

Eyebrow: `THREE SURFACES · NOT THREE NAMES FOR ONE SCORE`

Headline, smaller than artboard 1 but still a claim:

**Grade the ship, not the chat.**

Then three rows, hairline-separated, each a pair:

| Mono label | Grotesk line |
|---|---|
| `TRANSCRIPT` | 11 cases. Observed failures only. Cheapest grader that can say it. |
| `OUTCOME` | Disk after a real ship. Ticks, suite, commit, receipt. Loop vs control. |
| `PROCESS` | The run-log JSONL. Required events. Known actions. Halt if unit was red. |

The three labels are the scan path. They may be accent; the lines stay ink. No icons. No checkmarks. No fake scores in the right column.

Footer mono, muted: `stdlib Node · zero runtime deps · prepare-only in CI`

### Artboard 3 — the rule

Paper ground. One heavy headline:

**The eval observes. It never gates.**

Under it, three stacked facts, muted, short:

A figure that starts the next wave is a different product.

Triage reads the harness file. Promotion stays advisory until history exists.

`--prepare-only` is what ordinary CI runs. The metered sweep is not a merge check.

Bottom, one mono command well on code ground:

`interlock evals triage`

Do not draw a green pass. Do not draw a red fail. The point of this card is that the suite refuses to become a health signal.

## 6. What you must not put on any card

- A pass rate, a cost in USD, a token count, a "35×" or any other multiplier.
- "We ran Harbor / AgentEvals / Braintrust / LangSmith."
- "SWE-bench" as a score Interlock has. The outcome fixtures are that *shape*; they are not a public leaderboard number.
- "Human baseline", "calibrated judge", or a claim that judged graders are in force. They are deferred until labelled transcripts exist.
- A statement that history is populated or that evals are blocking in CI. History is empty by decision; promote reports insufficient history; that is correct, not a bug to hide, and also **not a headline**.
- Cursor, Copilot, or "works in any IDE".
- A screenshot of `interlock report`. That page is forbidden from issuing a verdict; using it as social proof would invert the product.

## 7. Composition notes (do, then stop)

Artboard 1 is type on paper. The accent bar is the only colour event. If you feel the urge to add a diagram, you are designing artboard 2.

Artboard 2 may use a three-row **ladder**, left labels aligned, like a datasheet. It may not become a funnel, a flywheel, or a hexagon cluster.

Artboard 3 should feel like a constraint the team is proud of, not a disclaimer. Weight the headline. Keep the facts quiet.

Light cards on LinkedIn's blue-white feed. That is the default. Dark twin of artboard 1 only.

## 8. Honesty

Interlock v1.0.2 actually has these things (Appendix A). The cards sell **that architecture** and **why it matters**. They do not sell a number the suite has not earned.

If you cannot fit a line without lying or puffing, cut the line.

## 9. Deliverable checklist

- [ ] Three 1080×1080 artboards, PNG, sRGB, plus JPEG q90 of each.
- [ ] Artboard 1 headline is still a sentence at 400px width.
- [ ] Verbatim headlines from §5.
- [ ] Wordmark `INTERLOCK` present; no invented mark.
- [ ] Accent used at most once per card.
- [ ] No banned words, no scores, no vendor-eval name-drops, no gauges.
- [ ] Safe 72px inset. No URL. No QR.
- [ ] Optional dark twin of artboard 1, or an explicit skip.

---

# APPENDIX A — Facts you may use (v1.0.2)

Use these as the ceiling, not a menu to dump onto a square.

**Product.** Interlock is an open-source Claude Code plugin for autonomous spec-driven development, layered on OpenSpec. npm `@renzrollon/interlock`. Zero runtime dependencies; stdlib Node ≥ 18.

**The research, compressed to what changed the design** (do not cite on-image):

- Prefer **code graders**. LLM graders need human calibration before they can promote.
- Grade **outcomes** when path-matching the transcript is brittle.
- Start from **real failures**, not hypothetical coverage.
- **pass^k**, not pass@k, is the promotion rule already in `interlock evals promote`.
- Strict tool-order match punishes valid alternatives. Interlock matches **loop event types** (a contract) and treats **implementer tool order** as not a criterion.
- LangChain AgentEvals scores chat-style tool-call lists. That is the wrong object for this harness. A stdlib walker over `.claude/ship/runs/*.jsonl` is the right one. No new dependency.
- Scores are **model × harness**. The outcome eval drives ACP, labels the apparatus agent on every row, and refuses to pretend ACP is Claude Code Workflow.
- Industry pattern this exists to catch: harness releases, model held constant, functional tests green, resolve rate flat, spend up. Interlock's unit suite would have been that functional-test layer. That is why it is not enough.

**What is implemented**

| Layer | What it is |
|---|---|
| Unit tests / skill-token pins / in-run CLI gates | Not agent evals. Policy, instruction *bytes*, one live run. |
| Transcript suite `evals/` | **11** cases, names: `cited-cap-resolution`, `control-plane-action`, `evidence-locator`, `handoff-status-enum`, `lane-partial-failure`, `skill-routing`, `skill-routing-explore`, `tier-read-scope`, `tier-read-scope-full`, `trampoline-halt`, `trampoline-launch`. Provenance required: no observed failure → no case. Twins where a one-sided test would reward the wrong behaviour. |
| Outcome eval `evals/ship/` | Three fixtures (`dependent-export`, `docs-and-code`, `red-until-task`). Loop arm vs sequential control. Control gets no verdict on the difference. Grades disk with existing CLI exits: ticks, commit, `verify unit`, weakened-suite, `run-log check`, observed receipt. |
| Process grader | `evals/ship/trajectory.mjs` on the **loop arm only**. Required event types, no unknown `action`, halt when the CLI already recorded unit red. Presence, not order. Control arm: not-applicable, never fail-for-missing-loop. |
| Triage | `interlock evals triage` is model-free. Dual-reads harness `schemaVersion` 1 (`name` / `arms.with`) and the legacy unit-test shape (`id` / `runs`). Exit 0/1/2/3 = pass / regression / no_signal / configuration. The 2026-09-04 smoke fixture is pinned as a **regression** (`tier-read-scope`). |
| CI | Ordinary CI runs `node evals/ship/run.mjs --prepare-only`: no credential, no spend, no history row. Metered outcome sweep is schedule / `workflow_dispatch` only, never a pull-request merge check. |
| Capture / promote | `interlock evals capture` writes a skeleton with `CONFIRM` markers, never into `evals/`. Promote reads `evals/history/`. That directory is empty; advisory is the correct posture. |

**Spoken limits (do not contradict):**

- Outcome eval is ACP-only; Workflow cannot be driven headlessly.
- Judged graders are deferred pending calibration transcripts.
- No spec-path / review-code cases until an observed miss is captured.
- Nothing the eval records feeds `ready`, `gate`, or the ship loop.

# APPENDIX B — Headlines, locked

Artboard 1: **npm test is not an agent eval.**
Artboard 2: **Grade the ship, not the chat.**
Artboard 3: **The eval observes. It never gates.**

Do not substitute "Stop grading transcripts" or "Evals that matter" or any cousin.

# APPENDIX C — LinkedIn caption (not on the image)

Post this with the carousel. Short enough to survive "see more".

---

Most agent evals grade the chat.

That is a reasonable thing to grade. It is also how a harness stays green while the product gets more expensive and no better.

We treated `npm test` as the policy engine — exit codes, fail-open guards, skill-token pins. Then we built the layer that actually answers "does the loop still ship?":

• Transcript — 11 cases, each from an observed failure, cheapest grader that can say it
• Outcome — real fixtures, loop vs a sequential control, grades disk with the same CLI the run already uses
• Process — walk the reconstructable JSONL, not the messages. Required events. Known actions. Halt if unit was red

Triage is a CLI, not a judge. Promotion stays advisory until there is history. Ordinary CI runs `--prepare-only` so a broken fixture fails the build without a model bill. The metered sweep is not a merge check.

The eval observes. It never gates. A figure that starts the next wave is a different product.

Interlock v1.0.2 · @renzrollon/interlock

---

Optional second comment (not the caption), if someone asks "vs AgentEvals / Harbor":

AgentEvals scores chat tool-call lists. Harbor is a task runner with an oracle. We already had the oracle (`reference/`) and a verifier (`evals/ship/graders.mjs`). Adding a framework would score the wrong object and break a zero-dependency install. The walker is ~stdlib over `interlock run-log` events.

END PROMPT
