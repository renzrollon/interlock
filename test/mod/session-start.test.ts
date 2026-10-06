// The session start's band and its two panes, under the engine's own test kit
// (`claude plugin test .`; spec: hooks/ship-meter).
//
// The module reads `.claude/ship/preflight.json` at each prompt a person
// submits, and after the classic session-start event where the engine raises
// one (the kit does; 2.1.291 raises none to a module, design D5). The test's
// own `fs.read` hook stands for the disk: it answers the texts in `w.files` by
// path and refuses every other path, as a missing file is refused. Every word
// the band and the panes draw is the fixture's: the doctor's, the hook's or
// the card's, never one the module made.

import { expect, mock, test } from 'claude-code/testing'

import { LIMITS } from '../../lib/limits.mjs'
import * as P from '../fixtures/mod/preflight.mjs'

const PLUGIN = 'interlock'
const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-07T08:00:05.000Z')
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} }
const PANE_PROPS = { title: 'Interlock', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } }
const BENEATH_BAND = 'another plugin\'s band'
const CLASSIC_BENEATH = { additionalContext: ['the stub beneath'] }
const WRITTEN_LINE = `preflight written ${P.WRITTEN_AT} · /interlock-preflight`

type World = {
  files: Map<string, string>
  reads: string[]
  logs: { text: string; to: string }[]
  opens: string[]
  commands: string[]
  status: (string | undefined)[]
}

/** The engine beneath the plugin, with the disk the test hands it. */
function world(on: any, { files = new Map<string, string>() }: { files?: Map<string, string> } = {}): World {
  const w: World = { files, reads: [], logs: [], opens: [], commands: [], status: [] }
  mock.clock(on, { now: T0 })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => CLASSIC_BENEATH)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('session.version', () => ({ value: { version: '2.1.291', base: '2.1.291', builtAt: '2026-10-06T19:21:39Z' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('command.register', (_$: any, e: any) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  const done = { value: undefined }
  on('ui.status', (_$: any, e: any) => (w.status.push(e.text), done))
  on('ui.toast', () => done)
  on('ui.log', (_$: any, e: any) => (w.logs.push({ text: e.text, to: e.to }), done))
  on('ui.invalidate', () => done)
  on('ui.open', (_$: any, e: any) => {
    w.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.read', (_$: any, e: any) => {
    w.reads.push(e.path)
    return w.files.has(e.path) ? { value: w.files.get(e.path) } : { deny: `ENOENT: ${e.path}` }
  })
  // Another plugin's band, so the module is seen keeping it beneath its own.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, BENEATH_BAND)
  })
  return w
}

const withReport = (report: unknown) => new Map([[P.PREFLIGHT_PATH, P.stdout(report)]])
const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const prompt = ($: any, kind = 'composer') => $.prompt.submit({ text: 'what changed?', origin: { kind } })
const pathLogs = (w: World) => w.logs.filter(l => l.to === 'debug' && l.text.includes(P.PREFLIGHT_PATH))

/** The band's own rows on `surface`, whether the other plugins' band stands beneath, and the Hide control. */
async function band($: any, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const rows: string[] = []
  for (let n = 0; ; n++) {
    const row = await ui.find({ key: `preflight-${n}` })
    if (!row) break
    rows.push(row.text)
  }
  const beneath = (await ui.find({ text: BENEATH_BAND })) !== undefined
  const hide = await ui.find({ key: 'hide' })
  await ui.unmount()
  return { rows, beneath, hide }
}

/** Press the band's Hide on `surface`; the open mount keeps its tree, so the next mount is read (probe 2). */
async function hide($: any, surface: (typeof SURFACES)[number] = 'terminal') {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'hide' })
  await ui.unmount()
}

const pane = ($: any, surface: (typeof SURFACES)[number], requestId: string) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId, props: PANE_PROPS })

test('session.start registers the meter, the preflight, the handoff and the spec meter commands, in that order', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual(['interlock-meter', 'interlock-preflight', 'interlock-handoff', 'interlock-spec'])
})

test('a failing check and a spoken note draw the band on both surfaces, above the other plugins\' band', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  await prompt($)
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  for (const surface of SURFACES) {
    const { rows, beneath, hide } = await band($, surface)
    expect(rows).toEqual([
      'interlock preflight found issues that can stall an unattended ship run:',
      `fail permissions: ${P.PERMISSIONS_DETAIL}`,
      `warn openspec: ${P.OPENSPEC_DETAIL}`,
      P.BANNER,
      WRITTEN_LINE
    ])
    expect(beneath).toBe(true)
    expect(hide).toBeDefined()
  }
})

