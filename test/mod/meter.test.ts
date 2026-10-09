// The ship meter under the engine's own test kit (`claude plugin test .`).
//
// The one `.test.ts` in the repository: `npm test` collects `*.test.mjs` only
// (pinned in test/spine/mod-pins.test.mjs), and this file runs where the hooks
// module runs, with the engine's `$`. The test's own `on` hooks sit beneath the
// plugin and stand for the engine: they answer each event the way a session
// would, and record the display calls the meter makes.
//
// The clock is the kit's mocked one (`mock.clock`), whose `advance` runs the
// meter's interval period by period; the clock-failure cases answer the clock
// themselves instead, since the kit takes one `clock.now` answer per test
// (show-quiet-time-and-reset-the-meter-on-clear design D6).

import { expect, mock, test } from 'claude-code/testing'

import { denyReason } from '../../lib/launch-rule.mjs'
import { drawPlanBoard, drawPlanBoardRows } from '../../lib/draw-plan.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { PALETTE } from '../../lib/meter-palette.mjs'
import { clockText, durationText, stampText } from '../../lib/meter-time.mjs'
import { denyText } from '../fixtures/mod/refusals.mjs'
import * as F from '../fixtures/mod/steps.mjs'

const PLUGIN = 'interlock'
const PANE = 'interlock-meter'
const SURFACES = ['terminal', 'desktop'] as const
const NEXT = 'interlock run next --results .claude/ship/results.json --json'
const CLOSE_CMD = "interlock run close --halt 'inter-wave verification failed twice' --json"
const T0 = Date.parse('2026-10-05T06:35:01.000Z')
const QUIET_WORD = `quiet ${Math.floor(LIMITS.meterQuietAfterMs / 60_000)} min`
const BATCH_POSITION = `${F.CHANGE} · run-batch · wave 2 · batch 1/2`
const IDLE_STEP = /a step crossed with no live run/
const CLOCK_LINE = /interlock meter: the clock cannot be read/
const BENEATH = { additionalContext: ['the stub beneath'] }
const SPINNER = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }
const UNMATCHED_LINE = 'unmatched: no briefing read or interlock line seen from this agent yet'
// What the engine's Read answers beneath the plugin. Built from the engine's
// type contract (`ToolCallInput = ToolCallEnvelope & AgentLoop`, Claude Code
// 2.1.289 `claude-code.d.ts`: `file_path` and the loop's `agentId`), not
// captured: a runtime probe of a Workflow agent's Read could not be run.
const readAnswer = (path: string) => ({
  result: { type: 'text', file: { filePath: path, content: 'briefing', numLines: 1, startLine: 1, totalLines: 1 } },
  text: '1\tbriefing'
})

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }
type World = {
  clock: ReturnType<typeof mock.clock> | null
  status: (string | undefined)[]
  toasts: string[]
  logs: { text: string; to: string }[]
  opens: string[]
  commands: string[]
  bash: Map<string, string>
  bashCalls: string[]
  usage: Map<string, Usage | null>
  // What the one `session.usage` stub answers; `null` refuses the read.
  sessionUsage: Record<string, unknown> | null
  usageArgs: unknown[]
  // The settings layer beneath: `<tool>:<file_path or command>` → the deny text it answers.
  denies: Map<string, string>
  // Bash commands whose run the engine reports as an error.
  bashErrors: Set<string>
  // Whether the settings layer refuses a Workflow launch (guard-relaunch's settings form).
  denyLaunch: boolean
}

const FIVE_HOUR = { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-05T23:00:00Z' }
const FIVE_HOUR_LINE = 'five_hour 42% used · resets 2026-10-05T23:00:00Z'
const USAGE_REFUSED = 'the usage cannot be read'

// The guards' own sentences, as hooks/guard-tests.mjs, hooks/guard-commit.mjs
// and lib/launch-rule.mjs build them for these calls.
const TESTS_REASON =
  'guard-tests: editing the test file lib/x.test.mjs is blocked during the remediation stage — ' +
  'a run making a failing check pass must fix the code under test, not weaken the check. ' +
  'If the test itself is wrong, stop the run and correct it outside remediation.'
const COMMIT_REASON =
  'guard-commit: `git commit` is blocked during the remediation stage of a ship run — commits are made ' +
  'only in the commit stage, by the commit step, as one feature-level commit. This is the ' +
  'deterministic form of the disable-model-invocation flag on skills/commit.'
const RELAUNCH_REASON = denyReason('2026-10-05T06:00:00.000Z')
const GUARD_NAMED = /guard-(tests|tasks|commit|relaunch)/

const count = (text: string | undefined, part: string) => (text ?? '').split(part).length - 1

const usage = (model: string, n: number): Usage => ({
  input_tokens: n,
  output_tokens: n * 2,
  cache_read_input_tokens: n * 3,
  cache_creation_input_tokens: n * 4,
  model
})

/** The engine beneath the plugin, recording every display call the meter makes. */
function world(on: any, { placed = true, clock = true }: { placed?: boolean; clock?: boolean } = {}): World {
  const w: World = {
    clock: clock ? mock.clock(on, { now: T0 }) : null,
    status: [],
    toasts: [],
    logs: [],
    opens: [],
    commands: [],
    bash: new Map(),
    bashCalls: [],
    usage: new Map(),
    sessionUsage: { startedAt: 0, context: {}, rateLimits: [FIVE_HOUR] },
    usageArgs: [],
    denies: new Map([
      ['Edit:lib/x.test.mjs', denyText(TESTS_REASON, 'Edit')],
      ['Bash:git commit -m x', denyText(COMMIT_REASON)]
    ]),
    bashErrors: new Set(),
    denyLaunch: false
  }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => BENEATH)
  // The spinner as the engine draws it: the word, then the suffix right after it.
  on('ui.render', { component: 'Spinner' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, `${e.props.word}${e.props.suffix}`)
  })
  on('session.version', () => ({ value: { version: '2.1.289', base: '2.1.289', builtAt: '2026-10-03T19:21:39Z' } }))
  // A `{ deny }` rejects the plugin's read, as the clock's does (design D7, probe 3).
  on('session.usage', (_$: any, e: any) => {
    w.usageArgs.push(e)
    return w.sessionUsage === null ? { deny: USAGE_REFUSED } : { value: w.sessionUsage }
  })
  on('command.register', (_$: any, e: any) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  // A call-shaped event's bottom answers `{ value }`, as the engine does.
  const done = { value: undefined }
  on('ui.status', (_$: any, e: any) => (w.status.push(e.text), done))
  on('ui.toast', (_$: any, e: any) => (w.toasts.push(e.text), done))
  on('ui.log', (_$: any, e: any) => (w.logs.push({ text: e.text, to: e.to }), done))
  on('ui.invalidate', () => done)
  on('ui.open', (_$: any, e: any) => {
    w.opens.push(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'unasked below the width floor' } }
  })
  on('tool.call', { tool: 'Workflow' }, (_$: any, e: any) =>
    e.name === 'refused'
      ? { result: { status: 'async_launched' }, isError: true, text: 'refused' }
      : {
          result: {
            status: 'async_launched',
            taskId: 'w1',
            taskType: 'local_workflow',
            runId: F.RUN_ID,
            workflowName: 'interlock:ship',
            transcriptDir: '/t/wf'
          }
        }
  )
  on('tool.call', { tool: 'Bash' }, (_$: any, e: any) => {
    w.bashCalls.push(e.command)
    const text = w.bash.get(e.command) ?? ''
    if (w.bashErrors.has(e.command)) return { result: `Error: ${text}`, text, isError: true }
    return { result: { stdout: text, stderr: '', interrupted: false }, text }
  })
  on('tool.call', { tool: 'Read' }, (_$: any, e: any) => readAnswer(e.file_path))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {}, text: 'ok' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }))
  // The settings layer, where the four guards run: a deny ends the call with
  // the errored result the module's `tool.call` hooks see (probe 2's text).
  on('classic.PreToolUse', (_$: any, e: any) => {
    if (e.tool === 'Workflow') return w.denyLaunch ? { deny: denyText(RELAUNCH_REASON, 'Workflow') } : {}
    const denied = w.denies.get(`${e.tool}:${e.file_path ?? e.command}`)
    return denied ? { deny: denied } : {}
  })
  on('turn.step', async function* (_$: any, e: any) {
    const key = `${e.agentId}:${e.index}`
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: w.usage.has(key) ? w.usage.get(key) : null
    }
  })
  on('turn.complete', (_$: any, e: any) => ({ turnId: e.turnId, text: '', reason: e.reason }))
  on('agent.spawn', (_$: any, e: any) => ({ model: 'claude-sonnet-5-5', agentId: e.description === 'lane-a' ? 'a1' : 'a9' }))
  return w
}

const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const launch = ($: any, input: Record<string, unknown> = { name: 'interlock:ship', args: { change: F.CHANGE } }) =>
  $.tool.call({ tool: 'Workflow', ...input })
const bash = ($: any, w: World, command: string, text: string) => {
  w.bash.set(command, text)
  return $.tool.call({ tool: 'Bash', command })
}
/** A run agent's Bash call: the loop's id rides on the input, as `AgentLoop` declares it. */
const bashAs = ($: any, w: World, agentId: string, command: string, text = '') => {
  w.bash.set(command, text)
  return $.tool.call({ tool: 'Bash', command, agentId })
}
/** A run agent's Read of `file_path`. */
const readAs = ($: any, agentId: string, file_path: string) => $.tool.call({ tool: 'Read', file_path, agentId })
async function step($: any, agentId: string, index: number, model: string) {
  const s = $.turn.step({ turnId: `t-${agentId}`, index, model, messageCount: 3, agentId })
  // The answer is the stream's own return value: the 2.1.289 kit's stream
  // carries no `result`, though the declaration names one.
  let n = await s.next()
  while (!n.done) n = await s.next()
  return n.value
}
const complete = ($: any, agentId: string, reason = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 4200, isAborted: false, turnId: `t-${agentId}`, agentId, reason })
/**
 * A clock the test answers itself: the first `answers` reads tell T0 and every
 * later one is refused, which rejects the plugin's read; each interval period
 * waits until the test lets it through with `period()`.
 */
