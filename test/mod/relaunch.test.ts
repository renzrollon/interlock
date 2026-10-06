// The launch guard's in-process form under the engine's own test kit
// (guard-ship-relaunch-in-process; spec: hooks/launch-guard).
//
// The settings form's deny and allow table, repeated against the hooks module:
// the first launch, the second with no prompt between, the second after a
// human prompt, the wake between, the resume, the non-ship script, the refused
// launch, the aged launch and the guard whose state cannot be read. The test's
// own `on` hooks stand for the engine beneath the plugin: `classic.PreToolUse`
// is where the settings form would run, and the `Workflow` hook is the engine
// starting the run, so a refusal is asserted by neither of them running.

import { expect, mock, test } from 'claude-code/testing'

import { denyReason } from '../../lib/launch-rule.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { COMPOSER, TASK_NOTIFICATION } from '../fixtures/mod/prompts.mjs'

const T0 = Date.parse('2026-10-05T06:35:01.000Z')
const SHIP = { name: 'interlock:ship', args: 'add-the-thing' }
const HUMAN = ['composer', 'bridge', 'sdk'] as const
const NOT_HUMAN = ['task-notification', 'scheduled-trigger', 'peer', 'channel'] as const
const SURFACES = ['terminal', 'desktop'] as const
const NO_RUN_LINE = 'no ship run is live in this session'

type World = {
  clock: ReturnType<typeof mock.clock>
  classic: number
  engine: any[]
  answers: any[]
  launches: number
  logs: { text: string; to: string }[]
  writes: any[]
  toasts: string[]
}

/** The engine beneath the plugin: a mocked clock, the settings layer, the Workflow tool and the display calls. */
function world(on: any): World {
  const w: World = { clock: mock.clock(on, { now: T0 }), classic: 0, engine: [], answers: [], launches: 0, logs: [], writes: [], toasts: [] }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: '2.1.289', base: '2.1.289', builtAt: '2026-10-03T19:21:39Z' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  const done = { value: undefined }
  on('ui.status', () => done)
  on('ui.toast', (_$: any, e: any) => (w.toasts.push(e.text), done))
  on('ui.invalidate', () => done)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', (_$: any, e: any) => (w.logs.push({ text: e.text, to: e.to }), done))
  on('state.set', (_$: any, e: any, next: any) => (w.writes.push(e.value), next(e)))
  on('classic.PreToolUse', () => {
    w.classic++
    return {}
  })
  on('tool.call', { tool: 'Workflow' }, (_$: any, e: any) => {
    w.engine.push(e)
    if (w.answers.length) return w.answers.shift()
    w.launches++
    const runId = `wf_0000000${w.launches}-run`
    return {
      result: {
        status: 'async_launched',
        taskId: `w${w.launches}`,
        taskType: 'local_workflow',
        runId,
        workflowName: 'interlock:ship',
        scriptPath: `/home/user/.claude/projects/p/s/workflows/scripts/ship-${runId}.js`,
        transcriptDir: `/t/${runId}`
      }
    }
  })
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text, origin: e.origin }))
  on('session.receive', (_$: any, e: any) => ({ text: e.text }))
  return w
}

const start = ($: any, isInteractive = false) =>
  $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const launch = ($: any, input: Record<string, unknown> = SHIP) => $.tool.call({ tool: 'Workflow', ...input })
const prompt = ($: any, kind: string, text = 'ship the leftovers') =>
  $.prompt.submit({ text, wait: false, origin: kind === 'channel' ? { kind, server: 'slack' } : { kind } })
const refused = (r: any) => typeof r.deny === 'string'
const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'interlock',
    surface,
    component: 'Pane',
    requestId: 'interlock-meter',
    props: { title: 'Interlock', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
  })
/** The pane's `launch-guard` line on `surface`, and whether the no-run line stands above it. */
async function guardLine($: any, surface: (typeof SURFACES)[number]) {
  const ui = await mount($, surface)
  const line = (await ui.find({ key: 'launch-guard' }))?.text
  const noRun = (await ui.find({ text: NO_RUN_LINE })) !== undefined
  await ui.unmount()
  return { line, noRun }
}
const lastLaunch = (w: World) => (w.writes.at(-1)?.launches ?? []).at(-1)

for (const isInteractive of [false, true]) {
  const where = isInteractive ? 'an interactive session' : 'a -p session'

  test(`in ${where} the first launch is allowed and recorded; the second with no prompt between is refused`, async ($: any, on: any) => {
    const w = world(on)
    await start($, isInteractive)
    const first = await launch($)
    expect(refused(first)).toBe(false)
    expect(w.engine).toHaveLength(1)
    expect(w.classic).toBe(1)
    expect(lastLaunch(w)).toEqual({
      at: new Date(T0).toISOString(),
      runId: 'wf_00000001-run',
      workflowName: 'interlock:ship',
      scriptPath: '/home/user/.claude/projects/p/s/workflows/scripts/ship-wf_00000001-run.js'
    })

    await w.clock.advance(60_000)
    const second = await launch($)
    expect(refused(second)).toBe(true)
    for (const words of ['Leftover', 'not authorization', 'new message', '/interlock:ship']) expect(second.deny).toContain(words)
    expect(second.deny).toContain(new Date(T0).toISOString())
    expect(w.engine).toHaveLength(1)
    expect(w.classic).toBe(1)
    // The refusal is spoken to the person in the rule's words where anything draws (design D5).
    expect(w.toasts).toEqual(isInteractive ? [second.deny] : [])
  })
}

