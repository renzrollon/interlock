// lib/advisor-tool.mjs: Claude Code's advisor tool as Interlock reads it
// (replace-subagent-advisors-with-advisor-tool, design "Configuration is read by
// one pure module"). The module only reads: it names the scopes that set the
// key and never returns the value, and a file it cannot read is spoken, never
// read as "unset".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADVISOR_UNSET_FIX,
  advisorConfigured,
  advisorDoctor,
  advisorNotes,
  readAdvisorConfig
} from '../../lib/advisor-tool.mjs'
import { ADVISOR_DISABLE_ENV, observeClaudeEnv } from '../../lib/host/claude-env.mjs'
import { claudeArgs } from '../../lib/host/claude-cli.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const set = (scope, model = 'secret-model-name') => ({ scope, text: JSON.stringify({ advisorModel: model }) })
const plain = scope => ({ scope, text: '{}' })

test('readAdvisorConfig names the scopes that set the key and never returns the value', () => {
  const read = readAdvisorConfig([set('managed', 'nope'), set('user', 'opus-secret'), plain('project'), { scope: 'local', absent: true }])
  assert.deepEqual(read, { scopes: ['managed', 'user'], unreadable: [] })
  assert.ok(!JSON.stringify(read).includes('opus-secret'))
  assert.ok(!JSON.stringify(read).includes('nope'))
})

test('readAdvisorConfig keeps source order and treats an absent file as neither set nor unreadable', () => {
  const read = readAdvisorConfig([{ scope: 'user', absent: true }, set('local'), set('project')])
  assert.deepEqual(read.scopes, ['local', 'project'])
  assert.deepEqual(read.unreadable, [])
})

test('readAdvisorConfig reports a scope it could not read, with the reason, and keeps reading the rest', () => {
  const read = readAdvisorConfig([
    { scope: 'user', error: new Error('EACCES: permission denied') },
    { scope: 'project', error: 'EISDIR' },
    set('local')
  ])
  assert.deepEqual(read.scopes, ['local'])
  assert.deepEqual(read.unreadable, [
    { scope: 'user', reason: 'EACCES: permission denied' },
    { scope: 'project', reason: 'EISDIR' }
  ])
})

test('readAdvisorConfig reads unparseable text as unreadable with the parse reason', () => {
  const read = readAdvisorConfig([{ scope: 'local', text: '{ not json' }])
  assert.deepEqual(read.scopes, [])
  assert.equal(read.unreadable.length, 1)
  assert.equal(read.unreadable[0].scope, 'local')
  assert.match(read.unreadable[0].reason, /^not valid JSON: \S/)
})

test('readAdvisorConfig reads a non-string, blank or empty value as unset', () => {
  for (const value of [5, true, null, [], ['opus'], {}, '', '   ']) {
    const read = readAdvisorConfig([{ scope: 'user', text: JSON.stringify({ advisorModel: value }) }])
    assert.deepEqual(read, { scopes: [], unreadable: [] }, JSON.stringify(value))
  }
})

test('readAdvisorConfig reads a file whose JSON is not an object as unreadable', () => {
  for (const text of ['[]', 'null', '5', '"opus"', 'true']) {
    const read = readAdvisorConfig([{ scope: 'project', text }])
    assert.deepEqual(read, { scopes: [], unreadable: [{ scope: 'project', reason: 'not a JSON object' }] }, text)
  }
})

test('readAdvisorConfig reads a source with no text as unreadable, and a non-list as no sources', () => {
  assert.deepEqual(readAdvisorConfig([{ scope: 'user' }]).unreadable, [{ scope: 'user', reason: 'no settings text given' }])
  assert.deepEqual(readAdvisorConfig([{ scope: 'user', text: 7 }]).unreadable.map(u => u.scope), ['user'])
  for (const bad of [undefined, null, 'x', {}]) assert.deepEqual(readAdvisorConfig(bad), { scopes: [], unreadable: [] })
  assert.deepEqual(readAdvisorConfig([null, 3, set('user')]).scopes, ['user'])
})

test('advisorConfigured is true only with a scope set and the tool not disabled', () => {
  assert.equal(advisorConfigured({ scopes: ['user'], unreadable: [], disabled: false }), true)
  assert.equal(advisorConfigured({ scopes: ['user'], unreadable: [], disabled: true }), false)
  assert.equal(advisorConfigured({ scopes: [], unreadable: [], disabled: false }), false)
  assert.equal(advisorConfigured({ scopes: [], unreadable: [{ scope: 'local', reason: 'x' }], disabled: false }), false)
  for (const bad of [undefined, null, 'x', {}]) assert.equal(advisorConfigured(bad), false)
})

