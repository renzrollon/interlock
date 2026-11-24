// The citation rule behind `interlock settle handoff-check`
// (post-the-proof-beside-the-findings, requirements "A row SHALL read confirmed
// only when…", "An unconfirmed row SHALL carry one of seven fixed reasons…" and
// "The handoff's counts SHALL be worked out from its rows…").
//
// The module is reached through a dynamic import inside a helper, so this file
// loads before lib/settle-handoff.mjs exists and every test fails on its own.
//
// Shape under test: checkHandoff({ brief, reply, lineCount }) -> { handoff, lines }
//   brief      the record `conformance-brief --out` keeps
//   reply      the worker's parsed reply
//   lineCount  (path) => number of lines the file has, or null when it does not exist
//   handoff    the checked handoff object; lines the strings printed, counts line first

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE = join(ROOT, 'lib', 'settle-handoff.mjs')

const DIR = 'openspec/changes/demo-change'
const HEAD = 'abc1234'

const FILES = {
  'lib/a.mjs': 90,
  'lib/b.mjs': 40,
  'openspec/specs/review/settle-loop/spec.md': 800,
  [`${DIR}/specs/review/settle-loop/spec.md`]: 120,
  'openspec/changes/archive/2026-01-01-old/tasks.md': 30
}
const lineCount = path => (Object.hasOwn(FILES, path) ? FILES[path] : null)

async function check(args) {
  const mod = await import('../../lib/settle-handoff.mjs')
  return mod.checkHandoff({ lineCount, ...args })
}

function brief({ scenarios = ['C1', 'C2', 'C3'], living = ['L1', 'L2'], livingExtra = {} } = {}) {
  return {
    change: 'demo-change',
    dir: DIR,
    head: HEAD,
    resultPath: '.claude/ship/settle/handoff-reply.json',
    scenarios: scenarios.map((id, i) => ({ id, artifact: 'specs/review/settle-loop/spec.md', line: 10 + i, title: `scenario ${id}`, body: 'b' })),
    living: {
      skipped: null,
      partial: null,
      omitted: [],
      requirements: living.map((id, i) => ({ id, capability: 'review/settle-loop', artifact: 'openspec/specs/review/settle-loop/spec.md', line: 40 + i, title: `requirement ${id}` })),
      ...livingExtra
    },
    briefing: '…'
  }
}

function reply(rows, extra = {}) {
  return {
    ok: true,
    scenariosChecked: 3,
    scenariosUnconfirmed: 0,
    requirementsChecked: 2,
    requirementsUnconfirmed: 0,
    detail: 'worker detail',
    head: HEAD,
    rows,
    ...extra
  }
}

const row = (id, cite, status = 'confirmed') => (cite === undefined ? { id, status } : { id, status, cite })
const byId = (handoff, id) => handoff.rows.find(r => r.id === id)

test('handoff check: every briefed id confirmed with a citation that resolves', async () => {
  const { handoff, lines } = await check({
    brief: brief(),
    reply: reply([row('C1', 'lib/a.mjs:12-40'), row('C2', 'lib/a.mjs:5'), row('C3', 'lib/b.mjs:7'), row('L1', 'lib/a.mjs:1'), row('L2', 'lib/b.mjs:40')])
  })
  assert.equal(handoff.checked, true)
  assert.equal(handoff.rows.length, 5)
  for (const r of handoff.rows) {
    assert.equal(r.status, 'confirmed')
    assert.equal(r.reason, null)
  }
  const c1 = byId(handoff, 'C1')
  assert.equal(c1.kind, 'scenario')
  assert.equal(c1.title, 'scenario C1')
  assert.equal(c1.cite, 'lib/a.mjs:12-40')
  assert.equal(byId(handoff, 'L1').kind, 'requirement')
  assert.equal(handoff.scenariosChecked, 3)
  assert.equal(handoff.scenariosUnconfirmed, 0)
  assert.equal(handoff.requirementsChecked, 2)
  assert.equal(handoff.requirementsUnconfirmed, 0)
  assert.equal(handoff.detail, 'worker detail')
  assert.equal(lines.filter(l => l.startsWith('CONFIRMATION NOT CITED:')).length, 0)
})

test('handoff check: the four accepted citation forms', async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: ['C1', 'C2', 'C3', 'C4'], living: [] }),
    reply: reply([row('C1', 'lib/a.mjs:12'), row('C2', 'lib/a.mjs:12-40'), row('C3', 'lib/a.mjs:12:5'), row('C4', './lib/a.mjs:12')])
  })
  for (const id of ['C1', 'C2', 'C3', 'C4']) assert.equal(byId(handoff, id).status, 'confirmed', id)
  assert.equal(byId(handoff, 'C3').cite, 'lib/a.mjs:12:5')
  assert.equal(byId(handoff, 'C4').cite, './lib/a.mjs:12')
})

