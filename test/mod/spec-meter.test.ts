// The spec meter under the engine's own test kit (`claude plugin test .`).
//
// The test's own `on` hooks sit beneath the plugin and stand for the engine,
// answering each event with what Claude Code 2.1.291 answered when the probes
// captured it (`test/fixtures/mod/spec-run.mjs`): the typed load of the spec
// skill, a Skill tool load, an Explore spawn, and the Bash results of the
// keyed lines, the failed ones errored behind their `Exit code 1` line. The
// rules themselves are `lib/spec-meter.mjs`'s and are tested under Node
// (`test/spine/spec-meter.test.mjs`); this file proves the wiring: what starts
// a run, what the status line and the pane say, the three ends, and that every
// hook resolves to what the engine alone would have done
// (observe-the-spec-run-live design D10).

import { expect, mock, test } from 'claude-code/testing'

import * as F from '../fixtures/mod/steps.mjs'
import * as R from '../fixtures/mod/spec-run.mjs'

const PLUGIN = 'interlock'
const PANE = 'interlock-spec'
const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-07T06:35:01.000Z')
const C = R.CHANGE
const UNKNOWN = 'change: unknown until named'
const NO_RUN = 'no spec run is live in this session'
const RECORD = "the artifacts on disk, the findings file and the gate's exit are the record"
const SPEC_DEBUG = /^interlock spec: /
const NEXT = 'interlock run next --results .claude/ship/results.json --json'

const NEW_CHANGE = `openspec new change "${C}"`
const STATUS = `openspec status --change "${C}" --json`
const LEDGER = `interlock ledger "${C}" --json`
const VALIDATE = `interlock validate "${C}" --json`
const GATE = R.BASH_GATE_BLOCKED.command
const CHECKPOINT = `interlock notify checkpoint "${C}"`
const READY = `interlock ready "${C}" --findings .claude/metrics/review-artifacts-${C}-20261007-120000.json --paths hello.txt --json`
const BRIEF = `.claude/handoff/explore-${C}-20261007-120000.md`
const FINDINGS = `.claude/metrics/review-artifacts-${C}-20261007-121500.json`

type Answer = { result: unknown; text: string; isError?: boolean }
type World = {
  status: (string | undefined)[]
  toasts: string[]
  logs: { text: string; to: string }[]
  opens: string[]
  commands: string[]
  bash: Map<string, Answer>
  writeErrors: Set<string>
  spawned: string[]
}

/** A clean exit as the engine resolves it: the command's stdout, kept and read. */
const ok = (stdout: string): Answer => ({ result: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, text: stdout })
const json = (value: unknown) => ok(JSON.stringify(value, null, 2))
const captured = (fixture: any): Answer => ({ result: fixture.result, text: fixture.text, ...(fixture.isError ? { isError: true } : {}) })

/** The captured ladder with every artifact done and OpenSpec's roll-up saying so. */
function allDone(): Answer {
  const value = JSON.parse(R.BASH_STATUS.text)
  value.isComplete = true
  value.isPlanningComplete = true
  for (const a of value.artifacts) {
    a.status = 'done'
    delete a.missingDeps
  }
  return json(value)
}

