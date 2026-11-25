// The requirement-wording lint (spec: spec/requirement-wording).
//
// Pure tests pin lintWording and the word list; CLI tests run the real binary
// over a temporary repository and assert that a wording entry reports and never
// decides: `ready`, `problems` and the exit code are what they are without it.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as wording from '../../lib/requirement-wording.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')
const { lintWording } = wording

const PHRASES = ['properly', 'as appropriate', 'if possible', 'and/or', 'but not limited to', 'eventually', 'etc.']

/** A delta spec body: `lines` placed under `## ADDED Requirements`. */
function added(...lines) {
  return ['# Spec Delta', '', '## ADDED Requirements', '', ...lines, ''].join('\n')
}

// --- pure ---------------------------------------------------------------

test('a phrase at a known line is flagged with its line, reason and a WORDING: message', () => {
  const text = added('### Requirement: Cache', '', 'The cache is eventually refreshed.')
  const hits = lintWording('specs/a/spec.md', text)
  assert.equal(hits.length, 1)
  const [h] = hits
  assert.equal(h.file, 'specs/a/spec.md')
  assert.equal(h.line, 7)
  assert.equal(h.phrase, 'eventually')
  assert.equal(typeof h.reason, 'string')
  assert.ok(h.reason.length > 0)
  assert.ok(h.message.startsWith('WORDING:'), h.message)
})

test('matching is case-insensitive and on whole phrases', () => {
  const hits = lintWording('s.md', added('Eventually the cache refreshes.', 'It was improperly closed.'))
  assert.deepEqual(hits.map(h => h.phrase), ['eventually'])
})

test('a totality word is not flagged', () => {
  assert.deepEqual(lintWording('s.md', added('every finding SHALL name its file; all of them too.')), [])
})

test('a backtick span and a double-quoted phrase are not flagged', () => {
  const text = added(
    '- **THEN** it still rejects vague phrases (`update accordingly`, `etc.`)',
    '- **THEN** the text "if possible" is quoted, not used'
  )
  assert.deepEqual(lintWording('s.md', text), [])
})

test('a fenced block, a heading line and a REMOVED block are not read', () => {
  const text = [
    '# Spec Delta',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: Works properly',
    '',
    '```',
    'run it as appropriate',
    '```',
    '',
    '## REMOVED Requirements',
    '',
    '### Requirement: Old',
    'It acts if possible.',
    '',
    '## RENAMED Requirements',
    '',
    '- FROM: eventually',
    ''
  ].join('\n')
  assert.deepEqual(lintWording('s.md', text), [])
})

test('a MODIFIED block is read', () => {
  const text = ['## MODIFIED Requirements', '', '### Requirement: X', 'It works, but not limited to this.', ''].join('\n')
  assert.deepEqual(lintWording('s.md', text).map(h => h.phrase), ['but not limited to'])
})

test('the list holds exactly the seven phrases, each with a reason, and no totality word', () => {
  const list = wording.WORDING_LIST
  assert.ok(Array.isArray(list) && Object.isFrozen(list), 'WORDING_LIST is a frozen array')
  for (const e of list) assert.ok(e.reason && e.reason.length > 0, `${e.phrase} has no reason`)
  const names = list.map(e => e.phrase)
  assert.deepEqual([...names].sort(), [...PHRASES].sort())
  assert.ok(!names.includes('every') && !names.includes('all'))
})

// --- CLI ----------------------------------------------------------------

let tmp
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-wording-'))
})
after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

let n = 0
function repo(specBody) {
  const root = mkdtempSync(join(tmp, `r${n++}-`))
  const dir = join(root, 'openspec', 'changes', 'demo')
  mkdirSync(join(dir, 'specs', 'a'), { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), '# Proposal\n')
  writeFileSync(join(dir, 'design.md'), '# Design\n')
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 one\n')
  writeFileSync(join(dir, 'specs', 'a', 'spec.md'), specBody)
  return root
}

function validate(root, ...extra) {
  const r = spawnSync(process.execPath, [BIN, 'validate', 'demo', '--root', root, ...extra], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

const VAGUE = added('### Requirement: Cache', '', 'The cache is eventually refreshed.')
const CLEAN = added('### Requirement: Cache', '', 'The cache is refreshed within one minute.')

test('validate --json carries wording with file, line, phrase, reason and message', () => {
  const r = validate(repo(VAGUE), '--json')
  const j = JSON.parse(r.out)
  assert.equal(j.wording.length, 1)
  const [w] = j.wording
  assert.equal(w.file, 'specs/a/spec.md')
  assert.equal(w.line, 7)
  assert.equal(w.phrase, 'eventually')
  assert.ok(w.reason)
  assert.ok(w.message.startsWith('WORDING:'))
})

test('validate text mode prints the message', () => {
  const root = repo(VAGUE)
  const j = JSON.parse(validate(root, '--json').out)
  const text = validate(root)
  assert.ok(text.out.includes(j.wording[0].message), text.out)
})

test('a change with no phrase carries wording: [] and prints no WORDING: line', () => {
  const root = repo(CLEAN)
  assert.deepEqual(JSON.parse(validate(root, '--json').out).wording, [])
  assert.ok(!validate(root).out.includes('WORDING:'))
})

test('a wording entry leaves ready, problems and the exit code as without the phrase', () => {
  const vague = validate(repo(VAGUE), '--json')
  const clean = validate(repo(CLEAN), '--json')
  const a = JSON.parse(vague.out)
  const b = JSON.parse(clean.out)
  assert.equal(a.ready, b.ready)
  assert.equal(a.ready, true)
  assert.deepEqual(a.problems, b.problems)
  assert.equal(vague.code, clean.code)
  assert.equal(vague.code, 0)
})

test('a not-ready change with a phrase still exits 1 and keeps its problems', () => {
  const root = repo(VAGUE)
  rmSync(join(root, 'openspec', 'changes', 'demo', 'design.md'))
  const r = validate(root, '--json')
  const j = JSON.parse(r.out)
  assert.equal(r.code, 1)
  assert.equal(j.ready, false)
  assert.ok(j.problems.length >= 1)
  assert.equal(j.wording.length, 1)
})
