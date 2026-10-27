// The hooks module's reach, pinned statically (design D8, D13).
//
// The module runs inside the engine, with no Node and `$` as its only way out,
// and it is written to observe: no substitute result, no catch handler, no
// model, prompt, message, process, network, file write or permission check.
// Nothing at run time would notice a hook that started deciding, so the
// guarantee is read off the source here, before any session loads it.
//
// One exception, and only one (guard-ship-relaunch-in-process design D3): the
// launch guard's branch of the Workflow hook may refuse a ship launch, with the
// verdict `decideLaunch` reached over the session's recorded facts and the
// words that verdict carries. Every other refusal still fails these pins, as
// does a session-state key the plugin's type contract does not declare.
//
// The module is read as TEXT and never imported: its one bare specifier,
// `claude-code`, is the engine's and does not resolve under Node, and this
// suite runs on Node 18. The engine's own behaviour is tested by
// `test/mod/meter.test.ts` under `claude plugin test`, which `npm test` never
// collects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { specifiers, walkModule } from '../helpers/module-walk.mjs'
import { GUARD_NAMES } from '../../lib/meter-refusals.mjs'
import { SPEC_PANE } from '../../lib/spec-meter.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json')

/** The engine calls the module may make, exactly (design D8). */
export const ALLOWED_CALLS = Object.freeze([
  '$.ui.status',
  '$.ui.toast',
  '$.ui.log',
  '$.ui.open',
  // Follow the pane's latest line once, so a live run keeps its tail in view.
  '$.ui.scroll',
  '$.ui.invalidate',
  '$.ui.resolve',
  '$.command.register',
  '$.session.usage',
  '$.session.version',
  // The launch guard (guard-ship-relaunch-in-process design D2, D3): the time,
  // and its one session-state key read and written.
  '$.clock.now',
  '$.state.get',
  '$.state.set',
  // The meter's one timer (show-quiet-time-and-reset-the-meter-on-clear design
  // D2): the host's own interval, started for a live run and cancelled with it.
  '$.clock.every',
  // The one file read (show-preflight-and-interrupted-runs-at-session-start
  // design D5, D6): the preflight's report file and a card that file names.
  '$.fs.read'
])

/** What the launch guard added to the meter's allow-list, exactly. */
const GUARD_CALLS = Object.freeze(['$.clock.now', '$.state.get', '$.state.set'])

/** The one line in the module that may refuse a call: the rule's verdict, in the rule's words. */
export const GUARD_REFUSAL = "if (launch && verdict.decision === 'deny') return { deny: verdict.reason }"

/**
 * The events the module hooks, exactly: the meter's, the launch guard's two
 * (design D3), and the session boundary the meter resets on
 * (show-quiet-time-and-reset-the-meter-on-clear design D4). The spec meter
 * (observe-the-spec-run-live design D1) adds none: its two observers are
 * `prompt.submit` and a `tool.call` matcher.
 */
export const HOOKED_EVENTS = Object.freeze([
  'session.start',
  'tool.call',
  'turn.step',
  'turn.complete',
  'agent.spawn',
  'ui.render',
  'command.run',
  'prompt.submit',
  'session.receive',
  'classic.SessionStart'
])

/** Tokens whose presence anywhere in the module means it stopped only observing (design D8). */
export const FORBIDDEN_TOKENS = Object.freeze([
  '.catch(',
  'tool.check',
  '$.model',
  '$.prompt',
  '$.process',
  '$.http',
  '$.session.send',
  '$.fs.write',
  '$.store',
  // A wait charged to the hook's own budget: the meter's period is the host's
  // interval, never a sleep loop inside a hook (show-quiet-time design D2).
  '$.clock.sleep',
  // The hook lists the cards and states the directories, in Node; the module
  // reads the one file it is pointed at (show-preflight-and-interrupted-runs-
  // at-session-start design D4).
  '$.fs.list',
  '$.fs.exists'
])

const CONTRACT_KEY = 'types'

/** Every `$.<noun>.<method>` a source spells, in order of first appearance. */
export function engineCalls(source) {
  return [...new Set([...source.matchAll(/\$\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)].map(m => `$.${m[1]}.${m[2]}`))]
}

// The walker is shared with the renderers' purity pin, so the two cannot drift.
export { specifiers, walkModule }

function readHooksJson() {
  return JSON.parse(readFileSync(HOOKS_JSON, 'utf8'))
}

function moduleEntry() {
  const { modules } = readHooksJson()
  return resolve(dirname(HOOKS_JSON), modules[0])
}

