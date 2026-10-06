// The session start's report file, as the hooks module reads it (spec:
// hooks/ship-meter, hooks/session-preflight).
//
// `lib/preflight-file.mjs` is the one place the file's shape, the band's lines,
// the panes' lines, the hide rule and the card clamp are written down. The
// hooks module imports it and formats nothing of its own, so every text the
// band and the panes draw is pinned here under Node, and drawn under the kit by
// test/mod/session-start.test.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS } from '../../lib/limits.mjs'
import {
  HANDOFF_PANE_CHARS,
  PREFLIGHT_FILE,
  PREFLIGHT_SCHEMA,
  adoptPreflight,
  bandLines,
  buildPreflightReport,
  cardLine,
  clampCard,
  freshStart,
  noCardText,
  noReportText,
  orderCards,
  preflightFilePath,
  preflightPaneLines,
  readPreflightReport,
  shouldDraw
} from '../../lib/preflight-file.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const BANNER =
  'PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify — no resume card was written; interlock run-log show r-1'

/** An all-ok report: the doctor ran and parsed, every check ok or skip, no note, no card. */
const allOk = (over = {}) =>
  buildPreflightReport({
    writtenAt: '2026-10-07T08:00:00.000Z',
    source: 'startup',
    root: '/repo',
    stateHome: '/repo',
    surface: 'main',
    message: 'interlock preflight OK.',
    doctor: {
      ran: true,
      parsed: true,
      ok: true,
      counts: { ok: 2, warn: 0, fail: 0, skip: 1 },
      checks: [
        { id: 'node', status: 'ok', detail: 'node 22', fix: null },
        { id: 'graph', status: 'skip', detail: 'no graph built' }
      ]
    },
    ...over
  })

const check = (status, id, detail, fix = null) => ({ id, status, detail, fix })
const card = (path, writtenAt, change = 'add-foo', runId = 'r-1') => ({ path, change, runId, writtenAt })

test('the file is .claude/ship/preflight.json, stamped interlock.preflight/1', () => {
  assert.equal(PREFLIGHT_SCHEMA, 'interlock.preflight/1')
  assert.equal(PREFLIGHT_FILE, '.claude/ship/preflight.json')
  assert.equal(HANDOFF_PANE_CHARS, LIMITS.handoffPaneChars)
})

test('preflightFilePath joins the working root, strips one trailing slash, and falls back to the relative path', () => {
  assert.equal(preflightFilePath('/repo'), '/repo/.claude/ship/preflight.json')
  assert.equal(preflightFilePath('/repo/'), '/repo/.claude/ship/preflight.json')
  assert.equal(preflightFilePath('/'), '/.claude/ship/preflight.json')
  assert.equal(preflightFilePath(undefined), '.claude/ship/preflight.json')
  assert.equal(preflightFilePath(7), '.claude/ship/preflight.json')
  assert.equal(preflightFilePath(''), '.claude/ship/preflight.json')
})

test('buildPreflightReport fills every absence with null or [] and never omits a field', () => {
  const r = buildPreflightReport({})
  assert.deepEqual(r, {
    schema: 'interlock.preflight/1',
    writtenAt: null,
    source: null,
    root: null,
    stateHome: null,
    surface: null,
    message: null,
    doctor: { ran: false, parsed: false, ok: null, counts: null, checks: [] },
    notes: { spoken: [], unreadable: [] },
    cards: { listed: [], archived: 0, unreadable: [], lookedIn: [] }
  })
  assert.deepEqual(buildPreflightReport(undefined), r)
})

test('buildPreflightReport keeps every given field and drops evidence and unknown sources', () => {
  const input = {
    writtenAt: '2026-10-07T08:00:00.000Z',
    source: 'clear',
    root: '/repo',
    stateHome: '/home',
    surface: 'linked-worktree',
    message: 'interlock preflight OK (1 warning).',
    doctor: {
      ran: true,
      parsed: true,
      ok: true,
      counts: { ok: 3, warn: 1, fail: 0, skip: 0 },
      checks: [{ id: 'openspec', status: 'warn', detail: 'old cli', fix: 'npm i -g openspec', evidence: ['x'] }]
    },
    notes: {
      spoken: [{ runId: 'r-1', change: 'add-foo', stage: 'verify', banner: BANNER, marked: true, marks: [{ root: '/home', marked: true, reason: null }] }],
      unreadable: [{ file: '.claude/ship/interrupted/bad.json', reason: 'Unexpected token' }]
    },
    cards: {
      listed: [card('/home/.claude/handoff/ship-add-foo-r-1.md', '2026-10-06T10:00:00.000Z')],
      archived: 2,
      unreadable: [{ path: '/home/.claude/handoff/ship-x-y.md', reason: 'no stamp' }],
      lookedIn: ['/home/.claude/handoff', '/repo/.claude/handoff']
    }
  }
  const r = buildPreflightReport(input)
  assert.equal(r.writtenAt, input.writtenAt)
  assert.equal(r.source, 'clear')
  assert.equal(r.root, '/repo')
  assert.equal(r.stateHome, '/home')
  assert.equal(r.surface, 'linked-worktree')
  assert.equal(r.message, input.message)
  assert.deepEqual(r.doctor.counts, input.doctor.counts)
  assert.deepEqual(r.doctor.checks, [{ id: 'openspec', status: 'warn', detail: 'old cli', fix: 'npm i -g openspec' }])
  assert.deepEqual(r.notes, input.notes)
  assert.deepEqual(r.cards, input.cards)
  assert.equal(buildPreflightReport({ source: 'reboot' }).source, null)
  assert.equal(buildPreflightReport({ doctor: { checks: [{ id: 'x', status: 'ok', detail: 'y' }] } }).doctor.checks[0].fix, null)
})

