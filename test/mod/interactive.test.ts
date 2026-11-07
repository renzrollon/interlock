// The interactive surfaces under the engine's own test kit (`claude plugin test .`;
// make-the-run-surfaces-interactive, specs hooks/ship-meter and hooks/spec-meter).
//
// The module still decides nothing: a pane control drafts a line the pane
// printed, the spec pane draws the checkpoint card from what the spec meter
// holds, the waves section draws the plan as a diagram where the surface draws
// SVG, a change of state is told once, the prompt is offered change names and
// run ids for the plugin's own commands, and below the mods floor all of it is
// off. The test's own `on` hooks sit beneath the plugin and stand for the
// engine, answering each call the way tasks.md "Engine facts" records the
// probes on 2.1.295 and 2.1.318: `$.ui.notify` `{ isSent, reason }`,
// `$.ui.copy` `{ isCopied }`, `$.prompt.read` `{ text, cursor }`,
// `$.prompt.fill` `{ isFilled }`, and `prompt.autocomplete` answered
// `{ suggestions: [...] }`.
//
// What the module does on its own (a press, a suggestion request, an interval
// period) runs inside `act`, and the world records any prompt submission,
// command run or tool call that reaches the engine while it does: every test
// ends asserting there was none.

import { expect, mock, test } from 'claude-code/testing'

import { OUTCOMES, QUESTIONS } from '../../lib/checkpoint-card.mjs'
import { drawPlanBoardRows } from '../../lib/draw-plan.mjs'
import { MODS_MIN_HOST_VERSION } from '../../lib/host/claude-env.mjs'
import { denyReason } from '../../lib/launch-rule.mjs'
import { denyText } from '../fixtures/mod/refusals.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import * as P from '../fixtures/mod/preflight.mjs'
import * as R from '../fixtures/mod/spec-run.mjs'
import * as F from '../fixtures/mod/steps.mjs'

const PLUGIN = 'interlock'
const RELAUNCH_REASON = denyReason('2026-10-05T06:00:00.000Z')
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
const T0 = Date.parse('2026-11-06T10:15:00.000Z')
const NEXT = 'interlock run next --results .claude/ship/results.json --json'
const CLOSE_CMD = 'interlock run close --json'
const QUIET_WORD = `quiet ${Math.floor(LIMITS.meterQuietAfterMs / 60_000)} min`
const BATCH_POSITION = `${F.CHANGE} · run-batch · wave 2 · batch 1/2`
const SECTION_INDENT = 2
const NARROW = LIMITS.waveBoardMinColumns - 1
const BOARD_WIDTH = LIMITS.waveBoardDefaultColumns
const ENGINE_ROWS = { suggestions: [{ text: 'engine-row', label: 'engine-row', description: 'the engine beneath' }] }
const FLOOR = MODS_MIN_HOST_VERSION
const BELOW = (() => {
  const [major, minor, patch] = FLOOR.split('.').map(Number)
  return `${major}.${minor}.${patch - 1}`
})()

// The spec run's keyed lines, as the spec skill runs them.
const C = R.CHANGE
const FINDINGS = `.claude/metrics/review-artifacts-${C}-20261106-101500.json`
const NEW_CHANGE = `openspec new change "${C}"`
const STATUS = `openspec status --change "${C}" --json`
const LEDGER = `interlock ledger "${C}" --json`
const VALIDATE = `interlock validate "${C}" --json`
const GATE = `interlock gate --findings ${FINDINGS} --metrics ${C} --json`
const CHECKPOINT = `interlock notify checkpoint "${C}"`
const SPEC_CHECKPOINT_LINE = `interlock spec: ${C} · checkpoint`

type Answer = { result: unknown; text: string; isError?: boolean }
type World = {
  clock: ReturnType<typeof mock.clock>
  // What `session.version` answers: a version text, or `null` to refuse the read.
  version: string | null
  status: (string | undefined)[]
  toasts: string[]
  logs: { text: string; to: string }[]
  opens: string[]
  files: Map<string, string>
  reads: string[]
  bash: Map<string, Answer>
  // The prompt box `prompt.read` answers; `null` refuses the read.
  box: string | null
  // What `prompt.fill` answers for `isFilled`, and every text it was handed.
  fill: boolean
  fills: string[]
  // What `ui.copy` answers for `isCopied`; `null` refuses the copy.
  copy: boolean | null
  copies: { text: string; surface: unknown }[]
  // How `ui.notify` answers: sent, sent nowhere, refused, or never (a call that never settles).
  notify: 'sent' | 'no-channel' | 'refused' | 'never'
  notices: { text: string; title: unknown }[]
  // What the engine's own `prompt.autocomplete` answers beneath the plugin.
  beneath: unknown
  // Whether the module is acting on its own, and what reached the engine while it was.
  acting: boolean
  acts: string[]
  // The run id an accepted launch answers (`null`: a launch the CLI gave no id), and whether the settings form refuses it.
  runId: string | null
  denyLaunch: boolean
}

const ok = (stdout: string): Answer => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout })
const json = (value: unknown) => ok(JSON.stringify(value, null, 2))

/** The captured ladder with every artifact done. */
function allDone(): Answer {
  const value = JSON.parse(R.BASH_STATUS.text)
  for (const a of value.artifacts) {
    a.status = 'done'
    delete a.missingDeps
  }
  return json(value)
}
const STATUS_ARTIFACTS: { id: string; outputPath: string }[] = JSON.parse(R.BASH_STATUS.text).artifacts