/** The engine beneath the plugin, recording every display call the module makes. */
function world(on: any, { placed = true }: { placed?: boolean } = {}): World {
  const w: World = {
    status: [],
    toasts: [],
    logs: [],
    opens: [],
    commands: [],
    bash: new Map<string, Answer>([
      [NEW_CHANGE, ok(`- Creating change '${C}'...\n✔ Created change '${C}'`)],
      [STATUS, captured(R.BASH_STATUS)],
      [LEDGER, captured(R.BASH_LEDGER_BLOCKING)],
      [VALIDATE, json({ change: C, ready: true, problems: [] })],
      [GATE, captured(R.BASH_GATE_BLOCKED)],
      [CHECKPOINT, ok('push: not configured — set INTERLOCK_NTFY_TOPIC')],
      [READY, json({ ready: true, change: C, blockers: [] })],
      [R.BASH_LEDGER_TEXT.command, captured(R.BASH_LEDGER_TEXT)]
    ]),
    writeErrors: new Set(),
    spawned: []
  }
  mock.clock(on, { now: T0 })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('session.version', () => ({ value: { version: '2.1.291', base: '2.1.291', builtAt: '2026-10-06T19:21:39Z' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('command.register', (_$: any, e: any) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  const done = { value: undefined }
  on('ui.status', (_$: any, e: any) => (w.status.push(e.text), done))
  on('ui.toast', (_$: any, e: any) => (w.toasts.push(e.text), done))
  on('ui.log', (_$: any, e: any) => (w.logs.push({ text: e.text, to: e.to }), done))
  on('ui.invalidate', () => done)
  on('ui.open', (_$: any, e: any) => {
    w.opens.push(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'unasked below the width floor' } }
  })
  on('fs.read', (_$: any, e: any) => ({ deny: `ENOENT: ${e.path}` }))
  on('tool.call', { tool: 'Skill' }, (_$: any, e: any) => ({ result: `Launching skill: ${e.skill}`, text: `Launching skill: ${e.skill}` }))
  on('tool.call', { tool: 'Bash' }, (_$: any, e: any) => w.bash.get(e.command) ?? ok(''))
  const write = (_$: any, e: any) => (w.writeErrors.has(e.file_path) ? { result: 'Error: refused', text: 'refused', isError: true } : { result: {}, text: 'ok' })
  on('tool.call', { tool: 'Edit' }, write)
  on('tool.call', { tool: 'Write' }, write)
  on('agent.spawn', (_$: any, e: any) => {
    w.spawned.push(e.subagentType)
    return { model: 'claude-opus-5-5', agentId: `x${w.spawned.length}` }
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
  return w
}

const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const loadSpec = ($: any) => $.prompt.submit({ ...R.PROMPT_SPEC, origin: { kind: 'composer' } })
const skill = ($: any, name: unknown) => $.tool.call({ tool: 'Skill', skill: name, args: '' })
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const write = ($: any, file_path?: string) => $.tool.call({ tool: 'Write', ...(file_path === undefined ? {} : { file_path }), content: 'x' })
const explore = ($: any, n: number) =>
  Promise.all(Array.from({ length: n }, (_, i) => $.agent.spawn({ ...R.SPAWN_EXPLORE.input, description: `investigator ${i}` })))
const launch = ($: any, input: Record<string, unknown> = { name: 'interlock:ship', args: { change: C } }) =>
  $.tool.call({ tool: 'Workflow', ...input })
const specLogs = (w: World) => w.logs.filter(l => l.to === 'debug' && SPEC_DEBUG.test(l.text))
const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Interlock spec', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
  })
/** Every keyed line the pane draws on `surface`, by key. */
async function pane($: any, surface: (typeof SURFACES)[number]) {
  const ui = await mount($, surface)
  const boxes = await ui.findAll({ type: 'Box' })
  const lines = new Map<string, string>()
  for (const b of boxes) if (b.props && typeof b.props.key === 'string') lines.set(b.props.key, (await ui.find({ key: b.props.key }))?.text ?? '')
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? t.props?.children ?? '').join('\n')
  await ui.unmount()
  return { lines, all }
}
const line = async ($: any, surface: (typeof SURFACES)[number], key: string) => {
  const ui = await mount($, surface)
  const text = (await ui.find({ key }))?.text
  await ui.unmount()
  return text
}

/** The happy path up to the gate, as the spec skill runs it. */
async function happyPath($: any) {
  await loadSpec($)
  await bash($, NEW_CHANGE)
  await bash($, STATUS)
  await bash($, LEDGER)
  await bash($, VALIDATE)
  await bash($, GATE)
}

test('session.start registers /interlock-spec after the three earlier commands', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual(['interlock-meter', 'interlock-preflight', 'interlock-handoff', PANE])
})

test('the spec skill\'s typed load starts the run, opens the pane, and the CLI names the change', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  const r = await loadSpec($)
  expect(r).toEqual({ text: R.PROMPT_SPEC.text })
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN}`)
  expect(w.opens).toEqual([PANE])
  await bash($, NEW_CHANGE)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · new change`)
  for (const surface of SURFACES) expect(await line($, surface, 'spec-header')).toBe(C)
})