test('handoff check: no citation, an invented path, a path outside and a line past the end', async () => {
  const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']
  const { handoff } = await check({
    brief: brief({ scenarios: ids, living: [] }),
    reply: reply([row('C1'), row('C2', 'yes'), row('C3', 'lib/a.mjs'), row('C4', 'lib/nowhere.mjs:1'), row('C5', '../outside.mjs:1'), row('C6', 'lib/a.mjs:9000')])
  })
  const reasons = ids.map(id => byId(handoff, id).reason)
  assert.deepEqual(reasons, ['no citation', 'no citation', 'no citation', 'cited file not found', 'cited file not found', 'cited line not in the file'])
  for (const id of ids) {
    assert.equal(byId(handoff, id).status, 'unconfirmed', id)
    assert.equal(byId(handoff, id).claimed, 'confirmed', id)
  }
})

test('handoff check: the seven reasons, spelled as the design lists them and null on a confirmed row', async () => {
  const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']
  const { handoff } = await check({
    brief: brief({ scenarios: ids, living: [] }),
    reply: reply([
      // C1 has no row
      row('C2', 'lib/a.mjs:1'),
      row('C2', 'lib/a.mjs:2'),
      row('C3', 'lib/a.mjs:1', 'unconfirmed'),
      row('C4'),
      row('C5', 'lib/nowhere.mjs:3'),
      row('C6', 'lib/a.mjs:9000'),
      row('C7', 'openspec/specs/review/settle-loop/spec.md:40'),
      row('C8', 'lib/a.mjs:1')
    ])
  })
  assert.deepEqual(
    ids.map(id => byId(handoff, id).reason),
    [
      'no row',
      'more than one row',
      'not confirmed by the worker',
      'no citation',
      'cited file not found',
      'cited line not in the file',
      "the citation is the requirement's own text",
      null
    ]
  )
})

test('handoff check: a range past the file, line 0 and a backwards range read cited line not in the file', async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: ['C1', 'C2', 'C3', 'C4'], living: [] }),
    reply: reply([row('C1', 'lib/a.mjs:80-200'), row('C2', 'lib/a.mjs:0'), row('C3', 'lib/a.mjs:40-12'), row('C4', 'lib/a.mjs:80-90')])
  })
  for (const id of ['C1', 'C2', 'C3']) {
    assert.equal(byId(handoff, id).status, 'unconfirmed', id)
    assert.equal(byId(handoff, id).reason, 'cited line not in the file', id)
  }
  assert.equal(byId(handoff, 'C4').status, 'confirmed')
})

test('handoff check: the earlier reason is given when two apply', async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: [], living: ['L1'] }),
    reply: reply([row('L1', 'openspec/specs/review/settle-loop/spec.md:9000')])
  })
  assert.equal(byId(handoff, 'L1').reason, 'cited line not in the file')
})

test('handoff check: a status in another case reads not confirmed by the worker and is not named', async () => {
  const { handoff, lines } = await check({
    brief: brief({ scenarios: ['C1'], living: [] }),
    reply: reply([row('C1', 'lib/a.mjs:5', 'Confirmed')])
  })
  const c1 = byId(handoff, 'C1')
  assert.equal(c1.status, 'unconfirmed')
  assert.equal(c1.reason, 'not confirmed by the worker')
  assert.equal(c1.claimed, 'Confirmed')
  assert.equal(lines.filter(l => l.startsWith('CONFIRMATION NOT CITED:')).length, 0)
})

test("handoff check: a citation into the specs or the change's own directory is refused, an archived change is accepted", async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: ['C1', 'C2'], living: ['L1'] }),
    reply: reply([
      row('L1', 'openspec/specs/review/settle-loop/spec.md:40'),
      row('C1', `${DIR}/specs/review/settle-loop/spec.md:10`),
      row('C2', 'openspec/changes/archive/2026-01-01-old/tasks.md:5')
    ])
  })
  assert.equal(byId(handoff, 'L1').reason, "the citation is the requirement's own text")
  assert.equal(byId(handoff, 'C1').reason, "the citation is the requirement's own text")
  assert.equal(byId(handoff, 'C2').status, 'confirmed')
})

test("handoff check: a citation into the specs or the change's own directory in another letter case is still own text", async () => {
  // A case-insensitive file system (the macOS default) opens either spelling as the same file.
  const folded = new Map(Object.entries(FILES).map(([path, n]) => [path.toLowerCase(), n]))
  const { handoff } = await check({
    lineCount: path => folded.get(path.toLowerCase()) ?? null,
    brief: brief({ scenarios: ['C1', 'C2', 'C3'], living: ['L1'] }),
    reply: reply([
      row('L1', 'OpenSpec/specs/review/settle-loop/spec.md:40'),
      row('C1', `${DIR.toUpperCase()}/specs/review/settle-loop/spec.md:10`),
      row('C2', 'OpenSpec/Changes/Archive/2026-01-01-old/tasks.md:5'),
      row('C3', 'LIB/A.mjs:5')
    ])
  })
  assert.equal(byId(handoff, 'L1').reason, "the citation is the requirement's own text")
  assert.equal(byId(handoff, 'C1').reason, "the citation is the requirement's own text")
  assert.equal(byId(handoff, 'C2').status, 'confirmed', 'an archived change in another case is still not own text')
  assert.equal(byId(handoff, 'C3').status, 'confirmed', 'a code file cited in another case still confirms')
})