test('readPreflightReport names each of its four problems and accepts the builder\'s output', () => {
  assert.match(readPreflightReport(undefined).problem, /not text/)
  assert.match(readPreflightReport('{ nope').problem, /not JSON/)
  assert.match(readPreflightReport('[1]').problem, /not an object/)
  assert.match(readPreflightReport('"x"').problem, /not an object/)
  assert.match(readPreflightReport(JSON.stringify({ schema: 'interlock.other/1' })).problem, /interlock\.other\/1.*interlock\.preflight\/1/)
  const report = allOk()
  const read = readPreflightReport(JSON.stringify(report, null, 2) + '\n')
  assert.equal(read.problem, undefined)
  assert.deepEqual(read.report, report)
})

test('an all-ok report draws nothing', () => {
  assert.equal(shouldDraw(allOk()), false)
  assert.deepEqual(bandLines(allOk()), [])
})

test('each trigger alone draws the band, in the doctor\'s, the hook\'s and the card\'s own words', () => {
  const written = 'preflight written 2026-10-07T08:00:00.000Z · /interlock-preflight'
  const fail = allOk({
    message: 'interlock preflight found issues that can stall an unattended ship run:\n  [FAIL] permissions: not allowlisted',
    doctor: { ran: true, parsed: true, ok: false, counts: { ok: 1, warn: 0, fail: 1, skip: 0 }, checks: [check('ok', 'node', 'fine'), check('fail', 'permissions', 'not allowlisted', 'add it')] }
  })
  assert.deepEqual(bandLines(fail), [
    'interlock preflight found issues that can stall an unattended ship run:',
    'fail permissions: not allowlisted',
    written
  ])

  const warn = allOk({
    message: 'interlock preflight OK (1 warning).',
    doctor: { ran: true, parsed: true, ok: true, counts: { ok: 1, warn: 1, fail: 0, skip: 0 }, checks: [check('warn', 'openspec', 'old cli')] }
  })
  assert.deepEqual(bandLines(warn), ['interlock preflight OK (1 warning).', 'warn openspec: old cli', written])

  const notRun = allOk({ message: 'interlock preflight could not run: ENOENT\nmore', doctor: { ran: false, parsed: false } })
  assert.equal(shouldDraw(notRun), true)
  assert.deepEqual(bandLines(notRun), ['interlock preflight could not run: ENOENT', written])

  const notParsed = allOk({ message: 'interlock preflight ran but its output could not be parsed; skipping.', doctor: { ran: true, parsed: false } })
  assert.deepEqual(bandLines(notParsed), ['interlock preflight ran but its output could not be parsed; skipping.', written])

  const note = allOk({ notes: { spoken: [{ runId: 'r-1', change: 'add-foo', stage: 'verify', banner: BANNER, marked: true, marks: [] }], unreadable: [] } })
  assert.deepEqual(bandLines(note), ['interlock preflight OK.', BANNER, written])

  const carded = allOk({ cards: { listed: [card('/repo/.claude/handoff/ship-add-foo-r-1.md', '2026-10-06T10:00:00.000Z')], archived: 0, unreadable: [], lookedIn: [] } })
  assert.deepEqual(bandLines(carded), [
    'interlock preflight OK.',
    '/repo/.claude/handoff/ship-add-foo-r-1.md · add-foo · run r-1 · written 2026-10-06T10:00:00.000Z — /interlock-handoff',
    written
  ])
})

