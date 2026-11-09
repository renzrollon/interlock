// The hooks module's reach, pinned statically (design D8, D13).
//
// The module runs inside the engine, with no Node and `$` as its only way out,
// and it is written to observe: no substitute result, no catch handler, no
// model, prompt submission, command run, tool call, message, process, network,
// file write or permission check. It may read the prompt box, fill an empty
// one, copy a line and ask for a notification, each from one call site
// (make-the-run-surfaces-interactive design D4, D17). Nothing at run time would
// notice a hook that started deciding, so the guarantee is read off the source
// here, before any session loads it.
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
import { fileURLToPath, pathToFileURL } from 'node:url'

import { specifiers, walkModule } from '../helpers/module-walk.mjs'
import { GUARD_NAMES } from '../../lib/meter-refusals.mjs'
import { SPEC_PANE } from '../../lib/spec-meter.mjs'
import * as ClaudeEnv from '../../lib/host/claude-env.mjs'

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
  '$.fs.read',
  // The interactive surfaces (make-the-run-surfaces-interactive design D4, D17):
  // a notification of a change of state, and the drafting helper's read of the
  // prompt box, its fill of an empty one and its copy. Each has one call site,
  // pinned below; none of them submits anything.
  '$.ui.notify',
  '$.ui.copy',
  '$.prompt.read',
  '$.prompt.fill'
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
 * `prompt.submit` and a `tool.call` matcher. The prompt's suggestions
 * (make-the-run-surfaces-interactive design D18) add `prompt.autocomplete`.
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
  'classic.SessionStart',
  'prompt.autocomplete'
])