test('a Skill tool load of the spec skill starts the run too, and its result is the engine\'s', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  const r = await skill($, 'interlock:spec')
  expect(r.text).toBe('Launching skill: interlock:spec')
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN}`)
})

test('the ladder, the ledger, validate and the gate advance the status line in the CLI\'s words', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await happyPath($)
  expect(w.status.slice(-5)).toEqual([
    `interlock spec: ${C} · new change`,
    `interlock spec: ${C} · status 2/4 done · next: design`,
    `interlock spec: ${C} · ledger blocking (needs_human 2 · invalid 0)`,
    `interlock spec: ${C} · validate READY`,
    `interlock spec: ${C} · gate BLOCKED (blocker 1 · warning 3)`
  ])
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-artifact-proposal')).toBe('proposal · done · proposal.md')
    expect(lines.get('spec-artifact-design')).toBe('design · ready · design.md')
    expect(lines.get('spec-artifact-specs')).toBe('specs · done · specs/**/*.md')
    expect(lines.get('spec-artifact-tasks')).toBe('tasks · blocked · tasks.md')
    expect(lines.get('spec-ledger')).toBe('ledger: blocking true · needsHuman 2 · invalidCount 0 · missing false · unparseable false')
    expect(lines.get('spec-validate')).toBe('validate: ready true · problems 0')
    expect(lines.get('spec-gate')).toMatch(/^gate: passed false · blocker 1 · warning 3 · suggestion 0 · malformed 0 · metrics /)
    expect(lines.get('spec-record')).toBe(RECORD)
  }
})

test('a text ledger line is shown unparsed with its first line, never as a verdict', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  const r = await bash($, R.BASH_LEDGER_TEXT.command)
  expect(r.text).toBe(R.BASH_LEDGER_TEXT.text)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · ledger (unparsed)`)
  expect(specLogs(w).filter(l => /ledger result not read/.test(l.text))).toHaveLength(1)
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-ledger')).toMatch(/^ledger: not read \(output not JSON\) · DECISIONS BLOCKING — 2 row\(s\)/)
    expect(lines.get('spec-gate')).toBe('gate: not run yet')
  }
  for (const text of w.status) expect(text ?? '').not.toMatch(/\b(clear|pass|blocked)\b/i)
})

test('an all-done ladder reads its count, the word complete appears nowhere', async ($: any, on: any) => {
  const w = world(on)
  w.bash.set(STATUS, allDone())
  await start($)
  await loadSpec($)
  await bash($, STATUS)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · status 4/4 done`)
  for (const surface of SURFACES) expect((await pane($, surface)).all).not.toMatch(/complete/i)
  for (const text of w.status) expect(text ?? '').not.toMatch(/complete/i)
})

test('a write after a status call is counted and leaves the table as the status printed it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await bash($, STATUS)
  await write($, `openspec/changes/${C}/tasks.md`)
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-artifact-tasks')).toBe('tasks · blocked · tasks.md')
    expect(lines.get('spec-write-tasks.md')).toMatch(/^tasks\.md · written 1× · last 2026-10-07T/)
  }
})

test('an autonomy line keeps its command word and nothing of what the CLI printed', async ($: any, on: any) => {
  const w = world(on)
  const command = 'interlock autonomy record review-artifacts --blockers 1'
  w.bash.set(command, ok('review-artifacts: L1 (0/3 clean)'))
  await start($)
  await loadSpec($)
  await bash($, STATUS)
  await bash($, command)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · autonomy record`)
  for (const surface of SURFACES) {
    const { lines, all } = await pane($, surface)
    expect(lines.get('spec-autonomy')).toBe('autonomy: record')
    expect(all).not.toMatch(/L1|0\/3|clean/)
  }
  for (const text of w.status) expect(text ?? '').not.toMatch(/L1|0\/3|clean/)
})