test('the band orders its lines: message, checks, notes, cards, then the written line', () => {
  const r = allOk({
    message: 'm',
    doctor: { ran: true, parsed: true, ok: false, counts: null, checks: [check('warn', 'a', 'da'), check('fail', 'b', 'db')] },
    notes: { spoken: [{ runId: 'r-1', banner: BANNER, marked: true, marks: [] }], unreadable: [] },
    cards: { listed: [card('/c1', '2026-10-01T00:00:00.000Z'), card('/c2', '2026-10-02T00:00:00.000Z', 'add-bar', 'r-2')], archived: 0, unreadable: [], lookedIn: [] }
  })
  const lines = bandLines(r)
  assert.deepEqual(lines.slice(0, 4), ['m', 'warn a: da', 'fail b: db', BANNER])
  assert.match(lines[4], /^\/c2 · add-bar · run r-2/, 'newest card first')
  assert.match(lines[5], /^\/c1 · add-foo · run r-1/)
  assert.match(lines[6], /^preflight written /)
})

test('the preflight pane carries the message, every check with its fix lines, the notes with their marks, and the cards', () => {
  const r = allOk({
    message: 'interlock preflight found issues that can stall an unattended ship run:\n  [FAIL] permissions: x',
    doctor: {
      ran: true,
      parsed: true,
      ok: false,
      counts: null,
      checks: [check('fail', 'permissions', 'not allowlisted', 'add the rule\n  then restart'), check('ok', 'node', 'node 22')]
    },
    notes: {
      spoken: [
        { runId: 'r-1', banner: BANNER, marked: true, marks: [{ root: '/home', marked: true, reason: null }] },
        { runId: 'r-2', banner: 'B2', marked: false, marks: [{ root: '/repo', marked: false, reason: '/repo/x: EACCES' }] }
      ],
      unreadable: [{ file: '.claude/ship/interrupted/bad.json', reason: 'Unexpected token' }]
    },
    cards: {
      listed: [card('/home/.claude/handoff/ship-add-foo-r-1.md', '2026-10-06T10:00:00.000Z')],
      archived: 2,
      unreadable: [{ path: '/home/.claude/handoff/ship-x-y.md', reason: 'no stamp' }],
      lookedIn: ['/home/.claude/handoff']
    }
  })
  const lines = preflightPaneLines(r)
  const text = lines.join('\n')
  assert.ok(lines.includes('interlock preflight found issues that can stall an unattended ship run:'))
  assert.ok(lines.includes('  [FAIL] permissions: x'), 'the message verbatim, every line')
  assert.ok(lines.includes('fail permissions: not allowlisted'))
  assert.ok(lines.includes('     fix: add the rule'))
  assert.ok(lines.includes('          then restart'), 'the fix continuation, indented as the hook prints it')
  assert.ok(lines.includes('ok node: node 22'))
  assert.ok(lines.includes(BANNER))
  assert.match(text, /marked · \/home/)
  assert.match(text, /not marked: \/repo\/x: EACCES/)
  assert.match(text, /\.claude\/ship\/interrupted\/bad\.json: Unexpected token/)
  assert.ok(lines.includes(cardLine(r.cards.listed[0])))
  assert.ok(lines.includes('2 card(s) of archived changes not listed'))
  assert.match(text, /ship-x-y\.md: no stamp/)
  assert.match(text, /looked in: \/home\/\.claude\/handoff/)
  assert.ok(lines.every(l => typeof l === 'string' && l.length > 0), 'no empty line reaches a Text')
})

test('noReportText names the path and the reason, and the not-yet-read case', () => {
  assert.equal(
    noReportText('/repo/.claude/ship/preflight.json', 'ENOENT'),
    'no preflight report is held for this session start: /repo/.claude/ship/preflight.json: ENOENT'
  )
  assert.match(noReportText('/repo/.claude/ship/preflight.json', null), /preflight\.json: not read yet/)
})

test('orderCards puts the newest written card first and keeps equal times in their order', () => {
  const r = allOk({
    cards: {
      listed: [card('/a', '2026-10-01T00:00:00.000Z'), card('/b', '2026-10-03T00:00:00.000Z'), card('/c', '2026-10-01T00:00:00.000Z'), card('/d', null)],
      archived: 0,
      unreadable: [],
      lookedIn: []
    }
  })
  assert.deepEqual(orderCards(r).map(c => c.path), ['/b', '/a', '/c', '/d'])
  assert.deepEqual(r.cards.listed.map(c => c.path), ['/a', '/b', '/c', '/d'], 'the report is not reordered in place')
})

test('noCardText says no card is on disk and names every directory looked in', () => {
  const r = allOk({ cards: { listed: [], archived: 1, unreadable: [], lookedIn: ['/home/.claude/handoff', '/repo/.claude/handoff'] } })
  assert.deepEqual(noCardText(r), [
    'no halt resume card is on disk for an open change',
    'looked in: /home/.claude/handoff',
    'looked in: /repo/.claude/handoff'
  ])
})