/** The engine beneath the plugin, recording every call the module makes. */
function world(on: any, over: Partial<World> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    version: FLOOR,
    status: [],
    toasts: [],
    logs: [],
    opens: [],
    files: new Map(),
    reads: [],
    bash: new Map<string, Answer>([
      [NEW_CHANGE, ok(`✔ Created change '${C}'`)],
      [STATUS, allDone()],
      [LEDGER, json({ blocking: false, needsHuman: 0, invalidCount: 0 })],
      [VALIDATE, json({ change: C, ready: true, problems: [] })],
      [GATE, json({ passed: true, counts: { blocker: 0, warning: 0, suggestion: 0 }, malformed: [] })],
      [CHECKPOINT, ok(`checkpoint: ${C} — waiting for review; nothing is sent`)]
    ]),
    box: '',
    fill: true,
    fills: [],
    copy: true,
    copies: [],
    notify: 'sent',
    notices: [],
    beneath: ENGINE_ROWS,
    acting: false,
    acts: [],
    runId: F.RUN_ID,
    denyLaunch: false,
    ...over
  } as World
  const acted = (what: string) => {
    if (w.acting) w.acts.push(what)
  }
  const done = { value: undefined }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.version', () =>
    w.version === null ? { deny: 'the version cannot be read' } : { value: { version: w.version, base: w.version, builtAt: '2026-11-01T00:00:00Z' } }
  )
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('command.register', (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.status', (_$: any, e: any) => (w.status.push(e.text), done))
  on('ui.toast', (_$: any, e: any) => (w.toasts.push(e.text), done))
  on('ui.log', (_$: any, e: any) => (w.logs.push({ text: e.text, to: e.to }), done))
  on('ui.invalidate', () => done)
  on('ui.scroll', () => ({ value: {} }))
  on('ui.open', (_$: any, e: any) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.read', (_$: any, e: any) => {
    w.reads.push(e.path)
    return w.files.has(e.path) ? { value: w.files.get(e.path) } : { deny: `ENOENT: ${e.path}` }
  })
  on('prompt.read', () => (w.box === null ? { deny: 'the prompt box is gone' } : { value: { text: w.box, cursor: w.box.length } }))
  on('prompt.fill', (_$: any, e: any) => {
    w.fills.push(e.text)
    return { isFilled: w.fill }
  })
  on('ui.copy', (_$: any, e: any) => {
    w.copies.push({ text: e.text, surface: e.surface })
    if (w.copy === null) return { deny: 'the clipboard refused' }
    return { value: w.copy ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } }
  })
  on('ui.notify', (_$: any, e: any) => {
    w.notices.push({ text: e.text, title: e.title })
    if (w.notify === 'never') return new Promise(() => {})
    if (w.notify === 'refused') return { deny: 'notifications refused' }
    return { value: w.notify === 'sent' ? { isSent: true, channel: 'terminal' } : { isSent: false, reason: 'no-channel' } }
  })
  on('prompt.autocomplete', () => w.beneath)
  on('prompt.submit', (_$: any, e: any) => (acted(`prompt.submit ${e.text}`), { text: e.text }))
  on('command.run', (_$: any, e: any) => (acted(`command.run ${e.command}`), {}))
  on('tool.call', { tool: 'Workflow' }, () => {
    acted('tool.call Workflow')
    return {
      result: {
        status: 'async_launched',
        taskId: 'w1',
        taskType: 'local_workflow',
        ...(w.runId === null ? {} : { runId: w.runId }),
        workflowName: 'interlock:ship',
        transcriptDir: '/t/wf'
      }
    }
  })
  on('tool.call', { tool: 'Bash' }, (_$: any, e: any) => (acted(`tool.call Bash ${e.command}`), w.bash.get(e.command) ?? ok('')))
  on('tool.call', { tool: 'Write' }, () => (acted('tool.call Write'), { result: {}, text: 'ok' }))
  // The settings layer's guard-relaunch: a deny ends the call errored, as probe 2 captured.
  on('classic.PreToolUse', (_$: any, e: any) => (e.tool === 'Workflow' && w.denyLaunch ? { deny: denyText(RELAUNCH_REASON, 'Workflow') } : {}))
  return w
}

const start = ($: any, isInteractive = true) => $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const launch = ($: any) => $.tool.call({ tool: 'Workflow', name: 'interlock:ship', args: { change: F.CHANGE } })
const human = ($: any) => $.prompt.submit({ text: 'what changed?', origin: { kind: 'composer' } })
const step = ($: any, w: World, record: unknown, command = NEXT) => {
  w.bash.set(command, ok(F.stdout(record)))
  return $.tool.call({ tool: 'Bash', command })
}
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const loadSpec = ($: any) => $.prompt.submit({ ...R.PROMPT_SPEC, origin: { kind: 'composer' } })
const writeFindings = ($: any) => $.tool.call({ tool: 'Write', file_path: FINDINGS, content: '{}' })
/**
 * Lets a notification the module started, and never awaited, settle: its
 * fallback toast lands after the tool result returned (F-a984320e).
 */
async function settled() {
  for (let n = 0; n < 20; n++) await Promise.resolve()
}
/** The module acting on its own: a press, a suggestion request, an interval period. */
async function act<T>(w: World, fn: () => Promise<T>): Promise<T> {
  w.acting = true
  try {
    return await fn()
  } finally {
    w.acting = false
  }
}
const pane = ($: any, surface: Surface, requestId: string, bodyColumns = 100) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId,
    props: { title: 'Interlock', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
  })
