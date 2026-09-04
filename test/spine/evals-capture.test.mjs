// Capturing an eval-case skeleton from a recorded trajectory.
//
// The two things worth holding here are the refusals and the quoting. A capture
// that emitted a skeleton for a run nobody can replay would produce a citation
// that fails the moment someone follows it, and a capture that invented a
// grader pattern would produce a regression case for a failure that never
// happened — both of which are worse than no capture at all, because both look
// like evidence.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendRunLogEvent, runLogPath } from '../../lib/run-log.mjs'
import {
  buildSkeleton,
  captureCase,
  formatCapture,
  CASE_SCHEMA_VERSION,
  CONFIRM_MARKER,
  PLACEHOLDER,
  EVAL_SUITE_DIR
} from '../../lib/evals-capture.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-capture-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const RUN_ID = 'run-capture-1'

/** A reconstructable run: contiguous seq, a start, a close, an exit per invocation. */
function recordRun(root, over = {}) {
  const ev = e => appendRunLogEvent(root, { runId: RUN_ID, change: 'add-widget', ...e })
  ev({ type: 'run-start', mode: 'checkpoint' })
  ev({ type: 'wave-action', action: 'run-batch', wave: '1', source: 'next' })
  ev({ type: 'cli-exit', command: 'interlock wave-state next', exitCode: 0 })
  ev({ type: 'agent-spawn', label: 'impl 1.1', kind: 'implementer', taskId: '1.1' })
  if (over.receipt) ev({ type: 'run-receipt', ...over.receipt })
  if (over.halt) ev({ type: 'run-halt', reason: over.halt })
  else ev({ type: 'run-complete', leftoverTaskIds: [] })
}

// The structural gate's own readers, in miniature — the assertions
// test/evals.test.mjs makes over every case in the suite, applied to a skeleton
// before it is anywhere near the suite. A skeleton that failed them would fail
// the moment someone moved it in unchanged.
const topLevel = (text, key) => (new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text) || [])[1]
const graderType = text => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  return (/^type:\s*(\S+)/m.exec(m ? m[1] : text) || [])[1]
}

// --- refusals ---------------------------------------------------------------

test('an unknown run identifier is refused, never invented', () => {
  const result = buildSkeleton(tmp, { runId: 'run-that-never-ran' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /not reconstructable/)
  assert.ok(
    result.problems.some(p => /no trajectory file found/.test(p)),
    'the refusal reports the check\'s own problems'
  )
  assert.deepEqual(result.files, [])
})

test('an incomplete trajectory is refused with the reconstructability problems verbatim', () => {
  // A run with a start and no close: exactly what `run-log check` calls
  // incomplete, and capture defers to it rather than deciding for itself.
  appendRunLogEvent(tmp, { runId: RUN_ID, type: 'run-start', mode: 'checkpoint' })
  const result = buildSkeleton(tmp, { runId: RUN_ID })

  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /missing a run-halt or run-complete/.test(p)))
})

test('a run whose trajectory has a sequence gap is refused for that reason', () => {
  recordRun(tmp)
  // Tear one line out. The gap is what the published check reports; capture
  // reports the same words rather than a private paraphrase of them.
  const path = runLogPath(tmp, RUN_ID)
  const kept = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  writeFileSync(path, [kept[0], ...kept.slice(2)].join('\n') + '\n')

  const result = buildSkeleton(tmp, { runId: RUN_ID })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some(p => /sequence gap/.test(p)))
})

test('no run identifier is refused rather than guessed at', () => {
  const result = buildSkeleton(tmp, {})
  assert.equal(result.ok, false)
  assert.match(result.reason, /no run identifier/)
})

// --- provenance -------------------------------------------------------------

test('a reconstructable run yields a skeleton citing its trajectory and event range', () => {
  recordRun(tmp)
  const result = buildSkeleton(tmp, { runId: RUN_ID })

  assert.equal(result.ok, true)
  assert.match(result.provenance, new RegExp(`${RUN_ID}\\.jsonl`))
  assert.match(result.provenance, /events 1-5/)
  assert.match(result.provenance, /the whole run/)
})

