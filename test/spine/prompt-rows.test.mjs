// The prompt's argument suggestions (make-the-run-surfaces-interactive, spec
// hooks/ship-meter "The module SHALL suggest open change names and recent run
// ids…", design D11, D18). The rows cases of the three scenarios; the
// hooks-module half (the engine's own rows, the debug-log lines) is tested under
// the kit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUBCOMMAND_FLAGS, firstUnknownFlag, leafOf } from '../../lib/cli-flags.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { ARGUMENT_COMMANDS, argumentOf, promptRows } from '../../lib/prompt-rows.mjs'
import { walkModule } from '../helpers/module-walk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A `prompt.autocomplete` event for `draft` with the cursor at its end, the token its last word. */
function eventFor(draft) {
  const start = draft.search(/\S*$/)
  return { text: draft, cursor: draft.length, token: draft.slice(start), start }
}

const REPORT = {
  openChanges: { names: ['add-foo', 'add-bar', 'fix-baz'], omitted: 0 },
  recentRuns: { names: ['r-3', 'r-2', 'r-1', 'x-9'], omitted: 0 }
}
const names = rows => rows.map(row => row.text)

test('a ship command is offered the open changes that match, in the report\'s order', () => {
  const rows = promptRows(eventFor('/interlock:ship add-'), REPORT)
  assert.deepEqual(names(rows), ['add-foo', 'add-bar'])
  assert.deepEqual(rows[0], { text: 'add-foo', label: 'add-foo', description: 'open change' })
  assert.deepEqual(names(promptRows(eventFor('/interlock:ship '), REPORT)), ['add-foo', 'add-bar', 'fix-baz'])
})

test('every table entry offers its own list and no other', () => {
  for (const { command, list } of ARGUMENT_COMMANDS) {
    const rows = promptRows(eventFor(`${command} `), REPORT)
    assert.deepEqual(names(rows), REPORT[list].names, command)
    assert.equal(argumentOf(eventFor(`${command} `)), list)
  }
  assert.deepEqual(names(promptRows(eventFor('interlock run-log show r-'), REPORT)), ['r-3', 'r-2', 'r-1'])
  assert.deepEqual(names(promptRows(eventFor('interlock run-log follow --run r-'), REPORT)), ['r-3', 'r-2', 'r-1'])
  assert.deepEqual(names(promptRows(eventFor('interlock run-log query --run x'), REPORT)), ['x-9'])
  assert.ok(ARGUMENT_COMMANDS.some(c => c.list === 'openChanges') && ARGUMENT_COMMANDS.some(c => c.list === 'recentRuns'))
})

test('a cursor in the middle of a draft reads the words before the token', () => {
  const text = '/interlock:ship add- and more'
  const rows = promptRows({ text, cursor: '/interlock:ship add-'.length, token: 'add-', start: '/interlock:ship '.length }, REPORT)
  assert.deepEqual(names(rows), ['add-foo', 'add-bar'])
  // `start` absent: the token's start is the cursor less its length.
  assert.deepEqual(names(promptRows({ text: '/interlock:ship add-', cursor: 20, token: 'add-' }, REPORT)), ['add-foo', 'add-bar'])
})

test('more names than the cap add no more than the cap, the first as listed', () => {
  const many = { openChanges: { names: Array.from({ length: 20 }, (_, i) => `add-${String(i).padStart(2, '0')}`), omitted: 0 }, recentRuns: null }
  const rows = promptRows(eventFor('/interlock:ship add-'), many)
  assert.equal(rows.length, LIMITS.promptSuggestRows)
  assert.deepEqual(names(rows), many.openChanges.names.slice(0, LIMITS.promptSuggestRows))
  assert.deepEqual(names(promptRows(eventFor('/interlock:ship add-'), many, 3)), many.openChanges.names.slice(0, 3))
  assert.deepEqual(promptRows(eventFor('/interlock:ship add-'), many, 0), [])
  // A cap that is not a count falls back to the published one.
  assert.equal(promptRows(eventFor('/interlock:ship add-'), many, -1).length, LIMITS.promptSuggestRows)
  assert.equal(promptRows(eventFor('/interlock:ship add-'), many, 'x').length, LIMITS.promptSuggestRows)
})

