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
  argvOf,
  changeOf,
  findJson,
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
  assert.deepEqual(TEXT_KINDS, ['status', 'drift', 'ledger', 'validate', 'gate', 'advisor', 'ready'])
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
  assert.deepEqual(specPaneLines(freshSpec()), [{ key: 'spec-none', text: NO_SPEC_LINE, dim: true }])
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

// --- the advisor line (add-checkpoint-advisor D9, D21) ----------------------
//
// The checkpoint consult is bracketed by `interlock advisor … --json` lines.
// The meter keys on them like any other text kind: it reads `step`, and by
// step the fields the CLI printed, never the file the check wrote, and it
// shows the `--verdict` step unparsed so no KEEP or KILL reaches either surface.

/** A Bash result as the engine raises it, with `emit`'s pretty-printed JSON as stdout. */
const bashResult = value => {
  const stdout = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  return { result: { stdout, stderr: '', interrupted: false }, text: stdout }
}

const BRIEF_LINE = 'interlock advisor "add-the-thing" --brief --findings .claude/metrics/review-artifacts-add-the-thing-20261006-121500.json --json'
const CHECK_LINE = 'interlock advisor "add-the-thing" --check .claude/metrics/advisor-add-the-thing-20261006-122000.json --json'
const FAILED_LINE = 'interlock advisor "add-the-thing" --check --failed "agent spawn errored" --json'
const VERDICT_LINE = 'interlock advisor --verdict --labels evals --json'
const BRIEF_PATH = '.claude/metrics/advisor-brief-add-the-thing-20261006-121900.md'
const DRAFT_PATH = '.claude/metrics/advisor-add-the-thing-20261006-122000.json'

const briefResult = (omitted = []) =>
  bashResult({ step: 'brief', change: 'add-the-thing', path: BRIEF_PATH, chars: 41234, omitted, overrun: 0, notes: 2, findings: 1 })

const checkResult = (n, extra = {}) =>
  bashResult({
    step: 'check',
    change: 'add-the-thing',
    status: 'drafted',
    questions: Array.from({ length: n }, (_, i) => ({ id: `Q${i + 1}`, question: `Question number ${i + 1}?` })),
    dropped: 2,
    risks: 3,
    path: 'openspec/changes/add-the-thing/advisor.md',
    ...extra
  })

const failedResult = reason =>
  bashResult({
    step: 'check',
    change: 'add-the-thing',
    status: 'did-not-run',
    reason,
    questions: [],
    dropped: 0,
    risks: 0,
    path: 'openspec/changes/add-the-thing/advisor.md'
  })

test('lineKind classifies the brief, check, failed and verdict lines as advisor, and nothing that merely resembles them', () => {
  for (const command of [BRIEF_LINE, CHECK_LINE, FAILED_LINE, VERDICT_LINE, 'interlock advisor "add-the-thing" --brief --json', 'interlock advisor x --check - --json']) {
    assert.equal(lineKind(command), 'advisor', command)
  }
  // Keyed on the command words, not `--json`, so a line on older skill text is shown unparsed rather than ignored.
  assert.equal(lineKind('interlock advisor "add-the-thing" --check d.json'), 'advisor')
  for (const command of ['interlock advisory x', 'interlock advisorx --brief', '"interlock" advisor x --brief --json', 'interlock note derive --findings f --change x --json']) {
    assert.equal(lineKind(command), null, command)
  }
})

test('advisor sits after the autonomy entries and before ready in KEYED_LINES, and between gate and ready in TEXT_KINDS', () => {
  const kinds = KEYED_LINES.map(k => k.kind)
  const advisor = kinds.indexOf('advisor')
  assert.ok(advisor !== -1, 'KEYED_LINES has no advisor entry')
  assert.equal(kinds.lastIndexOf('advisor'), advisor, 'advisor appears in KEYED_LINES more than once')
  assert.deepEqual(KEYED_LINES[advisor].words, ['interlock', 'advisor'])
  assert.equal(kinds[advisor - 1], 'autonomy', 'advisor must follow the last autonomy entry')
  assert.equal(kinds[advisor + 1], 'ready', 'advisor must precede ready')
  assert.equal(TEXT_KINDS.indexOf('advisor'), TEXT_KINDS.indexOf('gate') + 1)
  assert.equal(TEXT_KINDS.indexOf('ready'), TEXT_KINDS.indexOf('advisor') + 1)
})