test('hooks/hooks.json carries an empty legacy hooks record beside exactly one module', () => {
  const parsed = readHooksJson()
  assert.ok('hooks' in parsed, 'hooks/hooks.json has no `hooks` key: Claude Code 2.1.161 refuses the file without one (design D13)')
  assert.deepEqual(
    parsed.hooks,
    {},
    'the `hooks` record must stay empty: the settings hooks live in the manifest, where test/hooks.test.mjs pins them'
  )
  assert.ok(Array.isArray(parsed.modules), '`modules` is not an array')
  assert.equal(parsed.modules.length, 1, `hooks/hooks.json names ${parsed.modules.length} modules, not exactly one`)
  const entry = moduleEntry()
  assert.ok(statSync(entry, { throwIfNoEntry: false })?.isFile(), `${parsed.modules[0]} does not exist`)
  assert.match(readFileSync(entry, 'utf8'), /export (function|const) register\b/, 'the module exports no `register`')
})

test('the hooks module calls only the engine methods the design allows', () => {
  const extra = engineCalls(readFileSync(moduleEntry(), 'utf8')).filter(c => !ALLOWED_CALLS.includes(c))
  assert.deepEqual(extra, [], `engine calls outside the allow-list: ${extra.join(', ')}`)
})

test('the hooks module contains none of the forbidden tokens', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  const present = FORBIDDEN_TOKENS.filter(t => source.includes(t))
  assert.deepEqual(present, [], `forbidden tokens in the hooks module: ${present.join(', ')}`)
})

/**
 * What a hook does with a parameter it renamed away from `$`, `e` and `next`.
 *
 * The allow-list and the forbidden tokens read `$.`, so an engine call spelled
 * through any other name goes unseen. A hook may still name its parameters for
 * a reader, provided the engine handle is only passed on, never read through,
 * and the forward is only called with the hook's own input, so the event goes
 * on unchanged. Each problem names the hook's event and the offending spelling.
 */
