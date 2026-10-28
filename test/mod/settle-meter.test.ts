// The settle meter under the engine's own test kit (`claude plugin test .`).
//
// The test's own `on` hooks sit beneath the plugin and stand for the engine,
// answering each event with what Claude Code 2.1.310 answered when the probe
// and the PR #25 pass captured it (`test/fixtures/mod/settle-run.mjs`): a
// `general-purpose` spawn made with `model` (the call's alias resolved to the
// id), its `turn.step` carrying `effort` and its `turn.complete`, and the Bash
// results of the keyed lines, the STOP exit errored behind its `Exit code 1`
// line. The rules are `lib/settle-meter.mjs`'s and are tested under Node
// (`test/spine/settle-meter.test.mjs`); this file proves the wiring: what
// starts a run, what the status line and the pane say on both surfaces, the
// ends, the precedence beside a ship run and a spec run, and that every hook
// resolves to what the engine alone would have done
// (observe-the-settle-run-live design D4-D6, D13, D15, D25, D27).
//
// The pane is read as the texts of its keyed rows in the order drawn, and a
// group as the rows between its heading (the first row to start with the
// section word and carry a clock reading) and the next heading, as the Node
// tests read `settlePaneLines`. The module's settle debug-log lines start
// `interlock settle: `, as the spec meter's start `interlock spec: `.

import { expect, mock, test } from 'claude-code/testing'

import { LIMITS } from '../../lib/limits.mjs'
import { PALETTE, turnProps } from '../../lib/meter-palette.mjs'
import { clockText, durationText } from '../../lib/meter-time.mjs'
import * as F from '../fixtures/mod/steps.mjs'
import * as R from '../fixtures/mod/settle-run.mjs'
import * as S from '../fixtures/mod/spec-run.mjs'