for (const kind of HUMAN) {
  test(`a ${kind} prompt between two launches allows the second and reaches the model unchanged`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    await launch($)
    await w.clock.advance(1000)
    const text = kind === 'composer' ? COMPOSER.text : 'yes, ship the leftovers'
    const entered = await prompt($, kind, text)
    expect(entered.text).toBe(text)
    expect(entered.drop).toBeUndefined()
    await w.clock.advance(1000)
    const second = await launch($)
    expect(refused(second)).toBe(false)
    expect(w.engine).toHaveLength(2)
    expect(w.writes.at(-1).launches).toHaveLength(2)
    expect(w.writes.at(-1).lastHumanPromptAt).toBe(new Date(T0 + 1000).toISOString())
  })
}

for (const kind of NOT_HUMAN) {
  test(`a ${kind} prompt between two launches does not re-arm the second, and is named on the debug log`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    await launch($)
    await w.clock.advance(1000)
    const text = kind === 'task-notification' ? TASK_NOTIFICATION.text : `a ${kind} message`
    const entered = await prompt($, kind, text)
    expect(entered.text).toBe(text)
    expect(w.logs.filter(l => l.to === 'debug' && l.text.includes(kind))).toHaveLength(1)
    await w.clock.advance(1000)
    const second = await launch($)
    expect(refused(second)).toBe(true)
    expect(w.engine).toHaveLength(1)
  })
}

test('a resume of the recorded run, by run id or by persisted script, is a second launch', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  const recorded = lastLaunch(w)
  await prompt($, 'task-notification', TASK_NOTIFICATION.text)
  await w.clock.advance(1000)
  const byRunId = await launch($, { scriptPath: '/elsewhere/a-copy.js', resumeFromRunId: recorded.runId })
  const byScript = await launch($, { scriptPath: recorded.scriptPath })
  expect(refused(byRunId)).toBe(true)
  expect(refused(byScript)).toBe(true)
  expect(w.engine).toHaveLength(1)
  expect(w.classic).toBe(1)
})

test('a Workflow call on another script is allowed and not recorded', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  w.answers.push({ result: { status: 'async_launched', taskId: 'x', runId: 'wf_other', workflowName: 'deep-research', scriptPath: '/s/other.js' } })
  const other = await launch($, { scriptPath: '/elsewhere/workflows/other.js' })
  expect(refused(other)).toBe(false)
  expect(w.writes).toEqual([])
  await w.clock.advance(1000)
  expect(refused(await launch($))).toBe(false)
  expect(w.engine).toHaveLength(2)
})

test('a launch the engine refused or errored is not recorded', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  w.answers.push({ deny: 'engine: workflow not found' })
  expect(refused(await launch($))).toBe(true)
  w.answers.push({ isError: true, result: 'Error: syntax check failed', text: 'Error: syntax check failed' })
  expect((await launch($)).isError).toBe(true)
  expect(w.writes).toEqual([])
  await w.clock.advance(1000)
  const real = await launch($)
  expect(refused(real)).toBe(false)
  expect(w.writes.at(-1).launches).toHaveLength(1)
})

test('a task-notification delivery is passed on whole, nothing consumed, with one debug line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  const before = w.logs.filter(l => l.to === 'debug').length
  const received = await $.session.receive({ origin: { kind: 'task-notification' }, text: TASK_NOTIFICATION.text })
  expect(received.consumed).toBeUndefined()
  expect(received.text).toBe(TASK_NOTIFICATION.text)
  expect(w.logs.filter(l => l.to === 'debug').length).toBe(before + 1)
  expect(w.writes).toEqual([])
})

test('a launch older than the published age reads as absent', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await w.clock.advance(LIMITS.launchLedgerMaxAgeMs - 1)
  expect(refused(await launch($))).toBe(true)
  await w.clock.advance(2)
  expect(refused(await launch($))).toBe(false)
  expect(w.engine).toHaveLength(2)
})

test('a state read that fails lets the launch through to the settings layer, and says so', async ($: any, on: any) => {
  const w = world(on)
  on('state.get', () => ({ deny: 'state unavailable' }))
  await start($)
  await launch($)
  await w.clock.advance(1000)
  const second = await launch($)
  expect(refused(second)).toBe(false)
  expect(w.classic).toBe(2)
  expect(w.engine).toHaveLength(2)
  expect(w.logs.some(l => l.to === 'debug' && l.text.includes('state unavailable'))).toBe(true)
})

// The pane's launch-guard line (speak-permission-prompts-and-guard-denials
// design D5): the rule's current ruling over the session's record, drawn in
// the no-run pane and the live one alike.
test('the pane\'s launch-guard line follows the session\'s record on both surfaces', async ($: any, on: any) => {
  world(on)
  await start($, true)
  for (const surface of SURFACES) {
    expect(await guardLine($, surface)).toEqual({ line: 'launch guard: next launch allowed', noRun: true })
  }
  await launch($)
  for (const surface of SURFACES) {
    expect((await guardLine($, surface)).line).toBe(`launch guard: next launch refused: ${denyReason(new Date(T0).toISOString())}`)
  }
  await $.prompt.submit(COMPOSER)
  for (const surface of SURFACES) {
    expect((await guardLine($, surface)).line).toBe('launch guard: next launch allowed')
  }
})

test('a state read that fails reads as facts unreadable on the pane, names the read once, and throws nothing', async ($: any, on: any) => {
  const w = world(on)
  on('state.get', () => ({ deny: 'the state is gone' }))
  await start($, true)
  for (const surface of SURFACES) {
    const before = w.logs.filter(l => l.to === 'debug' && l.text.includes('the state is gone')).length
    expect(await guardLine($, surface)).toEqual({ line: 'launch guard: facts unreadable; the next launch is allowed', noRun: true })
    expect(w.logs.filter(l => l.to === 'debug' && l.text.includes('the state is gone')).length).toBe(before + 1)
  }
})