export function renamedHookReach(source) {
  const matcher = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`
  const name = String.raw`[A-Za-z_][\w]*`
  const head = new RegExp(
    String.raw`\bon\(\s*'([A-Za-z.]+)'\s*,\s*(?:${matcher}\s*,\s*)?(?:async\s+)?(?:function\*?\s*)?` +
      String.raw`(?:\(\s*(${name})(?:\s*,\s*(${name}))?(?:\s*,\s*(${name}))?\s*\)|(${name}))\s*(?:=>|\{)`,
    'g'
  )
  const problems = []
  for (const m of source.matchAll(head)) {
    const [, event, api = m[5], input, forward] = m
    const rest = source.slice(m.index + m[0].length)
    if (api !== '$') {
      for (const read of rest.matchAll(new RegExp(String.raw`\b${api}\s*(?:\?\.|\.|\[)`, 'g'))) {
        problems.push(`${event}: ${api} is read through (${read[0].trim()})`)
      }
    }
    if (forward && forward !== 'next') {
      for (const use of rest.matchAll(new RegExp(String.raw`\b${forward}\b(\s*\(\s*([^)]*?)\s*\))?`, 'g'))) {
        if (use[2] !== input) problems.push(`${event}: ${forward} is not called with ${input} alone (${use[0].trim()})`)
      }
    }
  }
  return [...new Set(problems)]
}

test('a hook parameter renamed from `$` is only passed on, and a renamed forward only carries the input', () => {
  const problems = renamedHookReach(readFileSync(moduleEntry(), 'utf8'))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the renamed-parameter pin names a read through the handle and a forward fed anything but the input', () => {
  const ok = "on('agent.spawn', async (api, input, forward) => {\n  return forward(input).then(r => note(api, input, r))\n})\n"
  assert.deepEqual(renamedHookReach(ok), [])
  assert.deepEqual(renamedHookReach("on('command.run', { command: PANE }, async host => {\n  host.process.run(['x'])\n})\n"), [
    'command.run: host is read through (host.)'
  ])
  assert.deepEqual(
    renamedHookReach("on('agent.spawn', async (api, input, forward) => {\n  return forward({ ...input, permissionMode: 'x' })\n})\n"),
    ["agent.spawn: forward is not called with input alone (forward({ ...input, permissionMode: 'x' }))"]
  )
  // The module's own hook shapes parse: a read slipped into the real source is named.
  const source = readFileSync(moduleEntry(), 'utf8')
  const spawn = source.replace('noteSpawn(meterSpawnApi,', 'noteSpawn(meterSpawnApi.process,')
  assert.notEqual(spawn, source, 'the agent.spawn hook no longer passes meterSpawnApi on; update this probe')
  assert.deepEqual(renamedHookReach(spawn), ['agent.spawn: meterSpawnApi is read through (meterSpawnApi.)'])
  const pane = source.replace('await openPane(paneHost)', 'await openPane(paneHost[0])')
  assert.notEqual(pane, source, 'the pane command no longer passes paneHost on; update this probe')
  assert.deepEqual(renamedHookReach(pane), ['command.run: paneHost is read through (paneHost[)'])
})

const SESSION_START = 'classic.SessionStart'

/** What a hook that returns the forward call and nothing else never spells. */
const CONTINUATION_TOKENS = Object.freeze([
  ['.then(', /\.then\(/],
  ['.finally(', /\.finally\(/],
  ['await', /\bawait\s/],
  ['const', /\bconst\s/],
  ['let', /\blet\s/]
])

/**
 * What the classic session-start hook returns, when that is anything but the
 * forward call on the hook's own input (clear-the-plugin-directory-holds
 * design D2).
 *
 * The event's result carries the session's first message, and the plugin
 * directory holds a version whose hook it cannot read as leaving that message
 * alone. No local command reproduces that reading, so the one shape the
 * directory names is read off the source here: a single return, of the forward
 * called with the input, with nothing bound to the call, awaited on it or
 * chained after it. The parameter names are read from the hook's own
 * signature, so a rename does not break the pin. Each problem names the event
 * and the shape found.
 */
export function sessionStartReturnProblems(source) {
  const body = hookBody(source, SESSION_START)
  if (!body) return [`${SESSION_START}: the module hooks no such event`]
  const name = String.raw`[A-Za-z_]\w*`
  const head = body.match(
    new RegExp(
      String.raw`^on\(\s*'classic\.SessionStart'\s*,\s*(?:async\s+)?\(\s*(${name})\s*,\s*(${name})\s*,\s*(${name})\s*\)\s*=>\s*\{`
    )
  )
  if (!head) return [`${SESSION_START}: the hook does not name its three parameters`]
  const [, , input, forward] = head
  const lines = []
  for (const line of body.slice(head[0].length).split('\n')) {
    const text = line.trim()
    if (text === '})') break
    if (text && !text.startsWith('//')) lines.push(text)
  }
  const code = lines.join('\n')
  const wanted = `return ${forward}(${input})`
  const problems = []
  const returns = (code.match(/\breturn\b/g) || []).length
  if (returns !== 1) problems.push(`${SESSION_START}: the hook holds ${returns} return statements, not one`)
  for (const line of lines.filter(l => /\breturn\b/.test(l))) {
    if (line !== wanted) problems.push(`${SESSION_START}: the return is not ${wanted} alone (${line})`)
  }
  for (const [token, spelled] of CONTINUATION_TOKENS) {
    if (spelled.test(code)) problems.push(`${SESSION_START}: the hook spells ${token}`)
  }
  const forwards = (code.match(new RegExp(String.raw`\b${forward}\b`, 'g')) || []).length
  if (forwards !== 1) problems.push(`${SESSION_START}: ${forward} occurs ${forwards} times, not once`)
  return problems
}

test('the classic session-start hook returns the forward call and nothing else', () => {
  const problems = sessionStartReturnProblems(readFileSync(moduleEntry(), 'utf8'))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the session-start return pin names a continuation, an awaited variable, an object of its own and no return', () => {
  const hook = lines =>
    ["on('classic.SessionStart', async (api, input, forward) => {", '  endRunAtBoundary(api, input)', ...lines, '})', '', "on('ui.render', () => {})", ''].join('\n')
  // A comment is not the hook's code: a continuation named in one is not found.
  assert.deepEqual(sessionStartReturnProblems(hook(['  // never forward(input).then(…) here', '  return forward(input)'])), [])
  const named = (lines, ...tokens) => {
    const problems = sessionStartReturnProblems(hook(lines))
    for (const token of tokens) {
      assert.ok(problems.some(p => p.startsWith(`${SESSION_START}: `) && p.includes(token)), `${token} is not named in:\n${problems.join('\n')}`)
    }
  }
  named(['  return forward(input).then(async started => {', '    await read(api, input)', '    return started', '  })'], 'spells .then(', 'not return forward(input) alone', '2 return statements')
  named(['  return forward(input).finally(() => read(api, input))'], 'spells .finally(', 'not return forward(input) alone (return forward(input).finally(')
  named(['  const started = await forward(input)', '  await read(api, input)', '  return started'], 'spells await', 'spells const', 'not return forward(input) alone (return started)')
  named(['  return {}'], 'not return forward(input) alone (return {})', 'forward occurs 0 times')
  named(['  forward(input)'], '0 return statements')
  assert.deepEqual(sessionStartReturnProblems("on('session.start', () => {})\n"), [`${SESSION_START}: the module hooks no such event`])
})

test('the launch guard\'s calls are the clock and its state read and write, and nothing more', () => {
  const meter = ALLOWED_CALLS.filter(c => !GUARD_CALLS.includes(c))
  assert.equal(meter.length + GUARD_CALLS.length, ALLOWED_CALLS.length, 'the allow-list repeats an entry')
  const calls = engineCalls(readFileSync(moduleEntry(), 'utf8'))
  const missing = GUARD_CALLS.filter(c => !calls.includes(c))
  assert.deepEqual(missing, [], `the module never calls ${missing.join(', ')}: the launch guard has no time or no ledger`)
})

/** Every index in `source` where `token` occurs. */
const occurrences = (source, token) => {
  const at = []
  for (let i = source.indexOf(token); i !== -1; i = source.indexOf(token, i + 1)) at.push(i)
  return at
}

/** Every `deny` in `source` that is not inside the guard's one refusal line, by line number. */
export function strayRefusals(source) {
  const lines = source.split('\n')
  const stray = []
  lines.forEach((line, i) => {
    if (!line.includes('deny')) return
    if (line.trim() !== GUARD_REFUSAL) stray.push(`line ${i + 1}: ${line.trim()}`)
  })
  return stray
}

test('the only refusal in the hooks module is the launch rule\'s verdict, once', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.deepEqual(strayRefusals(source), [], 'a deny the launch rule did not reach')
  assert.equal(occurrences(source, GUARD_REFUSAL).length, 1, `the module must hold exactly one: ${GUARD_REFUSAL}`)
  const assigned = [...source.matchAll(/\bverdict\s*=(?!=)/g)].length
  assert.equal(assigned, 1, `verdict is assigned ${assigned} times; it must be decideLaunch's result and nothing else`)
  assert.match(source, /\bconst verdict = decideLaunch\(/, 'verdict is not decideLaunch\'s result')
  assert.match(
    source,
    /import \{[^}]*\bdecideLaunch\b[^}]*\} from '\.\.\/lib\/launch-rule\.mjs'/,
    'the module does not take decideLaunch from lib/launch-rule.mjs, so its words are not the settings form\'s'
  )
  assert.ok(!source.includes('Leftover'), 'the module restates the skill sentence instead of carrying the rule\'s reason')
})

test('the hooks module reads two files at most, and never the trajectory, a manifest, a wave state or the spill', () => {
  // The preflight's report file and a card it names (design D5, D6), each from
  // one helper; the brief's rejection of a whole-trajectory read stands.
  const source = readFileSync(moduleEntry(), 'utf8')
  const reads = occurrences(source, '$.fs.read(').length
  assert.ok(reads >= 1 && reads <= 2, `the module spells $.fs.read( ${reads} times`)
  const reached = ['ship/runs', 'run.json', 'state.json', 'spill'].filter(t => source.includes(t))
  assert.deepEqual(reached, [], `the module names ${reached.join(', ')}`)
})

/** The text of `function <name>(` up to its closing brace at the start of a line, or null. */
function functionSource(source, name) {
  const at = source.search(new RegExp(`(?:async )?function ${name}\\(`))
  if (at === -1) return null
  const end = source.indexOf('\n}\n', at)
  return source.slice(at, end === -1 ? source.length : end + 2)
}

test('the wave board is the renderer\'s rows, drawn from the steps and never from a file', () => {
  // draw-the-wave-board-in-the-meter-pane design D6, D7: the board is
  // `lib/draw-plan.mjs`'s, the plan is the relayed summary, and the section
  // that draws it reads nothing from disk.
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.match(
    source,
    /import \{[^}]*\bdrawPlanBoardRows\b[^}]*\} from '\.\.\/lib\/draw-plan\.mjs'/,
    'the module does not take the board from lib/draw-plan.mjs'
  )
  const named = ['plan.json', 'state.json', 'ship/runs'].filter(t => source.includes(t))
  assert.deepEqual(named, [], `the module names ${named.join(', ')}`)
  const section = functionSource(source, 'drawWaves')
  assert.ok(section, 'no drawWaves function draws the wave section')
  assert.ok(section.includes('drawPlanBoardRows('), 'drawWaves does not draw the board')
  assert.ok(!section.includes('$.fs.'), 'the wave section reads a file')
})

