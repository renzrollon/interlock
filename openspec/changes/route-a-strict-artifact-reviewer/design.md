# Design

## Context

See proposal.md for the motivation.

- `SPAWN_ROUTING` (`lib/limits.mjs:520`) holds five rows. `lib/routing.mjs` derives `ROUTING_ROLES` from the table's keys, so a new row needs no resolver change; `resolveRouting` applies a row's `strict` override at the strict depth and answers `depth` from `REVIEW_DEPTH.default` when `--depth` is absent. `formatLimits` prints one `routing:` row per table entry.
- Six places enumerate the roles: `test/spine/routing.test.mjs` (`ROLES`), `test/spine/cli.test.mjs:5038` (`ROUTING_ROLES`), `test/spine/limits.test.mjs:838-846` (the printed rows), `test/skills.test.mjs` (Rule 5's token list), the `ROUTING` fixture in `test/spine/settle-meter.test.mjs:111`, and the living `spawn-routing` spec, which says "five" in three requirements. `shared/TOOL-ECONOMY.md:174` lists the roles by skill.
- `skills/review-artifacts/SKILL.md` runs inline: its `allowed-tools` carries no `Agent`, and `test/skills.test.mjs` ("every skill that spawns subagents is allowed the Agent tool") requires `Agent` once the body says spawn. Its emit shape and gate line are pinned by `spec/machine-readable-gate-lines` and must not move.
- `review-code` and `settle` already select a depth with `--strict`, print `REVIEW DEPTH:`, and read the depth word from `interlock routing`; `review-depth` says the skills never name the default depth. The active change `prove-the-review-covered-the-diff` modifies `review/review-depth` and `hooks/settle-meter`; this change touches neither.
- `test/spine/spec-meter.test.mjs:719` requires every fenced `interlock` line in `skills/review-artifacts/SKILL.md` to be a kind the spec meter classifies or a line its `UNREAD_BY_NAME` list names.
- `bin/interlock` is 245,586 bytes against the plugin directory's 256 KiB file limit. Nothing here adds to it.

## Goals / Non-Goals

**Goals:**

- One flag, `--strict`, that buys an unanchored read of the artifacts, routed by role like every other prose spawn.
- The gate's contract unchanged at both depths: the same findings file, the same gate line, the same autonomy record.
- The strict reviewer bounded by its prompt: read, run read-only checks, write nothing, answer JSON.

**Non-Goals:**

- A CLI-assembled artifact brief (`interlock review brief --artifacts`). `prove-the-review-covered-the-diff` builds the brief verb for code review; moving the artifact brief into it is a change after that one lands (D7).
- A cap on reported warnings at the lean depth, and any change to what counts as a blocker (the 2026-10-29 prose already says it).
- A second strict reviewer, skeptics for artifact findings, or a loop: one gate per spec run holds at both depths.
- A spec-meter kind for the routing line (D5).

## Decisions

**D1. The `artifact-reviewer` row is `{ model: null, effort: null }`.** The strict read runs on the session's own model and effort, as `review-dimension`'s strict override hands the reviewers back to the session (`lib/limits.mjs:522`). The gates of 2026-10-29 ran at session defaults and the second found the real defects; nothing argues for a cheaper model on the read that exists to be careful, and a row that inherits both is still a row: the site routes, the owner tunes it in one place, and `interlock limits` prints it as `inherit`. Alternative rejected: `EFFORT.skeptic` by reference, which is the effort of agents that refute a finding by running its check, not of a whole-change read. The row carries no `strict` override: the role is only spawned at the strict depth.

**D2. Strict replaces the inline read; it does not add to it.** Two reads of the same artifacts would produce two findings lists for one gate, and merging them is the model-owned merge `prove-the-review-covered-the-diff` D22 refused for code review. The strict reviewer's findings are the gate's input; the session reads nothing itself except the reply. If the reply is unreadable (no JSON object with a `findings` array), the skill says `STRICT REVIEW UNREAD: <first line>` and performs the lean read in the same run, so the gate still runs once and a findings file exists for continuity.

**D3. The reviewer returns JSON; the session writes the file and runs the gate.** The spec meter sees the session's Bash and Write calls, not a subagent's, so a file the reviewer wrote would be invisible to the pane and to anything that reads the writes. Keeping the Write in the session also keeps the file name, the `--metrics <change>` gate line and the `autonomyOutcome.blockers` hand-off exactly as `spec/machine-readable-gate-lines` pins them. The file is written as returned: a malformed finding is the gate's to name under `malformed`, never the skill's to repair.

**D4. One routing call at both depths, and the depth word comes from it.** `review-depth` forbids a skill naming the default depth, so the lean path cannot say "lean" on its own. `interlock routing artifact-reviewer --json` answers `depth` at no cost; the skill prints `GATE DEPTH: <depth>` from it and spawns only when the depth is `strict`. Under `--strict` the call carries `--depth strict`. On a non-zero exit the skill prints `ROUTING UNAVAILABLE: <first line>`, takes the depth from its own flag (strict when `--strict`, otherwise the inline read), and continues: routing never stops a skill.

**D5. The spec meter does not key the routing line.** The settle meter reads routing lines to draw each role's model in its pane; the spec pane counts spawns and shows writes, which is what a strict gate changes. Keying the line would be a `hooks/spec-meter` MODIFIED block beside the one `measure-change-width-before-the-gate` writes. The fenced `interlock routing artifact-reviewer --json` line joins `UNREAD_BY_NAME` in `test/spine/spec-meter.test.mjs` with its reason, as `openspec --version` does; the pane counts the Agent call under spawns and the findings file under writes.

**D6. `/interlock:spec --strict` passes the flag to its gate line.** Spec is the chain that runs the gate, and the person who wants the careful read asks the chain, as `settle --strict` reaches every `review-code` pass. The flag-table row and the argument hint carry it; `continuity.md` is unchanged, because it reads the findings file, which both depths write the same way.

**D7. The strict brief is the skill's own sections, verbatim.** Reviewer 1, Reviewer 2 and the Invariant check are the rubric the lean read applies; the strict reviewer applies the same one, so the two depths differ in who reads, not in what is asked. The skill's depth section says "verbatim" and names the three sections, the artifact paths, the stack note and the emit shape, and the suite pins those tokens. Moving the brief into the CLI (`interlock review brief --artifacts <change>`) is deferred to after `prove-the-review-covered-the-diff` lands its `review brief` verb.

**D8. The skill's `allowed-tools` grows by `Agent` only.** A skill's `allowed-tools` pre-approves the session, not a spawned agent, so the reviewer's bound is its prompt: write no file, run read-only checks. No `Write` is added for the session either: it already writes the findings file today, so whatever approved that write approves this one.

## Risks / Trade-offs

- [A strict read on the session's model costs a full artifact read per gate] → it runs only when asked, once per spec run, and the lean read stays the default.
- [The reviewer ignores "write nothing"] → the prompt is the only bound available for a spawned agent; the skill writes the findings file itself and runs the gate from that file, so a stray write by the reviewer changes no verdict.
- [Two active changes touch the role table's neighbours] → this change modifies `spawn-routing` only; `prove-the-review-covered-the-diff` does not, and the `hooks/spec-meter` block is left to `measure-change-width-before-the-gate`.
- [The six enumerations drift] → the routing test derives from `ROUTING_ROLES`; each literal list is updated in the task that adds the row and the test fails by name if one is missed.