test('clampCard returns a card within the cap untouched', () => {
  assert.deepEqual(clampCard('# Ship halted — x\n\tbody', '/p'), { text: '# Ship halted — x\n\tbody', cut: 0 })
})

test('clampCard cuts a long card to the cap with a note naming the count and the path', () => {
  const path = '/repo/.claude/handoff/ship-add-foo-r-1.md'
  const long = 'x'.repeat(LIMITS.handoffPaneChars + 500)
  const { text, cut } = clampCard(long, path)
  assert.ok(text.length <= LIMITS.handoffPaneChars, `${text.length} > ${LIMITS.handoffPaneChars}`)
  assert.ok(cut > 500)
  assert.ok(text.endsWith(`_… ${cut} characters left out; the whole card is ${path}_`), text.slice(-120))
  assert.equal(text.slice(0, text.indexOf('\n\n_…')), long.slice(0, long.length - cut), 'the kept text is the card\'s own head')
  const small = clampCard('abcdefghij', '/p', 5 + '\n\n_… 99 characters left out; the whole card is /p_'.length)
  assert.ok(small.text.length <= 5 + '\n\n_… 99 characters left out; the whole card is /p_'.length)
})

test('clampCard replaces every control character but tab and newline with a space', () => {
  assert.deepEqual(clampCard('a\u0000b\rc\td\ne\u001bf\u007fg', '/p'), { text: 'a b c\td\ne f g', cut: 0 })
})

test('adoptPreflight holds a first report, and a re-read of the same report changes nothing', () => {
  const r = allOk()
  const first = adoptPreflight(freshStart(), { report: r }, '/repo/.claude/ship/preflight.json')
  assert.equal(first.changed, true)
  assert.equal(first.log, null)
  assert.deepEqual(first.start, { report: r, path: '/repo/.claude/ship/preflight.json', problem: null, hidden: false, named: false })
  const hidden = { ...first.start, hidden: true }
  const again = adoptPreflight(hidden, { report: allOk() }, '/repo/.claude/ship/preflight.json')
  assert.equal(again.changed, false)
  assert.equal(again.start, hidden, 'the same report keeps the band as it was, hide flag and all')
})

test('adoptPreflight shows a new startup, resume or clear report again, and keeps a compact one hidden', () => {
  const held = { ...adoptPreflight(freshStart(), { report: allOk() }, '/p').start, hidden: true }
  for (const source of ['startup', 'resume', 'clear', null]) {
    const next = adoptPreflight(held, { report: allOk({ writtenAt: '2026-10-07T09:00:00.000Z', source }) }, '/p')
    assert.equal(next.changed, true)
    assert.equal(next.start.hidden, false, `${source}: a new session start shows its band`)
  }
  const compact = adoptPreflight(held, { report: allOk({ writtenAt: '2026-10-07T09:00:00.000Z', source: 'compact' }) }, '/p')
  assert.equal(compact.start.hidden, true, 'a compaction is the same session')
  assert.equal(compact.start.report.source, 'compact')
  const first = adoptPreflight({ ...freshStart(), hidden: true }, { report: allOk({ source: 'compact' }) }, '/p')
  assert.equal(first.start.hidden, false, 'with no report held there is nothing a compaction continues')
})

test('adoptPreflight drops a held report on a problem and names the problem once until a report is held again', () => {
  const held = adoptPreflight(freshStart(), { report: allOk() }, '/p').start
  const gone = adoptPreflight(held, { problem: 'ENOENT' }, '/p')
  assert.equal(gone.changed, true)
  assert.equal(gone.start.report, null)
  assert.equal(gone.start.problem, 'ENOENT')
  assert.equal(gone.log, 'interlock meter: no preflight report at /p: ENOENT')
  const again = adoptPreflight(gone.start, { problem: 'ENOENT' }, '/p')
  assert.equal(again.log, null, 'named once')
  assert.equal(again.changed, false)
  const back = adoptPreflight(again.start, { report: allOk({ writtenAt: '2026-10-07T10:00:00.000Z' }) }, '/p')
  assert.equal(back.start.named, false)
  assert.match(adoptPreflight(back.start, { problem: 'EACCES' }, '/p').log, /EACCES/)
})

test('lib/preflight-file.mjs imports only ./limits.mjs', () => {
  const source = readFileSync(join(ROOT, 'lib', 'preflight-file.mjs'), 'utf8')
  const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
  assert.deepEqual(specifiers, ['./limits.mjs'])
  assert.ok(!/\bimport\s*\(/.test(source), 'no dynamic import')
})
