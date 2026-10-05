// The hooks module's reach, pinned statically (design D8, D13).
//
// The module runs inside the engine, with no Node and `$` as its only way out,
// and it is written to observe: no deny, no substitute result, no catch handler,
// no model, prompt, message, process, network, file write or permission check.
// Nothing at run time would notice a hook that started deciding, so the
// guarantee is read off the source here, before any session loads it.
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
  '$.session.version'
])

/** Tokens whose presence anywhere in the module means it stopped only observing (design D8). */
export const FORBIDDEN_TOKENS = Object.freeze([
  '.catch(',
  'deny',
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

test('npm test collects *.test.mjs only, so the mod\'s .test.ts never reaches Node', () => {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const patterns = [...scripts.test.matchAll(/-name\s+'([^']+)'/g)].map(m => m[1])
  assert.deepEqual(patterns, ['*.test.mjs'], `npm test collects: ${patterns.join(', ') || scripts.test}`)
})