test('changeOf reads an advisor line\'s change from positional 2, and the --verdict form names none', () => {
  assert.equal(changeOf('advisor', BRIEF_LINE, null), 'add-the-thing')
  assert.equal(changeOf('advisor', CHECK_LINE, null), 'add-the-thing')
  assert.equal(changeOf('advisor', FAILED_LINE, null), 'add-the-thing')
  assert.equal(changeOf('advisor', "interlock advisor add-the-thing --brief --json", null), 'add-the-thing')
  assert.equal(changeOf('advisor', VERDICT_LINE, null), null)
  assert.equal(changeOf('advisor', VERDICT_LINE, { step: 'verdict', verdict: 'KEEP' }), null)
  assert.equal(changeOf('advisor', 'interlock advisor "<name>" --brief --json', null), null)
  assert.equal(readResult('advisor', VERDICT_LINE, bashResult({ step: 'verdict', verdict: 'KEEP', labelled: 10, matches: 5, repeats: 2, caps: {}, problems: [] })).name, null)
})

test('readResult reads the brief step by path and omitted count, and the check step by status, questions, dropped and risks', () => {
  assert.deepEqual(readResult('advisor', BRIEF_LINE, briefResult()), {
    kind: 'advisor',
    step: 'brief',
    path: BRIEF_PATH,
    omitted: 0,
    name: 'add-the-thing'
  })
  assert.equal(readResult('advisor', BRIEF_LINE, briefResult(['notes', 'specs/a/spec.md'])).omitted, 2)

  assert.deepEqual(readResult('advisor', CHECK_LINE, checkResult(2)), {
    kind: 'advisor',
    step: 'check',
    status: 'drafted',
    questions: [
      { id: 'Q1', question: 'Question number 1?' },
      { id: 'Q2', question: 'Question number 2?' }
    ],
    dropped: 2,
    risks: 3,
    name: 'add-the-thing'
  })

  const failed = readResult('advisor', FAILED_LINE, failedResult('agent spawn errored'))
  assert.equal(failed.step, 'check')
  assert.equal(failed.status, 'did-not-run')
  assert.equal(failed.reason, 'agent spawn errored')
  assert.deepEqual(failed.questions, [])
  assert.equal(failed.name, 'add-the-thing')
})

test('an advisor line that lacks its fields, is not JSON, or prints an unknown step is unparsed and never a verdict', () => {
  assert.equal(readResult('advisor', BRIEF_LINE, bashResult({ change: 'add-the-thing' })).reason, 'fields missing: step')
  assert.equal(readResult('advisor', CHECK_LINE, bashResult('advisor.md written\n')).reason, 'output not JSON')

  const verdict = readResult(
    'advisor',
    VERDICT_LINE,
    bashResult({ step: 'verdict', verdict: 'KEEP', labelled: 10, matches: 5, repeats: 2, caps: { minLabels: 10, keepMinMatches: 3, repeatMaxPercent: 50 }, problems: [] })
  )
  assert.equal(typeof verdict.unparsed, 'string', 'the verdict step must be read as unparsed')
  assert.equal(verdict.reason, 'step verdict is not read')
  assert.equal(stageText(verdict), 'advisor (unparsed)')

  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thing'
  spec.order = ['add-the-thing']
  spec.changes.set('add-the-thing', { advisor: verdict })
  spec.stage = verdict
  assert.equal(specStatusText(spec), 'interlock spec: add-the-thing · advisor (unparsed)')
  const lines = specPaneLines(spec)
  const advisorLine = lines.find(l => l.key === 'spec-advisor')?.text
  assert.match(advisorLine, /^advisor: not read \(step verdict is not read\)/)
  for (const l of lines) assert.doesNotMatch(l.text, /\bKEEP\b|\bKILL\b/, l.text)
  assert.doesNotMatch(specStatusText(spec), /\bKEEP\b|\bKILL\b/)
})

test('an advisor line on a change that does not resolve reads error and candidates, as ledger and validate do', () => {
  const unresolved = readResult(
    'advisor',
    'interlock advisor "add-the-thin" --brief --json',
    bashResult({ error: 'change "add-the-thin" not found', candidates: ['add-the-thing'] })
  )
  assert.deepEqual(unresolved.candidates, ['add-the-thing'])
  assert.match(unresolved.error, /not found/)
  assert.equal(stageText(unresolved), 'advisor: change not resolved (candidates 1)')

  const spec = freshSpec()
  spec.phase = 'live'
  spec.current = 'add-the-thin'
  spec.changes.set('add-the-thin', { advisor: unresolved })
  assert.equal(specPaneLines(spec).find(l => l.key === 'spec-advisor')?.text, 'advisor: change not resolved · candidates add-the-thing')
})

