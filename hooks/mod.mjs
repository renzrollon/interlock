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

import { decideLaunch, emptyRecord, isAcceptedLaunch, isShipLaunch, withLaunch, withPrompt } from '../lib/launch-rule.mjs'
import { TICK_MS, quietMs, quietWord } from '../lib/meter-quiet.mjs'

const PANE = 'interlock-meter'
const TITLE = 'Interlock'
const RECORD_LINE = 'live figures; the close summary and the receipt are the record'
const NO_RUN_LINE = 'no ship run is live in this session'
const UNPLACED_TOAST = '/interlock-meter opens the ship meter'

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

let session = { interactive: false, surface: null }
let run = freshRun()
// Counts every interval this environment started, so a period can tell its own (design D2).
let generations = 0

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
    idleStepNamed: false
  }
}

const watching = () => session.interactive && (run.phase === 'live' || run.phase === 'closing')
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
  if (run.phase === 'live') $.ui.status(statusText())
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
  try {
    if (readRecord(r.text).record && run.phase === 'idle' && !run.idleStepNamed) nameIdleStep($)
  } catch {
    // Reading the result is all this does; the call and its result are the engine's.
  }
  return r
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
    a = { id, requests: 0, known: 0, partial: false, sums: null, models: [], reason: null, durationMs: null, sha: null }
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
      sha: str(s.promptSha256)
    })
  }
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
    $.ui.status(undefined)
  } else if (record.action === 'close' || record.action === 'halt') {
    run.phase = 'closing'
    stopTick()
    $.ui.status(undefined)
  } else {
    $.ui.status(statusText())
  }
  $.ui.invalidate('ui.render')
}