const meter = ($: any, surface: Surface, bodyColumns = BOARD_WIDTH + SECTION_INDENT) => pane($, surface, 'interlock-meter', bodyColumns)
function tree(el: any): any[] {
  if (!el) return []
  const kids = Array.isArray(el.children) ? el.children : []
  return [el, ...kids.flatMap(tree)]
}
const keyOf = (el: any) => (el?.props && typeof el.props.key === 'string' ? el.props.key : undefined)
/** The labels of the Buttons beneath `el`, in the order drawn. */
const labelsIn = (el: any) => tree(el).filter((n: any) => n?.type === 'Button').map((n: any) => n.props.label)
/** Every Button the drawing holds, as `{ key, label }`, in the order drawn. */
async function buttons(ui: any) {
  return (await ui.findAll({ type: 'Button' })).map((b: any) => ({ key: keyOf(b) ?? b.key, label: b.props.label }))
}
/** Press the Button labelled `label` on a fresh mount of the pane, as the module acting. */
async function pressLabel($: any, w: World, surface: Surface, requestId: string, label: string, bodyColumns = 100) {
  const ui = await pane($, surface, requestId, bodyColumns)
  const found = (await buttons(ui)).find((b: any) => b.label === label)
  expect(found).toBeDefined()
  await act(w, () => ui.press({ key: found.key }))
  await ui.unmount()
}
const debugLines = (w: World, pattern: RegExp) => w.logs.filter(l => l.to === 'debug' && pattern.test(l.text))
const autocomplete = ($: any, w: World, text: string) => {
  const token = text.slice(text.lastIndexOf(' ') + 1)
  return act(w, () => $.prompt.autocomplete({ text, cursor: text.length, token, start: text.length - token.length }))
}
/** Clear the previous press's record, for the next case on the same world. */
function clearPresses(w: World) {
  w.fills = []
  w.copies = []
  w.toasts = []
}

// --- the halt card's controls (hooks/ship-meter: the halt card requirement) ---------

/** A world whose preflight lists two cards: add-foo's printing the receipt lines, add-bar's a placeholder and a resume line. */
function handoffWorld(on: any, cards: [string, string][] = [[P.CARD_PATH, P.ACTIONS_CARD_TEXT], [P.SECOND_CARD_PATH, P.PLACEHOLDER_CARD_TEXT]]) {
  return world(on, { files: new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_WITH_CARD)], ...cards]) })
}
const openHandoff = ($: any) => $.command.run({ command: 'interlock-handoff', args: '' })

test('a card\'s printed lines become controls beneath it, in print order and one each, on both surfaces', async ($: any, on: any) => {
  const w = handoffWorld(on)
  await start($)
  await openHandoff($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    expect(labelsIn(await ui.find({ key: 'card-0-actions' }))).toEqual(P.ACTIONS_CARD_LABELS)
    // The placeholder line gets no control; the resume line is copy only.
    expect(labelsIn(await ui.find({ key: 'card-1-actions' }))).toEqual([`Copy: ${P.RESUME_LINE}`])
    expect((await buttons(ui)).some((b: any) => b.label.includes('tasks tick'))).toBe(false)
    // The card itself is still rendered as it was printed, record sentence and all.
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain(P.RECORD_SENTENCE)
    await ui.unmount()
  }
  expect(w.acts).toEqual([])
})

test('a card that cannot be read carries no control, and a line printed after the cut keeps its control', async ($: any, on: any) => {
  const w = handoffWorld(on, [[P.CARD_PATH, P.LONG_ACTIONS_CARD]])
  await start($)
  await openHandoff($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    const text: string = (await ui.find({ type: 'Markdown' }))?.props.text
    expect(text.length).toBeLessThanOrEqual(LIMITS.handoffPaneChars)
    expect(text.includes('interlock run-log show r-1')).toBe(false)
    expect(labelsIn(await ui.find({ key: 'card-0-actions' }))).toEqual(['Draft: interlock run-log show r-1'])
    expect((await ui.find({ key: 'card-1-unread' }))?.text).toMatch(/ENOENT/)
    expect(await ui.find({ key: 'card-1-actions' })).toBeUndefined()
    await ui.unmount()
  }
  expect(w.acts).toEqual([])
})

// --- drafting (hooks/ship-meter "A pane control SHALL draft a line the pane printed…") ---

test('an empty prompt box is filled with exactly the printed line, and nothing is copied or submitted', async ($: any, on: any) => {
  const w = handoffWorld(on)
  await start($)
  await openHandoff($)
  for (const surface of SURFACES) {
    clearPresses(w)
    await pressLabel($, w, surface, 'interlock-handoff', 'Draft: interlock run-log show r-1')
    expect(w.fills).toEqual(['interlock run-log show r-1'])
    expect(w.copies).toEqual([])
    expect(w.toasts).toEqual([])
  }
  expect(w.acts).toEqual([])
})

test('a typed draft is kept and the line is copied, and a refused copy spells the line', async ($: any, on: any) => {
  const w = handoffWorld(on, [[P.CARD_PATH, P.ACTIONS_CARD_TEXT]])
  w.box = 'half a thought'
  await start($)
  await openHandoff($)
  const line = 'interlock run-log show r-1'
  for (const surface of SURFACES) {
    clearPresses(w)
    w.copy = true
    await pressLabel($, w, surface, 'interlock-handoff', `Draft: ${line}`)
    expect(w.fills).toEqual([])
    expect(w.copies).toEqual([{ text: line, surface }])
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toContain('copied')
    expect(w.toasts[0]).toContain('holds a draft')
    expect(w.toasts[0]).toContain(line)
    for (const refused of [false, null]) {
      clearPresses(w)
      w.copy = refused
      await pressLabel($, w, surface, 'interlock-handoff', `Draft: ${line}`)
      expect(w.copies.map(c => c.text)).toEqual([line])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toContain('could not be copied')
      expect(w.toasts[0].endsWith(line)).toBe(true)
    }
  }
  expect(w.acts).toEqual([])
})

