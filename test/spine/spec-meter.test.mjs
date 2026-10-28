// The spec meter's text rules (observe-the-spec-run-live design D1-D10), over
// the results captured from Claude Code 2.1.291 and hand-built edges.
//
// The rules are pure, so the Node runner reaches every branch here; the kit
// (`test/mod/spec-meter.test.ts`) then only proves the engine wiring. The
// skill-lines pin at the end reads the three skills the meter observes, so a
// reword that adds a keyed line the classifier does not know, or drops one it
// keys on, fails here by file and line instead of leaving the pane reading
// `not run yet` forever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  KEYED_LINES,
  NO_SPEC_LINE,
  SPEC_RECORD_LINE,
  TEXT_KINDS,
  UNKNOWN_CHANGE,
  addAdvisorEntries,
  advisorConsultsText,
  advisorEntryIds,
  argvOf,
  changeOf,
  findJson,
  freshAdvisorTally,
  freshSpec,
  lateLineText,
  lineKind,
  promptSkill,
  readResult,
  segmentsOf,
  skillRole,
  specLines,
  specPaneLines,
  specStatusText,
  stageText,
  unreadLineText,
  writeOf
} from '../../lib/spec-meter.mjs'
import * as R from '../fixtures/mod/spec-run.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// --- the load (D1) ----------------------------------------------------------

test('skillRole knows the plugin\'s three skills by their namespaced names only', () => {
  assert.equal(skillRole('interlock:spec'), 'spec')
  assert.equal(skillRole('/interlock:spec'), 'spec')
  assert.equal(skillRole('interlock:explore'), 'explore')
  assert.equal(skillRole(R.SKILL_EXPLORE.input.skill), 'explore')
  assert.equal(skillRole('interlock:review-artifacts'), 'review-artifacts')
  for (const other of ['spec', 'explore', 'opsx:propose', 'interlock:ship', '', 7, null, undefined, {}]) {
    assert.equal(skillRole(other), null, String(other))
  }
})

test('promptSkill reads the first word of a typed load and nothing else', () => {
  assert.equal(promptSkill(R.PROMPT_SPEC.text), 'interlock:spec')
  assert.equal(skillRole(promptSkill(R.PROMPT_SPEC.text)), 'spec')
  assert.equal(promptSkill('  /interlock:spec'), 'interlock:spec')
  assert.equal(promptSkill('/commit'), 'commit')
  assert.equal(promptSkill('please run /interlock:spec'), null)
  assert.equal(promptSkill('/interlock:specx'), 'interlock:specx')
  assert.equal(skillRole(promptSkill('/interlock:specx')), null)
  assert.equal(promptSkill(''), null)
  assert.equal(promptSkill(42), null)
})

// --- the lines (D2, D3) -----------------------------------------------------

test('lineKind classifies every keyed line by its command words, with or without --json', () => {
  const cases = [
    ['interlock drift --json', 'drift'],
    ['openspec new change "add-the-thing"', 'new-change'],
    ['openspec status --change "add-the-thing" --json', 'status'],
    ['openspec status --change add-the-thing', 'status'],
    ['interlock note match "add-the-thing" --json', 'notes'],
    ['interlock note match "add-the-thing" --paths lib/a.mjs', 'notes'],
    ['interlock note derive --findings f.json --change add-the-thing', null],
    ['interlock note add --change x --file f --surprise s --rule r', null],
    ['interlock ledger "add-the-thing" --json', 'ledger'],
    ['interlock ledger "add-the-thing"', 'ledger'],
    ['interlock validate "add-the-thing" --json', 'validate'],
    ['interlock gate --findings f.json --metrics add-the-thing --json', 'gate'],
    ['interlock autonomy record review-artifacts --blockers 1', 'autonomy'],
    ['interlock autonomy clean review-artifacts explore spec', 'autonomy'],
    ['interlock ready "add-the-thing" --findings f.json --paths a --json', 'ready'],
    ['interlock notify checkpoint "add-the-thing"', 'checkpoint'],
    ['   \t interlock drift --json', 'drift'],
    ['openspec instructions design --change "x" --json | node compact.mjs', 'naming-only'],
    ['interlock run next --json', null],
    ['interlock-graph build', null],
    ['interlock autonomy', null],
    ['interlock notify ship "x"', null],
    ['openspec validate', null],
    ['"interlock" drift', null],
    ['npm test', null],
    ['', null]
  ]
  for (const [command, kind] of cases) assert.equal(lineKind(command), kind, command)
  assert.equal(lineKind(undefined), null)
})

test('argvOf unquotes and stops at the first unquoted pipe, list or redirect', () => {
  assert.deepEqual(
    argvOf(`openspec status --change "a b" --json | node x`).map(w => w.value),
    ['openspec', 'status', '--change', 'a b', '--json']
  )
  assert.deepEqual(argvOf(`interlock ledger 'x' > out`).map(w => w.value), ['interlock', 'ledger', 'x'])
  assert.deepEqual(argvOf('a "b|c" d').map(w => w.value), ['a', 'b|c', 'd'])
  assert.equal(argvOf('"interlock"')[0].plain, false)
  assert.deepEqual(argvOf(17), [])
})

