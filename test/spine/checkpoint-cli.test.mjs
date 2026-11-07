// `interlock checkpoint <change>`: the spec checkpoint card, printed from the
// change's own files.
//
// spec/checkpoint-card, "interlock checkpoint <change> SHALL print the card in
// any session, from the change's own files, and SHALL only read". The renderer is
// pinned in checkpoint-card.test.mjs; these tests run the real binary against a
// fixture root and assert on stdout, the JSON fields and the exit status, and that
// no file under the root or the state home was created or changed.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { QUESTIONS, OUTCOMES } from '../../lib/checkpoint-card.mjs'
import { serializeLedger } from '../../lib/ledger.mjs'
import { printedCommands } from '../../lib/run-actions.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')

let tmp
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-checkpoint-cli-'))
})
after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

let n = 0

/**
 * A repository root holding change `name`. `parts` leaves out what a test needs
 * absent: `design`, `ledger`, `findings`.
 */
function fixture(name, { design = true, ledger = true, findings = true } = {}) {
  const root = mkdtempSync(join(tmp, `root${n++}-`))
  const change = join(root, 'openspec', 'changes', name)
  mkdirSync(join(change, 'specs', 'thing'), { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# P\nwhy\n')
  if (design) writeFileSync(join(change, 'design.md'), '# D\nhow\n')
  writeFileSync(join(change, 'tasks.md'), '- [ ] 1.1 scaffold\n- [ ] 1.2 wire\n')
  writeFileSync(join(change, 'specs', 'thing', 'spec.md'), '# S\n')
  if (ledger) {
    writeFileSync(
      join(change, 'decisions.md'),
      serializeLedger(name, [
        { id: 'D3', question: 'Which store holds the sessions?', class: 'needs_human', resolution: '', evidence: '' },
        { id: 'D1', question: 'Name the module', class: 'agent_resolved', resolution: 'checkpoint-cli', evidence: 'design.md D1' }
      ])
    )
  }
  const metrics = join(root, '.claude', 'metrics')
  mkdirSync(metrics, { recursive: true })
  if (findings) {
    // An older file, the newest, and one of a change whose name starts with this one.
    writeFileSync(join(metrics, `review-artifacts-${name}-20261105-090000.json`), JSON.stringify({ dimension: 'artifacts', findings: [] }))
    writeFileSync(
      join(metrics, `review-artifacts-${name}-20261106-101500.json`),
      JSON.stringify({
        dimension: 'artifacts',
        findings: [{ severity: 'blocker', file: 'design.md', title: 'A decision with no owner', description: 'd' }]
      })
    )
    writeFileSync(join(metrics, `review-artifacts-${name}-more-20261107-120000.json`), JSON.stringify({ dimension: 'artifacts', findings: [] }))
  }
  return { root, change }
}

function exec(args, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', input: '' })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** Every file under `dir` with its size, mtime and bytes. */
function snapshot(dir) {
  const out = {}
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[p] = `${statSync(p).mtimeMs}:${readFileSync(p, 'utf8')}`
    }
  }
  walk(dir)
  return out
}

test('a change at its checkpoint prints its card and changes nothing', () => {
  const name = 'add-the-thing'
  const { root } = fixture(name)
  const home = mkdtempSync(join(tmp, 'home-'))
  const before = { root: snapshot(root), home: snapshot(home) }
  const r = exec(['checkpoint', name, '--root', root, '--state-home', home], tmp)
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual({ root: snapshot(root), home: snapshot(home) }, before, 'no file was created or changed')

  const lines = r.stdout.split('\n')
  for (const [i, file] of ['proposal.md', 'design.md', 'tasks.md', 'specs/'].entries()) {
    const line = lines.find(l => l.includes(`openspec/changes/${name}/${file}`))
    assert.ok(line, `${file} is listed`)
    assert.ok(line.includes('present'), line)
    assert.ok(line.includes(QUESTIONS[i].question), `${file} sits beside its question: ${line}`)
  }
  const ledger = lines.findIndex(l => l.startsWith('ledger:'))
  assert.ok(ledger >= 0 && /needs_human/.test(lines[ledger]), lines[ledger])
  assert.ok(lines[ledger + 1].includes('D3') && lines[ledger + 1].includes('Which store holds the sessions?'), 'the needs_human row follows its line')
  assert.ok(!lines.some(l => l.includes('D1 —')), 'an agent_resolved row is not listed')
  assert.ok(lines.some(l => l.startsWith('validate:') && /READY/.test(l)))
  assert.ok(lines.some(l => l.startsWith('gate:') && /blocker 1/.test(l) && /blocked/.test(l)))
  assert.ok(
    lines.some(l => l === `findings file: .claude/metrics/review-artifacts-${name}-20261106-101500.json`),
    'the newest file for this change, not a longer name that starts with it'
  )
  for (const outcome of OUTCOMES) assert.ok(r.stdout.includes(outcome.title), `outcome: ${outcome.title}`)
  assert.deepEqual(printedCommands(r.stdout), [
    '/interlock:spec',
    'interlock autonomy record spec --human-override',
    `interlock validate ${name}`,
    `/interlock:review-artifacts ${name} --since .claude/metrics/review-artifacts-${name}-20261106-101500.json`,
    `/interlock:ship ${name}`
  ])
  assert.ok(!/[<>]/.test(printedCommands(r.stdout).join('\n')), 'no printed command holds a placeholder')
})

test('--json prints the fields the card was rendered from', () => {
  const name = 'add-the-thing'
  const { root } = fixture(name)
  const r = exec(['checkpoint', name, '--root', root, '--json'], tmp)
  assert.equal(r.code, 0, r.stderr)
  const fields = JSON.parse(r.stdout)
  assert.equal(fields.change, name)
  assert.deepEqual(
    fields.artifacts.map(a => [a.id, a.status]),
    [['proposal', 'present'], ['design', 'present'], ['tasks', 'present'], ['specs', 'present']]
  )
  assert.deepEqual(fields.ledgerRows, [{ id: 'D3', question: 'Which store holds the sessions?' }])
  assert.equal(fields.findings, `.claude/metrics/review-artifacts-${name}-20261106-101500.json`)
  for (const key of ['ledger', 'validate', 'gate']) assert.equal(typeof fields[key], 'string', key)
})

test('a change that does not resolve names the open changes and exits 1, with --json an error and candidates', () => {
  const { root } = fixture('add-the-thing')
  const r = exec(['checkpoint', 'nope', '--root', root], tmp)
  assert.equal(r.code, 1)
  assert.match(r.stderr, /"nope" not found/)
  assert.match(r.stderr, /add-the-thing/)
  assert.equal(r.stdout, '')

  const j = exec(['checkpoint', 'nope', '--root', root, '--json'], tmp)
  assert.equal(j.code, 1)
  const body = JSON.parse(j.stdout)
  assert.match(body.error, /nope/)
  assert.deepEqual(body.candidates, ['add-the-thing'])
})

test('no ledger, no findings file and a missing design read as such and still exit 0', () => {
  const name = 'bare-change'
  const { root } = fixture(name, { design: false, ledger: false, findings: false })
  const before = snapshot(root)
  const r = exec(['checkpoint', name, '--root', root], tmp)
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(snapshot(root), before)
  const lines = r.stdout.split('\n')
  assert.ok(lines.some(l => l.startsWith('ledger:') && /MISSING/.test(l)), 'the ledger line says missing as `interlock ledger` words it')
  assert.ok(lines.some(l => l.startsWith('gate:') && /no findings file/.test(l)))
  const design = lines.find(l => l.includes(`openspec/changes/${name}/design.md`))
  assert.ok(design && design.includes('missing') && design.includes(QUESTIONS[1].question), design)
  assert.ok(lines.some(l => l === 'findings file: not observed'))
  assert.ok(lines.some(l => l.startsWith('validate:') && /NOT READY/.test(l)))
  assert.ok(r.stdout.includes('no findings file was observed, so no re-gate command is printed'))
})

test('the verb with no name reads the one active change, and refuses a stray flag with exit 2', () => {
  const { root } = fixture('only-one')
  const bare = exec(['checkpoint', '--root', root], tmp)
  assert.equal(bare.code, 0, bare.stderr)
  assert.ok(bare.stdout.includes('/interlock:ship only-one'))
  const stray = exec(['checkpoint', 'only-one', '--root', root, '--bogus'], tmp)
  assert.equal(stray.code, 2)
  assert.match(stray.stderr, /unknown flag --bogus/)
})

test('an unreadable findings file is named on the gate line, never read as a clear gate', () => {
  const name = 'torn'
  const { root } = fixture(name, { findings: false })
  writeFileSync(join(root, '.claude', 'metrics', `review-artifacts-${name}-20261106-101500.json`), '{ not json')
  const r = exec(['checkpoint', name, '--root', root], tmp)
  assert.equal(r.code, 0, r.stderr)
  const gate = r.stdout.split('\n').find(l => l.startsWith('gate:'))
  assert.match(gate, /was not read/)
  assert.ok(!/passed/.test(gate), gate)
})

test('the module starts no process and writes no file: its source names neither', () => {
  const text = readFileSync(join(ROOT, 'lib', 'checkpoint-cli.mjs'), 'utf8')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n')
  assert.doesNotMatch(text, /child_process|spawn|exec(File)?Sync|writeFile|appendFile|mkdirSync|rmSync|renameSync|writeReviewMetrics/)
  assert.ok(existsSync(join(ROOT, 'lib', 'checkpoint-cli.mjs')))
})