const PLUGIN = 'interlock'
const PANE = 'interlock-settle'
const SURFACES = ['terminal', 'desktop'] as const
const T0 = Date.parse('2026-10-26T09:29:22.000Z')
const C = R.CHANGE
const A96 = 'a96cb82cedb626d9b6c11c1f6a090b7e52a2afa8'
const H161 = '161f955745b9443e9890890c1ce57ab627ea59af'
const UNKNOWN = 'change: unknown until named'
const NO_RUN = 'no settle run is live in this session'
const UNPLACED = '/interlock-settle opens the settle meter'
const SETTLE_DEBUG = /^interlock settle: /
const LINE = `interlock settle ${C} #25: `
const NEXT = 'interlock run next --results .claude/ship/results.json --json'
const CLOCK = /\d\d:\d\d:\d\d/
const GROUP_LABELS = ['review', 'resolve', 'round 1', 'round 2', 'ready', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']

const LOAD = '/interlock:settle --create --review'
const LOAD_CREATE = '/interlock:settle --create'

type Answer = { result: unknown; text: string; isError?: boolean }
type World = {
  clock: ReturnType<typeof mock.clock>
  now: number
  status: (string | undefined)[]
  toasts: string[]
  logs: { text: string; to: string }[]
  opens: string[]
  commands: string[]
  bash: Map<string, Answer>
  spawned: string[]
}

/** A clean exit as the engine resolves it: the command's stdout, trimmed, kept and read (probe 2026-10-26). */
const ok = (stdout = ''): Answer => {
  const out = stdout.replace(/\s+$/, '')
  return { result: { stdout: out, stderr: '', interrupted: false, isImage: false, noOutputExpected: out === '' }, text: out }
}
const json = (value: unknown) => ok(JSON.stringify(value, null, 2))
const captured = (fixture: any): Answer => ({ result: fixture.result, text: fixture.text, ...(fixture.isError ? { isError: true } : {}) })

// --- the lines of the pass, as the settle and review-code skills run them ------

const ROUTING = 'interlock routing --json'
const ROUTING_FIXER = 'interlock routing settle-fixer --json'
const ROUTING_CONFORMANCE = 'interlock routing settle-conformance --json'
const ROUTING_ANSWER = json({
  depth: 'lean',
  roles: {
    'explore-investigator': { model: 'sonnet', effort: 'medium' },
    'review-dimension': { model: 'sonnet', effort: 'medium' },
    'review-skeptic': { model: null, effort: 'xhigh' },
    'settle-fixer': { model: null, effort: 'xhigh' },
    'settle-conformance': { model: 'sonnet', effort: null }
  },
  review: { dimensions: ['language', 'technical-lead'], skeptics: 'per-review' },
  banners: [],
  overrides: { effortLevel: null, subagentModelForce: null }
})
const DOMAIN_CONTEXT = `interlock domain-context ${C} --changed CHANGELOG.md --base origin/main --json`
const TREE_CHECK = `git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change ${C} --status -`
const COMMENT = `interlock settle comment --review .claude/ship/settle/review-r0.json --head ${A96} --round 0 | gh pr comment 25 --body-file -`
const COMMIT_PUSH = 'git commit -m "fix(review): answer the PR #25 review round 1" -m "Refs: #25" && git push'
const REVIEW_R1 = `interlock review --findings .claude/ship/settle/findings-r1.json --verdicts .claude/ship/settle/verdicts-r1.json --changed CHANGELOG.md --base origin/main --metrics ${C} --dimensions .claude/ship/settle/dimensions-r1.json --head ${H161} --out .claude/ship/settle/review-r1.json --json`
const REPLIES_R1 = `interlock settle replies --before .claude/ship/settle/review-r0.json --after .claude/ship/settle/review-r1.json --head ${H161} | gh pr comment 25 --body-file -`
const CONFORMANCE_BRIEF = `interlock settle conformance-brief ${C} --changed CHANGELOG.md README.md --base origin/main --head ${H161}`
const VERIFY_PLAN = 'interlock verify plan --profile .claude/testing/profile.json --context final --changed CHANGELOG.md --json > .claude/ship/settle/plan.json'
const VERIFY_EXEC = 'interlock verify exec --kind unit --command "npm test"'
const VERIFY_JUDGE = `interlock verify judge --plan .claude/ship/settle/plan.json --results .claude/ship/settle/results.json --context final --head ${H161} --json > .claude/ship/settle/verify.json.tmp`
const CHECKS_WATCH = 'gh pr checks 25 --watch'
const MC_MARKDOWN = R.BASH_SETTLE_MERGE_CONFIDENCE.command.replace(/ --json$/, ' --markdown')
const ADD_LABELS = 'gh pr edit 25 --add-label "interlock/human-review,interlock/score-58"'
const DRIFT = 'interlock drift --changed CHANGELOG.md README.md --json'
const SPEC_NEW_CHANGE = `openspec new change "${S.CHANGE}"`
const SPEC_CHECKPOINT = `interlock notify checkpoint "${S.CHANGE}"`

const reviewR1Answer = () => {
  const doc = JSON.parse(R.BASH_SETTLE_REVIEW.result.stdout)
  doc.counts = { ...doc.counts, raised: 1, surviving: 5 }
  doc.head = H161
  return json(doc)
}
/** The STOP line as the CLI printed it on stderr, from its `STOP: ` word. */
const STOP_LINE = R.BASH_SETTLE_STOP.text.slice(R.BASH_SETTLE_STOP.text.indexOf('STOP: ')).split('\n')[0]

/** The first lines of the roles' prompts: the bundled briefs' headings, review-code's blockquotes, the CLI's two briefs. */
const DIM = (heading: string) => `# Dimension: ${heading}\n\nYou are a reviewer for this dimension.`
const SKEPTIC_REFUTE = 'You are a skeptical code reviewer. Your job is to REFUTE this finding if you can.\nRead the actual file and its surrounding context.'
const SKEPTIC_SECOND = 'You are an independent reviewer giving a second opinion. Read the actual file.'
const FIXER_PROMPT: string = JSON.parse(R.BASH_SETTLE_BRIEF.result.stdout).briefing
const WORKER_PROMPT = `Confirm change "${C}" against its diff at head ${H161}.\n\nScenarios — for each one below, read the implementation.`

// --- the engine beneath the plugin ---------------------------------------------

/** The engine beneath the plugin, recording every display call the module makes. */
function world(on: any, { placed = true, clock = true }: { placed?: boolean; clock?: boolean } = {}): World {
  // With `clock: false` the engine refuses every read, which rejects the plugin's `$.clock.now()`.
  if (!clock) on('clock.now', () => ({ deny: 'the clock is gone' }))
  const w: World = {
    clock: clock ? mock.clock(on, { now: T0 }) : (null as any),
    now: T0,
    status: [],
    toasts: [],
    logs: [],
    opens: [],
    commands: [],
    bash: new Map<string, Answer>([
      [ROUTING, ROUTING_ANSWER],
      [ROUTING_FIXER, json({ role: 'settle-fixer', depth: 'lean', model: null, effort: 'xhigh', banners: [], overrides: { effortLevel: null, subagentModelForce: null } })],
      [ROUTING_CONFORMANCE, json({ role: 'settle-conformance', depth: 'lean', model: 'sonnet', effort: null, banners: [], overrides: { effortLevel: null, subagentModelForce: null } })],
      [DOMAIN_CONTEXT, ok('{}')],
      [R.BASH_SETTLE_REVIEW.command, captured(R.BASH_SETTLE_REVIEW)],
      [COMMENT, ok('https://github.com/example/repo/pull/25#issuecomment-1')],
      [TREE_CHECK, ok('clean')],
      [R.BASH_SETTLE_BRIEF.command, captured(R.BASH_SETTLE_BRIEF)],
      [R.BASH_SETTLE_FIXER_RESULT.command, captured(R.BASH_SETTLE_FIXER_RESULT)],
      [COMMIT_PUSH, ok('[feat/leaner-review 161f955] fix(review): answer the PR #25 review round 1\n 2 files changed, 7 insertions(+), 3 deletions(-)')],
      [REVIEW_R1, reviewR1Answer()],
      [REPLIES_R1, ok('https://github.com/example/repo/pull/25#issuecomment-2')],
      [R.BASH_SETTLE_STOP.command, captured(R.BASH_SETTLE_STOP)],
      [CONFORMANCE_BRIEF, ok(WORKER_PROMPT)],
      [VERIFY_PLAN, ok()],
      [VERIFY_EXEC, ok('tests 3201\npass 3201')],
      [VERIFY_JUDGE, ok()],
      [CHECKS_WATCH, ok()],
      [R.BASH_SETTLE_PIPELINE.command, captured(R.BASH_SETTLE_PIPELINE)],
      [R.BASH_SETTLE_MERGE_CONFIDENCE.command, captured(R.BASH_SETTLE_MERGE_CONFIDENCE)],
      [MC_MARKDOWN, ok('## Merge confidence: HUMAN 58')],
      [ADD_LABELS, ok('https://github.com/example/repo/pull/25')],
      [DRIFT, json({ root: '.', unarchived: [C], stale: { skipped: false, reason: null, broken: [], aging: [] } })],
      [SPEC_NEW_CHANGE, ok(`- Creating change '${S.CHANGE}'...\n✔ Created change '${S.CHANGE}'`)],
      [SPEC_CHECKPOINT, ok('push: not configured — set INTERLOCK_NTFY_TOPIC')],
      [S.BASH_GATE_BLOCKED.command, captured(S.BASH_GATE_BLOCKED)]
    ]),
    spawned: []
  }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('session.version', () => ({ value: { version: '2.1.310', base: '2.1.310', builtAt: '2026-10-25T19:21:39Z' } }))
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
  // A subagent's request: the captured answer, its served model the one the step names (probe: `usage.model` is the id).
  on('turn.step', async function* (_$: any, e: any) {
    return { ...R.STEP_AGENT_TOOL.result, turnId: e.turnId, index: e.index, usage: { ...R.STEP_AGENT_TOOL.result.usage, model: e.model } }
  })
  on('turn.complete', (_$: any, e: any) => ({ turnId: e.turnId, text: '', reason: e.reason }))
  // The call's alias resolved to its id, an unnamed model to the parent's (probe 2026-10-26).
  on('agent.spawn', (_$: any, e: any) => {
    w.spawned.push(e.subagentType)
    return { model: e.model === 'sonnet' ? 'claude-sonnet-5-5' : 'claude-opus-5-5', agentId: `a${w.spawned.length}` }
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

/** Moves the kit's clock to `s` seconds after T0; it never moves back. */
async function to(w: World, s: number) {
  const d = T0 + s * 1000 - w.now
  if (d > 0) {
    await w.clock.advance(d)
    w.now += d
  }
}

const start = ($: any, isInteractive = true) =>
  $.session.start({ cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive })
const submit = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })
const loadSettle = ($: any) => submit($, LOAD)
const loadSpec = ($: any) => $.prompt.submit({ ...S.PROMPT_SPEC, origin: { kind: 'composer' } })
const skill = ($: any, name: unknown, args = '') => $.tool.call({ tool: 'Skill', skill: name, args })
const bash = ($: any, command: string, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'Bash', command, ...extra })
const launch = ($: any, input: Record<string, unknown> = { name: 'interlock:ship', args: { change: F.CHANGE } }) =>
  $.tool.call({ tool: 'Workflow', ...input })
const settleLogs = (w: World) => w.logs.filter(l => l.to === 'debug' && SETTLE_DEBUG.test(l.text))

type Spawn = { prompt: string; model?: string; subagentType?: string; parentModel?: string; description?: string }
/** The engine's spawn event, the captured one with this agent's prompt, model and type. */
function spawn($: any, { prompt, model, subagentType = 'general-purpose', parentModel = 'claude-opus-5-5', description = 'probe reply' }: Spawn) {
  const input: Record<string, unknown> = { ...R.SPAWN_ROUTED.input, prompt, subagentType, parentModel, description }
  if (model === undefined) delete input.model
  else input.model = model
  return $.agent.spawn(input)
}
/** One request of a subagent: its `turn.step`, the level it carried and the model that served it. */
async function step($: any, agentId: string, index: number, { effort, model }: { effort?: string; model: string }) {
  const input: Record<string, unknown> = { ...R.STEP_AGENT_TOOL.input, turnId: `t-${agentId}`, agentId, index, model }
  if (effort === undefined) delete input.effort
  else input.effort = effort
  const s = $.turn.step(input)
  let n = await s.next()
  while (!n.done) n = await s.next()
  return n.value
}
const complete = ($: any, agentId: string, reason: string, durationMs: number) =>
  $.turn.complete({ ...R.COMPLETE_AGENT_TOOL.input, turnId: `t-${agentId}`, agentId, reason, durationMs, isAborted: reason === 'aborted' })

type Life = Spawn & { spawnAt: number; steps?: number[]; efforts?: string[]; served: string; end?: { at: number; reason?: string; durationMs: number } }
/** Spawns an agent and replays its life at the clock readings given (seconds after T0); returns its id. */
async function agent($: any, w: World, life: Life): Promise<string> {
  await to(w, life.spawnAt)
  const { agentId } = await spawn($, life)
  const efforts = life.efforts ?? ['medium']
  for (const [i, s] of (life.steps ?? []).entries()) {
    await to(w, s)
    await step($, agentId, i, { effort: efforts[Math.min(i, efforts.length - 1)], model: life.served })
  }
  if (life.end) {
    await to(w, life.end.at)
    await complete($, agentId, life.end.reason ?? 'answer', life.end.durationMs)
  }
  return agentId
}

const mount = ($: any, surface: (typeof SURFACES)[number], bodyColumns: number) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: { title: 'Interlock settle', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 120 } }
  })
