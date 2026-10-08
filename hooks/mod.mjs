// The ship meter: a hooks module that draws a ship run while it runs, and the
// in-process form of the launch guard.
//
// Every hook here observes but one branch. The CLI decides; this module shows
// what the CLI already said, the moment it says it: the step each `interlock`
// call printed (read off the ping's Bash result), the per-agent figures each
// model request reported, and the plan windows the session reports. It joins
// nothing into any record, and recognises no banner by its wording: it shows
// the `banners` list the CLI emitted. The close summary and the receipt are
// the record; the pane says so.
//
// THE ONE BRANCH THAT DECIDES (guard-ship-relaunch-in-process design D3). The
// Workflow hook refuses a ship launch when the session recorded one newer than
// its last human prompt: the settings hook `hooks/guard-relaunch.mjs` reads the
// same rule over a file, and this reads it over the engine's own prompt origin
// and session state, before the engine or the settings layer sees the call.
// The verdict and its words are `lib/launch-rule.mjs`'s, never this file's;
// `test/spine/mod-pins.test.mjs` pins that the refusal is that verdict, once.
// A guard that cannot read its facts allows, says so on the debug log, and
// leaves the settings form to decide.
//
// It runs in the engine's own environment, with no Node and `$` as its only
// way out, so it imports nothing from the plugin that reaches `node:`:
// `lib/launch-rule.mjs` is Node-free by design, and the briefing-hash
// expression is restated below rather than imported, because
// `lib/agent-usage.mjs` imports `node:fs` (design D4, D5). It imports nothing
// from `claude-code` either: Claude Code 2.1.274 refuses a module that passes
// `$` into a function imported from there, so the state is read and written
// with `$.state` directly. What it may call and must never contain is pinned
// by `test/spine/mod-pins.test.mjs` (design D8); its behaviour by
// `test/mod/meter.test.ts` and `test/mod/relaunch.test.ts` under
// `claude plugin test`.
//
// The meter's state is module-level (design D3): a reload starts it over, a run
// launched before the reload is not drawn again, and the first of its steps to
// cross the module is named once on the debug log. The guard's record is the session's (`$.state`, declared in
// types/index.d.ts): it survives a reload, and /clear, /resume and /branch
// empty it, which allows the next launch. The meter's run ends on that same
// boundary, the classic session-start event with a `clear`, `resume` or `fork`
// source, so the two things the module keeps are reset together
// (show-quiet-time-and-reset-the-meter-on-clear design D4).
//
// THE QUIET FIGURE (same change, design D1-D3, D5). While a run is live the
// module stamps the engine's time of each thing the run does, and one interval
// the host runs for it recomputes how long the run has been quiet. Once that
// reaches the published threshold, `quiet <n> min` follows the position on the
// status line, the spinner and the pane. The word names no cause, and the
// threshold and the period are `lib/meter-quiet.mjs`'s, read from
// `interlock limits`; this file holds neither number.
//
// THE GUARDS' REFUSALS (speak-permission-prompts-and-guard-denials design D4,
// D5). A settings guard that refuses a tool call ends it with an errored result
// whose text carries the guard's own sentence behind an engine prefix. The
// tool hooks on Bash, Edit, Write and Workflow read that result, and when it
// names one of the four guards the sentence is toasted once and counted on the
// pane. The in-process launch guard's own refusal is toasted in the rule's
// words, and the pane shows the rule's ruling over the session's record. The
// names and the words are `lib/meter-refusals.mjs`'s and the guards'; the
// permission prompts are not spoken, because no classic event reaches a hooks
// module on the engines probed (design D1, D9).
//
// THE WAVE BOARD (draw-the-wave-board-in-the-meter-pane design D5-D8). The
// pane's waves section is the board `lib/draw-plan.mjs` draws for the CLI,
// drawn from one source: the plan summary the adoption and replan steps carry,
// with an overlay built from the steps alone (the cursor, the ids each recorded
// batch names, the skipped verifications, the halt). No file is read for it.
// The module lays those rows as one bordered card per wave, wraps the gist,
// and colours only the state word the renderer chose. It keys the lanes,
// appends what the host observed of a lane, and speaks every fallback: a CLI
// that relays no plan, a pane narrower than the board, a renderer that throws.
//
// THE SESSION START (show-preflight-and-interrupted-runs-at-session-start
// design D5-D8). Outside a run the module draws two things, both from the
// report `hooks/preflight.mjs` leaves at `.claude/ship/preflight.json`: the
// `AbovePrompt` band with `/interlock-preflight`, and `/interlock-handoff`,
// which renders a halt resume card the report names. That file and a card it
// names are the module's one file read, `$.fs.read`, and nothing else: never a
// run's trajectory, its manifest or its wave state, and no listing or
// existence check (the hook lists, in Node). It reads at each prompt a person
// submits, the one event that reaches a module after the preflight wrote, and
// after the classic session-start event where an engine raises one. A report
// is known by its own written time, so a re-read changes nothing and the band
// stays hidden once hidden; the lines, the hide rule and the card's cap are
// `lib/preflight-file.mjs`'s.
//
// THE SPEC METER (observe-the-spec-run-live design D1-D7). The same module
// draws an `/interlock:spec` run, which has no CLI spine of its own, from what
// already crossed it: the spec skill's load, read off a submitted prompt's
// first word or a Skill tool call (the engine raised no `skill.prompt` for a
// plugin skill on 2.1.291, so that event is not hooked), the Bash results of
// the flow's keyed `openspec` and `interlock` lines, the paths of Edit and
// Write calls, and the Explore spawns. A prompt, a Skill call and every result
// are passed on as they came. It writes nothing and reads no file: the
// artifacts on disk, the findings file and the gate's exit are the record,
// and the pane says so. Its record is module state, ended at the checkpoint,
// at an accepted ship launch and at the session boundary. The module owns one
// status line, written by `setStatus` alone: the ship position while a ship
// run is live, else the spec line. Every rule and word is
// `lib/spec-meter.mjs`'s.

import { drawPlanBoardRows } from '../lib/draw-plan.mjs'
import { decideLaunch, emptyRecord, isAcceptedLaunch, isShipLaunch, withLaunch, withPrompt } from '../lib/launch-rule.mjs'
import { LIMITS } from '../lib/limits.mjs'
import { TICK_MS, quietMs, quietWord } from '../lib/meter-quiet.mjs'
import { guardDenialLine, guardOf, guardReason, launchGuardLine } from '../lib/meter-refusals.mjs'
import {
  adoptPreflight,
  bandLines,
  cardLine,
  clampCard,
  freshStart,
  noCardText,
  noReportText,
  orderCards,
  preflightFilePath,
  preflightPaneLines,
  readPreflightReport
} from '../lib/preflight-file.mjs'
import {
  SPEC_REPLACED_LINE,
  SPEC_TITLE,
  SPEC_UNPLACED_TOAST,
  TEXT_KINDS,
  changeOf,
  freshSpec,
  lateLineText,
  promptSkill,
  readResult,
  skillRole,
  specLines,
  specPaneLines,
  specStatusText,
  unparsedEntry,
  unreadLineText,
  writeOf
} from '../lib/spec-meter.mjs'

const PANE = 'interlock-meter'
const TITLE = 'Interlock'
const RECORD_LINE = 'live figures; the close summary and the receipt are the record'
const NO_RUN_LINE = 'no ship run is live in this session'
const UNPLACED_TOAST = '/interlock-meter opens the ship meter'
// The wave section's spoken lines (draw-the-wave-board-in-the-meter-pane design D8).
const NO_LANES_LINE = 'no lanes dispatched yet'
const UNRELAYED_LINE = 'plan structure not relayed by this CLI'
const BOARD_FAILED_LINE = 'wave board could not be drawn'
// The actions that dispatch a batch of lanes, and so place the board's cursor on one.
const BATCH_ACTIONS = new Set(['run-batch', 'test-wave'])
// The session start's two panes, each opened by the command of its name (design D6).
const PREFLIGHT_PANE = 'interlock-preflight'
const HANDOFF_PANE = 'interlock-handoff'
// The spec meter's pane and command (observe-the-spec-run-live design D6), spelled
// here so the validator records it; pinned equal to lib/spec-meter.mjs's.
const SPEC_PANE = 'interlock-spec'

