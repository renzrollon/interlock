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
// The meter's state is module-level (design D3): a reload starts it over, and
// the next step that crosses the module carries the change and the wave again.
// The guard's record is the session's (`$.state`, declared in
// types/index.d.ts): it survives a reload, and /clear, /resume and /branch
// empty it, which allows the next launch.

import { decideLaunch, emptyRecord, isAcceptedLaunch, isShipLaunch, withLaunch, withPrompt } from '../lib/launch-rule.mjs'

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

let session = { interactive: false, surface: null }
let run = freshRun()

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
    exitCode: null
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
    return { record: emptyRecord(), now: 0 }
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

function applyRecord($, record) {
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
    $.ui.status(undefined)
  } else if (record.action === 'close' || record.action === 'halt') {
    run.phase = 'closing'
    $.ui.status(undefined)
  } else {
    $.ui.status(`interlock: ${position()}`)
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

async function drawPane($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const keyed = (key, text, props) => h(Box, { key }, h(Text, props || null, text))
  if (run.phase === 'idle' && !run.summary) {
    return h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, NO_RUN_LINE))
  }

  const out = []
  out.push(h(Text, { bold: true }, `${run.change || 'ship run'}${run.runId ? ` · run ${run.runId}` : ''}`))
  out.push(keyed('action', `action: ${run.action || 'starting'}${run.phase === 'closed' ? ' (closed)' : ''}`))
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

    // The meter: an accepted ship launch makes the run live.
    if (!session.interactive || !accepted) return r
    run = freshRun()
    run.phase = 'live'
    run.runId = str(r.result.runId)
    run.workflowName = str(r.result.workflowName)
    run.transcriptDir = str(r.result.transcriptDir)
    $.ui.invalidate('ui.render')
    const placed = await openPane($)
    if (!placed || placed.isPlaced !== true) $.ui.toast(UNPLACED_TOAST)
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!watching() || typeof e.command !== 'string' || !DRIVER_LINE.test(e.command)) return next(e)
    const r = await next(e)
    try {
      const { record, problem } = readRecord(r.text)
      if (record) applyRecord($, record)
      else $.ui.log(`interlock meter: ${e.command.slice(0, 80)}: not a step record (${problem})`, { to: 'debug' })
    } catch (err) {
      $.ui.log(`interlock meter: step read failed: ${(err && err.message) || err}`, { to: 'debug' })
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    if (!session.interactive || run.phase !== 'live' || !e.agentId) return yield* next(e)
    const result = yield* next(e)
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
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (session.interactive && run.phase === 'live' && r && str(r.agentId) && typeof e.prompt === 'string') {
      const found = [...e.prompt.matchAll(BRIEFING_SHA)]
      if (found.length) agentOf(r.agentId).sha = found[found.length - 1][1]
    }
    return r
  })

  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (!session.interactive || run.phase !== 'live') return next(e)
    const suffix = position()
    return suffix ? next({ ...e, props: { ...e.props, suffix } }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))

  on('command.run', { command: PANE }, async $ => {
    await openPane($)
    return {}
  })
}