test('the refusal pin names a second deny, and one fed by anything but the verdict', () => {
  const ok = `const verdict = decideLaunch(record, now)\n${GUARD_REFUSAL}\n`
  assert.deepEqual(strayRefusals(ok), [])
  assert.deepEqual(strayRefusals(`${ok}  if (x) return { deny: 'no' }\n`), ["line 3: if (x) return { deny: 'no' }"])
  assert.deepEqual(strayRefusals("  if (launch) return { deny: 'Leftover boxes' }\n"), ["line 1: if (launch) return { deny: 'Leftover boxes' }"])
})

/**
 * The tokens that would mean the module priced something itself. The archived
 * reservation (surface-prompt-cache-cost design, Non-Goals) left a dollar figure
 * to a later decision; the meter shows the engine's `cost.usd` and makes none
 * (speak-lane-turn-ends-and-session-cost design D5).
 */
const PRICE_TOKENS = Object.freeze(['MODEL_PRICES', 'perMillionTokens', 'cacheMultipliers'])

test('the hooks module names no price table: the only dollar figure it shows is the engine\'s', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  const present = PRICE_TOKENS.filter(t => source.includes(t))
  assert.deepEqual(present, [], `the hooks module names ${present.join(', ')}: a figure of its own needs its own decision`)
})