test('explore\'s spawns and brief, two artifact writes and the findings file are counted, never read', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await skill($, 'interlock:explore')
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN} · explore`)
  const spawned = await explore($, 3)
  expect(spawned.map((r: any) => r.agentId).sort()).toEqual(['x1', 'x2', 'x3'])
  expect(spawned.every((r: any) => r.model === 'claude-opus-5-5')).toBe(true)
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN} · explore (3 investigators)`)
  await write($, BRIEF)
  await bash($, STATUS)
  await write($, `openspec/changes/${C}/proposal.md`)
  await write($, `openspec/changes/${C}/proposal.md`)
  await skill($, 'interlock:review-artifacts')
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · review-artifacts`)
  await write($, FINDINGS)
  for (const surface of SURFACES) {
    const { lines, all } = await pane($, surface)
    expect(lines.get('spec-explore')).toBe(`explore: 3 investigators spawned · brief ${BRIEF}`)
    expect(lines.get('spec-write-proposal.md')).toMatch(/^proposal\.md · written 2× · last 2026-10-07T/)
    expect(lines.get('spec-findings')).toBe(`findings file: ${FINDINGS}`)
    expect(lines.get('spec-last-activity')).toMatch(/^last activity 2026-10-07T/)
    expect(all).not.toMatch(/complete|✓|✔/i)
  }
})

test('an unasked open the engine declines raises one toast naming the command, and an errored write is not counted', async ($: any, on: any) => {
  const w = world(on, { placed: false })
  w.writeErrors.add(`openspec/changes/${C}/tasks.md`)
  await start($)
  await loadSpec($)
  expect(w.opens).toEqual([PANE])
  expect(w.toasts).toEqual(['/interlock-spec opens the spec meter'])
  await bash($, STATUS)
  const r = await write($, `openspec/changes/${C}/tasks.md`)
  expect(r.isError).toBe(true)
  expect(await line($, 'terminal', 'spec-writes-none')).toBe('no artifact writes yet')
  expect(await line($, 'desktop', 'spec-write-tasks.md')).toBeUndefined()
})

test('/interlock-spec with no run says so and nothing else', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(await $.command.run({ command: PANE, args: '' })).toEqual({})
  expect(w.opens).toEqual([PANE])
  for (const surface of SURFACES) {
    const { lines, all } = await pane($, surface)
    expect(all.trim()).toBe(NO_RUN)
    expect(lines.has('spec-header')).toBe(false)
  }
})

test('before the CLI names a change the pane says so, and a write names nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await write($, 'openspec/changes/other/proposal.md')
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN}`)
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-header')).toBe(UNKNOWN)
    for (const kind of ['status', 'drift', 'ledger', 'validate', 'gate', 'ready']) expect(lines.get(`spec-${kind}`)).toBe(`${kind}: not run yet`)
    expect(lines.get('spec-writes-none')).toBe('no artifact writes yet')
    expect(lines.has('spec-other-changes')).toBe(false)
  }
})

test('a stock OpenSpec flow and a standalone explore draw nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await bash($, 'openspec new change "other"')
  await bash($, 'openspec status --change "other" --json')
  await write($, 'openspec/changes/other/proposal.md')
  await skill($, 'interlock:explore')
  await explore($, 3)
  expect(w.status).toEqual([])
  expect(w.opens).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
})

test('two changes: the line follows the one the CLI named last, the other is listed and kept', async ($: any, on: any) => {
  const w = world(on)
  w.bash.set('openspec status --change "alpha" --json', allDone())
  w.bash.set('openspec status --change "beta" --json', captured(R.BASH_STATUS))
  await start($)
  await loadSpec($)
  await bash($, 'openspec status --change "alpha" --json')
  expect(w.status.at(-1)).toBe('interlock spec: alpha · status 4/4 done')
  await bash($, 'openspec status --change "beta" --json')
  expect(w.status.at(-1)).toBe('interlock spec: beta · status 2/4 done · next: design')
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-header')).toBe('beta · schema spec-driven')
    expect(lines.get('spec-artifact-design')).toBe('design · ready · design.md')
    expect(lines.get('spec-other-changes')).toBe('other changes named this run: alpha')
  }
  // alpha's results were kept under its own name: naming it again draws its table.
  await bash($, 'interlock validate "alpha" --json')
  expect(await line($, 'terminal', 'spec-artifact-design')).toBe('design · done · design.md')
})

test('a compound line: the change and its ladder, then autonomy and the checkpoint, each in order', async ($: any, on: any) => {
  const w = world(on)
  const both = `${NEW_CHANGE} && ${STATUS}`
  w.bash.set(both, ok(`- Creating change '${C}'...\n${R.BASH_STATUS.text}`))
  const end = `interlock autonomy clean review-artifacts explore spec; ${CHECKPOINT}`
  w.bash.set(end, ok(`review-artifacts: L2 (1/3 clean)\npush: not configured — set INTERLOCK_NTFY_TOPIC`))
  await start($)
  await loadSpec($)
  await bash($, both)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · status 2/4 done · next: design`)
  await bash($, end)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · checkpoint`)
  expect(await line($, 'desktop', 'spec-autonomy')).toBe('autonomy: clean')
})