test('a resume line is copied whatever the box holds; a refused read or an untaken fill copies too', async ($: any, on: any) => {
  const w = handoffWorld(on)
  await start($)
  await openHandoff($)
  const line = 'interlock run-log show r-1'
  for (const surface of SURFACES) {
    for (const box of ['', 'half a thought']) {
      clearPresses(w)
      w.box = box
      await pressLabel($, w, surface, 'interlock-handoff', `Copy: ${P.RESUME_LINE}`)
      expect(w.fills).toEqual([])
      expect(w.copies).toEqual([{ text: P.RESUME_LINE, surface }])
      expect(w.toasts).toHaveLength(1)
      expect(w.toasts[0]).toContain('copied')
      expect(w.toasts[0]).toContain(P.RESUME_LINE)
    }
    clearPresses(w)
    w.box = null
    await pressLabel($, w, surface, 'interlock-handoff', `Draft: ${line}`)
    expect(w.fills).toEqual([])
    expect(w.copies.map(c => c.text)).toEqual([line])
    expect(w.toasts).toEqual([expect.stringContaining('could not be read')])
    clearPresses(w)
    w.box = ''
    w.fill = false
    await pressLabel($, w, surface, 'interlock-handoff', `Draft: ${line}`)
    expect(w.fills).toEqual([line])
    expect(w.copies.map(c => c.text)).toEqual([line])
    expect(w.toasts).toEqual([expect.stringContaining('did not take it')])
    w.fill = true
  }
  expect(w.acts).toEqual([])
})

// --- the wave diagram (hooks/ship-meter "The meter pane SHALL draw the plan as a diagram…") ---

const ADOPTED_LANES = F.ADOPTION_BATCH.spawns.map((s: any) => s.label)
/** The board's rows the adopted plan's first step implies, as the meter test builds them. */
function adoptedRows() {
  const plan: any = F.ADOPTION_BATCH.plan
  const state = {
    waves: [...plan.waves, ...(plan.testWave ? [plan.testWave] : [])],
    cursor: { waveIndex: 0, batchIndex: 0, phase: 'batch' },
    completed: [],
    failures: [],
    skippedVerifications: [],
    unresolved: [],
    halt: null
  }
  return drawPlanBoardRows(plan, { columns: BOARD_WIDTH, state, notes: Object.fromEntries(ADOPTED_LANES.map((l: string) => [l, 'served ?'])) })
}
/** The keyed wave rows a mount draws, as `[key, text]`, in the order drawn. */
async function waveRows(ui: any) {
  const boxes = await ui.findAll({ type: 'Box' })
  const rows: [string, string][] = []
  for (const b of boxes) {
    const key = keyOf(b) ?? b.key
    if (typeof key === 'string' && key.startsWith('wave-')) rows.push([key, b.text])
  }
  return rows
}
const boxKeys = async (ui: any) => (await ui.findAll({ type: 'Box' })).map((b: any) => keyOf(b) ?? b.key)

test('the desktop draws one diagram above the unchanged board; the terminal draws none', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await step($, w, F.ADOPTION_BATCH)
  const alt = adoptedRows()
    .map((r: any) => r.text)
    .join('\n')
  const terminal = await meter($, 'terminal')
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  const keys = (await boxKeys(terminal)).filter((k: unknown) => typeof k === 'string')
  expect(keys[keys.indexOf('waves-body') + 1]).toBe('wave-board-header')
  const onTerminal = await waveRows(terminal)
  await terminal.unmount()

  const desktop = await meter($, 'desktop')
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(1)
  expect(svgs[0].props.alt).toBe(alt)
  expect(svgs[0].props.source.startsWith('<svg ')).toBe(true)
  const order = (await boxKeys(desktop)).filter((k: unknown) => typeof k === 'string')
  expect(order.indexOf('plan-diagram')).toBeGreaterThan(order.indexOf('waves-body'))
  expect(order.indexOf('plan-diagram')).toBeLessThan(order.indexOf('wave-board-header'))
  // Every board row reads on the desktop what it reads on the terminal.
  expect(await waveRows(desktop)).toEqual(onTerminal)
  await desktop.unmount()
})

/** A plan whose diagram is longer than the published bound: one wave of many lanes. */
function hugePlanStep() {
  const lanes = Array.from({ length: 600 }, (_, n) => [
    { id: `9.${n + 1}`, tier: 2, model: 'sonnet', description: `A long task description that fills the lane box ${n}` }
  ])
  return {
    schema: 'interlock.run-step/1',
    action: 'run-batch',
    change: F.CHANGE,
    wave: 9,
    waveIndex: 0,
    batchIndex: 0,
    batchCount: 1,
    spawns: [],
    banners: [],
    then: { argv: ['run', 'record-batch'] },
    plan: { waves: [{ index: 0, group: 9, kind: 'impl', batches: [lanes] }], deferred: [] }
  }
}

test('a plan over the bound draws one line naming the cap by its limits label, and the board in full', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await step($, w, hugePlanStep())
  const ui = await meter($, 'desktop')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  const left = (await ui.find({ key: 'plan-diagram-left-out' }))?.text
  expect(left).toContain('plan diagram svg chars')
  expect(left).toContain('not drawn')
  expect(await ui.find({ key: 'wave-board-header' })).toBeDefined()
  expect(await ui.find({ key: 'wave-board-tail' })).toBeDefined()
  expect(await ui.find({ key: 'wave-row-9.600' })).toBeDefined()
  await ui.unmount()
})

// F-fe2c6019: an edge the renderer could not place is spoken under the diagram, never left out silently.
test('a lane ordered after an id no lane holds draws the diagram and one dim line naming the edge left out', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  const lanes = [
    [{ id: '9.1', tier: 2, model: 'sonnet', description: 'The first lane' }],
    [{ id: '9.2', tier: 2, model: 'sonnet', description: 'The second lane' }]
  ]
  await step($, w, {
    ...hugePlanStep(),
    plan: { waves: [{ index: 0, group: 9, kind: 'impl', batches: [lanes] }], deferred: [{ id: '9.2', after: ['8.9'] }] }
  })
  const desktop = await meter($, 'desktop')
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(1)
  const line = await desktop.find({ key: 'plan-diagram-unplaced' })
  expect(line?.text).toMatch(/^1 dependency edge\(s\) not drawn: .*after 8\.9: no lane holds 8\.9$/)
  const order = (await boxKeys(desktop)).filter((k: unknown) => typeof k === 'string')
  expect(order.indexOf('plan-diagram-unplaced')).toBe(order.indexOf('plan-diagram') + 1)
  const dim = tree(line).filter((n: any) => n?.type === 'Text')
  expect(dim.length).toBeGreaterThan(0)
  expect(dim[0].props.dimColor).toBe(true)
  await desktop.unmount()
  // A plan whose every edge was placed draws no such line.
  await step($, w, F.ADOPTION_BATCH)
  const placed = await meter($, 'desktop')
  expect(await placed.find({ key: 'plan-diagram-unplaced' })).toBeUndefined()
  await placed.unmount()
  expect(w.acts).toEqual([])
})

