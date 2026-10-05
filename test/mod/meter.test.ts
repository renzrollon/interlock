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

import { LIMITS } from '../../lib/limits.mjs'
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
}

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
    usage: new Map()
  }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => BENEATH)
  // The spinner as the engine draws it: the word, then the suffix right after it.
  on('ui.render', { component: 'Spinner' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, `${e.props.word}${e.props.suffix}`)
  })
  on('session.version', () => ({ value: { version: '2.1.289', base: '2.1.289', builtAt: '2026-10-03T19:21:39Z' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-05T23:00:00Z' }] }
  }))
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
    return { result: { stdout: text, stderr: '', interrupted: false }, text }
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
async function spinner($: any, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Spinner', props: SPINNER })
  const text = (await ui.find({ text: /^Sauteing/ }))?.text
  await ui.unmount()
  return text
}
const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Interlock', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
  })

test('session.start registers /interlock-meter and logs the engine it loaded in', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual([PANE])
  expect(w.logs.some(l => /2\.1\.289/.test(l.text) && /terminal/.test(l.text) && l.to === 'transcript')).toBe(true)
})

test('a non-interactive session registers the command and draws nothing for its life', async ($: any, on: any) => {
  const w = world(on)
  await start($, false)
  expect(w.commands).toEqual([PANE])
  expect(w.logs.every(l => l.to === 'debug')).toBe(true)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  w.usage.set('a1:0', usage('claude-sonnet-5-5', 10))
  await step($, 'a1', 0, 'claude-sonnet-5-5')
  await complete($, 'a1')
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
    const a1 = (await ui.find({ key: 'agent-a1' }))?.text ?? ''
    const a2 = (await ui.find({ key: 'agent-a2' }))?.text ?? ''
    expect(a1).toMatch(/claude-sonnet-5-5/)
    expect(a1).toMatch(/in 30/)
    expect(a1).not.toMatch(/claude-opus-5-5/)
    expect(a2).toMatch(/claude-opus-5-5/)
    expect(a2).toMatch(/in 7\b/)
    expect(a2).toMatch(/answer/)
    expect(a2).toMatch(/4\.2s/)
    expect(a1).toMatch(/lane unknown/)
    await ui.unmount()
  }

  w.usage.set('a1:2', null)
  await step($, 'a1', 2, 'claude-sonnet-5-5')
  w.usage.set('a1:3', usage('claude-sonnet-4-5', 1))
  await step($, 'a1', 3, 'claude-sonnet-4-5')
  const ui = await mount($, 'terminal')
  const a1 = (await ui.find({ key: 'agent-a1' }))?.text ?? ''
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
    expect(await ui.find({ text: /resume card: \.claude\/ship\/resume/ })).toBeDefined()
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
    expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0).toISOString()}`)
    await ui.unmount()
  }

  await w.clock!.advance(1)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${BATCH_POSITION} · ${QUIET_WORD}`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0).toISOString()} · ${QUIET_WORD}`)
    const windows = await ui.find({ key: 'plan-window-five_hour' })
    expect(windows?.text).not.toMatch(/quiet|warn|limit|over|high/i)
    expect(windows?.props.color).toBeUndefined()
    await ui.unmount()
  }

  await bash($, w, NEXT, F.stdout(F.RELAYED_TEST_WAVE))
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · test-wave · wave 2`)
  for (const surface of SURFACES) {
    expect(await spinner($, surface)).toBe(`Sauteing${F.CHANGE} · test-wave · wave 2`)
    const ui = await mount($, surface)
    expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0 + LIMITS.meterQuietAfterMs).toISOString()}`)
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
  expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0 + LIMITS.meterQuietAfterMs).toISOString()}`)
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
    expect(await ui.find({ text: /resume card: \.claude\/ship\/resume/ })).toBeDefined()
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
    expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0).toISOString()}`)
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