// The launch guard's record in the session's state: the one key the plugin's
// type contract declares (types/index.d.ts; guard-ship-relaunch-in-process D2).
const LEDGER = { plugin: 'interlock', key: 'ledger' }
// The prompt origins a person stands behind: their own Enter, the Remote
// Control bridge, the SDK host's turn (design D3). The completion wake, a
// schedule, a peer, a channel, a coordinator, an observer, a plugin's own and
// a missing origin count nothing.
const HUMAN_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const GUARD = 'interlock guard'
// The line `cli()` in workflows/ship.js hands the ping (design D2).
const DRIVER_LINE = /^interlock\s/
// The bootstrap line a lane's spawn prompt carries (as `lib/agent-usage.mjs` reads it).
const BRIEFING_SHA = /Expected sha256: ([0-9a-f]{64})/g
const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
// The classic session-start sources that start the session over, as the person
// typed them (design D4). `startup` and `compact` are not among them.
const BOUNDARIES = new Map([
  ['clear', '/clear'],
  ['resume', '/resume'],
  ['fork', '/branch']
])

let session = { interactive: false, surface: null, cwd: null }
let run = freshRun()
// The session start's report, as last read (design D8): module state, reset
// with the run on a reload and on the session boundary.
let start = freshStart()
// Counts every interval this environment started, so a period can tell its own (design D2).
let generations = 0
// The spec run, as module state (observe-the-spec-run-live design D7): reset
// on a reload and at the session boundary, like the ship run.
let spec = freshSpec()

function freshRun() {
  return {
    // idle → live (accepted launch) → closing (a close or halt step) → closed (the close record)
    phase: 'idle',
    runId: null,
    workflowName: null,
    transcriptDir: null,
    change: null,
    action: null,
    wave: undefined,
    batchIndex: undefined,
    batchCount: undefined,
    rows: new Map(),
    banners: [],
    toasted: new Set(),
    agents: new Map(),
    summary: null,
    exitCode: null,
    // The quiet figure (design D1, D2): the engine's time of the run's last
    // activity (null until the clock answers), the word it makes, and the one
    // interval that recomputes it, known by its handle and its generation.
    lastActivityAt: null,
    quietWord: null,
    tick: null,
    generation: 0,
    clockFailed: false,
    // Whether a step that crossed with no live run has been named on the debug log.
    idleStepNamed: false,
    // Each settings guard's refusals this run, by guard, in first-seen order (design D4).
    guardDenials: new Map(),
    // The wave board (draw-the-wave-board-in-the-meter-pane design D6), every
    // field taken off a step: the latest plan summary, the ids each recorded
    // batch named (and, for a failed id, the wave it was recorded at), the
    // skipped verifications by position, where the run is, the last batch
    // dispatched, the halt, and whether a malformed field was named yet.
    plan: null,
    recorded: { ok: [], failed: [], notAttempted: [] },
    failedAt: new Map(),
    skips: [],
    cursor: null,
    dispatched: null,
    halt: null,
    planNamed: false,
    recordedNamed: false
  }
}

const watching = () => session.interactive && (run.phase === 'live' || run.phase === 'closing')
const specWatching = () => session.interactive && spec.phase === 'live'
const isInt = v => Number.isInteger(v)
const str = v => (typeof v === 'string' && v ? v : null)

const messageOf = err => (err && err.message) || String(err)
const asRecord = value => (value && typeof value === 'object' && Array.isArray(value.launches) ? value : emptyRecord())

/**
 * What the launch guard decides over: the session's record and the time now. A
 * missing or malformed record is empty; one that cannot be read at all is
 * empty too, and named on the debug log. An empty record allows (design D5).
 */
async function guardFacts($) {
  try {
    const held = await $.state.get(LEDGER)
    return { record: asRecord(held.value), now: await $.clock.now() }
  } catch (err) {
    $.ui.log(`${GUARD}: cannot establish this session's launches, allowing: ${messageOf(err)}`, { to: 'debug' })
    // No time, not a made-up one: the empty record allows before the rule reads
    // it, and the meter stamps no launch time it does not have (design D1).
    return { record: emptyRecord(), now: null }
  }
}

/**
 * Change the session's record with `change(record, at)`, `at` the time now as
 * ISO. Written only over the version it read and read again when another write
 * landed first, as the engine's `update` does. A write that fails is named on
 * the debug log and never thrown: it runs after the call it records did.
 */