test('stageText says each advisor step in the CLI\'s words', () => {
  assert.equal(stageText(readResult('advisor', BRIEF_LINE, briefResult())), 'advisor brief (omitted 0)')
  assert.equal(stageText(readResult('advisor', BRIEF_LINE, briefResult(['notes']))), 'advisor brief (omitted 1)')
  assert.equal(stageText(readResult('advisor', CHECK_LINE, checkResult(7))), 'advisor 7 questions (dropped 2)')
  assert.equal(stageText(readResult('advisor', FAILED_LINE, failedResult('agent spawn errored'))), 'advisor did not run')
})

test('writeOf files the advisor draft by its change, and not the brief', () => {
  assert.deepEqual(writeOf(DRAFT_PATH), { kind: 'draft', change: 'add-the-thing', path: DRAFT_PATH })
  assert.deepEqual(writeOf(`/repo/${DRAFT_PATH}`), { kind: 'draft', change: 'add-the-thing', path: `/repo/${DRAFT_PATH}` })
  assert.equal(writeOf(BRIEF_PATH), null, 'the CLI writes the brief; it is not a draft')
  assert.equal(writeOf('.claude/metrics/advisor-add-the-thing.json'), null)
  // The findings file keeps its own kind beside the draft's.
  assert.equal(writeOf('.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json').kind, 'findings')
})

/** The happy path's record after the consult: a spawn, the draft write and a check step of four questions. */
function consultedSpec() {
  const spec = liveSpec()
  const slot = spec.changes.get('add-the-thing')
  slot.advisor = readResult('advisor', CHECK_LINE, checkResult(4))
  spec.consult = { spawned: 1, at: Date.parse('2026-10-06T12:19:30Z') }
  spec.drafts.set('add-the-thing', DRAFT_PATH)
  spec.stage = slot.advisor
  return spec
}

test('freshSpec holds an unspawned consult and no draft paths', () => {
  const spec = freshSpec()
  assert.deepEqual(spec.consult, { spawned: 0, at: null })
  assert.ok(spec.drafts instanceof Map)
  assert.equal(spec.drafts.size, 0)
})

test('the pane draws the advisor line, its questions by id, the consult, the draft and what the human is waiting on', () => {
  const spec = consultedSpec()
  assert.equal(specStatusText(spec), 'interlock spec: add-the-thing · advisor 4 questions (dropped 2)')
  const lines = specPaneLines(spec)
  const by = key => lines.find(l => l.key === key)?.text
  assert.equal(by('spec-advisor'), 'advisor: drafted · questions 4 · dropped 2 · risks 3')
  for (let i = 1; i <= 4; i++) assert.equal(by(`spec-advisor-q-Q${i}`), `Q${i} · Question number ${i}?`)
  assert.equal(by('spec-advisor-q-Q5'), undefined)
  assert.equal(by('spec-consult'), 'consult spawned 2026-10-06T12:19:30.000Z')
  assert.equal(by('spec-draft'), `draft file: ${DRAFT_PATH}`)
  assert.equal(by('spec-waiting'), 'waiting on you: advisor questions 4 · needs_human 2')
  assert.equal(by('spec-findings'), 'findings file: .claude/metrics/review-artifacts-add-the-thing-20261006-121500.json')
  assert.equal(new Set(lines.map(l => l.key)).size, lines.length, 'a key repeats')
  for (const l of lines) assert.doesNotMatch(l.text, /complete|✓|✔/i, l.text)
  const keys = lines.map(l => l.key)
  assert.ok(keys.indexOf('spec-advisor') < keys.indexOf('spec-advisor-q-Q1'), 'the question rows follow the advisor line')
})

test('the pane draws a brief step by its path, and a consult that did not run with its reason', () => {
  const spec = liveSpec()
  spec.changes.get('add-the-thing').advisor = readResult('advisor', BRIEF_LINE, briefResult())
  const brief = specPaneLines(spec)
  const by = key => brief.find(l => l.key === key)?.text
  assert.equal(by('spec-advisor'), `advisor brief: ${BRIEF_PATH} (omitted 0)`)
  // The questions part is the last check step's: a brief step is not one.
  assert.equal(by('spec-waiting'), 'waiting on you: advisor questions not run yet · needs_human 2')
  assert.equal(by('spec-consult'), 'consult: not spawned')
  assert.equal(by('spec-draft'), undefined)

  spec.changes.get('add-the-thing').advisor = readResult('advisor', FAILED_LINE, failedResult('agent spawn errored'))
  const failed = specPaneLines(spec)
  const at = key => failed.find(l => l.key === key)?.text
  assert.equal(at('spec-advisor'), 'advisor: did-not-run · questions 0 · dropped 0 · risks 0 · reason agent spawn errored')
  assert.equal(at('spec-waiting'), 'waiting on you: advisor questions 0 · needs_human 2')
  assert.ok(!failed.some(l => l.key.startsWith('spec-advisor-q-')), 'a consult that did not run has no question rows')
})