/** The texts of every keyed row the pane draws on `surface`, in the order drawn, and all its text. */
async function pane($: any, surface: (typeof SURFACES)[number], bodyColumns = 144) {
  const ui = await mount($, surface, bodyColumns)
  const boxes = await ui.findAll({ type: 'Box' })
  const rows: string[] = []
  for (const b of boxes) if (b.props && typeof b.props.key === 'string') rows.push((await ui.find({ key: b.props.key }))?.text ?? '')
  const all = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? t.props?.children ?? '').join('\n')
  await ui.unmount()
  return { rows, all }
}

/** An element and every element beneath it, in the order drawn. */
function tree(el: any): any[] {
  if (!el) return []
  const kids = Array.isArray(el.children) ? el.children : []
  return [el, ...kids.flatMap(tree)]
}
/** A nested node's text: the kit sets `text` on a found element, not on what it holds. */
const textOf = (n: any): string => (typeof n === 'string' ? n : Array.isArray(n?.children) ? n.children.map(textOf).join('') : '')
const keyOf = (el: any) => (el?.props && typeof el.props.key === 'string' ? el.props.key : undefined)
/**
 * The pane's drawing (draw-the-settle-and-spec-panes-as-cards D3): every keyed
 * row's key, text and Box props in the order drawn; every bordered Box, with
 * the keys of the rows it holds; every Box's props; and how many Texts it draws.
 */
async function drawing($: any, surface: (typeof SURFACES)[number], bodyColumns = 144) {
  const ui = await mount($, surface, bodyColumns)
  const boxes = await ui.findAll({ type: 'Box' })
  const rows: { key: string; text: string; props: any; node: any }[] = []
  for (const b of boxes) if (keyOf(b)) rows.push({ key: keyOf(b)!, text: (await ui.find({ key: keyOf(b) }))?.text ?? '', props: b.props, node: b })
  const cards = boxes
    .filter((b: any) => b.props && b.props.borderStyle !== undefined)
    .map((b: any) => ({ props: b.props, keys: tree(b).map(keyOf).filter(Boolean) as string[] }))
  const texts = (await ui.findAll({ type: 'Text' })).length
  const props = boxes.map((b: any) => b.props ?? {})
  await ui.unmount()
  return { rows, cards, texts, props }
}
type Drawing = Awaited<ReturnType<typeof drawing>>
/** A group's card: the outer card that holds its heading row. */
const groupCard = (d: Drawing, label: string) => {
  const heading = d.rows.find(r => new RegExp(`^${label}\\b`).test(r.text) && CLOCK.test(r.text) && r.key.startsWith('settle-group-'))
  expect(heading).toBeDefined()
  return d.cards.find(c => c.keys[0] === heading!.key)
}
/** The verdict's own card: the bordered Box that holds the one row reading the verdict word after its clock. */
const verdictCard = (d: Drawing, word: string) => {
  const row = d.rows.find(r => new RegExp(`^\\d\\d:\\d\\d:\\d\\d ${word} \\d+`).test(r.text))
  expect(row).toBeDefined()
  return d.cards.find(c => c.keys.length === 1 && c.keys[0] === row!.key)
}
const expectDim = (c: any) => {
  expect(c?.props.borderDimColor).toBe(true)
  expect(c?.props.borderColor).toBeUndefined()
}
const mcAnswer = (verdict: string) => {
  const doc = JSON.parse(R.BASH_SETTLE_MERGE_CONFIDENCE.result.stdout)
  doc.verdict = verdict
  return json(doc)
}
/** The index of a group's heading: its first row to start with the section word and carry a clock reading. */
const headingAt = (rows: string[], label: string) => rows.findIndex(t => new RegExp(`^${label}\\b`).test(t) && CLOCK.test(t))
/** The rows between a group's heading and the next group's heading. */
function section(rows: string[], label: string): string[] {
  const at = headingAt(rows, label)
  expect(at >= 0).toBe(true)
  const after = GROUP_LABELS.map(g => headingAt(rows, g)).filter(i => i > at)
  return rows.slice(at + 1, after.length ? Math.min(...after) : rows.length)
}

// --- 1.6: the run's start, end and status line ---------------------------------

test('session.start registers /interlock-settle after the four earlier commands', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(w.commands).toEqual(['interlock-meter', 'interlock-preflight', 'interlock-handoff', 'interlock-spec', PANE])
})

test('a typed settle load with --review starts the run, opens the pane, and passes the prompt on unchanged', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(await loadSettle($)).toEqual({ text: LOAD })
  expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
  expect(w.opens).toEqual([PANE])
  expect(w.toasts).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).rows[0]).toMatch(new RegExp(UNKNOWN))
  for (const surface of SURFACES) expect((await pane($, surface)).rows[1]).toBe('with --review')
  // The CLI's own argv names the change, the pull request and the head.
  await to(w, 326)
  expect((await bash($, R.BASH_SETTLE_BRIEF.command)).text).toBe(R.BASH_SETTLE_BRIEF.text)
  expect(w.status.at(-1)).toMatch(new RegExp(`^${LINE}round 1 · `))
  for (const surface of SURFACES) {
    const header = (await pane($, surface)).rows[0]
    expect(header).toMatch(new RegExp(`^interlock settle — ${C} · PR #25 · `))
    expect(header).toMatch(/· head a96cb82 · /)
  }
})

test('a Skill tool load of the settle skill with --review starts the run too, and its result is the engine\'s', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  const r = await skill($, 'interlock:settle', '--review')
  expect(r.text).toBe('Launching skill: interlock:settle')
  expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
  expect(w.opens).toEqual([PANE])
})

// A settle load without --review starts a run too, and groups the pass under
// `resolve` (draw-the-settle-and-spec-panes-as-cards D4): this reverses the
// earlier --review-only start, on purpose.
for (const [how, load] of [
  ['a typed', ($: any) => submit($, LOAD_CREATE)],
  ['a Skill tool', ($: any) => skill($, 'interlock:settle', '--create')]
] as const) {
  test(`${how} settle load without --review starts the run, reads without --review, and groups under resolve on both surfaces`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    const r: any = await load($)
    if (how === 'a typed') expect(r).toEqual({ text: LOAD_CREATE })
    else expect(r.text).toBe('Launching skill: interlock:settle')
    expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
    expect(w.opens).toEqual([PANE])
    for (const surface of SURFACES) {
      const { rows } = await pane($, surface)
      expect(rows[0]).toMatch(new RegExp(UNKNOWN))
      expect(rows[1]).toBe('without --review')
    }
    expect((await bash($, ROUTING)).text).toBe(ROUTING_ANSWER.text)
    expect(w.status.at(-1)).toMatch(/: change: unknown until named · resolve · /)
    for (const surface of SURFACES) {
      const { rows } = await pane($, surface)
      expect(headingAt(rows, 'resolve') >= 0).toBe(true)
      expect(headingAt(rows, 'review')).toBe(-1)
    }
  })
}