async function openPane($) {
  return $.ui.open({ id: PANE, title: TITLE, closeOnEscape: true })
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

function laneForAgent(a) {
  if (!a.sha) return null
  for (const r of run.rows.values()) if (r.sha === a.sha) return r.label
  return null
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

async function drawPane($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const keyed = (key, text, props) => h(Box, { key }, h(Text, props || null, text))
  if (run.phase === 'idle' && !run.summary) {
    return h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, NO_RUN_LINE))
  }

  const out = []
  out.push(h(Text, { bold: true }, `${run.change || 'ship run'}${run.runId ? ` · run ${run.runId}` : ''}`))
  out.push(keyed('action', `action: ${run.action || 'starting'}${run.phase === 'closed' ? ' (closed)' : ''}`))
  out.push(keyed('last-activity', await lastActivityText($)))
  out.push(h(Text, { dimColor: true }, RECORD_LINE))

  out.push(h(Text, { bold: true }, 'waves'))
  if (!run.rows.size) out.push(h(Text, { dimColor: true }, 'no lanes dispatched yet'))
  for (const r of run.rows.values()) {
    const a = agentForSha(r.sha)
    const served = a && a.models.length ? a.models.join(', ') : '?'
    const state = a ? a.reason || 'running' : 'waiting'
    out.push(
      keyed(
        `wave-row-${r.label}`,
        `${r.title} · ${r.kind || 'agent'} · routed ${r.model || '?'} · served ${served} · effort ${r.effort || '?'} · ${state}`
      )
    )
  }

  out.push(h(Text, { bold: true }, 'agents'))
  if (!run.agents.size) out.push(h(Text, { dimColor: true }, 'no agent has reported a request yet'))
  for (const a of run.agents.values()) {
    const lane = laneForAgent(a)
    const n = a.requests === 1 ? '1 request' : `${a.requests} requests`
    const done = a.reason ? `${a.reason}${a.durationMs !== null ? ` ${(a.durationMs / 1000).toFixed(1)}s` : ''}` : 'running'
    out.push(
      keyed(
        `agent-${a.id}`,
        `${lane || 'lane unknown'} · ${a.id} · ${a.models.join(', ') || 'model not reported'} · ${n} · ${tokensText(a)} · ${done}`
      )
    )
  }

  out.push(h(Text, { bold: true }, 'plan windows'))
  let windows = []
  try {
    const usage = await $.session.usage()
    windows = usage && Array.isArray(usage.rateLimits) ? usage.rateLimits : []
  } catch {
    windows = []
  }
  if (!windows.length) out.push(h(Text, { dimColor: true }, 'none reported (off a subscription the session has none)'))
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue
    const kind = String(w.kind)
    out.push(keyed(`plan-window-${kind}`, `${kind} ${w.percentUsed}% used${w.resetsAt ? ` · resets ${w.resetsAt}` : ''}`))
  }

  out.push(h(Text, { bold: true }, 'banners'))
  out.push(
    h(
      Box,
      { key: 'banners', flexDirection: 'column' },
      ...(run.banners.length ? run.banners.map(b => h(Text, null, b)) : [h(Text, { dimColor: true }, 'none so far')])
    )
  )

  if (run.summary) {
    out.push(h(Text, { bold: true }, 'close summary'))
    out.push(h(Box, { key: 'summary', flexDirection: 'column' }, h(Text, null, run.summary)))
  }
  return h(Box, { flexDirection: 'column' }, ...out)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    session = { interactive: e.isInteractive === true, surface: e.surface || null }
    stopTick()
    run = freshRun()
    try {
      await $.command.register({
        name: PANE,
        description: 'Open the Interlock ship meter: the live run, its waves, agents, plan windows and banners',
        immediate: true
      })
    } catch (err) {
      $.ui.log(`interlock meter: /interlock-meter not registered: ${(err && err.message) || err}`, { to: 'debug' })
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
  // The prompt is passed on as it came: never rewritten, never dropped.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin && typeof e.origin.kind === 'string' ? e.origin.kind : 'unstamped'
    if (HUMAN_ORIGINS.has(kind)) await changeRecord($, 'human prompt', withPrompt)
    else $.ui.log(`${GUARD}: a ${kind} prompt is not a human prompt; not counted`, { to: 'debug' })
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
    if (launch && verdict.decision === 'deny') return { deny: verdict.reason }
    const r = await next(e)
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
    stopTick()
    run = freshRun()
    const launched = run
    run.phase = 'live'
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
    if (!session.interactive || typeof e.command !== 'string' || !DRIVER_LINE.test(e.command)) return next(e)
    if (!watching()) return idleStep($, e, next)
    const held = run
    const r = await next(e)
    try {
      const { record, problem } = readRecord(r.text)
      if (!record) $.ui.log(`interlock meter: ${e.command.slice(0, 80)}: not a step record (${problem})`, { to: 'debug' })
      else if (held === run) await applyRecord($, record)
      else if (run.phase === 'idle' && !run.idleStepNamed) nameIdleStep($)
    } catch (err) {
      $.ui.log(`interlock meter: step read failed: ${(err && err.message) || err}`, { to: 'debug' })
    }
    return r
  })

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
      if (await stamp($)) redrawWord($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (session.interactive && run.phase === 'live') {
      if (r && str(r.agentId) && typeof e.prompt === 'string') {
        const found = [...e.prompt.matchAll(BRIEFING_SHA)]
        if (found.length) agentOf(r.agentId).sha = found[found.length - 1][1]
      }
      if (await stamp($)) redrawWord($)
    }
    return r
  })

  // The session boundary (design D4). /clear, /resume and /branch start the
  // session over: the engine empties `$.state`, the launch guard's record with
  // it, and `session.start` does not fire. The meter ends the run it holds on
  // the same event. A compaction is the same session and the same run, and a
  // source this cannot read changes nothing. The pane is left open: it redraws
  // to the no-run text, which is true, and the person dismisses it.
  on('classic.SessionStart', async ($, e, next) => {
    if (!session.interactive) return next(e)
    try {
      const boundary = BOUNDARIES.get(e.source)
      if (boundary) {
        const ended = run
        stopTick()
        run = freshRun()
        $.ui.status(undefined)
        $.ui.invalidate('ui.render')
        const what = ended.phase === 'idle' ? 'no run was held' : `run ${ended.runId || '(no id)'} is no longer drawn`
        $.ui.log(`interlock meter: ${boundary} started the session over; ${what}`, { to: 'debug' })
      }
    } catch (err) {
      $.ui.log(`interlock meter: the session boundary was not applied: ${messageOf(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (!session.interactive || run.phase !== 'live') return next(e)
    const suffix = shown()
    return suffix ? next({ ...e, props: { ...e.props, suffix } }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))

  on('command.run', { command: PANE }, async $ => {
    await openPane($)
    return {}
  })
}