test('the hooks module reads the session usage only as the plain call, never with a breakdown', () => {
  // The declaration: the plain call costs nothing; a breakdown counts each
  // category with the token-count API, and the pane is drawn often (design D4).
  const source = readFileSync(moduleEntry(), 'utf8')
  const reads = [...source.matchAll(/\$\.session\.usage\(([^)]*)\)/g)].map(m => m[0])
  assert.ok(source.includes('$.session.usage('), 'the hooks module no longer reads the session usage')
  assert.equal(reads.length, occurrences(source, '$.session.usage(').length, 'a usage read this pin cannot parse')
  assert.deepEqual(
    reads.filter(r => r !== '$.session.usage()'),
    [],
    'a usage read with an argument'
  )
})

/** The source of the hook registered for `event`: from its `on(` to the next `on(`. */
export function hookBody(source, event) {
  const start = source.indexOf(`on('${event}'`)
  if (start === -1) return null
  const end = source.indexOf('on(', start + 3)
  return source.slice(start, end === -1 ? undefined : end)
}

test('the turn-end toast is raised inside a try, so a refused toast is never thrown', () => {
  const body = hookBody(readFileSync(moduleEntry(), 'utf8'), 'turn.complete')
  assert.ok(body, 'the hooks module hooks no turn.complete')
  const toast = body.indexOf('$.ui.toast(')
  assert.ok(toast !== -1, 'the turn.complete hook raises no toast')
  const opened = body.lastIndexOf('try {', toast)
  assert.ok(opened !== -1, 'the turn-end toast is not inside a try')
  assert.ok(body.indexOf('catch', opened) > toast, 'the try before the turn-end toast closes before it')
})

/** The `{ plugin, key }` state references a source spells, as `plugin.key`. */
export function stateKeys(source) {
  return [...new Set([...source.matchAll(/\{\s*plugin:\s*'([^']+)',\s*key:\s*'([^']+)'\s*\}/g)].map(m => `${m[1]}.${m[2]}`))].sort()
}