test('review-code loaded alone with its fan-out draws nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect((await skill($, 'interlock:review-code')).text).toBe('Launching skill: interlock:review-code')
  expect((await bash($, ROUTING)).text).toBe(ROUTING_ANSWER.text)
  for (const heading of ['language & framework', 'technical lead', 'domain', 'blast-radius']) {
    const r = await spawn($, { prompt: DIM(heading), model: 'sonnet' })
    expect(r.model).toBe('claude-sonnet-5-5')
  }
  expect((await bash($, R.BASH_SETTLE_REVIEW.command)).text).toBe(R.BASH_SETTLE_REVIEW.text)
  expect(w.status).toEqual([])
  expect(w.opens).toEqual([])
  expect(w.toasts).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
})

test('a non-interactive session keeps nothing, draws nothing, and every hook resolves as the engine did', async ($: any, on: any) => {
  const w = world(on)
  await start($, false)
  expect(await loadSettle($)).toEqual({ text: LOAD })
  expect((await skill($, 'interlock:settle', '--review')).text).toBe('Launching skill: interlock:settle')
  expect((await bash($, R.BASH_SETTLE_BRIEF.command)).text).toBe(R.BASH_SETTLE_BRIEF.text)
  expect(await spawn($, { prompt: FIXER_PROMPT })).toEqual({ model: 'claude-opus-5-5', agentId: 'a1' })
  const answered = await step($, 'a1', 0, { effort: 'xhigh', model: 'claude-opus-5-5' })
  expect(answered.usage.model).toBe('claude-opus-5-5')
  expect(await complete($, 'a1', 'aborted', 19000)).toEqual({ turnId: 't-a1', text: '', reason: 'aborted' })
  expect((await bash($, R.BASH_SETTLE_MERGE_CONFIDENCE.command)).text).toBe(R.BASH_SETTLE_MERGE_CONFIDENCE.text)
  expect((await bash($, DRIFT)).text).toBe(w.bash.get(DRIFT)!.text)
  expect(w.status).toEqual([])
  expect(w.opens).toEqual([])
  expect(w.toasts).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
})

test('during a live run every hook the settle meter joins resolves as the engine alone would', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  expect((await skill($, 'interlock:review-code')).text).toBe('Launching skill: interlock:review-code')
  expect((await bash($, ROUTING)).text).toBe(ROUTING_ANSWER.text)
  expect((await bash($, TREE_CHECK)).text).toBe('clean')
  expect((await bash($, R.BASH_SETTLE_STOP.command)).text).toBe(R.BASH_SETTLE_STOP.text)
  expect((await bash($, R.BASH_SETTLE_STOP.command)).isError).toBe(true)
  expect((await bash($, CHECKS_WATCH, { run_in_background: true })).text).toBe('')
  expect((await bash($, 'ls -la')).text).toBe('')
  const spawned = await spawn($, { prompt: DIM('language & framework'), model: 'sonnet' })
  expect(spawned).toEqual({ model: 'claude-sonnet-5-5', agentId: 'a1' })
  const answered = await step($, 'a1', 0, { effort: 'medium', model: 'claude-sonnet-5-5' })
  expect(answered).toEqual({ ...R.STEP_AGENT_TOOL.result, turnId: 't-a1', index: 0, usage: { ...R.STEP_AGENT_TOOL.result.usage, model: 'claude-sonnet-5-5' } })
  expect(await complete($, 'a1', 'answer', 6521)).toEqual({ turnId: 't-a1', text: '', reason: 'answer' })
  expect(await $.classic.SessionStart({ source: 'compact' })).toEqual({})
})

test('an unasked open the engine declines raises one toast naming the command, and the status line is still set', async ($: any, on: any) => {
  const w = world(on, { placed: false })
  await start($)
  await loadSettle($)
  expect(w.opens).toEqual([PANE])
  expect(w.toasts).toEqual([UNPLACED])
  expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
})

test('/interlock-settle with no run opens the pane, says so and nothing else, and replies with an empty result', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(await $.command.run({ command: PANE, args: '' })).toEqual({})
  expect(w.opens).toEqual([PANE])
  expect(w.status).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
})

test('a ship launch takes the status line and leaves the pane; a settle line after it still files; a refused launch leaves the line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  const held = w.status.at(-1)
  expect(held).toMatch(new RegExp(`^${LINE}round 1 · `))
  await launch($, { name: 'refused' })
  expect(w.status.at(-1)).toBe(held)

  const before = w.status.length
  await launch($)
  w.bash.set(NEXT, ok(F.stdout(F.RUN_BATCH)))
  await bash($, NEXT)
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  const since = w.status.slice(before)
  expect(since.some(t => (t ?? '').includes('interlock settle'))).toBe(false)
  expect(w.status.at(-1)).toBe(`interlock: ${F.CHANGE} · run-batch · wave 2 · batch 1/2`)
  for (const surface of SURFACES) {
    const { rows } = await pane($, surface)
    expect(rows[0]).toMatch(new RegExp(`^interlock settle — ${C} · PR #25 · `))
    expect(section(rows, 'round 1').join('\n')).toContain('round 1: 1 fixed, 0 not fixed')
  }
})

test('a spec run beside a settle run: spec live wins, a live settle beats a checkpoint, a done settle yields to it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  expect(w.status.at(-1)).toMatch(new RegExp(`^${LINE}round 1 · `))

  // A live spec run takes the line; the settle record keeps filing.
  await loadSpec($)
  expect(w.status.at(-1)).toBe(`interlock spec: ${UNKNOWN}`)
  await bash($, SPEC_NEW_CHANGE)
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  expect(w.status.at(-1)).toMatch(/^interlock spec: /)
  for (const surface of SURFACES) expect(section((await pane($, surface)).rows, 'round 1').join('\n')).toContain('round 1: 1 fixed, 0 not fixed')

  // At the spec run's checkpoint the live settle run holds the line.
  await bash($, SPEC_CHECKPOINT)
  expect(w.status.at(-1)).toBe(`${LINE}round 1 · 1 fixed, 0 not fixed`)

  // A gate line the spec reader declines at its checkpoint still files in the settle record (D27).
  const r = await bash($, S.BASH_GATE_BLOCKED.command)
  expect(r.text).toBe(S.BASH_GATE_BLOCKED.text)
  expect(w.status.at(-1)).toMatch(new RegExp(`^${LINE}round 1 · `))
  for (const surface of SURFACES) expect(section((await pane($, surface)).rows, 'round 1').join('\n')).toMatch(/\bgate\b[^\n]*\bexit 1\b/)

  // A done settle run yields to the checkpointed spec line.
  await bash($, DRIFT)
  expect(w.status.at(-1)).toBe(`interlock spec: ${S.CHANGE} · checkpoint`)
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`a ${source} resets the settle run; a later line sets nothing and is named once`, async ($: any, on: any) => {
    const w = world(on)
    await start($)
    await loadSettle($)
    await bash($, R.BASH_SETTLE_BRIEF.command)
    expect(await $.classic.SessionStart({ source })).toEqual({})
    expect(w.status.at(-1)).toBeUndefined()
    for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
    const after = w.status.length
    const logged = settleLogs(w).length
    await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
    await bash($, R.BASH_SETTLE_MERGE_CONFIDENCE.command)
    expect(w.status.length).toBe(after)
    expect(settleLogs(w).length - logged).toBe(1)
    for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
  })
}