test('segmentsOf cuts at unquoted &&, ||, ; and line breaks, and never inside a heredoc', () => {
  assert.deepEqual(segmentsOf('a && b || c; d\ne'), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(segmentsOf('echo "a; b" && c'), ['echo "a; b"', 'c'])
  assert.deepEqual(segmentsOf("echo 'x && y'"), ["echo 'x && y'"])
  assert.deepEqual(segmentsOf('a | b'), ['a | b'])
  const heredoc = "cat > f <<'EOF'\nopenspec status --change x --json\nEOF"
  assert.deepEqual(specLines(heredoc), [])
  assert.deepEqual(segmentsOf(null), [])
})

test('specLines keeps each keyed segment of a compound line, in order', () => {
  assert.deepEqual(
    specLines('interlock autonomy clean review-artifacts explore spec; interlock notify checkpoint "add-hello-file"').map(l => l.kind),
    ['autonomy', 'checkpoint']
  )
  assert.deepEqual(
    specLines('openspec new change "add-hello-file" && openspec status --change "add-hello-file" --json').map(l => l.kind),
    ['new-change', 'status']
  )
  assert.deepEqual(
    specLines('ls -la; git ls-files; ls .claude/ship 2>/dev/null; interlock drift --json').map(l => l.kind),
    ['drift']
  )
  assert.deepEqual(specLines('npm test && git status'), [])
  assert.deepEqual(TEXT_KINDS, ['status', 'drift', 'notes', 'ledger', 'validate', 'gate', 'ready'])
})

test('changeOf takes the name from the argv first, then from the JSON, and never from a placeholder', () => {
  assert.equal(changeOf('new-change', 'openspec new change "add-the-thing"', null), 'add-the-thing')
  assert.equal(changeOf('new-change', "openspec new change 'add-the-thing'", null), 'add-the-thing')
  assert.equal(changeOf('status', 'openspec status --change "add-the-thing" --json', null), 'add-the-thing')
  assert.equal(changeOf('status', 'openspec status --change=add-the-thing --json', null), 'add-the-thing')
  assert.equal(changeOf('naming-only', 'openspec instructions design --change "beta" --json | node x', null), 'beta')
  assert.equal(changeOf('ledger', 'interlock ledger "add-the-thing" --json', null), 'add-the-thing')
  assert.equal(changeOf('validate', 'interlock validate add-the-thing --json', null), 'add-the-thing')
  assert.equal(changeOf('ready', 'interlock ready "add-the-thing" --findings f --json', null), 'add-the-thing')
  assert.equal(changeOf('checkpoint', 'interlock notify checkpoint "add-the-thing"', null), 'add-the-thing')
  assert.equal(changeOf('gate', 'interlock gate --findings f.json --metrics add-the-thing --json', null), 'add-the-thing')
  assert.equal(changeOf('ledger', 'interlock ledger "$NAME" --json', null), null)
  assert.equal(changeOf('ledger', 'interlock ledger "<name>" --json', null), null)
  assert.equal(changeOf('ledger', 'interlock ledger `x` --json', null), null)
  assert.equal(changeOf('status', 'openspec status --json', null), null)
  assert.equal(changeOf('status', 'openspec status --json', { changeName: 'from-json' }), 'from-json')
  assert.equal(changeOf('validate', 'interlock validate --json', { change: 'from-json' }), 'from-json')
  assert.equal(changeOf('status', 'openspec status --change "argv" --json', { changeName: 'json' }), 'argv')
  assert.equal(changeOf('drift', 'interlock drift --json', {}), null)
})

test('findJson reads the object emit printed past an engine prefix and a stderr tail', () => {
  assert.deepEqual(findJson('Exit code 1\n{\n  "a": 1\n}').value, { a: 1 })
  assert.deepEqual(findJson('{\n  "a": 1\n}\ninterlock: metrics not written: disk full\n').value, { a: 1 })
  assert.equal(findJson('DECISIONS BLOCKING — 2 row(s)').problem, 'output not JSON')
  assert.equal(findJson('{\n  "a": \n}').problem, 'output not JSON')
  assert.equal(findJson('[\n]').problem, 'output not JSON')
  assert.equal(findJson(undefined).problem, 'no result text')
  assert.equal(findJson(R.BASH_LEDGER_BLOCKING.text).value.blocking, true)
})

// --- reading a result (D3) --------------------------------------------------

test('readResult reads each captured result by the fields its kind needs', () => {
  const status = readResult('status', R.BASH_STATUS.command, R.BASH_STATUS)
  assert.equal(status.name, R.CHANGE)
  assert.deepEqual(status.artifacts.map(a => `${a.id}:${a.status}`), ['proposal:done', 'design:ready', 'specs:done', 'tasks:blocked'])
  assert.deepEqual(status.applyRequires, ['tasks'])
  assert.equal(status.schemaName, 'spec-driven')
  assert.ok(!('isComplete' in status) && !('isPlanningComplete' in status))

  const ledger = readResult('ledger', R.BASH_LEDGER_BLOCKING.command, R.BASH_LEDGER_BLOCKING)
  assert.deepEqual(ledger, { kind: 'ledger', blocking: true, needsHuman: 2, invalidCount: 0, missing: false, unparseable: false, name: R.CHANGE })

  const gate = readResult('gate', R.BASH_GATE_BLOCKED.command, R.BASH_GATE_BLOCKED)
  assert.equal(gate.passed, false)
  assert.deepEqual(gate.counts, { blocker: 1, warning: 3, suggestion: 0 })
  assert.equal(gate.malformed, 0)
  assert.equal(gate.metrics.written, true)
  assert.equal(gate.name, R.CHANGE)

  const unresolved = readResult('validate', R.BASH_VALIDATE_UNRESOLVED.command, R.BASH_VALIDATE_UNRESOLVED)
  assert.deepEqual(unresolved.candidates, [R.CHANGE])
  assert.match(unresolved.error, /not found/)
})

test('the old text ledger line is unparsed with its own first line, past the engine prefix', () => {
  const entry = readResult('ledger', R.BASH_LEDGER_TEXT.command, R.BASH_LEDGER_TEXT)
  assert.equal(entry.reason, 'output not JSON')
  assert.match(entry.unparsed, /^DECISIONS BLOCKING — 2 row\(s\)/)
  assert.equal(stageText(entry), 'ledger (unparsed)')
  assert.match(unreadLineText(entry, R.BASH_LEDGER_TEXT.command), /ledger result not read \(output not JSON\): interlock ledger/)
})

test('readResult names missing fields, a persisted output, an absent text, and ignores the roll-up', () => {
  const ok = (stdout, extra = {}) => ({ result: { stdout, stderr: '', interrupted: false, ...extra }, text: stdout })
  const json = v => JSON.stringify(v, null, 2)
  assert.equal(readResult('ledger', 'interlock ledger x --json', ok(json({ needsHuman: 1 }))).reason, 'fields missing: blocking')
  assert.equal(readResult('validate', 'interlock validate x --json', ok(json({ ready: true }))).reason, 'fields missing: problems')
  assert.equal(
    readResult('gate', 'interlock gate --json', ok(json({ passed: true, counts: { blocker: 0 } }))).reason,
    'fields missing: counts.warning, counts.suggestion, malformed'
  )
  assert.equal(readResult('drift', 'interlock drift --json', ok(json({ unarchived: [] }))).reason, 'fields missing: stale.broken, stale.aging')
  assert.equal(readResult('ready', 'interlock ready x --json', ok(json({ ready: false }))).reason, 'fields missing: blockers')
  assert.equal(readResult('status', 'openspec status --json', ok(json({ artifacts: [{ id: 'a' }] }))).reason, 'fields missing: artifacts')
  assert.equal(
    readResult('status', 'openspec status --json', ok('{', { persistedOutputPath: '/t/out.txt' })).reason,
    'output too large to read inline'
  )
  assert.equal(readResult('ledger', 'interlock ledger x --json', {}).reason, 'no result text')
  assert.equal(readResult('ledger', 'interlock ledger x --json', null).reason, 'no result text')
  // An errored result whose `result` is the engine's string: `text` is read.
  assert.equal(readResult('ledger', 'interlock ledger x --json', { result: 'Error: Exit code 1\n{\n"blocking": false\n}', text: 'Exit code 1\n{\n  "blocking": false\n}', isError: true }).blocking, false)
  // OpenSpec's roll-up is ignored: a ladder with one artifact left reads as the ladder.
  const rollUp = readResult('status', 'openspec status --json', ok(json({ isComplete: true, isPlanningComplete: true, artifacts: [{ id: 'a', status: 'done' }, { id: 'b', status: 'ready' }] })))
  assert.equal(stageText(rollUp), 'status 1/2 done · next: b')
  const drift = readResult('drift', 'interlock drift --json', ok(json({ unarchived: ['a'], stale: { broken: [], aging: ['x', 'y'] } })))
  assert.equal(stageText(drift), 'drift (unarchived 1 · broken 0 · aging 2)')
  const ready = readResult('ready', 'interlock ready x --json', ok(json({ ready: false, blockers: [{}, {}] })))
  assert.equal(stageText(ready), 'ready false (blockers 2)')
  const long = readResult('ledger', 'interlock ledger x', ok('y'.repeat(500)))
  assert.equal(long.unparsed.length, 200)
})

test('new-change, autonomy and checkpoint read no text, and autonomy keeps only its command word', () => {
  assert.deepEqual(readResult('new-change', 'openspec new change "x"', { text: 'garbage' }), { kind: 'new-change', name: 'x' })
  assert.deepEqual(readResult('checkpoint', 'interlock notify checkpoint "x"', { text: 'push: not configured' }), { kind: 'checkpoint', name: 'x' })
  const autonomy = readResult('autonomy', 'interlock autonomy record review-artifacts --blockers 1', { text: 'review-artifacts: L1 (0/3 clean)' })
  assert.deepEqual(autonomy, { kind: 'autonomy', command: 'record', name: null })
  assert.equal(stageText(autonomy), 'autonomy record')
  assert.equal(readResult('naming-only', 'openspec instructions x', {}), null)
})

// --- writes (D4) ------------------------------------------------------------

test('writeOf files artifacts by directory, the brief and the findings file, and nothing else', () => {
  assert.deepEqual(writeOf('openspec/changes/add-the-thing/proposal.md'), { kind: 'artifact', change: 'add-the-thing', file: 'proposal.md' })
  assert.deepEqual(writeOf('/repo/openspec/changes/add-the-thing/specs/x/spec.md'), {
    kind: 'artifact',
    change: 'add-the-thing',
    file: 'specs/x/spec.md'
  })
  assert.equal(writeOf('openspec/changes/archive/2026-01-01-x/proposal.md'), null)
  assert.deepEqual(writeOf('.claude/handoff/explore-add-the-thing-20261006-120000.md'), {
    kind: 'brief',
    path: '.claude/handoff/explore-add-the-thing-20261006-120000.md'
  })
  assert.deepEqual(writeOf('/repo/.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json'), {
    kind: 'findings',
    change: 'add-the-thing',
    path: '/repo/.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json'
  })
  for (const other of ['lib/x.mjs', '.claude/handoff/ship-x.md', '.claude/metrics/review-x.json', 'openspec/specs/a/spec.md', '', 5, undefined]) {
    assert.equal(writeOf(other), null, String(other))
  }
})

// --- the words (D6) ---------------------------------------------------------

test('stageText says every row of the table in the CLI\'s words', () => {
  const ladder = statuses => ({ kind: 'status', artifacts: statuses.map((status, i) => ({ id: `a${i}`, status })) })
  const rows = [
    [{ kind: 'explore' }, 'explore'],
    [{ kind: 'review-artifacts' }, 'review-artifacts'],
    [{ kind: 'new-change' }, 'new change'],
    [ladder(['done', 'done', 'ready', 'blocked']), 'status 2/4 done · next: a2'],
    [ladder(['done', 'done', 'done', 'done']), 'status 4/4 done'],
    [ladder(['done', 'blocked']), 'status 1/2 done'],
    [{ kind: 'drift', unarchived: 1, broken: 0, aging: 2 }, 'drift (unarchived 1 · broken 0 · aging 2)'],
    [{ kind: 'ledger', blocking: true, missing: true }, 'ledger missing'],
    [{ kind: 'ledger', blocking: true, unparseable: true }, 'ledger unparseable'],
    [{ kind: 'ledger', blocking: true, needsHuman: 2, invalidCount: 0 }, 'ledger blocking (needs_human 2 · invalid 0)'],
    [{ kind: 'ledger', blocking: false, needsHuman: 0, invalidCount: 0 }, 'ledger clear (needs_human 0 · invalid 0)'],
    [{ kind: 'validate', ready: true, problems: [] }, 'validate READY'],
    [{ kind: 'validate', ready: false, problems: ['a', 'b'] }, 'validate NOT READY (problems 2)'],
    [{ kind: 'gate', passed: true, counts: { blocker: 0, warning: 1, suggestion: 0 }, malformed: 0, metrics: { written: true } }, 'gate PASS'],
    [{ kind: 'gate', passed: true, counts: { blocker: 0, warning: 0, suggestion: 0 }, malformed: 0, metrics: { written: false } }, 'gate PASS (metrics not written)'],
    [{ kind: 'gate', passed: false, counts: { blocker: 1, warning: 3, suggestion: 0 }, malformed: 0, metrics: null }, 'gate BLOCKED (blocker 1 · warning 3)'],
    [
      { kind: 'gate', passed: false, counts: { blocker: 1, warning: 3, suggestion: 0 }, malformed: 2, metrics: { written: false } },
      'gate BLOCKED (blocker 1 · warning 3 · malformed 2 · metrics not written)'
    ],
    [{ kind: 'autonomy', command: 'clean' }, 'autonomy clean'],
    [{ kind: 'ready', ready: true, blockers: 0 }, 'ready true'],
    [{ kind: 'ready', ready: false, blockers: 2 }, 'ready false (blockers 2)'],
    [{ kind: 'checkpoint' }, 'checkpoint'],
    [{ kind: 'gate', unparsed: 'x', reason: 'output not JSON' }, 'gate (unparsed)'],
    [{ kind: 'validate', error: 'no', candidates: ['a', 'b', 'c'] }, 'validate: change not resolved (candidates 3)']
  ]
  for (const [entry, text] of rows) assert.equal(stageText(entry), text, text)
  assert.equal(stageText({ kind: 'explore' }, 3), 'explore (3 investigators)')
  assert.equal(stageText(null), null)
})

/** A live spec record named `add-the-thing`, with what the happy path left. */
function liveSpec() {
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.order = ['add-the-thing']
  spec.changes.set('add-the-thing', {
    status: readResult('status', R.BASH_STATUS.command, R.BASH_STATUS),
    ledger: readResult('ledger', R.BASH_LEDGER_BLOCKING.command, R.BASH_LEDGER_BLOCKING),
    validate: { kind: 'validate', ready: false, problems: ['missing or empty: design.md', 'missing or empty: tasks.md'] },
    gate: readResult('gate', R.BASH_GATE_BLOCKED.command, R.BASH_GATE_BLOCKED)
  })
  spec.explore = { spawned: 3, brief: '.claude/handoff/explore-add-the-thing-20261006-120000.md' }
  spec.writes.set('add-the-thing', new Map([['proposal.md', { count: 2, at: Date.parse('2026-10-06T12:10:00Z') }]]))
  spec.findings.set('add-the-thing', '.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json')
  spec.lastActivityAt = Date.parse('2026-10-06T12:15:00Z')
  spec.stage = spec.changes.get('add-the-thing').gate
  return spec
}

test('specStatusText follows the change the CLI named, or says it is unknown', () => {
  const spec = freshSpec()
  spec.phase = 'live'
  assert.equal(specStatusText(spec), `interlock spec: ${UNKNOWN_CHANGE}`)
  assert.equal(specStatusText(liveSpec()), 'interlock spec: add-the-thing · gate BLOCKED (blocker 1 · warning 3)')
})

test('specPaneLines draws the run by key, the table as printed, and the record line', () => {
  const lines = specPaneLines(liveSpec())
  const by = key => lines.find(l => l.key === key)?.text
  assert.equal(by('spec-header'), 'add-the-thing · schema spec-driven')
  assert.equal(by('spec-artifact-design'), 'design · ready · design.md')
  assert.equal(by('spec-artifact-tasks'), 'tasks · blocked · tasks.md')
  assert.equal(by('spec-apply-requires'), 'applyRequires: tasks')
  assert.equal(by('spec-explore'), 'explore: 3 investigators spawned · brief .claude/handoff/explore-add-the-thing-20261006-120000.md')
  assert.equal(by('spec-drift'), 'drift: not run yet')
  assert.equal(by('spec-ledger'), 'ledger: blocking true · needsHuman 2 · invalidCount 0 · missing false · unparseable false')
  assert.equal(by('spec-validate'), 'validate: ready false · problems 2')
  assert.equal(by('spec-validate-problem-1'), 'missing or empty: tasks.md')
  assert.match(by('spec-gate'), /^gate: passed false · blocker 1 · warning 3 · suggestion 0 · malformed 0 · metrics \/repo\/\.claude\/metrics\//)
  assert.equal(by('spec-ready'), 'ready: not run yet')
  assert.equal(by('spec-autonomy'), 'autonomy: not run yet')
  assert.equal(by('spec-write-proposal.md'), 'proposal.md · written 2× · last 2026-10-06T12:10:00.000Z')
  assert.equal(by('spec-findings'), 'findings file: .claude/metrics/review-artifacts-add-the-thing-20261006-121500.json')
  assert.equal(by('spec-last-activity'), 'last activity 2026-10-06T12:15:00.000Z')
  assert.equal(by('spec-record'), SPEC_RECORD_LINE)
  assert.equal(by('spec-checkpoint'), undefined)
  assert.equal(new Set(lines.map(l => l.key)).size, lines.length, 'a key repeats')
  for (const l of lines) assert.doesNotMatch(l.text, /complete|ready to ship|quiet|✓|✔/i, l.text)
})

test('specPaneLines says what is unknown, unread, unresolved, ended and elsewhere', () => {
  assert.deepEqual(specPaneLines(freshSpec()), [
    { key: 'spec-none', text: NO_SPEC_LINE, dim: true, section: 'none', kind: 'none', spans: [{ text: NO_SPEC_LINE, tone: null }] }
  ])
  const unnamed = freshSpec()
  unnamed.phase = 'live'
  const lines = specPaneLines(unnamed)
  const by = key => lines.find(l => l.key === key)?.text
  assert.equal(by('spec-header'), UNKNOWN_CHANGE)
  for (const kind of ['status', 'drift', 'ledger', 'validate', 'gate', 'ready']) assert.equal(by(`spec-${kind}`), `${kind}: not run yet`)
  assert.equal(by('spec-explore'), 'explore: none reported by this host · no brief written yet')
  assert.equal(by('spec-writes-none'), 'no artifact writes yet')
  assert.equal(by('spec-last-activity'), 'last activity unknown')

  const spec = liveSpec()
  spec.changes.get('add-the-thing').ledger = readResult('ledger', R.BASH_LEDGER_TEXT.command, R.BASH_LEDGER_TEXT)
  spec.changes.get('add-the-thing').validate = readResult('validate', R.BASH_VALIDATE_UNRESOLVED.command, R.BASH_VALIDATE_UNRESOLVED)
  spec.checkpointCrossed = true
  spec.checkpointAt = Date.parse('2026-10-06T12:20:00Z')
  spec.handedOver = true
  spec.order = ['alpha', 'add-the-thing']
  spec.writes.get('add-the-thing').set('tasks.md', { count: 1, at: null })
  const more = specPaneLines(spec)
  const at = key => more.find(l => l.key === key)?.text
  assert.match(at('spec-ledger'), /^ledger: not read \(output not JSON\) · DECISIONS BLOCKING — 2 row\(s\)/)
  assert.equal(at('spec-validate'), `validate: change not resolved · candidates ${R.CHANGE}`)
  assert.equal(at('spec-checkpoint'), 'checkpoint reached 2026-10-06T12:20:00.000Z')
  assert.equal(at('spec-handover'), 'handed over to ship, time unknown')
  assert.equal(at('spec-other-changes'), 'other changes named this run: alpha')
  assert.equal(at('spec-write-tasks.md'), 'tasks.md · written 1× · last time unknown')
})

// --- sections and spans (draw-the-settle-and-spec-panes-as-cards D1-D3) -----

/** A live spec with every optional line present. */
function fullSpec() {
  const spec = liveSpec()
  const c = spec.changes.get('add-the-thing')
  c.ledger = { kind: 'ledger', blocking: false, needsHuman: 0, invalidCount: 0, missing: false, unparseable: false, name: R.CHANGE }
  c.validate = { kind: 'validate', ready: true, problems: ['missing or empty: tasks.md'], name: R.CHANGE }
  c.ready = { kind: 'ready', ready: true, blockers: 0, name: R.CHANGE }
  c.gate = { ...c.gate, passed: true }
  spec.autonomy = 'record'
  spec.checkpointCrossed = true
  spec.checkpointAt = Date.parse('2026-10-06T12:20:00Z')
  spec.handedOver = true
  spec.order = ['alpha', 'add-the-thing']
  spec.advisor = freshAdvisorTally()
  addAdvisorEntries(spec.advisor, [{ name: 'advisor', id: 'a1' }], false)
  return spec
}

const toneOf = (lines, key, word) => {
  const line = lines.find(l => l.key === key)
  return line.spans.find(s => s.text === word)?.tone
}

test('spans join to the text on every line of every pane', () => {
  const idle = freshSpec()
  const unnamed = freshSpec()
  unnamed.phase = 'live'
  const unread = liveSpec()
  unread.changes.get('add-the-thing').ledger = readResult('ledger', R.BASH_LEDGER_TEXT.command, R.BASH_LEDGER_TEXT)
  for (const spec of [idle, unnamed, liveSpec(), fullSpec(), unread]) {
    for (const l of specPaneLines(spec)) {
      assert.equal(l.spans.map(s => s.text).join(''), l.text, l.key)
      assert.ok(l.spans.every(s => s.text !== ''), l.key)
    }
  }
})

test('each line sits in its section, with the writes title and the no-run kind', () => {
  const lines = specPaneLines(fullSpec())
  const sectionOfKey = key => lines.find(l => l.key === key)?.section
  assert.equal(sectionOfKey('spec-header'), 'header')
  for (const k of ['spec-artifact-design', 'spec-apply-requires']) assert.equal(sectionOfKey(k), 'artifacts')
  assert.equal(sectionOfKey('spec-explore'), 'explore')
  for (const k of ['spec-drift', 'spec-notes', 'spec-ledger', 'spec-validate', 'spec-validate-problem-0', 'spec-gate', 'spec-ready', 'spec-autonomy', 'spec-advisor-consults']) {
    assert.equal(sectionOfKey(k), 'gates', k)
  }
  for (const k of ['spec-writes', 'spec-write-proposal.md', 'spec-findings']) assert.equal(sectionOfKey(k), 'writes', k)
  for (const k of ['spec-last-activity', 'spec-checkpoint', 'spec-handover', 'spec-other-changes', 'spec-record']) assert.equal(sectionOfKey(k), 'record', k)
  assert.equal(lines.find(l => l.key === 'spec-writes').kind, 'title')
  assert.equal(lines.filter(l => l.kind).length, 1)
  assert.equal(sectionOfKey('spec-status'), undefined)
  const unnamed = freshSpec()
  unnamed.phase = 'live'
  const bare = specPaneLines(unnamed)
  assert.equal(bare.find(l => l.key === 'spec-status').section, 'artifacts')
  assert.equal(bare.find(l => l.key === 'spec-writes-none').section, 'writes')
  assert.equal(specPaneLines(freshSpec())[0].section, 'none')
})

test('artifact status words take done ok, ready current, blocked dim', () => {
  const lines = specPaneLines(liveSpec())
  const spec = liveSpec()
  spec.changes.get('add-the-thing').status.artifacts[0].status = 'weird'
  assert.equal(toneOf(lines, 'spec-artifact-design', 'ready'), 'current')
  assert.equal(toneOf(lines, 'spec-artifact-tasks', 'blocked'), 'dim')
  assert.equal(toneOf(lines, 'spec-artifact-proposal', 'done'), 'ok')
  const odd = specPaneLines(spec).find(l => l.key === 'spec-artifact-' + spec.changes.get('add-the-thing').status.artifacts[0].id)
  assert.ok(odd.spans.every(s => s.tone === null))
})

test('result fields take their tones: false and true, ready, blocking, missing, unparseable', () => {
  const bad = liveSpec()
  const good = fullSpec()
  const badLines = specPaneLines(bad)
  const goodLines = specPaneLines(good)
  assert.equal(toneOf(goodLines, 'spec-gate', 'passed true'), 'ok')
  assert.equal(toneOf(badLines, 'spec-gate', 'passed false'), 'alarm')
  assert.equal(toneOf(goodLines, 'spec-ready', 'ready true'), 'ok')
  assert.equal(toneOf(goodLines, 'spec-validate', 'ready true'), 'ok')
  assert.equal(toneOf(badLines, 'spec-validate', 'ready false'), 'alarm')
  assert.equal(toneOf(goodLines, 'spec-ledger', 'blocking false'), 'ok')
  assert.equal(toneOf(badLines, 'spec-ledger', 'blocking true'), 'alarm')
  const ledger = bad.changes.get('add-the-thing')
  ledger.ledger = { kind: 'ledger', blocking: true, missing: true, unparseable: true, name: R.CHANGE }
  const flagged = specPaneLines(bad)
  assert.equal(toneOf(flagged, 'spec-ledger', 'missing true'), 'alarm')
  assert.equal(toneOf(flagged, 'spec-ledger', 'unparseable true'), 'alarm')
  ledger.ledger = { kind: 'ledger', blocking: false, missing: false, name: R.CHANGE }
  assert.ok(specPaneLines(bad).find(l => l.key === 'spec-ledger').spans.every(s => s.text !== 'missing false' || s.tone === null))
  ledger.ready = { kind: 'ready', ready: false, blockers: 2, name: R.CHANGE }
  assert.equal(toneOf(specPaneLines(bad), 'spec-ready', 'ready false'), 'alarm')
})

test('not run yet is dim, a not read result is warn, the checkpoint and hand-over lines are accent', () => {
  const lines = specPaneLines(liveSpec())
  assert.equal(toneOf(lines, 'spec-drift', 'not run yet'), 'dim')
  assert.equal(toneOf(lines, 'spec-ready', 'not run yet'), 'dim')
  assert.equal(toneOf(lines, 'spec-autonomy', 'not run yet'), 'dim')
  const spec = fullSpec()
  spec.changes.get('add-the-thing').ledger = readResult('ledger', R.BASH_LEDGER_TEXT.command, R.BASH_LEDGER_TEXT)
  const more = specPaneLines(spec)
  const ledger = more.find(l => l.key === 'spec-ledger')
  assert.deepEqual(ledger.spans.filter(s => s.tone).map(s => [s.text, s.tone]), [['not read (output not JSON)', 'warn']])
  for (const key of ['spec-checkpoint', 'spec-handover']) {
    const line = more.find(l => l.key === key)
    assert.deepEqual(line.spans, [{ text: line.text, tone: 'accent' }])
  }
  for (const key of ['spec-record']) assert.deepEqual(more.find(l => l.key === key).spans, [{ text: SPEC_RECORD_LINE, tone: 'dim' }])
  const unnamed = freshSpec()
  unnamed.phase = 'live'
  assert.deepEqual(specPaneLines(unnamed).find(l => l.key === 'spec-writes-none').spans, [{ text: 'no artifact writes yet', tone: 'dim' }])
  assert.ok(more.find(l => l.key === 'spec-explore').spans.every(s => s.tone === null))
})

test('the debug lines name the kind and why it was not drawn', () => {
  assert.equal(lateLineText('status', 'checkpoint'), 'interlock spec: a status line crossed after the checkpoint; not drawn')
  assert.equal(lateLineText('status', 'idle'), 'interlock spec: a status line crossed with no live spec run; not drawn')
  assert.equal(freshSpec({ afterBoundary: true }).afterBoundary, true)
  assert.equal(freshSpec().afterBoundary, false)
})

test('lib/spec-meter.mjs imports nothing, spells no engine call and never reads the roll-up', () => {
  const source = readFileSync(join(ROOT, 'lib', 'spec-meter.mjs'), 'utf8')
  assert.doesNotMatch(source, /^\s*import\b/m)
  assert.doesNotMatch(source, /\bimport\(/)
  assert.ok(!source.includes('$.'), 'the pure module spells an engine call')
  assert.doesNotMatch(source, /complete/i)
})

// --- the removed checkpoint advisor (replace-subagent-advisors-with-advisor-tool D7) ---
//
// The `advisor` kind, its draft write and its pane lines are gone. A consumer
// repository on the previous skill text still runs `interlock advisor …`: the
// line passes through unread, and its draft is no write the meter files.

/** A Bash result as the engine raises it, with `emit`'s pretty-printed JSON as stdout. */
const bashResult = value => {
  const stdout = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
}

const OLD_ADVISOR_LINES = [
  'interlock advisor "add-the-thing" --brief --findings .claude/metrics/review-artifacts-add-the-thing-20261006-121500.json --json',
  'interlock advisor "add-the-thing" --check .claude/metrics/advisor-add-the-thing-20261006-122000.json --json',
  'interlock advisor "add-the-thing" --check --failed "agent spawn errored" --json',
  'interlock advisor --verdict --labels evals --json',
  'interlock review-advisor "add-the-thing" --check - --json'
]

test('no advisor kind remains: an interlock advisor line is no keyed line, and its draft is no write', () => {
  for (const command of OLD_ADVISOR_LINES) assert.equal(lineKind(command), null, command)
  assert.equal(KEYED_LINES.some(k => k.kind === 'advisor'), false)
  assert.equal(TEXT_KINDS.includes('advisor'), false)
  assert.equal(readResult('advisor', OLD_ADVISOR_LINES[0], bashResult({ step: 'brief' })), null)
  assert.equal(writeOf('.claude/metrics/advisor-add-the-thing-20261006-122000.json'), null)
  assert.equal(writeOf('.claude/metrics/review-advisor-x-20261022-101010.json'), null)
})

test('the pane draws no advisor, consult, draft or waiting line', () => {
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.order.push('add-the-thing')
  spec.changes.set('add-the-thing', {})
  const keys = specPaneLines(spec).map(l => l.key)
  for (const key of ['spec-advisor', 'spec-consult', 'spec-draft', 'spec-waiting']) assert.ok(!keys.includes(key), key)
  assert.equal('consult' in spec, false)
  assert.equal('drafts' in spec, false)
})

// --- the notes line (replace-subagent-advisors-with-advisor-tool D3, D7) -----
//
// `interlock note match … --json` is read like the ledger and validate lines:
// `rows` by count, `omitted` and `unreadable`, or `error` with `candidates`.
// A table that does not parse exits non-zero with text, which reads unparsed.

const NOTES_LINE = 'interlock note match "add-the-thing" --json'
/** A failed command's result as the engine raises it: `Exit code 1` before the output. */
const failedBash = out => ({ result: `Error: Exit code 1\n${out}`, text: `Exit code 1\n${out}`, isError: true })

test('notes sits between status and ledger in KEYED_LINES and is a text kind', () => {
  const kinds = KEYED_LINES.map(k => k.kind)
  assert.equal(kinds.filter(k => k === 'notes').length, 1)
  assert.equal(kinds.indexOf('notes'), kinds.indexOf('status') + 1)
  assert.equal(kinds.indexOf('ledger'), kinds.indexOf('notes') + 1)
  assert.deepEqual(KEYED_LINES[kinds.indexOf('notes')].words, ['interlock', 'note', 'match'])
  assert.ok(TEXT_KINDS.includes('notes'))
  assert.equal(kinds.includes('advisor'), false)
})

test('changeOf reads a notes line\'s change from the positional after note match', () => {
  assert.equal(changeOf('notes', NOTES_LINE, null), 'add-the-thing')
  assert.equal(changeOf('notes', 'interlock note match add-the-thing --paths lib/a.mjs --json', null), 'add-the-thing')
  assert.equal(changeOf('notes', 'interlock note match "<name>" --json', null), null)
  assert.equal(changeOf('notes', 'interlock note match --json', { change: 'add-the-thing' }), 'add-the-thing')
})

test('readResult reads a notes line by rows count, omitted and unreadable, and the stage and pane say them', () => {
  const entry = readResult('notes', NOTES_LINE, bashResult({ change: 'add-the-thing', rows: [{ id: 'N1' }, { id: 'N2' }], omitted: 0, unreadable: 1 }))
  assert.deepEqual(entry, { kind: 'notes', rows: 2, omitted: 0, unreadable: 1, name: 'add-the-thing' })
  assert.equal(stageText(entry), 'notes 2 matched (omitted 0)')
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.order.push('add-the-thing')
  spec.changes.set('add-the-thing', { notes: entry })
  const lines = specPaneLines(spec)
  const keys = lines.map(l => l.key)
  assert.equal(lines.find(l => l.key === 'spec-notes')?.text, 'notes: 2 matched · omitted 0 · unreadable 1')
  assert.ok(keys.indexOf('spec-drift') < keys.indexOf('spec-notes'), 'the notes line follows the drift line')
  assert.ok(keys.indexOf('spec-notes') < keys.indexOf('spec-ledger'), 'the notes line comes before the ledger line')
  assert.match(specStatusText({ ...spec, stage: entry }), /· notes 2 matched \(omitted 0\)$/)
})

test('a notes line that lacks its fields, or a table that does not parse, is unparsed and never a count', () => {
  const missing = readResult('notes', NOTES_LINE, bashResult({ change: 'add-the-thing', rows: [] }))
  assert.equal(missing.reason, 'fields missing: omitted, unreadable')
  assert.equal(stageText(missing), 'notes (unparsed)')
  const broken = readResult('notes', NOTES_LINE, failedBash('interlock: docs/notes/compound.md: header row missing'))
  assert.equal(broken.reason, 'output not JSON')
  assert.equal(broken.unparsed, 'interlock: docs/notes/compound.md: header row missing')
  assert.equal(stageText(broken), 'notes (unparsed)')
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.changes.set('add-the-thing', { notes: broken })
  assert.equal(
    specPaneLines(spec).find(l => l.key === 'spec-notes')?.text,
    'notes: not read (output not JSON) · interlock: docs/notes/compound.md: header row missing'
  )
})

test('a notes line on a change that does not resolve reads error and candidates, as ledger and validate do', () => {
  const entry = readResult('notes', 'interlock note match "add-the-thin" --json', failedBash(JSON.stringify({ error: 'change "add-the-thin" not found', candidates: ['add-the-thing'] }, null, 2)))
  assert.equal(entry.error, 'change "add-the-thin" not found')
  assert.deepEqual(entry.candidates, ['add-the-thing'])
  assert.equal(stageText(entry), 'notes: change not resolved (candidates 1)')
})

test('before a notes line crossed, the pane says it has not run', () => {
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.changes.set('add-the-thing', {})
  assert.equal(specPaneLines(spec).find(l => l.key === 'spec-notes')?.text, 'notes: not run yet')
})

// --- the advisor tool's entries in turn.step (replace-subagent-advisors-with-advisor-tool) ---
//
// The engine reports a server tool use on `turn.step` as `serverToolUses`.
// The meter counts the ones named `advisor` by id, the session apart from
// subagents, and draws nothing until the first one: it does not read settings,
// so a line before it would read as a measured zero.

const use = (id, name = 'advisor') => ({ ...(id === undefined ? {} : { id }), name, input: {} })

test('advisorEntryIds reads only entries named advisor, null for one with no id, and never throws', () => {
  assert.deepEqual(advisorEntryIds([use('a'), use('b', 'web_search'), use(undefined), use(7), null, 'advisor', [use('c')]]), ['a', null, null])
  assert.deepEqual(advisorEntryIds([{ id: 'x', name: 'Advisor' }, { id: 'y', name: ['advisor'] }]), [])
  for (const notAList of [undefined, null, 'advisor', 3, { id: 'a', name: 'advisor' }]) assert.deepEqual(advisorEntryIds(notAList), [])
})

test('addAdvisorEntries counts each id once across the run, toward the session or subagents', () => {
  const tally = freshAdvisorTally()
  assert.equal(addAdvisorEntries(tally, [use('a'), use('b')], false), 2)
  assert.equal(addAdvisorEntries(tally, [use('c')], true), 1)
  assert.equal(addAdvisorEntries(tally, [use('a'), use('c')], true), 0, 'a repeated id adds nothing')
  assert.equal(addAdvisorEntries(tally, [use(undefined)], false), 1, 'an entry with no id counts where it is')
  assert.equal(addAdvisorEntries(tally, 'not a list', true), 0)
  assert.equal(addAdvisorEntries(tally, [use('d', 'web_search')], true), 0)
  assert.deepEqual({ session: tally.session, subagents: tally.subagents }, { session: 3, subagents: 1 })
  assert.equal(addAdvisorEntries(null, [use('e')], false), 0)
  assert.equal(addAdvisorEntries({ session: 0, subagents: 0 }, [use('e')], false), 0)
})

test('the advisor-consults line is drawn from the first entry on, and never as none seen', () => {
  const tally = freshAdvisorTally()
  assert.equal(advisorConsultsText(tally), null)
  assert.equal(advisorConsultsText(undefined), null)
  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.changes.set('add-the-thing', {})
  const before = specPaneLines(spec)
  assert.ok(!before.some(l => l.key === 'spec-advisor-consults'), 'no advisor-consults line before the first entry')
  assert.ok(!before.some(l => /none seen|advisor consults/.test(l.text)))
  addAdvisorEntries(spec.advisor, [use('a')], false)
  addAdvisorEntries(spec.advisor, [use('b')], false)
  addAdvisorEntries(spec.advisor, [use('c')], true)
  const lines = specPaneLines(spec)
  const keys = lines.map(l => l.key)
  assert.equal(lines.find(l => l.key === 'spec-advisor-consults')?.text, 'advisor consults seen: session 2 · subagents 1')
  assert.ok(keys.indexOf('spec-autonomy') < keys.indexOf('spec-advisor-consults'), 'the line follows the autonomy line')
  assert.ok(keys.indexOf('spec-advisor-consults') < keys.indexOf('spec-writes'), 'the line comes before the writes section')
  assert.equal(advisorConsultsText({ session: 0, subagents: 2, ids: new Set() }), 'advisor consults seen: session 0 · subagents 2')
})

// --- the skill-lines pin (D10) ----------------------------------------------

const SKILL_FILES = ['skills/spec/SKILL.md', 'skills/review-artifacts/SKILL.md', 'skills/spec/continuity.md']

/** Every fenced line in a skill that begins `openspec ` or `interlock `, with its line number. */
function fencedCommandLines(file) {
  const out = []
  let fenced = false
  readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced
        return
      }
      if (fenced && /^\s*(openspec|interlock) /.test(line)) out.push({ file, n: i + 1, line: line.trim() })
    })
  return out
}