function ownClock(on: any, answers: number) {
  const c = { reads: 0, periods: [] as (() => void)[], period: async () => {} }
  on('clock.now', () => (++c.reads <= answers ? { value: T0 } : { deny: 'the clock is gone' }))
  on('clock.every', () => new Promise(resolve => c.periods.push(() => resolve({ value: undefined }))))
  c.period = async () => {
    c.periods.shift()?.()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return c
}
const lastActivity = async (ui: any) => (await ui.find({ key: 'last-activity' }))?.text
/** An agent's timeline line without its gutter: its first line, then its requests and tokens. */
const agentRow = async (ui: any, id: string) => textOf(contentOf(await ui.find({ key: `agent-${id}` })))
/**
 * The header's third line for a run launched at `started` whose last activity
 * was `at`, in the local time the module draws: computed with the lib's own
 * helpers over the kit's clock readings, so the case holds in any time zone.
 */
const activityLine = (started: number | null, at: number | null) =>
  `${started === null ? '' : `started ${stampText(started)} · `}last activity ${at === null ? 'unknown' : clockText(at)}`
// How far a section body sits in beneath its heading (layout probe P3): the
// pane's body less this is the width the wave board is drawn at.
const SECTION_INDENT = 2
/** A timed line's two halves (layout probe P3): the gutter box, then the content box. */
const gutterOf = (el: any) => (Array.isArray(el?.children) ? el.children[0] : undefined)
const contentOf = (el: any) => (Array.isArray(el?.children) ? el.children[1] : undefined)
/** A keyed timed line's text without its gutter, and its gutter's text. */
const lineText = async (ui: any, key: string) => textOf(contentOf(await ui.find({ key })))
const gutterText = async (ui: any, key: string) => textOf(gutterOf(await ui.find({ key })))
const TIMELINE_KEY = /^(launch$|step-|agent-|spawn-|agents-unmatched|timeline-no-step$)/
/** The timeline's keyed lines, in the order drawn. */
async function timelineKeys(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  return boxes.map((b: any) => b.key).filter((key: unknown) => typeof key === 'string' && TIMELINE_KEY.test(key))
}
/** How many steps in a timed line's content sits: its padding over the indent. */
const depthOf = async (ui: any, key: string) => (contentOf(await ui.find({ key }))?.props?.paddingLeft ?? 0) / SECTION_INDENT
async function spinner($: any, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Spinner', props: SPINNER })
  const text = (await ui.find({ text: /^Sauteing/ }))?.text
  await ui.unmount()
  return text
}
// The section body is the board's published default wide unless a case names
// another width; both are `interlock limits`'s, never restated here.
const mount = ($: any, surface: (typeof SURFACES)[number], bodyColumns: number = LIMITS.waveBoardDefaultColumns + SECTION_INDENT) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Interlock', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
  })

function tree(el: any): any[] {
  if (!el) return []
  const kids = Array.isArray(el.children) ? el.children : []
  return [el, ...kids.flatMap(tree)]
}

test('session.start registers /interlock-meter beside the preflight\'s two and the spec meter\'s, and logs the engine it loaded in', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual([PANE, 'interlock-preflight', 'interlock-handoff', 'interlock-spec'])
  expect(w.logs.some(l => /2\.1\.289/.test(l.text) && /terminal/.test(l.text) && l.to === 'transcript')).toBe(true)
})

test('a non-interactive session registers the command and draws nothing for its life', async ($: any, on: any) => {
  const w = world(on)
  await start($, false)
  expect(w.commands).toEqual([PANE, 'interlock-preflight', 'interlock-handoff', 'interlock-spec'])
  expect(w.logs.every(l => l.to === 'debug')).toBe(true)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  await complete($, 'a1')
  await complete($, 'a2', 'error')
  expect(w.status).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.opens).toEqual([])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: /no ship run is live/ })).toBeDefined()
    expect(await ui.find({ key: 'agent-a1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('an accepted ship launch makes the run live; a non-ship script and a refused launch do not', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($, { scriptPath: '/elsewhere/workflows/other.js' })
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await launch($, { name: 'refused' })
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(w.status).toEqual([])
  expect(w.toasts).toEqual([])

  await launch($, { scriptPath: '/plugins/interlock/workflows/ship.js', args: {} })
  expect(w.opens).toEqual([PANE])
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: F.RUN_ID })).toBeDefined()
    await ui.unmount()
  }
})

test('a batch step sets the status line, toasts its banner once, and fills the wave table', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · run-batch · wave 2 · batch 1/2`)
  expect(w.toasts.filter(t => t === F.BANNER)).toHaveLength(1)

  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
  expect(w.toasts.filter(t => t === F.BANNER)).toHaveLength(1)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const row = await ui.find({ key: 'wave-row-lane-a' })
    expect(row?.text).toMatch(/lane-a/)
    expect(row?.text).toMatch(/sonnet/)
    expect(row?.text).toMatch(/low/)
    expect((await ui.find({ key: 'wave-row-lane-b' }))?.text).toMatch(/opus.*high/)
    expect(count((await ui.find({ key: 'banners' }))?.text, F.BANNER)).toBe(1)
    expect(await ui.find({ text: /live figures; the close summary and the receipt are the record/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a result that is not a step changes nothing and leaves one debug line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  const before = { status: [...w.status], toasts: [...w.toasts] }
  const debugBefore = w.logs.filter(l => l.to === 'debug').length
  await bash($, w, 'interlock run next --json', 'not json at all')
  await bash($, w, 'interlock run next --json ', JSON.stringify({ schema: 'x' }))
  expect(w.status).toEqual(before.status)
  expect(w.toasts).toEqual(before.toasts)
  expect(w.logs.filter(l => l.to === 'debug').length).toBe(debugBefore + 2)
  expect(w.logs.filter(l => l.to === 'transcript' && /not a step/.test(l.text))).toEqual([])
})

test('a Bash call that is not the driver line is passed through unread', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  const r = await bash($, w, 'npm test', F.stdout(F.RUN_BATCH))
  expect(r.text).toBe(F.stdout(F.RUN_BATCH))
  expect(w.status).toEqual([])
  expect(w.toasts).toEqual([])
})

test('per-agent figures tally separately, mark a missing usage partial, and list every model', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  w.usage.set('a1:1', usage('claude-sonnet-5-5', 20))
  w.usage.set('a2:0', usage('claude-opus-5-5', 7))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  await step($, 'a1', 1, 'claude-sonnet-5-5')
  await step($, 'a2', 0, 'claude-opus-5-5')
  await complete($, 'a2', 'answer')

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const a1 = await agentRow(ui, 'a1')
    const a2 = await agentRow(ui, 'a2')
    expect(a1).toMatch(/claude-sonnet-5-5/)
    expect(a1).toMatch(/in 30/)
    expect(a1).not.toMatch(/claude-opus-5-5/)
    expect(a2).toMatch(/claude-opus-5-5/)
    expect(a2).toMatch(/in 7\b/)
    expect(a2).toMatch(/answer/)
    expect(a2).toMatch(/4\.2s/)
    expect(a1.startsWith('unmatched agent · a1 · ')).toBe(true)
    expect(a2.startsWith('unmatched agent · a2 · ')).toBe(true)
    // No step names either agent: they form the trailing group, one step in beneath its dim head, first seen first.
    expect(await timelineKeys(ui)).toEqual(['launch', 'agents-unmatched-head', 'agent-a1', 'agent-a2', 'agents-unmatched', 'timeline-no-step'])
    expect(await lineText(ui, 'launch')).toBe('launch · interlock:ship')
    expect(await gutterText(ui, 'launch')).toBe(clockText(T0))
    expect((await ui.find({ key: 'agents-unmatched-head' }))?.text).toBe('unmatched')
    expect(paintOf(await ui.find({ key: 'agents-unmatched-head' })).dimColor).toBe(true)
    for (const id of ['a1', 'a2']) {
      expect(await depthOf(ui, `agent-${id}`)).toBe(1)
      expect(await gutterText(ui, `agent-${id}`)).toBe(clockText(T0))
    }
    expect((await ui.find({ key: 'agents-unmatched' }))?.text).toBe(UNMATCHED_LINE)
    expect((await ui.find({ key: 'timeline-no-step' }))?.text).toBe('no step has crossed yet')
    await ui.unmount()
  }

  w.usage.set('a1:2', null)
  await step($, 'a1', 2, 'claude-sonnet-5-5')
  w.usage.set('a1:3', usage('claude-sonnet-4-5', 1))
  await step($, 'a1', 3, 'claude-sonnet-4-5')
  const ui = await mount($, 'terminal')
  const a1 = await agentRow(ui, 'a1')
  expect(a1).toMatch(/partial/)
  expect(a1).toMatch(/4 requests/)
  expect(a1).toMatch(/claude-sonnet-5-5/)
  expect(a1).toMatch(/claude-sonnet-4-5/)
  expect(a1).not.toMatch(/\b0\b/)
  expect(a1).not.toMatch(/substitut/i)
  await ui.unmount()
})

test('a spawn event joins its agent to the lane by briefing hash', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await $.agent.spawn({
    tool_use_id: 'u1',
    prompt: F.bootstrapPrompt(F.SHA_A),
    description: 'lane-a',
    subagentType: 'interlock:worker',
    provider: { plugin: 'engine', tier: 'core' }
  })
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'wave-row-lane-a' }))?.text).toMatch(/claude-sonnet-5-5/)
    expect((await ui.find({ key: 'agent-a1' }))?.text).toMatch(/lane-a/)
    await ui.unmount()
  }
})

test('the pane lists plan windows with no threshold text', async ($: any, on: any) => {
  world(on)
  await start($)
  await launch($)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const windows = await ui.find({ key: 'plan-window-five_hour' })
    expect(windows?.text).toMatch(/five_hour/)
    expect(windows?.text).toMatch(/42%/)
    expect(windows?.text).not.toMatch(/warn|limit|over|high/i)
    expect(windows?.props.color).toBeUndefined()
    for (const n of tree(windows)) expect(n.props?.color).toBeUndefined()
    await ui.unmount()
  }
})

test('an unasked open the engine declines raises exactly one toast naming the command', async ($: any, on: any) => {
  const w = world(on, { placed: false })
  await start($)
  await launch($)
  expect(w.opens).toEqual([PANE])
  expect(w.toasts.filter(t => t.includes('/interlock-meter'))).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
})

test('/interlock-meter opens the pane on request', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await $.command.run({ command: PANE, args: '' })
  expect(w.opens).toEqual([PANE])
})

test('a halt then the close clear the status line and leave the summary on the pane', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await bash($, w, NEXT, F.stdout(F.HALT))
  expect(w.status.at(-1)).toBeUndefined()
  expect(w.toasts.filter(t => t === F.SECOND_BANNER)).toHaveLength(1)
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  expect(w.status.at(-1)).toBeUndefined()
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: /resume card: \.claude\/handoff\/ship-add-the-thing-wf_6b71ef8e-ba7\.md/ })).toBeDefined()
    expect(count((await ui.find({ key: 'banners' }))?.text, F.SECOND_BANNER)).toBe(1)
    await ui.unmount()
  }
  const after = w.status.length
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(w.status.length).toBe(after)
})

test('a close step that carries its summary ends the run and shows it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await bash($, w, NEXT, F.stdout(F.CLOSE_STEP))
  expect(w.status.at(-1)).toBeUndefined()
  const ui = await mount($, 'desktop')
  expect(await ui.find({ text: `ship ${F.CHANGE}: complete` })).toBeDefined()
  await ui.unmount()
})

test('with nothing live the pane says so on both surfaces', async ($: any, on: any) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: 'no ship run is live in this session' })).toBeDefined()
    await ui.unmount()
  }
})

test('the quiet word comes at the cap on the status line, the spinner and the pane, and the next step clears it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))

  await w.clock!.advance(LIMITS.meterQuietAfterMs - 1)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${BATCH_POSITION}`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(activityLine(T0, T0))
    await ui.unmount()
  }

  await w.clock!.advance(1)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${BATCH_POSITION} · ${QUIET_WORD}`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(`${activityLine(T0, T0)} · ${QUIET_WORD}`)
    const windows = await ui.find({ key: 'plan-window-five_hour' })
    expect(windows?.text).not.toMatch(/quiet|warn|limit|over|high/i)
    expect(windows?.props.color).toBeUndefined()
    for (const n of tree(windows)) expect(n.props?.color).toBeUndefined()
    await ui.unmount()
  }

  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${F.CHANGE} · test-wave · wave 2`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(activityLine(T0, T0 + LIMITS.meterQuietAfterMs))
    await ui.unmount()
  }
})

