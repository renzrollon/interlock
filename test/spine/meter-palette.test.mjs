// The ship meter's palette: the theme
// keys the pane draws with, the state words they colour and the turn words.
// Pure rules, so they are pinned here under Node; the hooks module's use of
// them is `test/mod/meter.test.ts`'s, under `claude plugin test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { specifiers, walkModule } from '../helpers/module-walk.mjs'
import { PALETTE, stateProps, turnProps } from '../../lib/meter-palette.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY = join(ROOT, 'lib', 'meter-palette.mjs')

test('the palette names theme keys, one per meaning, and cannot be changed', () => {
  assert.deepEqual(PALETTE, {
    ok: 'success',
    failed: 'error',
    current: 'warning',
    identity: 'suggestion',
    accent: 'claude',
    warn: 'warning',
    alarm: 'error'
  })
  assert.ok(Object.isFrozen(PALETTE))
})

test('a state word the board printed is coloured by its meaning, and dim or plain otherwise', () => {
  assert.deepEqual(stateProps('ok'), { color: 'success' })
  assert.deepEqual(stateProps('failed'), { color: 'error' })
  assert.deepEqual(stateProps('current'), { color: 'warning' })
  for (const word of ['pending', 'not reached', 'not recorded', 'per task']) assert.deepEqual(stateProps(word), { dimColor: true }, word)
  for (const word of [undefined, null, '', 'skipped', 'OK', 'running']) assert.equal(stateProps(word), null, String(word))
})

test('a turn still running is the warn colour, an answer ok, and every other word the host sends alarm', () => {
  assert.deepEqual(turnProps(null), { color: PALETTE.warn })
  assert.deepEqual(turnProps(undefined), { color: PALETTE.warn })
  assert.deepEqual(turnProps('answer'), { color: PALETTE.ok })
  for (const word of ['error', 'aborted', 'refusal', 'cancelled', 'a word no declaration names']) {
    assert.deepEqual(turnProps(word), { color: PALETTE.alarm }, word)
  }
})

test('the palette imports nothing, so the hooks module can load it in the engine', () => {
  assert.deepEqual(specifiers(readFileSync(ENTRY, 'utf8')), [])
  const { files, problems } = walkModule(ENTRY, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(files, [ENTRY])
})