test('a run whose plan was not relayed, and a board below its minimum width, draw no diagram and no line about one', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  const unrelayed = await meter($, 'desktop')
  expect(await unrelayed.find({ type: 'Svg' })).toBeUndefined()
  expect(await unrelayed.find({ text: /plan diagram/ })).toBeUndefined()
  await unrelayed.unmount()

  await step($, w, F.ADOPTION_BATCH)
  const narrow = await meter($, 'desktop', NARROW + SECTION_INDENT)
  expect(await narrow.find({ type: 'Svg' })).toBeUndefined()
  expect(await narrow.find({ key: 'plan-diagram-left-out' })).toBeUndefined()
  expect(await narrow.find({ text: /plan diagram/ })).toBeUndefined()
  await narrow.unmount()
})

// --- notification (hooks/ship-meter "The module SHALL tell a halt, a close, a quiet run and a checkpoint…") ---

const HALT_TEXT = `${F.CHANGE} halted: ${F.HALT.reason}`

test('a halt is told when it crosses and not again at the close; a run that did not halt is told at its close record', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  await step($, w, F.HALT)
  expect(w.notices).toEqual([{ text: HALT_TEXT, title: 'Interlock' }])
  await step($, w, F.CLOSE, CLOSE_CMD)
  expect(w.notices).toHaveLength(1)
  expect(w.toasts.filter(t => t.includes('halted'))).toEqual([])

  // A second run in the session that closes with no halt step, launched after a person's prompt.
  await w.clock.advance(60_000)
  await human($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  await step($, w, { ...F.CLOSE, action: 'close', exitCode: 0, banners: [] }, CLOSE_CMD)
  expect(w.notices.slice(1)).toEqual([{ text: `${F.CHANGE} closed (exit 0)`, title: 'Interlock' }])
  expect(w.acts).toEqual([])
})

for (const how of ['no-channel', 'refused'] as const) {
  test(`an engine whose notification is ${how === 'refused' ? 'refused' : 'sent nowhere'} gets a toast in the same words, and the run is as it was`, async ($: any, on: any) => {
    const w = world(on, { notify: how })
    await start($)
    await loadSpec($)
    for (const command of [NEW_CHANGE, STATUS, LEDGER, VALIDATE, GATE, CHECKPOINT]) await bash($, command)
    await settled()
    expect(w.notices.map(n => n.text)).toEqual([SPEC_CHECKPOINT_LINE])
    expect(w.toasts).toEqual([SPEC_CHECKPOINT_LINE])
    expect(w.status.at(-1)).toBe(SPEC_CHECKPOINT_LINE)
    const ui = await pane($, 'terminal', 'interlock-spec')
    expect((await ui.find({ key: 'spec-checkpoint' }))?.text).toBe(`checkpoint reached ${new Date(T0).toISOString()}`)
    await ui.unmount()
    expect(w.acts).toEqual([])
  })
}

test('quiet is told once per stretch, at its first appearance, in the status line\'s words', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  await act(w, () => w.clock.advance(LIMITS.meterQuietAfterMs))
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`)
  expect(w.notices.map(n => n.text)).toEqual([`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`])
  await act(w, () => w.clock.advance(4 * LIMITS.meterTickMs))
  expect(w.notices).toHaveLength(1)
  // Activity clears the word; its next appearance is a stretch of its own.
  await step($, w, F.RUN_BATCH)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  await act(w, () => w.clock.advance(LIMITS.meterQuietAfterMs))
  expect(w.notices.map(n => n.text)).toEqual([`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`, `interlock: ${BATCH_POSITION} · ${QUIET_WORD}`])
  expect(w.toasts.filter(t => t.includes('quiet'))).toEqual([])
  expect(w.acts).toEqual([])
})

test('a session the engine reported as not interactive is told nothing and toasted nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($, false)
  await launch($)
  await step($, w, F.RUN_BATCH)
  await act(w, () => w.clock.advance(LIMITS.meterQuietAfterMs + LIMITS.meterTickMs))
  await step($, w, F.HALT)
  await step($, w, F.CLOSE, CLOSE_CMD)
  await loadSpec($)
  for (const command of [NEW_CHANGE, STATUS, CHECKPOINT]) await bash($, command)
  expect(w.notices).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.acts).toEqual([])
})

// F-a984320e, blast radius B3/B4/B8: nothing on a tool result's path, or the interval's, waits on the notification.
test('a notification that never settles holds neither the relay\'s Bash result nor the spec skill\'s checkpoint line', async ($: any, on: any) => {
  const w = world(on, { notify: 'never' })
  await start($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  const halted = await step($, w, F.HALT)
  expect(halted.text).toBe(F.stdout(F.HALT))
  expect(w.notices.map(n => n.text)).toEqual([HALT_TEXT])
  // The told key was marked before the call, so a pending halt is not asked for twice.
  await step($, w, F.HALT)
  expect(w.notices).toHaveLength(1)
  const closed = await step($, w, F.CLOSE, CLOSE_CMD)
  expect(closed.text).toBe(F.stdout(F.CLOSE))

  await loadSpec($)
  for (const command of [NEW_CHANGE, STATUS, LEDGER, VALIDATE, GATE]) await bash($, command)
  const checkpoint = await bash($, CHECKPOINT)
  expect(checkpoint.text).toBe(`checkpoint: ${C} — waiting for review; nothing is sent`)
  expect(w.notices.map(n => n.text)).toEqual([HALT_TEXT, SPEC_CHECKPOINT_LINE])
  // A pending call is not refused, so nothing is toasted in its place.
  expect(w.toasts.filter(t => t === HALT_TEXT || t === SPEC_CHECKPOINT_LINE)).toEqual([])
  expect(w.acts).toEqual([])
})

test('while the quiet notification is pending, a later period still redraws the word', async ($: any, on: any) => {
  const w = world(on, { notify: 'never' })
  await start($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  await act(w, () => w.clock.advance(LIMITS.meterQuietAfterMs))
  expect(w.notices.map(n => n.text)).toEqual([`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`])
  const later = `quiet ${Math.floor((LIMITS.meterQuietAfterMs + 60_000) / 60_000)} min`
  await act(w, () => w.clock.advance(60_000))
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION} · ${later}`)
  expect(w.notices).toHaveLength(1)
  expect(w.acts).toEqual([])
})