test('a compaction leaves the line, the groups and the rows', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  const before = [...w.status]
  const drawn = (await pane($, 'terminal')).rows
  expect(await $.classic.SessionStart({ source: 'compact' })).toEqual({})
  expect(await $.classic.SessionStart({ source: 'startup' })).toEqual({})
  expect(w.status).toEqual(before)
  expect((await pane($, 'terminal')).rows).toEqual(drawn)
})

test('a second settle load starts the record over and says so once', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  await loadSettle($)
  expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
  expect(w.logs.filter(l => l.to === 'debug' && /a new settle run replaced the previous one/.test(l.text))).toHaveLength(1)
  for (const surface of SURFACES) {
    const { rows, all } = await pane($, surface)
    expect(rows[0]).toMatch(new RegExp(UNKNOWN))
    expect(all).not.toContain('round 1: 1 fixed, 0 not fixed')
    expect(headingAt(rows, 'round 1')).toBe(-1)
  }
})

// --- 1.7: the pass itself ------------------------------------------------------

/**
 * The PR #25 pass (26m 39s) as the settle and review-code skills ran it, with
 * the status line read at the moments the design names. Every call's answer
 * is checked against the engine's own on the way.
 */
async function pr25($: any, w: World) {
  const seen: Record<string, string | undefined> = {}
  const cross = async (s: number, command: string, extra: Record<string, unknown> = {}) => {
    await to(w, s)
    const r = await bash($, command, extra)
    expect(r.text).toBe(w.bash.get(command)!.text)
    return r
  }
  await loadSettle($)
  await cross(0, ROUTING)
  await cross(3, DOMAIN_CONTEXT)

  // The review fan-out: four dimension reviewers, then two skeptics.
  const dims: Record<string, string> = {}
  for (const [s, heading] of [[74, 'language & framework'], [75, 'technical lead'], [76, 'domain'], [77, 'blast-radius']] as const) {
    await to(w, s)
    const r = await spawn($, { prompt: DIM(heading), model: 'sonnet' })
    expect(r.model).toBe('claude-sonnet-5-5')
    dims[heading] = r.agentId
  }
  for (const [s, heading] of [[80, 'language & framework'], [81, 'technical lead'], [82, 'domain'], [83, 'blast-radius']] as const) {
    await to(w, s)
    await step($, dims[heading], 0, { effort: 'medium', model: 'claude-sonnet-5-5' })
  }
  for (const [s, i] of [[90, 1], [100, 2]] as const) {
    await to(w, s)
    await step($, dims['language & framework'], i, { effort: 'medium', model: 'claude-sonnet-5-5' })
  }
  seen.fanOut = w.status.at(-1)
  for (const [s, heading, ms] of [[101, 'domain', 25_000], [134, 'language & framework', 60_000], [143, 'technical lead', 68_000], [152, 'blast-radius', 75_000]] as const) {
    await to(w, s)
    await complete($, dims[heading], 'answer', ms)
  }
  await to(w, 155)
  const refute = (await spawn($, { prompt: SKEPTIC_REFUTE })).agentId
  await to(w, 157)
  const second = (await spawn($, { prompt: SKEPTIC_SECOND })).agentId
  await to(w, 160)
  await step($, refute, 0, { effort: 'xhigh', model: 'claude-opus-5-5' })
  await to(w, 165)
  await step($, second, 0, { effort: 'xhigh', model: 'claude-opus-5-5' })
  await to(w, 176)
  await complete($, refute, 'answer', 21_000)
  await to(w, 180)
  await complete($, second, 'answer', 23_000)
  await cross(300, R.BASH_SETTLE_REVIEW.command)
  seen.review = w.status.at(-1)
  await cross(311, COMMENT)

  // Round 1: its tree-check opens it; the fixer runs; the re-review lands in it.
  seen.roundFrom = String(w.status.length)
  await cross(320, TREE_CHECK)
  await cross(326, R.BASH_SETTLE_BRIEF.command)
  await cross(330, ROUTING_FIXER)
  await agent($, w, { prompt: FIXER_PROMPT, spawnAt: 332, steps: [340, 600, 702], efforts: ['xhigh'], served: 'claude-opus-5-5' }).then(id => (seen.fixer = id))
  seen.fixerLive = w.status.at(-1)
  await to(w, 977)
  await complete($, seen.fixer!, 'answer', 645_000)
  await cross(980, R.BASH_SETTLE_FIXER_RESULT.command)
  seen.result = w.status.at(-1)
  await cross(1000, COMMIT_PUSH)
  await to(w, 1002)
  expect((await skill($, 'interlock:review-code')).text).toBe('Launching skill: interlock:review-code')
  await cross(1003, ROUTING)
  await agent($, w, { prompt: DIM('blast-radius'), model: 'sonnet', spawnAt: 1005, steps: [1010, 1020], served: 'claude-sonnet-5-5', end: { at: 1025, durationMs: 20_000 } })
  await cross(1033, REVIEW_R1)
  await cross(1040, REPLIES_R1)
  seen.roundTo = String(w.status.length)

  // Round 2: its tree-check, then the CLI's STOP.
  await cross(1044, TREE_CHECK)
  const stop = await cross(1046, R.BASH_SETTLE_STOP.command)
  expect(stop.isError).toBe(true)
  seen.stop = w.status.at(-1)

  // Conformance, verify, checks.
  await cross(1050, ROUTING_CONFORMANCE)
  await cross(1052, CONFORMANCE_BRIEF)
  await agent($, w, { prompt: WORKER_PROMPT, model: 'sonnet', spawnAt: 1053, steps: [1060, 1290], efforts: ['medium'], served: 'claude-sonnet-5-5', end: { at: 1298, durationMs: 245_000 } })
  await cross(1300, VERIFY_PLAN)
  await cross(1490, VERIFY_EXEC)
  await cross(1495, VERIFY_JUDGE)
  await cross(1500, CHECKS_WATCH, { run_in_background: true })

  // Merge confidence, publish, drift.
  await cross(1560, R.BASH_SETTLE_PIPELINE.command)
  seen.pipeline = w.status.at(-1)
  await cross(1590, R.BASH_SETTLE_MERGE_CONFIDENCE.command)
  seen.verdictFrom = String(w.status.length - 1)
  await cross(1591, MC_MARKDOWN)
  await cross(1595, ADD_LABELS)
  seen.afterLabels = w.status.at(-1)
  await cross(1599, DRIFT)
  return seen
}

const VERDICT = `${LINE}merge confidence · HUMAN 58`

