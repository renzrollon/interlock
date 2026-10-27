## 💥 Blast radius review — business logic changes (PR #26)

> **Scope of this comment:** this is a separate, specific **blast radius** review. It is **not** about the settle meter's own plumbing: `lib/settle-meter.mjs`, the new `settle*` functions and the `/interlock-settle` pane and command in `hooks/mod.mjs`, the fixtures, the tests, the docs and the OpenSpec change. It looks only at the **business logic changes** this PR makes to the hooks module's existing paths to support the settle meter, and at which existing features they can affect: the ship meter, the spec meter and the in-process launch guard. The general code review, regression and performance findings are in the earlier comment.

Scope: `e3ab962...4312b89`. Static analysis only. Nothing was run, and no DB was touched.

⚠️ **Important:** none of the changed hook paths has run against a real `/interlock:settle --review` pass. `test/mod/settle-meter.test.ts` drives the engine kit with synthetic events modelled on one probe's captures (engine 2.1.310, one `general-purpose` spawn, six Bash results). `test/spine/settle-meter.test.mjs` feeds hand-built result shapes to the pure module. No test covers any of these three cases:
- a ship run and a settle run live together;
- a settle line beside a ship halt or close;
- a session that never ran settle, after a `/clear`.

**The first real settle pass after merge is the first real run.**

**Sub-repos: none. The consumers are the engine and the published package.**
- Engine floor `MODS_MIN_HOST_VERSION` 2.1.287 (`lib/host/claude-env.mjs:41`): every `$.` call was already used at BASE. Four event fields are new reads:
  - Skill `e.args`: captured on 2.1.291.
  - `turn.step` input `effort`: captured on 2.1.289 and 2.1.310.
  - spawn input `model`: captured on 2.1.310 only.
  - Bash `run_in_background`: no capture.

  None of these was checked at the floor. CI's floor leg runs `claude plugin test` only if the command exists there, and only on synthetic events.
- Latest engine: the earlier comment's gate ran the kit at 146/146 on 2.1.310.
- npm `@renzrollon/interlock`: `files` includes `lib`, so `lib/settle-meter.mjs` ships. `test/spine/package.test.mjs:147` pins this.
- Marketplace `release` branch: it mirrors the npm tarball (`plugin-bundle.yml`), so it carries the same files.

### 🔴 High

(none)

### 🟡 Medium

| # | Change | Affected | Data / concurrency | Tests |
|---|---|---|---|---|
| B1 | `setStatus` (`hooks/mod.mjs:412-417`). Before: the ship position, else the spec line while a spec run is live or at its checkpoint, else nothing. After: the ship position, else a live spec, else a live settle, else a spec checkpoint, else a finished settle line, else nothing. | **The only writer of the status line, from 6 call sites.** Unchanged: `redrawWord` :450 (ship live only), `endRunAtBoundary` :1104 (everything reset). Changed or new: `redrawSpec` :601, `redrawSettle` :671 (new), `applyRecord` :1458 (ship halt and close), and the ship launch :2228 (`if (handing)`). The line now differs from BASE in two places. At and after a ship halt or close, it shows a live or finished settle line instead of nothing, so an old verdict comes back after a later ship closes. During a spec checkpoint while a settle pass is live, it shows the settle line, which is D5 by design. With no settle run, it is identical to BASE. | Synchronous: it reads the three module records with no await. A ship launch during a live settle pass leaves the settle line up until the ship's first step. The living ship-meter requirement still says "otherwise nothing". See M5 in the earlier comment. | Spine: `settle-meter.test.mjs:1240` (pure; the ship is modelled only as live or not live). Kit (synthetic events): `settle-meter.test.ts:405`, `:430`, `:458-479`. Kit, settle idle: `meter.test.ts:486`, which asserts a halt or close clears the line. **None covers a live or finished settle run at a ship halt or close.** |
| B2 | Bash `tool.call` hook (`hooks/mod.mjs:2242-2284`). Before: with no ship watched, a line the spec reader declined returned at once (`idleStep` or `next`). After: `settleReads(command)` runs on every interactive Bash call while a settle run is live or done, or after a boundary, and a keyed settle line takes the long path (`await next(e)`, `noteIdleStep`, `fileSettleLines`) on both branches. | **Every interactive Bash call (1 hook).** Features reached, all unchanged: ship idle-step naming (`noteIdleStep` equals `idleStep` for these lines), ship step reading on the watched branch (still runs first) and the spec reader (still runs first). Every `interlock …` settle line is also a ship "driver" (`driverInvocation`, :1021-1058), but `interlock run …` is never a settle line. | There is no `agentId` filter: a ship lane's `interlock verify exec` or `git commit` is filed into a live settle record, and the spec skill's `interlock drift --json` ends it. See M2 and M4 in the earlier comment. Once a pass is done, or after any boundary, every call is parsed a second time for the rest of the session. See M3. In every case the engine receives BASE's result object. | Kit (synthetic events): `settle-meter.test.ts:368` (results identical), `:405` (ship plus a settle line), `:430` (spec plus settle), `:461` (boundary), and `meter.test.ts:634` (idle step after a boundary). **None covers ship lane lines during a live pass, or `drift --json` during a pass.** |