// F-d8976ec7, F-9e68a52f, F-3c7bc5d8: a second run in one session is a new set of changes of state.
for (const runId of [F.RUN_ID, null]) {
  test(`a second run in the session ${runId === null ? 'with no run id ' : ''}is told its own quiet and halt; a repeat is skipped on the debug log`, async ($: any, on: any) => {
    const w = world(on, { runId })
    await start($)
    for (let n = 1; n <= 2; n++) {
      await w.clock.advance(60_000)
      await human($)
      await launch($)
      await step($, w, F.RUN_BATCH)
      await act(w, () => w.clock.advance(LIMITS.meterQuietAfterMs))
      await step($, w, F.HALT)
      await step($, w, F.HALT)
      await step($, w, F.CLOSE, CLOSE_CMD)
      expect(w.notices.map(x => x.text)).toEqual(
        Array.from({ length: n }, () => [`interlock: ${BATCH_POSITION} · ${QUIET_WORD}`, HALT_TEXT]).flat()
      )
    }
    // Per run, the repeated halt step and the halted close record each cross a told key.
    const skipped = debugLines(w, /^interlock meter: halt:\S+ was already told; not told again$/).map(l => l.text)
    expect(skipped).toHaveLength(4)
    expect(new Set(skipped).size).toBe(runId === null ? 2 : 1)
    expect(w.acts).toEqual([])
  })
}

// --- suggestions (hooks/ship-meter "The module SHALL suggest open change names and recent run ids…") ---

const row = (name: string, description: string) => ({ text: name, label: name, description })

test('a ship command is offered the open changes that match, ahead of the engine\'s rows; a run-log command the runs', async ($: any, on: any) => {
  const w = world(on, { files: new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_ALL_OK)]]) })
  await start($)
  await human($)
  expect(await autocomplete($, w, '/interlock:ship add-')).toEqual({
    suggestions: [row('add-foo', 'open change'), row('add-bar', 'open change'), ...ENGINE_ROWS.suggestions]
  })
  expect(await autocomplete($, w, 'interlock run-log show r-')).toEqual({
    suggestions: [row('r-3', 'recent run'), row('r-2', 'recent run'), row('r-1', 'recent run'), ...ENGINE_ROWS.suggestions]
  })
  expect(await autocomplete($, w, 'interlock run-log query --run r-')).toEqual({
    suggestions: [row('r-3', 'recent run'), row('r-2', 'recent run'), row('r-1', 'recent run'), ...ENGINE_ROWS.suggestions]
  })
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  expect(w.acts).toEqual([])
})

test('a session that holds no report reads the preflight file once, at the first request that asks', async ($: any, on: any) => {
  const w = world(on, { files: new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_ALL_OK)]]) })
  await start($)
  expect(await autocomplete($, w, 'fix the tests in add-')).toEqual(ENGINE_ROWS)
  expect(w.reads).toEqual([])
  const first = await autocomplete($, w, '/interlock:ship add-')
  expect(first.suggestions.slice(0, 2)).toEqual([row('add-foo', 'open change'), row('add-bar', 'open change')])
  await autocomplete($, w, '/interlock:ship fix-')
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  expect(w.acts).toEqual([])
})

// Blast radius B7(a): a read that ran before the preflight wrote its file is not the session's last.
test('a read that found no report is tried again a meter tick later, and not before', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(await autocomplete($, w, '/interlock:ship add-')).toEqual(ENGINE_ROWS)
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  // The preflight writes its file after the first read lost the race.
  w.files.set(P.PREFLIGHT_PATH, P.stdout(P.REPORT_ALL_OK))
  await w.clock.advance(LIMITS.meterTickMs - 1)
  expect(await autocomplete($, w, '/interlock:ship add-')).toEqual(ENGINE_ROWS)
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  await w.clock.advance(1)
  const found = await autocomplete($, w, '/interlock:ship add-')
  expect(found.suggestions.slice(0, 2)).toEqual([row('add-foo', 'open change'), row('add-bar', 'open change')])
  expect(w.reads).toEqual([P.PREFLIGHT_PATH, P.PREFLIGHT_PATH])
  // A report held is not read again.
  await w.clock.advance(LIMITS.meterTickMs)
  await autocomplete($, w, '/interlock:ship fix-')
  expect(w.reads).toEqual([P.PREFLIGHT_PATH, P.PREFLIGHT_PATH])
  expect(w.acts).toEqual([])
})

const NO_LIST_CASES: [string, () => Map<string, string>, string][] = [
  ['a null list', () => new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_NULL_LISTS)]]), "the preflight report's openChanges is null"],
  ['no report', () => new Map(), 'no preflight report']
]
for (const [what, files, missing] of NO_LIST_CASES) {
  test(`no list, no rows: ${what} leaves the engine's answer, said once, with no second read`, async ($: any, on: any) => {
    const w = world(on, { files: files() })
    await start($)
    expect(await autocomplete($, w, '/interlock:ship add-')).toEqual(ENGINE_ROWS)
    expect(await autocomplete($, w, '/interlock:ship add-')).toEqual(ENGINE_ROWS)
    expect(w.reads).toEqual([P.PREFLIGHT_PATH])
    const said = debugLines(w, /no suggestion rows/)
    expect(said).toHaveLength(1)
    expect(said[0].text).toContain(missing)
    expect(w.acts).toEqual([])
  })
}