test('the PR #25 pass moves the status line in the CLI\'s words and keeps the verdict on it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  const seen = await pr25($, w)
  expect(seen.fanOut).toMatch(new RegExp(`^interlock settle ${C}(?: #25)?: review · 4 live · language & framework ${durationText(26_000).replace('.', '\\.')} · 3 req$`))
  expect(seen.review).toMatch(new RegExp(`^interlock settle ${C}(?: #25)?: review · 6 raised · 0 dismissed · 6 surviving$`))
  expect(seen.fixerLive).toBe(`${LINE}round 1 · fixer 6m 10s · 3 req`)
  expect(seen.result).toBe(`${LINE}round 1 · 1 fixed, 0 not fixed`)
  expect(seen.stop).toBe(`${LINE}round 2 · STOP`)
  expect(seen.pipeline).toBe(`${LINE}merge confidence · pipeline 161f955`)
  // From its round's tree-check to its replies, the re-review included, the line reads round 1.
  const roundLines = w.status.slice(Number(seen.roundFrom), Number(seen.roundTo))
  expect(roundLines.length > 0).toBe(true)
  for (const text of roundLines) expect(text ?? '').toMatch(new RegExp(`^${LINE}round 1 · `))
  // The verdict holds through the markdown row, the labels line and the drift line, and is never cleared.
  expect(seen.afterLabels).toBe(VERDICT)
  for (const text of w.status.slice(Number(seen.verdictFrom))) expect(text).toBe(VERDICT)
  expect(w.status.at(-1)).toBe(VERDICT)
  // Two of the four toasts belong to a placed pass with no aborted agent: the STOP line verbatim and the verdict.
  expect(w.toasts).toEqual([STOP_LINE, 'merge-confidence: HUMAN 58'])
})

test('the PR #25 pass reads back as a grouped timeline in the CLI\'s words on both surfaces', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  for (const surface of SURFACES) {
    const { rows, all } = await pane($, surface)
    expect(rows[0]).toBe(`interlock settle — ${C} · PR #25 · lean · head 161f955 · 26m 39s`)

    const order = ['review', 'round 1', 'round 2', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']
    const at = order.map(g => headingAt(rows, g))
    for (const i of at) expect(i >= 0).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(headingAt(rows, 'ready')).toBe(-1)
    const reviewHeading = rows[headingAt(rows, 'review')]
    for (const part of [clockText(T0), clockText(T0 + 311_000), durationText(311_000)]) expect(reviewHeading).toContain(part)

    const review = section(rows, 'review')
    const dimsRow = review.find(t => t.includes('review dimensions'))!
    expect(dimsRow).toContain('review dimensions language, technical-lead · 4 spawned')
    expect(dimsRow).toContain('routed sonnet · medium')
    expect(review.some(t => t.includes('routed — · xhigh'))).toBe(true)
    expect(review.some(t => t.includes('6 raised · 0 dismissed · 6 surviving · head a96cb82'))).toBe(true)
    // Piped into `gh pr comment`, the call's exit is gh's, not the comment line's (PR #26 review, M6).
    expect(review.some(t => t.includes('round 0 · exit not its own'))).toBe(true)
    for (const name of ['language & framework', 'technical lead', 'domain', 'blast-radius']) expect(review.some(t => t.startsWith(name))).toBe(true)
    const lang = review.find(t => t.startsWith('language & framework'))!
    expect(lang.startsWith('language & framework · sonnet → claude-sonnet-5-5 · step medium · 3 req · ')).toBe(true)
    expect(lang.endsWith('1m 00s · answer')).toBe(true)

    const round1 = section(rows, 'round 1')
    for (const part of [
      'tree-check clean · exit 0',
      'round 1: 1 fixed, 0 not fixed',
      'commit fix(review): answer the PR #25 review round 1',
      'push exit 0',
      '161f955'
    ]) expect(round1.join('\n')).toContain(part)
    expect(round1.some(t => t.startsWith('blast-radius'))).toBe(true)
    const fixer = round1.find(t => t.startsWith('fixer'))!
    expect(fixer.startsWith('fixer · inherit → claude-opus-5-5 · routed — · xhigh · step xhigh')).toBe(true)
    expect(fixer).toMatch(/\b3 req\b/)
    expect(fixer.endsWith('10m 45s · answer')).toBe(true)

    const round2 = section(rows, 'round 2').join('\n')
    expect(round2).toContain('tree-check clean · exit 0')
    expect(round2).toContain(STOP_LINE)
    expect(round2).not.toContain('interlock: STOP')

    const worker = section(rows, 'conformance').find(t => t.includes('claude-sonnet-5-5'))!
    expect(worker).toContain('routed sonnet · —')
    expect(worker.endsWith('4m 05s · answer')).toBe(true)

    const verify = section(rows, 'verify').join('\n')
    expect(verify).toContain('plan exit 0')
    expect(verify).toContain('exec unit exit 0')
    expect(verify).toContain('judge exit 0 · result not seen (redirected)')
    expect((verify.match(/result not seen \(redirected\)/g) || []).length).toBe(2)
    expect(section(rows, 'checks').join('\n')).toContain('gh pr checks 25 --watch · background')

    const mc = section(rows, 'merge confidence').join('\n')
    expect(mc).toContain(R.BASH_SETTLE_PIPELINE.text)
    expect(mc).toContain('HUMAN 58 · head 161f955')
    expect(mc.indexOf('HUMAN 58') < mc.indexOf('merge-confidence --markdown · exit 0')).toBe(true)
    expect(section(rows, 'publish').join('\n')).toContain('labels interlock/human-review, interlock/score-58')
    expect(section(rows, 'drift').join('\n')).toContain('unarchived 1 · broken 0')
    expect(rows.some(t => t.startsWith(`done ${new Date(T0 + 1_599_000).toISOString()}`))).toBe(true)

    // Nothing the CLI, the engine or the clock did not supply; never the roll-up's word.
    expect(all).not.toMatch(/complete/i)
    expect(all).not.toMatch(/✓|✔|✗|\b(passed|failed|halted)\b/i)
    expect(all).not.toContain('probe reply')
  }
})

test('below 110 columns the pass folds its agent rows to role, served model, time and reason on both surfaces', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  for (const surface of SURFACES) {
    const { rows } = await pane($, surface, 90)
    expect(rows.find(t => t.startsWith('fixer'))).toBe('fixer · claude-opus-5-5 · 10m 45s · answer')
    expect(rows.find(t => t.startsWith('language & framework'))).toBe('language & framework · claude-sonnet-5-5 · 1m 00s · answer')
    expect(rows[0]).toBe(`interlock settle — ${C} · PR #25 · lean · head 161f955 · 26m 39s`)
  }
})

test('after the drift line a keyed line changes nothing and is named once', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  const before = [...w.status]
  const drawn = (await pane($, 'terminal')).rows
  const logged = settleLogs(w).length
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  await bash($, R.BASH_SETTLE_MERGE_CONFIDENCE.command)
  expect(w.status).toEqual(before)
  expect(settleLogs(w).length - logged).toBe(1)
  expect((await pane($, 'terminal')).rows).toEqual(drawn)
  expect(w.toasts).toEqual([STOP_LINE, 'merge-confidence: HUMAN 58'])
})

test('the four toasts, and no other: a declined open, the STOP line, an aborted worker and the verdict', async ($: any, on: any) => {
  const w = world(on, { placed: false })
  await start($)
  await loadSettle($)
  await bash($, ROUTING)
  // A turn that ends with an answer raises nothing.
  await agent($, w, { prompt: DIM('language & framework'), model: 'sonnet', spawnAt: 10, steps: [12], served: 'claude-sonnet-5-5', end: { at: 14, durationMs: 4000 } })
  await to(w, 20)
  await bash($, R.BASH_SETTLE_STOP.command)
  await bash($, ROUTING_CONFORMANCE)
  await bash($, CONFORMANCE_BRIEF)
  await agent($, w, { prompt: WORKER_PROMPT, model: 'sonnet', spawnAt: 30, steps: [40], served: 'claude-sonnet-5-5', end: { at: 49, reason: 'aborted', durationMs: 19_000 } })
  await bash($, R.BASH_SETTLE_MERGE_CONFIDENCE.command)
  expect(w.toasts).toEqual([UNPLACED, STOP_LINE, 'conformance: aborted', 'merge-confidence: HUMAN 58'])
})