test('a run agent\'s answer with no step between counts as activity; the lead session\'s own request does not', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await w.clock!.advance(LIMITS.meterQuietAfterMs)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)

  const lead = $.turn.step({ turnId: 't-lead', index: 0, model: 'claude-opus-5-5', messageCount: 3 })
  for await (const _ of lead) void _
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)

  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  const answered = await step($, 'a1', 0, 'claude-sonnet-5-5')
  expect(answered.usage).toEqual(usage('claude-sonnet-5-5', 10))
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  const ui = await mount($, 'terminal')
  expect(await lastActivity(ui)).toBe(activityLine(T0, T0 + LIMITS.meterQuietAfterMs))
  await ui.unmount()

  // A lane that keeps answering inside the threshold is never called quiet.
  await w.clock!.advance(LIMITS.meterQuietAfterMs - 1)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
})

test('a halt ends the interval: no word after the cap, and the close summary shows none', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await bash($, w, NEXT, F.stdout(F.HALT))
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  const after = w.status.length
  await w.clock!.advance(LIMITS.meterQuietAfterMs + LIMITS.meterTickMs)
  expect(w.status.length).toBe(after)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe('Sauteing…')
    const ui = await mount($, surface)
    expect(await ui.find({ text: /resume card: \.claude\/handoff\/ship-add-the-thing-wf_6b71ef8e-ba7\.md/ })).toBeDefined()
    expect(await ui.find({ text: /quiet/ })).toBeUndefined()
    await ui.unmount()
  }
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`a ${source} ends the run the meter holds, and a step after it is ignored and named once`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    await launch($)
    await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
    expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)

    expect(await $.classic.SessionStart({ source })).toEqual(BENEATH)
    expect(w.status.at(-1)).toBeUndefined()
    for (const surface of SURFACES) {
      expect(await spinner($, surface)).toBe('Sauteing…')
      const ui = await mount($, surface)
      expect(await ui.find({ text: 'no ship run is live in this session' })).toBeDefined()
      expect(await ui.find({ key: 'wave-row-lane-a' })).toBeUndefined()
      await ui.unmount()
    }

    const after = w.status.length
    const r = await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
    expect(r.text).toBe(F.stdout(F.RELAYED_TEST_WAVE))
    await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
    expect(w.status.length).toBe(after)
    expect(w.logs.filter(l => l.to === 'debug' && IDLE_STEP.test(l.text))).toHaveLength(1)

    // The interval ended with the run: the cap passes and nothing is drawn.
    await w.clock!.advance(LIMITS.meterQuietAfterMs + LIMITS.meterTickMs)
    expect(w.status.length).toBe(after)
  })
}

test('a compaction, a startup and a source the module cannot read leave the run as it was', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  const status = [...w.status]

  for (const input of [{ source: 'compact' }, { source: 'startup' }, {}, { source: 7 }]) {
    expect(await $.classic.SessionStart(input)).toEqual(BENEATH)
  }
  expect(w.status).toEqual(status)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await ui.find({ key: 'wave-row-lane-a' }))?.text).toMatch(/lane-a/)
    expect((await ui.find({ key: 'agent-a1' }))?.text).toMatch(/in 10\b/)
    await ui.unmount()
  }
  expect(w.logs.filter(l => IDLE_STEP.test(l.text))).toEqual([])

  // The interval still runs, and the next step is applied as before.
  await w.clock!.advance(LIMITS.meterQuietAfterMs)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)
  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
})

