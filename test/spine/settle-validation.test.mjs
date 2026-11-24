// `lib/settle-validation.mjs`, the pure renderer behind `interlock settle validation`
// (spec: review/validation-comment), and the bound it keeps.
//
// Written before the module existed (change post-the-proof-beside-the-findings,
// task 1.2). The module is reached through a dynamic import inside a helper, so
// this file loads while the module is missing and each test fails on its own.
//
// The module's surface, which task 2.2 implements and these tests fix. The
// design leaves the export names open for this module, so they are stated here.
//
//   renderValidation(records) -> { text, json }
//     `text` is the comment; `json` is the object `--json` prints, with exactly
//     the keys head, commands, checks, adherence, gaps, visual and cut.
//   renderSummary(records, { unposted }) -> string of the three `--summary` lines
//
// `records` is what the CLI reads from the files, parsed:
//   { head, plan, results, verify, exec, pipeline, handoff, review, coverage, changed }
// `head` is the sha, `plan` plan.json's object, `results` results.json's array,
// `verify` the judged verdict, `exec` the exec record's entries (an array, or
// null when `--exec` was not given), and `pipeline`, `handoff`, `review`,
// `coverage` the optional records (null when not given). `changed` is the
// changed-path list or null. The CLI has already refused a verdict for another
// head, so the renderer never does.
//
// Layout the tests rely on, beyond the headings and the fixed prefixes and marks
// (`RESULT DISAGREES:`, `RE-RUN:`, `CUT:`, `Excluded by the caller:`,
// `session-recorded`, `as the session read them`, `not posted`, `latest`,
// `No gap is recorded in these records.`):
//   - `### Commands run` opens a table whose header cells are Kind, Command,
//     Exit, Duration and a fifth naming `as the session read them`; each step and
//     each skipped kind is one row, the first cell the kind, the third the exit.
//   - A section's first line is the first non-empty line after its heading.
//   - A confirmed or unconfirmed adherence row is a table row opening
//     `| \`<id>\` |`; a gap item, a visual path and a left-out line are list items
//     or lines of their own, one per line.
//   - The line that says a block lost rows holds the number and the words
//     `left out`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS } from '../../lib/limits.mjs'
import { classifySurface } from '../../lib/surface.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE = join(ROOT, 'lib', 'settle-validation.mjs')

/** The renderer, imported when a test asks for it: a missing module fails that test alone. */
const mod = () => import('../../lib/settle-validation.mjs')

const H = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'
const OTHER = 'ffeeddccbbaa99887766ffeeddccbbaa99887766'
const AT = '2026-11-23T08:00:00.000Z'

const HEADINGS = ['Commands run', 'Platform checks', 'Spec adherence', 'What these checks would not catch']
const GAPS = 'What these checks would not catch'
const NO_GAP = 'No gap is recorded in these records.'

// --- fixtures ------------------------------------------------------------------

const stepOf = (kind, command) => ({ id: kind, kind, command, blocking: kind !== 'lint', cwd: '.' })
const skip = (kind, reason) => ({ kind, reason })

function plan({ steps = [stepOf('unit', 'npm test')], skipped, hasProfile = true } = {}) {
  return {
    steps,
    skipped: skipped ?? [
      skip('typecheck', 'no-detectable-command'),
      skip('lint', 'no-detectable-command'),
      skip('coverage', 'coverage-not-configured'),
      skip('e2e', 'e2e-not-requested')
    ],
    hasProfile
  }
}

const UNIT_COUNTS = { total: 4948, passed: 4943, failed: 0, skipped: 5 }
const unitResult = (over = {}) => ({ kind: 'unit', exitCode: 0, ...UNIT_COUNTS, ...over })
const execLine = (over = {}) => ({ kind: 'unit', command: 'npm test', exitCode: 0, durationMs: 102300, at: AT, ...over })

function verdict({ halt = false, reason = null, unit = undefined, head = H, ...rest } = {}) {
  return {
    head,
    halt,
    reason,
    context: 'final',
    haltingKinds: ['unit'],
    unit:
      unit === undefined
        ? { halt, reason: reason || '', status: halt ? 'fail' : 'pass', ran: true, exitCode: 0, counts: { ...UNIT_COUNTS }, clusters: [] }
        : unit,
    e2e: null,
    coverage: null,
    typecheck: null,
    signals: [],
    banners: [],
    skipped: [],
    ...rest
  }
}

function records(over = {}) {
  return {
    head: H,
    plan: plan(),
    results: [unitResult()],
    verify: verdict(),
    exec: [execLine()],
    pipeline: null,
    handoff: null,
    review: null,
    coverage: null,
    changed: null,
    ...over
  }
}

const check = (name, state = 'pass', required = false) => ({ name, state, required })
const pipeline = (checks, over = {}) => ({ sha: H, checks, excluded: [], ...over })

const hrow = (id, kind, over = {}) => ({
  id,
  kind,
  title: `Title ${id}`,
  artifact: 'specs/x/spec.md',
  line: 12,
  claimed: 'confirmed',
  status: 'confirmed',
  cite: `lib/a.mjs:${id.length + 10}`,
  reason: null,
  ...over
})

/** A checked handoff. `rows` replaces the default rows; the counts are worked out from the rows. */
function handoff({ scenarios = 3, requirements = 1, rows, omitted = 0, detail = 'The worker looked at the code.', head = H, ...rest } = {}) {
  const all =
    rows ??
    [
      ...Array.from({ length: scenarios }, (_, i) => hrow(`C${i + 1}`, 'scenario')),
      ...Array.from({ length: requirements }, (_, i) => hrow(`L${i + 1}`, 'requirement'))
    ]
  const count = (kind, status) => all.filter(r => r.kind === kind && (status === undefined || r.status === status)).length
  return {
    ok: true,
    checked: true,
    head,
    detail,
    scenariosChecked: count('scenario'),
    scenariosUnconfirmed: count('scenario', 'unconfirmed'),
    requirementsChecked: count('requirement'),
    requirementsUnconfirmed: count('requirement', 'unconfirmed'),
    claimed: { scenariosChecked: count('scenario'), scenariosUnconfirmed: 0, requirementsChecked: count('requirement'), requirementsUnconfirmed: 0 },
    rows: all,
    living: { skipped: null, partial: null, omitted },
    unknownRows: [],
    ...rest
  }
}

const unconfirmed = (id, kind, reason, over = {}) => hrow(id, kind, { status: 'unconfirmed', reason, cite: null, ...over })