test('a spawn matching no source is drawn as its type and unattributed, never by its description, and never takes the line', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  const held = w.status.at(-1)
  await to(w, 5)
  const r = await spawn($, { prompt: 'Please summarise the diff', description: 'summarise it for the reviewer' })
  expect(r).toEqual({ model: 'claude-opus-5-5', agentId: 'a1' })
  for (const [s, i] of [[9, 0], [200, 1]] as const) {
    await to(w, s)
    await step($, r.agentId, i, { effort: 'high', model: 'claude-opus-5-5' })
  }
  expect(w.status.at(-1)).toBe(held)
  expect(w.status.at(-1) ?? '').not.toMatch(/live|req/)
  for (const surface of SURFACES) {
    const { rows, all } = await pane($, surface)
    const row = section(rows, 'round 1').find(t => t.startsWith('general-purpose'))!
    expect(row).toContain('unattributed')
    expect(row).toContain('claude-opus-5-5')
    expect(row).toContain('step high')
    expect(all).not.toContain('summarise it for the reviewer')
  }
})

test('a spawn before any routing line reads routed: not seen, and its call reaches the engine unchanged', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await to(w, 5)
  const r = await spawn($, { prompt: SKEPTIC_REFUTE })
  expect(r).toEqual({ model: 'claude-opus-5-5', agentId: 'a1' })
  await to(w, 9)
  await step($, r.agentId, 0, { effort: 'xhigh', model: 'claude-opus-5-5' })
  expect(w.spawned).toEqual(['general-purpose'])
  for (const surface of SURFACES) {
    const { all } = await pane($, surface)
    expect(all).toContain('routed: not seen')
    expect(all).not.toMatch(/routed (sonnet|—)/)
  }
})

test('a step level that changed draws the first and the latest; one that held draws one', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, CONFORMANCE_BRIEF)
  await agent($, w, { prompt: WORKER_PROMPT, model: 'sonnet', spawnAt: 11, steps: [20, 30, 40], efforts: ['medium', 'medium', 'high'], served: 'claude-sonnet-5-5' })
  await agent($, w, { prompt: DIM('QA'), model: 'sonnet', spawnAt: 50, steps: [55, 60], efforts: ['medium'], served: 'claude-sonnet-5-5' })
  for (const surface of SURFACES) {
    const rows = section((await pane($, surface)).rows, 'conformance')
    expect(rows.some(t => t.includes('step medium → high'))).toBe(true)
    const qa = rows.find(t => t.startsWith('QA'))!
    expect(qa).toContain('step medium')
    expect(qa).not.toContain('→ medium')
    expect(qa).not.toContain('medium →')
  }
})

test('an aborted worker ends its row in the host\'s word and raises one toast in it', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, CONFORMANCE_BRIEF)
  await agent($, w, { prompt: WORKER_PROMPT, model: 'sonnet', spawnAt: 11, steps: [20, 30], efforts: ['medium', 'high'], served: 'claude-sonnet-5-5', end: { at: 30, reason: 'aborted', durationMs: 19_000 } })
  expect(w.toasts).toEqual(['conformance: aborted'])
  for (const surface of SURFACES) {
    const row = section((await pane($, surface)).rows, 'conformance').find(t => t.includes('claude-sonnet-5-5') && t.includes('step '))!
    expect(row).toContain('step medium → high')
    expect(row.endsWith(' · aborted')).toBe(true)
  }
})

// --- the PR #26 review's fixes (M2-M5, M15, B4, B5) ------------------------------

const SPEC_DRIFT = 'interlock drift --json'

test('M2: the spec flow\'s `interlock drift --json` during a live pass leaves the pass live', async ($: any, on: any) => {
  const w = world(on)
  w.bash.set(SPEC_DRIFT, json({ root: '.', unarchived: [], stale: { skipped: false, reason: null, broken: [], aging: [] } }))
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  await loadSpec($)
  await bash($, SPEC_DRIFT)
  await bash($, SPEC_CHECKPOINT)
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  expect(w.status.at(-1)).toBe(`${LINE}round 1 · 1 fixed, 0 not fixed`)
  for (const surface of SURFACES) expect(headingAt((await pane($, surface)).rows, 'drift')).toBe(-1)
})

test('M3: a session that never ran settle parses no Bash call for it after a clear, and names nothing', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  expect(await $.classic.SessionStart({ source: 'clear' })).toEqual({})
  await bash($, COMMIT_PUSH)
  await bash($, COMMIT_PUSH)
  expect(settleLogs(w)).toEqual([])
  for (const surface of SURFACES) expect((await pane($, surface)).all.trim()).toBe(NO_RUN)
})

test('M3: after the drift line only the first keyed line is named, and later ones are not read', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  const logged = settleLogs(w).length
  for (let i = 0; i < 3; i++) await bash($, COMMIT_PUSH)
  expect(settleLogs(w).length - logged).toBe(1)
})

test('M4: with a ship run and a settle pass live, a lane\'s lines stay out of the pass and a settle agent stays out of the ship', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, R.BASH_SETTLE_REVIEW.command)
  await bash($, TREE_CHECK)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  await launch($)
  w.bash.set(NEXT, ok(F.stdout(F.RUN_BATCH)))
  await bash($, NEXT)
  // A ship lane's verify line and commit carry the lane's agent id.
  await bash($, VERIFY_EXEC, { agentId: 'lane-1' })
  await bash($, COMMIT_PUSH, { agentId: 'lane-1' })
  await bash($, R.BASH_SETTLE_FIXER_RESULT.command)
  await bash($, CONFORMANCE_BRIEF)
  await agent($, w, { prompt: WORKER_PROMPT, model: 'sonnet', spawnAt: 30, steps: [40], served: 'claude-sonnet-5-5', end: { at: 49, reason: 'aborted', durationMs: 19_000 } })
  for (const surface of SURFACES) {
    const { rows } = await pane($, surface)
    expect(headingAt(rows, 'verify')).toBe(-1)
    const round1 = section(rows, 'round 1').join('\n')
    expect(round1).toContain('round 1: 1 fixed, 0 not fixed')
    expect(round1).not.toContain('commit fix(review)')
  }
  expect(w.toasts.filter(t => t.includes('aborted'))).toEqual(['conformance: aborted'])
})

test('M5: a ship launch takes the status line at the launch itself, and its close hands the line back to the finished pass', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  const verdict = w.status.at(-1)
  expect(verdict).toMatch(new RegExp(`^${LINE}merge confidence · `))
  const before = w.status.length
  await launch($)
  expect(w.status.length).toBeGreaterThan(before)
  expect(w.status.at(-1) ?? '').not.toMatch(/^interlock settle/)
  w.bash.set(NEXT, ok(F.stdout(F.RUN_BATCH)))
  await bash($, NEXT)
  w.bash.set(NEXT, ok(F.stdout(F.CLOSE_STEP)))
  await bash($, NEXT)
  expect(w.status.at(-1)).toBe(verdict)
})

test('M15: a clock the engine refuses leaves every row untimed, says so on the pane, and is named once', async ($: any, on: any) => {
  const w = world(on, { clock: false })
  await start($)
  await loadSettle($)
  await bash($, ROUTING)
  await bash($, R.BASH_SETTLE_REVIEW.command)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  expect(w.status.at(-1)).toMatch(new RegExp(`^${LINE}round 1 · `))
  for (const surface of SURFACES) {
    const { rows } = await pane($, surface)
    expect(rows[0].endsWith('time unknown')).toBe(true)
    expect(rows.some(t => t.startsWith('time unknown routing · depth lean'))).toBe(true)
  }
  expect(settleLogs(w).filter(l => l.text.includes('the clock cannot be read'))).toHaveLength(1)
})