test('a task identifier narrows the cited event range', () => {
  recordRun(tmp)
  const result = buildSkeleton(tmp, { runId: RUN_ID, taskId: '1.1' })

  assert.equal(result.ok, true)
  assert.match(result.provenance, /events 4-4/, 'the one event carrying that task id')
  assert.match(result.provenance, /task 1\.1/)
})

test('a task identifier the run never recorded widens out loud rather than silently', () => {
  recordRun(tmp)
  const result = buildSkeleton(tmp, { runId: RUN_ID, taskId: '9.9' })

  assert.equal(result.ok, true)
  assert.match(result.provenance, /the whole run/)
  assert.ok(result.notes.some(n => /no event in this trajectory carries taskId "9\.9"/.test(n)))
})

// --- the grader -------------------------------------------------------------

test('an out-of-set value recorded by the run becomes the grader pattern', () => {
  recordRun(tmp, { receipt: { planStatus: 'reused-probably', waves: [] } })
  const result = buildSkeleton(tmp, { runId: RUN_ID })

  assert.equal(result.ok, true)
  assert.equal(result.quoted.value, 'reused-probably')
  assert.equal(result.quoted.source, 'run-receipt.planStatus')

  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents
  assert.match(grader, /pattern: 'reused-probably'/)
  assert.match(grader, new RegExp(`${CONFIRM_MARKER} BEFORE USE`))
  assert.doesNotMatch(grader, new RegExp(PLACEHOLDER))
})

test('a value the run named while halting becomes the grader pattern, quoted', () => {
  recordRun(tmp, { halt: 'record-batch refused: status "done" is not one of ok, blocked, partial' })
  const result = buildSkeleton(tmp, { runId: RUN_ID })

  assert.equal(result.quoted.value, 'done')
  assert.equal(result.quoted.source, 'run-halt.reason')
  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents
  assert.match(grader, /pattern: 'done'/)
})

test('no quotable value yields a marked placeholder and says so, never an invented pattern', () => {
  recordRun(tmp)
  const result = buildSkeleton(tmp, { runId: RUN_ID })

  assert.equal(result.quoted, null)
  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents
  assert.match(grader, new RegExp(`pattern: '${PLACEHOLDER}'`))
  assert.match(grader, /Capture does not invent a pattern/)
  assert.ok(result.notes.some(n => /no out-of-set or fabricated value could be quoted/.test(n)))
})

test('a quoted value is escaped so it matches itself and nothing else', () => {
  recordRun(tmp, { halt: 'the agent cited "lib/nowhere.ts:1" which does not exist' })
  const result = buildSkeleton(tmp, { runId: RUN_ID })
  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents
  assert.match(grader, /pattern: 'lib\/nowhere\\\.ts:1'/, 'the dot is escaped, not left as any-char')
})

test('a captured skeleton never emits a judged grader and never carries the per-PR tag', () => {
  recordRun(tmp, { halt: 'status "done" is not in the enum' })
  const result = buildSkeleton(tmp, { runId: RUN_ID })
  const caseYaml = result.files.find(f => f.path === 'case.yaml').contents
  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents

  assert.equal(graderType(grader), 'regex')
  assert.doesNotMatch(grader, /^type:\s*(llm|baseline)/m)
  assert.match(caseYaml, /^tags: \[\]$/m, 'no smoke tag: an unconfirmed pattern must not run on every PR')
})

// --- the prompt -------------------------------------------------------------

test('an absent prompt is a stated placeholder, and the output says none was recorded', () => {
  recordRun(tmp)
  const result = buildSkeleton(tmp, { runId: RUN_ID })
  const caseYaml = result.files.find(f => f.path === 'case.yaml').contents

  assert.equal(result.promptRecorded, false)
  assert.match(caseYaml, new RegExp(`${CONFIRM_MARKER}: no prompt was recorded`))
  assert.match(caseYaml, /Do not paraphrase it and do not reconstruct it/)
  assert.ok(result.notes.some(n => /no prompt was recorded/.test(n)))
})

