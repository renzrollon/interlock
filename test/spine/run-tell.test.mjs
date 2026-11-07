// The words of a notification, called rather than grepped.
//
// hooks/ship-meter "The module SHALL tell a halt, a close, a quiet run and a
// checkpoint one time each" (make-the-run-surfaces-interactive design D17).
// What the engine does with the call (a send, a refusal, a toast in the same
// words) is the hooks module's and is tested there with the kit; this file pins
// the words and the keys that say a state was already told.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tellOf, TELL_TITLE } from '../../lib/run-tell.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('a halt names the change, the word halted and the step\'s reason, keyed by run', () => {
  const told = tellOf({
    kind: 'halt',
    runId: 'r-7',
    change: 'add-foo',
    reason: 'unit failures after 2 fix attempts'
  })
  assert.equal(told.key, 'halt:r-7')
  assert.match(told.text, /add-foo/)
  assert.match(told.text, /\bhalted\b/)
  assert.match(told.text, /unit failures after 2 fix attempts/)
})

test('a halt with no reason still names the change and halted, and invents no reason', () => {
  for (const reason of [undefined, null, '', '   ']) {
    const told = tellOf({ kind: 'halt', runId: 'r-7', change: 'add-foo', reason })
    assert.equal(told.text, 'add-foo halted')
  }
})

test('a close holds the change and the record\'s exit code, and no verdict of its own', () => {
  const told = tellOf({ kind: 'close', runId: 'r-7', change: 'add-foo', exitCode: 0 })
  assert.equal(told.key, 'close:r-7')
  assert.match(told.text, /add-foo/)
  assert.match(told.text, /exit 0/)
  assert.doesNotMatch(told.text, /success|succeeded|fail|ok\b|passed/i)
  assert.equal(tellOf({ kind: 'close', runId: 'r-7', change: 'add-foo' }).text, 'add-foo closed')
})

test('quiet and checkpoint read the status line\'s own text', () => {
  const status = 'interlock ship: add-foo · quiet 6 min'
  const quiet = tellOf({ kind: 'quiet', runId: 'r-7', change: 'add-foo', stretch: 1, statusText: status })
  assert.equal(quiet.text, status)
  const card = tellOf({
    kind: 'checkpoint',
    change: 'add-the-thing',
    statusText: 'interlock spec: add-the-thing · checkpoint'
  })
  assert.equal(card.text, 'interlock spec: add-the-thing · checkpoint')
  assert.equal(card.key, 'checkpoint:add-the-thing')
})

test('two quiet stretches of one run give two keys, and one stretch gives one', () => {
  const at = stretch => tellOf({ kind: 'quiet', runId: 'r-7', stretch, statusText: 'quiet' }).key
  assert.notEqual(at(1), at(2))
  assert.equal(at(1), at(1))
  assert.equal(at(1), 'quiet:r-7:1')
})

test('each kind\'s text holds only the fields passed, beside the kind\'s own fixed words', () => {
  const base = { runId: 'r-1', change: 'c-1', reason: 'why-1', exitCode: 3, statusText: 'status-1', stretch: 2 }
  const fixedWords = { halt: 'halted', close: 'closedexit', quiet: '', checkpoint: '' }
  for (const [kind, fixed] of Object.entries(fixedWords)) {
    const { text } = tellOf({ kind, ...base })
    const rest = Object.values(base)
      .map(String)
      .reduce((left, value) => left.split(value).join(''), text)
      .replace(/[\s:()]/g, '')
    assert.equal(rest, fixed, `${kind}: words beyond the fields and the kind's own: ${text}`)
  }
  // A field left out is left out of the text.
  assert.doesNotMatch(tellOf({ kind: 'halt', change: 'c-1' }).text, /undefined|null/)
  assert.doesNotMatch(tellOf({ kind: 'close', change: 'c-1' }).text, /undefined|null|exit/)
})

test('an unknown kind and a non-object tell nothing, and nothing throws', () => {
  for (const bad of [undefined, null, 7, 'halt', [], {}, { kind: 'nope' }]) {
    assert.equal(tellOf(bad), null)
  }
  assert.equal(tellOf({ kind: 'halt', change: 7, reason: {}, runId: {} }).text, 'ship run halted')
})

test('whitespace and newlines in a field collapse to one line', () => {
  const told = tellOf({ kind: 'halt', runId: 'r-1', change: 'c', reason: 'a\n  b\tc' })
  assert.equal(told.text, 'c halted: a b c')
})

test('the title is Interlock', () => {
  assert.equal(TELL_TITLE, 'Interlock')
})

test('the module imports nothing, so the hooks module can load it with no Node', () => {
  const source = readFileSync(join(ROOT, 'lib', 'run-tell.mjs'), 'utf8')
  assert.ok(!/^\s*import\b/m.test(source), 'lib/run-tell.mjs has an import')
  assert.ok(!/\brequire\(|\bimport\(/.test(source), 'lib/run-tell.mjs loads a module dynamically')
  assert.ok(!source.includes('node:'), 'lib/run-tell.mjs names a node: module')
})

test('a run with no id is keyed by the caller\'s launch count, so two id-less runs are two keys', () => {
  // F-d8976ec7: the shared `no-run` fallback told a second id-less run of a session nothing.
  for (const kind of ['halt', 'close', 'quiet']) {
    const first = tellOf({ kind, runId: null, launch: 1, change: 'c', stretch: 1 })
    const second = tellOf({ kind, runId: null, launch: 2, change: 'c', stretch: 1 })
    assert.notEqual(first.key, second.key, `${kind}: two launches share a key`)
    assert.match(first.key, /no-run-1\b/)
    assert.equal(first.text, second.text, `${kind}: the launch count reached the words`)
  }
  // A run id wins over the count, and with neither the key part is the stable word.
  assert.equal(tellOf({ kind: 'halt', runId: 'r-7', launch: 3 }).key, 'halt:r-7')
  assert.equal(tellOf({ kind: 'halt' }).key, 'halt:no-run')
  for (const bad of [0, -1, 1.5, '2', null]) assert.equal(tellOf({ kind: 'halt', launch: bad }).key, 'halt:no-run')
})
