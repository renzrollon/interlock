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
// The body width is the board's published default unless a case names
// another; both are `interlock limits`'s, never restated here.
const mount = ($: any, surface: (typeof SURFACES)[number], bodyColumns: number = LIMITS.waveBoardDefaultColumns) =>
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
    for (const n of tree(windows)) expect(n.props?.color).toBeUndefined()
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

// The turn-end toast (speak-lane-turn-ends-and-session-cost design D1-D3): the
// host's reason word, once per run agent, naming the lane's title or `lane unknown`.
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

test('a turn the host stops for an agent nobody joined reads lane unknown, with no cause beside it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await bash($, w, NEXT, F.stdout(F.RUN_BATCH))
  await complete($, 'a1', 'aborted')
  expect(turnEnds(w)).toEqual(['lane unknown · agent a1 · turn ended: aborted'])
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
    'lane unknown · agent a1 · turn ended: refusal',
    'lane unknown · agent a2 · turn ended: aborted',
    'lane unknown · agent a3 · turn ended: error',
    'lane unknown · agent a4 · turn ended: cancelled'
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
    expect(await lastActivity(ui)).toBe(`last activity ${new Date(T0).toISOString()}`)
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
/** No agent joined in the kit, so each spawned lane's note reads its served model as unknown. */
const notesFor = (labels: string[]) => Object.fromEntries(labels.map(label => [label, 'served ?']))
const boardRows = (plan: any, state: Overlay, labels: string[], columns: number = LIMITS.waveBoardDefaultColumns) =>
  drawPlanBoardRows(plan, { columns, state, notes: notesFor(labels) })
/** A flat row, as the section drew every spawn before the board. */
const flatRow = (s: any) =>
  `${s.title || s.label} · ${s.kind || 'agent'} · routed ${s.model || '?'} · served ? · effort ${s.effort || '?'} · waiting`

/** Every keyed box of the wave section, in the order drawn. */
async function waveSection(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  return boxes.filter((b: any) => typeof b.key === 'string' && b.key.startsWith('wave-'))
}
const texts = (section: any[]) => section.map((b: any) => b.text)

const STATE_COLOR: Record<string, string> = { ok: 'green', failed: 'red', current: 'yellow' }
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

/** A lane's first line: one Text, never a row of elements, its coloured words nested spans. */
function laneLine(el: any) {
  const line = Array.isArray(el?.children) ? el.children[0] : undefined
  expect(line?.type).toBe('Text')
  return line
}
const spansOf = (line: any) => (Array.isArray(line?.children) ? line.children : []).filter((n: any) => n?.type === 'Text')
/** A nested node's text: the kit sets `text` on a found element, not on what it holds. */
const textOf = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n?.children) ? n.children.map(textOf).join('') : '')

/** The state word a lane's line prints, read off its first span. */
async function stateWord(ui: any, label: string) {
  return textOf(spansOf(laneLine(await ui.find({ key: `wave-row-${label}` })))[0])
}

async function expectBoard(ui: any, plan: any, state: Overlay, labels: string[], extra: any[] = [], width: number = LIMITS.waveBoardDefaultColumns) {
  const rows = boardRows(plan, state, labels, width)
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
      expect(card.props.borderDimColor).toBe(true)
      expect(card.props.borderColor).toBeUndefined()
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
    const spans = spansOf(line)
    if (p.state) {
      expect(textOf(spans[0])).toBe(p.state)
      expectStatePaint(spans[0], p.state)
    }
    if (p.state === 'per task' && Array.isArray(p.tasks)) {
      const words = p.tasks.filter((t: any) => t.word)
      expect(spans.slice(1).map(textOf)).toEqual(words.map((t: any) => t.word))
      words.forEach((t: any, i: number) => expectStatePaint(spans[i + 1], t.word))
    }
    // Colour sits on a state word only: no other text in the lane carries a hue.
    for (const n of tree(el)) {
      if (n?.props?.color !== undefined) expect(Object.keys(STATE_COLOR)).toContain(textOf(n))
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

test('the recorded ids colour ok green and failed red; a verify spawn is a flat row beneath the board', async ($: any, on: any) => {
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

test('a RED wave title carries no colour', async ($: any, on: any) => {
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
    const card = await ui.find({ key: 'wave-card-0' })
    expect(card?.props.borderColor).toBeUndefined()
    expect(card?.props.borderDimColor).toBe(true)
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
  for (const body of [min, Math.floor((min + max) / 2), max + 60]) {
    for (const surface of SURFACES) {
      const ui = await mount($, surface, body)
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
    const ui = await mount($, surface, NARROW)
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