test('before any line crossed, the advisor, consult and waiting lines say so', () => {
  const unnamed = freshSpec()
  unnamed.phase = 'live'
  const lines = specPaneLines(unnamed)
  const by = key => lines.find(l => l.key === key)?.text
  assert.equal(by('spec-advisor'), 'advisor: not run yet')
  assert.equal(by('spec-consult'), 'consult: not spawned')
  assert.equal(by('spec-waiting'), 'waiting on you: advisor questions not run yet · needs_human not run yet')
  assert.ok(!lines.some(l => l.key.startsWith('spec-advisor-q-')))
  for (const l of lines) assert.doesNotMatch(l.text, /complete/i, l.text)

  // A ledger line crossed and no check step: only the advisor part is unknown.
  const ledgerOnly = liveSpec()
  assert.equal(specPaneLines(ledgerOnly).find(l => l.key === 'spec-waiting')?.text, 'waiting on you: advisor questions not run yet · needs_human 2')
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

// `openspec validate` prints no JSON yet (print-json-from-the-spec-gate-lines
// design D10 names `--json` on it as a follow-up), so it is read by nobody.
// `openspec --version` is the spec skill's CLI-presence probe: it either prints
// a version or stops the run before anything is named, so there is nothing to meter.
const UNREAD_BY_NAME = ['openspec validate', 'openspec --version']

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

// --- a review consult is not a spec consult (add-review-findings-advisor D3) ---
//
// The review-findings advisor is a second seat for the same kind of agent. The
// meter counts spec consults, so a review consult in a session that still holds
// a live spec run must change nothing it draws. The agent type is the guard on
// the spawn side; the whole-word match and the draft regex are the guard on the
// line and write side. Each is pinned so a later meter edit cannot start
// counting review consults without failing here by name.

const REVIEW_ADVISOR_LINES = [
  'interlock review-advisor x --check - --json',
  'interlock review-advisor "add-the-thing" --check - --json',
  'interlock review-advisor "add-the-thing" --check --failed "spawn errored" --json',
  'interlock review-advisor --verdict --labels evals --json'
]

test('lineKind gives no advisor kind, and no kind at all, to an interlock review-advisor line', () => {
  for (const command of REVIEW_ADVISOR_LINES) {
    assert.equal(lineKind(command), null, command)
  }
  // The checkpoint advisor's own line keeps its kind beside them.
  assert.equal(lineKind('interlock advisor x --check - --json'), 'advisor')
})

test('writeOf files a review-advisor draft, brief and index as no draft', () => {
  const draft = '.claude/metrics/review-advisor-x-20261022-101010.json'
  assert.equal(writeOf(draft), null)
  assert.equal(writeOf(`/repo/${draft}`), null)
  assert.equal(writeOf('.claude/metrics/review-advisor-brief-x-20261022-101010.md'), null)
  assert.equal(writeOf('.claude/metrics/review-advisor-brief-x-20261022-101010.json'), null)
  // The review's own findings and the checkpoint draft keep their kinds.
  assert.equal(writeOf('.claude/metrics/advisor-x-20261022-101010.json').kind, 'draft')
})

test('the meter spells the checkpoint advisor\'s agent type alone: no review-advisor in the pure rules or the spawn gate', () => {
  const mod = readFileSync(join(ROOT, 'hooks', 'mod.mjs'), 'utf8')
  const rules = readFileSync(join(ROOT, 'lib', 'spec-meter.mjs'), 'utf8')
  assert.match(mod, /input\.subagentType === 'interlock:advisor'/, 'hooks/mod.mjs no longer gates the consult count on interlock:advisor')
  assert.doesNotMatch(mod, /review-advisor/, 'hooks/mod.mjs names review-advisor: a review consult would reach the spec meter')
  assert.doesNotMatch(rules, /review-advisor/, 'lib/spec-meter.mjs names review-advisor')
})