const reviewDims = (over = {}) => ({
  selected: ['language'],
  ran: ['language'],
  skipped: [],
  degraded: [],
  unavailable: [],
  completed: true,
  ...over
})
const proofOf = (over = {}) => ({
  proven: true,
  dimensions: ['language'],
  carried: [],
  unproven: [],
  unread: [],
  uncited: [],
  changed: 1,
  cited: 1,
  ...over
})
const review = ({ head = H, dimensions = reviewDims(), proof = proofOf(), ...rest } = {}) => ({
  head,
  surviving: [],
  counts: {},
  dimensions,
  proof,
  ...rest
})

/** Every record, each one green and for H. */
function full(over = {}) {
  return records({
    pipeline: pipeline([check('build', 'pass', true), check('test (20)', 'pass', true)]),
    handoff: handoff(),
    review: review(),
    coverage: { unreportedFiles: [] },
    changed: ['lib/a.mjs'],
    ...over
  })
}

async function render(recs) {
  const { renderValidation } = await mod()
  return renderValidation(recs)
}
const comment = async recs => (await render(recs)).text
async function summary(recs, opts = {}) {
  const { renderSummary } = await mod()
  return renderSummary(recs, opts)
}
const summaryLines = out => out.replace(/\n+$/, '').split('\n')

// --- reading a comment ------------------------------------------------------------

const linesOf = text => text.replace(/\n+$/, '').split('\n')

/** The lines under each `### ` heading, by heading text. */
function sectionsOf(text) {
  const out = {}
  let current = null
  for (const line of linesOf(text)) {
    if (line.startsWith('### ')) {
      current = line.slice(4).trim()
      out[current] = []
    } else if (current !== null) out[current].push(line)
  }
  return out
}
const headingsOf = text => linesOf(text).filter(l => l.startsWith('### ')).map(l => l.slice(4).trim())
const section = (text, name) => sectionsOf(text)[name] ?? null
const firstLineOf = lines => lines.find(l => l.trim() !== '') ?? ''
const itemsOf = lines => lines.filter(l => l.startsWith('- '))
const cellsOf = line => line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim())
const plain = cell => cell.replace(/`/g, '').trim()
const isTableRow = l => l.startsWith('|') && !/^\|[\s:|-]+\|?$/.test(l)

/** The table row of a kind in the commands section: its first cell is the kind. */
function rowOf(text, kind) {
  const lines = section(text, 'Commands run') ?? []
  return lines.find(l => isTableRow(l) && plain(cellsOf(l)[0] ?? '') === kind) ?? null
}
const exitCellOf = (text, kind) => plain(cellsOf(rowOf(text, kind))[2])
const durationCellOf = (text, kind) => plain(cellsOf(rowOf(text, kind))[3])

/** Each line with the fence it sits in: 0 outside every fence, else the fence's backtick count. */
function scan(text) {
  const out = []
  let open = 0
  for (const line of linesOf(text)) {
    const fence = line.match(/^(`{3,})/)
    if (open === 0) {
      if (fence) {
        open = fence[1].length
        out.push({ line, fence: 0, isFence: true })
        continue
      }
      out.push({ line, fence: 0, isFence: false })
    } else if (fence && fence[1].length >= open && /^`+\s*$/.test(line)) {
      out.push({ line, fence: open, isFence: true })
      open = 0
    } else out.push({ line, fence: open, isFence: false })
  }
  return out
}
/** The lines outside every fence and outside every inline code span. */
const bare = text => scan(text).filter(x => x.fence === 0 && !x.isFence).map(x => x.line.replace(/`[^`\n]*`/g, ''))