test('a clock that stops answering guesses nothing: the stamp stands, no word, one debug line', async ($: any, on: any) => {
  const w = world(on, { clock: false })
  const c = ownClock(on, 1)
  await start($)
  await launch($)
  expect(c.periods).toHaveLength(1)
  const r = await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(r.text).toBe(F.stdout(F.RUN_BATCH))
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  expect((await step($, 'a1', 0, 'claude-sonnet-5-5')).usage).toEqual(usage('claude-sonnet-5-5', 10))
  expect((await complete($, 'a1')).text).toBe('')
  await c.period()
  await c.period()
  expect(c.periods).toHaveLength(1)

  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  expect(w.status.some(t => /quiet/.test(t ?? ''))).toBe(false)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${BATCH_POSITION}`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(activityLine(T0, T0))
    // The launch read the clock; every later reading failed, so the step's and the agent's gutters are blank.
    expect(await gutterText(ui, 'launch')).toBe(clockText(T0))
    expect(await gutterText(ui, 'step-0')).toBe('')
    expect(await gutterText(ui, 'agent-a1')).toBe('')
    await ui.unmount()
  }
  expect(w.logs.filter(l => l.to === 'debug' && CLOCK_LINE.test(l.text))).toHaveLength(1)

  // The next step still lands on the status line: the module kept working.
  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
})

test('a run whose clock never answered says its last activity is unknown', async ($: any, on: any) => {
  const w = world(on, { clock: false })
  const c = ownClock(on, 0)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await c.period()
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe('last activity unknown')
    expect(await lastActivity(ui)).toBe(activityLine(null, null))
    expect(await ui.find({ text: /started/ })).toBeUndefined()
    // No reading at all: every gutter is blank and the lines are drawn all the same, in crossing order.
    expect(await timelineKeys(ui)).toEqual(['launch', 'step-0', 'spawn-0-lane-a', 'spawn-0-lane-b'])
    for (const key of ['launch', 'step-0', 'spawn-0-lane-a', 'spawn-0-lane-b']) expect(await gutterText(ui, key)).toBe('')
    expect(await lineText(ui, 'step-0')).toBe('run-batch · wave 2 · batch 1/2 · 2 in parallel')
    await ui.unmount()
  }
  expect(w.logs.filter(l => l.to === 'debug' && CLOCK_LINE.test(l.text))).toHaveLength(1)
})

test('a non-interactive session starts no interval', async ($: any, on: any) => {
  const w = world(on, { clock: false })
  const c = ownClock(on, 10)
  await start($, false)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(c.periods).toEqual([])
  expect(w.status).toEqual([])
})

// The turn-end toast (speak-lane-turn-ends-and-session-cost design D1-D3): the
// host's reason word, once per run agent, naming the lane's title or `unmatched agent`.
const TITLE_A = '1.1+5 · Add the turn-end toast'
const TITLED_BATCH = {
  ...F.RUN_BATCH,
  spawns: F.RUN_BATCH.spawns.map((s: any) => (s.label === 'lane-a' ? { ...s, title: TITLE_A } : s))
}
const turnEnds = (w: World) => w.toasts.filter(t => t.includes('turn ended'))
const spawnA = ($: any) =>
  $.agent.spawn({
    tool_use_id: 'u1',
    prompt: F.bootstrapPrompt(F.SHA_A),
    description: 'lane-a',
    subagentType: 'interlock:worker',
    provider: { plugin: 'engine', tier: 'core' }
  })

test('a run agent whose turn ends with error is named once, by its lane\'s title', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(TITLED_BATCH))
  expect(await spawnA($)).toEqual({ model: 'claude-sonnet-5-5', agentId: 'a1' })
  const before = w.toasts.length

  expect(await complete($, 'a1', 'error')).toEqual({ turnId: 't-a1', text: '', reason: 'error' })
  expect(w.toasts.slice(before)).toEqual([`${TITLE_A} · agent a1 · turn ended: error`])

  await complete($, 'a1', 'error')
  await complete($, 'a2', 'answer')
  expect(w.toasts).toHaveLength(before + 1)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const row = (await ui.find({ key: 'agent-a1' }))?.text ?? ''
    expect(row).toMatch(/error/)
    expect(row).toMatch(/4\.2s/)
    await ui.unmount()
  }
})

test('a turn the host stops for an agent nobody joined reads unmatched agent, with no cause beside it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await complete($, 'a1', 'aborted')
  expect(turnEnds(w)).toEqual(['unmatched agent · agent a1 · turn ended: aborted'])
})

test('each word the host sends is repeated verbatim; no reason, and no live run, raise nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await complete($, 'a6', 'error')
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  for (const [id, reason] of [['a1', 'refusal'], ['a2', 'aborted'], ['a3', 'error'], ['a4', 'cancelled']]) {
    await complete($, id, reason)
  }
  await $.turn.complete({ answer: '', durationMs: 4200, isAborted: false, turnId: 't-a5', agentId: 'a5' })
  expect(turnEnds(w)).toEqual([
    'unmatched agent · agent a1 · turn ended: refusal',
    'unmatched agent · agent a2 · turn ended: aborted',
    'unmatched agent · agent a3 · turn ended: error',
    'unmatched agent · agent a4 · turn ended: cancelled'
  ])

  await bash($, w, NEXT, F.stdout(F.HALT))
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  await complete($, 'a6', 'error')
  expect(turnEnds(w)).toHaveLength(4)
  expect(w.toasts.filter(t => t.includes('a5') || t.includes('a6'))).toEqual([])
  expect(turnEnds(w).filter(t => /warn|failed|stuck/i.test(t))).toEqual([])
})

// The session lines (design D4, D6): the engine's own figures, as answered.
const SESSION = { startedAt: 0, context: { tokens: 48210, window: 200000, percent: 24 }, rateLimits: [FIVE_HOUR], cost: { usd: 0.4321 } }
const sessionLine = async (ui: any, key: string) => (await ui.find({ key }))?.text ?? ''
const noBreakdown = (w: World) => {
  expect(w.usageArgs.length).toBeGreaterThan(0)
  expect(w.usageArgs.filter((a: any) => a && typeof a === 'object' && 'breakdown' in a)).toEqual([])
}

test('the pane shows the session\'s context and cost as the engine reports them, with no threshold', async ($: any, on: any) => {
  const w = world(on)
  w.sessionUsage = SESSION
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const context = await ui.find({ key: 'session-context' })
    const cost = await ui.find({ key: 'session-cost' })
    expect(context?.text).toMatch(/48210/)
    expect(context?.text).toMatch(/200000/)
    expect(context?.text).toMatch(/24%/)
    expect(cost?.text).toMatch(/\$0\.4321/)
    expect(cost?.text).toMatch(/this session, not the run's/)
    for (const line of [context, cost]) {
      expect(line?.text).not.toMatch(/warn|limit|over|high/i)
      expect(line?.props.color).toBeUndefined()
    }
    expect((await ui.find({ key: 'plan-window-five_hour' }))?.text).toBe(FIVE_HOUR_LINE)
    expect((await ui.find({ key: 'wave-row-lane-a' }))?.text).toMatch(/lane-a/)
    await ui.unmount()
  }
  noBreakdown(w)
})

test('a figure the host did not answer is said to be unreported, and no percent is computed', async ($: any, on: any) => {
  const w = world(on)
  w.sessionUsage = { startedAt: 0, context: { window: 200000 }, rateLimits: [FIVE_HOUR] }
  await start($)
  await launch($)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const context = await sessionLine(ui, 'session-context')
    expect(context).toMatch(/200000/)
    expect(context).toMatch(/fill not yet reported/)
    expect(context).not.toMatch(/%/)
    expect(await sessionLine(ui, 'session-cost')).toMatch(/not reported by this host/)
    await ui.unmount()
  }
  noBreakdown(w)
})

test('a usage read that fails is named with its reason on every line it feeds, and the rest is drawn', async ($: any, on: any) => {
  const w = world(on)
  w.sessionUsage = null
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const context = await sessionLine(ui, 'session-context')
    const cost = await sessionLine(ui, 'session-cost')
    expect(context).toMatch(/context unavailable/)
    expect(context).toMatch(new RegExp(USAGE_REFUSED))
    expect(cost).toMatch(/session cost unavailable/)
    expect(cost).toMatch(new RegExp(USAGE_REFUSED))
    expect((await ui.find({ text: /plan windows unavailable/ }))?.text).toMatch(new RegExp(USAGE_REFUSED))
    expect(await ui.find({ text: /off a subscription/ })).toBeUndefined()
    expect((await ui.find({ key: 'wave-row-lane-a' }))?.text).toMatch(/lane-a/)
    expect(await lastActivity(ui)).toBe(activityLine(T0, T0))
    expect(count((await ui.find({ key: 'banners' }))?.text, F.BANNER)).toBe(1)
    await ui.unmount()
  }
  noBreakdown(w)
})

test('after a halt and its close the session lines still read the engine\'s figures', async ($: any, on: any) => {
  const w = world(on)
  w.sessionUsage = SESSION
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await bash($, w, NEXT, F.stdout(F.HALT))
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: /resume card: \.claude\/handoff\/ship-add-the-thing-wf_6b71ef8e-ba7\.md/ })).toBeDefined()
    expect(await sessionLine(ui, 'session-context')).toMatch(/48210 of 200000 tokens · 24% used/)
    expect(await sessionLine(ui, 'session-cost')).toMatch(/\$0\.4321/)
    await ui.unmount()
  }
  noBreakdown(w)
})

// The guards' refusals (speak-permission-prompts-and-guard-denials design D4,
// D5): read off the errored result, toasted from the guard's name on, counted
// by guard, and every result returned as it resolved.
const editTest = ($: any) => $.tool.call({ tool: 'Edit', file_path: 'lib/x.test.mjs', old_string: 'a', new_string: 'b' })
const guardLine = async ($: any, surface: (typeof SURFACES)[number]) => {
  const ui = await mount($, surface)
  const text = (await ui.find({ key: 'guard-denials' }))?.text
  await ui.unmount()
  return text
}

test('a guard\'s denial is toasted once from its name on and counted by guard, and the result is the one that resolved', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  const before = w.toasts.length

  const edit = await editTest($)
  expect(edit.isError).toBe(true)
  expect(edit.text).toBe(denyText(TESTS_REASON, 'Edit'))
  const commit = await bash($, w, 'git commit -m x', '')
  expect(commit.isError).toBe(true)
  expect(commit.text).toBe(denyText(COMMIT_REASON))
  expect(w.bashCalls).not.toContain('git commit -m x')
  expect(w.toasts.slice(before)).toEqual([TESTS_REASON, COMMIT_REASON])
  for (const surface of SURFACES) {
    expect(await guardLine($, surface)).toBe('guard denials: 2 (guard-tests 1, guard-commit 1)')
  }

  // A driver line between two denials is still a step; the same text again is counted, not toasted.
  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
  const again = await editTest($)
  expect(again.text).toBe(denyText(TESTS_REASON, 'Edit'))
  expect(w.toasts.slice(before)).toEqual([TESTS_REASON, COMMIT_REASON])
  for (const surface of SURFACES) {
    expect(await guardLine($, surface)).toBe('guard denials: 3 (guard-tests 2, guard-commit 1)')
  }
})

test('an errored result naming no guard, a failed command and a clean write speak nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  const before = { toasts: w.toasts.length, logs: w.logs.length }

  w.denies.set('Edit:lib/other.mjs', 'another plugin said no')
  const other = await $.tool.call({ tool: 'Edit', file_path: 'lib/other.mjs', old_string: 'a', new_string: 'b' })
  expect(other.isError).toBe(true)
  expect(other.text).toBe('another plugin said no')
  w.bashErrors.add('false')
  const failed = await bash($, w, 'false', 'Exit code 1')
  expect(failed.isError).toBe(true)
  expect(failed.text).toBe('Exit code 1')
  const wrote = await $.tool.call({ tool: 'Write', file_path: 'lib/new.mjs', content: 'x' })
  expect(wrote.isError === true).toBe(false)
  expect(wrote.text).toBe('ok')

  expect(w.toasts.length).toBe(before.toasts)
  expect(w.logs.slice(before.logs).filter(l => GUARD_NAMED.test(l.text))).toEqual([])
  for (const surface of SURFACES) expect(await guardLine($, surface)).toBeUndefined()
})

for (const isInteractive of [false, true]) {
  const where = isInteractive ? 'an interactive session with no live run' : 'a non-interactive session'
  test(`in ${where} a guard's denial is returned as it resolved and spoken nowhere`, async ($: any, on: any) => {
    const w = world(on)
    await start($, isInteractive)
    if (!isInteractive) await launch($)
    const edit = await editTest($)
    expect(edit.isError).toBe(true)
    expect(edit.text).toBe(denyText(TESTS_REASON, 'Edit'))
    expect(w.toasts).toEqual([])
    expect(w.status).toEqual([])
    if (isInteractive) for (const surface of SURFACES) expect(await guardLine($, surface)).toBeUndefined()
  })
}

test('the settings form\'s relaunch refusal is toasted from guard-relaunch: on, and no run goes live', async ($: any, on: any) => {
  const w = world(on)
  w.denyLaunch = true
  await start($)
  const r = await launch($)
  expect(r.isError).toBe(true)
  expect(r.text).toBe(denyText(RELAUNCH_REASON, 'Workflow'))
  expect(w.toasts).toEqual([RELAUNCH_REASON])
  expect(w.opens).toEqual([])
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  expect(w.status).toEqual([])
})


// --- the wave board (draw-the-wave-board-in-the-meter-pane) ----------------
//
// The board is the renderer's, drawn from the relayed summary and an overlay
// the module builds from the steps alone (design D6, D7). Each case states the
// overlay the steps imply and draws the expected lines through the same
// renderer, so the pane can add no word of its own without failing here.

const UNRELAYED = 'plan structure not relayed by this CLI'
const BOX_DRAWING = /[┌│└─]/
const NARROW = LIMITS.waveBoardMinColumns - 1
const ADOPTED_LANES = ['1.7', '1.4', '1.2', '1.3', '1.6']
const RECORDED_OK = ['1.7', '1.4', '1.2', '1.3']

type Overlay = Record<string, unknown>
const positions = (plan: any) => [...plan.waves, ...(plan.testWave ? [plan.testWave] : [])]
/** The overlay a run's steps imply, in the wave state's shape (design D6). */
const overlay = (plan: any, over: Overlay = {}) => ({
  waves: positions(plan),
  cursor: null,
  completed: [],
  failures: [],
  skippedVerifications: [],
  unresolved: [],
  halt: null,
  ...over
})
/**
 * Each spawned lane's note: its served model unknown while no agent is joined
 * to it, and, for a lane named in `joined`, the note the host observed of its agent.
 */
const notesFor = (labels: string[], joined: Record<string, string> = {}) => ({
  ...Object.fromEntries(labels.map(label => [label, 'served ?'])),
  ...joined
})
const boardRows = (
  plan: any,
  state: Overlay,
  labels: string[],
  columns: number = LIMITS.waveBoardDefaultColumns,
  joined: Record<string, string> = {}
) => drawPlanBoardRows(plan, { columns, state, notes: notesFor(labels, joined) })
/** A flat row, as the section drew every spawn before the board. */
const flatRow = (s: any) =>
  `${s.title || s.label} · ${s.kind || 'agent'} · routed ${s.model || '?'} · served ? · effort ${s.effort || '?'} · waiting`

/** Every keyed box of the wave section, in the order drawn. */
async function waveSection(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  return boxes.filter((b: any) => typeof b.key === 'string' && b.key.startsWith('wave-'))
}
const texts = (section: any[]) => section.map((b: any) => b.text)

const STATE_COLOR: Record<string, string> = { ok: PALETTE.ok, failed: PALETTE.failed, current: PALETTE.current }
const STATE_DIM = new Set(['pending', 'not reached', 'not recorded', 'per task'])

function paintOf(el: any) {
  const text = tree(el).find((n: any) => n.type === 'Text')
  return text?.props || el?.props || {}
}

function expectStatePaint(el: any, word: string | null | undefined) {
  if (!word) return
  expect(el?.text ?? textOf(el)).toContain(word)
  const props = paintOf(el)
  if (STATE_COLOR[word]) {
    expect(props.color).toBe(STATE_COLOR[word])
    expect(props.dimColor).toBeUndefined()
  } else if (STATE_DIM.has(word)) {
    expect(props.dimColor).toBe(true)
    expect(props.color).toBeUndefined()
  }
}

/**
 * A lane's first line: one Text, never a row of elements, its coloured words
 * nested spans. The lane is a timed line with a blank gutter, its content one
 * step in beneath its batch's sub-header.
 */