test('advisorNotes: configured, counted true and false', () => {
  const o = { scopes: ['user', 'project'], unreadable: [], disabled: false }
  assert.deepEqual(advisorNotes(o, { counted: true }), [
    'ADVISOR CONFIGURED (user, project): lanes the engine pairs with it may consult it; consults are counted per lane, the advice is not recorded, and its spend is not established'
  ])
  assert.deepEqual(advisorNotes(o, { counted: false }), [
    'ADVISOR CONFIGURED (user, project): lanes the engine pairs with it may consult it; consults are not counted on this host, the advice is not recorded, and its spend is not established'
  ])
  assert.deepEqual(advisorNotes(o), advisorNotes(o, { counted: false }), 'an unstated host does not claim a count')
})

test('advisorNotes: disabled names the variable and the ignored scopes, and says nothing is active', () => {
  const notes = advisorNotes({ scopes: ['user'], unreadable: [], disabled: true }, { counted: true })
  assert.deepEqual(notes, [`ADVISOR DISABLED: ${ADVISOR_DISABLE_ENV} is set, so advisorModel in user is ignored`])
})

test('advisorNotes: one note per unreadable scope, with or without a set scope', () => {
  const unreadable = [{ scope: 'project', reason: 'not valid JSON: x' }, { scope: 'local', reason: 'EACCES' }]
  assert.deepEqual(advisorNotes({ scopes: [], unreadable, disabled: false }, { counted: true }), [
    'ADVISOR CONFIGURATION NOT READ: project settings (not valid JSON: x)',
    'ADVISOR CONFIGURATION NOT READ: local settings (EACCES)'
  ])
  const both = advisorNotes({ scopes: ['user'], unreadable: unreadable.slice(1), disabled: false }, { counted: true })
  assert.equal(both.length, 2)
  assert.ok(both[0].startsWith('ADVISOR CONFIGURED (user)'))
  assert.equal(both[1], 'ADVISOR CONFIGURATION NOT READ: local settings (EACCES)')
})

test('advisorNotes: no note when nothing is set, disabled or not, and none for a missing observation', () => {
  assert.deepEqual(advisorNotes({ scopes: [], unreadable: [], disabled: false }, { counted: true }), [])
  assert.deepEqual(advisorNotes({ scopes: [], unreadable: [], disabled: true }, { counted: true }), [])
  for (const bad of [undefined, null, {}]) assert.deepEqual(advisorNotes(bad, { counted: true }), [])
  for (const text of advisorNotes({ scopes: ['user'], unreadable: [], disabled: false }, { counted: true })) {
    assert.doesNotMatch(text, /\bactive\b|\$|spend of/i, 'no note claims activity or a spend figure')
  }
})

test('advisorDoctor: ok when a scope sets the key, naming scopes and never the value', () => {
  const read = readAdvisorConfig([set('user', 'opus-secret'), set('project', 'opus-secret'), plain('local')])
  const row = advisorDoctor({ ...read, disabled: false })
  assert.equal(row.status, 'ok')
  assert.match(row.detail, /advisorModel set in user, project;/)
  assert.match(row.detail, /Claude decides when to consult it/)
  assert.match(row.detail, /counts consults on the Workflow host and never records the advice/)
  assert.ok(!row.detail.includes('opus-secret'))
  assert.equal(row.fix, undefined)
})