/** Tokens whose presence anywhere in the module means it stopped only observing (design D8). */
export const FORBIDDEN_TOKENS = Object.freeze([
  '.catch(',
  'tool.check',
  '$.model',
  // The prompt box may be read and filled by the drafting helper, never
  // submitted (make-the-run-surfaces-interactive design D4): the blanket
  // `$.prompt` entry narrowed to its submission. Every other `$.prompt.`
  // spelling but the read and the fill is refused by `promptReachProblems`
  // below. A command run and a tool call would act for the person, so neither
  // may be spelled either.
  '$.prompt.submit',
  '$.command.run',
  '$.tool.call',
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

// ---------------------------------------------------------------------------
// The capability object's shapes, and the events the module hooks, pinned for
// the plugin directory's validation (clear-the-directory-validation-findings
// design D3, D4, D5, D17).
//
// This pins a SPELLING rule, not the directory's reader: that reader is not
// inspectable, and the finding's own text (`MOD_CAPABILITY_USE_NOT_PLAIN`) is
// the only rule we have. `$` as `$.noun.method(…)` with nothing around its
// parts, or passed whole to a function declared at the top of the file, each
// `on("event", hook)` on its own line. The portal's Validate stays the verdict.
// ---------------------------------------------------------------------------

/**
 * Named closures that read `$` and that the directory has accepted in every
 * scanned version since the one that introduced them (design D4). Frozen: an
 * entry is stale, and fails, when no binding of that name exists or its body
 * holds no `$`. The fallback if the portal flags one is to delete the entry and
 * rewrite the closure, `flush` needing a state object for its five locals.
 */
export const ALLOWED_CLOSURES = Object.freeze([
  Object.freeze({ name: 'hide', since: 'v1.3.0' }),
  Object.freeze({ name: 'flush', since: 'v1.3.1' }),
  Object.freeze({ name: 'guardLine', since: 'v1.4.0' })
])

/** The previous significant token after which a `/` opens a regex literal (design "Scanner shape"). */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', 'return'])

/**
 * `source` with strings, template text, regex literals and comments blanked to
 * spaces, offsets and newlines kept; the code inside `${…}` stays readable.
 */
export function maskSource(source) {
  const n = source.length
  const out = source.split('')
  const blank = (from, to) => {
    for (let i = from; i < Math.min(to, n); i++) if (out[i] !== '\n') out[i] = ' '
  }
  const startsLine = at => /^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', at - 1) + 1, at))
  const stack = []
  let mode = 'code'
  let last = ''
  let i = 0
  while (i < n) {
    const c = source[i]
    if (mode === 'tpl') {
      if (c === '\\') {
        blank(i, i + 2)
        i += 2
      } else if (c === '`') {
        blank(i, i + 1)
        i++
        mode = 'code'
        last = '"'
      } else if (c === '$' && source[i + 1] === '{') {
        blank(i, i + 2)
        i += 2
        stack.push('tpl')
        mode = 'code'
        last = '{'
      } else {
        blank(i, i + 1)
        i++
      }
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      blank(i, end === -1 ? n : end)
      i = end === -1 ? n : end
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      blank(i, end === -1 ? n : end + 2)
      i = end === -1 ? n : end + 2
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1
      blank(i, j + 1)
      i = j + 1
      last = '"'
    } else if (c === '`') {
      blank(i, i + 1)
      i++
      mode = 'tpl'
    } else if (c === '/') {
      let end = -1
      if (REGEX_PRECEDERS.has(last) || last === '' || startsLine(i)) {
        let j = i + 1
        let inClass = false
        while (j < n && source[j] !== '\n') {
          if (source[j] === '\\') j += 2
          else if (source[j] === '[') (inClass = true), j++
          else if (source[j] === ']') (inClass = false), j++
          else if (source[j] === '/' && !inClass) break
          else j++
        }
        if (source[j] === '/') {
          end = j + 1
          while (end < n && /[a-z]/.test(source[end])) end++
        }
      }
      if (end === -1) {
        last = '/'
        i++
      } else {
        blank(i, end)
        i = end
        last = '"'
      }
    } else if (c === '{') {
      stack.push('brace')
      last = '{'
      i++
    } else if (c === '}') {
      if (stack.pop() === 'tpl') {
        blank(i, i + 1)
        mode = 'tpl'
      } else {
        last = '}'
      }
      i++
    } else if (/\s/.test(c)) {
      i++
    } else if (/[\w$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(source[j])) j++
      last = source.slice(i, j)
      i = j
    } else {
      last = c
      i++
    }
  }
  return out.join('')
}

const IDENT = String.raw`[A-Za-z_$][\w$]*`

/** The index of the bracket closing the one at `open`, or -1. */
function closeOf(masked, open) {
  let depth = 0
  for (let k = open; k < masked.length; k++) {
    if ('([{'.includes(masked[k])) depth++
    else if (')]}'.includes(masked[k]) && --depth === 0) return k
  }
  return -1
}

/** The index of the unmatched opening bracket before `at`, or -1. */
function openBefore(masked, at) {
  let depth = 0
  for (let k = at - 1; k >= 0; k--) {
    if (')]}'.includes(masked[k])) depth++
    else if ('([{'.includes(masked[k])) {
      if (depth === 0) return k
      depth--
    }
  }
  return -1
}

/** The span of the body of a `function` or arrow that starts at `from` (just after `=`), or null. */
function closureSpan(masked, from) {
  const skip = k => {
    while (k < masked.length && /\s/.test(masked[k])) k++
    return k
  }
  let k = skip(from)
  const async_ = new RegExp(String.raw`^async\s+(?=function\b|\(|${IDENT}\s*=>)`).exec(masked.slice(k))
  if (async_) k = skip(k + async_[0].length)
  if (/^function\b/.test(masked.slice(k))) {
    k = skip(k + 8)
    if (masked[k] === '*') k = skip(k + 1)
    const name = new RegExp(`^${IDENT}`).exec(masked.slice(k))
    if (name) k = skip(k + name[0].length)
    if (masked[k] !== '(') return null
    k = skip(closeOf(masked, k) + 1)
    return masked[k] === '{' ? { start: k, end: closeOf(masked, k) } : null
  }
  if (masked[k] === '(') {
    k = skip(closeOf(masked, k) + 1)
  } else {
    const name = new RegExp(`^${IDENT}`).exec(masked.slice(k))
    if (!name) return null
    k = skip(k + name[0].length)
  }
  if (masked.slice(k, k + 2) !== '=>') return null
  k = skip(k + 2)
  if (masked[k] === '{') return { start: k, end: closeOf(masked, k) }
  let depth = 0
  let end = k
  for (; end < masked.length; end++) {
    const ch = masked[end]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && (ch === ';' || ch === '\n')) break
  }
  return { start: k, end }
}

/**
 * Every use of `$` in a hooks module that is not one of the plain shapes, and
 * every spelling the directory's reader is said to refuse (design D4, D17; spec
 * hooks/ship-meter "The hooks module SHALL use the capability object only in
 * plain shapes…"). Allowed: a plain call `$.noun.method(` with nothing between
 * its parts (parentheses around a WHOLE call, as in
 * `(await $.session.version()).version`, wrap no part); `$` handed whole to a
 * function declared at column zero; `$` declared as a parameter of such a
 * function, or as the first parameter of the hook in an `on(` registration.
 * Refused: every other `$`, any named closure binding that reads `$` and is not
 * in `allowed`, a stale `allowed` entry, and an `on(` that is not the first code
 * on its line. Each problem is one line naming the shape.
 *
 * @param {string} source
 * @param {ReadonlyArray<{name: string, since: string}>} [allowed]
 */
export function plainCapabilityUse(source, allowed = ALLOWED_CLOSURES) {
  const masked = maskSource(source)
  const lineOf = at => masked.slice(0, at).split('\n').length
  const textOf = at => source.split('\n')[lineOf(at) - 1].trim().slice(0, 100)
  const problems = []

  const decls = [...masked.matchAll(new RegExp(String.raw`^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(${IDENT})\s*\(`, 'gm'))].map(m => ({
    name: m[1],
    at: m.index,
    open: m.index + m[0].length - 1
  }))
  const topLevel = new Set(decls.map(d => d.name))
  const declaredOpens = new Set(decls.map(d => d.open))
  const within = at => decls.filter(d => d.at < at).at(-1)?.name || '(top level)'

  for (const m of masked.matchAll(/(?<![\w$.])on\(/g)) {
    if (masked.slice(masked.lastIndexOf('\n', m.index - 1) + 1, m.index).trim() !== '') {
      problems.push(`line ${lineOf(m.index)}: on( is not the first code on its line (${textOf(m.index)})`)
    }
    let depth = 0
    for (let k = m.index + 3; k < masked.length; k++) {
      const ch = masked[k]
      if (ch === '(' && depth === 0) {
        declaredOpens.add(k)
        break
      }
      if ('([{'.includes(ch)) depth++
      else if (')]}'.includes(ch)) {
        if (depth === 0) break
        depth--
      }
    }
  }

  for (const m of masked.matchAll(/(?<![\w$])\$(?![\w$])/g)) {
    const at = m.index
    if (new RegExp(String.raw`^\.${IDENT}\.${IDENT}\(`).test(masked.slice(at + 1))) continue
    const before = masked.slice(0, at).trimEnd().slice(-1)
    const after = masked.slice(at + 1).trimStart()[0]
    if ((before === '(' || before === ',') && (after === ',' || after === ')')) {
      const open = openBefore(masked, at)
      if (open !== -1 && declaredOpens.has(open) && masked[open] === '(') continue
      const callee = new RegExp(String.raw`(?<![\w$])(${IDENT})\s*$`).exec(masked.slice(0, open))
      // `x.draw($)` is a member call; `...draw($)` is a spread of a call and is not.
      const member = /[\w$)\]]\s*\.\s*[\w$]+\s*$/.test(masked.slice(0, open))
      if (open !== -1 && masked[open] === '(' && callee && !member && topLevel.has(callee[1])) continue
    }
    problems.push(`line ${lineOf(at)}: ${within(at)}: $ is neither a plain call, a whole argument to a top-level function nor a declared parameter (${textOf(at)})`)
  }

  const bound = []
  for (const m of masked.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+(${IDENT})\s*=\s*`, 'g'))) {
    const span = closureSpan(masked, m.index + m[0].length)
    if (!span) continue
    const reads = /(?<![\w$])\$(?![\w$])/.test(masked.slice(span.start, span.end + 1))
    bound.push({ name: m[1], at: m.index, reads })
  }
  const allowedNames = new Set(allowed.map(a => a.name))
  for (const b of bound.filter(x => x.reads && !allowedNames.has(x.name))) {
    problems.push(`line ${lineOf(b.at)}: ${within(b.at)}: ${b.name} is a stored closure that reads $`)
  }
  for (const a of allowed) {
    if (!bound.some(b => b.name === a.name && b.reads)) {
      problems.push(`allow-listed closure ${a.name} (since ${a.since}) is stale: no binding of that name reads $`)
    }
  }
  return problems
}

const noAllowList = source => plainCapabilityUse(source, [])

test('the hooks module uses $ only in plain shapes, and its allow-listed closures still read it', () => {
  const problems = plainCapabilityUse(readFileSync(moduleEntry(), 'utf8'))
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the $-shape scanner names a stored closure that reads $, and the function that holds it', () => {
  const stored = [
    'function tell($, fields) {',
    '  const send = async () => {',
    '    await $.ui.notify(text)',
    '  }',
    '  void send()',
    '}',
    ''
  ].join('\n')
  const problems = noAllowList(stored)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /tell: send is a stored closure that reads \$/)
  // The same closure as a function expression, and with an expression body.
  assert.equal(noAllowList('function a($) {\n  const f = function () { return $.ui.log(1) }\n}\n').length, 1)
  assert.equal(noAllowList('function a($) {\n  let g = async x => $.ui.log(x)\n}\n').length, 1)
})

test('the $-shape scanner passes callbacks handed straight to a capability call', () => {
  const source = [
    'function tell($, fields) {}',
    'function draftLine($, press) {}',
    'function arm($, ms) {',
    '  $.clock.every(ms, async () => {',
    '    tell($, fields)',
    '  })',
    '  return { onPress: press => draftLine($, press) }',
    '}',
    ''
  ].join('\n')
  assert.deepEqual(noAllowList(source), [])
})

test('the $-shape scanner passes $ handed whole across several lines to a top-level function', () => {
  const source = [
    'function drawAll($, a, b) {}',
    'function go($) {',
    '  return drawAll(',
    '    $,',
    '    first,',
    '    second',
    '  )',
    '}',
    ''
  ].join('\n')
  assert.deepEqual(noAllowList(source), [])
})

test('the $-shape scanner passes a whole call in parentheses and every declared parameter', () => {
  const source = [
    'async function drawBand($, e, next) {',
    '  return (await $.session.version()).version',
    '}',
    'export function register(on) {',
    "  on('a', async ($, e, next) => next(e))",
    "  on('b', ($, e, next) => next(e))",
    "  on('c', async ($, e) => drawBand($, e))",
    "  on('d', { tool: 'Bash' }, async function* ($, e, next) {",
    '    yield* next(e)',
    '  })',
    "  on('e', { origin: { kind: 'x' } }, hostOnly => {})",
    '}',
    ''
  ].join('\n')
  assert.deepEqual(noAllowList(source), [])
})

test('the $-shape scanner reads code only: a template, a regex literal and a comment hold no use', () => {
  const source = [
    'function note($, parts, n) {',
    '  const ids = `[${parts.ids}] costs $5 and $.fs.read`',
    '  const nested = `a ${$.ui.log(`b ${n}`)} c`',
    '  const ok = /^b\\d+$/.test(parts.name)',
    "  const text = '$ and $.fs.read'",
    '  // $.fs.read is only a comment',
    '  /* and so is $?.ui.log(x) */',
    '  return ids + nested + ok + text',
    '}',
    ''
  ].join('\n')
  assert.deepEqual(noAllowList(source), [])
  // The code inside ${…} is code: a wrapped use there is named.
  assert.equal(noAllowList('function a($) {\n  return `x ${$?.ui.log(1)} y`\n}\n').length, 1)
})

test('the $-shape scanner tells a division from a regex literal, with a $ use beside each', () => {
  const source = [
    'async function half($, total) {',
    '  const half = total / 2',
    '  const third = (await $.session.version()).n / 3 / 1',
    '  const hit = /^b\\d+$/.test(total)',
    '  const quoted = total.replace(/[/$]/g, "")',
    '  return half / third + hit',
    '}',
    ''
  ].join('\n')
  assert.deepEqual(noAllowList(source), [])
  // A division that is read as a regex would swallow the use after it: this one must not.
  assert.equal(noAllowList('function a($, n) {\n  const x = n / 2 + (n / 4) + $?.ui.log(1)\n}\n').length, 1)
})

test('the $-shape scanner names every wrapped part and every foreign callee', () => {
  const wrap = body => noAllowList(`function pass2($) {}\nfunction fn($) {}\nfunction run($, x) {\n  const local = n => n\n  ${body}\n}\n`)
  for (const bad of [
    '$?.ui.log(x)',
    "$.ui['log'](x)",
    '($.ui).log(x)',
    '($).ui.log(x)',
    '$.ui.log!(x)',
    '$.ui.log (x)',
    'local($)',
    'fn(...$)',
    'const api = $',
    'pass2.go($)',
    'const { ui } = $',
    'void [$]',
    'fn(1, ($))'
  ]) {
    assert.ok(wrap(bad).length >= 1, `the scanner let through: ${bad}`)
  }
  assert.deepEqual(wrap('$.ui.log(x)'), [])
  assert.deepEqual(wrap('fn($)'), [])
})

test('the $-shape scanner requires each on( to be the first code on its line', () => {
  const problems = noAllowList("export function register(on) {\n  let a = 1; on('x', async ($, e, next) => next(e))\n}\n")
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /on\( is not the first code on its line/)
  assert.deepEqual(noAllowList("export function register(on) {\n  on('x', async ($, e, next) => next(e))\n}\n"), [])
  // An on( in a comment or a string is not a registration.
  assert.deepEqual(noAllowList("export function register(on) {\n  // x; on('y')\n  const s = \"a; on('z')\"\n}\n"), [])
})

test('the $-shape allow-list passes a closure while it reads $ and fails once an entry is stale', () => {
  const allowed = [{ name: 'hide', since: 'v1.3.0' }]
  const reads = 'function band($) {\n  const hide = () => $.ui.invalidate()\n  hide()\n}\n'
  assert.deepEqual(plainCapabilityUse(reads, allowed), [])
  assert.equal(plainCapabilityUse(reads, []).length, 1, 'with the entry removed the closure is named')
  const quiet = 'function band($) {\n  const hide = () => 1\n}\n'
  assert.deepEqual(plainCapabilityUse(quiet, allowed), ['allow-listed closure hide (since v1.3.0) is stale: no binding of that name reads $'])
  const gone = 'function band($) {\n  hide()\n}\n'
  assert.deepEqual(plainCapabilityUse(gone, allowed), ['allow-listed closure hide (since v1.3.0) is stale: no binding of that name reads $'])
  assert.deepEqual(
    ALLOWED_CLOSURES.map(a => `${a.name} ${a.since}`),
    ['hide v1.3.0', 'flush v1.3.1', 'guardLine v1.4.0']
  )
})

test('the $-shape scanner, with the allow-list emptied, names the three older closures on the shipped module', () => {
  // `send` (inside `tell`, until task 2.1 inlines it) is the main pin's to name; here it is set aside so the
  // probe holds before and after that fix.
  const problems = plainCapabilityUse(readFileSync(moduleEntry(), 'utf8'), [])
  const named = problems.map(p => /: (\w+) is a stored closure that reads \$/.exec(p)?.[1]).filter(name => name !== 'send')
  assert.deepEqual(named.sort(), ['flush', 'guardLine', 'hide'], problems.join('\n'))
  assert.equal(problems.length, named.length + problems.filter(p => /: send is a stored closure/.test(p)).length, 'a problem other than a stored closure')
})

// ---------------------------------------------------------------------------
// The events the module hooks (design D5): documented by the mods reference,
// and, when the plugin directory has not accepted one, floored.
// ---------------------------------------------------------------------------

const EVENTS_FIXTURE = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'mod-events.json'), 'utf8'))
const DOCS_GUARDS = join(ROOT, 'docs', '13-the-guards.md')

/** Whether `list` holds `event`, `classic.<Event>` standing for every settings-hook event. */
const listsEvent = (list, event) => list.includes(event) || (event.startsWith('classic.') && list.includes('classic.<Event>'))

/**
 * Every disagreement between the events a module hooks, the reference's list,
 * the events the directory's last scan accepted, the engine floors and the
 * docs. Each problem names the event.
 */
export function eventProblems({ hooked, reference, accepted, floors, loadMin, docs }) {
  const problems = []
  for (const event of hooked) {
    if (!listsEvent(reference, event)) problems.push(`${event}: the mods reference does not document this event`)
    if (!listsEvent(accepted, event) && !(event in floors)) {
      problems.push(`${event}: the plugin directory has not accepted this event and MOD_EVENT_FLOORS records no floor for it`)
    }
  }
  for (const [event, version] of Object.entries(floors)) {
    if (!hooked.includes(event)) problems.push(`${event}: MOD_EVENT_FLOORS names an event the module does not hook (a stale entry)`)
    const order = ClaudeEnv.compareVersions(version, loadMin)
    if (order === null || order > 0) {
      problems.push(`${event}: its floor ${version} is above the module load floor ${loadMin}, so the module would load where the hook is refused`)
    }
    if (!docs.split('\n').some(line => line.includes(event) && line.includes(version) && line.includes('plugin directory'))) {
      problems.push(`${event}: no line of docs/13-the-guards.md names ${event}, ${version} and the plugin directory`)
    }
  }
  return problems
}

/** The events a source registers with `on('…'`, as the hooked-events pin reads them. */
const hookedEvents = source => [...new Set([...source.matchAll(/\bon\(\s*'([A-Za-z.]+)'/g)].map(m => m[1]))]

test('every event the hooks module registers is documented, and one the directory has not accepted has a floor', () => {
  const problems = eventProblems({
    hooked: hookedEvents(readFileSync(moduleEntry(), 'utf8')),
    reference: EVENTS_FIXTURE.reference.events,
    accepted: EVENTS_FIXTURE.directoryAccepted.events,
    floors: ClaudeEnv.MOD_EVENT_FLOORS ?? {},
    loadMin: ClaudeEnv.MODS_LOAD_MIN_VERSION,
    docs: readFileSync(DOCS_GUARDS, 'utf8')
  })
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the events fixture is dated, names its sources, and its accepted list is the reference minus what the scan refused', () => {
  const { reference, directoryAccepted } = EVENTS_FIXTURE
  assert.equal(reference.url, 'https://code.claude.com/docs/en/plugins/mods/reference')
  assert.equal(reference.asOf, 'v2.1.290')
  assert.equal(reference.read, '2026-11-09')
  assert.equal(directoryAccepted.release, 'd63cef6')
  assert.match(directoryAccepted.scan, /line 3065/)
  assert.ok(reference.events.includes('classic.<Event>'), 'the reference lists the settings-hook family')
  assert.equal(directoryAccepted.events.length, 10, 'the 1.15.1 scan accepted ten of the module\'s eleven hooked events')
  assert.ok(!directoryAccepted.events.includes('prompt.autocomplete'), 'the directory has not accepted prompt.autocomplete')
  assert.deepEqual(
    directoryAccepted.events.filter(e => !reference.events.includes(e)),
    [],
    'an accepted event the reference does not document'
  )
})

test('the events pin passes a documented, accepted event and a settings-hook event in the classic family', () => {
  const base = {
    reference: EVENTS_FIXTURE.reference.events,
    accepted: EVENTS_FIXTURE.directoryAccepted.events,
    floors: {},
    loadMin: '2.1.292',
    docs: ''
  }
  assert.deepEqual(eventProblems({ ...base, hooked: ['turn.complete'] }), [])
  assert.deepEqual(eventProblems({ ...base, hooked: ['classic.SessionStart'] }), [])
})

test('the events pin passes prompt.autocomplete with its floor and its docs line, and names each gap', () => {
  const base = {
    hooked: ['prompt.autocomplete'],
    reference: EVENTS_FIXTURE.reference.events,
    accepted: EVENTS_FIXTURE.directoryAccepted.events,
    floors: { 'prompt.autocomplete': '2.1.292' },
    loadMin: '2.1.292',
    docs: 'loads from Claude Code 2.1.292: prompt.autocomplete, the version to give the plugin directory'
  }
  assert.deepEqual(eventProblems(base), [])
  // A documented event the directory has not accepted, with no floor.
  const unfloored = eventProblems({ ...base, floors: {} })
  assert.equal(unfloored.length, 1)
  assert.match(unfloored[0], /^prompt\.autocomplete: .*no floor/)
  // An event the reference does not document, even with a floor.
  const sparkle = eventProblems({ ...base, hooked: ['prompt.sparkle'], floors: { 'prompt.sparkle': '2.1.292' }, docs: 'prompt.sparkle 2.1.292 plugin directory' })
  assert.deepEqual(sparkle, ['prompt.sparkle: the mods reference does not document this event'])
  // A floor for an event the module no longer hooks.
  const stale = eventProblems({ ...base, hooked: [] })
  assert.equal(stale.length, 1)
  assert.match(stale[0], /^prompt\.autocomplete: .*stale entry/)
  // A floor above the module load floor.
  const high = eventProblems({ ...base, floors: { 'prompt.autocomplete': '2.1.300' }, docs: 'prompt.autocomplete 2.1.300 plugin directory' })
  assert.equal(high.length, 1)
  assert.match(high[0], /^prompt\.autocomplete: .*2\.1\.300 is above the module load floor 2\.1\.292/)
  // A floored event the docs do not name, with its version, beside the plugin directory.
  for (const docs of ['', 'prompt.autocomplete 2.1.292', 'prompt.autocomplete plugin directory', '2.1.292 plugin directory']) {
    const unwritten = eventProblems({ ...base, docs })
    assert.equal(unwritten.length, 1, docs)
    assert.match(unwritten[0], /^prompt\.autocomplete: no line of docs\/13-the-guards\.md names/)
  }
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

/**
 * The interactive surfaces' four calls, each with its one call site and the
 * helper that holds it (make-the-run-surfaces-interactive design D4, D17; spec
 * hooks/ship-meter "The hooks module SHALL observe only…" and hooks/spec-meter
 * "The spec meter SHALL observe only…"): the drafting helper reads, fills and
 * copies, the telling helper notifies, and no control reaches the prompt box
 * any other way.
 */
export const ONE_CALL_SITES = Object.freeze([
  ['$.prompt.read(', 'draftLine'],
  ['$.prompt.fill(', 'draftLine'],
  ['$.ui.copy(', 'draftLine'],
  ['$.ui.notify(', 'tell']
])

test('the prompt read, the fill, the copy and the notification are each spelled once, inside their one helper', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  for (const [call, helper] of ONE_CALL_SITES) {
    assert.equal(occurrences(source, call).length, 1, `the module spells ${call} ${occurrences(source, call).length} times, not once`)
    const body = functionSource(source, helper)
    assert.ok(body, `the module has no ${helper} function`)
    assert.ok(body.includes(call), `${call} is not inside ${helper}`)
  }
  // The drafting helper fills only after reading, and copies when it did not fill.
  const draft = functionSource(source, 'draftLine')
  assert.ok(draft.indexOf('$.prompt.read(') < draft.indexOf('$.prompt.fill('), 'the drafting helper fills before it reads the box')
  assert.ok(draft.indexOf('$.prompt.fill(') < draft.indexOf('$.ui.copy('), 'the drafting helper copies before it tries the fill')
})

/** The two prompt-box methods the drafting helper may spell; any other is refused. */
export const PROMPT_METHODS = Object.freeze(['read', 'fill'])

/**
 * Every reach for the engine's prompt surface in `source` that is not
 * `$.prompt.read` or `$.prompt.fill`: a method outside `PROMPT_METHODS`
 * (`$.prompt.submit`, `$.prompt.clear`, ...), the bare object (`$.prompt`,
 * `$?.prompt`, a computed `$['prompt']`), or `prompt` destructured off `$`.
 * The narrowed forbidden token names one spelling; this names them all
 * (make-the-run-surfaces-interactive design D4, blast radius B7).
 */
export function promptReachProblems(source) {
  const problems = []
  for (const m of source.matchAll(/\$\s*(?:\?\.|\.)\s*prompt\b(\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*))?/g)) {
    if (!m[2] || !PROMPT_METHODS.includes(m[2]) || m[0] !== `$.prompt.${m[2]}`) problems.push(m[0])
  }
  for (const m of source.matchAll(/\$\s*(?:\?\.)?\s*\[\s*['"`]prompt['"`]\s*\]/g)) problems.push(m[0])
  for (const m of source.matchAll(/\{[^{}]*\bprompt\b[^{}]*\}\s*=\s*\$(?![\w$])/g)) problems.push(m[0].replace(/\s+/g, ' '))
  return problems
}

test('the prompt surface is spelled only as its read and its fill, each once, inside the drafting helper', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.deepEqual(promptReachProblems(source), [], 'a prompt-surface spelling other than $.prompt.read and $.prompt.fill')
  const draft = functionSource(source, 'draftLine')
  assert.ok(draft, 'the module has no draftLine function')
  for (const method of PROMPT_METHODS) {
    const spelling = `$.prompt.${method}`
    assert.equal(occurrences(source, spelling).length, 1, `the module spells ${spelling} ${occurrences(source, spelling).length} times, not once`)
    assert.equal(occurrences(draft, spelling).length, 1, `${spelling} is not inside draftLine`)
  }
})

test('the prompt-surface pin names every other spelling and passes the read and the fill', () => {
  assert.deepEqual(promptReachProblems('await $.prompt.read()\nawait $.prompt.fill({ text })\n'), [])
  for (const bad of [
    '$.prompt.submit({ text })',
    '$.prompt.clear()',
    '$.prompt.append({ text })',
    '$.prompt .read()',
    '$?.prompt.read()',
    '$.prompt?.fill()',
    'const box = $.prompt',
    "$['prompt'].submit()",
    '$?.["prompt"]',
    'const { prompt } = $',
    'const { ui, prompt: p } = $'
  ]) {
    assert.notDeepEqual(promptReachProblems(bad), [], `the pin let through: ${bad}`)
  }
})

// A surface whose element table holds no Button (blast radius B9). Every kit
// surface (terminal, desktop, vscode, mobile) resolves one, so the module is
// loaded here under a stand-in engine instead: it imports nothing that reaches
// Node, and `h` is the engine's global.
test('a surface with no Button draws the handoff cards with no control, and says so once on the debug log', async () => {
  const P = await import('../fixtures/mod/preflight.mjs')
  const { MODS_MIN_HOST_VERSION } = await import('../../lib/host/claude-env.mjs')
  const hooks = []
  const { register } = await import(pathToFileURL(moduleEntry()).href)
  register((event, ...rest) => hooks.push({ event, filter: rest.length > 1 ? rest[0] : null, fn: rest.at(-1) }))
  const hook = (event, match) =>
    hooks.find(x => x.event === event && Object.entries(match || {}).every(([k, v]) => x.filter && x.filter[k] === v)).fn
  const files = new Map([
    [P.PREFLIGHT_PATH, P.stdout(P.REPORT_WITH_CARD)],
    [P.CARD_PATH, P.ACTIONS_CARD_TEXT],
    [P.SECOND_CARD_PATH, P.PLACEHOLDER_CARD_TEXT]
  ])
  const logs = []
  const $ = {
    ui: {
      log: (text, o) => logs.push({ text, to: o && o.to }),
      invalidate() {},
      toast() {},
      status() {},
      open: async () => ({ isPlaced: true }),
      resolve: () => ({ Box: 'Box', Text: 'Text', Markdown: 'Markdown' })
    },
    command: { register: async () => ({}) },
    session: { version: async () => ({ version: MODS_MIN_HOST_VERSION }) },
    fs: {
      read: async path => {
        if (files.has(path)) return files.get(path)
        throw new Error(`ENOENT: ${path}`)
      }
    },
    clock: { now: async () => 0 }
  }
  const nodes = el => (el && typeof el === 'object' ? [el, ...(el.children || []).flatMap(nodes)] : [])
  const hadH = 'h' in globalThis
  const previous = globalThis.h
  globalThis.h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  try {
    await hook('session.start')($, { cwd: '/repo', surface: 'terminal', isInteractive: true }, async e => e)
    await hook('command.run', { command: 'interlock-handoff' })($, { command: 'interlock-handoff', args: '' })
    const render = hook('ui.render', { component: 'Pane', requestId: 'interlock-handoff' })
    for (let n = 0; n < 2; n++) {
      const drawn = nodes(await render($, { surface: 'terminal', component: 'Pane', requestId: 'interlock-handoff', props: {} }))
      assert.deepEqual(drawn.filter(el => el.type === undefined || el.type === 'Button'), [], 'a control, or an element with no type, was drawn')
      const keys = drawn.map(el => el.props.key).filter(Boolean)
      assert.ok(keys.includes('card-0-body') && keys.includes('card-1-body'), `the cards were not drawn: ${keys.join(', ')}`)
      assert.ok(!keys.some(k => k.endsWith('-actions')), 'an empty controls box was drawn')
    }
    const said = logs.filter(l => l.to === 'debug' && /draws no Button/.test(l.text))
    assert.equal(said.length, 1, 'the missing Button was not said exactly once')
  } finally {
    if (hadH) globalThis.h = previous
    else delete globalThis.h
  }
})

/** Every non-comment line of `source` that spells a version number, as `line <n>: <text>`. */
export function versionLines(source) {
  const found = []
  source.split('\n').forEach((line, i) => {
    const text = line.trim()
    if (text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) return
    if (/\b\d+\.\d+\.\d+\b/.test(text)) found.push(`line ${i + 1}: ${text}`)
  })
  return found
}

test('the hooks module spells no version number in its code: the floor is read from lib/host/claude-env.mjs', () => {
  // make-the-run-surfaces-interactive design D20, D27 (spec hooks/ship-meter
  // "Below the mods floor a loaded module SHALL draw, tell and suggest
  // nothing…"): the probe notes in its comments name engines and stay.
  const source = readFileSync(moduleEntry(), 'utf8')
  assert.deepEqual(versionLines(source), [], 'a version number in a non-comment line of hooks/mod.mjs')
  assert.match(
    source,
    /import \{[^}]*\bMODS_MIN_HOST_VERSION\b[^}]*\bcompareVersions\b[^}]*\} from '\.\.\/lib\/host\/claude-env\.mjs'/,
    'the module does not take the floor and its comparison from lib/host/claude-env.mjs'
  )
})