function laneLine(el: any) {
  expect(textOf(gutterOf(el))).toBe('')
  const content = contentOf(el)
  expect(content?.props?.paddingLeft).toBe(SECTION_INDENT)
  const line = Array.isArray(content?.children) ? content.children[0] : undefined
  expect(line?.type).toBe('Text')
  return line
}
const spansOf = (line: any) => (Array.isArray(line?.children) ? line.children : []).filter((n: any) => n?.type === 'Text')
/** A nested node's text: the kit sets `text` on a found element, not on what it holds. */
const textOf = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n?.children) ? n.children.map(textOf).join('') : '')

/** A name span: bold, in the identity colour. */
function expectNamePaint(span: any, name: string) {
  expect(textOf(span)).toBe(name)
  expect(span?.props?.bold).toBe(true)
  expect(span?.props?.color).toBe(PALETTE.identity)
}

/** A lane line's spans after its label, the label checked first: the state word, then each task's. */
function wordSpans(line: any, label: string) {
  const spans = spansOf(line)
  expectNamePaint(spans[0], label)
  return spans.slice(1)
}

/** The state word a lane's line prints, read off the first span after its label. */
async function stateWord(ui: any, label: string) {
  return textOf(wordSpans(laneLine(await ui.find({ key: `wave-row-${label}` })), label)[0])
}

/** The wave positions whose card holds a lane at the cursor: a lane whose word, or a task's, is `current`. */
function currentCards(rows: any[]) {
  const held = new Set<string>()
  let at: string | null = null
  for (const row of rows) {
    if (row.key.startsWith('wave:') && !row.key.endsWith(':end')) at = row.key.slice('wave:'.length)
    else if (row.key.startsWith('wave:')) at = null
    else if (row.key.startsWith('lane:') && at !== null) {
      const p = row.parts
      if (p.state === 'current' || (Array.isArray(p.tasks) && p.tasks.some((t: any) => t.word === 'current'))) held.add(at)
    }
  }
  return held
}

async function expectBoard(
  ui: any,
  plan: any,
  state: Overlay,
  labels: string[],
  extra: any[] = [],
  width: number = LIMITS.waveBoardDefaultColumns,
  joined: Record<string, string> = {}
) {
  const rows = boardRows(plan, state, labels, width, joined)
  const current = currentCards(rows)
  expect((await ui.find({ key: 'wave-board-header' }))?.text).toBe(rows.find(r => r.key === 'header')?.text)
  expect((await ui.find({ key: 'wave-board-tail' }))?.text).toBe(rows.find(r => r.key === 'tail')?.text)
  for (const row of rows) {
    if (row.key.startsWith('verify:')) {
      expect((await ui.find({ key: `wave-verify-${row.key.slice('verify:'.length)}` }))?.text).toBe(row.text)
    }
    if (row.key.startsWith('wave:') && !row.key.endsWith(':end')) {
      const i = row.key.slice('wave:'.length)
      const card = await ui.find({ key: `wave-card-${i}` })
      expect(card).toBeDefined()
      expect(card.props.borderStyle).toBe('single')
      // The card holding the cursor is bordered in the current colour; every other border is dim.
      if (current.has(i)) {
        expect(card.props.borderColor).toBe(PALETTE.current)
        expect(card.props.borderDimColor).toBeUndefined()
      } else {
        expect(card.props.borderDimColor).toBe(true)
        expect(card.props.borderColor).toBeUndefined()
      }
      expect(card.props.width).toBe(width)
      const title = await ui.find({ key: `wave-block-${i}` })
      expect(title?.text).toBe(row.parts.title)
      for (const n of tree(title)) expect(n.props?.color).toBeUndefined()
      expect(await ui.find({ key: `wave-block-${i}-end` })).toBeUndefined()
    }
    if (!row.key.startsWith('lane:')) continue
    const p = row.parts
    const el = await ui.find({ key: `wave-row-${p.label}` })
    expect(el).toBeDefined()
    expect(el.text).toContain(p.label)
    expect(el.text).toContain(p.model)
    expect(el.text).toContain(p.tier)
    expect(el.text).toContain(p.effort)
    if (p.state) expect(el.text).toContain(p.state)
    if (p.gist) {
      const gist = await ui.find({ key: `wave-row-${p.label}-gist` })
      expect(gist?.text).toBe(p.gist)
      expect(paintOf(gist).wrap).toBe('wrap')
    }
    if (p.note) {
      expect(el.text).toContain(p.note)
      expect(paintOf(await ui.find({ key: `wave-row-${p.label}-note` })).dimColor).toBe(true)
    }
    expect(BOX_DRAWING.test(el.text)).toBe(false)
    const line = laneLine(el)
    expect(line.props?.wrap).toBe('wrap')
    for (const n of tree(line)) if (n !== line && typeof n !== 'string') expect(n.type).toBe('Text')
    // The fixed cells read exactly as the board printed them, the label a bold span in the identity colour;
    // the batch cell is the sub-header the lane sits under, never repeated on the lane.
    expect(textOf(line).startsWith([p.label, p.model, p.tier, p.effort].filter(Boolean).join(' '))).toBe(true)
    expect(textOf(line).includes(`${p.batch} `)).toBe(false)
    const spans = wordSpans(line, p.label)
    if (p.state) {
      expect(textOf(spans[0])).toBe(p.state)
      expectStatePaint(spans[0], p.state)
    }
    if (p.state === 'per task' && Array.isArray(p.tasks)) {
      const words = p.tasks.filter((t: any) => t.word)
      expect(spans.slice(1).map(textOf)).toEqual(words.map((t: any) => t.word))
      words.forEach((t: any, i: number) => expectStatePaint(spans[i + 1], t.word))
    }
    // Colour sits on a state word and the label only: no other text in the lane carries a hue.
    for (const n of tree(el)) {
      if (n?.props?.color === PALETTE.identity) expect(textOf(n)).toBe(p.label)
      else if (n?.props?.color !== undefined) expect(Object.keys(STATE_COLOR)).toContain(textOf(n))
    }
  }
  for (const spawn of extra) {
    expect((await ui.find({ key: `wave-row-${spawn.label}` }))?.text).toBe(flatRow(spawn))
  }
}

const FAILED_16 = { id: '1.6', wave: 1, waveKind: 'impl', error: null }
const AT_FIRST_BATCH = { waveIndex: 0, batchIndex: 0, phase: 'batch' }
const AT_FIRST_VERIFY = { waveIndex: 0, batchIndex: null, phase: 'verify' }

async function adopted($: any, on: any) {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.ADOPTION_BATCH))
  return w
}

test('a relayed plan draws as cards on both surfaces, wrapping the gist and colouring current', async ($: any, on: any) => {
  await adopted($, on)
  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, { cursor: AT_FIRST_BATCH })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, ADOPTED_LANES)
    for (const id of ADOPTED_LANES) expect(await stateWord(ui, id)).toBe('current')
    expect(await ui.find({ text: UNRELAYED })).toBeUndefined()
    const windows = await ui.find({ key: 'plan-window-five_hour' })
    for (const n of tree(windows)) expect(n.props?.color).toBeUndefined()
    await ui.unmount()
  }
})

test('the recorded ids colour ok and failed in the theme\'s colours; a verify spawn is a flat row beneath the board', async ($: any, on: any) => {
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, { cursor: AT_FIRST_VERIFY, completed: RECORDED_OK, failures: [FAILED_16] })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, ADOPTED_LANES, F.RECORD_BATCH.spawns)
    expect(await stateWord(ui, '1.7')).toBe('ok')
    expect(await stateWord(ui, '1.6')).toBe('failed')
    expect((await ui.find({ key: `wave-row-${F.VERIFY_LABEL}` }))?.text).toBe(flatRow(F.RECORD_BATCH.spawns[0]))
    await ui.unmount()
  }
})

test('a RED wave title carries no colour, and only the cursor\'s card is bordered in the current colour', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  const plan = {
    ...F.ADOPTION_BATCH.plan,
    waves: F.ADOPTION_BATCH.plan.waves.map((wave: any, i: number) => (i === 0 ? { ...wave, red: true } : wave))
  }
  await bash($, w, NEXT, F.stdout({ ...F.ADOPTION_BATCH, plan }))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const title = await ui.find({ key: 'wave-block-0' })
    expect(title?.text).toMatch(/RED/)
    for (const n of tree(title)) expect(n.props?.color).toBeUndefined()
    // The cursor is on wave position 0, so that card holds the current lanes.
    const card = await ui.find({ key: 'wave-card-0' })
    expect(card?.props.borderColor).toBe(PALETTE.current)
    expect(card?.props.borderDimColor).toBeUndefined()
    const next = await ui.find({ key: 'wave-card-1' })
    expect(next?.props.borderColor).toBeUndefined()
    expect(next?.props.borderDimColor).toBe(true)
    await ui.unmount()
  }
})

test('a skipped verification is placed on its own boundary with the step\'s reason', async ($: any, on: any) => {
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.VERIFY_SKIPPED))
  const plan = F.ADOPTION_BATCH.plan
  const skip = { wave: F.VERIFY_SKIPPED.wave, waveIndex: 0, reason: F.SKIP_REASON }
  const state = overlay(plan, { cursor: AT_FIRST_VERIFY, skippedVerifications: [skip] })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, ADOPTED_LANES)
    expect((await ui.find({ key: 'wave-verify-0' }))?.text).toMatch(new RegExp(`skipped: ${F.SKIP_REASON}`))
    await ui.unmount()
  }
})

test('a replan\'s summary replaces the adopted one, and the recorded ids stand', async ($: any, on: any) => {
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  await bash($, w, NEXT, F.stdout(F.REPLAN_BATCH))
  const plan = F.REPLAN_BATCH.plan
  const state = overlay(plan, {
    cursor: { waveIndex: 1, batchIndex: 0, phase: 'batch' },
    completed: RECORDED_OK,
    failures: [FAILED_16]
  })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, [...ADOPTED_LANES, '1.5', '1.1'], F.RECORD_BATCH.spawns)
    expect(await stateWord(ui, '2.1+2')).toBe('pending')
    expect(await stateWord(ui, '1.7')).toBe('ok')
    await ui.unmount()
  }
})

test('a lane whose tasks were recorded apart colours each task\'s own word', async ($: any, on: any) => {
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  await bash($, w, NEXT, F.stdout(F.REPLAN_BATCH))
  const recorded = { ok: [...RECORDED_OK, '2.1'], failed: ['1.6', '2.2'], notAttempted: [] }
  await bash($, w, NEXT, F.stdout({ ...F.RECORD_BATCH, waveIndex: 1, recorded }))
  const plan = F.REPLAN_BATCH.plan
  const state = overlay(plan, {
    cursor: { waveIndex: 1, batchIndex: null, phase: 'verify' },
    completed: recorded.ok,
    failures: [FAILED_16, { ...FAILED_16, id: '2.2' }]
  })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await stateWord(ui, '2.1+2')).toBe('per task')
    await expectBoard(ui, plan, state, [...ADOPTED_LANES, '1.5', '1.1'], F.RECORD_BATCH.spawns)
    await ui.unmount()
  }
})