// The engine pins the shape of its own answer: under the kit a hook beneath that
// answers anything but `{ suggestions: [...] }` is skipped by the engine itself
// ("returned no { suggestions } (a list)"), so the module's branch for another
// shape (returned as it came, said once on the debug log) is defensive and
// cannot be reached here. What the kit can show is the pinned shape at its
// smallest: the engine's own empty list gets the module's rows alone.
test('the engine\'s own answer is the pinned { suggestions } list; an empty one gets the module\'s rows alone', async ($: any, on: any) => {
  const w = world(on, { files: new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_ALL_OK)]]), beneath: { suggestions: [] } })
  await start($)
  await human($)
  expect(await autocomplete($, w, '/interlock:ship fix-')).toEqual({ suggestions: [row('fix-baz', 'open change')] })
  expect(await autocomplete($, w, '/interlock:ship zzz-')).toEqual({ suggestions: [] })
  expect(debugLines(w, /not a list of rows/)).toEqual([])
  expect(w.acts).toEqual([])
})

test('more names than the cap give the cap\'s rows, newest first; another command, argument or word gets the engine\'s answer', async ($: any, on: any) => {
  const w = world(on, { files: new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_MANY_CHANGES)]]) })
  await start($)
  await human($)
  const answer = await autocomplete($, w, '/interlock:ship add-')
  const mine = answer.suggestions.slice(0, -ENGINE_ROWS.suggestions.length)
  expect(mine).toHaveLength(LIMITS.promptSuggestRows)
  expect(mine.map((r: any) => r.text)).toEqual(P.REPORT_MANY_CHANGES.openChanges.names.slice(0, LIMITS.promptSuggestRows))
  for (const draft of ['fix the tests in add-', '/interlock:ship add-foo --str', '/interlock:shi']) {
    expect(await autocomplete($, w, draft)).toEqual(ENGINE_ROWS)
  }
  expect(w.acts).toEqual([])
})

// --- the floor (hooks/ship-meter "Below the mods floor a loaded module SHALL draw, tell and suggest nothing…") ---

const FILES = () => new Map([[P.PREFLIGHT_PATH, P.stdout(P.REPORT_ALL_OK)]])

test('an engine at the floor draws, tells and suggests, and no toast names a version', async ($: any, on: any) => {
  const w = world(on, { files: FILES() })
  await start($)
  await human($)
  await launch($)
  await step($, w, F.RUN_BATCH)
  expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
  expect(w.opens).toEqual(['interlock-meter'])
  await step($, w, F.HALT)
  expect(w.notices.map(n => n.text)).toEqual([HALT_TEXT])
  expect((await autocomplete($, w, '/interlock:ship add-')).suggestions[0]).toEqual(row('add-foo', 'open change'))
  expect(w.toasts.filter(t => t.includes(FLOOR))).toEqual([])
  expect(w.acts).toEqual([])
})

test('an engine one patch below the floor is told once, draws nothing for the run, and the guard still denies', async ($: any, on: any) => {
  const w = world(on, { version: BELOW, files: FILES() })
  await start($)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain(BELOW)
  expect(w.toasts[0]).toContain(FLOOR)
  expect(w.toasts[0]).toContain('off on this engine')
  await human($)
  await w.clock.advance(1000)
  const first = await launch($)
  expect(typeof first.deny).toBe('undefined')
  await step($, w, F.RUN_BATCH)
  await step($, w, F.HALT)
  await act(w, () => w.clock.advance(LIMITS.meterTickMs))
  expect(w.status).toEqual([])
  expect(w.opens).toEqual([])
  expect(w.notices).toEqual([])
  expect(await autocomplete($, w, '/interlock:ship add-')).toEqual(ENGINE_ROWS)
  for (const surface of SURFACES) {
    const ui = await meter($, surface)
    expect(await ui.find({ text: /no ship run is live/ })).toBeDefined()
    await ui.unmount()
  }
  await w.clock.advance(60_000)
  const second = await launch($)
  expect(second.deny).toBe(denyReason(new Date(T0 + 1000).toISOString()))
  // The floor turns the panes off, never the guard's words (F-230d42e9): the refusal is toasted as at the floor.
  expect(w.toasts).toHaveLength(2)
  expect(w.toasts[1]).toBe(second.deny)
  expect(w.acts).toEqual([])
})

test('below the floor the settings form\'s refusal is toasted once per text, and no pane is drawn', async ($: any, on: any) => {
  const w = world(on, { version: BELOW, denyLaunch: true })
  await start($)
  expect(w.toasts).toHaveLength(1)
  for (let n = 0; n < 2; n++) {
    const r = await launch($)
    expect(r.isError).toBe(true)
    expect(r.text).toBe(denyText(RELAUNCH_REASON, 'Workflow'))
  }
  expect(w.toasts.slice(1)).toEqual([RELAUNCH_REASON])
  expect(w.opens).toEqual([])
  expect(w.status).toEqual([])
  expect(w.notices).toEqual([])
  expect(w.acts).toEqual([])
})

for (const version of [null, 'a build with no number']) {
  test(`a version ${version === null ? 'that cannot be read' : 'that is no version'} leaves the session as the engine reported it, said once`, async ($: any, on: any) => {
    const w = world(on, { version })
    await start($)
    expect(debugLines(w, /version could not be read/)).toHaveLength(1)
    expect(w.toasts).toEqual([])
    await launch($)
    await step($, w, F.RUN_BATCH)
    expect(w.status.at(-1)).toBe(`interlock: ${BATCH_POSITION}`)
    expect(w.acts).toEqual([])
  })
}