async function changeRecord($, what, change) {
  try {
    const at = new Date(await $.clock.now()).toISOString()
    let held = await $.state.get(LEDGER)
    for (;;) {
      const written = await $.state.set(LEDGER, change(asRecord(held.value), at), { ifVersion: held.version })
      if (written.isSet) return
      const again = await $.state.get(LEDGER)
      if (again.version === held.version) throw new Error(`the write missed at version ${held.version} with no other write`)
      held = again
    }
  } catch (err) {
    $.ui.log(`${GUARD}: ${what} not recorded: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** `<change> · <action> · wave <w> · batch <j>/<k>`, each position omitted when the step carries none (design D6). */
function position() {
  const parts = []
  if (run.change) parts.push(run.change)
  if (run.action) parts.push(run.action)
  if (run.wave !== undefined && run.wave !== null) parts.push(`wave ${run.wave}`)
  if (isInt(run.batchIndex) && isInt(run.batchCount)) parts.push(`batch ${run.batchIndex + 1}/${run.batchCount}`)
  return parts.join(' · ')
}

/** The position, then the quiet word while it is set: what the status line and the spinner say (design D5). */
const shown = () => [position(), run.quietWord].filter(Boolean).join(' · ')

function statusText() {
  const text = shown()
  return text ? `interlock: ${text}` : undefined
}

/**
 * The module's one status line, composed in one place (observe-the-spec-run-live
 * design D7): the ship position while a ship run is live, else the spec line
 * while a spec run is live or stopped at its checkpoint, else nothing. The
 * engine keeps one line per plugin and each call replaces it (probe 4), so
 * this is the only writer.
 */
function setStatus($) {
  const shownSpec = spec.phase === 'live' || spec.phase === 'checkpoint'
  $.ui.status(run.phase === 'live' ? statusText() : shownSpec ? specStatusText(spec) : undefined)
}

/**
 * The engine's time now, or `null` when the clock cannot be read. A read that
 * fails is named once per run on the debug log and never thrown (design D1).
 */
async function clockNow($) {
  const held = run
  try {
    const now = await $.clock.now()
    if (Number.isFinite(now)) return now
    throw new Error(`the clock answered ${String(now)}`)
  } catch (err) {
    if (!held.clockFailed) {
      held.clockFailed = true
      $.ui.log(
        `interlock meter: the clock cannot be read; the last activity time stands and no quiet figure is shown: ${messageOf(err)}`,
        { to: 'debug' }
      )
    }
    return null
  }
}

/** Sets the quiet word; true when it changed. */
function setWord(word) {
  if (run.quietWord === word) return false
  run.quietWord = word
  return true
}

/** Draws the word where it shows: the status line while the run is live, the pane and the spinner. */
function redrawWord($) {
  if (run.phase === 'live') setStatus($)
  $.ui.invalidate('ui.render')
}

/**
 * Activity (design D1): the run's last activity is now, and the quiet word is
 * gone. A clock that cannot be read leaves the stamp as it was and the word
 * absent, never a guessed time. True when the word changed, so the caller redraws.
 */
async function stamp($) {
  const held = run
  const now = await clockNow($)
  if (held !== run) return false
  if (now !== null) run.lastActivityAt = run.lastActivityAt === null ? now : Math.max(run.lastActivityAt, now)
  return setWord(null)
}

/**
 * Starts the run's one interval (design D2), the host's own timer: each period
 * reads the clock and recomputes the word, and draws only when the word
 * changed. A period that finds another run or another interval in its place
 * returns at once. A host that will not start one leaves the pane, which
 * recomputes the word whenever it is drawn.
 */
function startTick($) {
  const generation = ++generations
  run.generation = generation
  const isMine = tick => run.generation === generation && run.tick === tick
  try {
    const tick = $.clock.every(TICK_MS, async () => {
      if (!isMine(tick)) return
      try {
        const now = await clockNow($)
        if (isMine(tick) && setWord(quietWord(quietMs(run.lastActivityAt, now)))) redrawWord($)
      } catch (err) {
        $.ui.log(`interlock meter: a quiet-figure period failed: ${messageOf(err)}`, { to: 'debug' })
      }
    })
    run.tick = tick
  } catch (err) {
    $.ui.log(`interlock meter: no interval for the quiet figure; the pane computes it when drawn: ${messageOf(err)}`, {
      to: 'debug'
    })
  }
}

/** Ends the run's interval, if it has one: a cancelled timer never fires again. */
function stopTick() {
  if (run.tick) run.tick.cancel()
  run.tick = null
  run.quietWord = null
}

/**
 * A settings guard's refusal, read off the result the engine handed a tool hook
 * (design D4): the text from the guard's name on is toasted once per distinct
 * text per run and counted by guard. A result that is not errored, or names no
 * guard, is not this module's to speak: nothing is drawn and nothing logged.
 */
function speakRefusal($, r) {
  try {
    const reason = r && r.isError === true ? guardReason(r.text) : null
    if (!reason) return
    const guard = guardOf(reason)
    run.guardDenials.set(guard, (run.guardDenials.get(guard) || 0) + 1)
    if (!run.toasted.has(reason)) {
      run.toasted.add(reason)
      $.ui.toast(reason)
    }
    $.ui.invalidate('ui.render')
  } catch (err) {
    $.ui.log(`interlock meter: a guard's refusal was not drawn: ${messageOf(err)}`, { to: 'debug' })
  }
}

/**
 * An edit during a live ship run, its result read for a guard's refusal
 * (guard-tests, guard-tasks); during a live spec run, its path filed as a
 * write when the engine did not mark it errored (observe-the-spec-run-live
 * design D4). Returned as it came.
 */
async function editCall($, e, next) {
  const ship = watching()
  if (!ship && !specWatching()) return next(e)
  const held = run
  const heldSpec = spec
  const r = await next(e)
  if (ship && held === run) speakRefusal($, r)
  if (heldSpec === spec && specWatching() && !(r && r.isError === true)) await fileWrite($, e.file_path)
  return r
}

/**
 * The engine's time now for the spec record, or `null` when the clock cannot
 * be read: the ship meter's rule (design D6), named once per spec run.
 */
async function specNow($) {
  const held = spec
  try {
    const now = await $.clock.now()
    if (Number.isFinite(now)) return now
    throw new Error(`the clock answered ${String(now)}`)
  } catch (err) {
    if (!held.clockFailed) {
      held.clockFailed = true
      $.ui.log(`interlock spec: the clock cannot be read; the last activity time stands: ${messageOf(err)}`, { to: 'debug' })
    }
    return null
  }
}

/** Activity on the spec record: its last activity is now, when the clock answers. */
async function specStamp($) {
  const held = spec
  const now = await specNow($)
  if (held === spec && now !== null) spec.lastActivityAt = now
  return now
}

/** Redraws what the spec run shows: the status line through the composer, and the panes. */
function redrawSpec($) {
  setStatus($)
  $.ui.invalidate('ui.render')
}

/**
 * The spec skill's load (design D1): `spec` starts a run over whatever was
 * held, `explore` and `review-artifacts` set the stage of a live one, and
 * anything else is not this meter's. Never throws.
 */
async function observeLoad($, name) {
  try {
    const role = skillRole(name)
    if (role === 'spec') await startSpec($)
    else if (role && specWatching()) {
      spec.stage = { kind: role }
      await specStamp($)
      redrawSpec($)
    }
  } catch (err) {
    $.ui.log(`interlock spec: a skill load was not drawn: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** A fresh spec run, live, its pane opened unasked; one toast when the engine will not seat it. */
async function startSpec($) {
  if (spec.phase !== 'idle') $.ui.log(SPEC_REPLACED_LINE, { to: 'debug' })
  spec = freshSpec()
  const started = spec
  spec.phase = 'live'
  spec.startedAt = await specStamp($)
  if (started !== spec) return
  redrawSpec($)
  const placed = await openPane($, SPEC_PANE, SPEC_TITLE)
  if (!placed || placed.isPlaced !== true) $.ui.toast(SPEC_UNPLACED_TOAST)
}

/**
 * The spec record that will read a keyed command, or `null` (design D3). With
 * no live spec run the first keyed line after the checkpoint or a session
 * boundary is named once on the debug log, and none is read.
 */
function specReader($, lines) {
  if (specWatching()) return spec
  const keyed = lines.find(l => l.kind !== 'naming-only')
  if (keyed && !spec.lateNamed && (spec.phase === 'checkpoint' || spec.afterBoundary)) {
    spec.lateNamed = true
    $.ui.log(lateLineText(keyed.kind, spec.phase), { to: 'debug' })
  }
  return null
}

/** The results kept for a change, `null` being the unnamed slot the pane never draws (design D2). */
function changeSlot(name) {
  if (!spec.changes.has(name)) spec.changes.set(name, {})
  return spec.changes.get(name)
}

/**
 * Files one keyed segment's entry (design D2, D3, D7): the change it names
 * becomes the one drawn, its result is kept under that change (or the current
 * one), and the stage is the entry. A checkpoint ends the run at its checkpoint.
 */
function fileEntry(entry, now) {
  if (entry.name) {
    spec.current = entry.name
    if (!spec.order.includes(entry.name)) spec.order.push(entry.name)
  }
  if (entry.kind === 'naming-only') return
  const slot = changeSlot(entry.name || spec.current)
  if (entry.kind === 'drift') spec.drift = entry
  else if (entry.kind === 'autonomy') spec.autonomy = entry.command
  else if (TEXT_KINDS.includes(entry.kind)) slot[entry.kind] = entry
  if (entry.kind === 'checkpoint') {
    spec.phase = 'checkpoint'
    spec.checkpointCrossed = true
    spec.checkpointAt = now
  }
  spec.stage = entry
}

/**
 * Reads a command's keyed segments into the spec record (design D3). Every
 * entry is read before any is filed, so a reader that throws leaves the record
 * as it was. Two segments whose results are read share one output, so each is
 * kept unparsed. An unparsed result leaves one debug line. Never throws.
 */
async function applySpecLines($, held, lines, r) {
  try {
    const texts = lines.filter(l => TEXT_KINDS.includes(l.kind)).length
    const text = r && typeof r.text === 'string' ? r.text : ''
    const entries = lines.map(({ kind, segment }) => {
      if (kind === 'naming-only') return { entry: { kind, name: changeOf(kind, segment, null) }, segment }
      if (texts > 1 && TEXT_KINDS.includes(kind)) {
        return { entry: { ...unparsedEntry(kind, text, 'compound command'), name: changeOf(kind, segment, null) }, segment }
      }
      return { entry: readResult(kind, segment, r), segment }
    })
    const now = await specNow($)
    if (held !== spec || !specWatching()) return
    for (const { entry, segment } of entries) {
      if (!entry) continue
      fileEntry(entry, now)
      if (typeof entry.unparsed === 'string') $.ui.log(unreadLineText(entry, segment), { to: 'debug' })
    }
    if (now !== null) spec.lastActivityAt = now
    redrawSpec($)
  } catch (err) {
    $.ui.log(`interlock spec: a keyed line was not read: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** A write during a live spec run, filed by its path (design D4). A path never names the change. Never throws. */
async function fileWrite($, path) {
  try {
    const w = writeOf(path)
    if (!w) return
    const held = spec
    const now = await specNow($)
    if (held !== spec) return
    if (w.kind === 'artifact') {
      if (!spec.writes.has(w.change)) spec.writes.set(w.change, new Map())
      const files = spec.writes.get(w.change)
      const before = files.get(w.file)
      files.set(w.file, { count: (before ? before.count : 0) + 1, at: now === null && before ? before.at : now })
    } else if (w.kind === 'brief') spec.explore.brief = w.path
    else if (w.kind === 'findings') spec.findings.set(w.change, w.path)
    if (now !== null) spec.lastActivityAt = now
    $.ui.invalidate('ui.render')
  } catch (err) {
    $.ui.log(`interlock spec: a write was not filed: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** What an `agent.spawn` chain returned, read for the meter and handed back unchanged. */
async function noteSpawn($, input, spawned) {
  if (session.interactive && run.phase === 'live') {
    if (spawned && str(spawned.agentId) && input && typeof input.prompt === 'string') {
      const found = [...input.prompt.matchAll(BRIEFING_SHA)]
      if (found.length) agentOf(spawned.agentId).sha = found[found.length - 1][1]
    }
    if (await stamp($)) redrawWord($)
  }
  // An Explore investigator the chain let through (observe-the-spec-run-live design D5).
  if (specWatching() && input && input.subagentType === 'Explore' && spawned && typeof spawned.model === 'string') {
    await countInvestigator($)
  }
  return spawned
}

/**
 * A clear, resume or fork ends the run the meter holds, before the chain
 * beneath runs. Any other source, and a non-interactive session, changes
 * nothing. Never throws.
 */
function endRunAtBoundary($, input) {
  if (!session.interactive) return
  try {
    const boundary = BOUNDARIES.get(input.source)
    if (!boundary) return
    const ended = run
    stopTick()
    run = freshRun()
    start = freshStart()
    spec = freshSpec({ afterBoundary: true })
    setStatus($)
    $.ui.invalidate('ui.render')
    const what = ended.phase === 'idle' ? 'no run was held' : `run ${ended.runId || '(no id)'} is no longer drawn`
    $.ui.log(`interlock meter: ${boundary} started the session over; ${what}`, { to: 'debug' })
  } catch (err) {
    $.ui.log(`interlock meter: the session boundary was not applied: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** Once the chain beneath has run: the preflight's report, read for every source. */
async function readPreflightAfterStart($, input) {
  if (session.interactive) await readPreflight($, str(input.cwd) || session.cwd)
}

/** One Explore investigator the chain let through (design D5). Never throws. */
async function countInvestigator($) {
  try {
    spec.explore.spawned++
    await specStamp($)
    redrawSpec($)
  } catch (err) {
    $.ui.log(`interlock spec: an investigator was not counted: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** `/interlock-spec` (design D6): the pure module's keyed lines on `Box` and `Text`, and nothing else. */
function drawSpecPane($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const props = l => (l.bold ? { bold: true } : l.dim ? { dimColor: true } : null)
  return h(Box, { flexDirection: 'column' }, ...specPaneLines(spec).map(l => h(Box, { key: l.key }, h(Text, props(l), l.text))))
}

/** The launch guard's ruling now, over the record its branch would read, in the rule's words (design D5). */
async function launchGuardText($) {
  const { record, now } = await guardFacts($)
  const ruling = decideLaunch(record, now)
  return launchGuardLine(ruling, now)
}

/** Names, once per run record, a step that crossed with no live run (design D4). */
function nameIdleStep($) {
  run.idleStepNamed = true
  $.ui.log(
    'interlock meter: a step crossed with no live run and is not drawn ' +
      "(a run launched before a /clear, /resume or /branch, or before this module reloaded, is no longer this session's)",
    { to: 'debug' }
  )
}

/** A driver-line call with no live run: passed on whole, its result read only to name the first step (design D4). */
async function idleStep($, e, next) {
  if (run.phase !== 'idle' || run.idleStepNamed) return next(e)
  const r = await next(e)
  noteIdleStep($, r)
  return r
}

/** Names the first step record a result carries while no run is live; reads nothing else. */
function noteIdleStep($, r) {
  try {
    if (run.phase === 'idle' && !run.idleStepNamed && readRecord(r.text).record) nameIdleStep($)
  } catch {
    // Reading the result is all this does; the call and its result are the engine's.
  }
}

/** The step record in a Bash result's text, guarded as the driver guards it: an object with a string `action`. */
function readRecord(text) {
  if (typeof text !== 'string' || !text.trim()) return { problem: 'no result text' }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { problem: 'not JSON' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: 'not an object' }
  if (typeof value.action !== 'string') return { problem: 'no action' }
  return { record: value }
}

function agentOf(id) {
  let a = run.agents.get(id)
  if (!a) {
    a = {
      id,
      requests: 0,
      known: 0,
      partial: false,
      sums: null,
      models: [],
      reason: null,
      durationMs: null,
      sha: null,
      // Whether its turn end has been spoken: once per agent per run (speak-lane-turn-ends design D1).
      endToasted: false
    }
    run.agents.set(id, a)
  }
  return a
}

/** Field by field: a field one request omitted leaves that figure unknown (`null`), never a guessed zero (design D5). */
function addUsage(a, usage) {
  a.requests++
  if (!usage || typeof usage !== 'object') {
    a.partial = true
    return
  }
  a.known++
  if (!a.sums) a.sums = Object.fromEntries(TOKEN_FIELDS.map(f => [f, 0]))
  for (const f of TOKEN_FIELDS) {
    a.sums[f] = a.sums[f] === null || typeof usage[f] !== 'number' ? null : a.sums[f] + usage[f]
  }
  if (str(usage.model) && !a.models.includes(usage.model)) a.models.push(usage.model)
}

/** What a malformed field is, for its debug line: never its content. */
const shapeOf = value => (value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`)

/** A plan summary as the run program states it: an object with an array of waves. */
const isPlanSummary = value => value !== null && typeof value === 'object' && Array.isArray(value.waves)

/** A `recorded` block as the run program states it: three lists of ids. */
const isRecordedIds = value =>
  value !== null &&
  typeof value === 'object' &&
  ['ok', 'failed', 'notAttempted'].every(list => Array.isArray(value[list]))

/** The summary's wave at a position, as a failure record names it: its group and its kind. */
function waveAt(plan, index) {
  if (!plan || !isInt(index)) return { wave: null, waveKind: null }
  const wave = plan.waves[index]
  if (wave && typeof wave === 'object') return { wave: wave.group ?? null, waveKind: str(wave.kind) }
  return plan.testWave && index === plan.waves.length ? { wave: null, waveKind: 'test' } : { wave: null, waveKind: null }
}

/**
 * What the wave board keeps from a step (draw-the-wave-board-in-the-meter-pane
 * design D6). A `plan` or `recorded` without the shape the run program states
 * is named once per run on the debug log and ignored; the rest of the step
 * applies. The recorded ids are taken before the step's own position, because
 * the step record-batch returns already names the next batch.
 */
function takeBoard($, record) {
  if (record.plan !== undefined) {
    if (isPlanSummary(record.plan)) run.plan = record.plan
    else if (!run.planNamed) {
      run.planNamed = true
      $.ui.log(`interlock meter: a step's plan is ${shapeOf(record.plan)}, not a plan summary; ignored, the board keeps what it held`, {
        to: 'debug'
      })
    }
  }
  if (record.recorded !== undefined) {
    if (isRecordedIds(record.recorded)) {
      for (const list of ['ok', 'failed', 'notAttempted']) {
        for (const id of record.recorded[list]) {
          if (!str(id) || run.recorded[list].includes(id)) continue
          run.recorded[list].push(id)
          if (list === 'failed') run.failedAt.set(id, waveAt(run.plan, run.dispatched && run.dispatched.waveIndex))
        }
      }
    } else if (!run.recordedNamed) {
      run.recordedNamed = true
      $.ui.log(
        `interlock meter: a step's recorded is ${shapeOf(record.recorded)}, not three id lists; ignored, the board keeps the ids it held`,
        { to: 'debug' }
      )
    }
  }
  if (isInt(record.waveIndex)) {
    const at = { waveIndex: record.waveIndex, batchIndex: isInt(record.batchIndex) ? record.batchIndex : null }
    if (BATCH_ACTIONS.has(record.action)) {
      run.cursor = { ...at, phase: 'batch' }
      run.dispatched = at
    } else if (record.action === 'verify') {
      run.cursor = { ...at, phase: 'verify' }
      const reason = str(record.reason)
      const seen = run.skips.some(skip => skip.waveIndex === at.waveIndex && skip.reason === reason)
      if (record.skipped === true && !seen) run.skips.push({ waveIndex: at.waveIndex, wave: record.wave ?? null, reason })
    }
  }
  // The close record repeats the action without the reason; the halt step's stands.
  if (record.action === 'halt') run.halt = { reason: str(record.reason) || (run.halt ? run.halt.reason : null) }
}

async function applyRecord($, record) {
  const held = run
  await stamp($)
  if (held !== run) return
  const isClose = record.then === null && typeof record.summary === 'string' && typeof record.exitCode === 'number'
  if (str(record.change)) run.change = record.change
  run.action = record.action
  if (record.wave !== undefined) run.wave = record.wave
  run.batchIndex = record.batchIndex
  run.batchCount = record.batchCount
  for (const s of Array.isArray(record.spawns) ? record.spawns : []) {
    if (!s || typeof s !== 'object' || !str(s.label)) continue
    run.rows.set(s.label, {
      label: s.label,
      title: str(s.title) || s.label,
      kind: str(s.kind),
      model: str(s.model),
      effort: str(s.effort),
      sha: str(s.promptSha256),
      // Spawned by a step that dispatches a batch: a lane, planned or not.
      batch: BATCH_ACTIONS.has(record.action)
    })
  }
  takeBoard($, record)
  for (const banner of Array.isArray(record.banners) ? record.banners : []) {
    if (typeof banner !== 'string' || !banner) continue
    if (!run.banners.includes(banner)) run.banners.push(banner)
    if (!run.toasted.has(banner)) {
      run.toasted.add(banner)
      $.ui.toast(banner)
    }
  }
  if (typeof record.summary === 'string' && (isClose || record.action === 'close')) run.summary = record.summary
  if (isClose) {
    run.exitCode = record.exitCode
    run.phase = 'closed'
    stopTick()
  } else if (record.action === 'close' || record.action === 'halt') {
    run.phase = 'closing'
    stopTick()
  }
  setStatus($)
  $.ui.invalidate('ui.render')
}

async function openPane($, id = PANE, title = TITLE) {
  return $.ui.open({ id, title, closeOnEscape: true })
}

/**
 * Reads the session start's report (design D5) and holds what `adoptPreflight`
 * keeps: the same report changes nothing, a new one is drawn, and a file that
 * cannot be read or is not a report is named once on the debug log. Never
 * throws: a read that rejects is the event's to carry on past.
 */
async function readPreflight($, cwd) {
  const path = preflightFilePath(cwd)
  let outcome
  try {
    outcome = readPreflightReport(await $.fs.read(path))
  } catch (err) {
    outcome = { problem: messageOf(err) }
  }
  try {
    const { start: next, changed, log } = adoptPreflight(start, outcome, path)
    start = next
    if (log) $.ui.log(log, { to: 'debug' })
    if (changed) $.ui.invalidate('ui.render')
  } catch (err) {
    $.ui.log(`interlock meter: the preflight report was not held: ${messageOf(err)}`, { to: 'debug' })
  }
}

/** One keyed row per line, so the kit and the person both find each line on its own. */
function rowsOf($, e, prefix, lines) {
  const { Box, Text } = $.ui.resolve(e)
  return lines.map((line, n) => h(Box, { key: `${prefix}-${n}` }, h(Text, null, line)))
}

/**
 * The band (design D6): the report's lines above whatever the other plugins
 * drew, and a Hide control that collapses it until a new session start's
 * report. It yields to a survey, and draws nothing of its own with no report,
 * a hidden band, or a report with nothing to say.
 */
async function drawBand($, e, next) {
  if (!session.interactive || (e.props && e.props.hasSurvey) || start.hidden || !start.report) return next(e)
  const lines = bandLines(start.report)
  if (!lines.length) return next(e)
  const beneath = await next(e)
  try {
    const { Box, Button } = $.ui.resolve(e)
    const hide = () => {
      start.hidden = true
      $.ui.invalidate('ui.render')
    }
    return h(
      Box,
      { flexDirection: 'column' },
      ...rowsOf($, e, 'preflight', lines),
      h(Button, { key: 'hide', label: 'Hide', onPress: hide }),
      ...(beneath ? [beneath] : [])
    )
  } catch (err) {
    $.ui.log(`interlock meter: the session-start band was not drawn: ${messageOf(err)}`, { to: 'debug' })
    return beneath
  }
}

/** `/interlock-preflight`: the report's every line, or why there is none (design D6). */
function drawPreflightPane($, e) {
  const { Box } = $.ui.resolve(e)
  const lines = start.report
    ? preflightPaneLines(start.report)
    : [noReportText(start.path || preflightFilePath(session.cwd), start.problem)]
  return h(Box, { flexDirection: 'column' }, ...rowsOf($, e, 'preflight-pane', lines))
}

/**
 * `/interlock-handoff` (design D6): each card the report lists, newest first,
 * read from its path now and rendered verbatim through `Markdown`, cut to the
 * published cap. A card that cannot be read is named with the reason, and the
 * next is drawn as before. Nothing here acts on a card.
 */
async function drawHandoffPane($, e) {
  const { Box, Text, Markdown } = $.ui.resolve(e)
  const column = rows => h(Box, { flexDirection: 'column' }, ...rows)
  if (!start.report) {
    return column(rowsOf($, e, 'handoff', [noReportText(start.path || preflightFilePath(session.cwd), start.problem)]))
  }
  const cards = orderCards(start.report)
  if (!cards.length) return column(rowsOf($, e, 'handoff', noCardText(start.report)))
  const out = []
  for (const [n, card] of cards.entries()) {
    out.push(h(Box, { key: `card-${n}` }, h(Text, null, cardLine(card))))
    try {
      const text = await $.fs.read(card.path)
      out.push(h(Box, { key: `card-${n}-body` }, h(Markdown, { text: clampCard(text, card.path).text })))
    } catch (err) {
      out.push(h(Box, { key: `card-${n}-unread` }, h(Text, null, `${card.path}: cannot be read: ${messageOf(err)}`)))
    }
  }
  return column(out)
}

function tokensText(a) {
  if (a.known === 0) return a.requests ? 'tokens unknown (partial)' : 'no requests yet'
  const f = n => (n === null ? '?' : String(n))
  const s = a.sums
  return (
    `in ${f(s.input_tokens)} · out ${f(s.output_tokens)} · cache read ${f(s.cache_read_input_tokens)} · ` +
    `cache write ${f(s.cache_creation_input_tokens)}${a.partial ? ' (partial)' : ''}`
  )
}

function agentForSha(sha) {
  if (!sha) return null
  for (const a of run.agents.values()) if (a.sha === sha) return a
  return null
}

function rowForAgent(a) {
  if (!a.sha) return null
  for (const r of run.rows.values()) if (r.sha === a.sha) return r
  return null
}

function laneForAgent(a) {
  const r = rowForAgent(a)
  return r ? r.label : null
}

/**
 * The session lines (speak-lane-turn-ends-and-session-cost design D4, D6): the
 * engine's own figures as it answered them, each said to be unreported where
 * it is absent. Nothing here is computed: no percent from the tokens, no price.
 */
function sessionLines(usage, failure) {
  if (failure !== null) return [`context unavailable: ${failure}`, `session cost unavailable: ${failure}`]
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const context = usage.context && typeof usage.context === 'object' ? usage.context : {}
  const [tokens, size, percent] = [num(context.tokens), num(context.window), num(context.percent)]
  let fill = 'context not reported'
  if (size !== null && tokens === null) fill = `context: window ${size} tokens · fill not yet reported`
  else if (size !== null) fill = `context ${tokens} of ${size} tokens${percent !== null ? ` · ${percent}% used` : ''}`
  const usd = usage.cost && typeof usage.cost === 'object' ? num(usage.cost.usd) : null
  const cost =
    usd === null
      ? 'session cost not reported by this host'
      : `session cost $${usd.toFixed(4)} · the engine's total for this session, not the run's`
  return [fill, cost]
}

/**
 * `last activity <ISO>` or `last activity unknown`, then the quiet word while a
 * live run is quiet. The word is recomputed from the clock at each draw, so a
 * pane opened after the host stopped the interval still shows it (design D2, D5).
 */
async function lastActivityText($) {
  if (run.lastActivityAt === null) return 'last activity unknown'
  const at = new Date(run.lastActivityAt).toISOString()
  const word = run.phase === 'live' ? quietWord(quietMs(run.lastActivityAt, await clockNow($))) : null
  return `last activity ${at}${word ? ` · ${word}` : ''}`
}

/** One spawn as a flat row, as the section drew every spawn before the board. */
function flatRow(keyed, r) {
  const a = agentForSha(r.sha)
  const served = a && a.models.length ? a.models.join(', ') : '?'
  const state = a ? a.reason || 'running' : 'waiting'
  return keyed(
    `wave-row-${r.label}`,
    `${r.title} · ${r.kind || 'agent'} · routed ${r.model || '?'} · served ${served} · effort ${r.effort || '?'} · ${state}`
  )
}

/**
 * The overlay the renderer reads in place of a wave state, built from the
 * steps alone (design D6). The wave list is the summary's own, so the renderer
 * never falls back to ids for a count the module made disagree.
 */
function boardOverlay(plan) {
  return {
    waves: [...plan.waves, ...(plan.testWave ? [plan.testWave] : [])],
    cursor: run.cursor,
    completed: run.recorded.ok,
    failures: run.recorded.failed.map(id => ({ id, ...(run.failedAt.get(id) || waveAt(null, null)), error: null })),
    skippedVerifications: run.skips,
    unresolved: [],
    halt: run.halt
  }
}

/** What the host observed of each spawned lane: its served models and, once joined to its agent, its turn. */
function laneNotes() {
  const notes = {}
  for (const r of run.rows.values()) {
    const a = agentForSha(r.sha)
    const served = a && a.models.length ? a.models.join(', ') : '?'
    notes[r.label] = `served ${served}${a ? ` · ${a.reason || 'running'}` : ''}`
  }
  return notes
}

/** The pane key a board row is drawn under: a lane keeps the flat row's key (design D7). */
function boardKey(key) {
  if (key.startsWith('lane:')) return `wave-row-${key.slice('lane:'.length)}`
  if (key === 'header' || key === 'tail') return `wave-board-${key}`
  const [kind, ...rest] = key.split(':')
  return `${kind === 'wave' ? 'wave-block' : `wave-${kind}`}-${rest.join('-')}`
}

/** Colour only a state word the board printed: hue for ok/failed/current, dim for the rest. */
function stateProps(word) {
  if (word === 'ok') return { color: 'green' }
  if (word === 'failed') return { color: 'red' }
  if (word === 'current') return { color: 'yellow' }
  if (word === 'pending' || word === 'not reached' || word === 'not recorded' || word === 'per task') {
    return { dimColor: true }
  }
  return null
}

/** The width a card and the renderer share: the body, capped at the published default. */
function boardColumns(e) {
  const body = e.props && isInt(e.props.bodyColumns) && e.props.bodyColumns > 0
    ? e.props.bodyColumns
    : LIMITS.waveBoardDefaultColumns
  return body < LIMITS.waveBoardMinColumns ? body : Math.min(body, LIMITS.waveBoardDefaultColumns)
}

function waveTitleOf(row) {
  if (row.parts && typeof row.parts.title === 'string' && row.parts.title) return row.parts.title
  const text = row.text || ''
  if (!text.startsWith('┌─ ')) return text
  const rest = text.slice(3)
  const cut = rest.search(/ ─/)
  return (cut === -1 ? rest : rest.slice(0, cut)).trimEnd()
}

/** A lane's ids cell, as spans: each task's own state word coloured when its tasks disagree. */
function idSpans(Text, parts) {
  if (parts.state === 'per task' && Array.isArray(parts.tasks) && parts.tasks.length) {
    const spans = [' [']
    parts.tasks.forEach((task, i) => {
      if (i) spans.push(', ')
      if (!task.word) return spans.push(task.id)
      spans.push(`${task.id} `, h(Text, stateProps(task.word), task.word))
    })
    spans.push(']')
    return spans
  }
  return parts.ids ? [` [${parts.ids}]`] : []
}

/**
 * A lane in its card: the fixed cells as one Text, the gist wrapping beneath,
 * then the host's note, dim. The coloured words are spans nested in that one
 * Text, because a row of separate elements shrinks each into its own column
 * and breaks words apart once the line is wider than the card.
 */
function drawLane($, e, row) {
  const { Box, Text } = $.ui.resolve(e)
  const key = boardKey(row.key)
  const parts = row.parts
  if (!parts) return h(Box, { key }, h(Text, { wrap: 'truncate-end' }, row.text))
  const head = [parts.batch, parts.label, parts.model, parts.tier, parts.effort].filter(Boolean).join(' ')
  const line = [
    ...(parts.state ? [`${head} `, h(Text, stateProps(parts.state), parts.state)] : [head]),
    ...idSpans(Text, parts),
    ...(Array.isArray(parts.after) && parts.after.length ? [` ←${parts.after.join(',')}`] : [])
  ]
  const kids = [
    h(Text, { wrap: 'wrap' }, ...line),
    parts.gist ? h(Box, { key: `${key}-gist` }, h(Text, { wrap: 'wrap' }, parts.gist)) : null,
    parts.note ? h(Box, { key: `${key}-note` }, h(Text, { dimColor: true }, parts.note)) : null
  ].filter(Boolean)
  return h(Box, { key, flexDirection: 'column' }, ...kids)
}

function drawBoardCards($, e, board, width) {
  const { Box, Text } = $.ui.resolve(e)
  const keyed = (key, text, props) => h(Box, { key }, h(Text, props || null, text))
  const out = []
  let index = null
  let kids = null
  const flush = () => {
    if (index === null) return
    out.push(
      h(
        Box,
        {
          key: `wave-card-${index}`,
          flexDirection: 'column',
          borderStyle: 'single',
          borderDimColor: true,
          width,
          paddingLeft: 1,
          paddingRight: 1,
          marginBottom: 1
        },
        ...kids
      )
    )
    index = null
    kids = null
  }
  for (const row of board) {
    if (row.key.startsWith('wave:') && row.key.endsWith(':end')) continue
    if (row.key.startsWith('wave:')) {
      flush()
      index = row.key.slice('wave:'.length)
      kids = [h(Box, { key: boardKey(row.key) }, h(Text, { bold: true }, waveTitleOf(row)))]
      continue
    }
    if (row.key.startsWith('lane:')) {
      const lane = drawLane($, e, row)
      if (kids) kids.push(lane)
      else out.push(lane)
      continue
    }
    flush()
    out.push(keyed(boardKey(row.key), row.text, row.key === 'header' || row.key === 'tail' ? null : { wrap: 'truncate-end' }))
  }
  flush()
  return out
}

/**
 * The waves section (design D7, D8): the board once a plan summary has
 * crossed, one bordered card per wave at the body width capped at the board's
 * default, the rows between cards one truncating text each; then a flat
 * row for each spawn no planned lane carries. Before a summary, the flat rows,
 * beneath a spoken line once a batch was dispatched. Below the board's minimum
 * the renderer's spoken line stands in for it, and a renderer that throws is
 * named here and on the debug log. Everything drawn is the steps'.
 */
function drawWaves($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const keyed = (key, text, props) => h(Box, { key }, h(Text, props || null, text))
  const line = (key, text) => keyed(key, text, { wrap: 'truncate-end' })
  const rows = [...run.rows.values()]
  if (!run.plan) {
    if (!rows.length) return [h(Text, { dimColor: true }, NO_LANES_LINE)]
    const dispatched = run.dispatched !== null || rows.some(r => r.batch)
    return [...(dispatched ? [keyed('wave-board-unrelayed', UNRELAYED_LINE)] : []), ...rows.map(r => flatRow(keyed, r))]
  }
  const width = boardColumns(e)
  let board
  try {
    board = drawPlanBoardRows(run.plan, { columns: width, state: boardOverlay(run.plan), notes: laneNotes() })
  } catch (err) {
    $.ui.log(`interlock meter: ${BOARD_FAILED_LINE}: ${messageOf(err)}`, { to: 'debug' })
    return [keyed('wave-board-failed', BOARD_FAILED_LINE), ...rows.map(r => flatRow(keyed, r))]
  }
  // Every board ends in its tail; the renderer's spoken line for a narrow body
  // is one row without one, and the lanes are then drawn flat beneath it.
  const drawn = board.length > 0 && board[board.length - 1].key === 'tail'
  const planned = new Set(drawn ? board.filter(row => row.key.startsWith('lane:')).map(row => row.key.slice('lane:'.length)) : [])
  const body = drawn ? drawBoardCards($, e, board, width) : board.map(row => line(boardKey(row.key), row.text))
  return [...body, ...rows.filter(r => !planned.has(r.label)).map(r => flatRow(keyed, r))]
}

async function drawPane($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const keyed = (key, text, props) => h(Box, { key }, h(Text, props || null, text))
  const heading = text => h(Box, { marginTop: 1 }, h(Text, { bold: true }, text))
  if (run.phase === 'idle' && !run.summary) {
    // The guard runs in every session, so its line stands here too (design D5).
    return h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, NO_RUN_LINE), keyed('launch-guard', await launchGuardText($)))
  }

  const out = []
  out.push(h(Text, { bold: true }, `${run.change || 'ship run'}${run.runId ? ` · run ${run.runId}` : ''}`))
  out.push(keyed('action', `action: ${run.action || 'starting'}${run.phase === 'closed' ? ' (closed)' : ''}`))
  out.push(keyed('last-activity', await lastActivityText($)))
  out.push(h(Text, { dimColor: true }, RECORD_LINE))

  out.push(heading('waves'))
  out.push(...drawWaves($, e))

  out.push(heading('agents'))
  if (!run.agents.size) out.push(h(Text, { dimColor: true }, 'no agent has reported a request yet'))
  for (const a of run.agents.values()) {
    const lane = laneForAgent(a)
    const n = a.requests === 1 ? '1 request' : `${a.requests} requests`
    const done = a.reason ? `${a.reason}${a.durationMs !== null ? ` ${(a.durationMs / 1000).toFixed(1)}s` : ''}` : 'running'
    out.push(
      h(
        Box,
        { key: `agent-${a.id}`, flexDirection: 'column' },
        h(Box, null, h(Text, null, `${lane || 'lane unknown'} · ${a.id} · ${a.models.join(', ') || 'model not reported'} · ${done}`)),
        h(Box, null, h(Text, { dimColor: true }, `${n} · ${tokensText(a)}`))
      )
    )
  }

  // One plain read feeds the session lines and the plan windows; a breakdown
  // is never asked for, because only the plain call is free (design D4).
  let usage = null
  let failure = null
  try {
    usage = await $.session.usage()
    if (!usage || typeof usage !== 'object') throw new Error(`the usage answered ${String(usage)}`)
  } catch (err) {
    failure = messageOf(err)
  }
  const [contextLine, costLine] = sessionLines(usage, failure)
  out.push(heading('session'))
  out.push(keyed('session-context', contextLine))
  out.push(keyed('session-cost', costLine))

  out.push(heading('plan windows'))
  const windows = usage && Array.isArray(usage.rateLimits) ? usage.rateLimits : []
  if (failure !== null) out.push(h(Text, { dimColor: true }, `plan windows unavailable: ${failure}`))
  else if (!windows.length) out.push(h(Text, { dimColor: true }, 'none reported (off a subscription the session has none)'))
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue
    const kind = String(w.kind)
    out.push(keyed(`plan-window-${kind}`, `${kind} ${w.percentUsed}% used${w.resetsAt ? ` · resets ${w.resetsAt}` : ''}`))
  }

  out.push(heading('banners'))
  out.push(
    h(
      Box,
      { key: 'banners', flexDirection: 'column' },
      ...(run.banners.length ? run.banners.map(b => h(Text, null, b)) : [h(Text, { dimColor: true }, 'none so far')])
    )
  )

  out.push(heading('refusals'))
  const denials = guardDenialLine(run.guardDenials)
  if (denials) out.push(keyed('guard-denials', denials))
  out.push(keyed('launch-guard', await launchGuardText($)))

  if (run.summary) {
    out.push(heading('close summary'))
    out.push(h(Box, { key: 'summary', flexDirection: 'column' }, h(Text, null, run.summary)))
  }
  return h(Box, { flexDirection: 'column' }, ...out)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    session = { interactive: e.isInteractive === true, surface: e.surface || null, cwd: str(e.cwd) }
    stopTick()
    run = freshRun()
    start = freshStart()
    spec = freshSpec()
    try {
      await $.command.register({
        name: PANE,
        description: 'Open the Interlock ship meter: the live run, its waves, agents, plan windows and banners',
        immediate: true
      })
    } catch (err) {
      $.ui.log(`interlock meter: /interlock-meter not registered: ${(err && err.message) || err}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: PREFLIGHT_PANE,
        description: "Open this session start's Interlock preflight: the doctor's checks, interrupted runs and halt resume cards",
        immediate: true
      })
    } catch (err) {
      $.ui.log(`interlock meter: /${PREFLIGHT_PANE} not registered: ${messageOf(err)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: HANDOFF_PANE,
        description: 'Open the halt resume cards of open changes, as the session-start preflight listed them',
        immediate: true
      })
    } catch (err) {
      $.ui.log(`interlock meter: /${HANDOFF_PANE} not registered: ${messageOf(err)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: SPEC_PANE,
        description: 'Open the Interlock spec meter: the live /interlock:spec run, its artifact ladder, gates and writes',
        immediate: true
      })
    } catch (err) {
      $.ui.log(`interlock meter: /${SPEC_PANE} not registered: ${messageOf(err)}`, { to: 'debug' })
    }
    let version = 'unknown'
    try {
      version = (await $.session.version()).version || 'unknown'
    } catch {
      version = 'unknown'
    }
    if (session.interactive) {
      $.ui.log(`interlock meter: engine ${version}, drawing on ${session.surface || 'an unnamed surface'}`, { to: 'transcript' })
    } else {
      $.ui.log(`interlock meter: engine ${version}, nothing draws here`, { to: 'debug' })
    }
    return next(e)
  })

  // A human prompt re-arms the next ship launch; nothing else does (design D3).
  // It is also the one event that reaches the module after the session start's
  // preflight wrote its report, so the report is read here (show-preflight-and-
  // interrupted-runs-at-session-start design D5). The prompt is passed on as it
  // came: never rewritten, never dropped. A typed `/interlock:spec` starts the
  // spec meter's run, read off the prompt's first word before it is passed on,
  // since the turn it starts runs inside the hand-on (observe-the-spec-run-live
  // design D1).
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin && typeof e.origin.kind === 'string' ? e.origin.kind : 'unstamped'
    if (HUMAN_ORIGINS.has(kind)) {
      await changeRecord($, 'human prompt', withPrompt)
      if (session.interactive) await readPreflight($, session.cwd)
    } else $.ui.log(`${GUARD}: a ${kind} prompt is not a human prompt; not counted`, { to: 'debug' })
    if (session.interactive) await observeLoad($, promptSkill(e.text))
    return next(e)
  })

  // A relayed task notification, named and passed on, never consumed. The
  // completion wake of a run does not come this way (it is a prompt above).
  on('session.receive', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    $.ui.log(`${GUARD}: a task-notification delivery is not a human prompt; passed on, not counted`, { to: 'debug' })
    return next(e)
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    // The launch guard, in every session: a ship launch with no human prompt
    // since this session's last is refused, in the rule's words, before the
    // engine or the settings layer sees it (design D3, D4).
    const { record, now } = await guardFacts($)
    const launch = isShipLaunch(e, record)
    const verdict = decideLaunch(record, now)
    // The refusal is spoken to the person in the same words the model reads (design D5).
    if (launch && session.interactive && verdict.reason) $.ui.toast(verdict.reason)
    if (launch && verdict.decision === 'deny') return { deny: verdict.reason }
    const r = await next(e)
    // The settings form's refusal, read off the result: a relaunch comes after its run closed (design D4).
    if (session.interactive) speakRefusal($, r)
    const accepted = launch && r.isError !== true && isAcceptedLaunch(r.result)
    if (accepted) {
      await changeRecord($, 'ship launch', (current, at) =>
        withLaunch(current, {
          at,
          runId: str(r.result.runId),
          workflowName: str(r.result.workflowName),
          scriptPath: str(r.result.scriptPath)
        })
      )
    }

    // The meter: an accepted ship launch makes the run live, its first activity
    // at the time the guard read (design D1), and starts its interval.
    if (!session.interactive || !accepted) return r
    // The spec run ends before the ship run is live, so the one status line
    // passes from one to the other with no second writer (observe-the-spec-run-live design D7).
    const handing = spec.phase === 'live' || spec.phase === 'checkpoint'
    if (handing) {
      spec.phase = 'handed-over'
      spec.handedOver = true
      spec.handedOverAt = now
    }
    stopTick()
    run = freshRun()
    const launched = run
    run.phase = 'live'
    if (handing) setStatus($)
    run.runId = str(r.result.runId)
    run.workflowName = str(r.result.workflowName)
    run.transcriptDir = str(r.result.transcriptDir)
    run.lastActivityAt = now
    $.ui.invalidate('ui.render')
    const placed = await openPane($)
    if (!placed || placed.isPlaced !== true) $.ui.toast(UNPLACED_TOAST)
    if (run === launched) startTick($)
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!session.interactive) return next(e)
    const command = typeof e.command === 'string' ? e.command : ''
    const driver = DRIVER_LINE.test(command)
    // The spec flow's keyed lines, read only while a spec run is live (observe-the-spec-run-live design D3).
    const lines = specLines(command)
    const reader = lines.length ? specReader($, lines) : null
    if (!watching()) {
      if (!reader) return driver ? idleStep($, e, next) : next(e)
      const r = await next(e)
      if (driver) noteIdleStep($, r)
      await applySpecLines($, reader, lines, r)
      return r
    }
    const held = run
    const r = await next(e)
    // Any Bash call during the run is read for a guard's refusal (guard-commit); only a driver line for a step.
    if (held === run) speakRefusal($, r)
    if (driver) {
      try {
        const { record, problem } = readRecord(r.text)
        if (!record) $.ui.log(`interlock meter: ${command.slice(0, 80)}: not a step record (${problem})`, { to: 'debug' })
        else if (held === run) await applyRecord($, record)
        else if (run.phase === 'idle' && !run.idleStepNamed) nameIdleStep($)
      } catch (err) {
        $.ui.log(`interlock meter: step read failed: ${(err && err.message) || err}`, { to: 'debug' })
      }
    }
    if (reader) await applySpecLines($, reader, lines, r)
    return r
  })

  // A Skill tool load, observed after the engine resolved it and returned as
  // it came: the spec skill starts the spec meter's run (observe-the-spec-run-live design D1).
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (!session.interactive) return next(e)
    const r = await next(e)
    if (!(r && r.isError === true)) await observeLoad($, e.skill)
    return r
  })

  // The tools the manifest's `Edit|Write` matcher names for guard-tests and guard-tasks (design D4).
  on('tool.call', { tool: 'Edit' }, editCall)
  on('tool.call', { tool: 'Write' }, editCall)

  on('turn.step', async function* ($, e, next) {
    if (!session.interactive || run.phase !== 'live' || !e.agentId) return yield* next(e)
    // A run agent's request starting, and its answer arriving, are each activity (design D1).
    if (await stamp($)) redrawWord($)
    const result = yield* next(e)
    if (await stamp($)) redrawWord($)
    try {
      addUsage(agentOf(e.agentId), result ? result.usage : null)
      $.ui.invalidate('ui.render')
    } catch {
      // A tally that cannot be kept is a figure the pane does not show; the step is the engine's.
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (session.interactive && run.phase === 'live' && e.agentId) {
      const a = agentOf(e.agentId)
      a.reason = str(e.reason)
      a.durationMs = typeof e.durationMs === 'number' ? e.durationMs : null
      // A turn the host ended without an answer is spoken once, in the host's
      // own word: no cause, no verdict. The close summary stays the record
      // (speak-lane-turn-ends-and-session-cost design D1-D3).
      if (a.reason && a.reason !== 'answer' && !a.endToasted) {
        a.endToasted = true
        const row = rowForAgent(a)
        try {
          $.ui.toast(`${row ? row.title : 'lane unknown'} · agent ${a.id} · turn ended: ${a.reason}`)
        } catch (err) {
          $.ui.log(`interlock meter: the turn-end toast for ${a.id} was refused: ${messageOf(err)}`, { to: 'debug' })
        }
      }
      if (await stamp($)) redrawWord($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Pass the spawn on unchanged. The three parameter names are plain identifiers
  // and are not bound anywhere else in this file, so the value given to the
  // next handler is the event parameter. permissionMode is left as the parent
  // set it. The meter reads the chain's result and returns that same result.
  on('agent.spawn', async (meterSpawnApi, meterSpawnInput, meterSpawnForward) => {
    return meterSpawnForward(meterSpawnInput).then(spawned => noteSpawn(meterSpawnApi, meterSpawnInput, spawned))
  })

  // The session boundary (design D4). /clear, /resume and /branch start the
  // session over: the engine empties `$.state`, the launch guard's record with
  // it, and `session.start` does not fire. The meter ends the run it holds on
  // the same event. A compaction is the same session and the same run, and a
  // source this cannot read changes nothing. The pane is left open: it redraws
  // to the no-run text, which is true, and the person dismisses it. Once the
  // settings hooks beneath have run, the preflight's report is read for every
  // source (show-preflight-and-interrupted-runs-at-session-start design D5).
  // The kit raises this event; Claude Code 2.1.291 raises no classic event to
  // a module, so there the prompt hook above reads the report instead.
  //
  // Pass the event on unchanged. The value this hook returns is the forward
  // itself: no first message, no permission decision. The meter's reset runs
  // before that chain and the preflight read after it; neither becomes the return.
  on('classic.SessionStart', async (meterSessionApi, meterSessionInput, meterSessionForward) => {
    endRunAtBoundary(meterSessionApi, meterSessionInput)
    const sessionForwarded = meterSessionForward(meterSessionInput)
    await sessionForwarded.then(() => readPreflightAfterStart(meterSessionApi, meterSessionInput))
    return sessionForwarded
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (!session.interactive || run.phase !== 'live') return next(e)
    const suffix = shown()
    return suffix ? next({ ...e, props: { ...e.props, suffix } }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))

  on('ui.render', { component: 'AbovePrompt' }, drawBand)

  on('ui.render', { component: 'Pane', requestId: PREFLIGHT_PANE }, async ($, e) => drawPreflightPane($, e))

  on('ui.render', { component: 'Pane', requestId: HANDOFF_PANE }, async ($, e) => drawHandoffPane($, e))

  on('ui.render', { component: 'Pane', requestId: SPEC_PANE }, async ($, e) => drawSpecPane($, e))

  on('command.run', { command: PANE }, async paneHost => {
    await openPane(paneHost)
    return {}
  })

  // Typed before any prompt, the command reads the report itself, so it never
  // opens on a report no prompt has fetched yet (design D5).
  on('command.run', { command: PREFLIGHT_PANE }, async preflightHost => {
    if (session.interactive) await readPreflight(preflightHost, session.cwd)
    await openPane(preflightHost, PREFLIGHT_PANE, 'Interlock preflight')
    return {}
  })

  on('command.run', { command: HANDOFF_PANE }, async handoffHost => {
    if (session.interactive) await readPreflight(handoffHost, session.cwd)
    await openPane(handoffHost, HANDOFF_PANE, 'Interlock handoff')
    return {}
  })

  on('command.run', { command: SPEC_PANE }, async specCmdHost => {
    await openPane(specCmdHost, SPEC_PANE, SPEC_TITLE)
    return {}
  })
}