test('advisorDoctor: skip when unset, with the --advisor caveat and the exact fix', () => {
  const row = advisorDoctor({ scopes: [], unreadable: [], disabled: false })
  assert.equal(row.status, 'skip')
  assert.match(row.detail, /a session's --advisor flag is not visible to doctor/)
  assert.equal(row.fix, 'Run /advisor <model> to turn it on. Interlock cannot: a plugin\'s settings apply only agent and subagentStatusLine.')
  assert.equal(row.fix, ADVISOR_UNSET_FIX)
})

test('advisorDoctor: an unreadable file is named with its reason and does not demote a set scope', () => {
  const unreadable = [{ scope: 'local', reason: 'not valid JSON: boom' }]
  const ok = advisorDoctor({ scopes: ['user'], unreadable, disabled: false })
  assert.equal(ok.status, 'ok')
  assert.match(ok.detail, /advisorModel set in user;/)
  assert.ok(ok.detail.endsWith('; not read: local (not valid JSON: boom)'), ok.detail)
  const skip = advisorDoctor({ scopes: [], unreadable, disabled: false })
  assert.equal(skip.status, 'skip')
  assert.match(skip.detail, /; not read: local \(not valid JSON: boom\)$/)
  assert.equal(skip.fix, ADVISOR_UNSET_FIX)
})

test('advisorDoctor: disabled is skip and names the variable and the ignored scopes, with and without a scope', () => {
  const withScope = advisorDoctor({ scopes: ['user'], unreadable: [], disabled: true })
  assert.equal(withScope.status, 'skip')
  assert.match(withScope.detail, new RegExp(`${ADVISOR_DISABLE_ENV} is set, so advisorModel in user is ignored`))
  const without = advisorDoctor({ scopes: [], unreadable: [{ scope: 'project', reason: 'not a JSON object' }], disabled: true })
  assert.equal(without.status, 'skip')
  assert.match(without.detail, new RegExp(ADVISOR_DISABLE_ENV))
  assert.match(without.detail, /not read: project \(not a JSON object\)/)
})

test('advisorDoctor never returns fail, whatever it is given', () => {
  for (const o of [undefined, null, {}, { scopes: 'x', unreadable: 3 }, { scopes: [], unreadable: [], disabled: 'yes' }]) {
    assert.ok(['ok', 'skip'].includes(advisorDoctor(o).status), JSON.stringify(o))
  }
})

test('the module imports no node: module, so it cannot write a settings file', () => {
  const text = readFileSync(join(ROOT, 'lib', 'advisor-tool.mjs'), 'utf8')
  assert.doesNotMatch(text, /from\s+['"]node:/)
  assert.doesNotMatch(text, /\brequire\(|\bimport\(/)
  assert.deepEqual([...text.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]), ['./host/claude-env.mjs'])
})

test('observeClaudeEnv reads the disable variable with the module\'s enabled() rule', () => {
  assert.equal(ADVISOR_DISABLE_ENV, 'CLAUDE_CODE_DISABLE_ADVISOR_TOOL')
  const read = value => observeClaudeEnv(value === undefined ? {} : { [ADVISOR_DISABLE_ENV]: value }).advisorDisabled
  assert.equal(read(undefined), false)
  for (const on of ['1', 'true', 'TRUE', 'yes', ' 1 ']) assert.equal(read(on), true, on)
  for (const off of ['', '   ', '0', 'false', 'False']) assert.equal(read(off), false, JSON.stringify(off))
  assert.equal(observeClaudeEnv(undefined).advisorDisabled, false)
  assert.equal(observeClaudeEnv({}).advisorDisabled, false)
})

// --- the never-configure rule, pinned statically ------------------------------
//
// Only the user can turn the advisor tool on. The one file that may spell the
// settings key is the pure reader, which imports no node: module and so cannot
// write; any other file spelling it is a file that could be made to set it.

/** Every file under a directory, relative to ROOT, skipping dependency and VCS trees. */
function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      out.push(...filesUnder(rel))
    } else if (entry.isFile()) out.push(rel)
  }
  return out
}

test('only the pure configuration reader spells the advisor settings key under lib, bin, hooks and workflows', () => {
  const files = ['lib', 'bin', 'hooks', 'workflows'].flatMap(filesUnder)
  assert.ok(files.length > 50, `the walk found only ${files.length} files, so it is not looking where it should`)
  assert.ok(files.includes(join('lib', 'advisor-tool.mjs')))
  const spelling = files.filter(f => readFileSync(join(ROOT, f), 'utf8').includes('advisorModel'))
  assert.deepEqual(spelling, [join('lib', 'advisor-tool.mjs')])
})

test('the claude adapter never emits --advisor, whatever the request carries', () => {
  const requests = [
    {},
    { schema: { type: 'object' }, type: 'interlock:worker', tools: ['Bash', 'Read'] },
    { advisor: 'opus', advisorModel: 'opus', args: ['--advisor', 'opus'] }
  ]
  const options = [
    {},
    { model: 'opus', effort: 'high', permissionMode: 'acceptEdits', plugin: '/p', permissionPrompts: 'flag' },
    { model: 'opus', advisor: 'opus', advisorModel: 'opus' }
  ]
  for (const req of requests) {
    for (const opts of options) {
      const argv = claudeArgs(req, opts)
      assert.ok(!argv.some(a => /advisor/i.test(a)), JSON.stringify(argv))
    }
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'lib', 'host', 'claude-cli.mjs'), 'utf8'), /--advisor/)
})