test('the version pin names a version in code and leaves one in a comment', () => {
  assert.deepEqual(versionLines("// probed on 2.1.295\n  /** 2.1.287 */\n   * and 2.1.291\nconst x = 1.5\n"), [])
  assert.deepEqual(versionLines("// note\nif (v < '2.1.295') off()\n"), ["line 2: if (v < '2.1.295') off()"])
})

test('the suggestion hook adds rows only ahead of the engine\'s own answer, and builds no answer of its own', () => {
  const source = readFileSync(moduleEntry(), 'utf8')
  const body = hookAt(source, "on('prompt.autocomplete'")
  assert.ok(body, 'the module has no prompt.autocomplete hook')
  const built = [...body.matchAll(/return \{[^\n]*/g)].map(m => m[0])
  assert.deepEqual(built, ['return { ...beneath, suggestions: [...rows, ...beneath.suggestions] }'], built.join('\n'))
  assert.ok(!body.includes('text:'), 'the suggestion hook builds a text of its own')
})

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
  // Three spellings are not the meter's words and are stripped first: the
  // engine's two event names, which the module must keep hooking (`turn.complete`,
  // and `prompt.autocomplete`, the suggestions' event, make-the-run-surfaces-
  // interactive design D18, spec hooks/spec-meter "The spec meter SHALL observe
  // only…"), and the wave board's overlay key, the field `lib/draw-plan.mjs`
  // reads for the recorded ids (draw-the-wave-board-in-the-meter-pane design D6).
  const strip = source =>
    source.split('turn.complete').join('').split('prompt.autocomplete').join('').split('completed: run.recorded.ok').join('')
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