test('a recorded prompt snapshot is carried through verbatim', () => {
  recordRun(tmp)
  // A host that did record one. Written straight to the trajectory, because the
  // writer's whitelist is what keeps such a field out of the events it writes.
  const path = runLogPath(tmp, RUN_ID)
  writeFileSync(
    path,
    readFileSync(path, 'utf8') +
      JSON.stringify({ schema: 'x', ts: '2026-01-01T00:00:00.000Z', runId: RUN_ID, seq: 6, type: 'agent-spawn', prompt: 'Implement exactly one task.' }) +
      '\n'
  )

  const result = buildSkeleton(tmp, { runId: RUN_ID })
  assert.equal(result.promptRecorded, true)
  const caseYaml = result.files.find(f => f.path === 'case.yaml').contents
  assert.match(caseYaml, /Implement exactly one task\./)
})

// --- the structural gate ----------------------------------------------------

test('the emitted skeleton satisfies the gate the case suite is held to', () => {
  recordRun(tmp, { halt: 'status "done" is not in the enum' })
  const result = buildSkeleton(tmp, { runId: RUN_ID })
  const caseYaml = result.files.find(f => f.path === 'case.yaml').contents
  const grader = result.files.find(f => f.path.endsWith('observed-value.md')).contents

  assert.equal(topLevel(caseYaml, 'schema_version'), `'${CASE_SCHEMA_VERSION}'`, 'the version is pinned')
  const provenance = topLevel(caseYaml, 'provenance')
  assert.ok(provenance && provenance.length > 2, 'the provenance line is non-empty')
  assert.ok(['regex', 'tool_order', 'tool_used', 'file_exists'].includes(graderType(grader)))
  assert.ok(result.files.some(f => f.path.startsWith('graders')), 'a graders/ directory is emitted')
})

// --- writing ----------------------------------------------------------------

test('the skeleton lands in the caller\'s directory and nothing under evals/ is touched', () => {
  recordRun(tmp)
  mkdirSync(join(tmp, EVAL_SUITE_DIR), { recursive: true })
  const before = readdirSync(join(tmp, EVAL_SUITE_DIR))

  const result = captureCase(tmp, { runId: RUN_ID, outDir: 'drafts/case-1' })
  assert.equal(result.ok, true)
  assert.ok(existsSync(join(tmp, 'drafts', 'case-1', 'case.yaml')))
  assert.ok(existsSync(join(tmp, 'drafts', 'case-1', 'graders', 'observed-value.md')))
  assert.deepEqual(readdirSync(join(tmp, EVAL_SUITE_DIR)), before, 'the suite is untouched')
})

test('an output directory inside the suite is refused and nothing is written', () => {
  recordRun(tmp)
  for (const dir of [EVAL_SUITE_DIR, `${EVAL_SUITE_DIR}/new-case`, `./evals/deep/nested`]) {
    const result = captureCase(tmp, { runId: RUN_ID, outDir: dir })
    assert.equal(result.ok, false, `${dir} must be refused`)
    assert.match(result.reason, /never writes into the suite/)
    assert.deepEqual(result.written, [])
  }
  assert.equal(existsSync(join(tmp, EVAL_SUITE_DIR)), false, 'not even the directory is created')
})

test('an occupied output directory is refused rather than overwritten', () => {
  recordRun(tmp)
  mkdirSync(join(tmp, 'drafts', 'case-1'), { recursive: true })
  writeFileSync(join(tmp, 'drafts', 'case-1', 'case.yaml'), 'name: mine\n')

  const result = captureCase(tmp, { runId: RUN_ID, outDir: 'drafts/case-1' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /already holds a case/)
  assert.equal(readFileSync(join(tmp, 'drafts', 'case-1', 'case.yaml'), 'utf8'), 'name: mine\n')
})

test('a refused run writes nothing at all, not even an empty directory', () => {
  const result = captureCase(tmp, { runId: 'run-that-never-ran', outDir: 'drafts/case-1' })
  assert.equal(result.ok, false)
  assert.equal(existsSync(join(tmp, 'drafts')), false)
})

test('the rendering names the refusal reason, and the draft its markers', () => {
  const refused = formatCapture(captureCase(tmp, { runId: 'missing', outDir: 'drafts/x' }))
  assert.match(refused, /CAPTURE REFUSED/)
  assert.match(refused, /no trajectory file found/)

  recordRun(tmp)
  const done = formatCapture(captureCase(tmp, { runId: RUN_ID, outDir: 'drafts/y' }))
  assert.match(done, /CAPTURED DRAFT/)
  assert.match(done, /provenance:/)
  assert.match(done, /This is a draft, not a case/)
})
