# Proposal

## Why

A ship run's spend follows the session's effort without anyone having chosen that. Implementer lanes produced 3,717,353 of the 4,071,180 output tokens across the 28 recorded runs, and the tier 3 and tier 4 lanes among them inherit whatever effort the session was left at; the comment that justifies the inheritance assumes a session default that predates Anthropic's current guidance. Every verify attempt, every skeptic, every remediation and the settle fixer run at `xhigh`, which the model-selection guide prices at about 2.5 times the cost of `high` for about 1.4 points. And no trajectory row records the effort a spawn was given, so none of this can be judged from the repository's own data.

This is Brief 2 of an epic. Brief 1, `suggest-a-session-model-per-skill`, tells the person which session model and effort suits each skill. Brief 3, routing the bootstrap skill's spawns, is named in `design.md` and not specified here.

## What Changes

- **Tier 3 and tier 4 lanes stop inheriting.** The published tier table gives tier 3 `medium` and tier 4 `high`. Tiers 1 and 2 stay at `low`. An untiered lane still inherits, as the fallback it always was.
- **Tier 5 lanes, the skeptics, remediation and the settle fixer move from `xhigh` to `high`.** The skeptic effort stays one constant the routing table holds by reference, so the three follow one edit.
- **Verify becomes a two-step ladder.** A check's first attempt, inter-wave or final, runs at the verify effort, now `high`. An inter-wave fix attempt runs at a new published retry effort, `xhigh`. Today every attempt runs at `xhigh`.
- **`interlock limits` prints the retry effort** in its own row, and `--json` carries it.
- **Every `agent-spawn` row records the effort the spawn was given**, or `inherit` when the live path gave it none. A source that holds no non-empty string is recorded as `effort: null`, the key present. A string still longer than 40 characters after trim and whitespace collapse is stored as 40 characters ending in an ellipsis, not dropped. A row written before this change has no such field.
- Models do not change: the tier-to-model rule, the lane packing, the spawn model vocabulary and the price table are untouched. The planner, handoff, commit and replan spawns still inherit.

A plan stored before this change is re-planned one time, because a plan's fingerprint covers each lane's effort.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `effort-routing`: the default tier table, the verify ladder and its published retry effort, and the efforts the adversarial steps carry.
- `ship-run`: an `agent-spawn` event records the effort the spawn was given.

## Impact

- `lib/limits.mjs` — the `EFFORT` table (three tier values, the verify and skeptic values, a new `verifyRetry`), its comment, and one more row in `formatLimits`.
- `lib/run.mjs` — the verify spawn reads the retry effort on a fix attempt; `logSpawns` records each spawn's effort.
- `lib/run-log.mjs` — the `agent-spawn` event gains `effort`.
- `cli/interlock` — the lane spawn writer records the lane's effort (one line).
- `lib/lane.mjs`, `lib/waves.mjs` — comments that describe tiers 3 and 4 as inheriting.
- `docs/04-when-it-stops.md`, `CHANGELOG.md`.
- Comments and quoted samples that state the old table: the comment at `evals/ship/matrix.mjs:53-54`, `docs/assets/DESIGN-PROMPT.md`, `site/DESIGN-PROMPT.md`, `site/Run.dc.html`, and `site/Limits.dc.html`. No code path in those files changes.
- Tests: `test/spine/limits.test.mjs`, `test/spine/waves.test.mjs`, `test/spine/run.test.mjs`, `test/spine/run-log.test.mjs`, `test/workflows.test.mjs`, and others that hold a level this change moves.
- Hosts with no effort channel (codex, qwen) are passed an effort on more spawns than before and report each as not applied; no run stops for it.
- No dependency is added. No skill, hook or hooks-module code changes.