test('a card is the body wide up to the published default, and a lane wider than its card stays one line', async ($: any, on: any) => {
  await adopted($, on)
  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, { cursor: AT_FIRST_BATCH })
  const min = LIMITS.waveBoardMinColumns
  const max = LIMITS.waveBoardDefaultColumns
  // `body` is the section body: the pane's body less the section's indent.
  for (const body of [min, Math.floor((min + max) / 2), max + 60]) {
    for (const surface of SURFACES) {
      const ui = await mount($, surface, body + SECTION_INDENT)
      await expectBoard(ui, plan, state, ADOPTED_LANES, [], Math.min(body, max))
      await ui.unmount()
    }
  }
})

test('a CLI that relays no plan is named above the flat rows, which read as before', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ text: /no lanes dispatched yet/ })).toBeDefined()
    expect(await ui.find({ text: UNRELAYED })).toBeUndefined()
    await ui.unmount()
  }
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(texts(await waveSection(ui))).toEqual([
      UNRELAYED,
      'lane-a · implement · routed sonnet · served ? · effort low · waiting',
      'lane-b · implement · routed opus · served ? · effort high · waiting'
    ])
    expect(await ui.find({ text: /no lanes dispatched yet/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('one column below the published minimum the section is the spoken line, then the flat rows', async ($: any, on: any) => {
  await adopted($, on)
  const spoken = drawPlanBoard(F.ADOPTION_BATCH.plan, { columns: NARROW })
  expect(spoken).toHaveLength(1)
  for (const surface of SURFACES) {
    const ui = await mount($, surface, NARROW + SECTION_INDENT)
    const section = texts(await waveSection(ui))
    expect(section).toEqual([spoken[0], ...F.ADOPTION_BATCH.spawns.map(flatRow)])
    for (const line of section) expect(BOX_DRAWING.test(line)).toBe(false)
    await ui.unmount()
  }
})

test('a malformed plan or recorded is named once and ignored, and the rest of the step applies', async ($: any, on: any) => {
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  const bad = {
    ...F.REPLAN_BATCH,
    spawns: [],
    banners: [F.SECOND_BANNER],
    plan: 'the plan',
    recorded: ['1.5']
  }
  await bash($, w, NEXT, F.stdout(bad))
  await bash($, w, NEXT, F.stdout({ ...bad, plan: { waves: 'none' }, recorded: { ok: '1.5' } }))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · run-batch · wave 1 · batch 1/2`)
  expect(w.toasts.filter(t => t === F.SECOND_BANNER)).toHaveLength(1)
  const debug = w.logs.filter(l => l.to === 'debug').map(l => l.text)
  expect(debug.filter(t => /\bplan\b/.test(t) && /ignored/.test(t))).toHaveLength(1)
  expect(debug.filter(t => /\brecorded\b/.test(t) && /ignored/.test(t))).toHaveLength(1)

  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, {
    cursor: { waveIndex: 1, batchIndex: 0, phase: 'batch' },
    completed: RECORDED_OK,
    failures: [FAILED_16]
  })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, ADOPTED_LANES, F.RECORD_BATCH.spawns)
    expect(count((await ui.find({ key: 'banners' }))?.text, F.SECOND_BANNER)).toBe(1)
    await ui.unmount()
  }
})

test('the session boundary drops the summary, the recorded ids and the skips', async ($: any, on: any) => {
  // A person's prompt re-arms the launch guard after the boundary, so the next run may start.
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, origin: e.origin }))
  const w = await adopted($, on)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  await bash($, w, NEXT, F.stdout(F.VERIFY_SKIPPED))
  await $.classic.SessionStart({ source: 'clear' })
  await $.prompt.submit({ text: 'ship it again', wait: false, origin: { kind: 'composer' } })
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(texts(await waveSection(ui))[0]).toBe(UNRELAYED)
    await ui.unmount()
  }
  await bash($, w, NEXT, F.stdout(F.ADOPTION_BATCH))
  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, { cursor: AT_FIRST_BATCH })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await expectBoard(ui, plan, state, ADOPTED_LANES)
    expect((await ui.find({ key: 'wave-verify-0' }))?.text || '').not.toMatch(new RegExp(F.SKIP_REASON))
    await ui.unmount()
  }
})

test('a spec skill load during a live ship run leaves the ship position on the line until the close', async ($: any, on: any) => {
  // observe-the-spec-run-live design D7: one composer, the ship position first.
  const w = world(on)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await $.prompt.submit({ text: '/interlock:spec add the thing', origin: { kind: 'composer' } })
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  await bash($, w, 'openspec new change "add-the-thing"', 'Created change')
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  await bash($, w, NEXT, F.stdout(F.HALT))
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  expect(w.status.at(-1)).toBe('interlock spec: add-the-thing · new change')
})

// --- every agent named ----------------------------------------------
//
// The Workflow host raises no `agent.spawn` for a Workflow agent (probed on
// 2.1.289), so the spawn event's join never fires there. Every run agent's
// first act is to read its own briefing: a Read path or a Bash command that
// names a dispatched spawn's briefing path joins the agent to that spawn's
// row. A driver line names a relay; an agent with neither reads unmatched.

const KETTLE = '/Users/caro/IdeaProjects/kettle/ship'
const briefingOf = (label: string) => `.claude/ship/briefings/${label}.md`
const TITLE_17 = 'task 1.7 · Write the docs'
const TITLED_ADOPTION = {
  ...F.ADOPTION_BATCH,
  spawns: F.ADOPTION_BATCH.spawns.map((s: any) => (s.label === '1.7' ? { ...s, title: TITLE_17 } : s))
}
const TITLE_11 = 'task 1.1 · Add the turn-end toast'
const TITLE_21 = 'tasks 2.1+2 · Name every agent'
const TITLE_31 = 'task 3.1 · Draw the palette'
const laneSpawn = (label: string, title: string, c: string, promptPath = briefingOf(label)) => ({
  label,
  title,
  kind: 'implementer',
  model: 'sonnet',
  effort: 'low',
  type: 'interlock:worker',
  promptPath,
  promptSha256: c.repeat(64)
})
/** A batch of three lanes, the third's briefing path built with Windows separators, as node's `join` builds it there. */
const BRIEFED_BATCH = {
  ...F.RUN_BATCH,
  spawns: [
    laneSpawn('1.1', TITLE_11, 'c'),
    laneSpawn('2.1+2', TITLE_21, 'd'),
    laneSpawn('3.1', TITLE_31, 'e', '.claude\\ship\\briefings\\3.1.md')
  ]
}
/** An agent row's first line, as its spans: the name, the id and models, the turn word. */
async function agentSpans(ui: any, id: string) {
  const line = tree(contentOf(await ui.find({ key: `agent-${id}` }))).find((n: any) => n.type === 'Text')
  expect(line?.props?.wrap).toBe('wrap')
  return spansOf(line)
}

test('on the Workflow host an agent that reads its briefing is named by its lane\'s title, with no spawn event', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(TITLED_ADOPTION))
  const path = `${KETTLE}/${briefingOf('1.7')}`
  expect(await readAs($, 'a1', path)).toEqual(readAnswer(path))
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  const plan = F.ADOPTION_BATCH.plan
  const state = overlay(plan, { cursor: AT_FIRST_BATCH })
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await agentRow(ui, 'a1')).startsWith(`${TITLE_17} · a1 · claude-sonnet-5-5 · running`)).toBe(true)
    expectNamePaint((await agentSpans(ui, 'a1'))[0], TITLE_17)
    await expectBoard(ui, plan, state, ADOPTED_LANES, [], LIMITS.waveBoardDefaultColumns, {
      '1.7': 'served claude-sonnet-5-5 · running'
    })
    expect((await ui.find({ key: 'wave-row-1.7-note' }))?.text).toBe('served claude-sonnet-5-5 · running')
    expect(await ui.find({ key: 'agents-unmatched' })).toBeUndefined()
    await ui.unmount()
  }

  const before = w.toasts.length
  await complete($, 'a1', 'error')
  expect(w.toasts.slice(before)).toEqual([`${TITLE_17} · agent a1 · turn ended: error`])
  const ui = await mount($, 'terminal')
  // The note says how long the turn took once it ended, humanised.
  expect((await ui.find({ key: 'wave-row-1.7-note' }))?.text).toBe(`served claude-sonnet-5-5 · error ${durationText(4200)}`)
  await ui.unmount()
})

test('a Bash cat of a briefing joins its agent; a longer name around the path does not, and the first briefing read wins', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(BRIEFED_BATCH))
  await bashAs($, w, 'a2', `cat ${briefingOf('1.1')}`, 'the briefing')
  // Paths that hold row 1.1's briefing path only inside a longer file name.
  const near = [
    ['a3', `${KETTLE}/.claude/ship/briefings/11.1.md`],
    ['a4', `${KETTLE}/.claude/ship/briefings/1.1+2.md`],
    ['a5', `/repo/x${briefingOf('1.1')}`],
    ['a6', `${KETTLE}/${briefingOf('1.1')}.bak`]
  ]
  for (const [id, path] of near) expect(await readAs($, id, path)).toEqual(readAnswer(path))
  // A second briefing read by a2 leaves it on its first lane.
  await readAs($, 'a2', `${KETTLE}/${briefingOf('2.1+2')}`)
  // A Windows path, read against a row whose briefing path was built with `\`.
  await readAs($, 'a7', 'C:\\Users\\caro\\kettle\\ship\\.claude\\ship\\briefings\\3.1.md')

  // A briefing path that matches no row makes no agent record of its own.
  let ui = await mount($, 'terminal')
  for (const [id] of near) expect(await ui.find({ key: `agent-${id}` })).toBeUndefined()
  expect((await agentRow(ui, 'a2')).startsWith(`${TITLE_11} · a2 · `)).toBe(true)
  await ui.unmount()

  for (const id of ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']) {
    w.usage.set(`${id}:0`, usage('claude-sonnet-5-5', 1))
    await step($, id, 0, 'claude-sonnet-5-5')
  }
  for (const surface of SURFACES) {
    ui = await mount($, surface)
    expect((await agentRow(ui, 'a2')).startsWith(`${TITLE_11} · a2 · claude-sonnet-5-5 · running`)).toBe(true)
    expect((await agentRow(ui, 'a7')).startsWith(`${TITLE_31} · a7 · `)).toBe(true)
    for (const [id] of near) expect((await agentRow(ui, id)).startsWith(`unmatched agent · ${id} · `)).toBe(true)
    const flat = await ui.find({ key: 'wave-row-1.1' })
    expect(flat?.text).toBe(`${TITLE_11} · implementer · routed sonnet · served claude-sonnet-5-5 · effort low · running`)
    expectNamePaint(spansOf(tree(flat).find((n: any) => n.type === 'Text'))[0], TITLE_11)
    expect((await ui.find({ key: 'wave-row-2.1+2' }))?.text).toMatch(/served \? · effort low · waiting$/)
    expect((await ui.find({ key: 'agents-unmatched' }))?.text).toBe(UNMATCHED_LINE)
    await ui.unmount()
  }
})

test('an agent that runs a driver line before any briefing is a relay, named dim by what it relayed', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bashAs($, w, 'a9', NEXT, F.stdout(BRIEFED_BATCH))
  w.usage.set('a9:0', usage('claude-haiku-4-5', 3))
  await step($, 'a9', 0, 'claude-haiku-4-5')
  await bashAs($, w, 'a8', 'interlock limits --json', '{}')
  // A worker that read its briefing keeps its lane's title when it runs an interlock line.
  await readAs($, 'a2', `${KETTLE}/${briefingOf('1.1')}`)
  await bashAs($, w, 'a2', 'interlock graph query --json', '{}')
  await complete($, 'a8', 'answer')
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)

  const stepWords = 'run-batch · wave 2 · batch 1/2 · 3 in parallel'
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    // The agent that printed the step is drawn on the step's own line, dim, and nowhere else.
    expect(await lineText(ui, 'step-0')).toBe(`${stepWords} · cli a9 · claude-haiku-4-5 · 1 request`)
    expect(await ui.find({ key: 'agent-a9' })).toBeUndefined()
    const [relay] = spansOf(tree(contentOf(await ui.find({ key: 'step-0' }))).find((n: any) => n.type === 'Text'))
    expect(textOf(relay)).toBe(' · cli a9 · claude-haiku-4-5 · 1 request')
    expect(relay.props.dimColor).toBe(true)
    // A relay no step names stands at the top level, after the timed lines: it made no request, so it has no time.
    expect(await timelineKeys(ui)).toEqual(['launch', 'step-0', 'agent-a2', 'spawn-0-2.1+2', 'spawn-0-3.1', 'agent-a8'])
    expect(await depthOf(ui, 'agent-a8')).toBe(0)
    expect(await gutterText(ui, 'agent-a8')).toBe('')
    expect(await agentRow(ui, 'a8')).toBe('cli · limits · a8 · model not reported · answer 4.2s')
    expect((await agentRow(ui, 'a2')).startsWith(`${TITLE_11} · a2 · `)).toBe(true)
    expect(await depthOf(ui, 'agent-a2')).toBe(1)
    const [name, , done] = await agentSpans(ui, 'a8')
    expect(name.props.dimColor).toBe(true)
    expect(name.props.color).toBeUndefined()
    expect(done.props.dimColor).toBe(true)
    expect(done.props.color).toBeUndefined()
    expect(await ui.find({ key: 'agents-unmatched' })).toBeUndefined()
    await ui.unmount()
  }

  // A relay's abnormal end is spoken by its relay name and drawn on its step's line in the alarm colour.
  await complete($, 'a9', 'error')
  expect(turnEnds(w)).toEqual(['cli · run next · agent a9 · turn ended: error'])
  const ui = await mount($, 'terminal')
  expect(await lineText(ui, 'step-0')).toBe(`${stepWords} · cli a9 · claude-haiku-4-5 · 1 request · error ${durationText(4200)}`)
  const spans = spansOf(tree(contentOf(await ui.find({ key: 'step-0' }))).find((n: any) => n.type === 'Text'))
  expect(textOf(spans[1])).toBe(`error ${durationText(4200)}`)
  expect(spans[1].props.color).toBe(PALETTE.alarm)
  await ui.unmount()
})

for (const where of ['a live run', 'no live run', 'a non-interactive session'] as const) {
  test(`in ${where} the Read observer resolves to exactly what the engine beneath answered`, async ($: any, on: any) => {
    const w = world(on)
    await start($, where !== 'a non-interactive session')
    if (where !== 'no live run') await launch($)
    await bash($, w, NEXT, F.stdout(BRIEFED_BATCH))
    const path = `${KETTLE}/${briefingOf('1.1')}`
    const status = [...w.status]
    expect(await readAs($, 'a1', path)).toEqual(readAnswer(path))
    expect(await $.tool.call({ tool: 'Read', file_path: path })).toEqual(readAnswer(path))
    expect(await readAs($, 'a1', 'lib/x.mjs')).toEqual(readAnswer('lib/x.mjs'))
    expect(w.status).toEqual(status)
    expect(w.toasts.filter(t => t.includes('a1'))).toEqual([])
  })
}

test('the pane draws in the theme\'s keys: accent headings, identity names, warn banners and quiet word, alarm refusals', async ($: any, on: any) => {
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, origin: e.origin }))
  const w = world(on)
  await start($)
  // Before any launch the guard allows, and its line carries no colour.
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const guard = await ui.find({ key: 'launch-guard' })
    expect(guard?.text).toBe('launch guard: next launch allowed')
    for (const n of tree(guard)) expect(n.props?.color).toBeUndefined()
    await ui.unmount()
  }

  await launch($)
  await bash($, w, NEXT, F.stdout(BRIEFED_BATCH))
  await editTest($)
  await readAs($, 'a1', `${KETTLE}/${briefingOf('1.1')}`)
  await readAs($, 'a2', `${KETTLE}/${briefingOf('2.1+2')}`)
  await bashAs($, w, 'a9', 'interlock limits --json', '{}')
  for (const id of ['a1', 'a2', 'a5']) {
    w.usage.set(`${id}:0`, usage('claude-sonnet-5-5', 1))
    await step($, id, 0, 'claude-sonnet-5-5')
  }
  await complete($, 'a2', 'answer')
  await complete($, 'a5', 'error')
  await w.clock!.advance(LIMITS.meterQuietAfterMs)

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const header = paintOf(await ui.find({ text: `${F.CHANGE} · run ${F.RUN_ID}` }))
    expect(header.bold).toBe(true)
    expect(header.color).toBe(PALETTE.accent)
    for (const heading of ['waves', 'timeline', 'session', 'plan windows', 'banners', 'refusals']) {
      const props = paintOf(await ui.find({ text: heading }))
      expect(props.bold).toBe(true)
      expect(props.color).toBe(PALETTE.accent)
    }

    const banners = tree(await ui.find({ key: 'banners' })).filter((n: any) => n.type === 'Text' && textOf(n) === F.BANNER)
    expect(banners).toHaveLength(1)
    expect(banners[0].props.color).toBe(PALETTE.warn)
    const denials = await ui.find({ key: 'guard-denials' })
    expect(denials?.text).toBe('guard denials: 1 (guard-tests 1)')
    expect(paintOf(denials).color).toBe(PALETTE.alarm)
    const guard = await ui.find({ key: 'launch-guard' })
    expect(guard?.text.startsWith('launch guard: next launch refused: ')).toBe(true)
    expect(paintOf(guard).color).toBe(PALETTE.alarm)

    // The quiet word is a span in the warn colour; the line's text is as it was.
    const activity = await ui.find({ key: 'last-activity' })
    expect(activity?.text).toBe(`${activityLine(T0, T0)} · ${QUIET_WORD}`)
    const line = tree(activity).find((n: any) => n.type === 'Text')
    expect(line.props?.color).toBeUndefined()
    const quiet = spansOf(line)
    expect(quiet.map(textOf)).toEqual([QUIET_WORD])
    expect(quiet[0].props.color).toBe(PALETTE.warn)

    // Joined agents named in the identity colour, the relay dim, the unmatched agent dim and italic.
    const [a1Name, a1Ids, a1Done] = await agentSpans(ui, 'a1')
    expectNamePaint(a1Name, TITLE_11)
    expect(a1Ids.props.dimColor).toBe(true)
    expect(textOf(a1Done)).toBe('running')
    expect(a1Done.props.color).toBe(PALETTE.warn)
    const [a2Name, , a2Done] = await agentSpans(ui, 'a2')
    expectNamePaint(a2Name, TITLE_21)
    expect(textOf(a2Done)).toBe('answer 4.2s')
    expect(a2Done.props.color).toBe(PALETTE.ok)
    const [a5Name, , a5Done] = await agentSpans(ui, 'a5')
    expect(textOf(a5Name)).toBe('unmatched agent')
    expect(a5Name.props.dimColor).toBe(true)
    expect(a5Name.props.italic).toBe(true)
    expect(a5Name.props.color).toBeUndefined()
    expect(textOf(a5Done)).toBe('error 4.2s')
    expect(a5Done.props.color).toBe(PALETTE.alarm)
    const [a9Name, , a9Done] = await agentSpans(ui, 'a9')
    expect(textOf(a9Name)).toBe('cli · limits')
    expect(a9Name.props.dimColor).toBe(true)
    expect(a9Done.props.dimColor).toBe(true)
    const unmatched = await ui.find({ key: 'agents-unmatched' })
    expect(unmatched?.text).toBe(UNMATCHED_LINE)
    expect(paintOf(unmatched).dimColor).toBe(true)

    // The engine's own figures carry no colour: no threshold is the meter's.
    for (const key of ['session-context', 'session-cost', 'plan-window-five_hour', 'action']) {
      for (const n of tree(await ui.find({ key }))) expect(n.props?.color).toBeUndefined()
    }
    await ui.unmount()
  }
  expect(turnEnds(w)).toEqual(['unmatched agent · agent a5 · turn ended: error'])

  // A person's prompt re-arms the guard: the line is allowed again, and uncoloured.
  await $.prompt.submit({ text: 'carry on', wait: false, origin: { kind: 'composer' } })
  const ui = await mount($, 'terminal')
  const guard = await ui.find({ key: 'launch-guard' })
  expect(guard?.text).toBe('launch guard: next launch allowed')
  for (const n of tree(guard)) expect(n.props?.color).toBeUndefined()
  await ui.unmount()
})

// --- the step timeline -------------------------------------------------------
//
// One line per step as it crossed, a local `HH:MM:SS` gutter on every timed
// line (blank where no time was read), the relay folded into its step's line,
// the agents a step spawned indented beneath it in start order with a waiting
// spawn last, orphan relays at their time, unmatched agents last. Every
// expected time is the lib's own helper over the kit's clock readings.

const TITLE_41 = 'task 4.1 · Wait for the lead'
const FOUR_LANES = { ...BRIEFED_BATCH, spawns: [...BRIEFED_BATCH.spawns, laneSpawn('4.1', TITLE_41, 'f')] }
const firstSpan = async (ui: any, key: string) =>
  spansOf(tree(contentOf(await ui.find({ key }))).find((n: any) => n.type === 'Text'))

test('a step\'s line folds in the agent that printed it, and an orphan relay stands at its own time among the steps', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bashAs($, w, 'a9', NEXT, F.stdout(F.RUN_BATCH))
  w.usage.set('a9:0', usage('claude-haiku-4-5', 3))
  await step($, 'a9', 0, 'claude-haiku-4-5')
  await complete($, 'a9', 'answer')
  await w.clock!.advance(2000)
  await bashAs($, w, 'a8', 'interlock limits --json', '{}')
  w.usage.set('a8:0', usage('claude-haiku-4-5', 1))
  await step($, 'a8', 0, 'claude-haiku-4-5')
  await w.clock!.advance(1000)
  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    // An answered relay's turn word is not drawn: its line ends in how long it took.
    expect(await lineText(ui, 'step-0')).toBe(
      `run-batch · wave 2 · batch 1/2 · 2 in parallel · cli a9 · claude-haiku-4-5 · 1 request · ${durationText(4200)}`
    )
    expect(await gutterText(ui, 'step-0')).toBe(clockText(T0))
    expect((await firstSpan(ui, 'step-0')).map(textOf)).toEqual([' · cli a9 · claude-haiku-4-5 · 1 request', ` · ${durationText(4200)}`])
    for (const span of await firstSpan(ui, 'step-0')) {
      expect(span.props.dimColor).toBe(true)
      expect(span.props.color).toBeUndefined()
    }
    // A step printed by the lead session names no relay; the test wave dispatched no lane.
    expect(await lineText(ui, 'step-1')).toBe('test-wave · wave 2')
    expect(await gutterText(ui, 'step-1')).toBe(clockText(T0 + 3000))
    expect(await timelineKeys(ui)).toEqual(['launch', 'step-0', 'spawn-0-lane-a', 'spawn-0-lane-b', 'agent-a8', 'step-1'])
    expect(await gutterText(ui, 'agent-a8')).toBe(clockText(T0 + 2000))
    expect(await depthOf(ui, 'agent-a8')).toBe(0)
    expect(await depthOf(ui, 'step-0')).toBe(0)
    expect(await agentRow(ui, 'a8')).toBe('cli · limits · a8 · claude-haiku-4-5 · running')
    // A spawn no agent joined yet: its title in the identity colour, `waiting` dim, and no time.
    expect(await lineText(ui, 'spawn-0-lane-a')).toBe('lane-a · waiting')
    expect(await gutterText(ui, 'spawn-0-lane-a')).toBe('')
    const [title, waiting] = await firstSpan(ui, 'spawn-0-lane-a')
    expectNamePaint(title, 'lane-a')
    expect(textOf(waiting)).toBe('waiting')
    expect(waiting.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('a parallel batch\'s lanes sit beneath its step in the order their agents started, a waiting spawn last', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(FOUR_LANES))
  // Each agent reads its own briefing, then starts its first request a second after the one before.
  await readAs($, 'a7', `${KETTLE}/${briefingOf('3.1')}`)
  await readAs($, 'a2', `${KETTLE}/${briefingOf('1.1')}`)
  await readAs($, 'a3', `${KETTLE}/${briefingOf('2.1+2')}`)
  for (const [n, id] of [[1, 'a7'], [2, 'a2'], [3, 'a3']] as const) {
    await w.clock!.advance(1000)
    w.usage.set(`${id}:0`, usage('claude-sonnet-5-5', n))
    await step($, id, 0, 'claude-sonnet-5-5')
  }
  await $.turn.complete({ answer: '', durationMs: 134_200, isAborted: false, turnId: 't-a3', agentId: 'a3', reason: 'answer' })

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await lineText(ui, 'step-0')).toBe('run-batch · wave 2 · batch 1/2 · 4 in parallel')
    expect(await timelineKeys(ui)).toEqual(['launch', 'step-0', 'agent-a7', 'agent-a2', 'agent-a3', 'spawn-0-4.1'])
    for (const [n, id] of [[1, 'a7'], [2, 'a2'], [3, 'a3']] as const) {
      expect(await gutterText(ui, `agent-${id}`)).toBe(clockText(T0 + n * 1000))
      expect(await depthOf(ui, `agent-${id}`)).toBe(1)
    }
    expect(await agentRow(ui, 'a7')).toBe(`${TITLE_31} · a7 · claude-sonnet-5-5 · running1 request · in 1 · out 2 · cache read 3 · cache write 4`)
    // The duration is humanised: two minutes and fourteen seconds, not 134.2s.
    expect((await agentRow(ui, 'a3')).startsWith(`${TITLE_21} · a3 · claude-sonnet-5-5 · answer 2m 14s`)).toBe(true)
    expect(durationText(134_200)).toBe('2m 14s')
    const content = contentOf(await ui.find({ key: 'agent-a2' }))
    expect(content.props.flexDirection).toBe('column')
    expect(content.children[1].props.dimColor).toBe(true)
    expect(textOf(content.children[1])).toBe('1 request · in 2 · out 4 · cache read 6 · cache write 8')
    expect(await lineText(ui, 'spawn-0-4.1')).toBe(`${TITLE_41} · waiting`)
    expect(await gutterText(ui, 'spawn-0-4.1')).toBe('')
    expect(await depthOf(ui, 'spawn-0-4.1')).toBe(1)
    await ui.unmount()
  }

  // The same label dispatched again by a later step, with a new briefing, waits beneath that step.
  const again = { ...F.RUN_BATCH, batchIndex: 1, spawns: [laneSpawn('4.1', TITLE_41, '9')] }
  await bash($, w, NEXT, F.stdout(again))
  const ui = await mount($, 'terminal')
  expect(await timelineKeys(ui)).toEqual(['launch', 'step-0', 'agent-a7', 'agent-a2', 'agent-a3', 'spawn-0-4.1', 'step-1', 'spawn-1-4.1'])
  expect(await lineText(ui, 'step-1')).toBe('run-batch · wave 2 · batch 2/2 · 1 lane')
  await ui.unmount()
})

/** The keys a card holds, in the order drawn: its title, then each batch's sub-header and lanes. */
async function cardKeys(ui: any, index: number) {
  const keys = (await ui.findAll({ type: 'Box' })).map((b: any) => b.key).filter((k: unknown) => typeof k === 'string')
  const from = keys.indexOf(`wave-card-${index}`)
  const to = keys.findIndex((k: string, i: number) => i > from && (k.startsWith('wave-card-') || k.startsWith('wave-verify-') || k === 'wave-board-tail'))
  return keys.slice(from + 1, to).filter((k: string) => !k.endsWith('-gist') && !k.endsWith('-note'))
}

test('within a card the lanes sit beneath their batch\'s sub-header, timed when the batch was first dispatched', async ($: any, on: any) => {
  const w = await adopted($, on)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await cardKeys(ui, 0)).toEqual(['wave-block-0', 'wave-batch-0-0', ...ADOPTED_LANES.map(l => `wave-row-${l}`)])
    expect(await lineText(ui, 'wave-batch-0-0')).toBe('b0 · 5 in parallel')
    expect(await gutterText(ui, 'wave-batch-0-0')).toBe(clockText(T0))
    expect(await depthOf(ui, 'wave-batch-0-0')).toBe(0)
    // The sub-header carries no state word and no colour: the cursor card's border marks where the run is.
    for (const n of tree(await ui.find({ key: 'wave-batch-0-0' }))) expect(n.props?.color).toBeUndefined()
    // A batch never dispatched has no time.
    expect(await lineText(ui, 'wave-batch-1-0')).toBe('b0 · 2 in parallel')
    expect(await gutterText(ui, 'wave-batch-1-0')).toBe('')
    expect(await lineText(ui, 'wave-batch-1-1')).toBe('b1 · 1 lane')
    expect(await lineText(ui, 'wave-batch-2-0')).toBe('b0 · 2 in parallel')
    await ui.unmount()
  }

  await w.clock!.advance(60_000)
  await bash($, w, NEXT, F.stdout(F.RECORD_BATCH))
  await w.clock!.advance(60_000)
  await bash($, w, NEXT, F.stdout(F.REPLAN_BATCH))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await cardKeys(ui, 1)).toEqual([
      'wave-block-1',
      'wave-batch-1-0',
      'wave-row-1.5',
      'wave-row-1.1',
      'wave-batch-1-1',
      'wave-row-2.1+2',
      'wave-row-3.2'
    ])
    expect(await gutterText(ui, 'wave-batch-1-0')).toBe(clockText(T0 + 120_000))
    expect(await gutterText(ui, 'wave-batch-1-1')).toBe('')
    expect(await gutterText(ui, 'wave-batch-0-0')).toBe(clockText(T0))
    expect(await lineText(ui, 'wave-batch-1-1')).toBe('b1 · 2 in parallel')
    for (const label of ['1.5', '1.1', '2.1+2', '3.2']) {
      expect(await gutterText(ui, `wave-row-${label}`)).toBe('')
      expect(await depthOf(ui, `wave-row-${label}`)).toBe(1)
    }
    // The steps the timeline lists for the same run: the plan's size rides the steps that relayed one.
    expect(await lineText(ui, 'step-0')).toBe('run-batch · wave 1 · batch 1/1 · 5 in parallel · plan: 3 waves')
    expect(await lineText(ui, 'step-1')).toBe('verify · wave 1')
    expect(await lineText(ui, 'step-2')).toBe('run-batch · wave 1 · batch 1/2 · 2 in parallel · plan: 3 waves')
    await ui.unmount()
  }
})

test('every section\'s body sits one indent in beneath its heading', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await bash($, w, NEXT, F.stdout(F.HALT))
  await bash($, w, CLOSE_CMD, F.stdout(F.CLOSE))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const keys = (await ui.findAll({ type: 'Box' })).map((b: any) => b.key)
    const bodies = ['waves-body', 'timeline-body', 'session-body', 'plan-windows-body', 'banners', 'refusals-body', 'summary']
    for (const key of bodies) {
      const body = await ui.find({ key })
      expect(body).toBeDefined()
      expect(body.props.flexDirection).toBe('column')
      expect(body.props.paddingLeft).toBe(SECTION_INDENT)
    }
    // In the pane's order, each beneath its heading.
    expect(bodies.map(key => keys.indexOf(key))).toEqual([...bodies.map(key => keys.indexOf(key))].sort((a, b) => a - b))
    expect((await ui.find({ key: 'session-body' }))?.text).toBe(
      `${(await ui.find({ key: 'session-context' }))?.text}${(await ui.find({ key: 'session-cost' }))?.text}`
    )
    expect(await lineText(ui, 'step-1')).toBe(`halt · ${F.HALT.reason}`)
    expect(await lineText(ui, 'step-2')).toBe('halt')
    await ui.unmount()
  }
})