// `openspec validate "<name>"` prints no JSON yet (print-json-from-the-spec-gate-lines
// design D10 names `--json` on it as a follow-up), so it is read by nobody.
// `openspec --version` is the spec skill's CLI-presence probe: it either prints
// a version or stops the run before anything is named, so there is nothing to meter.
const UNREAD_BY_NAME = ['openspec validate "<name>"', 'openspec --version']

test('every fenced openspec and interlock line in the three skills is one the meter classifies or names as unread', () => {
  const all = SKILL_FILES.flatMap(fencedCommandLines)
  assert.ok(all.length >= 10, `only ${all.length} fenced command lines found`)
  const stray = all.filter(l => lineKind(l.line) === null && !UNREAD_BY_NAME.includes(l.line))
  assert.deepEqual(stray.map(l => `${l.file}:${l.n}: ${l.line}`), [], 'a keyed line the classifier does not know')
  const kinds = new Set(all.map(l => lineKind(l.line)))
  const absent = [...new Set(KEYED_LINES.map(k => k.kind))].filter(k => !kinds.has(k))
  assert.deepEqual(absent, [], `kinds no skill line runs any more: ${absent.join(', ')}`)
})

test('the spec skill\'s keyed lines run in KEYED_LINES\' order', () => {
  const order = [...new Set(KEYED_LINES.map(k => k.kind))]
  const seen = fencedCommandLines('skills/spec/SKILL.md')
    .map(l => ({ ...l, kind: lineKind(l.line) }))
    .filter(l => order.includes(l.kind))
  for (let i = 1; i < seen.length; i++) {
    assert.ok(
      order.indexOf(seen[i].kind) >= order.indexOf(seen[i - 1].kind),
      `skills/spec/SKILL.md:${seen[i].n} (${seen[i].kind}) runs before line ${seen[i - 1].n} (${seen[i - 1].kind}) in KEYED_LINES`
    )
  }
})