test('handoff check: a reply with no rows confirms nothing', async () => {
  const r = reply(undefined)
  delete r.rows
  const { handoff } = await check({ brief: brief(), reply: r })
  assert.equal(handoff.rows.length, 5)
  for (const x of handoff.rows) assert.equal(x.reason, 'no row')
  assert.equal(handoff.scenariosChecked, 0)
  assert.equal(handoff.requirementsChecked, 0)
})

test('handoff check: an id with no row, two rows and a row nobody briefed', async () => {
  const { handoff, lines } = await check({
    brief: brief({ scenarios: ['C1', 'C2', 'C3'], living: [] }),
    reply: reply([row('C2', 'lib/a.mjs:1'), row('C2', 'lib/a.mjs:2'), row('C3', 'lib/a.mjs:3'), row('C9', 'lib/a.mjs:4')])
  })
  assert.equal(byId(handoff, 'C1').reason, 'no row')
  assert.equal(byId(handoff, 'C2').reason, 'more than one row')
  assert.equal(handoff.unknownRows.length, 1)
  assert.ok(JSON.stringify(handoff.unknownRows).includes('C9'))
  assert.ok(lines.join('\n').includes('C9'), 'the printed lines name the unknown row')
  assert.equal(handoff.rows.some(r => r.id === 'C9'), false)
  assert.equal(handoff.scenariosChecked, 2)
})

test('handoff check: a mixed reply counts from its rows and names only the refused claim', async () => {
  const { handoff, lines } = await check({
    brief: brief({ scenarios: ['C1', 'C2', 'C3'], living: [] }),
    reply: reply([row('C1', 'lib/a.mjs:12'), row('C2', 'lib/a.mjs:1', 'unconfirmed'), row('C3', 'lib/nowhere.mjs:1')])
  })
  assert.equal(handoff.scenariosChecked, 3)
  assert.equal(handoff.scenariosUnconfirmed, 2)
  const line = lines.find(l => l.startsWith('CONFIRMATION NOT CITED:'))
  assert.ok(line, 'a CONFIRMATION NOT CITED: line is printed')
  assert.ok(line.includes('C3'))
  assert.ok(line.includes('cited file not found'))
  assert.equal(line.includes('C2'), false)
})

test('handoff check: the worker counts are kept under claimed beside the checked counts', async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: ['C1'], living: [] }),
    reply: reply([row('C1')], { scenariosChecked: 1, scenariosUnconfirmed: 0, requirementsChecked: 2, requirementsUnconfirmed: 0 })
  })
  assert.equal(handoff.scenariosUnconfirmed, 1)
  assert.deepEqual(handoff.claimed, { scenariosChecked: 1, scenariosUnconfirmed: 0, requirementsChecked: 2, requirementsUnconfirmed: 0 })
})

test('handoff check: the reply head is copied unchanged, even for another commit', async () => {
  const { handoff } = await check({ brief: brief({ scenarios: ['C1'], living: [] }), reply: reply([row('C1', 'lib/a.mjs:1')], { head: 'other99' }) })
  assert.equal(handoff.head, 'other99')
})

test('handoff check: a living list that was not built gives two zero counts and no requirement row', async () => {
  const { handoff } = await check({
    brief: brief({ scenarios: ['C1'], living: [], livingExtra: { skipped: 'no graph' } }),
    reply: reply([row('C1', 'lib/a.mjs:1')], { requirementsChecked: 2, requirementsUnconfirmed: 1 })
  })
  assert.equal(handoff.requirementsChecked, 0)
  assert.equal(handoff.requirementsUnconfirmed, 0)
  assert.equal(handoff.claimed.requirementsChecked, 2)
  assert.equal(handoff.rows.some(r => r.kind === 'requirement'), false)
})

test('handoff check: living carries skipped, partial and the number left out', async () => {
  const { handoff } = await check({
    brief: brief({
      scenarios: ['C1'],
      living: ['L1'],
      livingExtra: { skipped: null, partial: 'graph is partial', omitted: [{ capability: 'x', heading: 'a' }, { capability: 'x', heading: 'b' }, { capability: 'y', heading: 'c' }] }
    }),
    reply: reply([row('C1', 'lib/a.mjs:1'), row('L1', 'lib/a.mjs:2')])
  })
  assert.deepEqual(handoff.living, { skipped: null, partial: 'graph is partial', omitted: 3 })
})

test('handoff check: the module imports no node: module', () => {
  let source
  try {
    source = readFileSync(MODULE, 'utf8')
  } catch (err) {
    assert.fail(`lib/settle-handoff.mjs could not be read: ${err.message}`)
  }
  const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  assert.deepEqual(specifiers.filter(s => s.startsWith('node:')), [])
})