test('the classic session-start event draws the same band, and resolves as the engine alone would', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  expect(await $.classic.SessionStart({ source: 'startup', cwd: '/repo' })).toEqual(CLASSIC_BENEATH)
  expect(w.reads).toEqual([P.PREFLIGHT_PATH])
  for (const surface of SURFACES) {
    const { rows } = await band($, surface)
    expect(rows[0]).toBe('interlock preflight found issues that can stall an unattended ship run:')
    expect(rows.at(-1)).toBe(WRITTEN_LINE)
  }
})

test('Hide collapses the band for the session, and a prompt over the same report keeps it collapsed', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  await prompt($)
  await hide($)
  await prompt($)
  expect(w.reads).toEqual([P.PREFLIGHT_PATH, P.PREFLIGHT_PATH])
  for (const surface of SURFACES) {
    const { rows, beneath, hide: control } = await band($, surface)
    expect(rows).toEqual([])
    expect(control).toBeUndefined()
    expect(beneath).toBe(true)
  }
})

test('/interlock-preflight lists every check with its fix lines and the note with its mark', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  await prompt($)
  expect(await $.command.run({ command: 'interlock-preflight', args: '' })).toEqual({})
  expect(w.opens).toEqual(['interlock-preflight'])
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-preflight')
    for (const line of [
      `fail permissions: ${P.PERMISSIONS_DETAIL}`,
      '     fix: add "Bash(interlock:*)" to permissions.allow',
      '          in .claude/settings.json',
      `warn openspec: ${P.OPENSPEC_DETAIL}`,
      '     fix: npm i -g @fission-ai/openspec',
      'ok node: node 22.11.0',
      P.BANNER
    ]) {
      expect(await ui.find({ text: line })).toBeDefined()
    }
    expect(await ui.find({ text: /^\s*marked · \/repo$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('an all-ok report draws nothing, and the meter pane still says no run is live', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_ALL_OK) })
  await start($)
  await prompt($)
  for (const surface of SURFACES) {
    const { rows, beneath } = await band($, surface)
    expect(rows).toEqual([])
    expect(beneath).toBe(true)
    const ui = await pane($, surface, 'interlock-meter')
    expect(await ui.find({ text: 'no ship run is live in this session' })).toBeDefined()
    await ui.unmount()
  }
  expect(w.status).toEqual([])
})

const BAD_FILES: [string, Map<string, string>, RegExp][] = [
  ['an absent file', new Map(), /ENOENT/],
  ['text that is not JSON', new Map([[P.PREFLIGHT_PATH, 'not json at all']]), /not JSON/],
  ['JSON with another schema', new Map([[P.PREFLIGHT_PATH, JSON.stringify({ schema: 'interlock.other/1' })]]), /interlock\.other\/1/]
]

for (const [what, files, reason] of BAD_FILES) {
  test(`${what} draws nothing and is named once on the debug log`, async ($: any, on: any) => {
    const w = world(on, { files })
    await start($)
    await prompt($)
    await prompt($)
    for (const surface of SURFACES) {
      const { rows, beneath } = await band($, surface)
      expect(rows).toEqual([])
      expect(beneath).toBe(true)
    }
    const named = pathLogs(w)
    expect(named).toHaveLength(1)
    expect(named[0].text).toMatch(reason)
    await $.command.run({ command: 'interlock-preflight', args: '' })
    for (const surface of SURFACES) {
      const ui = await pane($, surface, 'interlock-preflight')
      expect(await ui.find({ text: /^no preflight report is held for this session start: \/repo\/\.claude\/ship\/preflight\.json: / })).toBeDefined()
      await ui.unmount()
    }
    expect(pathLogs(w)).toHaveLength(1)
  })
}

test('a non-interactive session reads no file and draws no band', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($, false)
  await prompt($)
  expect(await $.classic.SessionStart({ source: 'startup', cwd: '/repo' })).toEqual(CLASSIC_BENEATH)
  expect(w.reads).toEqual([])
  for (const surface of SURFACES) {
    const { rows, beneath } = await band($, surface)
    expect(rows).toEqual([])
    expect(beneath).toBe(true)
  }
})

test('a prompt that is not a person\'s reads nothing', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  await prompt($, 'task-notification')
  expect(w.reads).toEqual([])
  expect((await band($, 'terminal')).rows).toEqual([])
})

