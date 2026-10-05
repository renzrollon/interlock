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
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json')

/** The engine calls the module may make, exactly (design D8). */
export const ALLOWED_CALLS = Object.freeze([
  '$.ui.status',
  '$.ui.toast',
  '$.ui.log',
  '$.ui.open',
  '$.ui.invalidate',
  '$.ui.resolve',
  '$.command.register',
  '$.session.usage',
  '$.session.version',
  // The launch guard (guard-ship-relaunch-in-process design D2, D3): the time,
  // and its one session-state key read and written.
  '$.clock.now',
  '$.state.get',
  '$.state.set'
])

/** What the launch guard added to the meter's allow-list, exactly. */
const GUARD_CALLS = Object.freeze(['$.clock.now', '$.state.get', '$.state.set'])

/** The one line in the module that may refuse a call: the rule's verdict, in the rule's words. */
export const GUARD_REFUSAL = "if (launch && verdict.decision === 'deny') return { deny: verdict.reason }"

/** The events the module hooks, exactly: the meter's, and the launch guard's two (design D3). */
export const HOOKED_EVENTS = Object.freeze([
  'session.start',
  'tool.call',
  'turn.step',
  'turn.complete',
  'agent.spawn',
  'ui.render',
  'command.run',
  'prompt.submit',
  'session.receive'
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
  '$.store'
])

const rel = abs => relative(ROOT, abs).split(sep).join('/')
const CONTRACT_KEY = 'types'

/** Every `$.<noun>.<method>` a source spells, in order of first appearance. */
export function engineCalls(source) {
  return [...new Set([...source.matchAll(/\$\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)].map(m => `$.${m[1]}.${m[2]}`))]
}

/** Every module specifier a source names: static imports, re-exports, side-effect and dynamic imports. */
export function specifiers(source) {
  const found = new Set()
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]) {
    for (const m of source.matchAll(re)) found.add(m[1])
  }
  return [...found]
}

/**
 * The module's import closure, with what each file names that the engine
 * environment cannot load: a `node:` module, or a bare specifier other than
 * `claude-code`. Relative specifiers are walked; each must resolve to a file
 * inside the plugin.
 *
 * @returns {{files: string[], problems: string[]}}
 */
export function walkModule(entry, root = ROOT) {
  const seen = new Set()
  const problems = []
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of specifiers(source)) {
      if (spec.startsWith('node:')) {
        problems.push(`${rel(file)} imports '${spec}', a node: module the engine environment does not have`)
      } else if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec)
        const inside = !relative(root, target).startsWith('..')
        if (!inside) problems.push(`${rel(file)} imports '${spec}', which resolves outside the plugin`)
        else if (!statSync(target, { throwIfNoEntry: false })?.isFile()) {
          problems.push(`${rel(file)} imports '${spec}', which does not resolve to a file`)
        } else queue.push(target)
      } else if (spec !== 'claude-code') {
        problems.push(`${rel(file)} imports '${spec}', a bare specifier other than claude-code`)
      }
    }
  }
  return { files: [...seen], problems }
}

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

test('the refusal pin names a second deny, and one fed by anything but the verdict', () => {
  const ok = `const verdict = decideLaunch(record, now)\n${GUARD_REFUSAL}\n`
  assert.deepEqual(strayRefusals(ok), [])
  assert.deepEqual(strayRefusals(`${ok}  if (x) return { deny: 'no' }\n`), ["line 3: if (x) return { deny: 'no' }"])
  assert.deepEqual(strayRefusals("  if (launch) return { deny: 'Leftover boxes' }\n"), ["line 1: if (launch) return { deny: 'Leftover boxes' }"])
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
  const hooked = [...new Set([...source.matchAll(/\bon\(\s*'([a-z.]+)'/g)].map(m => m[1]))]
  assert.deepEqual([...hooked].sort(), [...HOOKED_EVENTS].sort())
})

test('every file the hooks module reaches is inside the plugin and Node-free', () => {
  const { problems } = walkModule(moduleEntry())
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('the walker names a node: import reached through a relative one', () => {
  // The spec's own failure case: a module that imports lib/ship-stage.mjs,
  // which imports node:fs, fails naming both.
  const { problems } = walkModule(join(ROOT, 'lib', 'ship-stage.mjs'))
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

test('npm test collects *.test.mjs only, so the mod\'s .test.ts never reaches Node', () => {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const patterns = [...scripts.test.matchAll(/-name\s+'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(patterns, ['*.test.mjs'], `npm test collects: ${patterns.join(', ') || scripts.test}`)
})