/** The keys a contract declares in `interface PluginState`, as `plugin.key`. */
export function contractKeys(contract) {
  const body = contract.match(/interface PluginState\s*\{([\s\S]*)\}\s*\}\s*$/)
  if (!body) return []
  const keys = []
  for (const m of body[1].matchAll(/['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*\{([^}]*)\}/g)) {
    for (const k of m[2].matchAll(/['"]?([A-Za-z0-9_]+)['"]?\s*:/g)) keys.push(`${m[1]}.${k[1]}`)
  }
  return [...new Set(keys)].sort()
}

test('the session-state keys the hooks module names are the ones the plugin\'s type contract declares', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(
    manifest[CONTRACT_KEY],
    './types/index.d.ts',
    'the manifest names no type contract: the engine refuses state keys a contract does not declare'
  )
  const contract = readFileSync(join(ROOT, manifest[CONTRACT_KEY]), 'utf8')
  assert.deepEqual(stateKeys(readFileSync(moduleEntry(), 'utf8')), ['interlock.ledger'])
  assert.deepEqual(contractKeys(contract), ['interlock.ledger'], 'types/index.d.ts declares other keys than the module names')
  assert.ok(!/\bimport\b/.test(contract), 'a contract is self-contained: no import')
})

test('the contract reader finds a declared key and misses an undeclared one', () => {
  const contract = "export type R = { n: number }\n\ndeclare module 'claude-code' {\n  interface PluginState {\n    interlock: { ledger: R }\n  }\n}\n"
  assert.deepEqual(contractKeys(contract), ['interlock.ledger'])
  assert.deepEqual(stateKeys("const A = { plugin: 'interlock', key: 'ledger' }\nconst B = { plugin: 'interlock', key: 'extra' }"), [
    'interlock.extra',
    'interlock.ledger'
  ])
})

test('the hooks module hooks exactly the meter\'s events and the launch guard\'s two', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  // A classic event keeps its settings-hook name (`classic.SessionStart`), so
  // the name is read with its capitals, or such a hook would go uncounted.
  const hooked = [...new Set([...source.matchAll(/\bon\(\s*'([A-Za-z.]+)'/g)].map(m => m[1]))]
  assert.deepEqual([...hooked].sort(), [...HOOKED_EVENTS].sort())
})

test('every file the hooks module reaches is inside the plugin and Node-free', () => {
  const { problems } = walkModule(moduleEntry(), ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the walker names a node: import reached through a relative one', () => {
  // The spec's own failure case: a module that imports lib/ship-stage.mjs,
  // which imports node:fs, fails naming both.
  const { problems } = walkModule(join(ROOT, 'lib', 'ship-stage.mjs'), ROOT)
  assert.ok(problems.some(p => p.includes("'node:fs'")), problems.join('\n'))
})

test('the kit\'s prompt fixtures are the payloads captured from the host', async () => {
  const mirror = await import('../fixtures/mod/prompts.mjs')
  const captured = name => {
    const { _provenance, ...payload } = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mod', name), 'utf8'))
    assert.ok(_provenance, `${name} carries no _provenance`)
    return payload
  }
  assert.deepEqual(mirror.COMPOSER, captured('prompt-submit-composer.json'))
  assert.deepEqual(mirror.TASK_NOTIFICATION, captured('prompt-submit-task-notification.json'))
  assert.equal(mirror.COMPOSER.origin.kind, 'composer')
  assert.equal(mirror.TASK_NOTIFICATION.origin.kind, 'task-notification')
})

/** The four settings guards whose denials the module repeats (speak-permission-prompts-and-guard-denials design D6). */
const GUARD_FILES = Object.freeze(['guard-tests.mjs', 'guard-tasks.mjs', 'guard-commit.mjs', 'guard-relaunch.mjs'])

test('the guard names the module reads denials by are exactly the names the four guards print', () => {
  const printed = GUARD_FILES.map(file => {
    const m = readFileSync(join(ROOT, 'hooks', file), 'utf8').match(/^const GUARD = '([^']+)'$/m)
    assert.ok(m, `hooks/${file} declares no \`const GUARD = '…'\``)
    return m[1]
  })
  assert.deepEqual([...GUARD_NAMES].sort(), [...printed].sort(), 'a guard was renamed, added or dropped without lib/meter-refusals.mjs')
})

test('the kit\'s guard-deny fixture is the result captured from the host, and denyText rebuilds its text', async () => {
  const mirror = await import('../fixtures/mod/refusals.mjs')
  const { _provenance, ...captured } = JSON.parse(
    readFileSync(join(ROOT, 'test', 'fixtures', 'mod', 'tool-call-denied-by-guard.json'), 'utf8')
  )
  assert.ok(_provenance, 'tool-call-denied-by-guard.json carries no _provenance')
  assert.deepEqual(mirror.DENIED_BY_GUARD, captured)
  const reason = captured.text.slice(captured.text.indexOf('guard-probe: '))
  assert.equal(mirror.denyText(reason, 'Bash'), captured.text)
  assert.equal(captured.isError, true)
})

// The spec meter (observe-the-spec-run-live design D1, D7, D10). It hooks no
// new event: the engine raised no `skill.prompt` for a plugin skill on Claude
// Code 2.1.291 (probe 1), so the load is read off `prompt.submit`, already
// hooked, and a `tool.call` on `Skill`, a new matcher on a hooked event.

/** The source of the hook whose registration begins `head`: from it to the next hook registered at the same indent. */
function hookAt(source, head) {
  const start = source.indexOf(head)
  if (start === -1) return null
  const end = source.indexOf('\n  on(', start + head.length)
  return source.slice(start, end === -1 ? undefined : end)
}

test('neither the hooks module nor the spec or settle meter\'s rules spell `complete` or read OpenSpec\'s roll-up', () => {
  // Two spellings are not the meter's words and are stripped first: the
  // engine's event name, which the meter must keep hooking, and the wave
  // board's overlay key, the field `lib/draw-plan.mjs` reads for the recorded
  // ids (draw-the-wave-board-in-the-meter-pane design D6).
  const strip = source => source.split('turn.complete').join('').split('completed: run.recorded.ok').join('')
  // The settle meter's rules join the pin (observe-the-settle-run-live design D20, spec
  // requirement 6): its review record is read for counts and never for the roll-up
  // `dimensions.completed`, so the word is spelled nowhere in the pure module.
  for (const file of [moduleEntry(), join(ROOT, 'lib', 'spec-meter.mjs'), join(ROOT, 'lib', 'settle-meter.mjs')]) {
    const left = strip(readFileSync(file, 'utf8'))
    const at = left.search(/complete/i)
    assert.equal(at, -1, `${file} spells ${left.slice(Math.max(0, at - 30), at + 30)}`)
  }
})

test('the module writes its one status line from one composer', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.equal(occurrences(source, '$.ui.status(').length, 1, 'more than one $.ui.status( call: two writers can overwrite each other')
  const composer = functionSource(source, 'setStatus')
  assert.ok(composer && composer.includes('$.ui.status('), 'the one $.ui.status( call is not inside setStatus')
})

test('the spec pane\'s id is spelled in the module as the pure module names it', () => {
  // The validator records a matcher only from a constant the module declares.
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.ok(source.includes(`const SPEC_PANE = '${SPEC_PANE}'`), `hooks/mod.mjs does not declare SPEC_PANE as '${SPEC_PANE}'`)
})

test('the settle pane\'s id is spelled in the module as the pure module names it', async () => {
  // The same constant pin as SPEC_PANE (observe-the-settle-run-live design D13). The pure
  // module is imported inside the test, so a module that does not exist yet fails this pin
  // alone and not every other pin in this file.
  const { SETTLE_PANE } = await import('../../lib/settle-meter.mjs')
  assert.equal(SETTLE_PANE, 'interlock-settle')
  assert.notEqual(SETTLE_PANE, SPEC_PANE, 'two panes share an id')
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.ok(source.includes(`const SETTLE_PANE = '${SETTLE_PANE}'`), `hooks/mod.mjs does not declare SETTLE_PANE as '${SETTLE_PANE}'`)
})

test('the spec skill\'s two observers and the briefing-read observer pass the prompt, the Skill call and the Read call on as they came', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.ok(!source.includes("on('skill.prompt'"), 'the module hooks skill.prompt, which no probed engine raises for a plugin skill')
  for (const head of ["on('prompt.submit'", "on('tool.call', { tool: 'Skill' }", "on('tool.call', { tool: 'Read' }"]) {
    const body = hookAt(source, head)
    assert.ok(body, `the module has no ${head} hook`)
    const built = ['text:', 'next({', 'return {'].filter(t => body.includes(t))
    assert.deepEqual(built, [], `${head} builds ${built.join(', ')} of its own`)
  }
})

test('the kit\'s spec-run fixtures are the payloads captured from the host', async () => {
  const mirror = await import('../fixtures/mod/spec-run.mjs')
  const captured = name => {
    const { _provenance, ...payload } = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mod', name), 'utf8'))
    assert.ok(_provenance, `${name} carries no _provenance`)
    assert.match(_provenance.change, /observe-the-spec-run-live task 1\.1/)
    return payload
  }
  assert.deepEqual(mirror.PROMPT_SPEC, captured('prompt-submit-spec.json'))
  assert.deepEqual(mirror.SKILL_EXPLORE, captured('tool-call-skill-explore.json'))
  assert.deepEqual(mirror.SPAWN_EXPLORE, captured('agent-spawn-explore.json'))
  assert.deepEqual(mirror.BASH_STATUS, captured('tool-call-bash-openspec-status.json'))
  assert.deepEqual(mirror.BASH_LEDGER_BLOCKING, captured('tool-call-bash-ledger-blocking.json'))
  assert.deepEqual(mirror.BASH_GATE_BLOCKED, captured('tool-call-bash-gate-blocked.json'))
  assert.deepEqual(mirror.BASH_VALIDATE_UNRESOLVED, captured('tool-call-bash-validate-unresolved.json'))
  assert.deepEqual(mirror.BASH_LEDGER_TEXT, captured('tool-call-bash-ledger-text.json'))
  assert.equal(mirror.BASH_LEDGER_BLOCKING.isError, true)
  assert.equal(mirror.SPAWN_EXPLORE.input.subagentType, 'Explore')
})

test('the kit\'s settle-run fixtures are the payloads captured from the host', async () => {
  const mirror = await import('../fixtures/mod/settle-run.mjs')
  const dir = join(ROOT, 'test', 'fixtures', 'mod')
  const covered = new Set()
  const captured = name => {
    covered.add(name)
    const { _provenance, ...payload } = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    assert.ok(_provenance, `${name} carries no _provenance`)
    assert.match(_provenance.change, /observe-the-settle-run-live task 1\.1/, name)
    assert.ok(_provenance.capturedWith && _provenance.date, `${name} names neither what captured it nor when`)
    return payload
  }
  assert.deepEqual(mirror.SPAWN_ROUTED, captured('agent-spawn-routed.json'))
  assert.deepEqual(mirror.STEP_AGENT_TOOL, captured('turn-step-agent-tool.json'))
  assert.deepEqual(mirror.COMPLETE_AGENT_TOOL, captured('turn-complete-agent-tool.json'))
  assert.deepEqual(mirror.BASH_SETTLE_REVIEW, captured('tool-call-bash-settle-review.json'))
  assert.deepEqual(mirror.BASH_SETTLE_BRIEF, captured('tool-call-bash-settle-brief.json'))
  assert.deepEqual(mirror.BASH_SETTLE_FIXER_RESULT, captured('tool-call-bash-settle-fixer-result.json'))
  assert.deepEqual(mirror.BASH_SETTLE_STOP, captured('tool-call-bash-settle-stop.json'))
  assert.deepEqual(mirror.BASH_SETTLE_MERGE_CONFIDENCE, captured('tool-call-bash-settle-merge-confidence.json'))
  assert.deepEqual(mirror.BASH_SETTLE_PIPELINE, captured('tool-call-bash-settle-pipeline.json'))

  // A capture added beside these without a mirror fails here instead of going unreplayed.
  const settleCaptures = readdirSync(dir).filter(f => /^tool-call-bash-settle-.*\.json$/.test(f))
  for (const f of settleCaptures) assert.ok(covered.has(f), `${f} has no export in test/fixtures/mod/settle-run.mjs`)

  // What the probe showed, which the kit's tests rely on.
  assert.equal(mirror.SPAWN_ROUTED.input.subagentType, 'general-purpose')
  assert.equal(mirror.SPAWN_ROUTED.input.model, 'sonnet', 'the spawn carries the alias the call named')
  assert.match(mirror.SPAWN_ROUTED.resolved.model, /^claude-sonnet-/, 'the result carries the resolved id')
  assert.ok(!('effort' in mirror.SPAWN_ROUTED.input), 'the spawn event has no effort field')
  assert.ok('effort' in mirror.STEP_AGENT_TOOL.input, 'the step carries the effort')
  assert.equal(mirror.BASH_SETTLE_STOP.isError, true)
  assert.match(mirror.BASH_SETTLE_STOP.result, /^Error: Exit code 1\n/)
  assert.equal(mirror.CHANGE, 'route-prose-spawns-by-role')
  assert.equal(mirror.PR, 25)
})

test('neither the hooks module nor the spec or settle meter spells interlock:advisor', () => {
  // The checkpoint advisor agent is gone (replace-subagent-advisors-with-advisor-tool
  // D1, D7): nothing in the meter may key on its spawn again.
  for (const rel of [['hooks', 'mod.mjs'], ['lib', 'spec-meter.mjs'], ['lib', 'settle-meter.mjs']]) {
    const text = readFileSync(join(ROOT, ...rel), 'utf8')
    assert.ok(!text.includes('interlock:advisor'), `${rel.join('/')} spells interlock:advisor`)
  }
})

test('npm test collects *.test.mjs only, so the mod\'s .test.ts never reaches Node', () => {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const patterns = [...scripts.test.matchAll(/-name\s+'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(patterns, ['*.test.mjs'], `npm test collects: ${patterns.join(', ') || scripts.test}`)
})