test('the checkpoint ends the run: the line stays, the pane keeps its results, a later line is named once', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await happyPath($)
  await bash($, CHECKPOINT)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · checkpoint`)
  const after = w.status.length
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-checkpoint')).toBe(`checkpoint reached ${new Date(T0).toISOString()}`)
    expect(lines.get('spec-gate')).toMatch(/^gate: passed false/)
  }
  await bash($, STATUS)
  await bash($, LEDGER)
  expect(w.status.length).toBe(after)
  expect(specLogs(w).filter(l => /after the checkpoint/.test(l.text))).toHaveLength(1)
})

test('an accepted ship launch takes the line; an errored one leaves the spec line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await bash($, READY)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · ready true`)
  await launch($, { name: 'refused' })
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · ready true`)

  const before = w.status.length
  await launch($)
  w.bash.set(NEXT, ok(F.stdout(F.RUN_BATCH)))
  await bash($, NEXT)
  const since = w.status.slice(before)
  expect(since.some(t => (t ?? '').includes('interlock spec:'))).toBe(false)
  expect(since.at(-1)).toBe(`interlock: ${F.CHANGE} · run-batch · wave 2 · batch 1/2`)
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-ready')).toBe('ready: ready true · blockers 0')
    expect(lines.get('spec-handover')).toMatch(/^handed over to ship at 2026-10-07T/)
  }
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`a ${source} ends the spec run; a later line sets nothing and is named once`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    await loadSpec($)
    await bash($, STATUS)
    await $.classic.SessionStart({ source })
    expect(w.status.at(-1)).toBeUndefined()
    for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
    const after = w.status.length
    await bash($, STATUS)
    await bash($, LEDGER)
    expect(w.status.length).toBe(after)
    expect(specLogs(w).filter(l => /with no live spec run/.test(l.text))).toHaveLength(1)
  })
}

test('a compaction leaves the line, the table and the counts', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await bash($, STATUS)
  await write($, `openspec/changes/${C}/proposal.md`)
  const before = [...w.status]
  await $.classic.SessionStart({ source: 'compact' })
  expect(w.status).toEqual(before)
  const { lines } = await pane($, 'terminal')
  expect(lines.get('spec-artifact-design')).toBe('design · ready · design.md')
  expect(lines.get('spec-write-proposal.md')).toMatch(/written 1×/)
})

test('a second spec load starts the record over and says so once', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await happyPath($)
  await loadSpec($)
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN}`)
  expect(specLogs(w).filter(l => /a new spec run replaced the previous one/.test(l.text))).toHaveLength(1)
  for (const surface of SURFACES) {
    const { lines } = await pane($, surface)
    expect(lines.get('spec-header')).toBe(UNKNOWN)
    expect(lines.get('spec-ledger')).toBe('ledger: not run yet')
  }
})

test('a non-interactive session keeps nothing, draws nothing, and every hook resolves as the engine did', async ($: any, on: any) => {
  const w = world(on)
  await start($, false)
  expect(await loadSpec($)).toEqual({ text: R.PROMPT_SPEC.text })
  expect((await skill($, 'interlock:spec')).text).toBe('Launching skill: interlock:spec')
  expect((await bash($, STATUS)).text).toBe(R.BASH_STATUS.text)
  expect((await write($, `openspec/changes/${C}/proposal.md`)).text).toBe('ok')
  expect(await explore($, 2)).toEqual([
    { model: 'claude-opus-5-5', agentId: 'x1' },
    { model: 'claude-opus-5-5', agentId: 'x2' }
  ])
  await bash($, CHECKPOINT)
  expect(w.status).toEqual([])
  expect(w.opens).toEqual([])
  expect(w.toasts).toEqual([])
  expect((await pane($, 'terminal')).all.trim()).toBe(NO_RUN)
})

// A result whose field getter throws cannot reach a module under the kit,
// which clones every answer as plain data; the module's own `try` around the
// spec read stands for that case (design D3).
test('a numeric skill and a write with no path resolve as the engine did and change nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSpec($)
  await bash($, STATUS)
  const before = [...w.status]
  expect((await skill($, 7)).text).toBe('Launching skill: 7')
  expect((await write($)).text).toBe('ok')
  expect(w.status).toEqual(before)
  expect(await line($, 'terminal', 'spec-validate')).toBe('validate: not run yet')
  expect(await line($, 'terminal', 'spec-writes-none')).toBe('no artifact writes yet')
  // Later hooks still work.
  await bash($, LEDGER)
  expect(w.status.at(-1)).toBe(`interlock spec: ${C} · ledger blocking (needs_human 2 · invalid 0)`)
})