// --- the checkpoint card (hooks/spec-meter "At the checkpoint the spec pane SHALL draw the checkpoint card…") ---

/** The spec run up to its checkpoint, each keyed line in turn; `skip` names lines that never cross. */
async function toCheckpoint($: any, { skip = [] as string[], findings = false } = {}) {
  await loadSpec($)
  for (const command of [NEW_CHANGE, STATUS, LEDGER, VALIDATE, GATE]) if (!skip.includes(command)) await bash($, command)
  if (findings) await writeFindings($)
  await bash($, CHECKPOINT)
}
/** The checkpoint card's keyed lines a mount draws, by key. */
async function cardLines(ui: any) {
  const lines = new Map<string, string>()
  for (const b of await ui.findAll({ type: 'Box' })) {
    const key = keyOf(b) ?? b.key
    if (typeof key === 'string' && key.startsWith('checkpoint-')) lines.set(key, b.text)
  }
  return lines
}

test('a clean checkpoint lists the artifacts, the three observed lines and the five outcomes, and drafts the ship line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await toCheckpoint($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    const lines = await cardLines(ui)
    for (const q of QUESTIONS) {
      const path = STATUS_ARTIFACTS.find(a => a.id === q.id)!.outputPath
      expect(lines.get(`checkpoint-artifact-${q.id}`)).toBe(`${path} · done · ${q.question}`)
    }
    // The three observed lines are the spec pane's own, as they crossed.
    for (const kind of ['ledger', 'validate', 'gate']) {
      expect(lines.get(`checkpoint-${kind}`)).toBe((await ui.find({ key: `spec-${kind}` }))?.text)
    }
    expect(lines.get('checkpoint-ledger')).toMatch(/blocking false/)
    expect(lines.get('checkpoint-validate')).toMatch(/ready true/)
    expect(lines.get('checkpoint-gate')).toMatch(/passed true/)
    OUTCOMES.forEach((o: any, i: number) => expect(lines.get(`checkpoint-outcome-${i + 1}`)?.startsWith(o.title)).toBe(true))
    // The card follows the meter's own cards.
    const keys = (await boxKeys(ui)).filter((k: unknown) => typeof k === 'string')
    expect(keys.indexOf('checkpoint-artifact-proposal')).toBeGreaterThan(keys.indexOf('spec-record'))
    expect(labelsIn(await ui.find({ key: 'checkpoint-outcome-5' }))).toEqual([])
    expect((await buttons(ui)).map((b: any) => b.label)).toContain(`Draft: /interlock:ship ${C}`)
    await ui.unmount()
    clearPresses(w)
    await pressLabel($, w, surface, 'interlock-spec', `Draft: /interlock:ship ${C}`)
    expect(w.fills).toEqual([`/interlock:ship ${C}`])
    expect(w.copies).toEqual([])
  }
  expect(w.acts).toEqual([])
})

test('a line that never crossed reads not observed, and reported blockers offer the re-gate only with a findings file', async ($: any, on: any) => {
  const w = world(on)
  w.bash.set(GATE, json({ passed: false, counts: { blocker: 1, warning: 0, suggestion: 0 }, malformed: [] }))
  await start($)
  await toCheckpoint($, { skip: [LEDGER], findings: true })
  const regate = `Draft: /interlock:review-artifacts ${C} --since ${FINDINGS}`
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    const lines = await cardLines(ui)
    expect(lines.get('checkpoint-ledger')).toBe('ledger: not observed')
    expect(lines.get('checkpoint-gate')).toMatch(/passed false/)
    expect(lines.get('checkpoint-findings')).toBe(`findings file: ${FINDINGS}`)
    expect((await buttons(ui)).map((b: any) => b.label)).toContain(regate)
    await ui.unmount()
  }

  // A run in which no findings file was observed: the outcome says so and carries no re-gate control.
  await toCheckpoint($, { skip: [LEDGER] })
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    const lines = await cardLines(ui)
    expect(lines.get('checkpoint-findings')).toBe('findings file: not observed')
    expect(lines.get('checkpoint-outcome-4')).toContain('no findings file was observed')
    expect((await buttons(ui)).some((b: any) => b.label.startsWith('Draft: /interlock:review-artifacts'))).toBe(false)
    await ui.unmount()
  }
  expect(w.acts).toEqual([])
})

test('no card before the checkpoint, after a hand-over or with no run; below the card floor it is flat with its controls', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    expect((await cardLines(ui)).size).toBe(0)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
  await loadSpec($)
  await bash($, STATUS)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    expect((await cardLines(ui)).size).toBe(0)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
  await bash($, CHECKPOINT)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec', 40)
    const bordered = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props && b.props.borderStyle !== undefined)
    expect(bordered).toEqual([])
    const lines = await cardLines(ui)
    expect(lines.get('checkpoint-artifact-proposal')).toBeDefined()
    expect((await buttons(ui)).map((b: any) => b.label)).toContain(`Draft: /interlock:ship ${C}`)
    await ui.unmount()
  }
  await launch($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-spec')
    expect((await ui.find({ key: 'spec-handover' }))?.text).toMatch(/^handed over to ship/)
    expect((await cardLines(ui)).size).toBe(0)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
  expect(w.acts).toEqual([])
})

test('a checkpoint is told once with the status line\'s words, and a new spec run\'s checkpoint is told again', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await toCheckpoint($)
  expect(w.notices).toEqual([{ text: SPEC_CHECKPOINT_LINE, title: 'Interlock' }])
  expect(w.toasts).toEqual([])
  await toCheckpoint($)
  expect(w.notices.map(n => n.text)).toEqual([SPEC_CHECKPOINT_LINE, SPEC_CHECKPOINT_LINE])
  expect(w.acts).toEqual([])
})