test('the three drafts that get no rows, and others that do not ask for a name', () => {
  for (const draft of [
    'fix the tests in add-',
    '/interlock:ship add-foo --str',
    '/interlock:shi',
    '/interlock:ship',
    'interlock run-log show',
    'interlock run-log showr-',
    '/interlock:spec add-',
    '/interlock:ship add-foo add-',
    'please /interlock:ship add-',
    ''
  ]) {
    assert.equal(promptRows(eventFor(draft), REPORT), null, draft)
    assert.equal(argumentOf(eventFor(draft)), null, draft)
  }
})

test('a missing report, a null list or an event of no shape is null, never rows', () => {
  const event = eventFor('/interlock:ship add-')
  assert.equal(promptRows(event, null), null)
  assert.equal(promptRows(event, undefined), null)
  assert.equal(promptRows(event, 'x'), null)
  assert.equal(promptRows(event, { openChanges: null, recentRuns: REPORT.recentRuns }), null)
  assert.equal(promptRows(event, { recentRuns: REPORT.recentRuns }), null, 'an absent field reads as null')
  assert.equal(promptRows(event, { openChanges: { names: 'add-foo' } }), null)
  assert.equal(promptRows(eventFor('interlock run-log show r-'), { openChanges: REPORT.openChanges, recentRuns: null }), null)
  for (const bad of [null, undefined, 3, 'x', {}, { text: 'a', token: 3 }, { text: '/interlock:ship a', token: 'a', start: 99 }, { text: '/interlock:ship a', token: 'b', start: 16 }]) {
    assert.equal(promptRows(bad, REPORT), null, JSON.stringify(bad))
  }
})

test('a draft that asks for a name no one has yields an empty list, not null', () => {
  assert.deepEqual(promptRows(eventFor('/interlock:ship zzz'), REPORT), [])
  assert.deepEqual(promptRows(eventFor('/interlock:ship zzz'), { openChanges: { names: [], omitted: 0 } }), [])
})

test('the module is pure, imports only the limits definition, and reads its cap itself', () => {
  const entry = join(ROOT, 'lib', 'prompt-rows.mjs')
  const { files, problems } = walkModule(entry, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(files.sort(), [entry, join(ROOT, 'lib', 'limits.mjs')].sort())
  const source = readFileSync(entry, 'utf8')
  assert.ok(source.includes('LIMITS.promptSuggestRows'))
  assert.ok(!/\b8\b/.test(source.replace(/\/\/.*$/gm, '')), 'the figure is not restated')
  for (const token of ['process.', 'Date', 'readFileSync', 'import(', 'globalThis']) {
    assert.ok(!source.includes(token), `lib/prompt-rows.mjs contains ${token}`)
  }
  // The reader half of the pin: the hooks module restates neither the key nor the figure.
  const mod = readFileSync(join(ROOT, 'hooks', 'mod.mjs'), 'utf8')
  assert.ok(!mod.includes('promptSuggestRows'), 'hooks/mod.mjs spells the key')
  assert.ok(!mod.includes('LIMITS.promptSuggest'), 'hooks/mod.mjs reads the cap')
})

test('every command the table names is a verb in the CLI inventory or a skill the plugin ships', () => {
  for (const { command } of ARGUMENT_COMMANDS) {
    const parts = command.split(/\s+/)
    if (parts[0].startsWith('/interlock:')) {
      const skill = parts[0].slice('/interlock:'.length)
      assert.ok(existsSync(join(ROOT, 'skills', skill, 'SKILL.md')), `${command}: no skills/${skill}/SKILL.md`)
      continue
    }
    assert.equal(parts[0], 'interlock', `${command}: neither a skill nor an interlock verb`)
    const flagAt = parts.findIndex((word, i) => i > 0 && word.startsWith('--'))
    const verb = parts.slice(1, flagAt < 0 ? parts.length : flagAt)
    const leaf = leafOf(verb)
    assert.ok(leaf && Object.hasOwn(SUBCOMMAND_FLAGS, leaf), `${command}: "${verb.join(' ')}" is not a verb in lib/cli-flags.mjs`)
    if (flagAt >= 0) {
      const flags = Object.fromEntries(parts.slice(flagAt).map(word => [word.replace(/^--/, ''), true]))
      assert.equal(firstUnknownFlag(verb, flags), null, `${command}: the verb does not accept that flag`)
    }
  }
})