const inSpan = (text, token) => new RegExp('`[^`\\n]*' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^`\\n]*`').test(text)

// --- the four sections and their order -----------------------------------------------

test('validation: the first line and the four headings come in order', async () => {
  const text = await comment(records())
  assert.equal(linesOf(text)[0], `## Validation — ${H}`)
  assert.deepEqual(headingsOf(text), HEADINGS)
})

test('validation: the same records give the same bytes, and --json holds seven keys', async () => {
  const recs = full()
  const a = await render(recs)
  const b = await render(structuredClone(recs))
  assert.equal(a.text, b.text)
  assert.deepEqual(a.json, b.json)
  assert.deepEqual(Object.keys(a.json).sort(), ['adherence', 'checks', 'commands', 'cut', 'gaps', 'head', 'visual'])
  assert.equal(a.json.head, H)
  assert.ok(Array.isArray(a.json.cut))
})

test('validation: records holding no verdict word render none, and no label', async () => {
  const text = await comment(full())
  assert.doesNotMatch(text, /MERGE|HUMAN|BLOCK/)
  assert.doesNotMatch(text, /## Merge confidence/)
  assert.doesNotMatch(text, /interlock\//)
})

test('validation: keys named verdict, score, band and labels change nothing', async () => {
  const extra = { verdict: 'HUMAN', score: 9137, band: 'amber', labels: ['interlock/human'] }
  const plainRecs = full()
  const loaded = full()
  loaded.verify = { ...loaded.verify, ...extra }
  loaded.review = { ...loaded.review, ...extra }
  loaded.handoff = { ...loaded.handoff, ...extra }
  const withKeys = await comment(loaded)
  for (const word of ['HUMAN', 'amber', '9137', 'interlock/human']) assert.ok(!withKeys.includes(word), `the output holds ${word}`)
  assert.equal(withKeys, await comment(plainRecs))
})

test('validation: a mention, a link, a closing tag and a command stay text', async () => {
  const mention = '@octocat [x](http://evil.example/p)'
  const title = '</details><!-- x'
  const detail = 'looked at it\n/approve\n```\nand at the rest'
  const recs = full({
    pipeline: pipeline([check(mention, 'pass'), check('@mallory', 'fail', true)]),
    handoff: handoff({ rows: [hrow('C1', 'scenario', { title })], detail })
  })
  const text = await comment(recs)
  assert.ok(text.includes('`' + mention + '`'), 'the check name is not in a code span')
  assert.ok(text.includes('`' + title + '`'), 'the title is not in a code span')
  assert.ok(text.includes('`@mallory`'), 'the failing check name is not in a code span')

  const lines = scan(text)
  const approve = lines.find(x => x.line === '/approve')
  assert.ok(approve, 'the detail is not shown')
  assert.ok(approve.fence >= 4, `the detail sits in a fence of ${approve.fence} backticks, not longer than its own run of three`)
  assert.ok(lines.some(x => x.line === '```' && x.fence >= 4), 'the run of three backticks is not held inside the fence')

  const outside = bare(text)
  for (const line of outside) {
    assert.doesNotMatch(line, /^\s*\/approve/)
    assert.doesNotMatch(line, /@octocat|@mallory|\]\(http|<!--/)
  }
  const count = tag => outside.filter(l => l.includes(tag)).length
  assert.equal(count('<details>'), 2, 'one block for the checks and one for the confirmed rows')
  assert.equal(count('</details>'), 2)
  assert.equal(count('<summary>'), 2)
})

test('validation: a head that is not a sha renders in the heading as a code span, never as a line of its own', async () => {
  const head = `${H}\n## Injected\n<img src=x onerror=alert(1)>`
  const text = await comment(records({ head, verify: verdict({ head }) }))
  const lines = linesOf(text)
  assert.ok(lines[0].startsWith('## Validation — `'), `the heading holds the head as a code span: ${lines[0]}`)
  assert.ok(lines[0].includes(H), 'the head is still shown')
  assert.ok(!lines.some(l => l.startsWith('## Injected')), `no line of the head opens a heading:\n${text}`)
  for (const line of bare(text)) assert.doesNotMatch(line, /<img|onerror/, 'outside a code span no markup of the head survives')
  assert.equal(linesOf(await comment(records({ head: 'abc1234', verify: verdict({ head: 'abc1234' }) })))[0], '## Validation — abc1234', 'a short sha stays plain')
})

// --- ### Commands run -----------------------------------------------------------------

test('validation: a unit step with an exec entry shows the observed exit and the four counts', async () => {
  const text = await comment(records())
  const header = (section(text, 'Commands run') ?? []).find(isTableRow)
  const cells = cellsOf(header)
  assert.deepEqual(cells.slice(0, 4), ['Kind', 'Command', 'Exit', 'Duration'])
  assert.match(cells[4], /as the session read them/)

  const row = rowOf(text, 'unit')
  assert.ok(row, 'no unit row')
  assert.ok(row.includes('`npm test`'))
  assert.equal(exitCellOf(text, 'unit'), '0')
  assert.equal(durationCellOf(text, 'unit'), '1m 42s')
  for (const n of ['4948', '4943']) assert.ok(row.includes(n), `the row lacks ${n}`)
  assert.doesNotMatch(row, /session-recorded/)
})

test('validation: no exec entry gives the session exit, marked, and no duration', async () => {
  for (const exec of [null, [execLine({ command: 'npm run something-else', exitCode: 3 })]]) {
    const text = await comment(records({ exec }))
    assert.match(exitCellOf(text, 'unit'), /^0\b/)
    assert.match(rowOf(text, 'unit'), /session-recorded/)
    assert.equal(durationCellOf(text, 'unit'), 'not recorded')
    const items = itemsOf(section(text, GAPS))
    assert.ok(items.some(i => /session/i.test(i) && i.includes('unit')), 'no gap item says the exit code is the session\'s own')
  }
})

test('validation: a skipped kind reads as not run, with no exit code', async () => {
  const text = await comment(records())
  for (const [kind, reason] of [['typecheck', 'no-detectable-command'], ['e2e', 'e2e-not-requested']]) {
    const row = rowOf(text, kind)
    assert.ok(row, `no row for ${kind}`)
    assert.match(row, /not run/)
    assert.ok(row.includes(reason))
    // No exit code: no digit in the row once the kind's own name (`e2e`) is set aside.
    assert.doesNotMatch(row.replaceAll(kind, ''), /\d/)
  }
  const lines = section(text, 'Commands run').filter(isTableRow)
  const order = lines.map(l => plain(cellsOf(l)[0]))
  assert.equal(order.indexOf('unit'), 1, 'the planned step comes first, after the header')
  assert.ok(order.indexOf('typecheck') > order.indexOf('unit'))
})

test('validation: a step with no results entry reads no result recorded', async () => {
  const recs = records({ plan: plan({ steps: [stepOf('lint', 'npm run lint')], skipped: [] }), results: [], exec: null, verify: verdict({ unit: null }) })
  const text = await comment(recs)
  assert.match(rowOf(text, 'lint'), /no result recorded/)
  assert.ok(itemsOf(section(text, GAPS)).some(i => i.includes('lint')))
})

test('validation: a disagreement names both codes after the table and as a gap item', async () => {
  const text = await comment(records({ results: [unitResult({ exitCode: 0 })], exec: [execLine({ exitCode: 1 })] }))
  assert.equal(exitCellOf(text, 'unit'), '1')
  const lines = section(text, 'Commands run')
  const at = lines.findIndex(l => l.startsWith('RESULT DISAGREES:'))
  assert.ok(at >= 0, 'no RESULT DISAGREES: line')
  assert.ok(at > lines.map(isTableRow).lastIndexOf(true), 'the line does not follow the table')
  assert.match(lines[at], /unit/)
  assert.match(lines[at], /exit 0/)
  assert.match(lines[at], /exit 1/)
  assert.ok(itemsOf(section(text, GAPS)).some(i => i.includes('RESULT DISAGREES:')))
})

test('validation: a halted verification names its reason and failing tests and no failure text', async () => {
  const unit = {
    halt: true,
    reason: 'unit suite red',
    status: 'fail',
    ran: true,
    exitCode: 1,
    counts: { total: 10, passed: 7, failed: 3, skipped: 0 },
    clusters: [{ signature: 's', count: 3, tests: ['test one', 'test two', 'test three'], files: [], representative: 'REPRESENTATIVE-FAILURE-TEXT-ZZZ' }]
  }
  const text = await comment(
    records({ verify: verdict({ halt: true, reason: 'unit suite red', unit }), results: [unitResult({ exitCode: 1 })], exec: [execLine({ exitCode: 1 })] })
  )
  const lines = section(text, 'Commands run')
  const halted = lines.find(l => /halted/i.test(l))
  assert.ok(halted, 'no line says the verification halted')
  assert.ok(halted.includes('`unit suite red`'))
  for (const name of ['test one', 'test two', 'test three']) assert.ok(lines.join('\n').includes('`' + name + '`'), `${name} is not in a code span`)
  assert.ok(!text.includes('REPRESENTATIVE-FAILURE-TEXT-ZZZ'))
})

test('validation: a verification that did not halt says so after the table', async () => {
  const lines = section(await comment(records()), 'Commands run')
  const at = lines.findIndex(l => /no halt/i.test(l))
  assert.ok(at > lines.map(isTableRow).lastIndexOf(true))
  assert.ok(!lines.some(l => /halted/i.test(l)))
})

test('validation: a spill locator is shown and no spilled line is', async () => {
  const text = await comment(records({ results: [unitResult({ locator: 'spill/unit-abc.log', preview: 'SPILLED-LINE-ZZZ' })] }))
  assert.ok(section(text, 'Commands run').join('\n').includes('`spill/unit-abc.log`'))
  assert.ok(!text.includes('SPILLED-LINE-ZZZ'))
})

test('validation: durations of a minute or more read in minutes and seconds', async () => {
  for (const [ms, want] of [[102300, '1m 42s'], [60000, '1m 0s'], [4503000, '75m 3s']]) {
    const text = await comment(records({ exec: [execLine({ durationMs: ms })] }))
    assert.equal(durationCellOf(text, 'unit'), want)
  }
})

test('validation: durations under a minute read with one decimal, cut down', async () => {
  for (const [ms, want] of [[8349, '8.3s'], [59960, '59.9s'], [0, '0.0s']]) {
    const text = await comment(records({ exec: [execLine({ durationMs: ms })] }))
    assert.equal(durationCellOf(text, 'unit'), want)
  }
})

test('validation: a duration the record does not hold reads not recorded and keeps the exit', async () => {
  const bad = [{}, { durationMs: -5 }, { durationMs: 'fast' }]
  for (const over of bad) {
    const entry = execLine(over)
    if (!('durationMs' in over)) delete entry.durationMs
    const text = await comment(records({ exec: [entry] }))
    assert.equal(durationCellOf(text, 'unit'), 'not recorded')
    assert.equal(exitCellOf(text, 'unit'), '0')
    assert.doesNotMatch(rowOf(text, 'unit'), /session-recorded/)
  }
})

test('validation: two runs read as two, and an earlier red one is named', async () => {
  const text = await comment(records({ exec: [execLine({ exitCode: 1 }), execLine({ exitCode: 0 })] }))
  assert.equal(exitCellOf(text, 'unit'), '0')
  assert.match(rowOf(text, 'unit'), /2 runs/)
  const lines = section(text, 'Commands run')
  const at = lines.findIndex(l => l.startsWith('RE-RUN:'))
  assert.ok(at > lines.map(isTableRow).lastIndexOf(true), 'no RE-RUN: line after the table')
  assert.match(lines[at], /unit/)
  assert.match(lines[at], /exited 1/)
  assert.ok(itemsOf(section(text, GAPS)).some(i => i.includes('RE-RUN:')))
  assert.ok(!lines.some(l => l.startsWith('RESULT DISAGREES:')))
})

test('validation: two green runs read as two and name no re-run', async () => {
  const text = await comment(records({ exec: [execLine(), execLine()] }))
  assert.match(rowOf(text, 'unit'), /2 runs/)
  assert.ok(!text.includes('RE-RUN:'))
})

test('validation: a plan with no step shows five kinds not run and says no command ran', async () => {
  const kinds = ['typecheck', 'unit', 'lint', 'coverage', 'e2e']
  const recs = records({
    plan: plan({ steps: [], skipped: kinds.map(k => skip(k, 'no-test-profile')), hasProfile: false }),
    results: [],
    exec: null,
    verify: verdict({ unit: null })
  })
  const text = await comment(recs)
  const lines = section(text, 'Commands run')
  const rows = lines.filter(isTableRow).slice(1)
  assert.equal(rows.length, 5)
  for (const row of rows) assert.match(row, /not run/)
  assert.ok(lines.some(l => /no command ran/i.test(l)))
  const items = itemsOf(section(text, GAPS))
  for (const kind of kinds) assert.ok(items.some(i => i.includes(kind)), `no gap item for ${kind}`)
})

// --- ### Platform checks ---------------------------------------------------------------

test('validation: twelve passing checks are counted and collapsed', async () => {
  const checks = Array.from({ length: 12 }, (_, i) => check(`check-${String(i + 1).padStart(2, '0')}`, i === 11 ? 'skipped' : 'pass', i < 5))
  const lines = section(await comment(records({ pipeline: pipeline(checks) })), 'Platform checks')
  const first = firstLineOf(lines)
  for (const part of ['12 checks', '11 passed', '1 skipped', '5 required']) assert.ok(first.includes(part), `the first line lacks ${part}`)
  const open = lines.indexOf('<details>')
  const close = lines.indexOf('</details>')
  assert.ok(open >= 0 && close > open)
  assert.ok(lines.some(l => l.includes('<summary>12 checks</summary>')))
  for (const { name } of checks) {
    const at = lines.findIndex(l => l.includes(name))
    assert.ok(at > open && at < close, `${name} sits outside the block`)
  }
})

test('validation: a failing required check and a pending one are rows before the block', async () => {
  const checks = [check('test (20)', 'fail', true), check('lint (20)', 'pending'), check('build', 'pass', true)]
  const text = await comment(records({ pipeline: pipeline(checks) }))
  const lines = section(text, 'Platform checks')
  const open = lines.indexOf('<details>')
  const before = lines.slice(0, open)
  const failing = before.find(l => l.includes('`test (20)`'))
  const pending = before.find(l => l.includes('`lint (20)`'))
  assert.ok(failing && pending, 'the two checks are not rows before the block')
  assert.match(failing, /fail/)
  assert.match(failing, /yes|required/i)
  assert.match(pending, /pending/)
  const first = firstLineOf(lines)
  assert.match(first, /1 failed/)
  assert.match(first, /1 pending/)
  const items = itemsOf(section(text, GAPS))
  assert.ok(items.some(i => i.includes('lint (20)')), 'no gap item for the pending check')
  assert.ok(!items.some(i => i.includes('test (20)')), 'a gap item names the failing check')
})

test('validation: a record for another commit names it and lists no check', async () => {
  const text = await comment(records({ pipeline: pipeline([check('secret-check-name')], { sha: OTHER }) }))
  const body = section(text, 'Platform checks').join('\n')
  assert.ok(body.includes(OTHER.slice(0, 7)))
  assert.ok(!text.includes('secret-check-name'))
  assert.ok(itemsOf(section(text, GAPS)).some(i => /platform/i.test(i)))
})

test('validation: no pipeline record and an empty one each say which and add a gap', async () => {
  const none = await comment(records())
  assert.match(section(none, 'Platform checks').join('\n'), /no pipeline/i)
  const empty = await comment(records({ pipeline: pipeline([]) }))
  const body = section(empty, 'Platform checks').join('\n')
  assert.match(body, /no check/i)
  assert.ok(body.includes(H.slice(0, 7)))
  assert.ok(itemsOf(section(empty, GAPS)).some(i => /platform|check/i.test(i)))
})

test('validation: an excluded check is named apart, counted nowhere and listed as a gap', async () => {
  const text = await comment(records({ pipeline: pipeline([check('a'), check('b'), check('c')], { excluded: ['e2e (nightly)'] }) }))
  const lines = section(text, 'Platform checks')
  const first = lines.findIndex(l => l.trim() !== '')
  assert.ok(lines[first].includes('3 checks'))
  const next = lines.slice(first + 1).find(l => l.trim() !== '')
  assert.ok(next.startsWith('Excluded by the caller:'))
  assert.ok(next.includes('`e2e (nightly)`'))
  assert.ok(!lines.filter(isTableRow).some(l => l.includes('e2e (nightly)')), 'a row names it')
  assert.equal(itemsOf(section(text, GAPS)).filter(i => i.includes('e2e (nightly)')).length, 1)
})

test('validation: a record for another commit names no excluded check', async () => {
  const text = await comment(records({ pipeline: pipeline([check('a')], { sha: OTHER, excluded: ['e2e (nightly)'] }) }))
  assert.ok(!text.includes('Excluded by the caller:'))
  assert.ok(!text.includes('e2e (nightly)'))
})

test('validation: nothing excluded prints no excluded line and no item', async () => {
  const withoutKey = pipeline([check('a')])
  delete withoutKey.excluded
  for (const p of [withoutKey, pipeline([check('a')], { excluded: [] })]) {
    const text = await comment(records({ pipeline: p }))
    assert.ok(!text.includes('Excluded by the caller:'))
    assert.ok(!itemsOf(section(text, GAPS)).some(i => /exclud/i.test(i)))
  }
})

// --- ### Spec adherence -------------------------------------------------------------------

test('validation: every scenario and requirement confirmed gives one first line and one block', async () => {
  const lines = section(await comment(records({ handoff: handoff({ scenarios: 29, requirements: 4 }) })), 'Spec adherence')
  const first = firstLineOf(lines)
  assert.ok(first.includes('29 of 29 scenarios'))
  assert.ok(first.includes('4 of 4 living requirements'))
  assert.match(first, /none unconfirmed/)
  const open = lines.indexOf('<details>')
  const close = lines.indexOf('</details>')
  assert.ok(open >= 0 && close > open)
  const rows = lines.filter(l => /^\|\s*`[CL]\d+`/.test(l))
  assert.equal(rows.length, 33)
  for (const row of rows) assert.ok(lines.indexOf(row) > open && lines.indexOf(row) < close, 'a confirmed row sits outside the block')
  const c1 = rows.find(r => r.includes('`C1`'))
  assert.ok(c1.includes('`Title C1`'))
  assert.ok(c1.includes('`lib/a.mjs:12`'))
})

test('validation: unconfirmed rows come first with their reasons', async () => {
  const rows = [
    hrow('C1', 'scenario'),
    unconfirmed('C7', 'scenario', 'not confirmed by the worker'),
    hrow('L1', 'requirement'),
    unconfirmed('L2', 'requirement', 'cited file not found')
  ]
  const lines = section(await comment(records({ handoff: handoff({ rows }) })), 'Spec adherence')
  const open = lines.indexOf('<details>')
  const before = lines.slice(0, open)
  for (const [id, title, reason] of [['C7', 'Title C7', 'not confirmed by the worker'], ['L2', 'Title L2', 'cited file not found']]) {
    const row = before.find(l => l.includes('`' + id + '`'))
    assert.ok(row, `${id} is not a row before the block`)
    assert.ok(row.includes(title))
    assert.ok(row.includes(reason))
  }
  assert.match(firstLineOf(lines), /\b2\b.*unconfirmed|unconfirmed.*\b2\b/)
  assert.ok(!lines.slice(open).some(l => l.includes('`C7`') || l.includes('`L2`')), 'an unconfirmed row sits in the block')
})

test('validation: a handoff the check did not write shows the worker counts, not checked, and no row', async () => {
  const bare5 = { ok: true, head: H, scenariosChecked: 3, scenariosUnconfirmed: 1, requirementsChecked: 2, requirementsUnconfirmed: 0, detail: 'x' }
  const text = await comment(records({ handoff: bare5 }))
  const lines = section(text, 'Spec adherence')
  assert.match(lines.join('\n'), /not checked/)
  assert.ok(!lines.some(l => /^\|\s*`[CL]\d+`/.test(l)))
  assert.ok(!lines.includes('<details>'))
  assert.ok(itemsOf(section(text, GAPS)).some(i => /citation/i.test(i)))
})

test('validation: no confirmation, and one for another commit, each say which and add a gap', async () => {
  const none = await comment(records())
  assert.match(section(none, 'Spec adherence').join('\n'), /no confirmation/i)
  assert.ok(itemsOf(section(none, GAPS)).some(i => /confirmation/i.test(i)))

  const other = await comment(records({ handoff: handoff({ head: OTHER }) }))
  const lines = section(other, 'Spec adherence')
  assert.ok(lines.join('\n').includes(OTHER.slice(0, 7)))
  assert.ok(!lines.some(l => /^\|\s*`[CL]\d+`/.test(l)))
  assert.ok(itemsOf(section(other, GAPS)).some(i => /confirmation/i.test(i)))
})

test('validation: living requirements the size bound left out are in neither total', async () => {
  const left = section(await comment(records({ handoff: handoff({ scenarios: 2, requirements: 4, omitted: 3 }) })), 'Spec adherence')
  const nonEmpty = left.filter(l => l.trim() !== '')
  assert.ok(nonEmpty[0].includes('4 of 4 living requirements'))
  assert.doesNotMatch(nonEmpty[0], /\b7\b/)
  assert.match(nonEmpty[1], /\b3\b/)
  assert.match(nonEmpty[1], /left out/i)

  const none = section(await comment(records({ handoff: handoff({ scenarios: 2, requirements: 4, omitted: 0 }) })), 'Spec adherence')
  assert.ok(!none.some(l => /left out/i.test(l)))
})

test('validation: with no confirmed row the block still holds the detail', async () => {
  const rows = [unconfirmed('C1', 'scenario', 'no citation'), unconfirmed('C2', 'scenario', 'cited file not found')]
  const text = await comment(records({ handoff: handoff({ rows, detail: 'DETAIL-PARAGRAPH-ZZZ' }) }))
  const lines = section(text, 'Spec adherence')
  assert.ok(firstLineOf(lines).includes('0 of 2 scenarios'))
  const open = lines.indexOf('<details>')
  assert.ok(open >= 0)
  assert.ok(lines.some(l => l.includes('<summary>0 confirmed</summary>')))
  assert.ok(lines.slice(0, open).some(l => l.includes('`C1`') && l.includes('no citation')))
  assert.ok(lines.slice(0, open).some(l => l.includes('`C2`') && l.includes('cited file not found')))
  const at = scan(text).find(x => x.line === 'DETAIL-PARAGRAPH-ZZZ')
  assert.ok(at && at.fence >= 3, 'the detail is not inside a fence')
})

test('validation: with no confirmed row and no detail there is no block', async () => {
  const rows = [unconfirmed('C1', 'scenario', 'no citation'), unconfirmed('C2', 'scenario', 'cited file not found')]
  const withDetail = section(await comment(records({ handoff: handoff({ rows, detail: 'DETAIL-PARAGRAPH-ZZZ' }) })), 'Spec adherence')
  const without = section(await comment(records({ handoff: handoff({ rows, detail: '' }) })), 'Spec adherence')
  assert.ok(!without.includes('<details>'))
  const table = ls => ls.filter(l => /^\|\s*`[CL]\d+`/.test(l))
  assert.deepEqual(table(without), table(withDetail))
})

// --- ### What these checks would not catch -------------------------------------------------

test('validation: skipped kinds, then degraded and unavailable dimensions, then unread inputs', async () => {
  const rev = review({
    dimensions: reviewDims({ degraded: [{ name: 'domain', reason: 'text-was-cut' }], unavailable: ['blast-radius'] }),
    proof: proofOf({
      proven: false,
      unread: [{ dimension: 'language', entries: [{ input: 'secret.env', reason: 'not-readable' }, { input: 'big.bin', reason: 'too-large' }] }]
    })
  })
  const lines = section(await comment(records({ review: rev })), GAPS)
  const items = itemsOf(lines)
  const at = pred => items.findIndex(pred)
  const skipped = ['typecheck', 'lint', 'coverage', 'e2e'].map(k => at(i => i.includes(k)))
  assert.ok(skipped.every(i => i >= 0), 'a skipped kind has no item')
  const domain = at(i => i.includes('domain'))
  const blast = at(i => i.includes('blast-radius'))
  const secret = at(i => i.includes('secret.env'))
  const big = at(i => i.includes('big.bin'))
  assert.ok(domain >= 0 && blast >= 0 && secret >= 0 && big >= 0)
  assert.ok(Math.max(...skipped) < domain && domain < blast && blast < Math.min(secret, big))
  assert.ok(inSpan(items[domain], 'text-was-cut'))
  assert.ok(inSpan(items[secret], 'secret.env'))
  assert.ok(inSpan(items[big], 'big.bin'))
  assert.ok(!lines.includes('<details>'))
})

test('validation: with nothing recorded as a gap the section holds one line', async () => {
  const recs = full({ plan: plan({ skipped: [] }), pipeline: pipeline([check('build', 'pass', true)]) })
  const lines = section(await comment(recs), GAPS).filter(l => l.trim() !== '')
  assert.deepEqual(lines, [NO_GAP])
})

test('validation: no review record and one for another commit are told apart', async () => {
  const none = await comment(records())
  assert.ok(itemsOf(section(none, GAPS)).some(i => /no review/i.test(i)))

  const rev = review({
    head: OTHER,
    dimensions: reviewDims({ degraded: [{ name: 'domain', reason: 'another-record-reason' }] }),
    proof: proofOf({ proven: false, unread: [{ dimension: 'language', entries: [{ input: 'another-record.env', reason: 'x' }] }] })
  })
  const other = await comment(records({ review: rev }))
  const items = itemsOf(section(other, GAPS))
  assert.ok(items.some(i => i.includes(OTHER.slice(0, 7))))
  assert.ok(!other.includes('another-record-reason'))
  assert.ok(!other.includes('another-record.env'))
})

test('validation: the confirmation and the coverage record add their items after the pending check', async () => {
  const recs = records({
    pipeline: pipeline([check('lint (20)', 'pending'), check('build')]),
    handoff: handoff({
      rows: [unconfirmed('C1', 'scenario', 'no citation'), unconfirmed('C2', 'scenario', 'no citation'), hrow('L1', 'requirement')],
      omitted: 3
    }),
    coverage: { unreportedFiles: ['lib/x.mjs', 'lib/y.mjs'] }
  })
  const items = itemsOf(section(await comment(recs), GAPS))
  const at = pred => items.findIndex(pred)
  const pending = at(i => i.includes('lint (20)') && !i.includes('skipped'))
  const unconf = at(i => /unconfirmed/i.test(i) && /\b2\b/.test(i))
  const omitted = at(i => /\b3\b/.test(i) && /left out|size bound/i.test(i))
  const files = at(i => i.includes('lib/x.mjs') && i.includes('lib/y.mjs'))
  assert.ok(pending >= 0 && unconf >= 0 && omitted >= 0 && files >= 0, `missing item: ${[pending, unconf, omitted, files]}`)
  assert.ok(pending < unconf && unconf < omitted && omitted < files)
  assert.ok(inSpan(items[files], 'lib/x.mjs') && inSpan(items[files], 'lib/y.mjs'))
})

test('validation: every source at once gives fourteen items in the fixed order', async () => {
  const recs = records({
    plan: plan({ skipped: [skip('typecheck', 'no-detectable-command')] }),
    exec: [execLine({ command: 'npm run another' })],
    pipeline: pipeline([check('pending-check-name', 'pending'), check('build')], { excluded: ['excluded-check-name'] }),
    handoff: handoff({ rows: [unconfirmed('C1', 'scenario', 'no citation'), hrow('L1', 'requirement')], omitted: 2 }),
    review: review({
      dimensions: reviewDims({
        skipped: [{ name: 'security', reason: 'security-reason' }],
        degraded: [{ name: 'domain', reason: 'domain-reason' }],
        unavailable: ['blast-radius']
      }),
      proof: proofOf({
        proven: false,
        unproven: [{ dimension: 'qa', reason: 'qa-reason' }],
        unread: [{ dimension: 'language', entries: [{ input: 'unread-input.env', reason: 'unread-reason' }] }],
        uncited: ['lib/uncited-path.mjs']
      })
    }),
    coverage: { unreportedFiles: ['lib/unlisted-file.mjs'] },
    changed: null
  })
  const items = itemsOf(section(await comment(recs), GAPS))
  assert.equal(items.length, 14, items.join('\n'))
  const expected = [
    i => i.includes('typecheck'),
    i => /session/i.test(i) && i.includes('unit'),
    i => i.includes('pending-check-name') && inSpan(i, 'pending-check-name'),
    i => i.includes('excluded-check-name') && inSpan(i, 'excluded-check-name'),
    i => /unconfirmed/i.test(i),
    i => /\b2\b/.test(i) && /left out|size bound/i.test(i),
    i => i.includes('security') && inSpan(i, 'security-reason'),
    i => i.includes('domain') && inSpan(i, 'domain-reason'),
    i => i.includes('blast-radius'),
    i => i.includes('qa') && inSpan(i, 'qa-reason'),
    i => inSpan(i, 'unread-input.env') && inSpan(i, 'unread-reason'),
    i => inSpan(i, 'lib/uncited-path.mjs'),
    i => inSpan(i, 'lib/unlisted-file.mjs'),
    i => /changed-path list/i.test(i)
  ]
  expected.forEach((pred, n) => assert.ok(pred(items[n]), `item ${n + 1} is out of order or wrong: ${items[n]}`))
})

// --- ### Visual check owed ------------------------------------------------------------------

test('validation: a component and a style file are listed, a route handler and a document are not', async () => {
  const changed = ['src/components/Button.tsx', './src/styles/form.css', 'app/api/login/route.ts', 'docs/readme.md']
  const text = await comment(records({ changed }))
  assert.equal(headingsOf(text).at(-1), 'Visual check owed')
  const lines = section(text, 'Visual check owed')
  const body = lines.join('\n')
  assert.ok(body.includes('`src/components/Button.tsx`'))
  assert.ok(body.includes('`src/styles/form.css`'))
  assert.match(firstLineOf(lines), /\b2\b/)
  assert.match(body, /\b1\b.*indirect|indirect.*\b1\b/i)
  assert.match(body, /looked/i)
  assert.match(body, /image/i)
  assert.ok(!text.includes('app/api/login/route.ts'))
  assert.ok(!text.includes('docs/readme.md'))
})

test('validation: with no UI-testable path there is no visual section and no screen item', async () => {
  const text = await comment(records({ changed: ['docs/readme.md', 'lib/a.mjs', 'test/a.test.mjs'] }))
  assert.ok(!headingsOf(text).includes('Visual check owed'))
  assert.ok(!itemsOf(section(text, GAPS)).some(i => /screen/i.test(i)))
})

test('validation: with no changed-path list there is no visual section and one gap item', async () => {
  const text = await comment(records())
  assert.ok(!headingsOf(text).includes('Visual check owed'))
  const items = itemsOf(section(text, GAPS)).filter(i => /changed-path list/i.test(i))
  assert.equal(items.length, 1)
  assert.match(items[0], /screen/i)
})

test('validation: the classes are the surface classifier\'s own', async () => {
  const changed = ['src/components/Button.tsx', 'tests/components/Button.tsx', 'app/page.tsx', 'tailwind.config.js', 'src/hooks/useForm.ts']
  const classed = classifySurface(changed)
  const expected = classed.files.filter(f => f.class === 'UI-TESTABLE').map(f => f.path)
  assert.ok(expected.length > 0 && classed.indirectCount > 0, 'the fixture must hold both classes')
  const { text, json } = await render(records({ changed }))
  assert.deepEqual([...json.visual.paths].sort(), [...expected].sort())
  assert.equal(json.visual.indirectCount, classed.indirectCount)
  const body = section(text, 'Visual check owed').join('\n')
  for (const path of expected) assert.ok(body.includes('`' + path + '`'), `${path} is not listed`)
  assert.ok(!body.includes('tests/components/Button.tsx'))
})

// --- --summary --------------------------------------------------------------------------------

test('validation: the summary is three lines, the first with the command, exit and counts', async () => {
  const out = await summary(records(), {})
  const lines = summaryLines(out)
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('- Ran:'))
  assert.ok(lines[0].includes('`npm test`'))
  assert.match(lines[0], /exit `?0\b/)
  assert.ok(lines[0].includes('4948'))
  assert.doesNotMatch(lines[0], /session-recorded|halted/)
  assert.ok(lines[1].startsWith('- Not run:'))
  for (const kind of ['typecheck', 'lint', 'coverage', 'e2e']) assert.ok(lines[1].includes(kind))
  assert.ok(lines[2].startsWith('- Proof:'))
  assert.ok(lines[2].includes(H))
  assert.ok(lines[2].includes('latest'))
  assert.ok(!lines.some(l => l.startsWith('#') || l.startsWith('|')))
})

test('validation: a halted verification reads halted on the first line', async () => {
  const recs = records({ verify: verdict({ halt: true, reason: 'unit suite red' }), results: [unitResult({ exitCode: 1 })], exec: [execLine({ exitCode: 1 })] })
  const lines = summaryLines(await summary(recs, {}))
  assert.equal(lines.length, 3)
  assert.match(lines[0], /exit `?1\b/)
  assert.match(lines[0], /halted/)
})

test('validation: a plan with no step says no command ran and names the five kinds', async () => {
  const kinds = ['typecheck', 'unit', 'lint', 'coverage', 'e2e']
  const recs = records({
    plan: plan({ steps: [], skipped: kinds.map(k => skip(k, 'no-test-profile')), hasProfile: false }),
    results: [],
    exec: null,
    verify: verdict({ unit: null })
  })
  const lines = summaryLines(await summary(recs, {}))
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '- Ran: no command ran')
  for (const kind of kinds) assert.ok(lines[1].includes(kind))
})

test('validation: a plan that skipped nothing reads nothing skipped', async () => {
  const lines = summaryLines(await summary(records({ plan: plan({ skipped: [] }) }), {}))
  assert.equal(lines.length, 3)
  assert.equal(lines[1], '- Not run: nothing skipped')
})

test('validation: an unposted summary says not posted for the sha and never latest', async () => {
  const lines = summaryLines(await summary(records(), { unposted: true }))
  assert.equal(lines.length, 3)
  assert.ok(lines[2].startsWith('- Proof:'))
  assert.ok(lines[2].includes('not posted'))
  assert.ok(lines[2].includes(H))
  assert.ok(!lines[2].includes('latest'))
  const posted = summaryLines(await summary(records(), {}))
  assert.ok(!posted[2].includes('not posted'))
})

// --- the summary's exit codes are the comment's -----------------------------------------------------

test('validation: the summary and the comment show the same code, with no mark', async () => {
  const recs = records({ verify: verdict({ unit: { ...verdict().unit, exitCode: 77 } }) })
  const text = await comment(recs)
  const line = summaryLines(await summary(recs, {}))[0]
  assert.equal(exitCellOf(text, 'unit'), '0')
  assert.match(line, /exit `?0\b/)
  for (const out of [text, line]) assert.doesNotMatch(out, /session-recorded|RESULT DISAGREES:/)
  for (const out of [text, line]) assert.doesNotMatch(out, /\b77\b/, 'the verdict\'s own copy of the exit code is shown')
})

test('validation: a disagreement carries the mark and both codes in the summary too', async () => {
  const recs = records({ results: [unitResult({ exitCode: 0 })], exec: [execLine({ exitCode: 1 })], verify: verdict({ unit: { ...verdict().unit, exitCode: 0 } }) })
  const lines = summaryLines(await summary(recs, {}))
  assert.equal(lines.length, 3)
  assert.match(lines[0], /exit `?1\b/)
  assert.ok(lines[0].includes('RESULT DISAGREES:'))
  assert.match(lines[0], /exit 0/)
  assert.match(lines[0], /exit 1/)
})

test('validation: with no exec record the summary marks the session\'s exit code', async () => {
  const lines = summaryLines(await summary(records({ exec: null }), {}))
  assert.match(lines[0], /exit `?0\b/)
  assert.match(lines[0], /session-recorded/)
  assert.doesNotMatch(lines[0], /RESULT DISAGREES:/)
})

// --- purity -------------------------------------------------------------------------------------------

test('validation: the renderer imports no node: module', () => {
  const source = readFileSync(MODULE, 'utf8')
  const imports = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?(?:from\s*)?['"]([^'"]+)['"]/g)].map(m => m[1])
  const dynamic = [...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  for (const name of [...imports, ...dynamic]) assert.ok(!name.startsWith('node:'), `imports ${name}`)
  assert.doesNotMatch(source, /require\(\s*['"]node:/)
})

// --- the bound -------------------------------------------------------------------------------------------

const BOUND = () => LIMITS.maxValidationCommentChars
const rowsHeld = lines => lines.filter(l => /^\|\s*`C\d+`/.test(l))
const leftOut = lines => {
  const line = lines.find(l => /left out/i.test(l) && /\d/.test(l))
  return line ? Number(line.match(/\d+/)[0]) : null
}

function bigHandoff(n = 600) {
  const rows = Array.from({ length: n }, (_, i) =>
    hrow(`C${i + 1}`, 'scenario', { title: `Scenario number ${i + 1} with a deliberately long title to pad the row out`, cite: `lib/module-${i + 1}.mjs:${i + 1}-${i + 31}` })
  )
  return handoff({ rows })
}

test('validation bound: the bound is a published number', () => {
  assert.ok(Number.isInteger(BOUND()) && BOUND() > 0, `LIMITS.maxValidationCommentChars is ${BOUND()}`)
})

test('validation bound: a comment under the bound carries no cut line and an empty cut', async () => {
  const { text, json } = await render(full())
  assert.ok(text.length < BOUND())
  assert.ok(!linesOf(text).some(l => l.startsWith('CUT:')))
  assert.deepEqual(json.cut, [])
})

test('validation bound: six hundred confirmed rows are cut, counted and named', async () => {
  const small = await render(records({ handoff: bigHandoff(3) }))
  const { text, json } = await render(records({ handoff: bigHandoff(600) }))
  assert.ok(text.length <= BOUND(), `${text.length} chars pass the bound of ${BOUND()}`)
  const lines = section(text, 'Spec adherence')
  assert.ok(firstLineOf(lines).includes('600 of 600 scenarios'))
  const kept = rowsHeld(lines)
  const gone = leftOut(lines)
  assert.ok(gone > 0 && kept.length > 0 && kept.length + gone === 600, `${kept.length} kept and ${gone} left out`)
  assert.deepEqual(kept.map(l => plain(cellsOf(l)[0])), kept.map((_, i) => `C${i + 1}`), 'rows are not dropped last first')
  const last = linesOf(text).at(-1)
  assert.ok(last.startsWith('CUT:'))
  assert.ok(last.includes(String(gone)))
  assert.match(last, /confirmed/i)
  assert.ok(json.cut.length >= 1 && JSON.stringify(json.cut).includes(String(gone)))
  assert.doesNotMatch(last, /gap/i)

  const baseline = itemsOf(section(small.text, GAPS))
  assert.ok(baseline.length >= 5, 'the fixture needs five gap items')
  assert.deepEqual(itemsOf(section(text, GAPS)), baseline, 'a gap item was cut or changed')
})

test('validation bound: the commands table and the halt line survive the cut', async () => {
  const { text } = await render(records({ handoff: bigHandoff(600) }))
  assert.ok(text.length <= BOUND())
  assert.equal(linesOf(text)[0], `## Validation — ${H}`)
  assert.deepEqual(headingsOf(text), HEADINGS)
  const lines = section(text, 'Commands run')
  assert.equal(lines.filter(isTableRow).slice(1).length, 5)
  assert.ok(lines.findIndex(l => /no halt/i.test(l)) > lines.map(isTableRow).lastIndexOf(true))
})

test('validation bound: a long list of UI paths is cut and counted', async () => {
  const bound = BOUND()
  assert.ok(Number.isInteger(bound))
  const sample = i => `src/components/section-${i}/WidgetWithAReasonablyLongNameNumber${i}.tsx`
  const total = Math.ceil((2 * bound) / sample(1000).length) + 10
  const changed = Array.from({ length: total }, (_, i) => sample(i))
  const { text, json } = await render(records({ changed }))
  assert.ok(text.length <= bound, `${text.length} chars pass the bound of ${bound}`)
  assert.equal(json.visual.count, total)
  const lines = section(text, 'Visual check owed')
  assert.ok(firstLineOf(lines).includes(String(total)))
  const listed = lines.filter(l => l.startsWith('- ') && l.includes('src/components/section-'))
  const gone = leftOut(lines)
  assert.ok(gone > 0 && listed.length + gone === total, `${listed.length} listed and ${gone} left out of ${total}`)
  const last = linesOf(text).at(-1)
  assert.ok(last.startsWith('CUT:'))
  assert.match(last, /visual/i)
  assert.ok(last.includes(String(gone)))
})

test('validation bound: gap items that alone pass the bound are cut last and counted', async () => {
  const unread = Array.from({ length: 80 }, (_, d) => ({
    dimension: `dimension-${d}`,
    entries: Array.from({ length: 6 }, (_, e) => ({ input: `inputs/file-${d}-${e}.txt`, reason: `a reason that is long enough to fill the line for input ${d} ${e} ${'x'.repeat(120)}` }))
  }))
  const recs = records({
    results: [unitResult({ exitCode: 0 })],
    exec: [execLine({ exitCode: 1 })],
    review: review({ proof: proofOf({ proven: false, unread }) })
  })
  const { text } = await render(recs)
  assert.ok(text.length <= BOUND(), `${text.length} chars pass the bound of ${BOUND()}`)
  const gaps = section(text, GAPS)
  const gone = leftOut(gaps)
  assert.ok(gone > 0, 'the gap section does not say how many items it lost')
  assert.ok(itemsOf(gaps).length > 0)
  const last = linesOf(text).at(-1)
  assert.ok(last.startsWith('CUT:'))
  assert.match(last, /gap/i)
  assert.ok(last.includes(String(gone)))
  const commands = section(text, 'Commands run')
  assert.ok(commands.some(l => l.startsWith('RESULT DISAGREES:')), 'the line after the table was cut')
  assert.deepEqual(headingsOf(text), HEADINGS)
})