### 🟢 Low – Medium

| # | Change | Note |
|---|---|---|
| B3 | `turn.step` generator and `turn.complete` (`hooks/mod.mjs:2307-2333`, `:2335-2359`) | A settle agent's step now enters the non-ship branch and awaits one `$.clock.now()` plus a redraw before the result returns. Its turn end does the same before `next(e)`. The spec meter's advisor count and the ship tally are unchanged and still run first. With a ship run live, settle agents are also tallied as ship lanes, and an aborted one raises two toasts. See M4 in the earlier comment. |
| B4 | `noteSpawn` (`hooks/mod.mjs:885-900`); its sole caller is the `agent.spawn` chain at `:2366` | While a settle pass is live, every Agent spawn resolves one clock read later. The engine still receives the same `spawned` object, and the launch guard's `decideLaunch` is not on this chain. Spec Explore investigators spawned during a pass are also counted as unattributed settle agents. |
| B5 | `observeLoad($, name)` → `observeLoad($, name, args)` (`hooks/mod.mjs:610-623`); both callers (`prompt.submit` :2177, `Skill` :2291) are updated | The spec half still runs first, unchanged, inside its own `try`, and the settle half has a `try` of its own. `promptSkill` tolerates leading whitespace (`lib/spec-meter.mjs:92`), but `firstLineOf` takes line 1. So a prompt that opens with a blank line names the settle skill, drops `--review`, and starts no run. |
| B6 | `session.start` (`:2097-2148`) and `endRunAtBoundary` (`:1093-1112`) | A fifth command, `/interlock-settle`, registers after the four existing ones. Their order is kept, and the four test enumerations were updated, not weakened. Both functions reset the settle record beside `run` and `spec`. `hooks/mod.mjs` now imports `lib/settle-meter.mjs` at load, so a load failure there would take down the ship meter, the spec meter and the in-process launch guard together. The package files pin and the kit run guard against that. |

### ↩️ Rollback

Reverting `4312b89` is safe for data:
- The settle record is module memory only (`let settle`, :276).
- The diff adds no `$.state` key, no file write and no record schema.
- It leaves `types/`, `.claude-plugin/`, `hooks/hooks.json` and `package.json` alone.

So nothing persisted needs migrating. `/interlock-settle` disappears at the next session start, and the status line goes back to BASE's "otherwise nothing".

**One exception:** revert `hooks/mod.mjs` and `lib/settle-meter.mjs` in the same commit, together with the four command enumerations. A `mod.mjs` that imports a missing `settle-meter.mjs` fails to load for every user. If the change is archived before a revert, the living `hooks/settle-meter` spec and the amended `hooks/spec-meter` requirement must be reverted with it.

### ✅ Manual checks for UAT

1. **Status line after a pass (B1):** finish `/interlock:settle --review` to its verdict, then launch a ship run and let it close. Today's code shows the old `interlock settle <change> #<n>: merge confidence · <verdict> <score>` line again after the close. Confirm that is wanted, or take M5's fix. During the launch, check that the line switches to the ship position at the launch itself, not at the first step.
2. **Spec checkpoint against a live pass (B1):** with a spec run held at `checkpoint`, start a settle pass. Expected: the line reads `interlock settle …` while the pass is live, and returns to `interlock spec: <change> · checkpoint` after the pass's `interlock drift --changed` line.
3. **A spec run inside a pass (B2):** while a pass is live, before §11, run `/interlock:spec` on another change. Expected: the settle pane stays live and shows no `drift` row from the spec flow. Today the pass ends (M2).
4. **A ship run beside a pass (B2, B3):** with a pass live in round 1, launch a ship run. Expected: the ship lanes' `interlock verify exec` and `git commit` add no rows to the settle pane, the settle agents add no rows to the ship pane, and an aborted settle agent raises one toast. For today's behaviour, see M4.
5. **Every Bash call after a boundary (B2, B6):** in a session that never runs settle, `/clear`, then run `git commit` twice. Expected with the M3 fix: no `interlock settle:` debug line. Today there is one such line, and every later Bash call is parsed.
6. **Lows (B4–B6):** `/interlock-settle` appears after `/interlock-spec` in the command list. After `/clear` it reads `no settle run is live in this session`. On the floor engine 2.1.287, a typed `/interlock:settle --review` and a Skill-tool load each start a run, and the spawns show their requested model.