test('B4: a spec run\'s Explore investigator is not counted as a settle agent', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, ROUTING)
  await loadSpec($)
  await spawn($, { prompt: 'Investigate the hooks module', model: 'sonnet', subagentType: 'Explore' })
  for (const surface of SURFACES) expect((await pane($, surface)).all).not.toContain('Explore · unattributed')
  expect(w.spawned).toEqual(['Explore'])
})

test('B5: a typed settle load after a blank line still starts the run', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await submit($, `\n\n${LOAD}`)
  expect(w.status.at(-1)).toBe(`interlock settle: ${UNKNOWN}`)
  expect(w.opens).toEqual([PANE])
})

// --- the cards (draw-the-settle-and-spec-panes-as-cards design D3) -------------

test('the PR #25 pass draws as single-border cards: an accent header, a dim card per group, the verdict in its own warn card', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  for (const surface of SURFACES) {
    const d = await drawing($, surface)
    expect(d.cards.length > 0).toBe(true)
    for (const c of d.cards) {
      expect(c.props.borderStyle).toBe('single')
      // A card is never a keyed row: the readers of the keyed Boxes still see the rows flat.
      expect(c.props.key).toBeUndefined()
    }
    const header = d.cards[0]
    expect(header.keys).toEqual(['settle-header', 'settle-mode'])
    expect(header.props.borderColor).toBe(PALETTE.accent)
    expect(header.props.width).toBe(144)
    for (const label of ['review', 'round 1', 'round 2', 'conformance', 'verify', 'checks', 'merge confidence', 'publish', 'drift']) {
      const c = groupCard(d, label)
      expect(c).toBeDefined()
      // A done run marks no card as the open one.
      expectDim(c)
      expect(c!.props.width).toBe(144)
    }
    const verdict = verdictCard(d, 'HUMAN')
    expect(verdict).toBeDefined()
    expect(verdict!.props.borderColor).toBe(PALETTE.warn)
    expect(verdict!.props.borderDimColor).toBeUndefined()
    expect(groupCard(d, 'merge confidence')!.keys).toContain(verdict!.keys[0])
    // The done line and the banners sit after the cards, in none of them.
    for (const key of ['settle-done', 'settle-banners']) {
      expect(d.rows.some(r => r.key === key)).toBe(true)
      expect(d.cards.some(c => c.keys.includes(key))).toBe(false)
    }
    // The keyed rows read exactly the texts the pane reads by row.
    expect(d.rows.map(r => r.text)).toEqual((await pane($, surface)).rows)
  }
})

test('while a round is live its card is bordered in the current colour, its agents indented as layout; once done no card is', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await loadSettle($)
  await bash($, ROUTING)
  await to(w, 10)
  await spawn($, { prompt: DIM('language & framework'), model: 'sonnet' })
  await to(w, 60)
  await bash($, R.BASH_SETTLE_REVIEW.command)
  await to(w, 70)
  await bash($, R.BASH_SETTLE_BRIEF.command)
  await agent($, w, { prompt: FIXER_PROMPT, spawnAt: 80, steps: [90], efforts: ['xhigh'], served: 'claude-opus-5-5' })
  for (const surface of SURFACES) {
    const d = await drawing($, surface)
    const round = groupCard(d, 'round 1')
    expect(round!.props.borderColor).toBe(PALETTE.current)
    expect(round!.props.borderDimColor).toBeUndefined()
    expectDim(groupCard(d, 'review'))
    // A role row sits at the gutter; an agent beneath it one indent further; an agent with no role row at the gutter.
    const role = d.rows.find(r => /-role-dimension$/.test(r.key))!
    expect(role.props.paddingLeft).toBe(9)
    const dim = d.rows.find(r => r.text.startsWith('language & framework'))!
    expect(dim.props.paddingLeft).toBe(11)
    const fixer = d.rows.find(r => r.text.startsWith('fixer'))!
    expect(fixer.props.paddingLeft).toBe(9)
    expect(fixer.text.endsWith(' · live')).toBe(true)
    // The end word is a span of its own, in the colour of a running turn.
    const word = tree(fixer.node).find((n: any) => n?.type === 'Text' && textOf(n) === 'live')
    expect(word?.props?.color).toBe(turnProps(null).color)
    // Indentation is layout, never characters in the text.
    expect(/^\s/.test(fixer.text)).toBe(false)
  }
  await bash($, DRIFT)
  for (const surface of SURFACES) {
    const d = await drawing($, surface)
    for (const label of ['review', 'round 1', 'drift']) expectDim(groupCard(d, label))
  }
})

for (const [word, color] of [
  ['MERGE', PALETTE.ok],
  ['HUMAN', PALETTE.warn],
  ['BLOCK', PALETTE.alarm],
  ['MAYBE', null]
] as const) {
  test(`a ${word} verdict's own card is bordered ${color === null ? 'dim, the word unknown to the meter' : 'by its tone'}`, async ($: any, on: any) => {
    const w = world(on)
    w.bash.set(R.BASH_SETTLE_MERGE_CONFIDENCE.command, mcAnswer(word))
    await start($)
    await loadSettle($)
    await bash($, ROUTING)
    await bash($, R.BASH_SETTLE_MERGE_CONFIDENCE.command)
    for (const surface of SURFACES) {
      const d = await drawing($, surface)
      const c = verdictCard(d, word)
      expect(c).toBeDefined()
      expect(c!.props.borderStyle).toBe('single')
      if (color === null) expectDim(c)
      else {
        expect(c!.props.borderColor).toBe(color)
        expect(c!.props.borderDimColor).toBeUndefined()
      }
      // The merge-confidence card is the open one, the verdict card nested in it.
      const mc = groupCard(d, 'merge confidence')
      expect(mc!.props.borderColor).toBe(PALETTE.current)
      expect(mc!.keys).toContain(c!.keys[0])
    }
  })
}

test('below the card floor the pane draws flat: no Box has a border and every keyed row still reads its text', async ($: any, on: any) => {
  const w = world(on)
  await start($)
  await pr25($, w)
  expect(40 < LIMITS.waveBoardMinColumns).toBe(true)
  for (const surface of SURFACES) {
    const flat = await drawing($, surface, 40)
    expect(flat.cards).toEqual([])
    for (const p of flat.props) {
      expect(p.borderStyle).toBeUndefined()
      expect(p.borderColor).toBeUndefined()
      expect(p.borderDimColor).toBeUndefined()
    }
    // 40 and 90 columns both fold the agent rows, so their texts are the same; only 90 draws cards.
    const carded = await drawing($, surface, 90)
    expect(carded.cards.length > 0).toBe(true)
    expect(flat.rows.map(r => [r.key, r.text])).toEqual(carded.rows.map(r => [r.key, r.text]))
  }
})

test('the no-run pane is exactly one Text and no card', async ($: any, on: any) => {
  world(on)
  await start($)
  for (const surface of SURFACES) {
    const d = await drawing($, surface)
    expect(d.texts).toBe(1)
    expect(d.cards).toEqual([])
    expect(d.rows.map(r => r.text)).toEqual([NO_RUN])
  }
})