test('a report written for a clear shows the band again, and one written for a compact keeps it hidden', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_FAIL_WARN_NOTE) })
  await start($)
  await prompt($)
  await hide($)

  w.files.set(P.PREFLIGHT_PATH, P.stdout({ ...P.REPORT_WARN_ONLY, source: 'clear' }))
  await prompt($)
  for (const surface of SURFACES) {
    expect((await band($, surface)).rows).toEqual([
      'interlock preflight OK (1 warning).',
      `warn openspec: ${P.OPENSPEC_DETAIL}`,
      `preflight written ${P.REPORT_WARN_ONLY.writtenAt} · /interlock-preflight`
    ])
  }

  await hide($)
  w.files.set(P.PREFLIGHT_PATH, P.stdout({ ...P.REPORT_WARN_ONLY, writtenAt: '2026-10-07T10:00:00.000Z', source: 'compact' }))
  await prompt($)
  for (const surface of SURFACES) expect((await band($, surface)).rows).toEqual([])
  expect(await $.classic.SessionStart({ source: 'compact', cwd: '/repo' })).toEqual(CLASSIC_BENEATH)
  for (const surface of SURFACES) expect((await band($, surface)).rows).toEqual([])

  // The classic boundary starts the session over, so the same file is this session's report again.
  expect(await $.classic.SessionStart({ source: 'clear', cwd: '/repo' })).toEqual(CLASSIC_BENEATH)
  for (const surface of SURFACES) expect((await band($, surface)).rows[0]).toBe('interlock preflight OK (1 warning).')
})

test('/interlock-handoff renders the newest card as markdown and names a card it cannot read', async ($: any, on: any) => {
  const w = world(on, { files: new Map([...withReport(P.REPORT_WITH_CARD), [P.CARD_PATH, P.CARD_TEXT]]) })
  await start($)
  await prompt($)
  for (const surface of SURFACES) {
    const { rows } = await band($, surface)
    expect(rows).toContain(`${P.CARD_PATH} · add-foo · run r-1 · written ${P.CARD_WRITTEN_AT} — /interlock-handoff`)
  }
  expect(await $.command.run({ command: 'interlock-handoff', args: '' })).toEqual({})
  expect(w.opens).toEqual(['interlock-handoff'])
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    const first = (await ui.find({ key: 'card-0' }))?.text
    expect(first).toMatch(/add-foo/)
    expect(first).toMatch(/r-1/)
    expect(first).toContain(P.CARD_WRITTEN_AT)
    const markdown = await ui.find({ type: 'Markdown' })
    expect(markdown?.props.text).toContain('# Ship halted — add-foo')
    expect(markdown?.props.text).toContain(P.RECORD_SENTENCE)
    expect((await ui.find({ key: 'card-1' }))?.text).toMatch(/add-bar/)
    const unread = (await ui.find({ key: 'card-1-unread' }))?.text
    expect(unread).toContain(P.SECOND_CARD_PATH)
    expect(unread).toMatch(/ENOENT/)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
  expect(w.reads.filter(p => p === P.CARD_PATH).length).toBe(SURFACES.length)
})

test('a card over the published cap is cut inside the rendered text, naming the count and the path', async ($: any, on: any) => {
  world(on, { files: new Map([...withReport(P.REPORT_WITH_CARD), [P.CARD_PATH, P.LONG_CARD]]) })
  await start($)
  await prompt($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    const text: string = (await ui.find({ type: 'Markdown' }))?.props.text
    expect(text.length).toBeLessThanOrEqual(LIMITS.handoffPaneChars)
    expect(text).toMatch(new RegExp(`_… \\d+ characters left out; the whole card is ${P.CARD_PATH.replace(/[.]/g, '\\.')}_$`))
    await ui.unmount()
  }
})

test('with no card the handoff pane says so and names where it looked; with no report it names the file', async ($: any, on: any) => {
  const w = world(on, { files: withReport(P.REPORT_ALL_OK) })
  await start($)
  await prompt($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    expect(await ui.find({ text: 'no halt resume card is on disk for an open change' })).toBeDefined()
    expect(await ui.find({ text: 'looked in: /repo/.claude/handoff' })).toBeDefined()
    await ui.unmount()
  }
  w.files.delete(P.PREFLIGHT_PATH)
  await prompt($)
  for (const surface of SURFACES) {
    const ui = await pane($, surface, 'interlock-handoff')
    expect(await ui.find({ text: /^no preflight report is held for this session start: \/repo\/\.claude\/ship\/preflight\.json/ })).toBeDefined()
    await ui.unmount()
  }
})
